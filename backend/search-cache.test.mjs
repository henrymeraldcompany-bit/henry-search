import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchCacheKey, isCacheableSearchRoute } from "./search-cache.js";

test("normalizes equivalent search queries into the same cache key", () => {
  const first = buildSearchCacheKey("https://api.example/search?q=%20Solar%20%20Energy%20&domain=example.com");
  const second = buildSearchCacheKey("https://api.example/search?domain=example.com&q=solar%20energy");
  assert.equal(first, second);
});

test("keeps filters and endpoints separate in cache keys", () => {
  const base = buildSearchCacheKey("https://api.example/search?q=solar");
  const filtered = buildSearchCacheKey("https://api.example/search?q=solar&date=week");
  const news = buildSearchCacheKey("https://api.example/news?q=solar");
  assert.notEqual(base, filtered);
  assert.notEqual(base, news);
});

test("only search, news and image routes are cacheable", () => {
  assert.equal(isCacheableSearchRoute("/search"), true);
  assert.equal(isCacheableSearchRoute("/news"), true);
  assert.equal(isCacheableSearchRoute("/images"), true);
  assert.equal(isCacheableSearchRoute("/extract"), false);
  assert.equal(isCacheableSearchRoute("/"), false);
});

test("normalizes tabs, newlines and repeated whitespace in search queries", () => {
  const first = buildSearchCacheKey("https://api.example/search?q=Solar%09%20%20Energy%0AResearch");
  const second = buildSearchCacheKey("https://api.example/search?q=solar%20energy%20research");
  assert.equal(first, second);
});

test("keeps different route filters isolated while sorting parameter order", () => {
  const first = buildSearchCacheKey("https://api.example/news?q=world&date=week&from=2026-10-01");
  const second = buildSearchCacheKey("https://api.example/news?from=2026-10-01&q=world&date=week");
  const different = buildSearchCacheKey("https://api.example/news?q=world&date=month&from=2026-10-01");
  assert.equal(first, second);
  assert.notEqual(first, different);
});
