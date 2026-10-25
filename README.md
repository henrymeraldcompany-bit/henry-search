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

Cloudflare verified the daily index run at 2026-10-25 07:01:07 UTC: 288 rows processed with zero recorded provider/database failures. D1 then contained 198 images (103 from Wikimedia Commons and 95 from the Flickr public feed) and 98 videos across five PeerTube hosts. This confirms Flickr-derived records were stored by the scheduled index.

The Media Worker was redeployed on 25 October 2026 at 07:15:52 UTC with relevance-aware deduplication: candidates are now scored and sorted before canonical duplicate URLs are removed, so a weak provider variant cannot hide a better match. Cloudflare's deployed source was fetched and compared byte-for-byte with `backend/worker.js`; the source matched exactly. The existing `MEDIA_DB` binding, enabled workers.dev subdomain, and daily `0 7 * * *` schedule remain configured.

Live HTTP smoke tests remain unverified because this management environment blocks outgoing requests to `workers.dev` hosts. This does not prove that the Worker is failing; it prevents direct end-to-end verification from this environment. Test `/health`, `/index/status`, `/images?q=science`, and `/videos?q=science` from a normal browser or another permitted external client. The static website's latest publication status is also not confirmed.

YouTube results remain optional and require the server-side `YOUTUBE_API_KEY` secret. Never put API secrets in frontend code.

## Tests

Run the media regression suites with Node.js 22:

```sh
node --test backend/duration.test.mjs backend/media-ranking.test.mjs backend/media-url.test.mjs backend/video-filters.test.mjs backend/image-providers.test.mjs
```

The suites cover ISO-8601 durations, YouTube URL variants, tracking-parameter deduplication, source diversity, sparse-query fallback, Flickr feed mapping and URL safety, Flickr result caps, source/date/duration filters, unsafe URL rejection, and case-sensitive paths. GitHub Actions is configured to run these suites on relevant pushes and pull requests; a successful run for the latest changes has not yet been confirmed by the available status tools.

## Safety and maintenance

- Inspect the latest repository and service configuration before changing code; do not rebuild working features unnecessarily.
- Never put API secrets in `app.js` or `index.html`.
- Render provider titles and descriptions as text, not HTML.
- Respect provider terms, rate limits, licensing, and embedding restrictions.
- The daily index is a seed-query discovery index, not a crawler of every website or video.
