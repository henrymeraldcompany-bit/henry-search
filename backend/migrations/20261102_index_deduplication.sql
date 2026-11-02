-- Canonical identity columns for cross-provider media-index deduplication.
ALTER TABLE media_items ADD COLUMN canonical_page_url TEXT NOT NULL DEFAULT '';
ALTER TABLE media_items ADD COLUMN canonical_media_url TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_items_video_canonical_page
  ON media_items(canonical_page_url)
  WHERE kind='video' AND canonical_page_url<>'';
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_items_image_canonical_media
  ON media_items(canonical_media_url)
  WHERE kind='image' AND canonical_media_url<>'';
