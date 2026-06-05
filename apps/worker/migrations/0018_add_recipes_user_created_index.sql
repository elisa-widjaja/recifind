-- Serves the user's own paginated recipe list:
--   SELECT * FROM recipes WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
-- and the "friends recently saved" family:
--   SELECT ... FROM recipes WHERE user_id = ? AND shared_with_friends = 1
--     AND hidden_at IS NULL ORDER BY created_at DESC LIMIT ?
--
-- These run constantly and scale with every user. The existing
-- idx_recipes_user_source_created (user_id, source_url, created_at DESC) cannot
-- serve them: source_url sits between user_id and created_at, so SQLite can't
-- use it to satisfy the ORDER BY created_at after a plain user_id filter, and
-- falls back to reading all of the user's rows then sorting (24h insights showed
-- this query at ~0.5 efficiency — ~2x rows read vs returned). This index makes
-- the user_id seek + created_at order an index-only range scan.

CREATE INDEX IF NOT EXISTS idx_recipes_user_created
ON recipes (user_id, created_at DESC);
