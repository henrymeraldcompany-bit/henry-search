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
const api = vm.runInNewContext(
  "(function(){ " + [extract("terms"), extract("indexedQuery")].join("\n") +
  "; return {indexedQuery}; })()",
  { String, Number, Math }
);

test("returns no indexed query for empty or punctuation-only searches", () => {
  assert.equal(api.indexedQuery("image", "   ", 100), null);
  assert.equal(api.indexedQuery("video", "!? %_", 100), null);
});

test("ranks exact title phrases first, then weighted term matches, then freshness", () => {
  const query = api.indexedQuery("video", "solar system", 100);
  assert.ok(query);
  assert.match(query.sql, /ORDER BY CASE WHEN LOWER\(title\) LIKE \? THEN 0 ELSE 1 END/);
  assert.match(query.sql, /CASE WHEN LOWER\(title\) LIKE \? THEN 6 WHEN LOWER\(description\) LIKE \? THEN 2 WHEN LOWER\(tags\) LIKE \? THEN 1 ELSE 0 END/);
  assert.match(query.sql, /DESC, indexed_at DESC LIMIT \?$/);
  assert.equal(query.params[0], "video");
  assert.equal(query.params[7], "%solar system%");
  assert.equal(query.params.at(-1), 100);
});

test("binds one score triplet per term and keeps placeholders aligned", () => {
  const query = api.indexedQuery("image", "science nature history", 80);
  const placeholders = (query.sql.match(/\?/g) || []).length;
  assert.equal(placeholders, query.params.length);
  assert.equal(query.params.length, 1 + 9 + 1 + 9 + 1);
  assert.equal(query.params.at(-1), 80);
});

test("caps candidate limits and defaults to a useful shortlist of 100", () => {
  assert.equal(api.indexedQuery("video", "science", 999).params.at(-1), 120);
  assert.equal(api.indexedQuery("video", "science", 1).params.at(-1), 1);
  assert.equal(api.indexedQuery("video", "science").params.at(-1), 100);
});

test("removes SQL wildcard characters from query patterns", () => {
  const query = api.indexedQuery("image", "solar% system_", 100);
  assert.equal(query.params[1], "%solar%");
  assert.equal(query.params[4], "%system%");
  assert.equal(query.params[7], "%solar system%");
});
