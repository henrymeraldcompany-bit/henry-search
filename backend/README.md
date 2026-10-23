# GOZIE SEARCH media backend

This Cloudflare Worker stores media metadata and original source links rather than re-hosting media files. It uses Wikimedia Commons for images and PeerTube for open video search, and optionally YouTube when a server-side `YOUTUBE_API_KEY` secret is configured.

## Current deployment status

- Worker: `gozie-search-media`
- Base URL: https://gozie-search-media.henrymeraldcompany.workers.dev
- Database: Cloudflare D1 database `gozie-search-media`, bound as `MEDIA_DB`
- Scheduled discovery refresh: daily at `07:00 UTC` (`08:00 Africa/Lagos`)
- Routes: `/health`, `/images?q=...`, `/videos?q=...`, and `/index/status`
- The website tries this Media Worker first for image/video search and retains the original Worker and direct PeerTube fallbacks. Normal `/search` and `/news` remain on the original Worker.
- YouTube results are optional and remain disabled until `YOUTUBE_API_KEY` is added as a Worker secret. Never put that key in frontend code.

Cloudflare confirmed the Media Worker deployment at 2026-10-23 08:37:15 UTC, with 100% of traffic assigned to that version. Its latest verified scheduled index run finished at 2026-10-23 07:01:08 UTC: 192 rows processed, zero recorded provider/database failures, and 191 unique stored records (96 images, 95 videos across five PeerTube hostnames). The D1 database and `0 7 * * *` schedule were verified through Cloudflare management APIs.

The 23 October deployment adds a bounded sparse-query fallback: if fewer than eight unique results are available, it retries once with a focused query after removing common filler words, then merges and re-ranks the results through the existing deduplicator. This only spends additional provider requests for sparse searches.

Live HTTP smoke tests remain unverified because this management environment blocks outgoing requests to `workers.dev` hosts. Deployment metadata and a successful scheduled index run are verified, but they do not prove that every browser-visible route works. Check the routes from a normal browser or another external client.

This is a small seed-query discovery index, not a crawler of the entire internet. It stores metadata, original source URLs, licenses where provided, and index timestamps. It does not download or re-host media files.

## Regression tests

Run all three suites with Node.js:

```sh
node --test backend/duration.test.mjs backend/media-ranking.test.mjs backend/media-url.test.mjs
```

The duration suite covers YouTube ISO-8601 durations and malformed values. Ranking tests cover canonical YouTube URLs, tracking-parameter deduplication, source diversity, sparse-source fill, and the new focused fallback-query helper. Frontend URL tests cover unsafe schemes and case-sensitive paths. Source-level checks in the latest run passed for Worker syntax, frontend syntax, five fallback-query cases, and eleven duration-parser cases. The full Node.js suite and GitHub Actions status still need confirmation through a compatible test runner/status check.

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
