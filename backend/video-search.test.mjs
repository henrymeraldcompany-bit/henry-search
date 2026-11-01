import assert from "node:assert/strict";
import test from "node:test";
import { runVideoProviders } from "./video-search.js";

test("runs independent providers and combines their video results", async () => {
  const result = await runVideoProviders([
    { name: "PeerTube", search: async q => [{source_id:"abc",page_url:"https://peer.example/w/abc",title:"Space exploration",description:"A short clip"}] },
    { name: "YouTube", search: async q => [{source_id:"xyz",page_url:"https://youtube.com/watch?v=xyz",title:"Space exploration lecture"}] }
  ], "space exploration");
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.providers, ["PeerTube", "YouTube"]);
  assert.equal(result.attempted, 2);
  assert.deepEqual(result.failures, []);
});

test("isolates failed providers while retaining successful results", async () => {
  const result = await runVideoProviders([
    {name:"PeerTube",search:async()=>{throw new Error("temporarily unavailable");}},
    {name:"YouTube",search:async()=>[{page_url:"https://youtube.com/watch?v=1",title:"Science"}]}
  ], "science");
  assert.equal(result.results.length, 1);
  assert.equal(result.failures[0].provider, "PeerTube");
  assert.equal(result.providers[0], "YouTube");
});

test("deduplicates repeated IDs from one provider and merges richer metadata", async () => {
  const result = await runVideoProviders([
    {name:"PeerTube",search:async()=>[
      {source_id:"same",page_url:"https://peer.example/w/same",title:"Untitled video"},
      {source_id:"same",page_url:"https://peer.example/w/same",title:"A better title",description:"More detail"}
    ]}
  ], "test");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].title, "A better title");
  assert.equal(result.results[0].description, "More detail");
});

test("rejects unsafe, malformed and explicitly unsafe video rows", async () => {
  const result = await runVideoProviders([
    {name:"Provider",search:async()=>[
      {page_url:"javascript:alert(1)",title:"bad"},
      {page_url:"https://example.com/unsafe",nsfw:true,title:"unsafe"},
      {page_url:"https://example.com/good",title:"safe"}
    ]}
  ], "safe");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].nsfw, 0);
});

test("returns a consistent public video schema with provider and source attribution", async () => {
  const result = await runVideoProviders([
    {name:"Wikimedia Commons",search:async()=>[{
      source_id:"commons-42",source:"Wikimedia Commons",provider:"Wikimedia Commons",
      page_url:"https://commons.wikimedia.org/wiki/File:Earth.webm",
      media_url:"https://upload.wikimedia.org/earth.webm",
      thumbnail_url:"https://upload.wikimedia.org/earth.jpg",
      embed_url:"",title:"Earth from orbit",description:"A view of Earth",
      author:"NASA",license:"CC BY 4.0",published_at:"2025-01-02T00:00:00Z",
      duration_seconds:12.5
    }]}
  ],"Earth from orbit");
  assert.deepEqual(Object.keys(result.results[0]).filter(key => [
    "kind","source_id","source","provider","sources","title","description",
    "page_url","media_url","thumbnail_url","embed_url","author","license",
    "published_at","duration_seconds","nsfw"
  ].includes(key)).sort(), [
    "kind","source_id","source","provider","sources","title","description",
    "page_url","media_url","thumbnail_url","embed_url","author","license",
    "published_at","duration_seconds","nsfw"
  ].sort());
  assert.equal(result.results[0].kind,"video");
  assert.equal(result.results[0].media_url,"https://upload.wikimedia.org/earth.webm");
  assert.equal(result.results[0].license,"CC BY 4.0");
  assert.equal(result.results[0].duration_seconds,12.5);
  assert.deepEqual(result.results[0].sources,["Wikimedia Commons"]);
});

test("normalizes missing optional metadata to stable empty or null values", async () => {
  const result=await runVideoProviders([{name:"Example",search:async()=>[
    {page_url:"https://video.example/watch/1",source_id:"1",title:"A video"}
  ]}],"video");
  const row=result.results[0];
  assert.equal(row.thumbnail_url,"");
  assert.equal(row.embed_url,"");
  assert.equal(row.author,"");
  assert.equal(row.license,"");
  assert.equal(row.published_at,"");
  assert.equal(row.duration_seconds,null);
  assert.deepEqual(row.sources,["Example"]);
});
