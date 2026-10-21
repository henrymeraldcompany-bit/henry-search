# GOZIE SEARCH

A phone-friendly search website with category tabs for web search, images, news, and videos.

## Frontend files

- `index.html` — page structure and accessible search controls.
- `style.css` — dark/light themes and responsive layouts.
- `app.js` — search requests, result rendering, image preview, voice search, and safe outbound links.

## Search service

The frontend uses the Cloudflare Worker API:

`https://henry-search-api.henrymeraldcompany.workers.dev`

- `/search?q=...` — ordinary web results.
- `/images?q=...` — image results.
- `/news?q=...` — news results.
- `/videos?q=...` — preferred video endpoint. The Video tab falls back to PeerTube's public search API if the Worker route is unavailable or returns no usable results.

## Video search behavior

The Video tab displays video cards inside GOZIE SEARCH, including title, source/host, thumbnail when available, channel, duration, and description when returned by the provider. Links open in a new tab with `noopener noreferrer`; results and thumbnails are only accepted from HTTP(S) URLs. Missing thumbnails get a text fallback.

The no-key fallback uses PeerTube's public API at `https://peertube.tv/api/v1/search/videos`. Search coverage is limited to videos the instance can find; it is not a complete index of YouTube or the entire web. If no videos are returned, the interface offers an external YouTube search link. Availability and browser cross-origin access depend on the public instance.

## Security and maintenance

- Do not put API secrets in frontend JavaScript.
- Treat all provider titles and descriptions as untrusted text; render them as text, not HTML.
- Respect provider terms, rate limits, and availability.
- The frontend must keep usable error messages when external search services are unavailable.

## Deployment note

The frontend update requests `/videos` from the existing Worker first. The Worker route itself still needs to be added and deployed through Cloudflare management before the preferred backend path can be considered complete. Until then, the frontend's PeerTube fallback may provide results if the instance is reachable from the user's browser.
