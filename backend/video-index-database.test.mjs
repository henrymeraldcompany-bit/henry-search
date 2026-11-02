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
    Date, JSON, Number, String, indexDedupKeys: row => ({ canonical_page_url: row.kind === "video" ? row.page_url : "", canonical_media_url: row.kind === "image" ? row.media_url : "" })
  });
  const statements = [];
  const batchSizes = [];
  const env = { MEDIA_DB: {
    prepare(sql) {
      return { bind(...values) { return { sql, values }; } };
    },
    async batch(batch) { statements.push(...batch); batchSizes.push(batch.length); }
  }};
  return { save, env, statements, batchSizes };
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
  assert.match(sql, /ON CONFLICT DO UPDATE SET/);
  assert.equal(values[23], "https://www.youtube.com/watch?v=abc12345678");
  assert.equal(values[24], "");
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
  const { save, env, statements, batchSizes } = makeSaveHarness();
  const rows = Array.from({ length: 85 }, (_, index) => ({
    kind: "video", source: "PeerTube", source_id: "batch-" + index,
    title: "Batch video " + index, description: "",
    page_url: "https://videos.example/batch/" + index,
    media_url: "", thumbnail_url: "", embed_url: "", author: "",
    published_at: "", duration_seconds: null, tags: [], nsfw: 0
  }));
  assert.equal(await save(env, rows), 85);
  assert.equal(statements.length, 85);
  assert.deepEqual(batchSizes, [40, 40, 5]);
});


function extractWorkerFunction(name, nextName, context) {
  const start = worker.indexOf(name);
  assert.notEqual(start, -1, name + " must exist");
  const end = worker.indexOf("\n" + nextName, start);
  assert.notEqual(end, -1, "Could not find end of " + name);
  const source = worker.slice(start, end);
  return vm.runInNewContext("(" + source + ")", context);
}

test("PeerTube adapter stores available creator links, tags and provider metadata", () => {
  const safeUrl = (value, base) => {
    if (!value) return "";
    try { const url = new URL(value, base); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; }
    catch { return ""; }
  };
  const clean = value => String(value || "").replace(/<[^>]*>/g, "").trim();
  const normalizeNumericDuration = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const videoRow = extractWorkerFunction("function videoRow(v) {", "function peertubeSearchTargets", {
    safeUrl, clean, normalizeNumericDuration, PEERTUBE: "https://peertube.tv"
  });
  const row = videoRow({
    uuid: "video-42", host: "https://peer.tube", url: "/videos/watch/video-42",
    title: "Metadata-rich lesson", description: "A useful lesson", nsfw: false,
    duration: 95, publishedAt: "2026-11-01T08:00:00Z",
    channel: { displayName: "Example creator", url: "/accounts/example" },
    tags: ["science", { name: "space" }, { label: "education" }]
  });
  assert.equal(row.provider, "PeerTube");
  assert.equal(row.creator_url, "https://peer.tube/accounts/example");
  assert.deepEqual(JSON.parse(JSON.stringify(row.tags)), ["science", "space", "education"]);
  assert.equal(row.duration_seconds, 95);
  assert.equal(row.author, "Example creator");
  assert.equal(row.page_url, "https://peer.tube/videos/watch/video-42");
});

test("YouTube adapter stores provider and channel metadata while enriching duration", async () => {
  const calls = [];
  const getJson = async url => {
    const parsed = new URL(url); calls.push(parsed);
    if (parsed.pathname.endsWith("/search")) return { items: [{
      id: { videoId: "yt-42" },
      snippet: { title: "A lesson", description: "Useful detail", channelTitle: "Science channel",
        channelId: "UC-example", publishedAt: "2026-11-01T08:00:00Z",
        thumbnails: { high: { url: "https://i.ytimg.com/vi/yt-42/hqdefault.jpg" } } }
    }] };
    return { items: [{ id: "yt-42", contentDetails: { duration: "PT1M35S" } }] };
  };
  const clean = value => String(value || "").trim();
  const safeUrl = value => { try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) ? u.href : ""; } catch { return ""; } };
  const isoDurationSeconds = value => {
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value || "");
    return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : null;
  };
  const youtube = extractWorkerFunction("async function youtube(q, key, count) {", "async function saveSearchIndexRows(env, rows)", {
    URL, encodeURIComponent, getJson, clean, safeUrl, isoDurationSeconds, Map, console
  });
  const rows = await youtube("science", "server-secret", 5);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, "YouTube");
  assert.equal(rows[0].creator_url, "https://www.youtube.com/channel/UC-example");
  assert.equal(rows[0].duration_seconds, 95);
  assert.equal(rows[0].author, "Science channel");
  assert.equal(calls.length, 2);
});

test("video upserts preserve known metadata when refreshed provider fields are empty", async () => {
  const { save, env, statements } = makeSaveHarness();
  const row = {
    kind: "video", source: "peer.tube", source_id: "video-42",
    title: "Updated title", description: "Updated description",
    page_url: "https://peer.tube/videos/watch/video-42",
    media_url: "", thumbnail_url: "", embed_url: "", author: "",
    license: "", provider: "", creator_url: "", license_url: "",
    attribution: "", published_at: "", duration_seconds: null,
    tags: [], nsfw: 0
  };
  await save(env, [row]);
  const sql = statements[0].sql;
  for (const field of [
    "media_url=COALESCE(NULLIF(excluded.media_url,''),media_items.media_url)",
    "thumbnail_url=COALESCE(NULLIF(excluded.thumbnail_url,''),media_items.thumbnail_url)",
    "embed_url=COALESCE(NULLIF(excluded.embed_url,''),media_items.embed_url)",
    "author=COALESCE(NULLIF(excluded.author,''),media_items.author)",
    "provider=COALESCE(NULLIF(excluded.provider,''),media_items.provider)",
    "creator_url=COALESCE(NULLIF(excluded.creator_url,''),media_items.creator_url)",
    "published_at=COALESCE(NULLIF(excluded.published_at,''),media_items.published_at)",
    "duration_seconds=COALESCE(excluded.duration_seconds,media_items.duration_seconds)"
  ]) assert.ok(sql.includes(field), "Missing metadata-preserving upsert: " + field);
  assert.ok(sql.includes("tags=CASE WHEN excluded.tags IS NULL OR excluded.tags IN ('','[]') THEN media_items.tags ELSE excluded.tags END"));
  assert.match(sql, /nsfw=excluded\.nsfw/);
});
