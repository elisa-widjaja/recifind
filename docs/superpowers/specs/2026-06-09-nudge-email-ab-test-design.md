# Nudge Email A/B Test (v1 vs v2) + Founder Module — Design

Date: 2026-06-09
Status: APPROVED design (pending user review of this doc). Next step: writing-plans.

## Goal

Re-engage signed-up, 0-recipe users (the dead-cold cohort: ~46/50 nudged users
never saved) and lift activation (first recipe save). Two levers:
1. **A/B test two nudge-email hooks** so we learn which framing drives more first
   saves, with a kill switch to roll back to v1.
2. **Replace the premature "invite friends, earn rewards" module** (a huge ask for a
   user who has not saved anything) with a **founder module**: a few of the founder's
   real, saveable recipes plus a soft "Connect with Elisa" action. This adds saveable
   content, warms the social cold-start, and feeds the seed-conversion metric.

## Decisions (locked in brainstorm)

1. **Two variants, isolated to the hook.** Both v1 and v2 carry the SAME founder
   module (invite-rewards module removed from both), so the only difference is the
   hook/hero treatment. A v2 win is therefore unambiguously about the hook.
   - **v1** = original instructional hook (subject "Your recipes are waiting, {name}!";
     "you haven't saved yet, here's how" + 3-step how-to + "Save Your First Recipe" CTA
     to /discover + "Recommended for you" grid) + founder module. Rollback target.
   - **v2** = desire-led hero hook (below) + founder module.
2. **Audience = both** the re-queued dead-cold cohort AND new signups going forward;
   same assignment/measurement machinery serves both.
3. **Split + rollback via one env knob** `NUDGE_V2_PCT` (0-100, default 0):
   percent of sends that get v2. `0` = all v1 (rollback), `50` = even split, `100` =
   all v2. The existing `NUDGE_EMAILS_ENABLED` master kill switch is unchanged.
4. **Deterministic assignment** by hashing `user_id` to a 0-99 bucket; bucket <
   `NUDGE_V2_PCT` -> v2, else v1. Stable, reproducible, no RNG.
5. **Founder module copy is fixed** (below); the founder recipe cards are her
   **favorites**, not a random repeat of the "Recommended for you" grid. Important
   grounding: `getRecommendedRecipes` already pulls from the founder/curator account
   `EDITORS_PICK_USER_ID = '8e4dfd5e-...'` (== `elisa.widjaja@gmail.com`, the
   `SEEDED_SUGGESTIONS` founder) across her WHOLE shared collection at random;
   `getEditorsPick` pulls the same account filtered to `is_favorite = 1` (rotated
   weekly). So the founder module reuses **`getEditorsPick(db)`** for distinct,
   curated content and uses `EDITORS_PICK_USER_ID` as the founder id for the connect
   link. Dedupe against whatever the email already shows so no card repeats.

## v2 email copy (desire-led hero)

- **Subject:** `Worth saving tonight, {name} 🍴` (fallback when no recommended recipe
  exists: `Your next favorite recipe, {name} 🍴`).
