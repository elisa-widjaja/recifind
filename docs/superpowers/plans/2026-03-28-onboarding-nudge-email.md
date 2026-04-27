# Onboarding Nudge Email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a personalized "save your first recipe" nudge email ~24h after signup to users with zero recipes, with recommended recipes, a GIF demo, and an invite-friends CTA.

**Architecture:** D1 table `nudge_emails` stores pending nudges. Signup inserts a row with `send_after = now + 24h`. A Cloudflare Cron Trigger runs hourly, finds due rows, checks recipe count, sends via Resend or skips. A `POST /admin/test-nudge-email` endpoint lets Elisa preview the exact email before enabling the cron for real users.

**Tech Stack:** Cloudflare Workers (cron trigger), D1, Resend API, Supabase Storage (GIF asset)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/worker/migrations/0006_nudge_emails.sql` | Create | New table + `email_opt_out` column |
| `apps/worker/src/index.ts` | Modify | Signup hook, cron handler, test endpoint, email builder, recommended recipes query, unsubscribe endpoint |
| `apps/worker/wrangler.toml` | Modify | Add `[triggers]` cron |
| `image assets/add-recipe-demo.gif` | Create | GIF converted from trim MP4 (manual ffmpeg step) |

---

### Task 1: D1 Migration — `nudge_emails` table + `email_opt_out`

**Files:**
- Create: `apps/worker/migrations/0006_nudge_emails.sql`

- [ ] **Step 1: Write the migration SQL**

Create `apps/worker/migrations/0006_nudge_emails.sql`:

```sql
CREATE TABLE IF NOT EXISTS nudge_emails (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  send_after TEXT NOT NULL,
  sent INTEGER DEFAULT 0,
  sent_at TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE profiles ADD COLUMN email_opt_out INTEGER DEFAULT 0;
```

- [ ] **Step 2: Apply migration locally**

Run:
```bash
cd apps/worker && npx wrangler d1 migrations apply recipes-db --local
```
Expected: migration 0006 applied successfully.

- [ ] **Step 3: Apply migration to remote (production)**

Run:
```bash
cd apps/worker && npx wrangler d1 migrations apply recipes-db --remote
```
Expected: migration 0006 applied successfully.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/migrations/0006_nudge_emails.sql
git commit -m "feat: add nudge_emails table and email_opt_out column"
```

---

### Task 2: Signup Hook — Insert nudge row on profile creation

**Files:**
- Modify: `apps/worker/src/index.ts:2760-2775` (inside `getOrCreateProfile`, after the INSERT)

- [ ] **Step 1: Add nudge row insertion after profile creation**

In `getOrCreateProfile`, after the existing `INSERT INTO profiles` statement (line 2771-2773), add:

```typescript
  await env.DB.prepare(
    'INSERT INTO profiles (user_id, email, display_name, created_at) VALUES (?, ?, ?, ?)'
  ).bind(profile.userId, profile.email, profile.displayName, profile.createdAt).run();

  // Schedule nudge email for 24h from now
  const sendAfter = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO nudge_emails (user_id, email, display_name, send_after, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(profile.userId, profile.email, profile.displayName, sendAfter, profile.createdAt).run();

  return profile;
```

Note: `INSERT OR IGNORE` prevents duplicates if `getOrCreateProfile` is called multiple times.

- [ ] **Step 2: Verify the worker compiles**

Run:
```bash
cd apps/worker && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: insert nudge_emails row on new profile creation"
```

---

### Task 3: Recommended Recipes Query

**Files:**
- Modify: `apps/worker/src/index.ts` (new helper function, add near other helpers around line 2810)

- [ ] **Step 1: Add `getRecommendedRecipes` helper**

Add this function after `sendEmailNotification` (after line 2811):

```typescript
async function getRecommendedRecipes(
  db: D1Database,
  userId: string,
  limit = 3
): Promise<Array<{ title: string; durationMinutes: number | null; mealTypes: string[]; imageUrl: string }>> {
  // Try preference-matched recipes first
  const profile = await db.prepare(
    'SELECT dietary_prefs, cuisine_prefs, meal_type_prefs FROM profiles WHERE user_id = ?'
  ).bind(userId).first();

  if (profile) {
    const allPrefs: string[] = [];
    for (const col of ['dietary_prefs', 'cuisine_prefs', 'meal_type_prefs'] as const) {
      try {
        const parsed = profile[col] ? JSON.parse(profile[col] as string) : [];
        if (Array.isArray(parsed)) allPrefs.push(...parsed);
      } catch { /* skip */ }
    }
    const validPrefs = allPrefs.filter(p => p && p !== 'None / all good');

    if (validPrefs.length > 0) {
      const likeClauses = validPrefs.map(() => '(r.meal_types LIKE ? OR r.ingredients LIKE ?)').join(' OR ');
      const likeBinds = validPrefs.flatMap(pref => [`%${pref}%`, `%${pref}%`]);
      const rows = await db.prepare(
        `SELECT title, duration_minutes, meal_types, image_url FROM recipes r
         WHERE r.user_id != ? AND r.shared_with_friends = 1 AND (${likeClauses})
         ORDER BY RANDOM() LIMIT ?`
      ).bind(userId, ...likeBinds, limit).all();

      if (rows.results.length > 0) {
        return rows.results.map((r: Record<string, unknown>) => ({
          title: String(r.title),
          durationMinutes: r.duration_minutes as number | null,
          mealTypes: (() => { try { return JSON.parse(r.meal_types as string); } catch { return []; } })(),
          imageUrl: String(r.image_url || ''),
        }));
      }
    }
  }

  // Fallback: curated community recipes
  const fallback = await getTrendingRecipes(db);
  const shuffled = fallback.sort(() => Math.random() - 0.5).slice(0, limit);
  return shuffled.map(r => ({
    title: r.title,
    durationMinutes: r.durationMinutes,
    mealTypes: r.mealTypes,
    imageUrl: r.imageUrl,
  }));
}
```

- [ ] **Step 2: Verify the worker compiles**

Run:
```bash
cd apps/worker && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: add getRecommendedRecipes helper for nudge email"
```

---

### Task 4: Email HTML Builder

**Files:**
- Modify: `apps/worker/src/index.ts` (new function, add after `getRecommendedRecipes`)

- [ ] **Step 1: Add `buildNudgeEmailHtml` function**

```typescript
function buildNudgeEmailHtml(
  displayName: string,
  recipes: Array<{ title: string; durationMinutes: number | null; mealTypes: string[]; imageUrl: string }>,
  gifUrl: string | null
): string {
  const recipeCardsHtml = recipes.map(r => {
    const tag = r.mealTypes[0] || 'Recipe';
    const duration = r.durationMinutes ? `${r.durationMinutes} min` : '';
    const label = [duration, tag].filter(Boolean).join(' · ');
    const imgHtml = r.imageUrl
      ? `<img src="${r.imageUrl}" alt="${r.title}" style="width:100%;height:80px;object-fit:cover;" />`
      : `<div style="background:#f0e6d6;height:80px;display:flex;align-items:center;justify-content:center;font-size:32px;">🍽️</div>`;
    return `<div style="flex:1;border:1px solid #eee;border-radius:10px;overflow:hidden;">
      ${imgHtml}
      <div style="padding:10px;">
        <div style="font-size:13px;font-weight:600;color:#1a1a1a;">${r.title}</div>
        <div style="font-size:11px;color:#888;margin-top:4px;">${label}</div>
      </div>
    </div>`;
  }).join('');

  const gifSection = gifUrl
    ? `<div style="padding:0 24px 8px;">
        <div style="border-radius:12px;overflow:hidden;border:1px solid #eee;">
          <img src="${gifUrl}" alt="How to save a recipe" style="width:100%;display:block;" />
        </div>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#fff;">

  <div style="background:linear-gradient(135deg,#FF6B35,#FF8C42);padding:32px 24px;text-align:center;">
    <div style="font-size:28px;font-weight:700;color:#fff;">🍳 ReciFind</div>
    <div style="color:rgba(255,255,255,0.9);margin-top:8px;font-size:15px;">Your personal recipe collection</div>
  </div>

  <div style="padding:32px 24px 16px;">
    <div style="font-size:22px;font-weight:700;color:#1a1a1a;">Hey ${displayName}! 👋</div>
    <p style="color:#555;font-size:15px;line-height:1.6;margin-top:12px;">
      Welcome to ReciFind! You haven't saved your first recipe yet. It only takes a few seconds — here's how:
    </p>
  </div>

  ${gifSection}

  <div style="padding:16px 24px 8px;">
    <div style="display:flex;gap:16px;justify-content:center;">
      <div style="text-align:center;">
        <div style="background:#FF6B35;color:#fff;border-radius:50%;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">1</div>
        <div style="color:#555;font-size:12px;margin-top:6px;">Find a recipe<br>online</div>
      </div>
      <div style="color:#ddd;display:flex;align-items:center;font-size:18px;">→</div>
      <div style="text-align:center;">
        <div style="background:#FF6B35;color:#fff;border-radius:50%;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">2</div>
        <div style="color:#555;font-size:12px;margin-top:6px;">Paste the<br>URL</div>
      </div>
      <div style="color:#ddd;display:flex;align-items:center;font-size:18px;">→</div>
      <div style="text-align:center;">
        <div style="background:#FF6B35;color:#fff;border-radius:50%;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">3</div>
        <div style="color:#555;font-size:12px;margin-top:6px;">We auto-fill<br>everything!</div>
      </div>
    </div>
  </div>

  <div style="text-align:center;padding:20px 24px 32px;">
    <a href="https://recifind.elisawidjaja.com/?action=add-recipe" style="display:inline-block;background:#FF6B35;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:16px;font-weight:700;">Save Your First Recipe →</a>
  </div>

  <div style="border-top:1px solid #eee;margin:0 24px;"></div>

  <div style="padding:32px 24px 16px;">
    <div style="font-size:18px;font-weight:700;color:#1a1a1a;">Recommended for you</div>
    <p style="color:#888;font-size:13px;margin-top:4px;">${recipes.length > 0 && recipes[0].mealTypes.length > 0 ? 'Based on your preferences' : 'Popular in the community'}</p>
  </div>

  <div style="padding:0 24px 24px;display:flex;gap:12px;">
    ${recipeCardsHtml}
  </div>

  <div style="border-top:1px solid #eee;margin:0 24px;"></div>

  <div style="padding:32px 24px;">
    <div style="background:linear-gradient(135deg,#667eea,#764ba2);border-radius:12px;padding:24px;text-align:center;color:#fff;">
      <div style="font-size:24px;margin-bottom:8px;">🎁</div>
      <div style="font-size:18px;font-weight:700;">Invite friends, earn rewards!</div>
      <p style="font-size:14px;opacity:0.9;margin:12px 0 16px;line-height:1.5;">
        Invite 5 friends and when each friend adds 5 recipes, you'll earn a <strong>gift card</strong> and a <strong>mystery goody bag</strong>!
      </p>
      <a href="https://recifind.elisawidjaja.com" style="display:inline-block;background:#fff;color:#764ba2;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;">Invite Friends →</a>
    </div>
  </div>

  <div style="background:#f9f9f9;padding:24px;text-align:center;border-top:1px solid #eee;">
    <div style="color:#999;font-size:12px;line-height:1.6;">
      You're receiving this because you signed up for ReciFind.<br>
      <a href="https://recifind-worker.elisawidjaja.workers.dev/unsubscribe?userId=__USER_ID__&token=__TOKEN__" style="color:#999;">Unsubscribe</a>
    </div>
  </div>

</div>
</body>
</html>`;
}
```

Note: The `__USER_ID__` and `__TOKEN__` placeholders get replaced by the caller (cron handler or test endpoint) with actual values.

- [ ] **Step 2: Verify the worker compiles**

Run:
```bash
cd apps/worker && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: add buildNudgeEmailHtml for onboarding nudge"
```

---

### Task 5: Unsubscribe Endpoint

**Files:**
- Modify: `apps/worker/src/index.ts` (new route + helper)

- [ ] **Step 1: Add HMAC helper functions**

Add near the top of the helpers section (after `sendEmailNotification`):

```typescript
async function computeHmac(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function buildUnsubscribeUrl(baseUrl: string, userId: string, token: string): string {
  return `${baseUrl}/unsubscribe?userId=${encodeURIComponent(userId)}&token=${token}`;
}
```

- [ ] **Step 2: Add unsubscribe route**

In the `fetch` handler, add this route among the public endpoints (after the `/feedback` route, around line 290):

```typescript
      // Unsubscribe from emails
      if (url.pathname === '/unsubscribe' && request.method === 'GET') {
        return await (async () => {
          const userId = url.searchParams.get('userId');
          const token = url.searchParams.get('token');
          if (!userId || !token) {
            return new Response('Invalid unsubscribe link.', { status: 400, headers: { 'Content-Type': 'text/html' } });
          }
          const secret = env.DEV_API_KEY || 'recifind-unsubscribe';
          const expected = await computeHmac(secret, userId);
          if (token !== expected) {
            return new Response('Invalid unsubscribe link.', { status: 403, headers: { 'Content-Type': 'text/html' } });
          }
          await env.DB.prepare('UPDATE profiles SET email_opt_out = 1 WHERE user_id = ?').bind(userId).run();
          return new Response(
            '<html><body style="font-family:sans-serif;text-align:center;padding:60px;"><h2>You\'ve been unsubscribed</h2><p>You won\'t receive any more emails from ReciFind.</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } }
          );
        })();
      }
```

- [ ] **Step 3: Verify the worker compiles**

Run:
```bash
cd apps/worker && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: add /unsubscribe endpoint with HMAC verification"
```

---

### Task 6: Test Nudge Email Endpoint

**Files:**
- Modify: `apps/worker/src/index.ts` (new route)

- [ ] **Step 1: Add the test endpoint route**

In the `fetch` handler, add this after the unsubscribe route:

```typescript
      // Admin: send test nudge email
      if (url.pathname === '/admin/test-nudge-email' && request.method === 'POST') {
        return await (async () => {
          const authHeader = request.headers.get('Authorization');
          const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
          if (!env.DEV_API_KEY || apiKey !== env.DEV_API_KEY) {
            return json({ error: 'Unauthorized' }, 401, withCors());
          }

          const toEmail = url.searchParams.get('to');
          if (!toEmail) {
            return json({ error: 'Missing ?to= query param' }, 400, withCors());
          }

          const userId = url.searchParams.get('userId') || 'test-user';
          let displayName = 'Test User';
          let profileUserId = userId;

          // Try to load real profile if userId provided
          if (userId !== 'test-user') {
            const row = await env.DB.prepare('SELECT display_name FROM profiles WHERE user_id = ?').bind(userId).first();
            if (row) displayName = row.display_name as string;
            profileUserId = userId;
          }

          const recipes = await getRecommendedRecipes(env.DB, profileUserId);
          const gifUrl: string | null = null; // Will be set after GIF is uploaded to Supabase

          const secret = env.DEV_API_KEY || 'recifind-unsubscribe';
          const unsubToken = await computeHmac(secret, profileUserId);
          let html = buildNudgeEmailHtml(displayName, recipes, gifUrl);
          html = html.replace('__USER_ID__', encodeURIComponent(profileUserId));
          html = html.replace('__TOKEN__', unsubToken);

          await sendEmailNotification(
            env,
            toEmail,
            `Your recipes are waiting, ${displayName}!`,
            html
          );

          return json({ ok: true, sentTo: toEmail, recipesIncluded: recipes.length }, 200, withCors());
        })();
      }
```

- [ ] **Step 2: Verify the worker compiles**

Run:
```bash
cd apps/worker && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Test by sending to Elisa's email**

Deploy the worker and send a test:
```bash
cd apps/worker && npx wrangler deploy
```

Then:
```bash
curl -X POST "https://recifind-worker.elisawidjaja.workers.dev/admin/test-nudge-email?to=elisa.widjaja@gmail.com" \
  -H "Authorization: Bearer YOUR_DEV_API_KEY"
```
Expected: `{"ok":true,"sentTo":"elisa.widjaja@gmail.com","recipesIncluded":3}`

Check inbox for the email.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: add POST /admin/test-nudge-email endpoint"
```

---

### Task 7: Cron Handler — Scheduled Nudge Sender

**Files:**
- Modify: `apps/worker/src/index.ts` (add `scheduled` export)
- Modify: `apps/worker/wrangler.toml` (add cron trigger)

- [ ] **Step 1: Add cron config to wrangler.toml**

Append to `apps/worker/wrangler.toml`:

```toml

[triggers]
crons = ["0 * * * *"]
```

- [ ] **Step 2: Add the `scheduled` handler to the default export**

In `apps/worker/src/index.ts`, the `export default` object (line 211) currently has only `fetch`. Add `scheduled` alongside it:

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // ... existing fetch handler ...
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date().toISOString();
    const BATCH_SIZE = 20;

    // Find due nudge emails
    const rows = await env.DB.prepare(
      `SELECT n.user_id, n.email, n.display_name
       FROM nudge_emails n
       JOIN profiles p ON p.user_id = n.user_id
       WHERE n.send_after <= ? AND n.sent = 0 AND p.email_opt_out = 0
       LIMIT ?`
    ).bind(now, BATCH_SIZE).all();

    for (const row of rows.results) {
      const userId = row.user_id as string;
      const email = row.email as string;
      const displayName = row.display_name as string;

      // Check if user has saved any recipes
      const countResult = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM recipes WHERE user_id = ?'
      ).bind(userId).first();
      const recipeCount = (countResult?.cnt as number) || 0;

      if (recipeCount > 0) {
        // User already active — skip
        await env.DB.prepare(
          'UPDATE nudge_emails SET sent = 2, sent_at = ? WHERE user_id = ?'
        ).bind(now, userId).run();
        continue;
      }

      // Build and send the nudge email
      const recipes = await getRecommendedRecipes(env.DB, userId);
      const gifUrl: string | null = null; // Set after GIF upload

      const secret = env.DEV_API_KEY || 'recifind-unsubscribe';
      const unsubToken = await computeHmac(secret, userId);
      let html = buildNudgeEmailHtml(displayName, recipes, gifUrl);
      html = html.replace('__USER_ID__', encodeURIComponent(userId));
      html = html.replace('__TOKEN__', unsubToken);

      await sendEmailNotification(
        env,
        email,
        `Your recipes are waiting, ${displayName}!`,
        html
      );

      await env.DB.prepare(
        'UPDATE nudge_emails SET sent = 1, sent_at = ? WHERE user_id = ?'
      ).bind(now, userId).run();
    }
  },
};
```

- [ ] **Step 3: Verify the worker compiles**

Run:
```bash
cd apps/worker && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Test the cron locally**

