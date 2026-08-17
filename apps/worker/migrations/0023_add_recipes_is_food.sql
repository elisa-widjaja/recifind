-- Gemini's food-or-not verdict on the saved source content. Some users save
-- non-recipe links (workout reels, hiking trails); those stay saveable and
-- shareable, but /public/discover drops rows with is_food = 0.
-- NULL = unclassified (all legacy rows + non-enriched saves) and is treated
-- as food, so nothing existing disappears from the shelf.
ALTER TABLE recipes ADD COLUMN is_food INTEGER;
