import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./worker.js", import.meta.url), "utf8");
function extract(name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " must exist in worker.js");
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1, "Could not find end of " + name);
  return source.slice(start, end + 2);
}
function extractAsync(name) {
  const start = source.indexOf("async function " + name + "(");
  assert.notEqual(start, -1, name + " must exist in worker.js");
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, "Could not find end of " + name);
  return source.slice(start, end + 2);
}

const requests = [];
const helpers = [
  'const PEERTUBE = "https://peertube.tv";',
  'const PEERTUBE_INSTANCES = [PEERTUBE, "https://peer.tube", "https://spectra.video"];',
  extract("clean"),
  extract("safeUrl"),
  extract("terms"),
  extract("normalizeNumericDuration"),
  extract("videoRow"),
  extract("peertubeSearchTargets"),
  extract("getDailySeedBatch"),
  extract("shouldIndexYouTubeSeed"),
  extract("createIndexCircuitBreaker"),
  extract("sqlWordText"),
  extract("indexedQuery"),
  extract("isoDurationSeconds"),
  extractAsync("getJson"),
  extractAsync("youtube")
].join("\n");

const api = vm.runInNewContext(
  "(function(){ " + helpers + "; return {videoRow,peertubeSearchTargets,getDailySeedBatch,shouldIndexYouTubeSeed,createIndexCircuitBreaker,indexedQuery,youtube}; })()",
  {
    URL,
    Date,
    Number,
    String,
    Math,
    AbortSignal,
    fetch: async (url) => {
      requests.push(new URL(url));
      return { ok: true, json: async () => ({ items: [] }) };
    },
    console: { warn() {} }
  }
);

test("PeerTube search explicitly excludes NSFW results on every configured instance", () => {
  const targets = api.peertubeSearchTargets("solar system", 15);
  assert.equal(targets.length, 3);
  for (const target of targets) {
    const url = new URL(target.url);
    assert.equal(url.searchParams.get("nsfw"), "false");
    assert.equal(url.searchParams.get("search"), "solar system");
  }
});

test("only PeerTube videos explicitly marked safe are normalized", () => {
  const base = {
    host: "https://peertube.tv",
    url: "/videos/watch/safe-id",
    uuid: "safe-id",
    embedPath: "/videos/embed/safe-id",
    title: "Solar system lesson",
    duration: 120,
    nsfw: false
  };
  const safe = api.videoRow(base);
  assert.ok(safe);
  assert.equal(safe.nsfw, 0);
  assert.equal(api.videoRow({ ...base, nsfw: true }), null);
  assert.equal(api.videoRow({ ...base, nsfw: undefined }), null);
});

test("YouTube Data API requests use strict safeSearch", async () => {
  requests.length = 0;
  await api.youtube("solar system", "test-key", 5);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get("safeSearch"), "strict");
});

test("indexed video SQL excludes unknown and flagged rows while image lookup is unchanged", () => {
  const video = api.indexedQuery("video", "solar system", 40);
  const image = api.indexedQuery("image", "solar system", 40);
  assert.match(video.sql, /FROM media_items WHERE kind=\? AND nsfw=0/);
  assert.doesNotMatch(image.sql, /AND nsfw=0/);
});

test("daily rotating batches cover the full seed bank without overlap across a cycle", () => {
  const seeds = Array.from({ length: 24 }, (_, index) => "seed-" + index);
  const batches = Array.from({ length: 4 }, (_, day) =>
    Array.from(api.getDailySeedBatch(day, seeds, 6))
  );
  assert.equal(batches.every(batch => batch.length === 6), true);
  assert.equal(new Set(batches.flat()).size, 24);
  assert.equal(JSON.stringify(batches.flat()), JSON.stringify(seeds));
});

test("optional YouTube indexing rotates one selected seed per batch day", () => {
  for (let day = 0; day < 6; day++) {
    const selected = [0, 1, 2, 3, 4, 5].filter(index =>
      api.shouldIndexYouTubeSeed(index, day, true, 6)
    );
    assert.equal(JSON.stringify(selected), JSON.stringify([day]));
  }
  assert.equal(api.shouldIndexYouTubeSeed(0, 0, false, 6), false);
});

test("daily index circuit breaker disables a provider only after consecutive failures", () => {
  const circuit = api.createIndexCircuitBreaker(2);
  assert.equal(circuit.isDisabled("Openverse"), false);
  assert.equal(circuit.recordFailure("Openverse"), 1);
  assert.equal(circuit.isDisabled("Openverse"), false);
  circuit.recordSuccess("Openverse");
  assert.equal(circuit.recordFailure("Openverse"), 1);
  assert.equal(circuit.isDisabled("Openverse"), false);
  assert.equal(circuit.recordFailure("Openverse"), 2);
  assert.equal(circuit.isDisabled("Openverse"), true);
  assert.equal(circuit.isDisabled("PeerTube"), false);
});

test("D1 schema and migration default unverified media to hidden for video search", async () => {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("./migrations/20261031_video_nsfw_safety.sql", import.meta.url),
    "utf8"
  );
  assert.match(schema, /nsfw INTEGER NOT NULL DEFAULT 1/);
  assert.match(schema, /idx_media_items_kind_nsfw/);
  assert.match(migration, /ALTER TABLE media_items ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 1/);
  assert.match(source, /duration_seconds,tags,nsfw,indexed_at/);
});
