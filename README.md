# GOZIE SEARCH

A phone-friendly search website with category tabs for web search, images, news, and videos.

## Frontend files

- `index.html` — accessible page structure, search controls, and provider notices.
- `style.css` — dark/light themes, responsive layout, video filters, and player styling.
- `app.js` — search requests, relevance ordering, media rendering, image preview, voice search, safe links, and provider fallbacks.

## Connected services

**Main search Worker:** https://henry-search-api.henrymeraldcompany.workers.dev

- `/search?q=...` — ordinary web search.
- `/news?q=...` — news search with publication-date filters.
  - `date=any|day|week|month|year` — any time, past 24 hours, past 7 days, past 30 days, or past 365 days.
  - `from=YYYY-MM-DD` and/or `to=YYYY-MM-DD` — optional inclusive UTC calendar-date bounds; combine them for a custom date range.
  - Invalid presets, malformed dates, and reversed ranges return HTTP 400. Date-constrained searches exclude undated and future-dated articles. Responses include `availableDateFilters`, `appliedFilters`, and the filtered `totalResults`.

**Media Worker:** https://gozie-search-media.henrymeraldcompany.workers.dev

- `/health` — service health.
- `/images?q=...` — indexed image metadata plus live Wikimedia Commons and Flickr public-feed results.
- `/videos?q=...` — indexed results plus live PeerTube results and optional YouTube results.
- `/index/status` — per-kind indexed counts, latest daily run, and verified-safe versus unverified video counts.

The frontend tries the Media Worker first for image/video search, then retains the original Worker and direct PeerTube fallback. Live video search queries three public PeerTube instances in parallel (`peertube.tv`, `peer.tube`, and `spectra.video`) with the official `nsfw=false` filter; only items explicitly marked safe are normalized. Optional YouTube searches use the Data API's `safeSearch=strict` setting. Older indexed video rows are treated as unverified and hidden until the next safe refresh. A failing PeerTube instance does not discard results from healthy instances. Backend and frontend ranking use whole-word and phrase-boundary matches, then deduplicate canonical URLs so substring matches such as `art` inside `party` do not inflate relevance. Ordinary web search and news remain routed to the original Worker. Live `/news` queries now contact GDELT, Google News RSS and Bing News RSS concurrently, merge canonical-URL duplicates, retain publisher/provider attribution, rank the combined articles, and report individual provider failures without discarding healthy results. After relevance and date filtering, news stories are interleaved by lead publisher to improve source diversity without dropping results or changing each publisher's internal ranking; each response includes a `sourceDiversity` summary with unique publisher count and per-publisher result counts. If all live news sources fail or return no articles, the original Worker makes one bounded final request to the Media Worker's daily news index and serves matching indexed articles when available. PeerTube in-page playback accepts canonical HTTPS embed URLs on the source origin or on the three configured search instances (peertube.tv, peer.tube, and spectra.video); other cross-origin players are blocked, and original source links remain available. Only one inline player stays active at a time: starting another video or changing filters stops the previous player to avoid background playback and unnecessary mobile data use.

Indexed-media shortlist retrieval now considers up to 100 stored candidates (hard cap 120), ordering exact title-phrase matches first, then a weighted term score (title 6, description 2, tags 1), then freshness. The final whole-word ranker still filters false positives and deduplicates canonical URLs before results are returned.

## Image providers and terms

Image search uses Wikimedia Commons and the Flickr public photos feed. Results retain their original source page and image URL; GOZIE SEARCH does not download or re-host media files. Flickr results are capped at 20 per response, under Flickr's published 30-photo-per-page limit, and the interface includes the required non-endorsement notice. Flickr license metadata is not supplied by the public feed, so these results are labelled "License information unavailable"; users should check the original page and rights-holder terms before reuse.

Provider requests have an 8-second timeout so a slow provider does not indefinitely hold a search or daily refresh. If one provider fails, the other provider's results remain usable.

## Media index and schedule

The `backend/` directory contains the media Worker, D1 schema, schedule configuration, regression tests, and setup notes. The Worker stores metadata and original source links rather than re-hosting media. D1 database `gozie-search-media` is bound as `MEDIA_DB`; the scheduled trigger is `0 7 * * *` (08:00 in Nigeria).

The latest scheduled index run finished at **2 November 2026, 07:01:28 UTC**: 338 media metadata rows saved, with two Openverse timeouts and no database-save failures. Provider metrics: Wikimedia Commons 6/6 successful calls and 72 rows; Flickr 6/6 and 72 rows; PeerTube 6/6 and 194 rows; Openverse 2 attempts, both timed out, then disabled for the rest of that run. The run used 20 provider calls and took about 29.9 seconds. D1 currently contains **1,502 media metadata records**: 954 images and 548 videos; 336 videos are verified safe and 212 remain unverified, across 49 distinct video source hosts. The separate `search_index_items` table exists but still has zero web and zero news rows: the 2 November scheduled run occurred before webpage/news indexing was deployed later that morning. The next scheduled refresh, **3 November 2026 at 07:00 UTC (08:00 Nigeria time)**, is the first run expected to populate that index.

The Media Worker was deployed on 2 November 2026 at 09:14:56 UTC (deployment `c484c79b-811f-478b-aabe-9f83e8ee28a8`, version `9f3302a3-d9a3-4f90-b20f-a4bd682d09f0`) with 100% of traffic assigned to the new version. Cloudflare confirms the `MEDIA_DB` binding and daily `0 7 * * *` trigger. The original `henry-search-api` Worker was also deployed on 2 November at 09:15:00 UTC (deployment `aaa610a3-1d15-4477-b702-9c86a5e42c7e`, version `8226789a-c574-4999-b98a-f4fb2d2fdcd7`).

