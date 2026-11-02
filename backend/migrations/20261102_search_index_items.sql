CREATE TABLE IF NOT EXISTS search_index_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('web','news')),
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  sources_json TEXT NOT NULL DEFAULT '[]',
  providers_json TEXT NOT NULL DEFAULT '[]',
  published_at TEXT NOT NULL DEFAULT '',
  indexed_at TEXT NOT NULL,
  UNIQUE(kind,canonical_url)
);
CREATE INDEX IF NOT EXISTS idx_search_index_kind_indexed
  ON search_index_items(kind,indexed_at);
CREATE INDEX IF NOT EXISTS idx_search_index_kind_domain
  ON search_index_items(kind,domain);
CREATE INDEX IF NOT EXISTS idx_search_index_kind_published
  ON search_index_items(kind,published_at);
