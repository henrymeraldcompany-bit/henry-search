import assert from "node:assert/strict";
import test from "node:test";
import { createYouTubeProvider } from "./youtube-search.js";

test("does not call API without a key or query", async () => {
  let calls=0;
  const requestJson=async()=>{calls++;return {};};
  assert.deepEqual(await createYouTubeProvider({apiKey:"",requestJson})("science"),[]);
  assert.deepEqual(await createYouTubeProvider({apiKey:"key",requestJson})(" "),[]);
  assert.equal(calls,0);
});

test("searches videos using strict SafeSearch and normalizes result metadata", async () => {
  const urls=[];
  const search=createYouTubeProvider({apiKey:"test",requestJson:async raw=>{
    const url=new URL(raw); urls.push(url);
    if(url.pathname.endsWith("/search")) return {items:[{id:{videoId:"AbCdEf_123"},snippet:{title:"Science lesson",description:"Details",channelTitle:"Channel",publishedAt:"2026-10-01T00:00:00Z",thumbnails:{high:{url:"https://img.youtube.com/thumb.jpg"}}}},{id:{videoId:"bad id"},snippet:{}}]};
    return {items:[{id:"AbCdEf_123",contentDetails:{duration:"PT1H2M3S"}}]};
  }});
  const rows=await search("science");
  assert.equal(rows.length,1);
  assert.equal(rows[0].duration_seconds,3723);
  assert.equal(rows[0].nsfw,0);
  assert.equal(rows[0].embed_url,"https://www.youtube-nocookie.com/embed/AbCdEf_123");
  assert.equal(urls[0].searchParams.get("safeSearch"),"strict");
  assert.equal(urls[0].searchParams.get("type"),"video");
  assert.equal(urls[1].searchParams.get("part"),"contentDetails");
});

test("retains search results if optional duration lookup fails", async()=>{
  let calls=0;
  const search=createYouTubeProvider({apiKey:"key",requestJson:async()=>{
    calls++; if(calls===1)return {items:[{id:{videoId:"12345678901"},snippet:{title:"Video"}}]};
    throw new Error("duration unavailable");
  }});
  const rows=await search("video");
  assert.equal(rows.length,1);
  assert.equal(rows[0].duration_seconds,null);
});

test("rejects unsafe thumbnails and limits result title length", async()=>{
  const search=createYouTubeProvider({apiKey:"key",requestJson:async()=>({items:[{id:{videoId:"123456"},snippet:{title:"x".repeat(400),thumbnails:{high:{url:"javascript:alert(1)"}}}}]})});
  const rows=await search("video");
  assert.equal(rows[0].thumbnail_url,"");
  assert.equal(rows[0].title.length,250);
});
