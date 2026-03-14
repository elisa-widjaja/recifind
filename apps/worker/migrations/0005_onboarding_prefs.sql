-- 0005_onboarding_prefs.sql
-- Add cooking_for and cuisine_prefs columns to profiles.
-- Both are nullable; existing rows default to NULL (treated as "no preference").
ALTER TABLE profiles ADD COLUMN cooking_for TEXT;
ALTER TABLE profiles ADD COLUMN cuisine_prefs TEXT;
