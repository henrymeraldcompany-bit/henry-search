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
  extract("parseDurationSeconds"),
  extract("videoMatchesFilters")
].join("\n");
const api = vm.runInNewContext(
  "(function(){ " + helpers + "; return {parseDurationSeconds, videoMatchesFilters}; })()",
  { URL, Date }
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
