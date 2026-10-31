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

The frontend tries the Media Worker first for image/video search, then retains the original Worker and direct PeerTube fallback. Live video search queries three public PeerTube instances in parallel (`peertube.tv`, `peer.tube`, and `spectra.video`) with the official `nsfw=false` filter; only items explicitly marked safe are normalized. Optional YouTube searches use the Data API's `safeSearch=strict` setting. Older indexed video rows are treated as unverified and hidden until the next safe refresh. A failing PeerTube instance does not discard results from healthy instances. Backend and frontend ranking use whole-word and phrase-boundary matches, then deduplicate canonical URLs so substring matches such as `art` inside `party` do not inflate relevance. Ordinary web search and news remain routed to the original Worker. PeerTube in-page playback accepts canonical HTTPS embed URLs on the source origin or on the three configured search instances (peertube.tv, peer.tube, and spectra.video); other cross-origin players are blocked, and original source links remain available. Only one inline player stays active at a time: starting another video or changing filters stops the previous player to avoid background playback and unnecessary mobile data use.

Indexed-media shortlist retrieval now considers up to 100 stored candidates (hard cap 120), ordering exact title-phrase matches first, then a weighted term score (title 6, description 2, tags 1), then freshness. The final whole-word ranker still filters false positives and deduplicates canonical URLs before results are returned.

## Image providers and terms

Image search uses Wikimedia Commons and the Flickr public photos feed. Results retain their original source page and image URL; GOZIE SEARCH does not download or re-host media files. Flickr results are capped at 20 per response, under Flickr's published 30-photo-per-page limit, and the interface includes the required non-endorsement notice. Flickr license metadata is not supplied by the public feed, so these results are labelled "License information unavailable"; users should check the original page and rights-holder terms before reuse.

Provider requests have an 8-second timeout so a slow provider does not indefinitely hold a search or daily refresh. If one provider fails, the other provider's results remain usable.

## Media index and schedule

The `backend/` directory contains the media Worker, D1 schema, schedule configuration, regression tests, and setup notes. The Worker stores metadata and original source links rather than re-hosting media. D1 database `gozie-search-media` is bound as `MEDIA_DB`; the scheduled trigger is `0 7 * * *` (08:00 in Nigeria).

The latest verified scheduled index run finished at 2026-10-31 07:02:05 UTC: 465 rows processed with 8 provider timeouts. That run predates provider-labelled failure diagnostics, so the exact failing provider was not recorded. D1 currently contains 940 metadata records: 674 images and 266 videos from 32 distinct video source hosts. These counts describe indexed metadata, not all media available online. The next refresh uses six rotating seeds per day from a 24-topic safe discovery bank and disables a provider for the remainder of that run after two consecutive request failures.

The latest verified Media Worker deployment before the current change was 31 October 2026 at 08:17:44 UTC (deployment `420ffb73-8b6c-445b-b5c9-84faf2bebed8`, version `17f0238e-40ee-4cd6-b361-fe11ef5dc12d`) with 100% of traffic on that version. Cloudflare confirms the `MEDIA_DB` binding and daily `0 7 * * *` schedule. The D1 schema now includes a safe-by-default video classification column; the migration is kept in `backend/migrations/`.

GitHub Actions now verifies the media routes, original web/news routes, published frontend, and browser playback from a hosted runner. On 31 October, live smoke run `41183947193` passed: Worker health and index-status checks passed, image search returned 32 results across 2 source hosts, video search returned 39 results across 12 source hosts, the original `/search` and `/news` routes passed, and the Playwright Chromium player test passed. The browser test verified iframe mounting, source/embed URL policy, Stop playback, single-player behavior, and filter cleanup; it does not guarantee every third-party stream will play in every browser.

YouTube results remain optional and require the server-side `YOUTUBE_API_KEY` secret. Never put API secrets in frontend code.

## Public webpage retrieval

The main search Worker source is mirrored in `backend/search-worker.js` and exposes `GET /extract?url=<public-page-url>`. It fetches public HTML pages directly, checks the site's `robots.txt` for the GOZIE-SearchBot user agent, follows at most three validated redirects, accepts HTML/XHTML only, limits response bodies to 1 MB, and returns a bounded title, description, readable text excerpt, same-origin canonical URL, optional Open Graph image, publication date, and extraction timestamp. It does not execute page scripts, download media, bypass logins/paywalls/CAPTCHAs, or scrape Google Search result pages. Pages whose robots policy blocks the bot (or cannot be checked) are not fetched. Local/private literal IPs, credential-bearing URLs and non-standard ports are rejected.

Example: `https://henry-search-api.henrymeraldcompany.workers.dev/extract?url=https%3A%2F%2Fexample.org%2Farticle` (replace the example URL with a permitted public article). The endpoint is a page reader, not a general search index. Google Search result pages are not an authorized free no-API source; use an official Google search integration where available, and use GOZIE's independent connectors for other sources. The deployed frontend adds a **Read here in GOZIE** action to ordinary web-result cards. It calls the extraction endpoint, shows a bounded text preview in the result card, and keeps an original-source link visible. No API key is required for this page-reading feature. The extraction endpoint's source code is deployed to the existing `henry-search-api` Worker; it does not alter the existing media Worker or D1 index.

## Tests

Run the media regression suites with Node.js 22:

```sh
node --test backend/duration.test.mjs backend/indexed-search.test.mjs backend/media-ranking.test.mjs backend/media-url.test.mjs backend/video-filters.test.mjs backend/image-providers.test.mjs
```

The suites cover ISO-8601 durations, PeerTube duration normalization and safe-search filtering, YouTube URL variants and strict safeSearch, tracking-parameter deduplication, source diversity, sparse-query fallback, rotating daily index seeds, provider circuit breaking, Flickr feed mapping and URL safety, Flickr result caps, source/date/duration filters, and safe embed validation. The indexed-search helper has five targeted checks covering SQL ordering, placeholder counts, candidate limits, empty queries, and wildcard removal. The full backend regression workflow passed on pull-request commit `693478e23f1cba93c656525f55547e0eec847f91` on 29 October 2026: 56 tests passed, zero failed. The playback change was merged as `b35da919b88a41eeea5f96f1685361d7b6a2583e`. The `.github/workflows/media-live-smoke.yml` workflow checks `/health`, `/index/status`, `/images`, and `/videos` daily at 07:30 UTC (08:30 Nigeria). The latest media-route smoke checks passed on 28 October; the previously failing legacy-route job was rerun on 29 October and both `/search` and `/news` passed. The published frontend is now verified byte-for-byte; the Chromium interaction check is being added to test iframe mounting and stop/filter behavior. Third-party stream playback remains dependent on each provider and browser.

## Safety and maintenance

- Inspect the latest repository and service configuration before changing code; do not rebuild working features unnecessarily.
- Never put API secrets in `app.js` or `index.html`.
- Render provider titles and descriptions as text, not HTML.
- Respect provider terms, rate limits, licensing, and embedding restrictions.
- The daily index is a seed-query discovery index, not a crawler of every website or video.
