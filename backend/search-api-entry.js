import { WorkerEntrypoint } from "cloudflare:workers";
import { runSearch } from "./search-worker.js";

// This entrypoint contains only reusable public search responses.
// The default gateway remains uncached so CORS and rate limits run per request.
export class CachedSearch extends WorkerEntrypoint {
  async fetch(request) {
    try {
      const response = await runSearch(request, this.env);
      // Do not attach a per-request ID to this cacheable response: Cloudflare
      // could otherwise replay a stale ID on a later cache hit.
      return response;
    } catch (error) {
      throw error;
    }
  }
}

export { default } from "./search-worker.js";
