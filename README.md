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

The frontend tries the Media Worker first for image/video search, then retains the original Worker and direct PeerTube fallback. Live video search now queries three public PeerTube instances in parallel (`peertube.tv`, `peer.tube`, and `spectra.video`) plus optional YouTube results; a failing instance does not discard results from healthy instances. Backend and frontend ranking use whole-word and phrase-boundary matches, then deduplicate canonical URLs so substring matches such as `art` inside `party` do not inflate relevance. Ordinary web search and news remain routed to the original Worker. PeerTube in-page playback accepts canonical HTTPS embed URLs on the source origin or on the three configured search instances (peertube.tv, peer.tube, and spectra.video); other cross-origin players are blocked, and original source links remain available. Only one inline player stays active at a time: starting another video or changing filters stops the previous player to avoid background playback and unnecessary mobile data use.

Indexed-media shortlist retrieval now considers up to 100 stored candidates (hard cap 120), ordering exact title-phrase matches first, then a weighted term score (title 6, description 2, tags 1), then freshness. The final whole-word ranker still filters false positives and deduplicates canonical URLs before results are returned.

## Image providers and terms

Image search uses Wikimedia Commons and the Flickr public photos feed. Results retain their original source page and image URL; GOZIE SEARCH does not download or re-host media files. Flickr results are capped at 20 per response, under Flickr's published 30-photo-per-page limit, and the interface includes the required non-endorsement notice. Flickr license metadata is not supplied by the public feed, so these results are labelled "License information unavailable"; users should check the original page and rights-holder terms before reuse.

Provider requests have an 8-second timeout so a slow provider does not indefinitely hold a search or daily refresh. If one provider fails, the other provider's results remain usable.

## Media index and schedule

The `backend/` directory contains the media Worker, D1 schema, schedule configuration, regression tests, and setup notes. The Worker stores metadata and original source links rather than re-hosting media. D1 database `gozie-search-media` is bound as `MEDIA_DB`; the scheduled trigger is `0 7 * * *` (08:00 in Nigeria).

Cloudflare's latest verified scheduled index run finished at 2026-10-30 07:01:19 UTC: 465 rows processed with zero recorded provider/database failures. D1 currently contains 856 metadata records: 590 images (481 Flickr public-feed and 109 Wikimedia Commons records) and 266 videos from 32 distinct video source hosts. These counts describe indexed metadata, not all media available online.

The latest Media Worker deployment remains 28 October 2026 at 08:21:49 UTC (deployment `f5b94213-b7c0-4c14-8b79-095fc30e0398`, version `080bb0dd-73b1-40b6-b619-a193361848dd`) with 100% of traffic on that version. Cloudflare confirms the `MEDIA_DB` binding and daily `0 7 * * *` schedule. The current frontend playback guard was merged to `main` on 29 October as commit `b35da919b88a41eeea5f96f1685361d7b6a2583e`; no Media Worker deployment was needed for this frontend-only change.

The management browser cannot directly open the `workers.dev` or GitHub Pages URLs, so GitHub Actions verifies these services from a hosted runner. The 30 October media-route smoke check (run `41022631448`) passed: health and index-status contracts passed, image search returned 31 results across 2 source hosts, and video search returned 39 results across 12 source hosts. The same run confirmed `/search` returned 4 results, but `/news` returned HTTP 502 because GDELT timed out, Google News RSS returned 503, and Bing News returned no readable articles. The GitHub Pages build/deploy workflow succeeded (run `41022631359`). The smoke workflow also compared the published `app.js` byte-for-byte with the commit source and verified the trusted PeerTube allowlist and stop-playback controls. A push/manual-only Chromium check is being added to exercise the actual page interaction, iframe policy, stop control, single-player behavior and filter cleanup; this checks iframe mounting, not whether every third-party stream will play in every browser.

YouTube results remain optional and require the server-side `YOUTUBE_API_KEY` secret. Never put API secrets in frontend code.

## Tests

Run the media regression suites with Node.js 22:

```sh
node --test backend/duration.test.mjs backend/indexed-search.test.mjs backend/media-ranking.test.mjs backend/media-url.test.mjs backend/video-filters.test.mjs backend/image-providers.test.mjs
```

The suites cover ISO-8601 durations, PeerTube duration normalization, YouTube URL variants, tracking-parameter deduplication, source diversity, sparse-query fallback, Flickr feed mapping and URL safety, Flickr result caps, source/date/duration filters, and safe embed validation. The indexed-search helper has five targeted checks covering SQL ordering, placeholder counts, candidate limits, empty queries, and wildcard removal. The full backend regression workflow passed on pull-request commit `693478e23f1cba93c656525f55547e0eec847f91` on 29 October 2026: 56 tests passed, zero failed. The playback change was merged as `b35da919b88a41eeea5f96f1685361d7b6a2583e`. The `.github/workflows/media-live-smoke.yml` workflow checks `/health`, `/index/status`, `/images`, and `/videos` daily at 07:30 UTC (08:30 Nigeria). The latest media-route smoke checks passed on 28 October; the previously failing legacy-route job was rerun on 29 October and both `/search` and `/news` passed. The published frontend is now verified byte-for-byte; the Chromium interaction check is being added to test iframe mounting and stop/filter behavior. Third-party stream playback remains dependent on each provider and browser.

## Safety and maintenance

- Inspect the latest repository and service configuration before changing code; do not rebuild working features unnecessarily.
- Never put API secrets in `app.js` or `index.html`.
- Render provider titles and descriptions as text, not HTML.
- Respect provider terms, rate limits, licensing, and embedding restrictions.
- The daily index is a seed-query discovery index, not a crawler of every website or video.
