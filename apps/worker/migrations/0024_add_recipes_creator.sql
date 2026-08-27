-- Content creator's display name/handle (e.g. "Kalejunkie"), used by creator
-- search on Discover + the recipe list. Backfilled lazily by the
-- /public/oembed-author endpoint when a recipe detail view resolves the
-- author — the import flow never writes it. NULL = not yet resolved (all
-- legacy rows start NULL and fill in as recipes get viewed).
ALTER TABLE recipes ADD COLUMN creator TEXT;
