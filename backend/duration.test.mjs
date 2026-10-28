import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Test the exact parser function in worker.js without importing Worker bindings.
const workerSource = await readFile(new URL("./worker.js", import.meta.url), "utf8");
const match = workerSource.match(/function isoDurationSeconds\(value\) \{\n[\s\S]*?\n\}/);
assert.ok(match, "isoDurationSeconds must exist in worker.js");
const isoDurationSeconds = vm.runInNewContext(`(${match[0]})`);

test("parses common YouTube ISO-8601 durations", () => {
  const cases = [
    ["PT4M", 240],
    ["PT1H2M3S", 3723],
    ["PT45S", 45],
    ["PT0S", 0],
    ["PT1H", 3600],
    ["PT2M5S", 125],
  ];

  for (const [input, expected] of cases) {
    assert.equal(isoDurationSeconds(input), expected, input);
  }
});

test("returns null for empty or malformed duration strings", () => {
  for (const input of ["", "PT", "P1D", "PT1S2H", "nonsense"]) {
    assert.equal(isoDurationSeconds(input), null, input);
  }
});



function extractWorkerFunction(signature) {
  const start = workerSource.indexOf(signature);
  assert.notEqual(start, -1, signature + " must exist in worker.js");
  const end = workerSource.indexOf(String.fromCharCode(10) + "}", start);
  assert.notEqual(end, -1, "Could not find end of " + signature);
  return workerSource.slice(start, end + 2);
}

const numericDurationSource = extractWorkerFunction("function normalizeNumericDuration(value) {");
const normalizeNumericDuration = vm.runInNewContext("(" + numericDurationSource + ")");

test("normalizes only explicit, finite, non-negative numeric provider durations", () => {
  const cases = [
    [125, 125],
    ["125", 125],
    [" 125 ", 125],
    [0, 0],
    ["0", 0],
    [null, null],
    [undefined, null],
    ["", null],
    ["   ", null],
    [false, null],
    [true, null],
    [-1, null],
    ["-1", null],
    [Infinity, null],
    ["PT4M", null],
    ["not a duration", null]
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizeNumericDuration(input), expected, String(input));
  }
});

const videoRowSource = extractWorkerFunction("function videoRow(v) {");
const safeUrlSource = extractWorkerFunction("function safeUrl(value, base) {");
const cleanSource = extractWorkerFunction("function clean(value, max) {");
const videoRow = vm.runInNewContext(
  "(function(){ const PEERTUBE = 'https://peertube.tv'; " +
    [safeUrlSource, cleanSource, numericDurationSource, videoRowSource].join(String.fromCharCode(10)) +
    "; return videoRow; })()",
  { URL, Date, Number, String }
);

test("PeerTube rows preserve missing durations as null instead of zero", () => {
  const rowFor = duration => videoRow({
    host: "videos.example",
    uuid: "abc123",
    url: "/videos/watch/abc123",
    embedUrl: "/videos/embed/abc123",
    thumbnailUrl: "/thumb.jpg",
    title: "Example video",
    duration
  });

  assert.equal(rowFor(null).duration_seconds, null);
  assert.equal(rowFor(undefined).duration_seconds, null);
  assert.equal(rowFor("").duration_seconds, null);
  assert.equal(rowFor(false).duration_seconds, null);
  assert.equal(rowFor("125").duration_seconds, 125);
  assert.equal(rowFor(125).duration_seconds, 125);
  assert.equal(rowFor(0).duration_seconds, 0);
});


test("does not turn missing video URLs into the instance homepage", () => {
  const empty = safeUrlSource;
  const safeUrl = vm.runInNewContext("(" + empty + ")");
  assert.equal(safeUrl("", "https://videos.example"), "");
  assert.equal(safeUrl("   ", "https://videos.example"), "");

  const missingPage = videoRow({
    host: "videos.example",
    title: "Video without a watch URL"
  });
  assert.equal(missingPage, null);
});

test("keeps absent PeerTube embed and thumbnail URLs empty", () => {
  const row = videoRow({
    host: "https://videos.example",
    url: "/videos/watch/abc123",
    title: "Video without optional media URLs"
  });
  assert.ok(row);
  assert.equal(row.page_url, "https://videos.example/videos/watch/abc123");
  assert.equal(row.embed_url, "");
  assert.equal(row.thumbnail_url, "");
});
