-- 0011_add_recipes_provenance.sql
-- Adds a provenance tag so the UI can distinguish verbatim extracted content
-- from content Gemini inferred from page body text. Legacy rows keep NULL.
-- Values: 'extracted' | 'inferred' | NULL (application-enforced; no CHECK).

ALTER TABLE recipes ADD COLUMN provenance TEXT;
