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
  extract("getVideoHost"),
  extract("resolveSafeHttpUrl"),
  extract("getYouTubeVideoId"),
  extract("parseDurationSeconds"),
  extract("formatVideoDuration"),
  extract("normalizeVideoResult"),
  extract("videoMatchesFilters")
].join("\n");
const api = vm.runInNewContext(
  "(function(){ " + helpers + "; return {parseDurationSeconds, formatVideoDuration, normalizeVideoResult, videoMatchesFilters}; })()",
  { URL, Date, VIDEO_SEARCH_BASE: "https://peertube.tv" }
);

test("parses numeric, clock-format, and ISO-8601 durations", () => {
  assert.equal(api.parseDurationSeconds(125), 125);
  assert.equal(api.parseDurationSeconds("2:05"), 125);
  assert.equal(api.parseDurationSeconds("1:02:03"), 3723);
  assert.equal(api.parseDurationSeconds("PT4M"), 240);
  assert.equal(api.parseDurationSeconds("PT1H2M3S"), 3723);
  assert.equal(api.parseDurationSeconds("PT45S"), 45);
  assert.equal(api.parseDurationSeconds("PT"), null);
  assert.equal(api.parseDurationSeconds("nonsense"), null);
});

test("treats missing and invalid durations as unknown rather than zero", () => {
  for (const value of [null, undefined, false, true, "", "   ", "nonsense", -1, NaN, Infinity]) {
    assert.equal(api.parseDurationSeconds(value), null, String(value));
  }
  assert.equal(api.formatVideoDuration(null), "");
  assert.equal(api.formatVideoDuration(undefined), "");
  assert.equal(api.formatVideoDuration(""), "");
  assert.equal(api.videoMatchesFilters(
    { durationSeconds: api.parseDurationSeconds(null) }, "all", "any", "short", 1000
  ), false);
});

test("normalizes unknown video duration metadata without displaying 0:00", () => {
  const video = api.normalizeVideoResult({
    url: "https://peer.tube/w/unknown-duration",
    title: "Video without duration metadata",
    duration: null
  });
  assert.ok(video);
  assert.equal(video.durationSeconds, null);
  assert.equal(video.duration, "");
});

test("formats numeric, clock, and ISO-8601 durations consistently", () => {
  assert.equal(api.formatVideoDuration(125), "2:05");
  assert.equal(api.formatVideoDuration("1:02:03"), "1:02:03");
  assert.equal(api.formatVideoDuration("PT4M"), "4:00");
  assert.equal(api.formatVideoDuration("PT1H2M3S"), "1:02:03");
  assert.equal(api.formatVideoDuration("1:99"), "");
});

test("filters by source host", () => {
  const video = { url: "https://videos.example/watch/1", source: "videos.example" };
  assert.equal(api.videoMatchesFilters(video, "all", "any", "any", 1000), true);
  assert.equal(api.videoMatchesFilters(video, "videos.example", "any", "any", 1000), true);
  assert.equal(api.videoMatchesFilters(video, "other.example", "any", "any", 1000), false);
});

test("date filters reject missing and future dates and support the past year", () => {
  const now = Date.parse("2026-10-24T12:00:00Z");
  assert.equal(api.videoMatchesFilters({ publishedAt: "2026-01-01T00:00:00Z" }, "all", "year", "any", now), true);
  assert.equal(api.videoMatchesFilters({ publishedAt: "2024-01-01T00:00:00Z" }, "all", "year", "any", now), false);
  assert.equal(api.videoMatchesFilters({ publishedAt: "2026-10-25T00:00:00Z" }, "all", "week", "any", now), false);
  assert.equal(api.videoMatchesFilters({}, "all", "month", "any", now), false);
});

test("duration filter boundaries are consistent", () => {
  const match = (seconds, filter) => api.videoMatchesFilters(
    { durationSeconds: seconds }, "all", "any", filter, 1000
  );
  assert.equal(match(239, "short"), true);
  assert.equal(match(240, "short"), false);
  assert.equal(match(240, "medium"), true);
  assert.equal(match(1200, "medium"), true);
  assert.equal(match(1201, "long"), true);
  assert.equal(match(null, "long"), false);
});

function extractAsync(name) {
  const start = source.indexOf("async function " + name + "(");
  assert.notEqual(start, -1, name + " must exist in app.js");
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, "Could not find end of " + name);
  return source.slice(start, end + 2);
}

function createMediaFetchers(fetchJson) {
  const asyncHelpers = [
    extractAsync("fetchImageResults"),
    extractAsync("fetchVideoResults")
  ].join("\n");
  return vm.runInNewContext(
    "(function(){ " + asyncHelpers + "; return {fetchImageResults, fetchVideoResults}; })()",
    {
      URL,
      MEDIA_API: "https://media.example",
      SEARCH_API: "https://legacy.example",
      VIDEO_SEARCH_BASE: "https://peertube.tv",
      fetchJson,
      normalizeVideoResult: item => item && item.url ? item : null,
      console: { warn() {} }
    }
  );
}

test("keeps a successful empty image response instead of falling back to unrelated legacy results", async () => {
  const calls = [];
  const fetchers = createMediaFetchers(async value => {
    const host = new URL(value).hostname;
    calls.push(host);
    if (host === "media.example") return { results: [] };
    return { results: [{ title: "unrelated legacy image", image: "https://images.example/a.jpg" }] };
  });

  const result = await fetchers.fetchImageResults("solar system");
  assert.equal(result.results.length, 0);
  assert.deepEqual(calls, ["media.example"]);
});

test("keeps a successful empty video response instead of asking weaker fallback sources", async () => {
  const calls = [];
  const fetchers = createMediaFetchers(async value => {
    const url = new URL(value);
    calls.push(url.hostname);
    if (url.hostname === "media.example") return { results: [] };
    throw new Error("A fallback should not be called after a successful empty response");
  });

  const result = await fetchers.fetchVideoResults("solar system");
  assert.equal(result.items.length, 0);
  assert.deepEqual(calls, ["media.example"]);
});

test("uses the legacy image endpoint only when the preferred media endpoint fails", async () => {
  const calls = [];
  const fetchers = createMediaFetchers(async value => {
    const host = new URL(value).hostname;
    calls.push(host);
    if (host === "media.example") throw new Error("temporary outage");
    return { results: [{ title: "legacy result", image: "https://images.example/a.jpg" }] };
  });

  const result = await fetchers.fetchImageResults("solar system");
  assert.equal(result.results.length, 1);
  assert.deepEqual(calls, ["media.example", "legacy.example"]);
});
