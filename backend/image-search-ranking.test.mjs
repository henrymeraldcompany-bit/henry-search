import assert from "node:assert/strict";
import test from "node:test";
import { rankImageResults } from "./image-search.js";

test("ranks exact image-title phrases above loose description matches", () => {
  const rows = [
    {title:"A beautiful planet photo",description:"Solar system illustration",page_url:"https://a.example/1"},
    {title:"Solar system illustration",description:"The planets",page_url:"https://b.example/2"},
    {title:"Solar system facts",description:"",page_url:"https://c.example/3"}
  ];
  const result = rankImageResults(rows,"solar system",10);
  assert.equal(result[0].title,"Solar system illustration");
  assert.equal(result[1].title,"Solar system facts");
  assert.equal(result[2].title,"A beautiful planet photo");
});

test("requires meaningful query matches and rejects unrelated images", () => {
  const result = rankImageResults([
    {title:"Football stadium",description:"Sports photograph",page_url:"https://a.example/1"},
    {title:"Solar system model",description:"Planets and the Sun",page_url:"https://b.example/2"}
  ],"how to find a solar system image",10);
  assert.deepEqual(result.map(row=>row.title),["Solar system model"]);
});

test("does not match short terms inside unrelated words", () => {
  const result = rankImageResults([
    {title:"Party decorations",page_url:"https://a.example/1"},
    {title:"Art history",page_url:"https://b.example/2"}
  ],"art",10);
  assert.deepEqual(result.map(row=>row.title),["Art history"]);
});

test("uses tags and descriptions as secondary relevance signals", () => {
  const result = rankImageResults([
    {title:"Untitled",description:"",tags:""},
    {title:"Untitled",description:"",tags:'["nebula","galaxy"]'}
  ],"nebula galaxy",10);
  assert.equal(result.length,1);
  assert.equal(result[0].tags,'["nebula","galaxy"]');
});

test("uses provider preference only after relevance and keeps host diversity", () => {
  const result = rankImageResults([
    {source:"Google Images",title:"Solar system unrelated",page_url:"https://google.example/1"},
    {source:"Openverse",title:"Solar system image",page_url:"https://openverse.example/1"},
    {source:"Google Images",title:"Solar system image",page_url:"https://google.example/2"}
  ],"solar system",10);
  assert.equal(result[0].source,"Google Images");
  assert.equal(result[0].title,"Solar system image");
  assert.equal(result.some(row=>row.title==="Solar system unrelated"),false);
});

test("returns no candidates for generic-only queries", () => {
  assert.deepEqual(rankImageResults([{title:"A nice image",page_url:"https://a.example/1"}],"images photos search",10),[]);
});

test("balances image providers while preserving relevance order within each provider", () => {
  const rows = [
    ...Array.from({length:12},(_,i)=>({source:"Wikimedia Commons",title:"Solar system image "+i,page_url:"https://commons.example/"+i})),
    ...Array.from({length:8},(_,i)=>({source:"Openverse",title:"Solar system image "+i,page_url:"https://openverse.example/"+i})),
    ...Array.from({length:8},(_,i)=>({source:"Flickr public feed",title:"Solar system image "+i,page_url:"https://flickr.example/"+i}))
  ];
  const result = rankImageResults(rows,"solar system",12);
  const counts = result.reduce((map,row)=>map.set(row.source,(map.get(row.source)||0)+1),new Map());
  assert.equal(result.length,12);
  assert.ok(counts.get("Wikimedia Commons") <= 4);
  assert.ok(counts.get("Openverse") >= 3);
  assert.ok(counts.get("Flickr public feed") >= 3);
  assert.deepEqual(result.filter(row=>row.source==="Wikimedia Commons").map(row=>row.title),
    ["Solar system image 0","Solar system image 1","Solar system image 2","Solar system image 3"]);
});

test("relaxes provider diversity when only one provider returns relevant images", () => {
  const rows = Array.from({length:7},(_,i)=>({
    source:"Openverse",title:"Nebula image "+i,page_url:"https://openverse.example/"+i
  }));
  const result = rankImageResults(rows,"nebula",7);
  assert.equal(result.length,7);
  assert.ok(result.every(row=>row.source==="Openverse"));
});

test("counts merged multi-provider images as representation from their contributing sources", () => {
  const result = rankImageResults([
    {source:"Wikimedia Commons",sources:["Wikimedia Commons","Openverse"],title:"Galaxy image",page_url:"https://a.example/1"},
    {source:"Wikimedia Commons",title:"Galaxy image",page_url:"https://b.example/2"},
    {source:"Flickr public feed",title:"Galaxy image",page_url:"https://c.example/3"}
  ],"galaxy",3);
  assert.equal(result.length,3);
  assert.ok(result.some(row=>row.source==="Flickr public feed"));
});


test("tokenizes accented and non-Latin image query words", () => {
  const accented = rankImageResults([
    { title: "Café technology", page_url: "https://accent.example/1" }
  ], "café technology", 10);
  assert.equal(accented.length, 1);
  assert.equal(accented[0].title, "Café technology");

  const mixedScript = rankImageResults([
    { title: "東京 system", page_url: "https://unicode.example/1" }
  ], "東京 system", 10);
  assert.equal(mixedScript.length, 1);
  assert.equal(mixedScript[0].title, "東京 system");
});

test("normalizes www host aliases before applying source-host diversity", () => {
  const rows = [
    { source: "Wikimedia Commons", title: "Solar system image 1", page_url: "https://www.alpha.example/1" },
    { source: "Wikimedia Commons", title: "Solar system image 2", page_url: "https://alpha.example/2" },
    { source: "Wikimedia Commons", title: "Solar system image 3", page_url: "https://www.alpha.example/3" },
    { source: "Wikimedia Commons", title: "Solar system image 4", page_url: "https://beta.example/4" },
    { source: "Wikimedia Commons", title: "Solar system image 5", page_url: "https://charlie.example/5" }
  ];
  const result = rankImageResults(rows, "solar system", 4);
  const hosts = result.map(row => new URL(row.page_url).hostname.replace(/^www\./, ""));
  assert.equal(result.length, 4);
  assert.equal(hosts.filter(host => host === "alpha.example").length, 2);
  assert.ok(hosts.includes("beta.example"));
  assert.ok(hosts.includes("charlie.example"));
});
