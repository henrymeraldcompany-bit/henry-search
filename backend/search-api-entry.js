import { WorkerEntrypoint } from "cloudflare:workers";
import { runSearch } from "./search-worker.js";
import { createRequestDiagnostic, recordRequestDiagnostic } from "./diagnostics.js";

// This entrypoint contains only reusable public search responses.
// The default gateway remains uncached so CORS and rate limits run per request.
export class CachedSearch extends WorkerEntrypoint {
  async fetch(request) {
    const diagnostic = createRequestDiagnostic(request, "henry-search-api");
    try {
      const response = await runSearch(request, this.env);
      // Do not attach a per-request ID to this cacheable response: Cloudflare
      // could otherwise replay a stale ID on a later cache hit.
      recordRequestDiagnostic(diagnostic, response.status);
      return response;
    } catch (error) {
      recordRequestDiagnostic(diagnostic, 500, error);
      throw error;
    }
  }
}

export { default } from "./search-worker.js";
