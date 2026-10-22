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

At the latest check on 22 October 2026, Cloudflare confirmed the Worker deployment, its enabled `workers.dev` subdomain, the D1 schema, and the daily trigger. The database contained zero indexed media items and no completed index-run records yet, so the automatic index has not been verified to have run. The next scheduled run is expected at 08:00 Nigeria time on 23 October 2026.

Live HTTP smoke tests could not be completed from the management environment because it blocks outgoing requests to `workers.dev` hosts. Test the endpoints from a normal browser or another external client before treating live search and indexing as fully verified. YouTube results remain optional and require a server-side `YOUTUBE_API_KEY` Worker secret; never place secrets in frontend code.

## Tests

Run the video-duration regression tests with Node.js:

```sh
node --test backend/duration.test.mjs
```

The tests cover YouTube ISO-8601 durations (including hours, minutes, and seconds) and malformed values. Keep tests and provider fallback behavior when changing the media routes.

## Safety and maintenance

- Inspect the latest repository and service configuration before changes; do not rebuild working features unnecessarily.
- Never put API secrets in `app.js` or `index.html`.
- Render provider titles and descriptions as text, not HTML.
- Respect provider terms, rate limits, licensing, and embedding restrictions.
- The daily index is a seed-query discovery index, not a crawler of the entire internet.
- The static frontend's publish status was not confirmed in this run; commits to GitHub are verified, but the hosting pipeline must be checked separately.
