# GOZIE SEARCH media backend

This Cloudflare Worker stores media metadata and original source links rather than re-hosting media files. It uses Wikimedia Commons for images and PeerTube for open video search, and optionally YouTube when a server-side `YOUTUBE_API_KEY` secret is configured.

## Current deployment status

- Worker: `gozie-search-media`
- Base URL: https://gozie-search-media.henrymeraldcompany.workers.dev
- Database: Cloudflare D1 database `gozie-search-media`, bound as `MEDIA_DB`
- Scheduled discovery refresh: daily at `07:00 UTC` (`08:00 Africa/Lagos`)
- Routes: `/health`, `/images?q=...`, `/videos?q=...`, and `/index/status`
- The website's image and video searches now try this media Worker first, then retain existing fallbacks. Normal `/search` and `/news` remain on the original Worker.
- YouTube results are optional and remain disabled until `YOUTUBE_API_KEY` is added as a Worker secret. Never put that key in `app.js` or `index.html`.

The Worker and D1 schema were deployed/configured on 22 October 2026. Cloudflare confirmed successful upload, enabled the `workers.dev` subdomain, and confirmed the daily schedule. Live HTTP smoke tests still need to be completed from a normal browser or external client because this management environment blocks outbound requests to `workers.dev` hosts. Do not treat successful deployment metadata as proof that every route has been runtime-tested.

This is a small seed-query discovery index, not a crawler of the entire internet. The scheduled job searches the topics in `worker.js` and stores metadata, original URLs, licenses where provided, and index timestamps. Live provider search remains available on each request.

## Maintenance and verification

Run the duration parser regression tests with Node.js:

```sh
node --test backend/duration.test.mjs
```

The parser supports YouTube ISO-8601 durations such as `PT4M`, `PT45S`, and `PT1H2M3S`; malformed or empty duration strings return `null`.

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

The secret value should be entered interactively and must not be committed to GitHub or included in frontend code. Free-tier quotas and provider terms still apply; the daily index covers only the configured seed queries and returned provider results.
