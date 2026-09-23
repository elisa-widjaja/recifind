-- 0028_recommendation_feedback.sql
-- Per-user thumbs up / down on "Picked for you" recommendations.
-- rating: 1 = "Good pick", -1 = "Not for me". reason = the shelf caption
-- shown at the time, so feedback can be grouped by which signal drove the pick.
-- Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS recommendation_feedback (
  user_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, recipe_id)
);
CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_created ON recommendation_feedback (created_at);
