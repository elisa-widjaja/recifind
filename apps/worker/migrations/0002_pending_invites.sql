CREATE TABLE IF NOT EXISTS pending_invites (
  id TEXT PRIMARY KEY,
  inviter_user_id TEXT NOT NULL,
  inviter_email TEXT NOT NULL,
  inviter_name TEXT,
  invited_email TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_invites_inviter ON pending_invites(inviter_user_id);
CREATE INDEX IF NOT EXISTS idx_pending_invites_email ON pending_invites(invited_email);
