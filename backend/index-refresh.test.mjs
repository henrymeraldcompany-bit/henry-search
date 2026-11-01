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


const statsStart = source.indexOf("function buildIndexRunStats(");
const statsEnd = source.indexOf("\nfunction parseIndexRunStats(", statsStart);
assert.notEqual(statsStart, -1, "buildIndexRunStats must exist in worker.js");
assert.notEqual(statsEnd, -1, "parseIndexRunStats must follow buildIndexRunStats");
const parseEnd = source.indexOf("\n}", statsEnd);
assert.notEqual(parseEnd, -1, "Could not find end of parseIndexRunStats");
const statsSource = source.slice(statsStart, parseEnd + 2);
const statsApi = vm.runInNewContext(
  "(function(){ " + statsSource + "; return {buildIndexRunStats,parseIndexRunStats}; })()",
  { Object, Array, Number, String, Math, JSON, Set }
);

test("index-run metrics aggregate provider attempts, failures and saved rows", () => {
  const stats = statsApi.buildIndexRunStats({
    "Openverse": { attempted: 3, succeeded: 1, failed: 2, rowsReceived: 12, rowsSaved: 10 },
    "PeerTube": { attempted: 6, succeeded: 6, failed: 0, rowsReceived: 80, rowsSaved: 42, databaseSaveFailures: 1 }
  }, 6, ["Openverse"], 12500);
  assert.equal(stats.version, 1);
  assert.equal(stats.seedsProcessed, 6);
  assert.equal(stats.providerCalls, 9);
  assert.equal(stats.providerFailures, 2);
  assert.equal(stats.databaseSaveFailures, 1);
  assert.equal(stats.rowsReceived, 92);
  assert.equal(stats.rowsSaved, 52);
  assert.deepEqual(JSON.parse(JSON.stringify(stats.disabledProviders)), ["Openverse"]);
  assert.equal(stats.durationMs, 12500);
  assert.equal(stats.providers.PeerTube.rowsSaved, 42);
});

test("index-run metrics parser accepts valid JSON and safely ignores legacy or malformed rows", () => {
  const valid = JSON.stringify({
    version: 1,
    seedsProcessed: 6,
    disabledProviders: [],
    durationMs: 1000,
    providers: { "PeerTube": { attempted: 6, succeeded: 6, rowsReceived: 20, rowsSaved: 18 } }
  });
  assert.equal(statsApi.parseIndexRunStats(valid).providerCalls, 6);
  assert.equal(statsApi.parseIndexRunStats("{}"), null);
  assert.equal(statsApi.parseIndexRunStats("{broken"), null);
  assert.equal(statsApi.parseIndexRunStats("x".repeat(16001)), null);
});

test("index-run metrics schema adds a backward-compatible JSON column", async () => {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("./migrations/20261101_index_run_metrics.sql", import.meta.url),
    "utf8"
  );
  assert.match(schema, /stats_json TEXT NOT NULL DEFAULT '\{\}'/);
  assert.match(migration, /ALTER TABLE index_runs ADD COLUMN stats_json TEXT NOT NULL DEFAULT '\{\}'/);
  assert.match(source, /failure_count,note,stats_json\) VALUES/);
});
