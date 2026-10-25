import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./worker.js", import.meta.url), "utf8");
function extract(name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " must exist in worker.js");
  if (name === "terms") return source.slice(start, source.indexOf("\n", start));
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1, "Could not find end of " + name);
  return source.slice(start, end + 2);
}
const helpers = [
  extract("safeUrl"),
  extract("terms"),
  extract("fallbackQuery"),
  extract("canonicalMediaKey"),
  extract("rank"),
  extract("capFlickrResults"),
].join("\n");
const api = vm.runInNewContext(
  "(function(){ " + helpers + "; return {canonicalMediaKey, rank, fallbackQuery, capFlickrResults}; })()",
  { URL }
);

test("canonicalizes YouTube watch, short, and embed URLs to one item", () => {
  const keys = [
    api.canonicalMediaKey("https://youtu.be/abc123?t=30"),
    api.canonicalMediaKey("https://www.youtube.com/watch?v=abc123&si=tracking"),
    api.canonicalMediaKey("https://www.youtube-nocookie.com/embed/abc123"),
  ];
  assert.equal(new Set(keys).size, 1);
});

test("removes tracking parameters and fragments from duplicate keys", () => {
  assert.equal(
    api.canonicalMediaKey("https://example.org/picture?utm_source=test&id=7#preview"),
    api.canonicalMediaKey("https://www.example.org/picture?id=7")
  );
});

test("deduplicates equivalent URLs while ranking results", () => {
  const results = api.rank([
    {page_url:"https://youtu.be/abc123?si=one", title:"science video"},
    {page_url:"https://youtube.com/watch?v=abc123", title:"science video duplicate"},
    {page_url:"https://peer.example/videos/2", title:"science experiment"},
  ], "science", 10);
  assert.equal(results.length, 2);
});

test("keeps the most relevant duplicate when a weaker provider row appears first", () => {
  const results = api.rank([
    {page_url:"https://example.org/video?id=1", title:"Football highlights"},
    {page_url:"https://www.example.org/video?id=1&utm_source=feed", title:"Science documentary about stars"}
  ], "science", 10);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Science documentary about stars");
});

test("prefers the stronger exact-phrase variant among eligible duplicate URLs", () => {
  const results = api.rank([
    {page_url:"https://example.org/video?id=1", title:"Solar facts and footage"},
    {page_url:"https://www.example.org/video?id=1&utm_source=feed", title:"Solar system explained for beginners"}
  ], "solar system", 10);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Solar system explained for beginners");
});

test("limits one host during the first pass when alternatives exist", () => {
  const rows = [];
  for (let i=0;i<8;i++) rows.push({page_url:"https://a.example/video/"+i,title:"science result "+i});
  for (let i=0;i<8;i++) rows.push({page_url:"https://b.example/video/"+i,title:"science result "+i});
  const results = api.rank(rows,"science",6);
  const counts = results.reduce((out,row) => {
    const host = new URL(row.page_url).hostname;
    out[host]=(out[host]||0)+1;
    return out;
  },{});
  assert.equal(results.length,6);
  assert.equal(counts["a.example"],3);
  assert.equal(counts["b.example"],3);
});

test("fills the requested count when only one source is available", () => {
  const rows = Array.from({length:6},(_,i)=>({page_url:"https://only.example/"+i,title:"science result "+i}));
  assert.equal(api.rank(rows,"science",6).length,6);
});

test("builds a focused fallback query by removing common filler words", () => {
  assert.equal(api.fallbackQuery("how to build a solar system model"), "build solar system model");
  assert.equal(api.fallbackQuery("what is the history of Nigeria"), "history nigeria");
});

test("does not repeat a query when no useful broadening is possible", () => {
  assert.equal(api.fallbackQuery("Nigeria"), "");
  assert.equal(api.fallbackQuery("science videos"), "");
  assert.equal(api.fallbackQuery("   "), "");
});


