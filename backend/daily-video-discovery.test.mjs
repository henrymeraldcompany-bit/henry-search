import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.js";
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
function db(){
  const rows=[],runs=[];
  return {rows,runs,prepare(sql){const s={values:[],bind(...v){this.values=v;return this;},async run(){if(sql.startsWith("INSERT INTO index_runs"))runs.push({note:this.values[3],stats:JSON.parse(this.values[4])});return{success:true};}};return s;},
    async batch(batch){for(const s of batch)rows.push(s.values);return batch.map(()=>({success:true}));}};
}
async function run(fetcher,env={}){const d=db(),old=globalThis.fetch;globalThis.fetch=fetcher;try{let task;worker.scheduled({}, {MEDIA_DB:d,...env},{waitUntil(p){task=p;}});assert.ok(task);await task;return d;}finally{globalThis.fetch=old;}}
function empty(url){
  if(url.hostname==="commons.wikimedia.org")return json({query:{pages:{}}});
  if(url.hostname==="api.openverse.org")return json({results:[]});
  if(url.hostname==="www.flickr.com")return json({items:[]});
  if(url.hostname==="api.duckduckgo.com")return json({});
  if(url.hostname==="en.wikipedia.org")return json({query:{search:[]}});
  if(url.hostname==="api.gdeltproject.org")return json({articles:[{title:"Daily news discovery fixture report",url:"https://news-fixture.example/daily-report",domain:"news-fixture.example",seendate:"20261102T080000Z"}]});
  if(["peertube.tv","peer.tube","spectra.video"].includes(url.hostname))return json({data:[]});
  throw Error("Unexpected endpoint "+url.href);
}
function peer(url){const q=(url.searchParams.get("search")||"daily").replace(/[^a-z0-9]+/gi,"-");return json({data:[
 {uuid:"safe-"+q,title:"Safe lesson "+q,description:"Educational video",url:"/videos/watch/safe-"+q,thumbnailPath:"/static/thumb-"+q+".jpg",embedPath:"/videos/embed/safe-"+q,duration:125,nsfw:false,publishedAt:"2026-11-01T07:00:00Z",channel:{displayName:"Test channel"}},
 {uuid:"flagged-"+q,url:"/videos/watch/flagged-"+q,nsfw:true},
 {uuid:"unknown-"+q,url:"/videos/watch/unknown-"+q},
 {uuid:"bad-"+q,url:"javascript:alert(1)",nsfw:false}
]});}
test("daily video discovery stores only explicitly safe videos from all PeerTube instances",async()=>{
 const hosts=[];const d=await run(async input=>{const u=new URL(input);hosts.push(u.hostname);return ["peertube.tv","peer.tube","spectra.video"].includes(u.hostname)?peer(u):empty(u);});
 const videos=d.rows.filter(r=>r[0]==="video");assert.equal(videos.length,18);
 for(const h of ["peertube.tv","peer.tube","spectra.video"])assert.equal(hosts.filter(x=>x===h).length,6);
 assert.ok(videos.every(r=>r[21]===0&&r[5].startsWith("https://")&&r[7].startsWith("https://")));
 assert.equal(d.runs[0].stats.seedsProcessed,6);assert.equal(d.runs[0].stats.providers.PeerTube.attempted,6);
 assert.equal(d.runs[0].stats.providers.PeerTube.rowsReceived,18);assert.equal(d.runs[0].stats.providers.PeerTube.rowsSaved,18);
});
test("one failed PeerTube instance does not discard healthy-instance results",async()=>{
 const d=await run(async input=>{const u=new URL(input);if(u.hostname==="peer.tube")return json({error:"unavailable"},503);return ["peertube.tv","spectra.video"].includes(u.hostname)?peer(u):empty(u);});
 assert.equal(d.rows.filter(r=>r[0]==="video").length,12);assert.equal(d.runs[0].stats.providers.PeerTube.failed,0);
 assert.equal(d.runs[0].stats.providers.PeerTube.rowsSaved,12);
});
test("repeated total PeerTube failures trip the provider circuit breaker",async()=>{
 const hosts=[];const d=await run(async input=>{const u=new URL(input);if(["peertube.tv","peer.tube","spectra.video"].includes(u.hostname)){hosts.push(u.hostname);return json({error:"unavailable"},503);}return empty(u);});
 assert.equal(d.rows.some(r=>r[0]==="video"),false);assert.equal(hosts.length,6);
 assert.equal(d.runs[0].stats.providers.PeerTube.attempted,2);assert.equal(d.runs[0].stats.providers.PeerTube.failed,2);
 assert.ok(d.runs[0].stats.disabledProviders.includes("PeerTube"));assert.match(d.runs[0].note,/All configured PeerTube instances failed/);
});
test("optional daily YouTube discovery uses strict safe search and enriches duration",async()=>{
 const req=[];const d=await run(async input=>{const u=new URL(input);req.push(u);
  if(u.hostname==="www.googleapis.com"&&u.pathname==="/youtube/v3/search"){assert.equal(u.searchParams.get("safeSearch"),"strict");return json({items:[{id:{videoId:"daily-video"},snippet:{title:"Daily lesson",description:"Educational",channelTitle:"Example",publishedAt:"2026-11-01T07:00:00Z",thumbnails:{high:{url:"https://i.ytimg.com/vi/daily-video/hqdefault.jpg"}}}}]});}
  if(u.hostname==="www.googleapis.com"&&u.pathname==="/youtube/v3/videos")return json({items:[{id:"daily-video",contentDetails:{duration:"PT2M5S"}}]});
  return empty(u);
 },{YOUTUBE_API_KEY:"test-server-secret"});
 const v=d.rows.filter(r=>r[0]==="video"&&r[1]==="youtube.com");assert.equal(v.length,1);assert.equal(v[0][19],125);assert.equal(v[0][21],0);
 assert.equal(req.filter(u=>u.hostname==="www.googleapis.com"&&u.pathname==="/youtube/v3/search").length,1);
 assert.equal(d.runs[0].stats.providers.YouTube.attempted,1);assert.equal(d.runs[0].stats.providers.YouTube.rowsSaved,1);
});
