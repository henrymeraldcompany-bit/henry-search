import assert from "node:assert/strict";
import test from "node:test";
import { filterImageResults } from "./image-filters.js";

const now = Date.parse("2026-10-31T12:00:00Z");
const rows = [
  { title:"Recent landscape JPG", source:"Openverse", published_at:"2026-10-30T12:00:00Z", width:1920, height:1080, media_url:"https://cdn.example/a.jpg" },
  { title:"Old portrait PNG", source:"Wikimedia Commons", published_at:"2025-01-01T00:00:00Z", width:800, height:1200, format:"image/png", media_url:"https://cdn.example/b.png" },
  { title:"Recent square WebP", source:"Openverse", published_at:"2026-10-29T12:00:00Z", width:500, height:500, media_url:"https://cdn.example/c.webp" },
  { title:"Unknown metadata", source:"Flickr public feed", media_url:"https://cdn.example/d.jpg" }
];

test("filters images by publication date and excludes unknown dates for bounded ranges", () => {
  assert.deepEqual(filterImageResults(rows,{date:"week"},now).map(x=>x.title),["Recent landscape JPG","Recent square WebP"]);
});

test("filters by image dimensions and orientation", () => {
  assert.deepEqual(filterImageResults(rows,{dimensions:"large"},now).map(x=>x.title),["Recent landscape JPG"]);
  assert.deepEqual(filterImageResults(rows,{dimensions:"portrait"},now).map(x=>x.title),["Old portrait PNG"]);
  assert.deepEqual(filterImageResults(rows,{dimensions:"square"},now).map(x=>x.title),["Recent square WebP"]);
});

test("filters by source and image format", () => {
  assert.deepEqual(filterImageResults(rows,{source:"Openverse",format:"webp"},now).map(x=>x.title),["Recent square WebP"]);
  assert.deepEqual(filterImageResults(rows,{format:"png"},now).map(x=>x.title),["Old portrait PNG"]);
});

test("leaves results unchanged for default filters", () => {
  assert.equal(filterImageResults(rows,{},now).length,4);
});

test("rejects unsupported filter values without returning misleading matches", () => {
  assert.deepEqual(filterImageResults(rows,{date:"tomorrow"},now),[]);
  assert.deepEqual(filterImageResults(rows,{format:"exe"},now),[]);
});
