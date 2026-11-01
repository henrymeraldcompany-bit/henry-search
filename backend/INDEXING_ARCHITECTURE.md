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

The Worker invokes the refresh from its `scheduled()` handler and attaches it to the execution context with `ctx.waitUntil()`. A refresh failure is logged. The public `/index/status` route reports indexed counts, safe/unverified video counts, the latest run and grouped failure information.

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

The normal maximum is approximately 36 provider HTTP requests per run: six seeds multiplied by six requests (one Wikimedia, one Openverse, one Flickr, and three PeerTube instances). Optional YouTube adds its search and duration lookup for the selected seed. This is the planned request budget, not a guarantee that every provider request succeeds.

Provider calls for a seed are settled independently with `Promise.allSettled`. One rejected provider does not discard successful results from the others. External requests use the shared bounded JSON-fetch helper and its eight-second timeout.

A per-run provider circuit breaker disables a provider after two consecutive request failures during that run. A success resets that provider's failure streak. The breaker is in-memory and resets on the next scheduled invocation; it is not a persistent cross-day circuit breaker.

## 5. Normalization, safety and persistence

1. Provider-specific adapters map responses into a common media metadata shape.
2. URL and required-field validation rejects unusable source records.
3. Video normalization accepts only explicit safe classification (`nsfw === false`); unknown or flagged videos are not indexed.
4. Openverse requests exclude mature content. Optional YouTube uses `safeSearch=strict`.
5. Rows are written to D1 table `media_items` using an upsert keyed by `(kind, source, page_url)`. Repeated discoveries refresh metadata and `indexed_at` instead of creating duplicate rows.
6. Prepared statements are sent in D1 batches of up to 40.
7. Records older than 180 days by `indexed_at` are deleted after the provider loop.

The index stores titles, descriptions, source identifiers, original page/media/thumbnail/embed URLs, attribution or license metadata where available, publication dates, duration, tags, safety classification and indexing timestamps. It does not store media binaries.

Flickr's public feed does not provide reliable license metadata; those rows must remain labelled as having unavailable license information. Consumers should check the original source before reuse.

## 6. Run records and observability

Each completed refresh writes one row to `index_runs` containing:

- completion timestamp;
- rows processed/saved;
- failure count and a bounded provider-labelled note;
- versioned `stats_json` metrics.

The metrics include seeds processed, provider calls, request failures, database-save failures, rows received/saved, disabled providers, duration, and per-provider attempts/successes/failures/row counts. The metrics column was added compatibly by `20261101_index_run_metrics.sql`; older run rows may have no detailed metrics and are parsed as `null`.

`GET /index/status` is the operational read surface. It returns per-kind totals, verified-safe and unverified video totals, the latest run and grouped failure summaries. It should be used to distinguish a successful schedule invocation from a run in which individual providers failed or returned no records.

## 7. Failure boundaries and recovery characteristics

- **Provider request failure:** record the provider failure, apply the per-run circuit breaker and continue with other providers/seeds.
- **D1 save failure:** record a database-save failure separately from a provider request failure; continue processing other settled provider results where possible.
- **Individual PeerTube instance failure:** preserve results from successful instances; fail the PeerTube provider call only when all configured instances fail.
- **Refresh-level failure:** log the scheduled refresh failure. The next cron invocation is the next automatic attempt.
- **Duplicate discovery:** D1 upsert refreshes the existing canonical source row.
- **Stale metadata:** records older than 180 days are pruned after a refresh.

The current design does not persist per-seed checkpoints, resume a partially completed run, or maintain a distributed lock. The rotation is date-derived rather than advanced by a mutable cursor. Those are explicit characteristics of the present baseline, not guarantees of exactly-once processing.

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
