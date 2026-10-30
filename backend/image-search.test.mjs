import assert from "node:assert/strict";
import test from "node:test";
import { runImageProviders } from "./image-search.js";

test("queries image providers independently and preserves successful sources", async () => {
  const result=await runImageProviders([
    {name:"Commons",search:async()=>[{title:"Solar",page_url:"https://commons.example/file/1",media_url:"https://cdn.example/1.jpg",thumbnail_url:"https://cdn.example/1-small.jpg"}]},
    {name:"Flickr",search:async()=>[{title:"Solar photo",page_url:"https://flickr.example/photo/2",media_url:"https://cdn.example/2.jpg"}]},
    {name:"Unavailable",search:async()=>{throw new Error("temporary outage");}}
  ],"solar");
  assert.deepEqual(result.providers,["Commons","Flickr"]);
  assert.equal(result.attempted,3);
  assert.equal(result.failures[0].provider,"Unavailable");
  assert.equal(result.results.length,2);
});

test("deduplicates identical original pages and merges useful metadata", async () => {
  const result=await runImageProviders([
    {name:"Commons",search:async()=>[{title:"Image",page_url:"https://example.com/photo",media_url:"https://cdn.example/photo.jpg",description:"Short"}]},
    {name:"Flickr",search:async()=>[{title:"Image",page_url:"https://example.com/photo",media_url:"https://cdn.example/photo.jpg",description:"A longer description",author:"Photographer",license:"CC BY"}]}
  ],"photo");
  assert.equal(result.results.length,1);
  assert.equal(result.results[0].description,"A longer description");
  assert.equal(result.results[0].author,"Photographer");
  assert.deepEqual(result.results[0].sources,["Commons","Flickr"]);
});

test("rejects unsafe and incomplete image results", async () => {
  const result=await runImageProviders([{name:"Test",search:async()=>[
    {title:"Unsafe",page_url:"javascript:alert(1)",media_url:"https://cdn.example/a.jpg"},
    {title:"Missing media",page_url:"https://example.com/a"},
    {title:"Valid",page_url:"https://example.com/b",media_url:"https://cdn.example/b.jpg"}
  ]}],"test");
  assert.equal(result.results.length,1);
  assert.equal(result.results[0].title,"Valid");
});
