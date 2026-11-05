import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./worker.js", import.meta.url), "utf8");
const mediaConfig = await readFile(new URL("./wrangler.toml", import.meta.url), "utf8");
const apiConfig = await readFile(new URL("./search-api.wrangler.toml", import.meta.url), "utf8");
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


const retryStart = source.indexOf("function isRetryableIndexError(");
const retryEnd = source.indexOf("\nfunction buildIndexRunStats(", retryStart);
assert.notEqual(retryStart, -1, "retry classification must exist");
assert.notEqual(retryEnd, -1, "retry helper must precede run stats");
const retryApi = vm.runInNewContext("(function(){ " + source.slice(retryStart, retryEnd) + "; return {isRetryableIndexError,runIndexProviderWithRetry}; })()", { Number, String, TypeError, Math, Promise });
test("index retries classify transient errors and reject permanent client errors", () => {
  assert.equal(retryApi.isRetryableIndexError({ status: 429 }), true);
  assert.equal(retryApi.isRetryableIndexError({ status: 503 }), true);
  assert.equal(retryApi.isRetryableIndexError({ name: "TimeoutError" }), true);
  assert.equal(retryApi.isRetryableIndexError(new TypeError("fetch failed")), true);
  assert.equal(retryApi.isRetryableIndexError({ status: 404 }), false);
  assert.equal(retryApi.isRetryableIndexError(new SyntaxError("invalid JSON")), false);
});
test("provider retry succeeds after a transient failure and records the retry", async () => {
  let attempts = 0, pauses = [];
  const result = await retryApi.runIndexProviderWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) throw { status: 503, message: "unavailable" };
    return ["row"];
  }, { remaining: 3 }, async ms => { pauses.push(ms); });
  assert.deepEqual(Array.from(result.value), ["row"]);
  assert.equal(result.retries, 1);
  assert.equal(attempts, 2);
  assert.equal(pauses.length, 1);
  assert.equal(pauses[0] >= 200 && pauses[0] < 300, true);
});
test("provider retry stops at shared budget and does not retry permanent errors", async () => {
  const budget = { remaining: 1 };
  let attempts = 0;
  await assert.rejects(retryApi.runIndexProviderWithRetry(async () => {
    attempts += 1;
    throw { status: 503, message: "unavailable" };
  }, budget, async () => {}), error => error.status === 503);
  assert.equal(attempts, 2);
  assert.equal(budget.remaining, 0);
  attempts = 0;
  await assert.rejects(retryApi.runIndexProviderWithRetry(async () => {
    attempts += 1;
    throw { status: 400, message: "bad request" };
  }, { remaining: 3 }, async () => {}), error => error.status === 400);
  assert.equal(attempts, 1);
});
test("retry budget is derived from the complete scheduled request fan-out", () => {
  assert.match(source, /calculateIndexRetryBudget\(/);
  assert.match(source, /MAX_INDEX_RETRIES_PER_RUN = calculateIndexRetryBudget/);
  assert.match(source, /const retryBudget = \{ remaining: MAX_INDEX_RETRIES_PER_RUN \}/);
});
function extractFunction(name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " must exist");
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail("Could not isolate " + name);
}
const budgetApi = vm.runInNewContext(
  "(function(){ " + ["calculateIndexRetryBudget","createIndexD1BatchRequestBudget","reserveIndexD1BatchRequestBudget"].map(extractFunction).join("\n") +
  "; return {calculateIndexRetryBudget,createIndexD1BatchRequestBudget,reserveIndexD1BatchRequestBudget}; })()",
  { Math, Number }
);
test("indexing request budget stays below the Workers Free 50-subrequest ceiling with reserve", () => {
  assert.equal(budgetApi.calculateIndexRetryBudget(50, 3, 6, 3, 2), 3);
  assert.equal(budgetApi.calculateIndexRetryBudget(50, 3, 6, 3, 2, 5), 1);
  assert.equal(6 * (3 + 3) + 2 + 5 + 1 * 3, 46);
  assert.match(source, /MAX_DAILY_WEB_NEWS_REQUESTS = 5/);
  assert.match(source, /INDEX_MAX_SEARCH_ROWS_PER_RUN = 40/);
  assert.match(source, /INDEX_EXTERNAL_SUBREQUEST_LIMIT = 50/);
  assert.match(source, /INDEX_EXTERNAL_SUBREQUEST_RESERVE = 3/);
});

test("Free-plan Worker configs rely on the built-in 50-subrequest ceiling", () => {
  for (const [name, config] of [["Media", mediaConfig], ["API", apiConfig]]) {
    assert.doesNotMatch(config, /^\[limits\]/m, name + " Worker must not set unsupported custom limits on Free");
  }
  assert.match(source, /INDEX_EXTERNAL_SUBREQUEST_LIMIT = 50/);
  assert.match(source, /INDEX_EXTERNAL_SUBREQUEST_RESERVE = 3/);
});

