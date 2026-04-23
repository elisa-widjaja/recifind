-- Supports the 60s rapid-reshare dedup lookup in handleCreateRecipe
-- (SELECT id, created_at FROM recipes WHERE user_id = ? AND source_url = ? AND created_at >= ?).
-- Without this, the lookup scans the user's recipes and filters by source_url,
-- which regresses as users accumulate recipes.

CREATE INDEX IF NOT EXISTS idx_recipes_user_source_created
ON recipes (user_id, source_url, created_at DESC);