- **Preview/preheader text:** `One tap saves it: ingredients, steps, and cook mode included.`
- **Header band:** same purple "🍳 ReciFriend / Your personal recipe collection" as v1.
- **Hook line** (replaces v1's "you haven't saved yet, here's how" + 3-step block):
  > Hey {name}, one good recipe to get you started.
- **Hero recipe** = top recommended pick (`recipes[0]`): large image, title, `{duration · mealType}`,
  and a prominent button **`Save this recipe →`** linking to that recipe's detail
  (`https://recifriend.com/recipes/{id}?user={userId}`, where one-tap Save lives).
- **Under the hero:**
  > One tap and it's yours: ingredients, steps, and hands-free cook mode, ready whenever
  > you cook. That first save is where ReciFriend clicks.
- **"More picks for you":** a small grid of the next up-to-4 recommended recipes
  (`recipes[1..4]`), each linking to its own detail. Button **`Browse more recipes →`**
  -> `https://recifriend.com/discover`.
- **Founder module** (shared, below).
- **Footer:** unsubscribe (same as v1).

If `recipes` is empty, v2 degrades to: header + hook line + the "Browse more recipes"
CTA + founder module (no hero/grid).

## Founder module (shared by v1 and v2)

Replaces the existing "Invite friends, earn rewards" `<div>` block at the bottom of
both emails.

- **Heading:** `Recipes from the founder`
- **Body:**
  > Hi, I'm Elisa. I built ReciFriend on nights and weekends to fix my own messy recipe
  > situation. Here are a few of mine to start you off.
- **Founder recipe cards:** up to 3 of the founder's **favorites**, sourced by reusing
  `getEditorsPick(db)` (her `is_favorite = 1` recipes, already clean-filtered and
  weekly-rotated), **deduped** against the recipe ids the email already shows (the v2
  hero + the recommended grid, or v1's recommended grid) so no card repeats. Map each
  to the same card shape/style as the "Recommended for you" grid and link to its detail
  (`https://recifriend.com/recipes/{id}?user={userId}`, saveable).
- **Soft secondary CTA:** **`Connect with Elisa →`** -> `https://recifriend.com/?add_friend={EDITORS_PICK_USER_ID}`
  (the deep link below). Framed soft; no promise of instant connection (the founder
  does not auto-accept).
- If there are 0 founder favorites left after dedupe, omit the cards but keep the
  heading, body, and Connect CTA.

## "Connect with Elisa" deep link (frontend)

A new `?add_friend={userId}` deep link in `apps/recipe-ui/src/App.jsx`, mirroring the
existing `accept_friend` capture pattern (module-load capture -> sessionStorage ->
fire after auth):
- On load, capture `add_friend`, strip it from the URL.
- If logged in: `POST /friends/request { userId }`; show a generic success toast
  `Friend request sent! 💛` (the handler accepts any userId, so it must NOT hardcode
  the founder's name). If the request already exists / is already a friend (non-5xx),
  treat as benign info (`You're already connected.`) — idempotent UX.
- If logged out: stash in sessionStorage and fire after sign-in (same as `accept_friend`).
- This is generic (`add_friend={anyUserId}`) and also feeds the seed-conversion metric
  (a request to the founder shows up there). No founder-specific hardcoding in the URL
  handler; the founder id is filled in by the email builder.

## Variant assignment + tracking

- **Schema:** add a nullable `variant TEXT` column to `nudge_emails`
  (`ALTER TABLE nudge_emails ADD COLUMN variant TEXT`). Applied as a manual remote D1
  op (`wrangler d1 execute --remote`), consistent with this project's manual-migration
  policy. Historical rows keep `variant = NULL` and are EXCLUDED from the A/B metric.
- **Assignment (cron, in the send loop, only for rows that will actually be sent):**
  1. Fetch the founder favorites once per cron run via `getEditorsPick(env.DB)` (reused
     across recipients); the founder id is `EDITORS_PICK_USER_ID`.
  2. For each 0-recipe recipient: `const variant = (await bucketForUser(userId)) < v2Pct ? 'v2' : 'v1'` where
     `v2Pct = clamp(parseInt(env.NUDGE_V2_PCT ?? '0', 10) || 0, 0, 100)`.
  3. Per recipient: build the founder module HTML by deduping the founder favorites
     against the recipe ids this email already shows (v2: hero + recommended grid; v1:
     recommended grid), taking up to 3; then build the email with `buildNudgeEmailHtml`
     (v1) or `buildNudgeEmailHtmlV2` (v2), injecting the founder module HTML.
  4. On send, record the variant: `UPDATE nudge_emails SET sent = 1, sent_at = ?, variant = ? WHERE user_id = ?`.
- **`bucketForUser(userId): Promise<number>`** — SHA-256 the `user_id`, take the first 4
  bytes as a uint32, `% 100`. Deterministic, well-distributed, no RNG.

## Re-queue the dead-cold cohort (admin endpoint)

`POST /admin/nudge/requeue`, admin-gated (same `requireAdmin` pattern as the metrics
routes). Resets eligible rows so the cron re-sends them with a variant:
```sql
UPDATE nudge_emails
SET sent = 0, sent_at = NULL, variant = NULL, send_after = ?   -- now
WHERE sent = 1
  AND user_id NOT IN (SELECT DISTINCT user_id FROM recipes)   -- still 0-recipe only
```
Returns `{ requeued: <count> }`. Still-0-recipe filter prevents re-nudging anyone who
has since activated; the cron additionally re-checks recipe count and opt-out at send
time (marks `sent = 2` if now active). One-shot, idempotent (re-running re-queues the
same still-dead-cold set).

## Measurement (admin endpoint)

`GET /admin/metrics/nudge-ab`, admin-gated. Per variant (`v1`, `v2`) and totals:
- **sent** = `COUNT(*)` of `nudge_emails` rows with that explicit variant, `sent = 1`,
  excluding owner/test rows (`email NOT IN METRICS_EXCLUDED_EMAILS`).
- **activated** = of those, how many saved >= 1 recipe AFTER the nudge: `EXISTS (SELECT
  1 FROM recipes r WHERE r.user_id = n.user_id AND r.created_at >= n.sent_at)`.
- **rate** = `activated / sent` (0 when sent = 0), rounded to 3 dp.
- **Only explicit-variant rows count** (`variant IN ('v1','v2')`). Historical
  original-campaign sends have `variant IS NULL` and are EXCLUDED — they were a
  different email (old hook + invite-rewards module), so folding them in would pollute
  the current-campaign comparison (the un-re-queued NULL rows are precisely the original
  successes). The A/B measures only the current campaign's v1 vs v2.

Output:
```json
{
  "variants": [
    { "variant": "v1", "sent": 120, "activated": 14, "rate": 0.117 },
    { "variant": "v2", "sent": 118, "activated": 22, "rate": 0.186 }
  ],
  "totals": { "sent": 238, "activated": 36, "rate": 0.151 }
}
```
Reuses the admin metrics query-builder + handler pattern (testable `build*Query`).
Activation window = any save after `sent_at` (a fixed N-day window can be added later;
out of scope now).

## Edge cases

- `NUDGE_V2_PCT` unset or non-numeric -> treated as `0` (all v1). Clamped to [0,100].
- Founder email not resolvable / 0 public recipes -> founder module still renders
  (heading + body + Connect CTA), email still sends. Never block a send on the module.
- Re-queued user who activated since the original send -> still-0-recipe filter excludes
  them; even if a race slips through, the cron marks `sent = 2` and skips.
- A user re-queued and re-sent overwrites their prior `sent_at`/`variant` (one row per
  user). Acceptable: the original campaign was all-v1 and is over; we measure the
  current (re-engagement) send.
- `add_friend` to a user who is already a friend / already requested -> idempotent
  success UX, no error surfaced.

## Testing

- **`bucketForUser`**: deterministic (same id -> same bucket); buckets spread across
  0-99 for a sample of ids; output always in [0,100).
- **Variant selection**: `NUDGE_V2_PCT=0` -> all v1; `=100` -> all v2; `=50` -> a mixed
  sample splits roughly by bucket (assert specific ids land on the expected side given
  their known bucket).
- **`buildNudgeEmailHtmlV2`**: contains the v2 subject-independent body markers (hook
  line, hero "Save this recipe" link to the hero recipe's detail URL, "Browse more
  recipes" -> /discover) and the injected founder module; degrades gracefully with 0
  recipes.
- **`buildNudgeEmailHtml` (v1)**: still contains the original 3-step + "Save Your First
  Recipe" markers AND now the founder module; the old invite-rewards/`?add=1` block is
  gone.
- **`buildFounderModuleHtml`**: renders heading/body, up to 3 founder-favorite cards
  linking to their detail URLs, the `Connect with Elisa` CTA -> `?add_friend={EDITORS_PICK_USER_ID}`;
  excludes favorites whose id is in the passed-in "already shown" set (dedup); omits
  cards (keeps heading/body/CTA) when the deduped favorites list is empty.
- **Re-queue handler**: non-admin -> 403; admin -> resets only still-0-recipe sent=1
  rows, returns the count; does not touch rows for users with recipes.
- **nudge-ab metric**: builder SQL floors activation on `created_at >= sent_at`, counts
  only explicit-variant rows (`variant IN ('v1','v2')`, NULL historical rows excluded),
  excludes `METRICS_EXCLUDED_EMAILS`; handler returns per-variant + totals with correct
  rates and non-admin 403.
- **`add_friend` deep link** (frontend, App.jsx test): logged-in load fires
  `POST /friends/request` with the id and shows the toast; logged-out stashes and fires
  after auth.

## Out of scope

- Email open/click tracking pixels (we measure the server-side save outcome only).
- A fixed N-day activation window (any-save-after-send for now).
- A third variant or multivariate testing.
- Admin-ui dashboard widgets for the nudge-ab metric (read via the JSON endpoint).
- Auto-accept for the founder account; Phase 2 founder-initiated requests (separate track).
- Re-introducing the invite-rewards/referral module (deliberately retired from the nudge).

## Files

- `apps/worker/src/index.ts` — cron send loop (variant assignment, founder module wiring),
  `buildNudgeEmailHtml` (v1, swap invite -> founder module), new `buildNudgeEmailHtmlV2`,
  new `buildFounderModuleHtml`, new `bucketForUser`, founder-recipes query, route
  registrations for re-queue + nudge-ab; `SEEDED_SUGGESTIONS` (founder source).
- `apps/worker/src/routes/admin.ts` — `handleAdminNudgeRequeue`, `buildNudgeAbQuery`,
  `handleAdminNudgeAb`; reuse `requireAdmin`, `METRICS_EXCLUDED_EMAILS`.
- `apps/worker/wrangler.toml` — add `NUDGE_V2_PCT` to `[vars]` (default "0").
- `apps/recipe-ui/src/App.jsx` — `?add_friend={id}` deep-link capture + fire.
- D1 (manual remote): `ALTER TABLE nudge_emails ADD COLUMN variant TEXT`.
- Tests: `apps/worker/src/*.test.ts` (email builders, bucketing, handlers),
  `apps/recipe-ui/src/App` or a focused component test for the deep link.
