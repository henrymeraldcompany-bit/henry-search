# GOZIE SEARCH

A phone-friendly search website with category tabs for web search, images, news, and videos.

## Frontend files

- `index.html` — accessible page structure and search controls.
- `style.css` — dark/light themes, responsive layout, video filters, and player styling.
- `app.js` — search requests, media rendering, image preview, voice search, safe outbound links, and provider fallbacks.

## Connected services

**Main search Worker:** https://henry-search-api.henrymeraldcompany.workers.dev

- `/search?q=...` — ordinary web search.
- `/news?q=...` — news search.

**Media Worker:** https://gozie-search-media.henrymeraldcompany.workers.dev

- `/health` — service health.
- `/images?q=...` — image results from the metadata index and Wikimedia Commons.
- `/videos?q=...` — indexed results plus live PeerTube results and optional YouTube results.
- `/index/status` — indexed item counts and the latest recorded daily run.

The frontend source now tries the dedicated Media Worker first for image/video search, then retains the existing Worker and direct PeerTube fallback paths. Ordinary web search and news remain routed to the original Worker. In-page playback is attempted only when the result offers a permitted, valid embed URL; original source links remain available.

## Media index and schedule

The `backend/` directory contains the media Worker, D1 schema, schedule configuration, regression tests, and setup notes. The Worker stores metadata and original source links rather than re-hosting media files. D1 database `gozie-search-media` is configured as `MEDIA_DB`; the daily scheduled trigger is `0 7 * * *` (08:00 in Nigeria).

On 23 October 2026, Cloudflare confirmed a completed scheduled refresh: 192 rows processed, zero provider/database failures, and 191 unique stored items (96 images and 95 videos). The stored videos currently come from five PeerTube instance hosts; YouTube is not configured because the optional server-side `YOUTUBE_API_KEY` secret is absent. The daily trigger remains `0 7 * * *` (08:00 Nigeria time).

The latest Media Worker deployment on 23 October includes canonical URL deduplication (including YouTube watch/short/embed variants and common tracking parameters) and source diversity during ranking, with a fill pass when only a few sources are available. Five backend ranking checks and four frontend URL-canonicalization checks pass in the execution harness; all 11 duration parser cases pass; frontend JavaScript syntax passes. The Node.js test suites are committed and wired into GitHub Actions, but the CI result itself is not yet visible through the available status tools.

Live HTTP smoke tests still could not be completed from the management environment because it blocks outgoing requests to `workers.dev` hosts with 403 responses. Deployment metadata and the successful D1 refresh are verified, but browser-visible route responses and the static website's publish status remain unverified. YouTube results remain optional and require a server-side `YOUTUBE_API_KEY` Worker secret; never place secrets in frontend code.

## Tests

Run the duration, backend ranking, and frontend URL-canonicalization regression suites with Node.js:

```sh
node --test backend/duration.test.mjs backend/media-ranking.test.mjs backend/media-url.test.mjs
```

GitHub Actions is configured to run the same command on relevant pushes and pull requests. The tests cover ISO-8601 durations, YouTube URL variants, tracking-parameter deduplication, source diversity, sparse-source fallback, unsafe URL rejection, and case-sensitive paths. The latest workflow run has not yet been confirmed by the available status tools.

## Safety and maintenance

- Inspect the latest repository and service configuration before changes; do not rebuild working features unnecessarily.
- Never put API secrets in `app.js` or `index.html`.
- Render provider titles and descriptions as text, not HTML.
- Respect provider terms, rate limits, licensing, and embedding restrictions.
- The daily index is a seed-query discovery index, not a crawler of the entire internet.
- The static frontend's publish status was not confirmed in this run; commits to GitHub are verified, but the hosting pipeline must be checked separately.
