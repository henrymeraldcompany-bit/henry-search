import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
function extract(name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " must exist in app.js");
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1, "Could not find end of " + name);
  return source.slice(start, end + 2);
}
const helpers = [
  extract("normalizeMediaText"),
  extract("queryWords"),
  extract("mediaRelevanceScore"),
  extract("rankMediaResults"),
  extract("resolveSafeHttpUrl"),
  extract("canonicalizeMediaResultUrl"),
  extract("getYouTubeVideoId"),
  extract("getPlayableEmbedUrl"),
].join("\n");
const api = vm.runInNewContext(
  "(function(){ " + helpers + "; return {canonicalizeMediaResultUrl, getPlayableEmbedUrl, rankMediaResults}; })()",
  {
    URL,
    MEDIA_STOP_WORDS: new Set([
      "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
      "how", "i", "in", "is", "it", "of", "on", "or", "the", "to", "with",
      "what", "when", "where", "who", "why", "you", "your"
    ])
  }
);

test("deduplicates YouTube watch, short, and embed URLs", () => {
  const keys = [
    api.canonicalizeMediaResultUrl("https://youtu.be/abc123?t=30"),
    api.canonicalizeMediaResultUrl("https://www.youtube.com/watch?v=abc123&si=tracking"),
    api.canonicalizeMediaResultUrl("https://www.youtube-nocookie.com/embed/abc123"),
  ];
  assert.equal(new Set(keys).size, 1);
});

test("removes common tracking parameters, fragments, and www aliases", () => {
  assert.equal(
    api.canonicalizeMediaResultUrl("https://www.example.org/media?id=7&utm_source=test#preview"),
    api.canonicalizeMediaResultUrl("https://example.org/media?id=7")
  );
});

test("keeps the best-matching frontend duplicate instead of the first URL variant", () => {
  const results = api.rankMediaResults([
    {url:"https://example.org/video?id=1", title:"Football highlights"},
    {url:"https://www.example.org/video?id=1&utm_source=feed", title:"Science documentary about stars"}
  ], "science", ["title"], ["description"], ["url"]);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Science documentary about stars");
});

test("rejects non-HTTP media links", () => {
  assert.equal(api.canonicalizeMediaResultUrl("javascript:alert(1)"), "");
  assert.equal(api.canonicalizeMediaResultUrl("data:text/html,hello"), "");
});

test("preserves case-sensitive paths", () => {
  assert.notEqual(
    api.canonicalizeMediaResultUrl("https://example.org/Video/ABC"),
    api.canonicalizeMediaResultUrl("https://example.org/video/abc")
  );
});

test("allows same-origin PeerTube embeds and matching YouTube embeds", () => {
  assert.equal(
    api.getPlayableEmbedUrl({
      url: "https://videos.example/videos/watch/abc",
      embedUrl: "https://videos.example/videos/embed/abc"
    }),
    "https://videos.example/videos/embed/abc"
  );
  assert.equal(
    api.getPlayableEmbedUrl({
      url: "https://www.youtube.com/watch?v=abc123",
      embedUrl: "https://www.youtube-nocookie.com/embed/abc123"
    }),
    "https://www.youtube-nocookie.com/embed/abc123"
  );
});

test("rejects mismatched and cross-origin embeds, using a safe YouTube fallback when possible", () => {
  assert.equal(
    api.getPlayableEmbedUrl({
      url: "https://www.youtube.com/watch?v=abc123",
      embedUrl: "https://www.youtube.com/embed/other456"
    }),
    "https://www.youtube-nocookie.com/embed/abc123"
  );
  assert.equal(
    api.getPlayableEmbedUrl({
      url: "https://videos.example/watch/abc",
      embedUrl: "https://untrusted.example/embed/abc"
    }),
    null
  );
});