Run:
```bash
cd apps/worker && npx wrangler dev --port 8787
```

In another terminal, trigger the cron:
```bash
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"
```
Expected: 200 OK (may not send emails locally if no pending nudges, but should not error).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/wrangler.toml
git commit -m "feat: add hourly cron trigger for onboarding nudge emails"
```

---

### Task 8: Deploy & Send Test Email

- [ ] **Step 1: Deploy worker**

```bash
cd apps/worker && npx wrangler deploy
```
Expected: successful deploy with cron trigger registered.

- [ ] **Step 2: Send test email to Elisa**

```bash
curl -X POST "https://recifind-worker.elisawidjaja.workers.dev/admin/test-nudge-email?to=elisa.widjaja@gmail.com" \
  -H "Authorization: Bearer YOUR_DEV_API_KEY"
```

Check inbox. Verify:
- Subject line is correct
- Display name shows
- 3 recipe cards render
- "Save Your First Recipe" CTA links to `recifind.elisawidjaja.com/?action=add-recipe`
- "Invite Friends" button links to the app
- Unsubscribe link works (click it, verify page shows, check DB for `email_opt_out = 1`, then reset it back to 0)

- [ ] **Step 3: Commit any fixes from testing**

---

### Task 9: GIF Conversion & Upload (Manual)

This task requires ffmpeg installed. Run in your terminal (not Claude):

- [ ] **Step 1: Install ffmpeg (requires sudo for permission fix)**

```bash
sudo chown -R $(whoami) /usr/local/Cellar /usr/local/var/homebrew
brew install ffmpeg
```

- [ ] **Step 2: Convert MP4 to GIF**

```bash
cd "/Users/elisa/Desktop/VibeCode/image assets"
ffmpeg -i "add recipe trim.mp4" -vf "fps=10,scale=540:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 add-recipe-demo.gif
```

Check the output size. If over 2MB, reduce fps or scale:
```bash
ffmpeg -i "add recipe trim.mp4" -vf "fps=8,scale=400:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 add-recipe-demo.gif
```

- [ ] **Step 3: Upload GIF to Supabase Storage**

Upload `add-recipe-demo.gif` to the `recipe-previews` bucket in Supabase Storage (via Supabase dashboard or CLI). Make it publicly accessible.

The public URL will be:
```
https://jpjuaaxwfpemecbwwthk.supabase.co/storage/v1/object/public/recipe-previews/add-recipe-demo.gif
```

- [ ] **Step 4: Update gifUrl in code**

In `apps/worker/src/index.ts`, find the two lines:
```typescript
const gifUrl: string | null = null; // Will be set after GIF is uploaded to Supabase
```
and
```typescript
const gifUrl: string | null = null; // Set after GIF upload
```

Replace both with:
```typescript
const gifUrl = 'https://jpjuaaxwfpemecbwwthk.supabase.co/storage/v1/object/public/recipe-previews/add-recipe-demo.gif';
```

- [ ] **Step 5: Deploy and re-test**

```bash
cd apps/worker && npx wrangler deploy
```

Send another test email to verify the GIF renders:
```bash
curl -X POST "https://recifind-worker.elisawidjaja.workers.dev/admin/test-nudge-email?to=elisa.widjaja@gmail.com" \
  -H "Authorization: Bearer YOUR_DEV_API_KEY"
```

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/index.ts "image assets/add-recipe-demo.gif"
git commit -m "feat: add recipe demo GIF to nudge email"
```
