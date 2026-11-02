# GOZIE SEARCH daily indexing architecture

**Status:** Architecture design baseline  
**Scope:** The scheduled media-metadata indexer in the Cloudflare Media Worker and its Cloudflare D1 database. This document describes the existing implementation and records the design boundaries for subsequent indexing work. It does not define a general web crawler.

## 1. Goals and non-goals

### Goals

- Refresh a bounded, rotating set of image and video discovery metadata once per day.
- Keep the index useful without making every provider failure fatal to the whole run.
- Stay within Cloudflare Workers execution and external-subrequest limits, including the Free plan's 50-subrequest-per-invocation ceiling.
- Store metadata and original source URLs only; do not copy or re-host media files.
- Make refresh outcomes inspectable through run-level and provider-level metrics.
- Keep video indexing safe-by-default: only explicitly classified safe videos may enter searchable indexed results.

### Non-goals

- Crawling the whole internet or guaranteeing exhaustive coverage of any topic.
- Downloading image/video files.
- Replacing live search: indexed results complement live provider search.
- Promising that third-party providers are always available or that every external media URL will play.

## 2. High-level flow

```mermaid
flowchart TD
    A[Cloudflare Cron<br/>07:00 UTC daily] --> B[Worker scheduled handler]
    B --> C[Select six rotating seeds<br/>from 24-topic bank]
    C --> D[For each seed]
    D --> E[Query configured providers]
    E --> F[Normalize and validate metadata]
    F --> G[Upsert rows into D1<br/>batches of up to 40]
    G --> H[Continue to next seed]
    H -->|More seeds| D
    H -->|Finished| I[Delete records older than 180 days]
    I --> J[Write index_runs summary + provider metrics]
    J --> K[/index/status exposes latest run]
```

The Worker invokes the refresh from its `scheduled()` handler and attaches the returned promise to the execution context with `ctx.waitUntil()`, allowing Cloudflare to keep the background work alive for the invocation. The deployed Cloudflare Worker is configured with the same `0 7 * * *` UTC trigger as `backend/wrangler.toml` (08:00 in Nigeria), and the D1 `index_runs` history is the execution record used to confirm that the schedule is firing. A refresh failure is logged. The public `/index/status` route reports indexed counts, safe/unverified video counts, the latest run and grouped failure information. Regression tests verify both the cron expression and the scheduled-handler-to-`waitUntil` wiring.

## 3. Schedule and seed rotation

- Cloudflare cron: `0 7 * * *` UTC, which is 08:00 in Nigeria (`Africa/Lagos`).
- Discovery bank: 24 fixed topic seeds in `backend/worker.js`.
- Daily batch: six seeds, selected deterministically from the UTC day slot.
- Coverage cycle: four days for one complete pass through the 24-seed bank, assuming normal daily executions.
- Optional YouTube indexing: only when the server-side `YOUTUBE_API_KEY` secret exists; one selected seed in the daily batch receives the YouTube search and duration-enrichment calls.

The rotation spreads a bounded discovery budget across topics. It is not a continuously expanding crawl and does not promise that every provider returns new rows each day.

## 4. Provider fan-out and request budget

For each selected seed, the current implementation queries:

| Provider | Indexed kind | Per-seed behavior |
|---|---|---|
| Wikimedia Commons | Images | One metadata search |
| Openverse | Images | One metadata search with mature-content filtering |
| Flickr public photos feed | Images | One public-feed query |
| PeerTube | Videos | Three configured instances queried independently |
| YouTube | Videos | Optional; one rotating seed when the API secret is configured |

The normal maximum is 36 provider HTTP requests per run: six seeds multiplied by six requests (one Wikimedia, one Openverse, one Flickr, and three PeerTube instances). Optional YouTube adds at most its search and duration-lookup requests for the selected seed, giving a baseline maximum of 38. The Worker explicitly reserves three of the Workers Free plan's 50 external subrequests and derives the run-wide retry allowance from the remaining headroom. With the current three-instance PeerTube fan-out, no more than three retries are allowed; even if every retry repeats all three PeerTube requests, the calculated maximum is 47 external subrequests, leaving the three-request reserve intact. Changing the seed count, provider fan-out, or YouTube enrichment must update the derived budget tests rather than silently increasing usage.

