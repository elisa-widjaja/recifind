CREATE TABLE IF NOT EXISTS recipe_shares (
  id TEXT PRIMARY KEY,
  sharer_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen_at INTEGER,
  UNIQUE (sharer_id, recipient_id, recipe_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_shares_recipient
  ON recipe_shares(recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recipe_shares_sharer
  ON recipe_shares(sharer_id, created_at DESC);
