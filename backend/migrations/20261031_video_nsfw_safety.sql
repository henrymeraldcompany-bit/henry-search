-- Add a safe-by-default content classification for indexed videos.
-- Existing rows are unknown and remain hidden from video search until refreshed.
ALTER TABLE media_items ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_media_items_kind_nsfw ON media_items(kind,nsfw,indexed_at);
