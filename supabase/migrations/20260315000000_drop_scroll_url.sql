-- scroll_url was the legacy single-part strip URL field.
-- All songs now use the parts JSONB array for multi-voice strips.
ALTER TABLE songs DROP COLUMN IF EXISTS scroll_url;
