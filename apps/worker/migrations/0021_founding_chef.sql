-- 0021: Founding Chef referral program.
-- Idempotent-by-convention like other migrations here: ALTER TABLE ADD COLUMN
-- errors if re-run, which the manual apply process treats as "already applied"
-- (same as 0013/0014/0015). The INSERT and CREATE TABLE are safely re-runnable.

ALTER TABLE profiles ADD COLUMN founding_chef_at TEXT;
ALTER TABLE profiles ADD COLUMN referral_promo_at TEXT;

CREATE TABLE IF NOT EXISTS referral_rewards (
  user_id TEXT PRIMARY KEY,
  granted_at TEXT NOT NULL,
  admin_emailed_at TEXT
);

-- One-time backfill: recover invite attribution destroyed by the email-invite
-- path (and accepts predating migration 0017). Heuristic: the newer account
-- connected within 48h of its own creation AND the inviter account is >48h
-- older, so the older account almost certainly caused the signup. friends is
-- bilateral, so the WHERE clause picks exactly one direction per pair.
-- Previewed on prod 2026-08-14: adds exactly 5 rows.
INSERT OR IGNORE INTO open_invite_used (inviter_user_id, accepter_user_id, accepted_at)
SELECT f.user_id, f.friend_id, f.connected_at
FROM friends f
JOIN profiles ip ON ip.user_id = f.user_id
JOIN profiles ap ON ap.user_id = f.friend_id
WHERE julianday(f.connected_at) - julianday(ap.created_at) BETWEEN 0 AND 2
  AND julianday(ap.created_at) - julianday(ip.created_at) > 2;
