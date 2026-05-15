-- Hide a single recipe from feeds + public landing without deleting it.
ALTER TABLE recipes ADD COLUMN hidden_at TEXT;

-- Soft-delete a user (admin action). Hard delete remains available
-- via the user's own delete-my-account flow.
ALTER TABLE profiles ADD COLUMN deleted_at TEXT;

-- Audit trail of admin-initiated mutations.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  target_recipe_id TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin ON admin_audit_log(admin_email, created_at DESC);
