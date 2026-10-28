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
const seedsMatch = source.match(/const SEEDS = \[[^\]]*\];/);
assert.ok(seedsMatch, "SEEDS must exist in worker.js");
const peerTubeInstancesMatch = source.match(/const PEERTUBE_INSTANCES = \[[\s\S]*?\];/);
assert.ok(peerTubeInstancesMatch, "PEERTUBE_INSTANCES must exist in worker.js");

function extractAsync(signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, signature + " must exist in worker.js");
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1, "Could not find end of " + signature);
  return source.slice(start, end + 2);
}

const helpers = [
  seedsMatch[0],
  'const PEERTUBE = "https://peertube.tv";',
  peerTubeInstancesMatch[0],
  extract("safeUrl"),
  extract("terms"),
  extract("fallbackQuery"),
  extract("canonicalMediaKey"),
  extract("rank"),
  extract("capFlickrResults"),
  extract("peertubeSearchTargets"),
  extract("shouldIndexYouTubeSeed"),
].join("\n");
const api = vm.runInNewContext(
  "(function(){ " + helpers + "; return {SEEDS, canonicalMediaKey, rank, fallbackQuery, capFlickrResults, peertubeSearchTargets, shouldIndexYouTubeSeed}; })()",
  { URL }
);

const peertubeHarness = vm.runInNewContext(
  "(function(){ const PEERTUBE = 'https://peertube.tv'; " +
    [
      peerTubeInstancesMatch[0],
      extract("safeUrl"),
      extract("clean"),
      extract("normalizeNumericDuration"),
      extract("videoRow"),
      extract("peertubeSearchTargets"),
      extractAsync("async function peertube(q, count) {")
    ].join("\n") +
    "; return peertube; })()",
  {
    URL,
    Date,
    Number,
    String,
    Promise,
    getJson: async (value) => {
      const host = new URL(value).hostname;
      if (host === "peer.tube") throw new Error("simulated provider outage");
      if (host === "peertube.tv") {
        return { data: [{
          host: "peertube.tv",
          url: "https://peertube.tv/videos/watch/a",
          uuid: "a",
          title: "Science documentary",
          duration: 120
        }] };
      }
      if (host === "spectra.video") {
        return { data: [{
          url: "/videos/watch/b",
          uuid: "b",
          title: "Science tutorial",
          duration: 90
        }] };
      }
      return { data: [] };
    },
    console: { warn() {} }
  }
);

test("rotates optional YouTube indexing across one seed per day", () => {
  for (let daySlot = 0; daySlot < api.SEEDS.length; daySlot++) {
    const selected = Array.from({length: api.SEEDS.length}, (_, index) => index)
      .filter((index) => api.shouldIndexYouTubeSeed(index, daySlot, true));
    assert.deepEqual(selected, [daySlot]);
  }
  assert.equal(api.shouldIndexYouTubeSeed(0, 0, false), false);
});

test("builds encoded search requests for three independent PeerTube instances", () => {
  const targets = api.peertubeSearchTargets("solar system & stars", 99);
  assert.equal(targets.length, 3);
  assert.deepEqual(
    Array.from(targets, (target) => new URL(target.url).hostname).sort(),
    ["peer.tube", "peertube.tv", "spectra.video"]
  );
  for (const target of targets) {
    const url = new URL(target.url);
    assert.equal(url.searchParams.get("search"), "solar system & stars");
    assert.equal(url.searchParams.get("count"), "20");
    assert.equal(url.searchParams.get("sort"), "-match");
  }
  assert.deepEqual(Array.from(api.peertubeSearchTargets("   ", 10)), []);
});

test("keeps results from healthy PeerTube instances when one instance fails", async () => {
  const results = await peertubeHarness("science", 5);
  assert.equal(results.length, 2);
  assert.deepEqual(
    Array.from(results, (row) => new URL(row.page_url).hostname).sort(),
    ["peertube.tv", "spectra.video"]
  );
  assert.equal(results.find((row) => row.source === "spectra.video").duration_seconds, 90);
});

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

test("does not match a query word that appears only inside a different word", () => {
  const results = api.rank([
    {page_url:"https://example.org/party", title:"Party tricks for beginners", description:""},
    {page_url:"https://example.org/art", title:"Art history basics", description:""}
  ], "art", 10);
  assert.deepEqual(Array.from(results, row => row.page_url), ["https://example.org/art"]);
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

test("frontend does not match short query words inside unrelated words", () => {
  const results = frontendApi.rankMediaResults([
    {url:"https://example.org/party", title:"Party tricks for beginners"},
    {url:"https://example.org/art", title:"Art history basics"}
  ], "art", ["title"], [], ["url"]);
  assert.deepEqual(Array.from(results, row => row.url), ["https://example.org/art"]);
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



// Provider-request resilience tests: each frontend request must have a finite
// timeout so a slow provider can fall through to the next available service.
const fetchJsonSource = extractApp("fetchJson");

test("frontend provider requests include JSON headers and a 12-second timeout", async () => {
  let requestedUrl = "";
  let requestOptions;
  const fetchJsonHarness = vm.runInNewContext(
    "(async " + fetchJsonSource + ")",
    {
      AbortSignal: { timeout: (ms) => ({ timeoutMs: ms }) },
      fetch: async (url, options) => {
        requestedUrl = url;
        requestOptions = options;
        return { ok: true, status: 200, json: async () => ({ results: [] }) };
      }
    }
  );
  const data = await fetchJsonHarness("https://example.org/videos?q=stars");
  assert.equal(requestedUrl, "https://example.org/videos?q=stars");
  assert.equal(requestOptions.headers.Accept, "application/json");
  assert.equal(requestOptions.signal.timeoutMs, 12000);
  assert.deepEqual(data, { results: [] });
});

test("frontend provider requests preserve useful HTTP error messages", async () => {
  const fetchJsonHarness = vm.runInNewContext(
    "(async " + fetchJsonSource + ")",
    {
      AbortSignal: { timeout: (ms) => ({ timeoutMs: ms }) },
      fetch: async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: "Provider temporarily unavailable" })
      })
    }
  );
  await assert.rejects(
    () => fetchJsonHarness("https://example.org/videos"),
    /Provider temporarily unavailable/
  );
});
