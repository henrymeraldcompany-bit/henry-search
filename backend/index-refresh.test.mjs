import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./worker.js", import.meta.url), "utf8");
const start = source.indexOf("function indexFailure(provider, error) {");
assert.notEqual(start, -1, "indexFailure must exist in worker.js");
const end = source.indexOf("\n}", start);
assert.notEqual(end, -1, "Could not find the end of indexFailure");
const functionSource = source.slice(start, end + 2);
const indexFailure = vm.runInNewContext("(" + functionSource + ")", { String });

test("labels indexing timeouts with the provider name", () => {
  assert.equal(
    indexFailure("Openverse", new Error("The operation was aborted due to timeout")),
    "Openverse: The operation was aborted due to timeout"
  );
});

test("labels database-save failures separately from provider request failures", () => {
  assert.equal(
    indexFailure("Flickr public feed database save", new Error("D1 write failed")),
    "Flickr public feed database save: D1 write failed"
  );
});

test("bounds stored provider failure notes and handles missing error details", () => {
  const long = indexFailure("Flickr public feed", new Error("x".repeat(300)));
  assert.ok(long.startsWith("Flickr public feed:"));
  assert.ok(long.length <= 150);
  assert.equal(indexFailure("", null), "Unknown provider: request failed");
});


test("collapses multiline and repeated whitespace in provider failure notes", () => {
  assert.equal(
    indexFailure("Openverse", { message: "  timeout\nwhile\tfetch  " }),
    "Openverse: timeout while fetch"
  );
});
