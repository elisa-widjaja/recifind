-- Persist the "onboarding seen" flag on the server so it survives iOS app
-- reinstalls (which wipe the WKWebView localStorage).
ALTER TABLE profiles ADD COLUMN onboarding_seen INTEGER DEFAULT 0;
