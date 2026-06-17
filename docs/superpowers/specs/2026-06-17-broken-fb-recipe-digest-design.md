# Broken Facebook Recipe Digest Email — Design

**Date:** 2026-06-17
**Status:** Approved design, pending spec review

## Goal

Email the admin a daily digest of newly-saved Facebook recipes that imported in a
broken state, so they can be found and fixed (Re-enrich / Re-host) without the
admin manually scanning the database.

This is a monitoring/notification feature. It is strictly **read-only** with
respect to recipe data and is **fully decoupled from the import/save path** (the
protected flow), per the decision to use a periodic digest rather than a
real-time hook.

## Trigger definition (what counts as "broken")

A saved recipe is included in the digest when **all** of:

1. **Source is Facebook:** `source_url` contains `facebook.com` or `fb.watch`.
2. **Saved within the digest window** (see Cadence): `created_at > last-run`.

AND **at least one** of these problems:

- **Generic/empty title** — `isGenericFacebookTitle(title)` is true: the trimmed
  title is empty, OR (case-insensitive) starts with `redirecting`, OR is one of
  `facebook reel`, `fb.watch`, `facebook`, `discover popular videos`,
  `discover popular videos | facebook`.
- **No image** — `image_url`, `image_path`, AND `preview_image` are all
  empty/null.

**Explicitly NOT in scope** (per user's choices):
- The "no ingredients/steps" (no-content) case — usually Facebook withholding the
  caption, not fixable.
- Non-Facebook sources (TikTok / Instagram / YouTube).
- Real-time / per-save alerts.

Each broken recipe is reported **once** — in the first digest after it is saved.
Because the broken check runs against the recipe's **current** state at digest
time, a recipe that the admin fixes before the digest runs is not reported.

## Architecture

The worker already runs an **hourly** cron (`crons = ["0 * * * *"]`, the
`scheduled()` handler in `apps/worker/src/index.ts`). The digest piggybacks on
this cron — no new cron trigger.

### Daily gate + dedup window (single KV marker)

- KV key `broken-digest:last-run` in the `AI_PICKS_CACHE` namespace, value = ISO
  timestamp of the last successful digest run.
- On each hourly invocation:
  1. Read the marker. If absent, treat `last-run` as `now - 24h` (first run looks
     back one day rather than all-time).
  2. If `now - last-run < 23h` → **skip** (this makes an hourly cron fire the
     digest effectively **once per day**).
  3. Otherwise run the digest (query → filter → email), then set the marker to
     `now`.
- The window `(last-run, now]` is both the **dedup mechanism** (each broken
  recipe appears in exactly one digest) and **self-correcting** across a missed
  cron run (the next run covers the gap — no recipes slip through).

### Failure isolation

- The digest runs inside its own `try/catch`, placed **early** in `scheduled()`,
  **before** the nudge kill-switch `return` (nudges are currently paused via
  `NUDGE_EMAILS_ENABLED=false`, and that branch returns from `scheduled()`, so
  the digest must run before it).
- A digest failure is logged and swallowed; it never affects `syncAdminUserStats`,
  the user-counts cache, or nudges.
- **Marker advances only on success:** if the Resend send throws, the marker is
  NOT updated, so the next hourly run retries the same window. If there are zero
  broken recipes, the marker advances (nothing to retry).

### Data flow

```
hourly cron → scheduled()
  → runBrokenRecipeDigest(env)
      read KV broken-digest:last-run  (gate: skip if <23h)
      D1 query: FB recipes created_at > last-run  (+ LEFT JOIN profiles for owner email)
      selectBrokenRecipes(rows)        (pure filter: generic title OR no image)
      if broken.length > 0:
          buildBrokenDigestEmail(broken) → { subject, html }
          sendEmailNotification(env, RECIPIENT, subject, html)   (Resend)
      set KV broken-digest:last-run = now   (only after success / zero-broken)
```

### D1 query

Filters on `created_at` first (cheap, bounded window) to avoid a full-table
`LIKE` scan, per D1 read-pressure hygiene:

```sql
SELECT r.id, r.user_id, r.title, r.source_url, r.image_url, r.image_path,
       r.preview_image, r.created_at, p.email AS owner_email
FROM recipes r
LEFT JOIN profiles p ON p.user_id = r.user_id
WHERE r.created_at > ?1                       -- last-run; bounds the scan
  AND (r.source_url LIKE '%facebook.com%' OR r.source_url LIKE '%fb.watch%')
  AND r.hidden_at IS NULL
ORDER BY r.created_at DESC
LIMIT 200;                                     -- safety cap; note truncation in email if hit
```

## Code layout

New isolated module **`apps/worker/src/brokenDigest.ts`** with small, testable
units:

- `isGenericFacebookTitle(title: string): boolean` — the generic/empty title
  check. **Single source of truth** for the generic-title list.
- `selectBrokenRecipes(rows: Row[]): BrokenRecipe[]` — pure filter. Returns the
  broken rows annotated with `reasons: ('generic-title' | 'no-image')[]`.
- `buildBrokenDigestEmail(recipes: BrokenRecipe[]): { subject, html }` — pure
  email builder.
- `runBrokenRecipeDigest(env: Env): Promise<{ ran: boolean; count: number }>` —
  orchestrator: KV gate, D1 query, filter, send, marker update.

Constants in the module:
- `BROKEN_DIGEST_RECIPIENT = 'elisa.widjaja@gmail.com'`
- `BROKEN_DIGEST_KV_KEY = 'broken-digest:last-run'`
- `DAILY_GATE_MS = 23 * 60 * 60 * 1000`

`scheduled()` wiring (dynamic import, matching the existing cron pattern):

```ts
try {
  const { runBrokenRecipeDigest } = await import('./brokenDigest');
  const r = await runBrokenRecipeDigest(env);
  console.log('[cron] brokenRecipeDigest', r);
} catch (err) {
  console.error('[cron] brokenRecipeDigest failed', err);
}
```

**Shared title check:** `index.ts`'s existing `isBrokenDiscoverRow` (the Discover
community-shelf filter) is updated to call `isGenericFacebookTitle` from this
module, so the generic-title list lives in one place. (The Discover row check
keeps its own image check, since the discover query only selects `image_url`.)

