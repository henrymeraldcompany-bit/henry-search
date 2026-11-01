import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const worker = await readFile(new URL("./worker.js", import.meta.url), "utf8");
const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
const safetyMigration = await readFile(
  new URL("./migrations/20261031_video_nsfw_safety.sql", import.meta.url),
  "utf8"
);

function extractSave() {
  const start = worker.indexOf("async function save(env, rows) {");
  assert.notEqual(start, -1, "save() must exist");
  const end = worker.indexOf("\nfunction sqlWordText(", start);
  assert.notEqual(end, -1, "save() must end before sqlWordText()");
  return worker.slice(start, end);
}

function makeSaveHarness() {
  const save = vm.runInNewContext("(" + extractSave() + ")", {
    Date, JSON, Number, String
  });
  const statements = [];
  const env = { MEDIA_DB: {
    prepare(sql) {
      return { bind(...values) { return { sql, values }; } };
    },
    async batch(batch) { statements.push(...batch); }
  }};
  return { save, env, statements };
}

test("shared D1 schema contains the complete video-index persistence contract", () => {
  for (const column of [
    "kind TEXT NOT NULL CHECK (kind IN ('image','video'))",
    "source TEXT NOT NULL",
    "source_id TEXT NOT NULL DEFAULT ''",
    "page_url TEXT NOT NULL",
    "media_url TEXT NOT NULL DEFAULT ''",
    "thumbnail_url TEXT NOT NULL DEFAULT ''",
    "embed_url TEXT NOT NULL DEFAULT ''",
    "author TEXT NOT NULL DEFAULT ''",
    "published_at TEXT NOT NULL DEFAULT ''",
    "duration_seconds REAL",
    "nsfw INTEGER NOT NULL DEFAULT 1",
    "indexed_at TEXT NOT NULL"
  ]) assert.ok(schema.includes(column), "Missing video-index field: " + column);
  assert.match(schema, /UNIQUE\(kind,source,page_url\)/);
  assert.match(schema, /idx_media_items_kind_nsfw/);
});

test("video safety migration keeps old/unverified records hidden by default", () => {
  assert.match(safetyMigration, /ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 1/);
  assert.match(safetyMigration, /idx_media_items_kind_nsfw/);
});

test("D1 save persists safe video identity, playback metadata and duration", async () => {
  const { save, env, statements } = makeSaveHarness();
  const row = {
    kind: "video", source: "youtube.com", source_id: "abc12345678",
    title: "Solar system lesson", description: "An educational video",
    page_url: "https://www.youtube.com/watch?v=abc12345678",
    media_url: "https://www.youtube.com/watch?v=abc12345678",
    thumbnail_url: "https://i.ytimg.com/vi/abc12345678/hqdefault.jpg",
    embed_url: "https://www.youtube-nocookie.com/embed/abc12345678",
    author: "Science channel", license: "", provider: "YouTube",
    published_at: "2026-10-30T10:00:00Z", duration_seconds: 3723,
    tags: ["space", "science"], nsfw: 0
  };
  assert.equal(await save(env, [row]), 1);
  assert.equal(statements.length, 1);
  const { sql, values } = statements[0];
  assert.match(sql, /INSERT INTO media_items/);
  assert.match(sql, /ON CONFLICT\(kind,source,page_url\) DO UPDATE SET/);
  assert.match(sql, /duration_seconds=COALESCE\(excluded.duration_seconds,media_items.duration_seconds\)/);
  assert.equal(values[0], "video");
  assert.equal(values[1], "youtube.com");
  assert.equal(values[2], "abc12345678");
  assert.equal(values[6], row.media_url);
  assert.equal(values[8], row.embed_url);
  assert.equal(values[9], "Science channel");
  assert.equal(values[18], row.published_at);
  assert.equal(values[19], 3723);
  assert.deepEqual(JSON.parse(values[20]), ["space", "science"]);
  assert.equal(values[21], 0);
});

test("video duration storage accepts zero and numeric strings but rejects invalid values", async () => {
  const { save, env, statements } = makeSaveHarness();
  const durations = [0, "125.5", null, undefined, "", -3, "PT4M", Infinity, "not-a-number"];
  const rows = durations.map((duration, index) => ({
    kind: "video", source: "PeerTube", source_id: "video-" + index,
    title: "Video " + index, description: "",
    page_url: "https://videos.example/watch/" + index,
    media_url: "https://videos.example/watch/" + index,
    thumbnail_url: "", embed_url: "", author: "", license: "",
    published_at: "", duration_seconds: duration, tags: [], nsfw: 0
  }));
  assert.equal(await save(env, rows), durations.length);
  assert.deepEqual(statements.map(statement => statement.values[19]),
    [0, 125.5, null, null, null, null, null, null, null]);
});

test("video records without an explicit numeric safe classification remain unverified", async () => {
  const { save, env, statements } = makeSaveHarness();
  const rows = [undefined, null, 1, "0", true].map((classification, index) => ({
    kind: "video", source: "PeerTube", source_id: "unverified-" + index,
    title: "Unverified " + index, description: "",
    page_url: "https://videos.example/unverified/" + index,
    media_url: "", thumbnail_url: "", embed_url: "", author: "",
    published_at: "", duration_seconds: null, tags: [],
    nsfw: classification
  }));
  await save(env, rows);
  assert.deepEqual(statements.map(statement => statement.values[21]), [1, 1, 1, 1, 1]);
});

test("video writes are batched within the D1 statement limit", async () => {
  const { save, env, statements } = makeSaveHarness();
  const rows = Array.from({ length: 85 }, (_, index) => ({
    kind: "video", source: "PeerTube", source_id: "batch-" + index,
    title: "Batch video " + index, description: "",
    page_url: "https://videos.example/batch/" + index,
    media_url: "", thumbnail_url: "", embed_url: "", author: "",
    published_at: "", duration_seconds: null, tags: [], nsfw: 0
  }));
  assert.equal(await save(env, rows), 85);
  assert.equal(statements.length, 85);
});
