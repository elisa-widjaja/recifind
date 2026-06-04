-- 0020: Clear gibberish display names from Apple "Hide My Email" signups.
--
-- Profiles were created with display_name = email local-part. For Apple
-- private-relay addresses (69bzcjwj7k@privaterelay.appleid.com) that local
-- part is a random handle, which surfaced as a spammy-looking name on friend
-- suggestion cards and the activity feed.
--
-- We can't recover these users' real names (Apple only sends the name on the
-- first authorization and we never captured it), so we blank the gibberish.
-- display_name is NOT NULL in the schema, so we use '' (empty string) as the
-- "no name" sentinel. The worker treats '' as nameless via NULLIF/TRIM and
-- renders them as GENERIC_DISPLAY_NAME ("ReciFriend cook") everywhere, and
-- hides nameless profiles from the suggestion shelf.
--
-- Idempotent: re-running only re-nulls already-null rows. Applied manually via
-- `wrangler d1 execute recipes-db --remote --file=...` (this project has no
-- d1_migrations table — see project memory).
--
-- IMPORTANT ORDER: deploy the updated worker FIRST. The old worker rendered
-- COALESCE(display_name, friend_name) and would show these as blank/null once
-- the names are cleared. The new worker falls back to the generic.

-- 1. Clear the gibberish profile names. Only touches relay accounts that still
--    have the auto-derived local-part name (users who set a real name later
--    have display_name != local-part and are left untouched).
UPDATE profiles
SET display_name = ''
WHERE email LIKE '%@privaterelay.appleid.com'
  AND display_name = substr(email, 1, instr(email, '@') - 1);

-- 2. Clear the denormalized friend_name snapshots pointing at those users, so
--    the friends list / activity COALESCE chain reaches the generic fallback
--    instead of the stale gibberish copy.
UPDATE friends
SET friend_name = ''
WHERE friend_id IN (
  SELECT user_id FROM profiles
  WHERE email LIKE '%@privaterelay.appleid.com' AND display_name = ''
);

-- 3. Same for pending friend-request from_name snapshots.
UPDATE friend_requests
SET from_name = ''
WHERE from_user_id IN (
  SELECT user_id FROM profiles
  WHERE email LIKE '%@privaterelay.appleid.com' AND display_name = ''
);
