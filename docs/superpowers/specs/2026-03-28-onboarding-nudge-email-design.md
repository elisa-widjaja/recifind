# Onboarding Nudge Email

**Date:** 2026-03-28
**Status:** Draft

## Overview

A "welcome + save your first recipe" email sent to new users who haven't saved any recipes ~24 hours after signup. The email includes personalized recipe recommendations from D1 based on onboarding preferences, a GIF walkthrough of the paste-a-URL flow, and an invite-friends incentive.

## Trigger

- **Event-based with delayed delivery:** At signup (profile creation in `getOrCreateProfile`), write a pending nudge row to D1 with a `send_after` timestamp (now + 24h).
- **Cron trigger:** A Cloudflare Cron Trigger runs hourly, queries for due nudge rows where `send_after <= now` and `sent = 0`, checks each user's recipe count, and sends the email if count = 0. Marks the row as sent.
- **Activation criteria:** User has zero recipes saved. If the user saved a recipe before the 24h window, the cron skips them.

## Test Mode

Before enabling the cron for real users:
- `POST /admin/test-nudge-email?to={email}` — authenticated with `DEV_API_KEY`, sends the nudge email to the specified address using a real or mock user profile.
- This lets Elisa preview the exact email in her inbox before turning on the cron.

## Email Content

**Subject:** "Your recipes are waiting, {displayName}!"

**From:** `ReciFind <notifications@recifind.elisawidjaja.com>` (existing Resend setup)

### Sections (in order)

1. **Header** — ReciFind branding with gradient background (#FF6B35 → #FF8C42)

2. **Welcome greeting** — "Hey {displayName}! 👋" + "Welcome to ReciFind! You haven't saved your first recipe yet. It only takes a few seconds — here's how:"

3. **Animated GIF demo** — Converted from `image assets/add recipe trim.mp4`. Shows the paste-URL → auto-fill → save flow. Hosted in Supabase Storage (`recipe-previews` bucket) as a static asset. Fallback: if GIF doesn't load, the 3-step text guide below still conveys the same info.

4. **3-step horizontal guide** — Condensed: "Find a recipe online → Paste the URL → We auto-fill everything!"

5. **CTA button** — "Save Your First Recipe →" linking to `https://recifind.elisawidjaja.com/?action=add-recipe` (deep-links to the add-recipe flow)

6. **Recommended for you** — 3 recipe cards from D1:
   - **With preferences:** Query recipes table matching user's `dietary_prefs`, `cuisine_prefs`, or `meal_type_prefs` (JSON LIKE matching on public/shared recipes from other users). Pick 3 at random.
   - **Without preferences (fallback):** Query trending/popular recipes — use the community recipes from `CURATED_COMMUNITY_IDS` or most-saved recipes. Pick 3.
   - Each card shows: recipe title, duration, and a tag (meal type or dietary label). Recipe image from Supabase Storage if available, emoji placeholder if not.

7. **Invite friends CTA** — Purple gradient card: "Invite friends, earn rewards! Invite 5 friends and when each friend adds 5 recipes, you'll earn a gift card and a mystery goody bag!" + "Invite Friends →" button linking to the app's invite flow.
   - Aspirational copy only — no backend tracking for reward eligibility in this version.

8. **Footer** — "You're receiving this because you signed up for ReciFind." + Unsubscribe link.

## Database Changes

### New table: `nudge_emails`

```sql
CREATE TABLE IF NOT EXISTS nudge_emails (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  send_after TEXT NOT NULL,       -- ISO timestamp (created_at + 24h)
  sent INTEGER DEFAULT 0,         -- 0 = pending, 1 = sent, 2 = skipped (user already active)
  sent_at TEXT,                    -- ISO timestamp when actually sent
  created_at TEXT NOT NULL
);
```

No new columns on `profiles` — we use a separate table to keep nudge state isolated.

## Worker Changes

### New cron trigger (same worker, `wrangler.toml`)

```toml
[triggers]
crons = ["0 * * * *"]   # Every hour
```

### New handler: `scheduled` event

In `index.ts`, export a `scheduled` handler:
1. Query `nudge_emails` for rows where `send_after <= now AND sent = 0`
2. For each row, count user's recipes in `recipes` table
3. If recipe count = 0: build email HTML, send via Resend, set `sent = 1`
4. If recipe count > 0: set `sent = 2` (skipped — user already active)
5. Batch: process up to 20 users per cron invocation to stay within Worker CPU limits

### New endpoint: `POST /admin/test-nudge-email`

- Auth: `DEV_API_KEY` only
- Query param: `to` (email address to send to)
- Optional query param: `userId` (use a real user's profile/prefs for realistic content; defaults to a mock profile)
- Builds and sends the exact same email the cron would send

### Signup hook

In `getOrCreateProfile`, after inserting a new profile row, also insert into `nudge_emails`:

```typescript
await env.DB.prepare(
  'INSERT INTO nudge_emails (user_id, email, display_name, send_after, created_at) VALUES (?, ?, ?, ?, ?)'
).bind(userId, email, displayName, sendAfter, now).run();
```

### Recommended recipes query

New helper function `getRecommendedRecipes(env, userProfile, limit = 3)`:
1. Parse user's `dietary_prefs`, `cuisine_prefs`, `meal_type_prefs` from profile
2. If prefs exist: query `recipes` where `shared_with_friends = 1` and `user_id != currentUser` with LIKE matching on `meal_types` or `ingredients` columns, ORDER BY RANDOM(), LIMIT 3
3. If no prefs or no results: fall back to `CURATED_COMMUNITY_IDS` recipes, pick 3 at random
4. Return array of `{ title, duration_minutes, meal_types, image_url }`

## GIF Asset

- Source: `image assets/add recipe trim.mp4`
- Convert with ffmpeg: `ffmpeg -i input.mp4 -vf "fps=10,scale=540:-1" -loop 0 add-recipe-demo.gif`
- Upload to Supabase Storage `recipe-previews` bucket as a public asset
- Reference in email HTML as a static URL
- Depends on ffmpeg being installed (`brew install ffmpeg` — needs permission fix first)

## Unsubscribe

For v1: the unsubscribe link sets a `email_opt_out` flag. This requires:

```sql
ALTER TABLE profiles ADD COLUMN email_opt_out INTEGER DEFAULT 0;
```

The cron and all future emails check this flag before sending. The unsubscribe link hits a `GET /unsubscribe?userId={id}&token={hmac}` endpoint that sets the flag. The HMAC is computed using `DEV_API_KEY` as the secret to prevent unauthorized unsubscribe tampering.

## Out of Scope

- Referral tracking backend (invite count, friend recipe count, reward eligibility)
- Follow-up emails (7-day, 14-day re-engagement)
- Email template engine / MJML — inline HTML is fine for now
- A/B testing subject lines
