-- 0013: avatar uploads
-- Add avatar_url column to profiles. Stores the public Supabase Storage URL
-- of the user's uploaded avatar image (objects live under "avatars/" in the
-- SUPABASE_STORAGE_BUCKET). Null when the user hasn't uploaded one — the
-- frontend then falls back to rendering the user's first-letter initial.

ALTER TABLE profiles ADD COLUMN avatar_url TEXT;