Provider calls for a seed are settled independently with `Promise.allSettled`. One rejected provider does not discard successful results from the others. External requests use the shared bounded JSON-fetch helper and its eight-second timeout. A single run-wide retry budget permits at most three additional provider attempts, with one retry maximum per logical provider/seed call. Retries apply only to transient network failures, request timeouts, HTTP 408/425/429, and HTTP 5xx responses. Each retry waits for a short 200–299 ms jittered delay. Permanent HTTP 4xx responses and malformed JSON are not retried. The budget is shared across all providers and seeds; it is exhausted after three retries, so worst-case fan-out remains bounded (at most nine extra external requests if all three retries repeat the three-instance PeerTube call). Provider attempt metrics include retries; final provider failure counts remain one per logical call that ultimately fails. D1 writes are not retried: a failed batch is recorded separately, and canonical upserts prevent duplicate rows if a later scheduled run rediscovers the same media.

A per-run provider circuit breaker disables a provider after two consecutive request failures during that run. A success resets that provider's failure streak. The breaker is in-memory and resets on the next scheduled invocation; it is not a persistent cross-day circuit breaker.

## 5. Normalization, safety and persistence

1. Provider-specific adapters map responses into a common media metadata shape.
2. URL and required-field validation rejects unusable source records.
3. Video normalization accepts only explicit safe classification (`nsfw === false`); unknown or flagged videos are not indexed.
4. Openverse requests exclude mature content. Optional YouTube uses `safeSearch=strict`.
5. Rows are written to D1 table `media_items` using an upsert keyed by `(kind, source, page_url)`. Repeated discoveries refresh metadata and `indexed_at` instead of creating duplicate rows.
6. Prepared statements are sent in D1 batches of up to 40.
7. Records older than 180 days by `indexed_at` are pruned in batches of at most 500 rows per daily run, so a large backlog cannot create an unbounded delete operation.
8. A record is considered fresh for 30 days after its last successful metadata refresh. Freshness is based on `indexed_at` (not the original publication date). Missing or unparsable indexing timestamps are counted as stale, so the per-kind freshness totals always reconcile with the indexed-row total. The status summary also reports the oldest and newest stored indexing timestamps for each kind. Stale rows remain searchable as a fallback until the 180-day retention cutoff; freshness is a ranking signal, not a hard search filter.

The index stores titles, descriptions, source identifiers, original page/media/thumbnail/embed URLs, attribution or license metadata where available, publication dates, duration, tags, safety classification and indexing timestamps. It does not store media binaries.

Flickr's public feed does not provide reliable license metadata; those rows must remain labelled as having unavailable license information. Consumers should check the original source before reuse.

## 5A. Video-index persistence contract

Video records share the `media_items` table with images and are isolated by
`kind='video'`. The common row stores the original watch/page URL, media URL,
thumbnail and embed URLs, source/provider identity, title, description, creator,
publication timestamp, duration in seconds, tags, safe-content classification,
and indexing timestamp. The existing unique key `(kind, source, page_url)`
keeps an image and a video from colliding and makes repeated video discoveries
an upsert rather than a duplicate row.

Video duration is stored only as a finite, non-negative numeric number of
seconds; missing, malformed, infinite, or negative values become SQL NULL.
A real zero-second duration remains valid. Video safety is fail-closed:
only an explicit numeric safe classification of zero is stored as verified
safe; all other or missing values are stored as unverified (1), and video
search only returns rows with `nsfw=0`. Missing duration metadata does not
erase an earlier known duration during an upsert.

Regression coverage lives in `backend/video-index-database.test.mjs` and is
part of the backend CI workflow. It checks video field persistence, duration
normalization, safe-by-default behavior, and metadata-preserving updates.

## 6. Run records and observability

Each completed refresh writes one row to `index_runs` containing:

- completion timestamp;
- rows processed/saved;
- failure count and a bounded provider-labelled note;
- versioned `stats_json` metrics.

