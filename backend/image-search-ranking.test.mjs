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
