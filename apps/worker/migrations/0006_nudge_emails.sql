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
