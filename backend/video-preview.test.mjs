import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../style.css", import.meta.url), "utf8");
const start = source.indexOf("function createVideoPreviewIndicator(");
assert.notEqual(start, -1, "createVideoPreviewIndicator must exist");
const end = source.indexOf("\n}", start);
assert.notEqual(end, -1, "preview indicator helper must close");
const helper = source.slice(start, end + 2);
const document = {
  createElement(tag) {
    return {
      tagName: tag.toUpperCase(),
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; }
    };
  }
};
const api = vm.runInNewContext(
  "(function(){ " + helper + "; return createVideoPreviewIndicator; })()",
  { document }
);

test("playable video thumbnails receive a visible preview indicator", () => {
  const indicator = api(true);
  assert.equal(indicator.className, "video-preview-indicator");
  assert.equal(indicator.textContent, "▶ Preview");
  assert.equal(indicator.attributes["aria-hidden"], "true");
});

test("videos without permitted in-page playback are labelled as original-site links", () => {
  const indicator = api(false);
  assert.equal(indicator.textContent, "↗ Open video");
  assert.equal(indicator.className, "video-preview-indicator");
});

test("video result cards attach the preview cue after the thumbnail content", () => {
  assert.match(source, /thumbnailButton\.appendChild\(createVideoPreviewIndicator\(!!playableEmbedUrl\)\)/);
  assert.match(source, /image\.loading = "lazy"/);
  assert.match(source, /image\.decoding = "async"/);
});

test("preview indicator remains readable over thumbnails and keyboard focus is visible", () => {
  assert.match(css, /\.video-preview-indicator\s*\{/);
  assert.match(css, /background:\s*rgba\(5,\s*12,\s*20,\s*\.86\)/);
  assert.match(css, /\.video-thumb-button:focus-visible\s*\{/);
});
