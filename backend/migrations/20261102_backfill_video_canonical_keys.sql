-- Backfill only legacy video watch URLs whose existing form is already canonical
-- under the Worker URL rules. Complex URLs are left untouched for safe reindexing.
-- This never changes nsfw classification and never deletes media rows.
UPDATE media_items
SET canonical_page_url = lower(trim(page_url))
WHERE kind = 'video'
  AND canonical_page_url = ''
  AND page_url LIKE 'https://%'
  AND page_url = lower(trim(page_url))
  AND substr(page_url, 9, 4) <> 'www.'
  AND instr(page_url, '@') = 0
  AND instr(page_url, '?') = 0
  AND instr(page_url, '#') = 0
  AND substr(page_url, -1) <> '/';
