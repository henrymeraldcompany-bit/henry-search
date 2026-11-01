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
