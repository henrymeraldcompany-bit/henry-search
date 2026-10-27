# GOZIE SEARCH media backend

This Cloudflare Worker stores media metadata and original source links rather than re-hosting media files. It uses Wikimedia Commons and Flickr's public photo feed for image discovery, PeerTube for open video search, and optionally YouTube when a server-side `YOUTUBE_API_KEY` secret is configured.

## Current deployment status

- Worker: `gozie-search-media`
- Base URL: https://gozie-search-media.henrymeraldcompany.workers.dev
- Database: Cloudflare D1 database `gozie-search-media`, bound as `MEDIA_DB`
- Scheduled discovery refresh: daily at `07:00 UTC` (`08:00 Africa/Lagos`)
- Routes: `/health`, `/images?q=...`, `/videos?q=...`, and `/index/status`
- The website tries this Media Worker first for image/video search and retains the original Worker and direct PeerTube fallbacks. Normal `/search` and `/news` remain on the original Worker.
- YouTube results are optional and remain disabled until `YOUTUBE_API_KEY` is added as a Worker secret. Never put that key in `app.js` or `index.html`.

The latest Worker deployment was confirmed on 27 October 2026 at 07:10:06 UTC (deployment version `31a3ff24-0c8b-406c-a58f-a1b198b2c44e`) with 100% of traffic assigned to its version. Cloudflare settings confirm the `MEDIA_DB` binding, enabled `workers.dev` subdomain, and daily `0 7 * * *` trigger. The new indexed-media query retrieves up to 100 candidates (hard cap 120), prioritizes exact title phrases, then weights title/description/tags matches at 6/2/1 before freshness; the final whole-word ranker and canonical URL deduper still decide which results are returned. The generated SQL query was executed against the live D1 database successfully.

The latest recorded scheduled index run finished at 2026-10-27 07:01:15 UTC: 465 rows processed, zero recorded provider/database failures, and 630 stored records: 364 images (259 Flickr public-feed and 105 Wikimedia Commons) and 266 videos across multiple PeerTube hosts. This run occurred before the indexed-candidate ranking deployment at 07:10:06 UTC; it verifies scheduled indexing but not the new ranking change.

## Image discovery

- Wikimedia Commons is queried for up to 16 live results.
- Flickr's public photos feed is queried with up to five focused tag terms and returns at most 12 live items per query.
- The feed's original photo page and media URLs are stored; image bytes are not copied to GOZIE SEARCH.
- The provider response is capped at 20 Flickr results per search response, below Flickr's documented 30-photo-per-page limit.
- The public feed does not supply a reliable license field, so Flickr results use `License information unavailable`; the original page must be checked before reuse.
- The frontend includes Flickr's non-endorsement notice.
- External provider requests use an 8-second timeout. Provider failures are isolated so one unavailable image source does not discard the other source's results.

The Flickr feed host was blocked by the management execution environment during live testing. This is not proof that Cloudflare's deployed Worker cannot reach it, but live Flickr search and the next scheduled index refresh still need verification.

## Video discovery and ranking

Video search merges indexed results with live searches against three public PeerTube instances (`peertube.tv`, `peer.tube`, and `spectra.video`) plus optional YouTube results. PeerTube requests run in parallel; a failed or slow instance is isolated so results from healthy instances remain usable. Relative video URLs resolve against the instance that returned them. URL canonicalization removes common tracking parameters and collapses equivalent YouTube watch/short/embed links. Ranking uses whole-word and phrase-boundary matches to avoid false positives from substrings (for example, `art` inside `party`), sorts candidates before canonical URL deduplication so the strongest provider variant wins, limits source-host dominance on the first pass, then fills remaining places with the closest available matches. If fewer than eight unique results are found, the Worker retries once with a focused query.

The frontend supports source, upload-date, and duration filters, including a past-year option. ISO-8601 durations (for example, `PT4M` or `PT1H2M3S`) are normalized for duration filtering. In-page playback is used only when the source exposes a permitted embed URL; original source links remain available.

## Indexed candidate shortlist

The D1 lookup considers up to 100 stored candidates per query (hard cap 120). SQL orders exact title-phrase matches first, then a weighted term score (title 6, description 2, tags 1), then `indexed_at` freshness. This shortlist is only a prefilter; the final whole-word ranker and canonical URL deduper still reject substring false positives and select the strongest matching duplicate. The new SQL query was tested read-only against the live D1 database.

## Index behavior and limits

The daily refresh uses eight seed queries; it is a discovery index, not a crawler of the whole internet. It stores metadata, source links, licenses when supplied, and index timestamps. Each seed is searched across Wikimedia Commons, Flickr, and all three configured PeerTube instances. To leave headroom under Cloudflare Workers Free's 50 external-subrequest-per-invocation limit, an optional YouTube API key adds one rotating seed per day (including its duration lookup); the rotation covers all eight seeds over eight days. Live video searches still query all three PeerTube instances and optional YouTube for each user query. Old records older than 180 days are removed during refresh. The index does not store video or image files.

## Regression tests

Run the six regression suites with Node.js 22:

```sh
node --test backend/duration.test.mjs backend/indexed-search.test.mjs backend/media-ranking.test.mjs backend/media-url.test.mjs backend/video-filters.test.mjs backend/image-providers.test.mjs
```

They cover ISO-8601 duration parsing, numeric PeerTube duration normalization (including missing and invalid values), YouTube URL canonicalization, tracking-parameter deduplication, source diversity, sparse-query fallback, multi-instance PeerTube request construction and failure isolation, daily YouTube-seed rotation, whole-word relevance, Flickr feed mapping and URL safety, Flickr response caps, and source/date/duration filtering. The repository includes `.github/workflows/backend-tests.yml`, which runs all six suites on relevant pushes and pull requests. Six targeted source-extracted checks passed for syntax, three-instance request construction, provider-failure isolation, relative URL resolution, whole-word ranking in backend and frontend, and rotating YouTube indexing. The indexed-search helper has five targeted checks covering SQL ordering, placeholder counts, candidate limits, empty queries, and wildcard removal. The generated SQL was executed against D1 successfully; the complete six-suite GitHub Actions result for the latest commit still needs confirmation. The separate `.github/workflows/media-live-smoke.yml` workflow checks health, index status, and both media search routes on manual dispatch, daily at 07:30 UTC (08:30 Nigeria), and after backend Worker/config changes; its current run result is not confirmed.

Live HTTP smoke tests remain unverified because the management environment blocks outgoing requests to `workers.dev` and `www.flickr.com` hosts. Deployment metadata and the earlier scheduled index run are verified, but every browser-visible route and the Flickr provider still need a direct test from a normal browser or another permitted external client.

## Redeploy or reproduce setup

The checked-in `backend/wrangler.toml` contains the configured D1 database ID and daily cron trigger. From the repository root, with Wrangler logged into the correct Cloudflare account:

```sh
npx wrangler d1 execute gozie-search-media --remote --file=backend/schema.sql --config backend/wrangler.toml
npx wrangler deploy --config backend/wrangler.toml
```

To enable YouTube results, configure the optional API key as a server-side Worker secret:

```sh
npx wrangler secret put YOUTUBE_API_KEY --config backend/wrangler.toml
```

Enter the secret interactively. Never commit it or include it in frontend code. Free-tier quotas and provider terms apply; the daily index covers only configured seed queries and returned provider results.
