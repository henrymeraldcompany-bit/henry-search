# GOZIE SEARCH

A phone-friendly search website with category tabs for web search, images, news, and videos.

## Frontend files

- `index.html` — accessible page structure, search controls, and provider notices.
- `style.css` — dark/light themes, responsive layout, video filters, and player styling.
- `app.js` — search requests, relevance ordering, media rendering, image preview, voice search, safe links, and provider fallbacks.

## Connected services

**Main search Worker:** https://henry-search-api.henrymeraldcompany.workers.dev

- `/search?q=...` — ordinary web search.
- `/news?q=...` — news search.

**Media Worker:** https://gozie-search-media.henrymeraldcompany.workers.dev

- `/health` — service health.
- `/images?q=...` — indexed image metadata plus live Wikimedia Commons and Flickr public-feed results.
- `/videos?q=...` — indexed results plus live PeerTube results and optional YouTube results.
- `/index/status` — indexed item counts and the latest recorded daily run.

The frontend tries the Media Worker first for image/video search, then retains the original Worker and direct PeerTube fallbacks. Both backend and frontend now rank media variants before deduplicating canonical URLs, preserving the best-matching title when providers return different versions of the same item. Ordinary web search and news remain routed to the original Worker. Video playback is attempted only for permitted embed URLs; original source links remain available.

## Image providers and terms

Image search uses Wikimedia Commons and the Flickr public photos feed. Results retain their original source page and image URL; GOZIE SEARCH does not download or re-host media files. Flickr results are capped at 20 per response, under Flickr's published 30-photo-per-page limit, and the interface includes the required non-endorsement notice. Flickr license metadata is not supplied by the public feed, so these results are labelled "License information unavailable"; users should check the original page and rights-holder terms before reuse.

Provider requests have an 8-second timeout so a slow provider does not indefinitely hold a search or daily refresh. If one provider fails, the other provider's results remain usable.

## Media index and schedule

The `backend/` directory contains the media Worker, D1 schema, schedule configuration, regression tests, and setup notes. The Worker stores metadata and original source links rather than re-hosting media. D1 database `gozie-search-media` is bound as `MEDIA_DB`; the scheduled trigger is `0 7 * * *` (08:00 in Nigeria).

Cloudflare verified the daily index run at 2026-10-26 07:01:17 UTC: 288 rows processed with zero recorded provider/database failures. The latest D1 query returned 272 images (169 Flickr public-feed records and 103 Wikimedia Commons records) and 98 videos across five PeerTube hosts, 370 stored media records total. These counts describe indexed metadata, not the number of unique media files available across the internet.

The Media Worker was redeployed on 26 October 2026 at 08:16:53 UTC (deployment `d1b515c5-31c6-423b-ad6b-ad8954dd1a5b`) with a duration-metadata fix: missing, blank, boolean, negative, non-finite, or non-numeric PeerTube duration values now remain `null` instead of being accidentally converted to zero seconds. Numeric seconds remain accepted. Cloudflare's deployed module was extracted from the API's multipart response and compared byte-for-byte with `backend/worker.js`; the source matched exactly. The existing `MEDIA_DB` binding, enabled workers.dev subdomain, and daily `0 7 * * *` schedule remain configured.

Live HTTP smoke tests remain unverified because this management environment blocks outgoing requests to `workers.dev` hosts. This does not prove that the Worker is failing; it prevents direct end-to-end verification from this environment. Test `/health`, `/index/status`, `/images?q=science`, and `/videos?q=science` from a normal browser or another permitted external client. The static website's latest publication status is also not confirmed.

YouTube results remain optional and require the server-side `YOUTUBE_API_KEY` secret. Never put API secrets in frontend code.

## Tests

Run the media regression suites with Node.js 22:

```sh
node --test backend/duration.test.mjs backend/media-ranking.test.mjs backend/media-url.test.mjs backend/video-filters.test.mjs backend/image-providers.test.mjs
```

The suites cover ISO-8601 durations, PeerTube duration normalization (including missing and invalid metadata), YouTube URL variants, tracking-parameter deduplication, source diversity, sparse-query fallback, Flickr feed mapping and URL safety, Flickr result caps, source/date/duration filters, unsafe URL rejection, and case-sensitive paths. The focused duration test ran locally in a temporary Node.js harness with 4 test cases passing; the complete repository suite and GitHub Actions result for the latest commit have not yet been independently confirmed. A separate `.github/workflows/media-live-smoke.yml` workflow checks `/health`, `/index/status`, `/images`, and `/videos` on manual dispatch, when the workflow file changes, and daily at 07:30 UTC (08:30 Nigeria), after the scheduled index refresh. Its first live-run result is not yet available through the connected status tools.

## Safety and maintenance

- Inspect the latest repository and service configuration before changing code; do not rebuild working features unnecessarily.
- Never put API secrets in `app.js` or `index.html`.
- Render provider titles and descriptions as text, not HTML.
- Respect provider terms, rate limits, licensing, and embedding restrictions.
- The daily index is a seed-query discovery index, not a crawler of every website or video.
