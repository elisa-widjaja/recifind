import type { Env } from './index';

// Daily digest of Facebook recipes that imported in a broken state (generic/empty
// title or no image), emailed to the admin so they can be fixed (Re-enrich /
// Re-host). Read-only and fully decoupled from the import/save path: it runs off
// the existing hourly cron, internally gated to fire ~once per day.
// See docs/superpowers/specs/2026-06-17-broken-fb-recipe-digest-design.md

export type DigestRow = {
  id: string;
  user_id?: string;
  title: string | null;
  source_url: string | null;
  image_url: string | null;
  image_path: string | null;
  preview_image: string | null;
  created_at?: string;
  owner_email?: string | null;
};

export type BrokenReason = 'generic-title' | 'no-image';

export type BrokenRecipe = {
  id: string;
  title: string;
  ownerEmail: string;
  sourceUrl: string;
  reasons: BrokenReason[];
};

// Generic/empty Facebook titles that signal a broken import. Single source of
// truth — also consumed by the Discover community-shelf filter in index.ts.
const GENERIC_FB_TITLES = new Set([
  'facebook reel', 'fb.watch', 'facebook',
  'discover popular videos', 'discover popular videos | facebook',
]);

export function isGenericFacebookTitle(title: string | null | undefined): boolean {
  const t = String(title ?? '').trim();
  if (!t) return true;
  const tl = t.toLowerCase();
  if (tl.startsWith('redirecting')) return true; // "Redirecting..." / "Redirecting…"
  return GENERIC_FB_TITLES.has(tl);
}

// A title worth replacing during re-enrich / auto-heal: a generic Facebook
// placeholder, OR a raw caption dumped into the title (multi-line, or very long).
// Clean, deliberately-set titles (single line, <= 80 chars) are left alone.
export function looksLikeBrokenTitle(title: string | null | undefined): boolean {
  const t = String(title ?? '');
  return isGenericFacebookTitle(t) || /\n/.test(t) || t.trim().length > 80;
}

function isFacebookSource(sourceUrl: string | null | undefined): boolean {
  const s = String(sourceUrl ?? '').toLowerCase();
  return s.includes('facebook.com') || s.includes('fb.watch');
}

function hasNoImage(row: DigestRow): boolean {
  return !String(row.image_url ?? '').trim()
      && !String(row.image_path ?? '').trim()
      && !String(row.preview_image ?? '').trim();
}

// Pure filter: given (already FB-windowed) rows, return the broken ones with
// their reason flags. Re-checks the FB source defensively so the function is
// self-contained and independently testable.
export function selectBrokenRecipes(rows: DigestRow[]): BrokenRecipe[] {
  const out: BrokenRecipe[] = [];
  for (const row of rows) {
    if (!isFacebookSource(row.source_url)) continue;
    const reasons: BrokenReason[] = [];
    if (isGenericFacebookTitle(row.title)) reasons.push('generic-title');
    if (hasNoImage(row)) reasons.push('no-image');
    if (reasons.length === 0) continue;
    out.push({
      id: String(row.id),
      title: String(row.title ?? '').trim(),
      ownerEmail: String(row.owner_email ?? '').trim() || '(unknown)',
      sourceUrl: String(row.source_url ?? ''),
      reasons,
    });
  }
  return out;
}

const REASON_LABEL: Record<BrokenReason, string> = {
  'generic-title': 'generic title',
  'no-image': 'no image',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildBrokenDigestEmail(recipes: BrokenRecipe[]): { subject: string; html: string } {
  const n = recipes.length;
  const plural = n === 1 ? '' : 's';
  const subject = `ReciFriend: ${n} broken Facebook import${plural} saved today`;
  const items = recipes.map((r) => {
    const title = r.title ? escapeHtml(r.title) : '(no title)';
    const problems = r.reasons.map((x) => REASON_LABEL[x]).join(', ');
    const url = escapeHtml(r.sourceUrl);
    return `<li style="margin-bottom:12px">
  <strong>${title}</strong> (${problems})<br>
  owner: ${escapeHtml(r.ownerEmail)}<br>
  <a href="${url}">${url}</a><br>
  <span style="color:#888">id: ${escapeHtml(r.id)}</span>
</li>`;
  }).join('\n');
  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">
<p>${n} Facebook recipe${plural} imported in a broken state (generic/empty title or no image). Fix via the admin UI (Re-enrich / Re-host):</p>
<ul>
${items}
</ul>
</div>`;
  return { subject, html };
}

// ---- Orchestrator (cron entry point) ----

const BROKEN_DIGEST_RECIPIENT = 'elisa.widjaja@gmail.com';
const BROKEN_DIGEST_KV_KEY = 'broken-digest:last-run';
const DAILY_GATE_MS = 23 * 60 * 60 * 1000; // hourly cron fires this ~once/day
const LOOKBACK_MS = 24 * 60 * 60 * 1000;   // first run (no marker) looks back 1 day
const MAX_ROWS = 200;                       // safety cap per window

export async function runBrokenRecipeDigest(
  env: Env,
  now: number = Date.now(),
): Promise<{ ran: boolean; count: number }> {
  // Daily gate + dedup window: read the last successful run; skip if <23h ago.
  const lastRunRaw = await env.AI_PICKS_CACHE.get(BROKEN_DIGEST_KV_KEY);
  const parsed = lastRunRaw ? Date.parse(lastRunRaw) : NaN;
  const lastRunMs = Number.isNaN(parsed) ? (now - LOOKBACK_MS) : parsed;
  if (now - lastRunMs < DAILY_GATE_MS) {
    return { ran: false, count: 0 };
  }

  const sinceIso = new Date(lastRunMs).toISOString();
  // created_at filter first (bounded window) to avoid a full-table LIKE scan.
  const rows = await env.DB.prepare(
    `SELECT r.id, r.user_id, r.title, r.source_url, r.image_url, r.image_path,
            r.preview_image, r.created_at, p.email AS owner_email
     FROM recipes r
     LEFT JOIN profiles p ON p.user_id = r.user_id
     WHERE r.created_at > ?1
       AND (r.source_url LIKE '%facebook.com%' OR r.source_url LIKE '%fb.watch%')
       AND r.hidden_at IS NULL
     ORDER BY r.created_at DESC
     LIMIT ${MAX_ROWS}`,
  ).bind(sinceIso).all();

  const candidates = (rows.results ?? []) as unknown as DigestRow[];
  const broken = selectBrokenRecipes(candidates);

  if (broken.length > 0) {
    const truncated = candidates.length >= MAX_ROWS;
    const { subject, html } = buildBrokenDigestEmail(broken);
    const finalHtml = truncated
      ? `${html}\n<p style="color:#888">(digest truncated at ${MAX_ROWS} recipes; more may exist)</p>`
      : html;
    // Dynamic import avoids a static import cycle with index.ts.
    const { sendEmailNotification } = await import('./index');
    const res = await sendEmailNotification(env, BROKEN_DIGEST_RECIPIENT, subject, finalHtml);
    if (!res.ok) {
      // Do NOT advance the marker, so the next hourly run retries this window.
      throw new Error(`broken-digest email send failed: ${res.status ?? ''} ${res.body ?? ''}`.trim());
    }
  }

  // Advance the marker only after a successful send (or a zero-broken run).
  await env.AI_PICKS_CACHE.put(BROKEN_DIGEST_KV_KEY, new Date(now).toISOString());
  return { ran: true, count: broken.length };
}
