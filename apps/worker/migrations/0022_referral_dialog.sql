-- 0022: Founding Chef dialog tracking. Shown-at recipe count drives the
-- every-10-recipes re-surface; acted_at stops re-surfacing permanently.
ALTER TABLE profiles ADD COLUMN referral_dialog_shown_at_count INTEGER;
ALTER TABLE profiles ADD COLUMN referral_dialog_acted_at TEXT;