test("caps Flickr photo results below the provider page limit without dropping other sources", () => {
  const rows = [
    ...Array.from({length:25},(_,i)=>({source:"Flickr public feed",page_url:"https://www.flickr.com/photos/a/"+i,title:"science photo"})),
    ...Array.from({length:4},(_,i)=>({source:"Wikimedia Commons",page_url:"https://commons.wikimedia.org/wiki/File:"+i,title:"science image"}))
  ];
  const results = api.capFlickrResults(rows,20);
  assert.equal(results.filter(row=>row.source==="Flickr public feed").length,20);
  assert.equal(results.filter(row=>row.source==="Wikimedia Commons").length,4);
});

test("filters unrelated media instead of filling sparse searches with zero-match results", () => {
  const results = api.rank([
    {page_url:"https://example.org/football", title:"Football highlights", description:"League final"},
    {page_url:"https://example.org/solar-model", title:"Solar system model for school", description:"Build a model of the planets"},
    {page_url:"https://example.org/solar-system", title:"Solar system explained", description:"A model of the planets"}
  ], "how to build a solar system model", 10);
  assert.deepEqual(
    Array.from(results, row => row.page_url),
    ["https://example.org/solar-model", "https://example.org/solar-system"]
  );
});

test("does not treat generic media words as a relevance match", () => {
  const results = api.rank([
    {page_url:"https://example.org/cooking", title:"Cooking tutorial", description:"New videos every week"},
    {page_url:"https://example.org/science", title:"Science experiment for beginners", description:""}
  ], "science videos", 10);
  assert.deepEqual(Array.from(results, row => row.page_url), ["https://example.org/science"]);
});

// Frontend ranking regression tests: the backend can be healthy while a legacy
// provider still returns unrelated items, so verify the UI rejects zero-match rows.
const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
function extractApp(name) {
  const start = appSource.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " must exist in app.js");
  const end = appSource.indexOf("\n}", start);
  assert.notEqual(end, -1, "Could not find end of frontend " + name);
  return appSource.slice(start, end + 2);
}
const stopWordsMatch = appSource.match(/const MEDIA_STOP_WORDS = new Set\(\[[\s\S]*?\]\);/);
assert.ok(stopWordsMatch, "MEDIA_STOP_WORDS must exist in app.js");
const frontendHelpers = [
  stopWordsMatch[0],
  extractApp("resolveSafeHttpUrl"),
  extractApp("normalizeMediaText"),
  extractApp("queryWords"),
  extractApp("mediaRelevanceScore"),
  extractApp("canonicalizeMediaResultUrl"),
  extractApp("rankMediaResults")
].join("\n");
const frontendApi = vm.runInNewContext(
  "(function(){ " + frontendHelpers + "; return {rankMediaResults}; })()",
  { URL }
);

test("frontend does not show unrelated media when no candidate matches", () => {
  const results = frontendApi.rankMediaResults([
    {url:"https://example.org/football", title:"Football highlights", description:"League final"},
    {url:"https://example.org/cooking", title:"Cooking tutorial", description:"New videos every week"}
  ], "solar system", ["title"], ["description"], ["url"]);
  assert.equal(results.length, 0);
});

test("frontend ignores generic media words while preserving topical matches", () => {
  const results = frontendApi.rankMediaResults([
    {url:"https://example.org/cooking", title:"Cooking tutorial", description:"New videos every week"},
    {url:"https://example.org/science", title:"Science experiment for beginners", description:""}
  ], "science videos", ["title"], ["description"], ["url"]);
  assert.deepEqual(Array.from(results, row => row.url), ["https://example.org/science"]);
});

test("frontend returns no matches for queries made only of generic media words", () => {
  const results = frontendApi.rankMediaResults([
    {url:"https://example.org/one", title:"One video"},
    {url:"https://example.org/two", title:"Another image"}
  ], "videos images search", ["title"], [], ["url"]);
  assert.equal(results.length, 0);
});

test("frontend keeps the strongest matching title when provider URLs duplicate", () => {
  const results = frontendApi.rankMediaResults([
    {url:"https://example.org/video?id=1", title:"Solar facts and footage"},
    {url:"https://www.example.org/video?id=1&utm_source=feed", title:"Solar system explained for beginners"}
  ], "solar system", ["title"], [], ["url"]);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Solar system explained for beginners");
});

