import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const worker = await readFile(new URL("./worker.js", import.meta.url), "utf8");
const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("./migrations/20261102_index_deduplication.sql", import.meta.url), "utf8");

function extract(name, next, context) {
  const start = worker.indexOf(name);
  assert.notEqual(start, -1, name + " must exist");
  const end = worker.indexOf("\\n" + next, start);
  assert.notEqual(end, -1, "Could not find end of " + name);
  return vm.runInNewContext("(" + worker.slice(start, end) + ")", context);
}
const safeUrl = value => {
  try { const u = new URL(String(value || "")); return ["http:","https:"].includes(u.protocol) ? u.href : ""; }
  catch { return ""; }
};
const canonicalMediaKey = row => {
  const href = safeUrl(row.page_url || row.url);
  if (!href) return "";
  const u = new URL(href), host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be" || ["youtube.com","m.youtube.com","youtube-nocookie.com"].includes(host)) {
    const id = host === "youtu.be" ? u.pathname.split("/").filter(Boolean)[0] :
      (u.searchParams.get("v") || u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/i)?.[1] || "");
    if (id) return "https://youtube.com/watch?v=" + encodeURIComponent(id);
  }
  u.hostname = host; u.hash = "";
  for (const key of [...u.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|dclid|ref|ref_src|source|feature|si)$/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort(); if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.href;
};
const canonicalIndexUrl = extract("function canonicalIndexUrl(value, kind) {", "function indexDedupKeys", { safeUrl, URL, Array, canonicalMediaKey });
const indexDedupKeys = extract("function indexDedupKeys(row) {", "async function save(env, rows)", { canonicalIndexUrl });

test("video index identity merges YouTube watch, short and embed URL variants", () => {
  const keys = [
    indexDedupKeys({kind:"video",page_url:"https://www.youtube.com/watch?v=abc123&utm_source=feed"}),
    indexDedupKeys({kind:"video",page_url:"https://youtu.be/abc123"}),
    indexDedupKeys({kind:"video",page_url:"https://youtube-nocookie.com/embed/abc123"})
  ];
  assert.equal(new Set(keys.map(x => x.canonical_page_url)).size, 1);
  assert.equal(keys[0].canonical_media_url, "");
});

test("image index identity removes tracking but retains meaningful media parameters", () => {
  const a = indexDedupKeys({kind:"image",media_url:"https://CDN.example/photo.jpg?size=large&utm_source=a#preview"});
  const b = indexDedupKeys({kind:"image",media_url:"https://cdn.example/photo.jpg?size=large"});
  const distinct = indexDedupKeys({kind:"image",media_url:"https://cdn.example/photo.jpg?size=small"});
  assert.equal(a.canonical_media_url, b.canonical_media_url);
  assert.notEqual(a.canonical_media_url, distinct.canonical_media_url);
  assert.equal(a.canonical_page_url, "");
});

test("image identity uses the media URL, so distinct gallery images are not merged", () => {
  const one = indexDedupKeys({kind:"image",page_url:"https://example.com/gallery",media_url:"https://cdn.example/one.jpg"});
  const two = indexDedupKeys({kind:"image",page_url:"https://example.com/gallery",media_url:"https://cdn.example/two.jpg"});
  assert.notEqual(one.canonical_media_url, two.canonical_media_url);
});

test("D1 schema and migration enforce separate canonical video and image identities", () => {
  for (const source of [schema, migration]) {
    assert.match(source, /canonical_page_url TEXT NOT NULL DEFAULT ''/);
    assert.match(source, /canonical_media_url TEXT NOT NULL DEFAULT ''/);
    assert.match(source, /idx_media_items_video_canonical_page[\\s\\S]*WHERE kind='video'/);
    assert.match(source, /idx_media_items_image_canonical_media[\\s\\S]*WHERE kind='image'/);
  }
  assert.match(worker, /ON CONFLICT DO UPDATE SET/);
  assert.match(worker, /canonical_page_url=COALESCE/);
  assert.match(worker, /canonical_media_url=COALESCE/);
});
