# GOZIE SEARCH media backend smoke tests

- [ ] GET /health returns JSON with status "ok".
- [ ] GET /index/status returns image/video counts and latest refresh information.
- [ ] GET /images?q=cats returns title, page, image, thumbnail and license fields where available.
- [ ] GET /videos?q=science returns title, url, embedUrl, thumbnailUrl, duration and publishedAt where available.
- [ ] OPTIONS returns CORS headers.
- [ ] A scheduled refresh creates a row in index_runs.
- [ ] The live website displays results before its API URL is changed.
- [ ] When YouTube is enabled, verify the secret stays server-side and quota is available.
- [ ] Review provider terms, rate limits, media licensing and embedding permissions before adding sources.
