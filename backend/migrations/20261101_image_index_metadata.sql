-- Extend the shared media index with image-specific descriptive and attribution metadata.
-- Existing image/video records remain intact; new columns have safe empty defaults.
ALTER TABLE media_items ADD COLUMN provider TEXT NOT NULL DEFAULT '';
ALTER TABLE media_items ADD COLUMN creator_url TEXT NOT NULL DEFAULT '';
ALTER TABLE media_items ADD COLUMN license_url TEXT NOT NULL DEFAULT '';
ALTER TABLE media_items ADD COLUMN attribution TEXT NOT NULL DEFAULT '';
ALTER TABLE media_items ADD COLUMN width INTEGER;
ALTER TABLE media_items ADD COLUMN height INTEGER;
ALTER TABLE media_items ADD COLUMN format TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_media_items_image_format
  ON media_items(kind, format, indexed_at);
CREATE INDEX IF NOT EXISTS idx_media_items_image_dimensions
  ON media_items(kind, width, height);
