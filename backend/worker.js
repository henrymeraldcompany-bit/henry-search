/**
 * GOZIE SEARCH Media Worker
 * Indexes metadata and original URLs only; does not re-host media files.
 * Binding required: MEDIA_DB (Cloudflare D1). Optional secret: YOUTUBE_API_KEY.
 */
const SEEDS = ["science", "technology", "education", "nature", "history", "engineering", "Nigeria", "space"];
const PEERTUBE = "https://peertube.tv";

function reply(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "cache-control": "public, max-age=60"
  }});
}
function clean(value, max) {
  return String(value || "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ").trim().slice(0, max || 1000);
}
function safeUrl(value, base) {
  try {
    const u = base ? new URL(value, base) : new URL(value);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch (_) { return ""; }
}
function terms(q) { return String(q || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(function (x) { return x.length > 1; }).slice(0, 8); }
async function getJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "GOZIE-SEARCH/1.0 metadata-index" } });
  if (!r.ok) throw new Error("Provider HTTP " + r.status);
  return r.json();
}
function imageRow(p) {
  const i = p && p.imageinfo && p.imageinfo[0];
  if (!i) return null;
  const page = safeUrl(i.descriptionurl), media = safeUrl(i.url), thumb = safeUrl(i.thumburl || i.url);
  if (!page || !media || !thumb) return null;
  const m = i.extmetadata || {};
  return {
    kind: "image", source: "Wikimedia Commons", source_id: String(p.pageid || page),
    title: clean((m.ObjectName && m.ObjectName.value) || String(p.title || "").replace(/^File:/, ""), 250),
    description: clean((m.ImageDescription && m.ImageDescription.value) || "", 900),
    page_url: page, media_url: media, thumbnail_url: thumb, embed_url: "",
    author: clean((m.Artist && m.Artist.value) || "", 200),
    license: clean((m.LicenseShortName && m.LicenseShortName.value) || (m.UsageTerms && m.UsageTerms.value) || "", 100),
    published_at: "", duration_seconds: null, tags: ""
  };
}
async function commons(q, count) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  [["action","query"],["generator","search"],["gsrnamespace","6"],["gsrsearch",q],
   ["gsrlimit",String(count || 12)],["prop","imageinfo"],["iiprop","url|extmetadata"],
   ["iiurlwidth","640"],["format","json"]].forEach(function (p) { u.searchParams.set(p[0], p[1]); });
  const data = await getJson(u.href);
  return Object.values((data.query && data.query.pages) || {}).map(imageRow).filter(Boolean);
}
function videoRow(v) {
  const baseText = v && v.host ? (String(v.host).startsWith("http") ? v.host : "https://" + v.host) : PEERTUBE;
  const base = safeUrl(baseText, PEERTUBE) || PEERTUBE;
  const watch = v && (v.url || v.watchUrl || v.originalUrl ||
    (v.shortUUID ? "/w/" + v.shortUUID : v.uuid ? "/videos/watch/" + v.uuid : ""));
  const page = safeUrl(watch, base);
  if (!page) return null;
  const embed = safeUrl((v && (v.embedUrl || v.embedPath || (v.uuid ? "/videos/embed/" + v.uuid : ""))) || "", base);
  const thumb = safeUrl((v && (v.thumbnailUrl || v.thumbnailPath || v.previewPath || v.thumbnail || v.preview)) || "", base);
  const d = v && (v.publishedAt || v.published_at || v.createdAt || "");
  const published = d && Number.isFinite(Date.parse(d)) ? new Date(Date.parse(d)).toISOString() : "";
  let source = ""; try { source = new URL(page).hostname; } catch (_) {}
  return {
    kind: "video", source: source, source_id: String((v && (v.uuid || v.shortUUID)) || page),
    title: clean((v && (v.title || v.name)) || "Untitled video", 250),
    description: clean((v && v.description) || "", 1000),
    page_url: page, media_url: page, thumbnail_url: thumb, embed_url: embed,
    author: clean((v && v.channel && v.channel.displayName) || (v && v.account && (v.account.displayName || v.account.name)) || "", 200),
    license: "", published_at: published,
    duration_seconds: v && Number.isFinite(Number(v.duration)) && String(v.duration).trim() !== "" ? Number(v.duration) : null,
    tags: ""
  };
}
async function peertube(q, count) {
  const u = new URL("/api/v1/search/videos", PEERTUBE);
  u.searchParams.set("search", q); u.searchParams.set("count", String(count || 15)); u.searchParams.set("sort", "-match");
  const data = await getJson(u.href);
  return (Array.isArray(data.data) ? data.data : Array.isArray(data.results) ? data.results : []).map(videoRow).filter(Boolean);
}
function isoDurationSeconds(value) {
  const match = String(value || "").match(/^PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?$/);
  if (!match) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}
