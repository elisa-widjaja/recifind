-- Recipes
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  image_path TEXT,
  meal_types TEXT DEFAULT '[]',
  ingredients TEXT DEFAULT '[]',
  steps TEXT DEFAULT '[]',
  duration_minutes INTEGER,
  notes TEXT DEFAULT '',
  preview_image TEXT,
  shared_with_friends INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_recipes_id ON recipes(id);

-- User profiles
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Friends (bidirectional - one row per direction)
CREATE TABLE IF NOT EXISTS friends (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  friend_email TEXT NOT NULL,
  friend_name TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

-- Friend requests (incoming)
CREATE TABLE IF NOT EXISTS friend_requests (
  to_user_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_email TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL,
  PRIMARY KEY (to_user_id, from_user_id)
);

-- Sent friend requests tracking
CREATE TABLE IF NOT EXISTS friend_requests_sent (
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  PRIMARY KEY (from_user_id, to_user_id)
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  read INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

-- Share links
CREATE TABLE IF NOT EXISTS share_links (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_share_links_user_recipe ON share_links(user_id, recipe_id);

-- Collection metadata (recipe count + version for cache busting)
CREATE TABLE IF NOT EXISTS collection_meta (
  user_id TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 0
);
