CREATE TABLE IF NOT EXISTS device_tokens (
  user_id TEXT NOT NULL,
  apns_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, apns_token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
