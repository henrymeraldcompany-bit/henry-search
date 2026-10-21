# GOZIE SEARCH

A phone-friendly search website with category tabs for web search, images, news, and videos.

## Frontend files

- `index.html` — accessible page structure and search controls.
- `style.css` — dark/light themes, responsive layout, video filters, and player styling.
- `app.js` — search requests, relevance ordering, media rendering, image preview, voice search, and safe outbound links.

## Existing search service

The live frontend still points to the existing Cloudflare Worker:

`https://henry-search-api.henrymeraldcompany.workers.dev`

- `/search?q=...` — ordinary web results.
- `/images?q=...` — image results.
- `/news?q=...` — news results.
- `/videos?q=...` — preferred video endpoint; the frontend also keeps a public PeerTube fallback.

## Media improvements committed

- Image and video results are ordered by visible title/description matches where the providers return enough metadata; duplicates are removed where detectable.
- Video filters include source, upload date and duration. Filters depend on metadata actually supplied by each provider.
- The video tab provides in-page playback for sources which expose a permitted embed URL and keeps an original-source link.
- If no supported provider can embed a video, the original link remains available.

## New backend source package

The `backend/` directory now contains a separate Cloudflare Worker, D1 schema, daily schedule configuration, setup notes, and a smoke-test checklist. It stores media metadata and original source links rather than copying media files. It searches Wikimedia Commons for images, PeerTube for open-source videos, and can use YouTube when a server-side API key is configured. A daily schedule refreshes the seed-query index at 08:00 Nigeria time.

**The separate backend is not deployed yet.** The Cloudflare management connection was unavailable during this build, and the current frontend is still connected to the existing Worker. Do not replace that Worker blindly: first deploy and test the new backend, then connect it or merge its media routes while preserving working `/search` and `/news` routes.

## Security and maintenance

- Never put API secrets in frontend JavaScript.
- Treat titles and descriptions as untrusted text; render them as text, not HTML.
- Respect provider terms, rate limits, licensing and embedding restrictions.
- The daily index is a seed-query discovery index, not a crawler of every website or video.
