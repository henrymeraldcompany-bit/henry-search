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


const numericDurationMatch = workerSource.match(
  /function normalizeNumericDuration\\(value\\) \\{\\n[\\s\\S]*?\\n\\}/
);
assert.ok(numericDurationMatch, "normalizeNumericDuration must exist in worker.js");
const normalizeNumericDuration = vm.runInNewContext(`(${numericDurationMatch[0]})`);

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

const videoRowMatch = workerSource.match(/function videoRow\\(v\\) \\{\\n[\\s\\S]*?\\n\\}/);
const safeUrlMatch = workerSource.match(/function safeUrl\\(value, base\\) \\{\\n[\\s\\S]*?\\n\\}/);
const cleanMatch = workerSource.match(/function clean\\(value, max\\) \\{\\n[\\s\\S]*?\\n\\}/);
assert.ok(videoRowMatch, "videoRow must exist in worker.js");
assert.ok(safeUrlMatch, "safeUrl must exist in worker.js");
assert.ok(cleanMatch, "clean must exist in worker.js");
const videoRow = vm.runInNewContext(
  "(function(){ const PEERTUBE = 'https://peertube.tv'; " +
    [safeUrlMatch[0], cleanMatch[0], numericDurationMatch[0], videoRowMatch[0]].join("\\n") +
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