The backend regression workflow (run `41418831514`), media regression workflow (`41418831496`), and Pages build/deployment (`41418830994`) passed for commit `acf62d132bef94f7f4b62b0c3ec201a5f5574edf`. Post-deployment media smoke checks passed: health and index-status contracts passed; image search returned 40 results across 2 source hosts and 3 providers; video search returned 40 results across 15 source hosts and 15 providers; the published Chromium playback-controls test passed. The original web-search route returned 11 results. The live news route remains degraded because GDELT timed out, Google News RSS returned HTTP 503, and Bing News RSS returned no readable articles. A final fallback to GOZIE's own daily news index is now deployed and covered by regression tests, but it cannot return results until the next scheduled refresh populates the currently empty news index.

YouTube results remain optional and require the server-side `YOUTUBE_API_KEY` secret. Never put API secrets in frontend code.

## Public webpage retrieval

The main search Worker source is mirrored in `backend/search-worker.js` and exposes `GET /extract?url=<public-page-url>`. It fetches public HTML pages directly, checks the site's `robots.txt` for the GOZIE-SearchBot user agent, follows at most three validated redirects, accepts HTML/XHTML only, limits response bodies to 1 MB, and returns a bounded title, description, readable text excerpt, same-origin canonical URL, optional Open Graph image, publication date, and extraction timestamp. It does not execute page scripts, download media, bypass logins/paywalls/CAPTCHAs, or scrape Google Search result pages. Pages whose robots policy blocks the bot (or cannot be checked) are not fetched. Local/private literal IPs, credential-bearing URLs and non-standard ports are rejected.

Example: `https://henry-search-api.henrymeraldcompany.workers.dev/extract?url=https%3A%2F%2Fexample.org%2Farticle` (replace the example URL with a permitted public article). The endpoint is a page reader, not a general search index. Google Search result pages are not an authorized free no-API source; use an official Google search integration where available, and use GOZIE's independent connectors for other sources. The deployed frontend adds a **Read here in GOZIE** action to ordinary web-result cards. It calls the extraction endpoint, shows a bounded text preview in the result card, and keeps an original-source link visible. No API key is required for this page-reading feature. The extraction endpoint's source code is deployed to the existing `henry-search-api` Worker; it does not alter the existing media Worker or D1 index.

## Tests

Run the media regression suites with Node.js 22:

```sh
node --test backend/duration.test.mjs backend/indexed-search.test.mjs backend/media-ranking.test.mjs backend/media-url.test.mjs backend/video-filters.test.mjs backend/image-providers.test.mjs
```

The suites cover duration parsing, PeerTube and YouTube safe-search settings, rejection of unclassified video rows, D1 safe-by-default filtering, rotating daily seed coverage, provider circuit breaking, URL deduplication, source diversity, relevance, source/date/duration filters, and safe embed validation. On 31 October 2026, backend regression run `41185031836` passed 116/116 tests and media regression run `41185031880` passed 67/67 tests. Post-deployment live smoke run `41185307965` passed Media Worker health, index-status, image, and video checks; video search returned 35 results across 12 source hosts/providers and the live response confirmed the safety-filter contract. The published `app.js` matched the commit and Chromium playback controls passed; Pages build/deploy run `41185307658` succeeded. The separate legacy news check failed with HTTP 502 because GDELT timed out, Google News RSS returned 503, and Bing News returned no readable articles. The next scheduled index run (1 November, 07:00 UTC / 08:00 Nigeria) is the first production run of the six-seed rotation and provider circuit breaker; those scheduled-run effects remain unverified until it completes. Third-party playback remains dependent on each provider and browser.

## Safety and maintenance

- Inspect the latest repository and service configuration before changing code; do not rebuild working features unnecessarily.
- Never put API secrets in `app.js` or `index.html`.
- Render provider titles and descriptions as text, not HTML.
- Respect provider terms, rate limits, licensing, and embedding restrictions.
- The daily index is a seed-query discovery index, not a crawler of every website or video.


## Live news provider integration — 2 November 2026

The main `henry-search-api` Worker queries seven independent live news sources concurrently for each `/news?q=...` request:

- GDELT news index
- Google News RSS search
- Bing News RSS search
- BBC News World RSS
- Al Jazeera English RSS
- The Guardian World RSS
- NPR News RSS

The four publisher feeds are broad feeds rather than query APIs, so their results pass through GOZIE's query-relevance ranker and unrelated headlines are excluded. All results are normalized, canonicalized and deduplicated while preserving publisher and provider attribution. Individual provider timeouts, HTTP errors and empty feeds are isolated; healthy sources can still contribute. If no live provider yields a relevant article, the route makes one bounded request to the Media Worker's daily news index. The response includes successful providers, attempted provider count and bounded per-provider failures.

Regression coverage includes seven-provider fan-out, duplicate attribution merging, date normalization, irrelevant publisher-feed filtering, and partial-provider failure recovery. GitHub Actions backend regression run `41420930653` passed 194/194 tests; media regression run `41420930638` passed. Live smoke workflow `41420849750`, attempt 2, passed the original web/news API and Media Worker health, index, image and video route checks. The news API returned one relevant result from the available publisher feeds for the smoke query; the daily indexed news lookup contract also passed, with zero indexed matches for that particular query.

Cloudflare deployment on 2 November 2026: deployment `47e6c97d-90cb-4cd2-98d8-f530f13dceec`, version `45f2c92e-9d95-44dd-8664-0c99dfeb560d` at 100% traffic. Existing Worker compatibility date (`2026-10-19`) and empty binding configuration were preserved.