test("daily indexed rows and retention cleanup have hard per-run caps", () => {
  assert.match(source, /INDEX_MAX_ROWS_PER_RUN = DAILY_SEED_BATCH_SIZE/);
  assert.match(source, /INDEX_RETENTION_PRUNE_BATCH_SIZE = 500/);
  assert.match(source, /rows\.slice\(0, availableRows\)/);
  assert.match(source, /LIMIT \?/);
  assert.match(source, /INDEX_D1_BATCH_SIZE = 40/);
});
test("D1 batch-request budget reserves capacity for operational headroom", () => {
  const budget = budgetApi.createIndexD1BatchRequestBudget(50, 5);
  assert.equal(budget.remaining, 45);
  assert.equal(budgetApi.reserveIndexD1BatchRequestBudget(budget, 40), true);
  assert.equal(budgetApi.reserveIndexD1BatchRequestBudget(budget, 5), true);
  assert.equal(budgetApi.reserveIndexD1BatchRequestBudget(budget, 1), false);
  assert.equal(budget.used, 45);
  assert.equal(budget.reserved, 5);
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
    "Openverse": { attempted: 3, retries: 1, succeeded: 1, failed: 2, rowsReceived: 14, rowsSaved: 10, rowsSkipped: 4 },
    "PeerTube": { attempted: 6, succeeded: 6, failed: 0, rowsReceived: 80, rowsSaved: 42, databaseSaveFailures: 1 }
  }, 6, ["Openverse"], 12500);
  assert.equal(stats.version, 1);
  assert.equal(stats.seedsProcessed, 6);
  assert.equal(stats.providerCalls, 10);
  assert.equal(stats.providers.Openverse.retries, 1);
  assert.equal(stats.providerFailures, 2);
  assert.equal(stats.databaseSaveFailures, 1);
  assert.equal(stats.rowsReceived, 94);
  assert.equal(stats.rowsSaved, 52);
  assert.equal(stats.rowsSkipped, 4);
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

const freshnessStart = source.indexOf("function indexFreshnessSummaryQuery()");
const freshnessEnd = source.indexOf("\n}", freshnessStart);
assert.notEqual(freshnessStart, -1, "indexFreshnessSummaryQuery must exist");
assert.notEqual(freshnessEnd, -1, "freshness query function must close");
const freshnessQuery = vm.runInNewContext("(" + source.slice(freshnessStart, freshnessEnd + 2) + ")", { INDEX_FRESH_DAYS: 30 });
const freshnessSql = freshnessQuery();
test("freshness policy separates fresh and stale records without hiding stale fallback rows", () => {
  const sql = freshnessQuery();
  assert.match(sql, /julianday\(indexed_at\)/);
  assert.match(sql, /-30 days/);
  assert.match(sql, /AS fresh/);
  assert.match(sql, /AS stale/);
  assert.match(sql, /julianday\(indexed_at\) IS NULL OR julianday\(indexed_at\) </);
  assert.match(sql, /MIN\(indexed_at\) AS oldestIndexedAt/);
  assert.match(sql, /MAX\(indexed_at\) AS newestIndexedAt/);
  assert.match(source, /INDEX_FRESH_DAYS = 30/);
  assert.match(source, /INDEX_RETENTION_DAYS = 180/);
  assert.match(source, /freshnessPolicy:\s*\{\s*freshWithinDays:\s*INDEX_FRESH_DAYS,\s*retentionDays:\s*INDEX_RETENTION_DAYS,\s*staleRowsRemainSearchable:\s*true,\s*invalidTimestampsCountAsStale:\s*true/);
  assert.match(source, /relevance_score DESC,[\s\S]*julianday\(indexed_at\)/);
  assert.match(source, /DELETE FROM media_items WHERE rowid IN \(SELECT rowid FROM media_items WHERE indexed_at < \? ORDER BY indexed_at ASC LIMIT \?\)/);
});
test("freshness is measured from indexed_at and legacy rows are included in the status breakdown", () => {
  assert.match(freshnessSql, /FROM media_items GROUP BY kind/);
  assert.match(source, /indexed_at=excluded\.indexed_at/);
});


test("freshness summary accounts for invalid timestamps as stale and exposes refresh bounds", () => {
  assert.match(freshnessSql, /julianday\(indexed_at\) IS NULL OR julianday\(indexed_at\) < julianday/);
  assert.match(freshnessSql, /MIN\(indexed_at\) AS oldestIndexedAt/);
  assert.match(freshnessSql, /MAX\(indexed_at\) AS newestIndexedAt/);
  assert.match(source, /staleRowsRemainSearchable:\s*true/);
  assert.match(source, /invalidTimestampsCountAsStale:\s*true/);
});


test("Cloudflare cron schedule is configured for 08:00 Nigeria time", async () => {
  const config = await readFile(new URL("./wrangler.toml", import.meta.url), "utf8");
  assert.match(config, /^\[triggers\]\s*\n# 07:00 UTC = 08:00 Nigeria time\.\s*\ncrons = \["0 7 \* \* \*"\]/m);
  assert.match(config, /binding = "MEDIA_DB"/);
});

test("Cloudflare scheduled handler attaches the daily refresh to waitUntil", async () => {
  const marker = "  async scheduled(controller,env,ctx) {";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "Worker must export a scheduled handler");
  const open = source.indexOf("{", start);
  const close = source.indexOf("\n  }", open);
  assert.ok(open > start && close > open, "Could not isolate scheduled handler");
  const body = source.slice(open + 1, close);
  let refreshCalls = 0;
  let attached = null;
  const scheduled = vm.runInNewContext(
    "(async function(controller,env,ctx){" + body + "})",
    {
      refresh: async (env) => { refreshCalls += 1; assert.equal(env.marker, "test"); },
      console
    }
  );
  await scheduled({ cron: "0 7 * * *" }, { marker: "test" }, {
    waitUntil: (promise) => { attached = promise; }
  });
  assert.equal(refreshCalls, 1);
  assert.ok(attached && typeof attached.then === "function", "Refresh promise must be registered with waitUntil");
  await attached;
});
