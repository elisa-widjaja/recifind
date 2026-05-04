-- 0014_add_recipes_cuisines.sql
-- Adds a cuisines column (JSON array of strings) so recipes can be tagged by
-- cuisine type (italian, mexican, chinese, etc.) the same way they're tagged
-- by meal_types. Auto-populated by Gemini at extract time; user-editable in
-- the recipe detail edit mode; filterable in the Recipes page filter sheet.
-- Legacy rows default to '[]' (no cuisines).

ALTER TABLE recipes ADD COLUMN cuisines TEXT DEFAULT '[]';
