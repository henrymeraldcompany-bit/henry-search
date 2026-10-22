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
