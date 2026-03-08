CREATE TABLE IF NOT EXISTS open_invites (
  token TEXT PRIMARY KEY,
  inviter_user_id TEXT NOT NULL,
  inviter_name TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_open_invites_inviter ON open_invites(inviter_user_id);
