-- Cook mode event tracking
CREATE TABLE IF NOT EXISTS cook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  cooked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cook_events_user ON cook_events(user_id);
CREATE INDEX IF NOT EXISTS idx_cook_events_recipe ON cook_events(recipe_id);

-- User onboarding preferences (added to profiles)
ALTER TABLE profiles ADD COLUMN meal_type_prefs TEXT;
ALTER TABLE profiles ADD COLUMN dietary_prefs TEXT;
ALTER TABLE profiles ADD COLUMN skill_level TEXT;
