import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./worker.js", import.meta.url), "utf8");
const start = source.indexOf("async function readIndexStatus(env) {");
assert.notEqual(start, -1, "readIndexStatus must exist");
const end = source.indexOf("\n}\n\nexport default", start);
assert.notEqual(end, -1, "readIndexStatus must end before the Worker export");
const functionSource = source.slice(start, end + 2);
const readIndexStatus = vm.runInNewContext("(" + functionSource + ")", {
  INDEX_FRESH_DAYS: 30,
  INDEX_RETENTION_DAYS: 180,
  videoSafetySummary: rows => ({
    verifiedSafe: Number(rows.find(row => row.kind === "video")?.verified_safe || 0),
    unverified: Number(rows.find(row => row.kind === "video")?.unverified || 0)
  }),
  parseIndexRunStats: value => value ? "parsed:" + value : null,
  indexFailureSummary: note => note ? [{ provider: "test", note }] : []
});

test("loads all index status summaries through one five-statement D1 batch", async () => {
  const prepared = [];
  let batchCalls = 0;
  const env = {
    MEDIA_DB: {
      prepare(sql) {
        prepared.push(sql);
        return { sql };
      },
      async batch(statements) {
        batchCalls++;
        assert.equal(statements.length, 5);
        return [
          { results: [{ kind: "video", total: 8, verified_safe: 6, unverified: 2 }] },
          { results: [{ kind: "video", total: 8, fresh: 7, stale: 1 }] },
          { results: [{ kind: "news", total: 4, domains: 3 }] },
          { results: [{ kind: "news", total: 4, fresh: 4, stale: 0 }] },
          { results: [{ finished_at: "2026-11-04T07:00:00Z", rows_processed: 12, failure_count: 1, note: "test provider: timeout", stats_json: "{\"version\":1}" }] }
        ];
      }
    }
  };

  const status = await readIndexStatus(env);
  assert.equal(batchCalls, 1);
  assert.equal(prepared.length, 5);
  assert.match(prepared[4], /ORDER BY id DESC LIMIT 1/);
  assert.equal(status.videoSafety.verifiedSafe, 6);
  assert.equal(status.videoSafety.unverified, 2);
  assert.equal(status.latestRun.finished_at, "2026-11-04T07:00:00Z");
  assert.equal(status.latestRun.stats, "parsed:{\"version\":1}");
  assert.deepEqual(JSON.parse(JSON.stringify(status.searchCounts)), [{ kind: "news", total: 4, domains: 3 }]);
  assert.equal(status.freshnessPolicy.freshWithinDays, 30);
  assert.equal(status.freshnessPolicy.retentionDays, 180);
  assert.equal(status.failureSummary[0].note, "test provider: timeout");
});

test("returns an empty latest-run state when the run history is empty", async () => {
  const env = {
    MEDIA_DB: {
      prepare: sql => ({ sql }),
      batch: async () => [ { results: [] }, { results: [] }, { results: [] }, { results: [] }, { results: [] } ]
    }
  };
  const status = await readIndexStatus(env);
  assert.equal(status.latestRun, null);
  assert.deepEqual(JSON.parse(JSON.stringify(status.failureSummary)), []);
});
