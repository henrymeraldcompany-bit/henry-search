CREATE TABLE IF NOT EXISTS media_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  source TEXT NOT NULL, source_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  page_url TEXT NOT NULL, media_url TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '', embed_url TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '', license TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL DEFAULT '', duration_seconds REAL,
  tags TEXT NOT NULL DEFAULT '[]', indexed_at TEXT NOT NULL,
  UNIQUE(kind,source,page_url)
);
CREATE INDEX IF NOT EXISTS idx_media_items_kind ON media_items(kind);
CREATE INDEX IF NOT EXISTS idx_media_items_source ON media_items(source);
CREATE INDEX IF NOT EXISTS idx_media_items_indexed_at ON media_items(indexed_at);
CREATE TABLE IF NOT EXISTS index_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finished_at TEXT NOT NULL, rows_processed INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT ''
);