## Email content

Sent via the existing `sendEmailNotification(env, to, subject, html)` (Resend),
to `BROKEN_DIGEST_RECIPIENT`, **only when there is ≥1 broken recipe**.

- **Subject:** `ReciFriend: N broken Facebook import(s) saved today`
- **Body:** a simple list; each item shows:
  - Title, or `(no title)` when empty
  - Problem(s): e.g. `generic title`, `no image`
  - Owner email
  - Source URL (clickable)
  - Recipe id, and a pointer to fix it in the admin UI (Re-enrich / Re-host)
- If the 200-row cap is hit, append a line noting the digest was truncated.

**Copy rule:** user-facing text, so **no em dashes** (use commas/colons/periods),
per project copy convention.

## Cost

Bounded and within free tiers:
- Cron: 0 new (reuses the hourly cron).
- KV reads: ~24/day (one gate-check read per hour). Limit 100k/day.
- D1 query: 1/day, filtered on `created_at`. Limit 5M rows read/day.
- KV write: 1/day (marker). Limit 1k/day.
- Resend: ≤1 email/day (~30/month). Limit 100/day, 3k/month.
- Gemini: none.

## Testing

Unit tests in `apps/worker/src/brokenDigest.test.ts` (vitest):

- `isGenericFacebookTitle`: true for each generic value + empty + `Redirecting...`;
  false for real emoji/caption titles (`🌮 Crispy Verde Shrimp Tacos`,
  `Mango Coconut Laddoo`).
- `selectBrokenRecipes`: flags no-image (all three image fields empty) and
  generic-title rows with correct `reasons`; a clean emoji-titled recipe with an
  image is NOT flagged; a non-FB row is excluded.
- `buildBrokenDigestEmail`: renders one entry per recipe, shows `(no title)`,
  lists reasons, contains no em dashes.

The `runBrokenRecipeDigest` orchestrator stays thin; the cron wiring is not unit
tested (its pieces are).

## Edge cases / error handling

- **No marker yet (first run):** look back 24h; do not flood with all-time
  broken recipes.
- **Missed cron run:** window since `last-run` covers the gap.
- **Resend failure:** marker not advanced → retried next hour.
- **Recipe fixed before digest:** current-state filter excludes it (not reported).
- **>200 broken in one window:** capped, truncation noted in the email.
- **Owner profile missing:** `LEFT JOIN` → owner email shown as `(unknown)`.

## Out of scope (future, if wanted)

- Widening to TikTok/Instagram/YouTube.
- Including the no-content (missing ingredients/steps) case.
- A one-click "fix" action from the email.
- Configurable recipient/cadence via env vars.