The metrics include seeds processed, provider calls, request failures, database-save failures, rows received/saved/skipped by the run-wide indexing cap, disabled providers, duration, and per-provider attempts/successes/failures/row counts. Freshness summaries report fresh/stale counts and the oldest/newest indexed timestamps per media kind; invalid timestamps are included in stale counts rather than disappearing from the breakdown. The metrics column was added compatibly by `20261101_index_run_metrics.sql`; older run rows may have no detailed metrics and are parsed as `null`.

`GET /index/status` is the operational read surface. It returns per-kind totals, fresh/stale counts, the freshness and retention policy, verified-safe and unverified video totals, the latest run and grouped failure summaries. Search ordering preserves phrase and relevance ranking first, then prefers fresh records when relevance is tied. It should be used to distinguish a successful schedule invocation from a run in which individual providers failed or returned no records.

## 7. Failure boundaries and recovery characteristics

- **Provider request failure:** retry only transient network/timeout and HTTP 408/425/429/5xx failures within a shared three-retry run budget, then record any final provider failure, apply the per-run circuit breaker and continue with other providers/seeds.
- **Permanent provider response:** do not retry malformed JSON or non-retryable HTTP 4xx responses.
- **Retry exhaustion:** stop retrying when the shared run budget is empty; record the final failure once for that logical provider/seed call.
- **D1 save failure:** record a database-save failure separately from a provider request failure; continue processing other settled provider results where possible.
- **Individual PeerTube instance failure:** preserve results from successful instances; fail the PeerTube provider call only when all configured instances fail.
- **Refresh-level failure:** log the scheduled refresh failure. The next cron invocation is the next automatic attempt.
- **Duplicate discovery:** D1 upsert refreshes the existing canonical source row.
- **Freshness:** metadata refreshed within 30 days is classified as fresh; older records remain searchable but are ranked behind equally relevant fresh records.
- **Retention:** records older than 180 days are pruned after a refresh.

The current design does not persist per-seed checkpoints, resume a partially completed run, or maintain a distributed lock. The rotation is date-derived rather than advanced by a mutable cursor. Those are explicit characteristics of the present baseline, not guarantees of exactly-once processing.

## 7A. Free-tier resource protection

The daily indexer applies explicit per-invocation limits rather than relying only on provider defaults:

- External provider requests: 50 is the Workers Free hard ceiling; three are reserved. The derived retry allowance currently caps the worst-case planned run at 47.
- Discovery: at most six rotating seeds per day.
- Indexed metadata: at most 440 rows are queued for D1 writes per run (432 possible image/PeerTube rows plus up to eight optional YouTube rows). Excess provider results are counted as skipped, not written.
- D1 writes: prepared statements are sent in batches of at most 40. A shared D1 query budget permits at most 45 non-reserved query calls, holding five for cleanup/summary headroom.
- Retention cleanup: at most 500 expired rows are deleted per daily run; a larger backlog is drained gradually.
- Under the current fan-out, at most 30 provider-save batches plus one bounded cleanup and one run-summary write are expected (32 D1 query calls). The five-query reserve leaves room for operational variation.
- Cloudflare Workers Free currently documents 100,000 Worker requests/day and 10 ms CPU per Cron invocation. D1 Free documents 5 million rows read/day, 100,000 rows written/day, and 500 MB maximum database size. The indexer limits only its own workload; these are account-level quotas shared with other Workers and D1 activity, not guaranteed dedicated capacity.

The row and request limits are regression-tested. If providers, seed counts, response caps, or enrichment calls change, update the calculated budgets and tests together.

## 8. Data model and configuration

- D1 binding: `MEDIA_DB`.
- Main table: `media_items`; unique key `(kind, source, page_url)`.
- Run table: `index_runs`.
- Base schema: `backend/schema.sql`.
- Run-metrics migration: `backend/migrations/20261101_index_run_metrics.sql`.
- Worker configuration and cron: `backend/wrangler.toml`.
- Optional secret: `YOUTUBE_API_KEY`; it must remain a Worker secret and must never be placed in frontend files or committed source.

## 9. Design invariants for future changes

