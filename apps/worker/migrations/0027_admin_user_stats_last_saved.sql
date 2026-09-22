-- 0027_admin_user_stats_last_saved.sql
-- Adds the most recent recipe created_at per user to the denormalized admin
-- stats table. Filled by syncAdminUserStats() from the same hourly recipes
-- scan that computes recipe_count (MAX(created_at) in the existing GROUP BY),
-- so no extra reads. Shown as "Last saved" on the admin Users list.
--
-- NOT idempotent: SQLite has no ADD COLUMN IF NOT EXISTS. Check first with
--   PRAGMA table_info(admin_user_stats);
-- and skip if last_saved_at is already present.
ALTER TABLE admin_user_stats ADD COLUMN last_saved_at TEXT;
