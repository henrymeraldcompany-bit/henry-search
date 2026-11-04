# GOZIE SEARCH media backend

This Cloudflare Worker stores media metadata and original source links rather than re-hosting media files. It uses Wikimedia Commons, Openverse and Flickr's public photo feed for image discovery, optional Google Programmable Search when configured, PeerTube for open video search, and optionally YouTube when a server-side `YOUTUBE_API_KEY` secret is configured.

## Current deployment status

- Worker: `gozie-search-media`
- Base URL: https://gozie-search-media.henrymeraldcompany.workers.dev
- Database: Cloudflare D1 database `gozie-search-media`, bound as `MEDIA_DB`
- Scheduled discovery refresh: daily at `07:00 UTC` (`08:00 Africa/Lagos`)
- Routes: `/health`, `/images?q=...`, `/videos?q=...`, and `/index/status` (including `videoSafety.verifiedSafe` and `videoSafety.unverified`)
- The website tries this Media Worker first for image/video search and retains the original Worker and direct PeerTube fallbacks. Normal `/search` and `/news` remain on the original Worker.
- YouTube results are optional and remain disabled until `YOUTUBE_API_KEY` is added as a Worker secret. Never put that key in `app.js` or `index.html`.

The Media Worker was deployed on 2 November 2026 at 09:14:56 UTC (deployment `c484c79b-811f-478b-aabe-9f83e8ee28a8`, version `9f3302a3-d9a3-4f90-b20f-a4bd682d09f0`) with 100% of traffic assigned to that version. The original `henry-search-api` Worker was deployed on 2 November at 09:15:00 UTC (deployment `aaa610a3-1d15-4477-b702-9c86a5e42c7e`, version `8226789a-c574-4999-b98a-f4fb2d2fdcd7`). Cloudflare confirms the media Worker retains the `MEDIA_DB` binding and daily `0 7 * * *` trigger. Cloudflare confirms the `MEDIA_DB` binding and daily `0 7 * * *` trigger. The D1 safety migration `20261031_video_nsfw_safety.sql` and index-metrics migration `20261101_index_run_metrics.sql` are applied. Indexed-media lookup retrieves up to 100 candidates (hard cap 120), prioritizes exact title phrases, then a normalized whole-word score (title 6, description 2, tags 1), then freshness. Video lookup returns only rows explicitly classified safe (`nsfw=0`); unverified rows remain hidden until refreshed. The index-status response reports verified-safe and unverified video counts separately, plus per-provider metrics after each new-format scheduled run. The final whole-word ranker and canonical URL deduper still decide which results are returned. Empty or whitespace-only URL fields stay empty instead of resolving to a provider homepage; rows without a valid watch URL are rejected.

The latest scheduled index run finished at 2026-11-02 07:01:28 UTC: 338 media metadata rows saved, with 2 Openverse timeouts and no database-save failures. Per-provider metrics: Wikimedia Commons 6/6 successful calls and 72 rows saved; Flickr public feed 6/6 and 72 rows; PeerTube 6/6 and 194 rows; Openverse 2 attempts, both failed, then disabled for the remainder of the run. The run used 20 provider calls and took about 29.9 seconds. D1 currently contains 1,502 media metadata records: 954 images and 548 videos; 336 videos are verified safe and 212 remain unverified, across 49 distinct video source hosts. The 2 November run occurred before webpage/news indexing was deployed at 08:51 UTC, so `search_index_items` is still empty; the 3 November 07:00 UTC refresh is the first scheduled run expected to populate it. Live PeerTube search remains active and safe-filtered. Post-deployment media smoke checks passed: 40 images across 2 source hosts/3 providers, 40 videos across 15 source hosts/15 providers, and the published Chromium playback-control test. The original web-search route returned 11 results. The live news route remains degraded because GDELT timed out, Google News RSS returned HTTP 503, and Bing News RSS returned no readable articles; the newly deployed daily-index fallback is covered by tests but has no indexed rows to serve until the next scheduled refresh.

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


## Legacy video canonical-key backfill

The migration `migrations/20261102_backfill_video_canonical_keys.sql` fills missing canonical identities for legacy video rows only when the original watch URL is already a normalized HTTPS URL. It deliberately skips URLs with query strings, fragments, a `www.` prefix, credentials, or a trailing slash so it cannot silently collapse distinct provider URLs. It does not alter the safe/unverified `nsfw` classification or delete media rows. New discoveries continue to receive canonical keys through the Worker save path.

