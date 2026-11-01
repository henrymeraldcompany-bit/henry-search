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

test("unifies the same canonical video URL returned by different providers", async () => {
  const result = await runVideoProviders([
    {name:"Provider A",search:async()=>[{
      source:"Provider A",source_id:"a-1",page_url:"https://www.example.com/watch?id=42&utm_source=feed#player",
      title:"Untitled video",description:"",thumbnail_url:"",author:""
    }]},
    {name:"Provider B",search:async()=>[{
      source:"Provider B",source_id:"b-9",page_url:"https://example.com/watch?id=42",
      title:"A useful video title",description:"A fuller description",
      thumbnail_url:"https://cdn.example.com/thumb.jpg",author:"Creator",license:"CC BY"
    }]}
  ],"useful video");
  assert.equal(result.results.length,1);
  const row=result.results[0];
  assert.equal(row.title,"A useful video title");
  assert.equal(row.description,"A fuller description");
  assert.equal(row.thumbnail_url,"https://cdn.example.com/thumb.jpg");
  assert.deepEqual(row.sources,["Provider A","Provider B"]);
});

test("keeps different meaningful video identifiers separate", async () => {
  const result=await runVideoProviders([{name:"YouTube",search:async()=>[
    {source_id:"abc123",page_url:"https://youtube.com/watch?v=abc123",title:"First"},
    {source_id:"xyz789",page_url:"https://youtube.com/watch?v=xyz789",title:"Second"}
  ]}],"video");
  assert.equal(result.results.length,2);
});

import { rankVideoResults } from "./video-search.js";

test("ranks exact video title phrases above loose description matches", () => {
  const rows = [
    {title:"A planet documentary",description:"Solar system science",page_url:"https://a.example/1"},
    {title:"Solar system documentary",description:"A tour of the planets",page_url:"https://b.example/2"},
    {title:"Solar system facts",description:"",page_url:"https://c.example/3"}
  ];
  const result = rankVideoResults(rows,"solar system",10);
  assert.equal(result[0].title,"Solar system documentary");
  assert.equal(result[1].title,"Solar system facts");
  assert.equal(result[2].title,"A planet documentary");
});

test("requires meaningful matches and excludes unrelated video results", () => {
  const result=rankVideoResults([
    {title:"Football highlights",description:"Sports clip"},
    {title:"Solar system model",description:"Planets and the Sun"}
  ],"how to find a solar system video",10);
  assert.deepEqual(result.map(row=>row.title),["Solar system model"]);
});

test("uses descriptions and creator metadata as secondary relevance signals", () => {
  const result=rankVideoResults([
    {title:"Untitled video",description:""},
    {title:"Untitled video",description:"",author:"Astronomy educator"}
  ],"astronomy educator",10);
  assert.equal(result.length,1);
  assert.equal(result[0].author,"Astronomy educator");
});

test("does not match short query fragments inside unrelated words", () => {
  const result=rankVideoResults([
    {title:"Party music performance"},
    {title:"Art history lecture"}
  ],"art",10);
  assert.deepEqual(result.map(row=>row.title),["Art history lecture"]);
});

test("supports accented and non-Latin video search terms", () => {
  assert.equal(rankVideoResults([{title:"Café technology talk"}],"café technology",10).length,1);
  assert.equal(rankVideoResults([{title:"東京 system lecture"}],"東京 system",10).length,1);
});

test("returns no ranked results for generic-only queries", () => {
  assert.deepEqual(rankVideoResults([{title:"A nice video"}],"videos clips watch",10),[]);
});
