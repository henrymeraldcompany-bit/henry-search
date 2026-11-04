import { WorkerEntrypoint } from "cloudflare:workers";
import { runSearch } from "./search-worker.js";

// This entrypoint contains only reusable public search responses.
// The default gateway remains uncached so CORS and rate limits run per request.
export class CachedSearch extends WorkerEntrypoint {
  async fetch(request) {
    return runSearch(request, this.env);
  }
}

export { default } from "./search-worker.js";
