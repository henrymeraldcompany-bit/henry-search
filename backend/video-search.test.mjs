import assert from "node:assert/strict";
import test from "node:test";
import { runVideoProviders, rankVideoResults, buildVideoFallbackQuery } from "./video-search.js";

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

import { rankVideoResults, diversifyVideoResults } from "./video-search.js";

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

test("deduplicates YouTube watch, short, Shorts and embed URLs after ranking", () => {
  const rows = [
    {
      page_url:"https://youtu.be/abc123?si=share",
      title:"Solar documentary",
      description:"System facts",
      source:"Provider A",
      sources:["Provider A"]
    },
    {
      page_url:"https://www.youtube.com/shorts/abc123?feature=share",
      title:"Solar system documentary",
      description:"A detailed explanation of the solar system",
      thumbnail_url:"https://cdn.example.com/solar.jpg",
      source:"YouTube",
      sources:["YouTube"]
    },
    {
      page_url:"https://youtube.com/watch?v=xyz789",
      title:"Solar system documentary part two",
      source:"YouTube",
      sources:["YouTube"]
    }
  ];

  const results = rankVideoResults(rows, "solar system", 10);
  assert.equal(results.length, 2);
  assert.equal(results[0].page_url, "https://www.youtube.com/shorts/abc123?feature=share");
  assert.equal(results[0].title, "Solar system documentary");
  assert.equal(results[0].description, "A detailed explanation of the solar system");
  assert.equal(results[0].thumbnail_url, "https://cdn.example.com/solar.jpg");
  assert.deepEqual(results[0].sources, ["YouTube", "Provider A"]);
  assert.equal(results[1].page_url, "https://youtube.com/watch?v=xyz789");
});

test("deduplicates equivalent provider URLs after removing tracking parameters", () => {
  const results = rankVideoResults([
    {
      page_url:"https://www.example.com/watch?id=42&utm_source=feed#player",
      title:"Solar system overview",
      source:"Provider A"
    },
    {
      page_url:"https://example.com/watch?id=42",
      title:"Solar system overview",
      description:"A longer description from the second provider",
      source:"Provider B"
    }
  ], "solar system", 10);

  assert.equal(results.length, 1);
  assert.equal(results[0].description, "A longer description from the second provider");
  assert.deepEqual(results[0].sources, ["Provider A", "Provider B"]);
});

test("does not merge different YouTube video IDs", () => {
  const results = rankVideoResults([
    {page_url:"https://youtu.be/abc123",title:"Solar system facts"},
    {page_url:"https://youtube.com/watch?v=xyz789",title:"Solar system facts"}
  ], "solar system", 10);

  assert.equal(results.length, 2);
});

test("balances video sources while preserving relevance order within each provider", () => {
  const rows = [
    {source:"YouTube",title:"YT highest",score:30},
    {source:"YouTube",title:"YT second",score:25},
    {source:"YouTube",title:"YT third",score:20},
    {source:"PeerTube",title:"Peer highest",score:28},
    {source:"PeerTube",title:"Peer second",score:18},
    {source:"Wikimedia Commons",title:"Wiki highest",score:26}
  ];
  const result = diversifyVideoResults(rows, 6);
  assert.deepEqual(result.map(row => row.title), [
    "YT highest","Peer highest","Wiki highest",
    "YT second","Peer second","YT third"
  ]);
});

test("does not invent results when a provider has fewer matching videos", () => {
  const rows = [
    {source:"YouTube",title:"YT one"},
    {source:"YouTube",title:"YT two"},
    {source:"YouTube",title:"YT three"},
    {source:"PeerTube",title:"Peer one"}
  ];
  const result = diversifyVideoResults(rows, 10);
  assert.equal(result.length, 4);
  assert.deepEqual(result.map(row => row.title), ["YT one","Peer one","YT two","YT three"]);
});

test("preserves ranked order when only one video provider contributes", () => {
  const rows = [
    {source:"YouTube",title:"First"},
    {source:"YouTube",title:"Second"},
    {source:"YouTube",title:"Third"}
  ];
  assert.deepEqual(diversifyVideoResults(rows, 2).map(row => row.title), ["First","Second"]);
});

test("uses source hosts as a fallback when provider labels are missing", () => {
  const rows = [
    {page_url:"https://video-a.example/watch/1",title:"A one"},
    {page_url:"https://video-a.example/watch/2",title:"A two"},
    {page_url:"https://video-b.example/watch/1",title:"B one"}
  ];
  assert.deepEqual(diversifyVideoResults(rows, 3).map(row => row.title), ["A one","B one","A two"]);
});


test("builds a modest focused fallback query for sparse multiword searches", () => {
  assert.equal(
    buildVideoFallbackQuery("how to find free AI video generator online"),
    "ai generator"
  );
  assert.equal(
    buildVideoFallbackQuery("solar panels and battery storage"),
    "solar panels battery"
  );
  assert.equal(
    buildVideoFallbackQuery("quantum computing research methods"),
    "quantum computing research"
  );
});

test("does not broaden a one-word or generic-only video query", () => {
  assert.equal(buildVideoFallbackQuery("science"), "");
  assert.equal(buildVideoFallbackQuery("the video"), "");
  assert.equal(buildVideoFallbackQuery("best free videos"), "");
});

test("keeps the closest original-query matches ahead of broader fallback matches", () => {
  const rows = [
    {
      page_url: "https://videos.example/exact",
      title: "Solar panels battery storage guide"
    },
    {
      page_url: "https://videos.example/broader",
      title: "Solar panels battery guide"
    },
    {
      page_url: "https://videos.example/loose",
      title: "Solar panels explained"
    },
    {
      page_url: "https://videos.example/unrelated",
      title: "Cooking recipes"
    }
  ];
  const ranked = rankVideoResults(rows, "solar panels and battery storage", 10);
  assert.deepEqual(ranked.map(row => row.title), [
    "Solar panels battery storage guide",
    "Solar panels battery guide",
    "Solar panels explained"
  ]);
});
