-- Server-side favorites. Until now favorites lived only in browser localStorage
-- (`recifriend-favorites`). Adding this column lets us sync them across devices
-- and feed Editor's Picks from Elisa's curated favorites.
ALTER TABLE recipes ADD COLUMN is_favorite INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_recipes_user_favorite
  ON recipes(user_id, is_favorite);
