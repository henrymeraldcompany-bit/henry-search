import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const worker = await readFile(new URL("./worker.js", import.meta.url), "utf8");
const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
const migration = await readFile(
  new URL("./migrations/20261101_image_index_metadata.sql", import.meta.url),
  "utf8"
);

function extractSave() {
  const start = worker.indexOf("async function save(env, rows) {");
  assert.notEqual(start, -1, "save() must exist");
  const end = worker.indexOf("\nfunction sqlWordText(", start);
  assert.notEqual(end, -1, "save() must end before sqlWordText()");
  return worker.slice(start, end);
}

test("base D1 schema includes image metadata and lookup indexes", () => {
  for (const column of [
    "provider TEXT NOT NULL DEFAULT ''",
    "creator_url TEXT NOT NULL DEFAULT ''",
    "license_url TEXT NOT NULL DEFAULT ''",
    "attribution TEXT NOT NULL DEFAULT ''",
    "width INTEGER",
    "height INTEGER",
    "format TEXT NOT NULL DEFAULT ''"
  ]) assert.ok(schema.includes(column), "Missing schema column: " + column);
  assert.match(schema, /idx_media_items_image_format/);
  assert.match(schema, /idx_media_items_image_dimensions/);
});

test("image metadata migration adds backward-compatible columns and indexes", () => {
  for (const column of ["provider", "creator_url", "license_url", "attribution", "width", "height", "format"]) {
    assert.match(migration, new RegExp("ADD COLUMN " + column + "\\b"));
  }
  assert.match(migration, /idx_media_items_image_format/);
  assert.match(migration, /idx_media_items_image_dimensions/);
});

test("D1 save persists and updates image attribution, dimensions and format", async () => {
  const save = vm.runInNewContext("(" + extractSave() + ")", {
    Date, JSON, Number
  });
  const statements = [];
  const env = { MEDIA_DB: {
    prepare(sql) {
      return { bind(...values) { statements.push({ sql, values }); return { sql, values }; } };
    },
    async batch(batch) { statements.push(...batch); }
  }};
  const row = {
    kind: "image", source: "Openverse", source_id: "img-1", title: "Solar image",
    description: "A star", page_url: "https://source.example/image/1",
    media_url: "https://cdn.example/image.jpg", thumbnail_url: "https://cdn.example/thumb.jpg",
    embed_url: "", author: "Artist", license: "CC BY 4.0",
    provider: "catalog-provider", creator_url: "https://source.example/artist",
    license_url: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Photo by Artist", width: 1920, height: 1080,
    format: "image/jpeg", published_at: "2026-10-01", duration_seconds: null,
    tags: ["space"], nsfw: 1
  };
  assert.equal(await save(env, [row]), 1);
  assert.equal(statements.length, 1);
  const { sql, values } = statements[0];
  assert.match(sql, /provider,creator_url,license_url,attribution,width,height,format/);
  assert.match(sql, /provider=excluded\.provider/);
  assert.equal(values.length, 23);
  assert.equal(values[11], "catalog-provider");
  assert.equal(values[12], "https://source.example/artist");
  assert.equal(values[13], "https://creativecommons.org/licenses/by/4.0/");
  assert.equal(values[14], "Photo by Artist");
  assert.equal(values[15], 1920);
  assert.equal(values[16], 1080);
  assert.equal(values[17], "image/jpeg");
  assert.deepEqual(JSON.parse(values[20]), ["space"]);
});

test("D1 save keeps optional image metadata empty and rejects invalid dimensions", async () => {
  const save = vm.runInNewContext("(" + extractSave() + ")", { Date, JSON, Number });
  let statement;
  const env = { MEDIA_DB: {
    prepare(sql) { return { bind(...values) { statement = { sql, values }; return statement; } }; },
    async batch() {}
  }};
  const row = {
    kind: "image", source: "Wikimedia Commons", source_id: "2", title: "Untitled",
    description: "", page_url: "https://commons.example/2", media_url: "https://cdn.example/2.jpg",
    thumbnail_url: "https://cdn.example/2-thumb.jpg", embed_url: "", author: "", license: "",
    published_at: "", duration_seconds: null, tags: "", width: -1, height: "unknown", nsfw: 1
  };
  await save(env, [row]);
  assert.equal(statement.values[11], "");
  assert.equal(statement.values[12], "");
  assert.equal(statement.values[13], "");
  assert.equal(statement.values[14], "");
  assert.equal(statement.values[15], null);
  assert.equal(statement.values[16], null);
  assert.equal(statement.values[17], "");
});
