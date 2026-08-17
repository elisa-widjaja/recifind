# Founding Chef Referral Program — Design

**Date:** 2026-08-14
**Status:** Approved design, pending spec review
**Follow-up project (separate spec):** Public chef page (`recifriend.com/chef/{name}`) as early-access perk

## Problem

129 users, but only 37 (29%) have any friend. The most active users (5 of the top 7, saving 20-40+ recipes/month) have zero friends: they arrived organically via the App Store, use ReciFriend as a solo recipe box, and have never sent an invite. The invite loop works when it fires (32 open invites created, 42 redemptions, henny.ramali's 9-friend cluster) but never fires for organic users.

## Goal

Get heavy solo users to invite their own friends by (a) nudging them in-app and (b) rewarding real network growth with a gift card plus a permanent in-app badge.

## Program rules

- **Milestone:** 3 invited friends who are NEW signups to ReciFriend, each of whom saves 5+ recipes (lifetime count, no deadline, `hidden_at IS NULL`).
- **Reward:** a gift card of the winner's choice (fulfilled manually by Elisa) + permanent "Founding Chef" badge in-app.
- **What counts as a referred new signup:** the friend's profile was created within 48 hours BEFORE the friendship/attribution timestamp. Existing users who click a friend's invite link do not count.
- **Both invite channels count:** open-invite share links AND email invites.
- **Retroactive:** yes. Historical referrals count, including backfilled ones (see Backfill). Verified 2026-08-14: no one instantly qualifies. Head starts: nruebner 1/3 qualified; henny.ramali 3 new-signup friends, 0 qualified yet; mindy@robertbecker.com and alexaabigail.wo 1/3 qualified.
- **Excluded from earning:** `METRICS_EXCLUDED_EMAILS` (owner/test accounts) in `apps/worker/src/routes/admin.ts`.

## Data model (migration 0021, idempotent, applied via `wrangler d1 execute --remote`; 0020 is taken by clear_relay_gibberish_names)

- `ALTER TABLE profiles ADD COLUMN founding_chef_at TEXT` — badge grant timestamp; rides existing profile reads so all surfaces can render the badge without new joins.
- `ALTER TABLE profiles ADD COLUMN referral_promo_at TEXT` — dedup for the one-time solo-user nudge (notifications are trimmed to 50/user and cannot serve as a durable dedup record).
- `CREATE TABLE referral_rewards (user_id TEXT PRIMARY KEY, granted_at TEXT NOT NULL, admin_emailed_at TEXT)` — grant/fulfillment record. `admin_emailed_at IS NULL` means the admin alert email has not succeeded; the cron retries it on later ticks.
- No changes to `open_invite_used` (existing attribution ledger: inviter_user_id, accepter_user_id, accepted_at; survives unfriending).

D1 free-tier impact: negligible. Cron reads a few hundred rows once daily; writes only on grant/nudge events (at most ~20/day by cap).

## Attribution fixes (worker)

1. **Email-invite paths write the ledger.** `handleAcceptInvite` (apps/worker/src/index.ts ~4059) and `handleCheckInvites` (~4097) currently delete the `pending_invites` row and leave no durable attribution. Both will additionally `INSERT OR IGNORE INTO open_invite_used (inviter_user_id, accepter_user_id, accepted_at)` before the delete, using `pending_invites.inviter_user_id`.
2. **New-signup test is computed at query time, not stored:** `julianday(accepted_at) - julianday(accepter_profile.created_at) BETWEEN 0 AND 2`.

## One-time backfill (old invites count)

Recover attribution destroyed by the email-invite path (and pre-migration-0017 accepts) from the `friends` table:

```sql
INSERT OR IGNORE INTO open_invite_used (inviter_user_id, accepter_user_id, accepted_at)
SELECT f.user_id, f.friend_id, f.connected_at
FROM friends f
JOIN profiles ip ON ip.user_id = f.user_id
JOIN profiles ap ON ap.user_id = f.friend_id
WHERE julianday(f.connected_at) - julianday(ap.created_at) BETWEEN 0 AND 2
  AND julianday(ap.created_at) - julianday(ip.created_at) > 2;
```

Heuristic: the newer account connected within 48h of its own creation, and the "inviter" account is more than 48h older, so the older account almost certainly caused the signup. Conservative by design: friendships between two established users, or two users who signed up together, are never classified as referrals. Previewed 2026-08-14: adds exactly 5 rows (listed above under Retroactive). Run once against prod as part of the migration step; idempotent via `INSERT OR IGNORE`.

## Reward engine (daily cron)

New branch in the existing scheduled handler, firing on its own daily tick at 17:00 UTC (clear of the 16:00 nudge-email tick).

**Qualification query:** `open_invite_used` JOIN accepter profiles (48h new-signup test) JOIN per-accepter recipe counts (`hidden_at IS NULL`), grouped by inviter, `HAVING COUNT(qualified) >= 3`, LEFT JOIN `referral_rewards` to skip prior winners, exclude `METRICS_EXCLUDED_EMAILS` and deleted profiles.

**Per new winner, in order:**
1. `INSERT INTO referral_rewards (user_id, granted_at)` (idempotency anchor).
2. `UPDATE profiles SET founding_chef_at = <now>`.
3. `addNotification(type 'reward_granted')` + push, message: "You earned the Founding Chef badge! Elisa will reach out about your gift card."
4. Email elisa.widjaja@gmail.com via `sendEmailNotification` (same pattern as the `/feedback` endpoint, `ctx.waitUntil`): winner's display name + email + the qualified friends with their save counts. On success set `admin_emailed_at`; if it fails, the next tick retries the email for any row where `admin_emailed_at IS NULL` (grant is NOT re-run).

The `notifications.type` TS union gains `'reward_granted'`. Frontend notification renderer gets a case for it.

## Progress API

`GET /friends/referral-progress` (authed) returns:

```json
{
  "threshold": { "friends": 3, "recipes": 5 },
  "friends": [ { "name": "Ana", "savesCount": 3, "qualified": false } ],
  "qualifiedCount": 1,
  "foundingChefAt": null
}
```

Only friends passing the new-signup test appear. `savesCount` is capped at 5 in the response (progress display does not need exact large counts). Called when the Friends tab or AddFriendDrawer opens; a handful of D1 reads per call, no quota concern at current traffic.

## Frontend UI

**Program card** (one component, rendered in `AddFriendDrawer` and on the Friends tab):
- Pre-referral state, headline copy: "Invite 3 friends who each save 5 recipes and earn a gift card." (empty progress slots read "Invite a friend")
- In-progress state: three slots that fill as friends qualify, with per-friend progress lines such as "Ana: 3 of 5 recipes".
- Hidden once `foundingChefAt` is set.
- Copy rule: no em dashes in any user-facing text.

**Badge rendering** (greenfield, phase one only):
- "Founding Chef" chip with the reward icon (`image assets/Awards icon/reward.png`, exported to an app asset) on the profile page.
- Small corner icon on the avatar in the friends drawer.
- Small corner icon on the header avatar of the friend drawer (the Recipes/Friends tabs view); `foundingChefAt` rides the `/users/{id}/friend-view-stats` response so it shows regardless of which surface opened the drawer.
- `founding_chef_at` flows through existing live profile resolution (index.ts ~2574), so feed/discovery surfaces can adopt the badge later without schema changes.

## Solo-user nudge

Same 17:00 UTC cron tick: users with >= 10 recipes, 0 friends, `referral_promo_at IS NULL`, not excluded, not deleted, get a one-time in-app notification + push: "Your recipe collection is getting serious. Invite friends who cook and earn a gift card on us." Deep-links to the Friends tab (program card explains the rules). Set `referral_promo_at` after sending. Capped at 20/day. Roughly 10 users qualify today.

A one-off launch email to current heavy solo users is a possible manual follow-up, decided and sent separately; not part of this build.

## Fulfillment (manual)

The admin email is the fulfillment trigger. Elisa replies to the winner personally to ask which gift card they want and delivers it (digital delivery by email works, so no shipping info needed). No in-app address collection (privacy + unnecessary at ~10-user scale).

## Rollout plan

1. Implement worker + frontend; vitest green.
2. Apply migration 0021 + backfill to prod D1 (additive, no behavior change until code ships).
3. Deploy worker to DEV (`npx wrangler deploy --env dev`, api-dev.recifriend.com) and run frontend on the dev stack (Vite :5173 + `cloudflared tunnel run recifind-dev`, dev.recifriend.com).
4. **User review gate: Elisa reviews the design live on dev (web) AND in the Xcode dev build on iOS before anything ships to prod.**
5. Smoke-test recipe parse + enrich (import-protection rule) before the prod worker deploy.
6. Prod deploys (worker + Pages) only after explicit approval. `git status` check before deploy (working-tree rule). iOS badge/card ships with the next App Store build (CFBundleVersion 35+, MARKETING_VERSION 1.1.3+).

## Testing

- Vitest: cron qualification (48h rule, exclusion list, >= 3 threshold, idempotent re-runs, deleted-profile exclusion), admin-email retry via `admin_emailed_at`, attribution writes on both email-invite accept paths, progress endpoint shape, solo-nudge dedup via `referral_promo_at`.
- Manual on dev: full flow with a test invite (create invite as user A on dev, redeem as fresh user B, save 5 recipes, force-run cron tick, verify badge + notification + admin email).

## Out of scope

- Public chef page (separate follow-up spec).
- Google Contacts import (per product strategy).
- Time window on the friend's 5 saves (slow activation still counts).
- Multiple reward tiers, additional badges, save-time milestone checks.