async function youtube(q, key, count) {
  if (!key) return [];
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  [["part","snippet"],["type","video"],["maxResults",String(count || 10)],["order","relevance"],["q",q],["key",key]]
    .forEach(function (p) { u.searchParams.set(p[0], p[1]); });
  const data = await getJson(u.href);
  const rows = (data.items || []).map(function (v) {
    const id = v && v.id && v.id.videoId; const s = (v && v.snippet) || {};
    if (!id) return null;
    const t = s.thumbnails || {};
    const url = "https://www.youtube.com/watch?v=" + encodeURIComponent(id);
    return { kind:"video", source:"youtube.com", source_id:id, title:clean(s.title,250),
      description:clean(s.description,1000), page_url:url, media_url:url,
      thumbnail_url:safeUrl((t.high && t.high.url) || (t.medium && t.medium.url) || (t.default && t.default.url) || ""),
      embed_url:"https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id),
      author:clean(s.channelTitle,200), license:"", published_at:s.publishedAt || "",
      duration_seconds:null, tags:"" };
  }).filter(Boolean);
  if (!rows.length) return rows;
  const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  detailsUrl.searchParams.set("part", "contentDetails");
  detailsUrl.searchParams.set("id", rows.map(function (row) { return row.source_id; }).join(","));
  detailsUrl.searchParams.set("key", key);
  try {
    const details = await getJson(detailsUrl.href);
    const durations = new Map((details.items || []).map(function (item) {
      return [item.id, isoDurationSeconds(item.contentDetails && item.contentDetails.duration)];
    }));
    rows.forEach(function (row) { row.duration_seconds = durations.get(row.source_id) ?? null; });
  } catch (error) {
    console.warn("Could not read YouTube duration metadata:", error && error.message || error);
  }
  return rows;
}
async function save(env, rows) {
  if (!rows.length) return 0;
  const stmts = rows.map(function (r) {
    return env.MEDIA_DB.prepare(
      "INSERT INTO media_items (kind,source,source_id,title,description,page_url,media_url,thumbnail_url,embed_url,author,license,published_at,duration_seconds,tags,indexed_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,source,page_url) DO UPDATE SET " +
      "source_id=excluded.source_id,title=excluded.title,description=excluded.description,media_url=excluded.media_url,thumbnail_url=excluded.thumbnail_url,embed_url=excluded.embed_url,author=excluded.author,license=excluded.license,published_at=excluded.published_at,duration_seconds=excluded.duration_seconds,tags=excluded.tags,indexed_at=excluded.indexed_at"
    ).bind(r.kind,r.source,r.source_id,r.title,r.description,r.page_url,r.media_url,r.thumbnail_url,r.embed_url,r.author,r.license,r.published_at,r.duration_seconds,JSON.stringify(r.tags || []),new Date().toISOString());
  });
  for (let i=0;i<stmts.length;i+=40) await env.MEDIA_DB.batch(stmts.slice(i,i+40));
  return rows.length;
}
async function indexed(env, kind, q, limit) {
  const w = terms(q); if (!w.length) return [];
  const conditions = w.map(function () { return "(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags) LIKE ?)"; }).join(" OR ");
  const args = [];
  w.forEach(function (x) { const p = "%" + x.replace(/[%_]/g,"") + "%"; args.push(p,p,p); });
  const phrase = "%" + q.toLowerCase().replace(/[%_]/g,"") + "%";
  const data = await env.MEDIA_DB.prepare(
    "SELECT * FROM media_items WHERE kind=? AND (" + conditions + ") ORDER BY CASE WHEN LOWER(title) LIKE ? THEN 0 ELSE 1 END,indexed_at DESC LIMIT ?"
  ).bind(kind,...args,phrase,limit || 30).all();
  return data.results || [];
}
function rank(rows,q,limit) {
  const ts=terms(q), seen=new Set(), result=[];
  for (const r of rows) {
    const url=safeUrl(r.page_url || r.url || r.page); if (!url || seen.has(url)) continue; seen.add(url);
    const title=String(r.title || "").toLowerCase(), desc=String(r.description || "").toLowerCase();
    let score=title.indexOf(q.toLowerCase())>=0?12:0;
    ts.forEach(function(t){score+=title.indexOf(t)>=0?5:desc.indexOf(t)>=0?1:0;});
    result.push({r:r,score:score});
  }
  result.sort(function(a,b){return b.score-a.score;});
  return result.slice(0,limit || 40).map(function(x){return x.r;});
}
function front(r) {
  if (r.kind==="image") return {title:r.title,description:r.description,page:r.page_url,image:r.media_url,thumbnail:r.thumbnail_url,license:r.license,source:r.source};
  let host="";try{host=new URL(r.page_url).hostname;}catch(_){}
  return {title:r.title,description:r.description,url:r.page_url,watchUrl:r.page_url,embedUrl:r.embed_url,thumbnailUrl:r.thumbnail_url,thumbnail:r.thumbnail_url,host:host,channel:r.author,duration:r.duration_seconds,publishedAt:r.published_at,source:r.source};
}
async function provider(fn) { try { return await fn(); } catch(e) { console.warn("Provider error",e && e.message || e); return []; } }
async function search(request,env,kind) {
  const q=(new URL(request.url).searchParams.get("q")||"").trim().slice(0,180);
  if(!q)return reply({error:"Please provide a search query.",results:[]},400);
  const saved=await indexed(env,kind,q,30);
  const live=kind==="image"
    ? await provider(function(){return commons(q,16);})
    : [].concat(await provider(function(){return peertube(q,15);}),await provider(function(){return youtube(q,env.YOUTUBE_API_KEY,10);}));
  const results=rank(live.concat(saved),q,40).map(front);
  const source=kind==="image"?"GOZIE metadata index + Wikimedia Commons":env.YOUTUBE_API_KEY?"GOZIE metadata index + PeerTube + YouTube":"GOZIE metadata index + PeerTube; YouTube requires an optional API key";
  return reply({query:q,results:results,count:results.length,source:source});
}
async function refresh(env) {
  let saved=0, failures=[];
  for(const q of SEEDS) {
    const calls=await Promise.allSettled([commons(q,12),peertube(q,12),youtube(q,env.YOUTUBE_API_KEY,8)]);
    for(const c of calls) {
      if(c.status==="rejected"){failures.push(clean(c.reason && c.reason.message || "provider failed",150));continue;}
      try{saved+=await save(env,c.value);}catch(e){failures.push(clean(e && e.message || "database failed",150));}
    }
  }
  await env.MEDIA_DB.prepare("DELETE FROM media_items WHERE indexed_at < ?").bind(new Date(Date.now()-180*86400000).toISOString()).run();
  await env.MEDIA_DB.prepare("INSERT INTO index_runs (finished_at,rows_processed,failure_count,note) VALUES (?,?,?,?)")
    .bind(new Date().toISOString(),saved,failures.length,failures.slice(0,10).join("; ").slice(0,1200)).run();
  console.log(JSON.stringify({event:"daily-index-refresh",saved:saved,failures:failures.length}));
}
export default {
  async fetch(request,env) {
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":"*","access-control-allow-methods":"GET, OPTIONS","access-control-allow-headers":"Content-Type"}});
    if(request.method!=="GET")return reply({error:"Only GET requests are supported."},405);
    const p=new URL(request.url).pathname.replace(/\/+$/,"")||"/";
    try {
      if(p==="/"||p==="/health")return reply({name:"GOZIE SEARCH Media API",status:"ok"});
      if(p==="/images")return await search(request,env,"image");
      if(p==="/videos")return await search(request,env,"video");
      if(p==="/index/status"){
        const counts=await env.MEDIA_DB.prepare("SELECT kind,COUNT(*) AS total FROM media_items GROUP BY kind").all();
        const latest=await env.MEDIA_DB.prepare("SELECT finished_at,rows_processed,failure_count,note FROM index_runs ORDER BY id DESC LIMIT 1").first();
        return reply({counts:counts.results||[],latestRun:latest||null});
      }
      return reply({error:"Not found",availableRoutes:["/health","/images?q=...","/videos?q=...","/index/status"]},404);
    }catch(e){console.error("Media API error",e&&e.message||e);return reply({error:"Media API is not ready. Verify the D1 binding and schema."},500);}
  },
  async scheduled(controller,env,ctx) {
    ctx.waitUntil(refresh(env).catch(function(e){console.error("Daily index refresh failed",e&&e.message||e);}));
  }
};