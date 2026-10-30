import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./worker.js", import.meta.url), "utf8");
function extract(name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " must exist");
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1);
  return source.slice(start, end + 2);
}
function extractAsync(signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, signature + " must exist");
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1);
  return source.slice(start, end + 2);
}
const harness = vm.runInNewContext(
  "(function(){ " + [extract("clean"), extract("safeUrl"), extract("googleImageRow"), extractAsync("async function googleImages(q, env, count) {")].join("\n") + "; return {googleImages}; })()",
  { URL, Number, String, Promise, getJson: async (url) => {
    const u = new URL(url);
    assert.equal(u.origin, "https://www.googleapis.com");
    assert.equal(u.pathname, "/customsearch/v1");
    assert.equal(u.searchParams.get("key"), "test-key");
    assert.equal(u.searchParams.get("cx"), "test-cx");
    assert.equal(u.searchParams.get("searchType"), "image");
    assert.equal(u.searchParams.get("safe"), "active");
    assert.equal(u.searchParams.get("rights"), "cc_publicdomain,cc_attribute,cc_sharealike");
    assert.equal(u.searchParams.get("q"), "solar system");
    return { items: [{
      title: "Solar system illustration", snippet: "The planets around the Sun",
      link: "https://images.example/solar.jpg",
      image: { contextLink: "https://publisher.example/solar", thumbnailLink: "https://images.example/solar-thumb.jpg" }
    }, { title: "Unsafe image", link: "javascript:alert(1)", image: {contextLink:"https://publisher.example/x",thumbnailLink:"https://images.example/x.jpg"} }] };
  }}
);
test("uses official Google image search with safe search and reusable license filters", async () => {
  const rows = await harness.googleImages("solar system", {GOOGLE_CSE_API_KEY:"test-key",GOOGLE_CSE_ID:"test-cx"}, 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "Google Images");
  assert.equal(rows[0].page_url, "https://publisher.example/solar");
  assert.equal(rows[0].media_url, "https://images.example/solar.jpg");
  assert.equal(rows[0].thumbnail_url, "https://images.example/solar-thumb.jpg");
  assert.match(rows[0].license, /not supplied by Google/);
});
test("does not call Google when existing-customer credentials are absent", async () => {
  assert.deepEqual(await harness.googleImages("solar system", {}, 10), []);
  assert.deepEqual(await harness.googleImages("solar system", {GOOGLE_CSE_API_KEY:"only-key"}, 10), []);
});