## Regression tests

Run the regression suites with Node.js 22:

```sh
node --test backend/duration.test.mjs backend/indexed-search.test.mjs backend/media-ranking.test.mjs backend/media-url.test.mjs backend/video-filters.test.mjs backend/image-providers.test.mjs backend/video-search.test.mjs backend/index-refresh.test.mjs backend/video-safety.test.mjs
```

They cover ISO-8601 duration parsing, numeric PeerTube duration normalization, strict PeerTube/YouTube safe-search settings, rejection of unclassified video results, D1 safe-by-default filtering, rotating seed coverage, provider circuit breaking, YouTube seed rotation, whole-word relevance, source diversity, deduplication, Flickr feed mapping and URL safety, and source/date/duration filters. The repository includes `.github/workflows/backend-tests.yml`, which runs all six suites on relevant pushes and pull requests. Both backend and media regression workflows passed for the playback-guard pull request on 29 October 2026; the backend Node.js test log reports 56 passed and 0 failed. The live smoke workflow separates media-route checks from the original web/news API checks and rejects video embed/thumbnail URLs that point to the source homepage.

The media-route smoke check passed on 28 October 2026 (run `40656498537`): health and index-status contracts passed, image search returned 31 results across 2 source hosts, and video search returned 39 results across 12 source hosts. The legacy route job was rerun on 29 October at 07:17 UTC and passed: `/search` returned 4 results, and `/news` returned 20 results from Google News RSS. A route-contract smoke test does not guarantee every result is semantically relevant or that every external source permits embedding.

## Redeploy or reproduce setup

The checked-in `backend/wrangler.toml` contains the configured D1 database ID and daily cron trigger. The migration `backend/migrations/20261031_video_nsfw_safety.sql` was applied to production before the 31 October 2026 Worker deployment. For a new D1 database, apply it once after the base schema and before deploying the Worker version that writes/queries the column. From the repository root, with Wrangler logged into the correct Cloudflare account:

```sh
npx wrangler d1 execute gozie-search-media --remote --file=backend/migrations/20261031_video_nsfw_safety.sql --config backend/wrangler.toml
npx wrangler d1 execute gozie-search-media --remote --file=backend/migrations/20261101_index_run_metrics.sql --config backend/wrangler.toml
npx wrangler d1 execute gozie-search-media --remote --file=backend/schema.sql --config backend/wrangler.toml
npx wrangler deploy --config backend/wrangler.toml
```

To enable YouTube results, configure the optional API key as a server-side Worker secret:

```sh
npx wrangler secret put YOUTUBE_API_KEY --config backend/wrangler.toml
```

Enter the secret interactively. Never commit it or include it in frontend code. Free-tier quotas and provider terms apply; the daily index covers only configured seed queries and returned provider results.

### Index-status provider diagnostics and run metrics

`GET /index/status` returns `counts`, `videoSafety`, `latestRun`, and `failureSummary`. The failure summary groups the latest run's bounded note by provider and stage (`request`, `database-save`, or `unknown`). The latest run also exposes a parsed `stats` object: rotating seeds processed, provider calls, request failures, database-save failures, metadata rows received/saved, duration, disabled providers, and per-provider attempt/success/failure/row counts. These metrics are written to `index_runs.stats_json` by the daily Worker run. The migration `20261101_index_run_metrics.sql` adds this backward-compatible JSON column; legacy runs without metrics return `stats: null` until the next scheduled refresh. This avoids additional D1 reads and does not store media files.


### Daily webpage and news indexing

The daily Media Worker indexes one rotating webpage/news topic into the same D1 database, in a separate `search_index_items` table. DuckDuckGo Instant Answer and Wikipedia provide webpage metadata. News discovery queries GDELT, Google News RSS and Bing News RSS independently and concurrently; a provider failure or empty response does not prevent the other providers from contributing. The merger canonicalizes article URLs, removes cross-provider duplicates, and retains publisher and provider attribution plus the strongest available snippet and publication metadata. This path has a hard maximum of five external requests and 40 stored webpage/news rows per scheduled run, and the overall retry allowance preserves Workers Free request headroom.

