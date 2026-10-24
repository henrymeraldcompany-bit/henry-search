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
