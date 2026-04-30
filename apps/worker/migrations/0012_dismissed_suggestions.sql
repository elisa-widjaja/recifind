-- Persist "Friends You May Know" dismissals across sessions. Once a user
-- taps the X (and confirms) on a suggestion card, the dismissed_user_id is
-- inserted here and filtered out of all future suggestion queries for that
-- user. Forever, by design — if they later want to connect, the explicit
-- Add Friend / search flow still works.
CREATE TABLE IF NOT EXISTS dismissed_suggestions (
  user_id TEXT NOT NULL,
  dismissed_user_id TEXT NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, dismissed_user_id)
);
