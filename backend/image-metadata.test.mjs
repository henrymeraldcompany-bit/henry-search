import assert from "node:assert/strict";
import test from "node:test";
import { extractImageMetadata } from "./image-metadata.js";

test("extracts dimensions, MIME format, publication date, tags and accessibility text", () => {
  const result = extractImageMetadata({
    width: 1920, height: 1080, mime_type: "image/jpeg",
    publishedAt: "2026-10-31T12:30:00Z",
    tags: [{name:"Nature"}, {name:"sunset"}, {name:"Nature"}],
    alt: "Sunset over the ocean"
  });
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
  assert.equal(result.format, "jpg");
  assert.equal(result.published_at, "2026-10-31T12:30:00.000Z");
  assert.deepEqual(result.tags, ["nature", "sunset"]);
  assert.equal(result.alt_text, "Sunset over the ocean");
});

test("falls back to safe file extensions and nested metadata fields", () => {
  const result = extractImageMetadata({
    media_url: "https://cdn.example/photo.webp?size=large",
    image: {width: 800, height: 600, alt: "A sample"},
    metadata: {camera:"Example Camera", color_space:"sRGB", orientation:"landscape"}
  });
  assert.equal(result.format, "webp");
  assert.equal(result.width, 800);
  assert.equal(result.height, 600);
  assert.equal(result.camera, "Example Camera");
  assert.equal(result.color_space, "sRGB");
  assert.equal(result.orientation, "landscape");
  assert.equal(result.alt_text, "A sample");
});

test("rejects invalid dimensions and dates and bounds metadata", () => {
  const result = extractImageMetadata({
    width: -20, height: "Infinity", format: "application/x-executable",
    published_at: "not a date", tags: ["x".repeat(200), "safe"]
  });
  assert.equal(result.width, null);
  assert.equal(result.height, null);
  assert.equal(result.format, "");
  assert.equal(result.published_at, "");
  assert.equal(result.tags[0].length, 80);
});

test("accepts structured tag JSON and MIME parameters", () => {
  const result = extractImageMetadata({
    mimeType: "image/png; charset=binary",
    tags: '[{"name":"Architecture"},{"name":"Design"}]'
  });
  assert.equal(result.format, "png");
  assert.deepEqual(result.tags, ["architecture", "design"]);
});
