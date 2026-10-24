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
  const nextFunction = source.indexOf("\nfunction ", start + 1);
  const nextAsync = source.indexOf("\nasync function ", start + 1);
  const candidates = [nextFunction, nextAsync].filter((index) => index >= 0);
  const end = candidates.length ? Math.min(...candidates) : source.indexOf("\nexport default", start);
  assert.notEqual(end, -1, "Could not find end of async " + name);
  return source.slice(start, end).trim();
}

test("queries Flickr's public feed with bounded tag terms and maps original links", async () => {
  let requestedUrl = "";
  let requestOptions = null;
  const fakeFetch = async (url, options) => {
    requestedUrl = String(url);
    requestOptions = options;
    return {
      ok: true,
      json: async () => ({
        items: [{
          title: "Solar System",
          link: "https://www.flickr.com/photos/example/12345/",
          media: { m: "https://live.staticflickr.com/1/12345_m.jpg" },
          author: "nobody@example (Example)",
          tags: "solar system astronomy",
          published: "2026-10-20T10:00:00Z",
          description: "<p>A <b>solar system</b> image</p>"
        }]
      })
    };
  };
  const helpers = [
    extract("clean"),
    extract("safeUrl"),
    extract("terms"),
    extract("fallbackQuery"),
    extract("flickrRow"),
    extractAsync("getJson"),
    extractAsync("flickr")
  ].join("\n");
  const api = vm.runInNewContext(
    "(async function(){ " + helpers + "; return {flickr}; })()",
    { URL, Date, AbortSignal, fetch: fakeFetch }
  );
  const { flickr } = await api;
  const rows = await flickr("how to solar system model with stars", 12);
  const request = new URL(requestedUrl);

  assert.equal(request.hostname, "www.flickr.com");
  assert.equal(request.pathname, "/services/feeds/photos_public.gne");
  assert.equal(request.searchParams.get("format"), "json");
  assert.equal(request.searchParams.get("nojsoncallback"), "1");
  assert.equal(request.searchParams.get("tagmode"), "any");
  assert.equal(request.searchParams.get("tags"), "solar,system,model,stars");
  assert.equal(requestOptions.signal.aborted, false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "Flickr public feed");
  assert.equal(rows[0].page_url, "https://www.flickr.com/photos/example/12345/");
  assert.equal(rows[0].media_url, "https://live.staticflickr.com/1/12345_m.jpg");
  assert.equal(rows[0].license, "License information unavailable");
  assert.equal(rows[0].description, "A solar system image");
  assert.equal(rows[0].published_at, "2026-10-20T10:00:00.000Z");
});

test("rejects Flickr feed entries without safe source and media URLs", async () => {
  const helpers = [
    extract("clean"),
    extract("safeUrl"),
    extract("flickrRow")
  ].join("\n");
  const api = vm.runInNewContext(
    "(function(){ " + helpers + "; return {flickrRow}; })()",
    { URL, Date }
  );
  assert.equal(api.flickrRow({ title: "Missing media", link: "https://www.flickr.com/photos/a/1/" }), null);
  assert.equal(api.flickrRow({
    title: "Unsafe",
    link: "javascript:alert(1)",
    media: { m: "https://example.org/image.jpg" }
  }), null);
});
