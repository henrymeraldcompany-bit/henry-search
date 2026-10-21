# GOZIE SEARCH media backend

This separate Cloudflare Worker is code only until deployed. It stores media metadata and original source URLs, not copies of media files. It uses Wikimedia Commons for images, PeerTube for open-source video search, and optionally YouTube when a server-side YouTube Data API key is configured as a Worker secret.

It provides /health, /images?q=..., /videos?q=..., and /index/status. Its scheduled job refreshes a seed-query discovery index daily at 08:00 Nigeria time (07:00 UTC). The seed topics are in worker.js. This is not a crawler of the entire internet: each run only refreshes results found for those topics, and live provider searches are also used.

## Setup

1. Create a Cloudflare D1 database named gozie-search-media.
2. Execute schema.sql against that database.
3. Replace the placeholder database ID in wrangler.toml.
4. Deploy this Worker through Wrangler or Cloudflare's Git deployment workflow.
5. Optional: add YOUTUBE_API_KEY as a Worker secret; never put it in app.js or index.html.
6. Test /health, /index/status, /images?q=cats, and /videos?q=science.

Create the database from the Cloudflare dashboard or run this from the repository root. Then copy the returned database ID into backend/wrangler.toml:

    npx wrangler d1 create gozie-search-media

Deploy using the backend config file (run from the repository root):

    npx wrangler d1 execute gozie-search-media --remote --file=backend/schema.sql --config backend/wrangler.toml
    npx wrangler deploy --config backend/wrangler.toml
    # Optional server-side YouTube key:
    npx wrangler secret put YOUTUBE_API_KEY --config backend/wrangler.toml

The current website still uses its existing SEARCH_API URL. Deploy and test this backend first, then wire its URL into the frontend for images and videos, or merge these route handlers into the current Worker while preserving the existing /search and /news routes. Do not blindly replace the current Worker.


