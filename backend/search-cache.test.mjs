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
