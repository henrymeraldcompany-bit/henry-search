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

The Media Worker was deployed on 31 October 2026 at 08:33:33 UTC (deployment `87f59237-8cd7-4aff-bc70-d1245725de37`, version `d0792659-f5a3-4147-997f-da4ddfbb21b2`) with 100% of traffic assigned to that version. Cloudflare confirms the `MEDIA_DB` binding and daily `0 7 * * *` trigger. The D1 safety migration was applied before deployment. Indexed-media lookup retrieves up to 100 candidates (hard cap 120), prioritizes exact title phrases, then a normalized whole-word score (title 6, description 2, tags 1), then freshness. Video lookup returns only rows explicitly classified safe (`nsfw=0`); legacy rows default to unverified and remain hidden until refreshed. The final whole-word ranker and canonical URL deduper still decide which results are returned. Empty or whitespace-only URL fields stay empty instead of resolving to a provider homepage; rows without a valid watch URL are rejected.

The latest scheduled index run finished at 2026-10-31 07:02:05 UTC: 465 rows processed with 8 provider timeouts; that run predates provider-labelled diagnostics. D1 contains 940 metadata records: 674 images and 266 videos across 32 distinct source hosts. The safety migration has set all pre-existing video rows to unverified, so the 266 legacy video rows are hidden from indexed lookup until safe re-indexing. Live PeerTube search remains active and safe-filtered; the next scheduled refresh is 1 November at 07:00 UTC (08:00 Nigeria).

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

Video search merges indexed results with live searches against three public PeerTube instances (`peertube.tv`, `peer.tube`, and `spectra.video`) plus optional YouTube results. Every PeerTube request sends the official `nsfw=false` filter and only results explicitly marked safe are normalized; unknown/flagged results are rejected. Optional YouTube requests use `safeSearch=strict`. Indexed video rows are safe-by-default: the new D1 `nsfw` column defaults to 1 (unverified), and video lookup returns only `nsfw=0` rows. Relative video URLs resolve against the instance that returned them. URL canonicalization removes common tracking parameters and collapses equivalent YouTube watch/short/embed links. Ranking uses whole-word and phrase-boundary matches to avoid false positives from substrings (for example, `art` inside `party`), sorts candidates before canonical URL deduplication so the strongest provider variant wins, limits source-host dominance on the first pass, then fills remaining places with the closest available matches. If fewer than eight unique results are found, the Worker retries once with a focused query. Blank or whitespace-only provider URL fields are rejected/kept empty rather than being resolved by `new URL("", base)` to the provider homepage; a result without a usable watch URL is dropped, and missing embed/thumbnail URLs remain optional instead of becoming false homepage links.

The frontend supports source, upload-date, and duration filters, including a past-year option. Its direct PeerTube fallback also sends `nsfw=false`, accepts only explicitly safe rows, and refuses API responses that do not confirm the Media Worker's safe-search contract. ISO-8601 durations (for example, `PT4M` or `PT1H2M3S`) are normalized for duration filtering. YouTube playback accepts only a matching video ID and uses the privacy-enhanced embed host when falling back. PeerTube playback accepts canonical HTTPS `/videos/embed/{id}` player URLs on the source origin or on the three exact configured search instances (`peertube.tv`, `peer.tube`, and `spectra.video`). Other cross-origin hosts, lookalike hosts, custom ports, insecure URLs, credential-bearing URLs, and non-player paths are rejected. Only one inline player stays active: starting another video or changing filters removes the previous iframe. Original source links remain available; actual playback on the published site still needs browser verification.

## Indexed candidate shortlist

The D1 lookup considers up to 100 stored candidates per query (hard cap 120). The SQL prefilter remains broad enough to avoid missing punctuation variants, but it ranks candidates by exact normalized title phrase and whole-word matches (title 6, description 2, tags 1) before `indexed_at` freshness. This prevents substring-only candidates such as `art` inside `party` from crowding out better matches before the final JavaScript ranker. The final whole-word ranker and canonical URL deduper still reject false positives and select the strongest matching duplicate. The generated SQL was tested read-only against live D1.

## Index behavior and limits

The daily refresh rotates six seeds per day from a 24-topic discovery bank, completing a four-day cycle; it is not a crawler of the whole internet. It stores metadata, source links, licenses when supplied, and index timestamps. Each selected seed is searched across Wikimedia Commons, Openverse, Flickr, and all three configured PeerTube instances. This uses at most 36 provider requests per normal daily run (plus two optional YouTube calls), leaving headroom below Cloudflare Workers Free's 50 external-subrequest-per-invocation ceiling; an optional YouTube API key adds one strict-safe search and one duration lookup for a rotating seed. A provider is disabled for the remainder of that daily run after two consecutive request failures, preventing repeated timeouts from consuming the full run. Live video searches still query all three PeerTube instances and optional YouTube for each user query. Old records older than 180 days are removed during refresh. The index does not store video or image files.

## Regression tests

Run the regression suites with Node.js 22:

```sh
node --test backend/duration.test.mjs backend/indexed-search.test.mjs backend/media-ranking.test.mjs backend/media-url.test.mjs backend/video-filters.test.mjs backend/image-providers.test.mjs backend/index-refresh.test.mjs backend/video-safety.test.mjs
```

They cover ISO-8601 duration parsing, numeric PeerTube duration normalization, strict PeerTube/YouTube safe-search settings, rejection of unclassified video results, D1 safe-by-default filtering, rotating seed coverage, provider circuit breaking, YouTube seed rotation, whole-word relevance, source diversity, deduplication, Flickr feed mapping and URL safety, and source/date/duration filters. The repository includes `.github/workflows/backend-tests.yml`, which runs all six suites on relevant pushes and pull requests. Both backend and media regression workflows passed for the playback-guard pull request on 29 October 2026; the backend Node.js test log reports 56 passed and 0 failed. The live smoke workflow separates media-route checks from the original web/news API checks and rejects video embed/thumbnail URLs that point to the source homepage.

The media-route smoke check passed on 28 October 2026 (run `40656498537`): health and index-status contracts passed, image search returned 31 results across 2 source hosts, and video search returned 39 results across 12 source hosts. The legacy route job was rerun on 29 October at 07:17 UTC and passed: `/search` returned 4 results, and `/news` returned 20 results from Google News RSS. A route-contract smoke test does not guarantee every result is semantically relevant or that every external source permits embedding.

## Redeploy or reproduce setup

The checked-in `backend/wrangler.toml` contains the configured D1 database ID and daily cron trigger. The migration `backend/migrations/20261031_video_nsfw_safety.sql` was applied to production before the 31 October 2026 Worker deployment. For a new D1 database, apply it once after the base schema and before deploying the Worker version that writes/queries the column. From the repository root, with Wrangler logged into the correct Cloudflare account:

```sh
npx wrangler d1 execute gozie-search-media --remote --file=backend/migrations/20261031_video_nsfw_safety.sql --config backend/wrangler.toml
npx wrangler d1 execute gozie-search-media --remote --file=backend/schema.sql --config backend/wrangler.toml
npx wrangler deploy --config backend/wrangler.toml
```

To enable YouTube results, configure the optional API key as a server-side Worker secret:

```sh
npx wrangler secret put YOUTUBE_API_KEY --config backend/wrangler.toml
```

Enter the secret interactively. Never commit it or include it in frontend code. Free-tier quotas and provider terms apply; the daily index covers only configured seed queries and returned provider results.