The migration `backend/migrations/20261102_search_index_items.sql` is included for reproducible setup. The production D1 database was inspected before the Task 52 deployment and already contained the expected empty table and supporting indexes, so it was preserved rather than recreated. For a new database, apply the migration once after the base schema and before deploying the Worker:

```sh
npx wrangler d1 execute gozie-search-media --remote --file=backend/migrations/20261102_search_index_items.sql --config backend/wrangler.toml
```

Use `GET /index/search?kind=web&q=...` or `GET /index/search?kind=news&q=...` to inspect indexed records. `GET /index/status` includes `searchCounts`.


### Task 52 deployment record — 2 November 2026

The webpage/news indexing Worker was uploaded successfully on 2 November 2026 at 08:51:37 UTC. Cloudflare version ID: `102b64ea-4557-473c-b528-8f655031f8fc`; script tag: `b4b2b7e73ad6492fa342d5584f976fff`. The upload retained the existing `MEDIA_DB` binding and the daily `0 7 * * *` UTC trigger (08:00 Nigeria time). Cloudflare confirmed the Worker entry point and both `fetch` and `scheduled` handlers.

Before deployment, the production D1 database was inspected: `search_index_items` and its three supporting indexes already existed with the expected schema and contained no records, so the existing table was preserved. The deployment API accepted the complete module graph; external HTTP smoke testing was unavailable from the deployment environment, so live route responses remained to be independently confirmed.


### Task 53 deployment record — 2 November 2026

The Worker was updated with concurrent multi-source news discovery and deployed to 100% of traffic. Cloudflare deployment ID: `01bf2be0-b168-4581-b242-557ac70fe87c`; version ID: `cb6da970-87b6-4bdb-adb9-a164a23ca172`. The existing `MEDIA_DB` binding, compatibility date and daily `0 7 * * *` UTC schedule were verified after upload. The live HTTP smoke-test URLs were inaccessible from the management environment, and GitHub reported no commit status checks for this commit; therefore runtime endpoint responses and automated test execution remain unverified.


### Multi-provider contribution metrics

When several web/news providers return the same canonical article, the index stores one deduplicated row with all contributing provider names. Per-provider metrics expose both `rowsSaved` (the provider that supplied the primary saved row) and `rowsContributed` (every provider that contributed to a saved canonical row). The top-level `rowsSaved` remains the unique row count; `rowsContributed` is intentionally additive across providers and can be higher when providers overlap. The 2 November Worker deployment includes this metric; the first scheduled run after that deployment will expose it for the daily web/news rows as well.


### Live news outage fallback

The original `henry-search-api` Worker keeps GDELT and the two RSS feeds as live news sources. Only when all live sources fail or return no readable articles does it make one bounded request to the Media Worker's `/index/search?kind=news` endpoint. This fallback uses stored metadata and original article URLs; it does not copy or re-host article content. It is useful after the first successful daily webpage/news index run, but it cannot return indexed articles while that table is still empty.

### Task 77 — Search API Workers Cache deployment — 4 November 2026

The original `henry-search-api` Worker now uses Cloudflare Workers Cache for reusable `/search`, `/news`, and `/images` responses. The default gateway entrypoint remains uncached so it executes on every request to enforce rate limits and rebuild origin-specific CORS headers. The named `CachedSearch` entrypoint is cache-enabled. Equivalent search queries are normalized into the same path/query cache key. Successful cacheable responses use a 60-second freshness lifetime with a 300-second stale-while-revalidate window; errors, webpage extraction, and requests carrying Authorization are not cached.

Cloudflare deployment ID: `35f85233-a203-4594-b6b9-a08f5b531c48`; version ID: `21417aed-da88-4047-b0ce-518bc4768293`. Cloudflare confirmed the version receives 100% of traffic, Workers Cache is enabled, the default entrypoint is explicitly cache-disabled, the `CachedSearch` entrypoint is cache-enabled, and both existing rate-limit bindings remain configured (`API_RATE_LIMITER` 120/minute and `API_EXTRACT_RATE_LIMITER` 12/minute). The backend regression workflow passed 231 tests with zero failures. The production cache HIT/MISS smoke check is being run separately after deployment.
