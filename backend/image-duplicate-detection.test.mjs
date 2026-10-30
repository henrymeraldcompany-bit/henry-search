import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const moduleSource = await readFile(new URL("./image-search.js", import.meta.url), "utf8");
const moduleUrl = "data:text/javascript;base64," + Buffer.from(moduleSource).toString("base64");
const { runImageProviders } = await import(moduleUrl);

test("deduplicates identical image pages despite tracking parameters and fragments", async () => {
  const result = await runImageProviders([
    {name:"Provider A",search:async()=>[{title:"Solar system",page_url:"https://www.example.com/image/1?utm_source=a#photo",media_url:"https://cdn.example.com/a.jpg?ref=feed"}]},
    {name:"Provider B",search:async()=>[{title:"Solar system photo",page_url:"https://example.com/image/1",media_url:"https://cdn.example.com/a.jpg?ref=other",author:"Astronomy Lab",license:"CC BY"}]}
  ],"solar system");
  assert.equal(result.results.length,1);
  assert.equal(result.results[0].author,"Astronomy Lab");
  assert.equal(result.results[0].license,"CC BY");
  assert.deepEqual(result.results[0].sources,["Provider A","Provider B"]);
});

test("deduplicates different source pages that point to the same original media", async () => {
  const result = await runImageProviders([
    {name:"Provider A",search:async()=>[{title:"Nebula",page_url:"https://a.example/photo/1",media_url:"https://cdn.example/nebula.jpg"}]},
    {name:"Provider B",search:async()=>[{title:"Nebula image",page_url:"https://b.example/item/9",media_url:"https://cdn.example/nebula.jpg?utm_campaign=x",description:"A detailed nebula photograph"}]}
  ],"nebula");
  assert.equal(result.results.length,1);
  assert.match(result.results[0].description,/detailed/);
  assert.deepEqual(result.results[0].sources,["Provider A","Provider B"]);
});

test("does not merge different image files from the same page", async () => {
  const result = await runImageProviders([
    {name:"Provider A",search:async()=>[
      {title:"Two views",page_url:"https://example.com/gallery",media_url:"https://cdn.example/one.jpg"},
      {title:"Two views",page_url:"https://example.com/gallery?image=2",media_url:"https://cdn.example/two.jpg"}
    ]}
  ],"views");
  assert.equal(result.results.length,2);
});

test("preserves distinct query parameters that may identify different images", async () => {
  const result = await runImageProviders([
    {name:"Provider A",search:async()=>[
      {title:"Photo",page_url:"https://example.com/photo?id=1",media_url:"https://cdn.example/photo?id=1"},
      {title:"Photo",page_url:"https://example.com/photo?id=2",media_url:"https://cdn.example/photo?id=2"}
    ]}
  ],"photo");
  assert.equal(result.results.length,2);
});
