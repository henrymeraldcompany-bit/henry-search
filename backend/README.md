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

The latest Worker deployment was confirmed on 28 October 2026 at 08:21:49 UTC (deployment `f5b94213-b7c0-4c14-8b79-095fc30e0398`, version `080bb0dd-73b1-40b6-b619-a193361848dd`) with 100% of traffic assigned to that version. Cloudflare confirms the `MEDIA_DB` binding and daily `0 7 * * *` trigger. Indexed-media lookup retrieves up to 100 candidates (hard cap 120), prioritizes exact title phrases, then a normalized whole-word score (title 6, description 2, tags 1), then freshness. The final whole-word ranker and canonical URL deduper still decide which results are returned. Empty or whitespace-only URL fields now stay empty instead of resolving to a provider homepage; rows without a valid watch URL are rejected. The deployed Worker module was compared with the repository source and matched exactly (26,309 characters).

The latest recorded scheduled index run finished at 2026-10-30 07:01:19 UTC: 465 rows processed and zero recorded provider/database failures. D1 currently contains 856 metadata records: 590 images (481 Flickr public-feed and 109 Wikimedia Commons records) and 266 videos across 32 distinct source hosts. These are metadata records; media bytes are not copied to GOZIE SEARCH.

## Image discovery

- Wikimedia Commons is queried for up to 16 live results.
- Flickr's public photos feed is queried with up to five focused tag terms and returns at most 12 live items per query.
- The feed's original photo page and media URLs are stored; image bytes are not copied to GOZIE SEARCH.
- The provider response is capped at 20 Flickr results per search response, below Flickr's documented 30-photo-per-page limit.
- The public feed does not supply a reliable license field, so Flickr results use `License information unavailable`; the original page must be checked before reuse.
- The frontend includes Flickr's non-endorsement notice.
- External provider requests use an 8-second timeout. Provider failures are isolated so one unavailable image source does not discard the other source's results.

The management environment cannot directly access Flickr's feed host, but the deployed Worker has successfully indexed Flickr metadata: D1 currently contains 481 Flickr public-feed image records, and the 30 October scheduled refresh recorded zero provider/database failures. This verifies indexed Flickr records exist; direct provider access from this management environment remains blocked.

## Video discovery and ranking

Video search merges indexed results with live searches against three public PeerTube instances (`peertube.tv`, `peer.tube`, and `spectra.video`) plus optional YouTube results. PeerTube requests run in parallel; a failed or slow instance is isolated so results from healthy instances remain usable. Relative video URLs resolve against the instance that returned them. URL canonicalization removes common tracking parameters and collapses equivalent YouTube watch/short/embed links. Ranking uses whole-word and phrase-boundary matches to avoid false positives from substrings (for example, `art` inside `party`), sorts candidates before canonical URL deduplication so the strongest provider variant wins, limits source-host dominance on the first pass, then fills remaining places with the closest available matches. If fewer than eight unique results are found, the Worker retries once with a focused query. Blank or whitespace-only provider URL fields are rejected/kept empty rather than being resolved by `new URL("", base)` to the provider homepage; a result without a usable watch URL is dropped, and missing embed/thumbnail URLs remain optional instead of becoming false homepage links.

The frontend supports source, upload-date, and duration filters, including a past-year option. ISO-8601 durations (for example, `PT4M` or `PT1H2M3S`) are normalized for duration filtering. YouTube playback accepts only a matching video ID and uses the privacy-enhanced embed host when falling back. PeerTube playback accepts canonical HTTPS `/videos/embed/{id}` player URLs on the source origin or on the three exact configured search instances (`peertube.tv`, `peer.tube`, and `spectra.video`). Other cross-origin hosts, lookalike hosts, custom ports, insecure URLs, credential-bearing URLs, and non-player paths are rejected. Only one inline player stays active: starting another video or changing filters removes the previous iframe. Original source links remain available; actual playback on the published site still needs browser verification.

## Indexed candidate shortlist

The D1 lookup considers up to 100 stored candidates per query (hard cap 120). The SQL prefilter remains broad enough to avoid missing punctuation variants, but it ranks candidates by exact normalized title phrase and whole-word matches (title 6, description 2, tags 1) before `indexed_at` freshness. This prevents substring-only candidates such as `art` inside `party` from crowding out better matches before the final JavaScript ranker. The final whole-word ranker and canonical URL deduper still reject false positives and select the strongest matching duplicate. The generated SQL was tested read-only against live D1.

## Index behavior and limits

The daily refresh uses eight seed queries; it is a discovery index, not a crawler of the whole internet. It stores metadata, source links, licenses when supplied, and index timestamps. Each seed is searched across Wikimedia Commons, Flickr, and all three configured PeerTube instances. To leave headroom under Cloudflare Workers Free's 50 external-subrequest-per-invocation limit, an optional YouTube API key adds one rotating seed per day (including its duration lookup); the rotation covers all eight seeds over eight days. Live video searches still query all three PeerTube instances and optional YouTube for each user query. Old records older than 180 days are removed during refresh. The index does not store video or image files.

## Regression tests

Run the six regression suites with Node.js 22:

```sh
node --test backend/duration.test.mjs backend/indexed-search.test.mjs backend/media-ranking.test.mjs backend/media-url.test.mjs backend/video-filters.test.mjs backend/image-providers.test.mjs
```

They cover ISO-8601 duration parsing, numeric PeerTube duration normalization (including missing and invalid values), YouTube URL canonicalization, tracking-parameter deduplication, source diversity, sparse-query fallback, multi-instance PeerTube request construction and failure isolation, daily YouTube-seed rotation, whole-word relevance, Flickr feed mapping and URL safety, Flickr response caps, source/date/duration filtering, and the regression where empty optional URLs incorrectly resolved to a provider homepage. The repository includes `.github/workflows/backend-tests.yml`, which runs all six suites on relevant pushes and pull requests. Both backend and media regression workflows passed for the playback-guard pull request on 29 October 2026; the backend Node.js test log reports 56 passed and 0 failed. The live smoke workflow separates media-route checks from the original web/news API checks and rejects video embed/thumbnail URLs that point to the source homepage.

The media-route smoke check passed on 28 October 2026 (run `40656498537`): health and index-status contracts passed, image search returned 31 results across 2 source hosts, and video search returned 39 results across 12 source hosts. The legacy route job was rerun on 29 October at 07:17 UTC and passed: `/search` returned 4 results, and `/news` returned 20 results from Google News RSS. A route-contract smoke test does not guarantee every result is semantically relevant or that every external source permits embedding.

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
