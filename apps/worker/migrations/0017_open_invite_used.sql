-- 0017_open_invite_used.sql
-- Mirrors the existing production `open_invite_used` table verbatim.
-- Captured from prod recipes-db on 2026-05-17. Composite PK auto-creates the
-- only index (sqlite_autoindex); no explicit CREATE INDEX exists in prod.
CREATE TABLE IF NOT EXISTS open_invite_used (
  inviter_user_id TEXT NOT NULL,
  accepter_user_id TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (inviter_user_id, accepter_user_id)
);