1. Preserve the 08:00 Nigeria daily schedule unless a later task explicitly changes it.
2. Preserve the D1 binding and existing database identity during Worker deployments.
3. Keep the request budget bounded and recalculate it whenever providers, per-seed fan-out, or enrichment calls change.
4. Keep provider failures isolated; never let one optional provider disable successful sources.
5. Keep metadata-only storage and canonical source attribution.
6. Keep video records unsearchable until explicit safe classification is established.
7. Keep secrets server-side.
8. Extend run metrics and regression tests whenever indexing behavior changes.
9. Treat the index as a discovery supplement to live search, not as a complete web index.

## 10. Related implementation and verification

- Worker and provider adapters: `backend/worker.js`
- D1 schema: `backend/schema.sql`
- Cron and D1 binding: `backend/wrangler.toml`
- Run-metrics migration: `backend/migrations/20261101_index_run_metrics.sql`
- Indexing regression tests: `backend/index-refresh.test.mjs`
- Operational setup and current deployment notes: `backend/README.md`

The architecture is considered documented when the schedule, seed selection, provider fan-out, request budget, normalization/safety boundary, persistence model, retention policy, metrics, and failure behavior can be traced to these implementation files and checked by the backend regression suite.


### 5B. Video metadata enrichment and refresh behavior

PeerTube normalization stores the provider label, creator display name and
profile URL when supplied, available tags, publication date, duration, and
watch/thumbnail/embed URLs. YouTube normalization stores its provider label,
channel name and canonical channel URL; duration is enriched through the
video-details endpoint. Fields not supplied by a provider remain empty or
NULL rather than being fabricated.

On repeat discoveries, the D1 upsert refreshes populated metadata while
preserving existing creator links, provider labels, playback URLs, publication
dates, tags, and known duration when the new response omits them. Safety
classification is deliberately refreshed on every update so an item no longer
explicitly marked safe cannot retain a verified-safe status.


## 5C. Canonical index deduplication

The persistent media index applies a canonical identity before each write.
Video records use a normalized canonical watch/page URL; YouTube short, watch,
embed and Shorts variants resolve to the same YouTube watch identity. Image
records use the normalized original media URL rather than the containing page,
because one gallery page may legitimately contain multiple different images.
Normalization removes URL fragments and common tracking parameters, normalizes
host casing and `www.`, sorts meaningful query parameters, and removes default
ports/trailing slashes. Meaningful query parameters are retained.

D1 partial unique indexes enforce the canonical identity independently of the
provider/source label. A conflict updates the existing row's available metadata
instead of creating a second row. Existing source/page uniqueness remains as a
compatibility guard. The index does not merge images solely because they share
a page, nor does it use title similarity as proof that two different media files
are identical. Canonical identity fields are populated as records are refreshed
after the migration; older untouched rows retain their legacy identity until
they are rediscovered.


## 11. Daily webpage and news discovery

The daily run now adds one rotating topic from the existing 24-topic discovery bank to the webpage and news index. DuckDuckGo Instant Answer and Wikipedia search are queried independently for webpage metadata. News discovery tries GDELT first, then Google News RSS and Bing News RSS only when earlier sources return no usable articles. Provider failures are isolated and recorded in the existing `index_runs.stats_json` metrics.

The webpage/news discovery path has a hard allocation of five external requests per scheduled run: two webpage providers and up to three sequential news providers. It indexes at most 20 webpage records and 20 news records (40 total) per run. This allocation is included in the overall Workers Free request-budget calculation; the shared media-provider retry allowance is reduced accordingly so the planned total remains below the 50 external-subrequest ceiling with reserved headroom.

Webpage/news metadata is stored in `search_index_items`, separate from `media_items` because the media table intentionally restricts its kind to images and videos. The new table stores canonical URL, title, snippet, domain, publisher/provider attribution, publication date and index timestamp. It never downloads or re-hosts page content. Existing safe webpage retrieval and text extraction remain available through the original search Worker. The media Worker exposes `/index/search?kind=web|news&q=...` for bounded readback and includes per-kind totals in `/index/status`.

Migration: `backend/migrations/20261102_search_index_items.sql`. Apply this migration to the existing D1 database before deploying the Worker version that writes to the new table. The base `backend/schema.sql` also includes the table for new installations.
