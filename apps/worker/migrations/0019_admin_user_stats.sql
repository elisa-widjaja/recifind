-- 0019_admin_user_stats.sql
-- Denormalized, admin-only per-user stats for the Users list. Recomputed hourly
-- by syncAdminUserStats() in scheduled(). Read by buildUsersListQuery via a PK
-- join so the list does no aggregation and no Supabase calls.
CREATE TABLE IF NOT EXISTS admin_user_stats (
  user_id          TEXT PRIMARY KEY,
  recipe_count     INTEGER NOT NULL DEFAULT 0,
  friends_count    INTEGER NOT NULL DEFAULT 0,
  last_sign_in_at  TEXT,
  synced_at        TEXT NOT NULL
);
