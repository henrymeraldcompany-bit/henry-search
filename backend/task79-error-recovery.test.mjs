import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import mediaWorker from "./worker.js";
import apiWorker from "./search-worker.js";

test("media API returns retry guidance and avoids caching failures", async () => {
 const env = { MEDIA_DB: { prepare() { throw new Error("db failure"); }, batch: async () => { throw new Error("db failure"); } } };
 const response = await mediaWorker.fetch(new Request("https://media.example/index/status"), env);
 const payload = await response.json();
 assert.equal(response.status, 503);
 assert.match(payload.error, /temporarily unavailable/i);
 assert.equal(response.headers.get("retry-after"), "5");
 assert.equal(response.headers.get("cache-control"), "no-store");
 assert.equal(JSON.stringify(payload).includes("db failure"), false);
});

test("media health route remains available without a database binding", async () => {
 const response = await mediaWorker.fetch(new Request("https://media.example/health"), {});
 assert.equal(response.status, 200);
 assert.equal((await response.json()).status, "ok");
});

test("API gateway converts cache entrypoint failures into retryable JSON", async () => {
 const env = { API_RATE_LIMITER: { limit: async () => ({ success: true }) }, API_EXTRACT_RATE_LIMITER: { limit: async () => ({ success: true }) } };
 const ctx = { exports: { CachedSearch: { fetch: async () => { throw new Error("cache failed"); } } } };
 const response = await apiWorker.fetch(new Request("https://api.example/search?q=solar", { headers: { "cf-connecting-ip": "203.0.113.31" } }), env, ctx);
 const payload = await response.json();
 assert.equal(response.status, 503);
 assert.match(payload.error, /temporarily unavailable/i);
 assert.equal(response.headers.get("Retry-After"), "5");
 assert.equal(response.headers.get("Cache-Control"), "no-store");
 assert.equal(response.headers.get("X-GOZIE-Cache"), "BYPASS");
 assert.equal(response.headers.get("X-GOZIE-RateLimit"), "degraded");
 assert.equal(JSON.stringify(payload).includes("cache failed"), false);
});


test("image search continues with live providers when the D1 index read fails", async () => {
 const originalFetch = globalThis.fetch;
 globalThis.fetch = async input => {
  const url = new URL(String(input));
  if (url.hostname === "commons.wikimedia.org") return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 });
  if (url.hostname === "api.openverse.org") return new Response(JSON.stringify({ results: [] }), { status: 200 });
  if (url.hostname === "www.flickr.com") return new Response(JSON.stringify({ items: [] }), { status: 200 });
  throw new Error("unexpected provider");
 };
 try {
  const env = { MEDIA_DB: { prepare() { return { bind() { return { all: async () => { throw new Error("index unavailable"); } }; } }; } } };
  const response = await mediaWorker.fetch(new Request("https://media.example/images?q=solar"), env);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.indexStatus, "temporarily-unavailable");
  assert.equal(payload.count, 0);
 } finally {
  globalThis.fetch = originalFetch;
 }
});
