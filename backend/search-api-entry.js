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
      const headers = new Headers(response.headers);
      headers.set("X-GOZIE-Request-ID", diagnostic.requestId);
      const result = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
      recordRequestDiagnostic(diagnostic, result.status);
      return result;
    } catch (error) {
      recordRequestDiagnostic(diagnostic, 500, error);
      throw error;
    }
  }
}

export { default } from "./search-worker.js";
