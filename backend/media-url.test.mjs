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
  extract("resolveSafeHttpUrl"),
  extract("canonicalizeMediaResultUrl"),
].join("\n");
const api = vm.runInNewContext(
  "(function(){ " + helpers + "; return {canonicalizeMediaResultUrl}; })()",
  { URL }
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
