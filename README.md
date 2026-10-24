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

The frontend tries the Media Worker first for image/video search, then retains the original Worker and direct PeerTube fallbacks. Ordinary web search and news remain routed to the original Worker. Video playback is attempted only for permitted embed URLs; original source links remain available.

## Image providers and terms

Image search uses Wikimedia Commons and the Flickr public photos feed. Results retain their original source page and image URL; GOZIE SEARCH does not download or re-host media files. Flickr results are capped at 20 per response, under Flickr's published 30-photo-per-page limit, and the interface includes the required non-endorsement notice. Flickr license metadata is not supplied by the public feed, so these results are labelled "License information unavailable"; users should check the original page and rights-holder terms before reuse.

Provider requests have an 8-second timeout so a slow provider does not indefinitely hold a search or daily refresh. If one provider fails, the other provider's results remain usable.

## Media index and schedule

The `backend/` directory contains the media Worker, D1 schema, schedule configuration, regression tests, and setup notes. The Worker stores metadata and original source links rather than re-hosting media. D1 database `gozie-search-media` is bound as `MEDIA_DB`; the scheduled trigger is `0 7 * * *` (08:00 in Nigeria).

Cloudflare verified a completed index run at 2026-10-24 07:01:07 UTC: 192 rows processed with zero recorded provider/database failures. Before the Flickr integration deployment later that morning, the database contained 100 images and 95 videos. The newly deployed Worker includes Flickr in live image search and the next scheduled index refresh; Flickr's live response and new indexed rows are not yet independently verified.

The Media Worker deployment containing the Flickr provider and provider timeouts was confirmed on 24 October 2026 at 07:47 UTC, with 100% traffic and the existing D1 binding preserved. The deployed Worker source was compared with the latest repository file and matched exactly.

Live HTTP smoke tests remain unverified because this management environment blocks outgoing requests to `workers.dev` hosts and to `www.flickr.com`. Deployment metadata and the previous scheduled refresh are verified, but they do not prove that every browser-visible route or Flickr feed request succeeds. Test those routes from a normal browser or another permitted external client. The static website's latest publication status is also not confirmed.

YouTube results remain optional and require the server-side `YOUTUBE_API_KEY` secret. Never put API secrets in frontend code.

## Tests

Run the media regression suites with Node.js 22:

```sh
node --test backend/duration.test.mjs backend/media-ranking.test.mjs backend/media-url.test.mjs backend/video-filters.test.mjs backend/image-providers.test.mjs
```

The suites cover ISO-8601 durations, YouTube URL variants, tracking-parameter deduplication, source diversity, sparse-query fallback, Flickr feed mapping and URL safety, Flickr result caps, source/date/duration filters, unsafe URL rejection, and case-sensitive paths. GitHub Actions is configured to run these suites on relevant pushes and pull requests; a successful run for the latest changes has not yet been confirmed by the available status tools.

## Safety and maintenance

- Inspect the latest repository and service configuration before changing code; do not rebuild working features unnecessarily.
- Never put API secrets in `app.js` or `index.html`.
- Render provider titles and descriptions as text, not HTML.
- Respect provider terms, rate limits, licensing, and embedding restrictions.
- The daily index is a seed-query discovery index, not a crawler of every website or video.
