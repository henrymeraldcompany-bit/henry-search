/**
 * GOZIE SEARCH Media Worker
 * Indexes metadata and original URLs only; does not re-host media files.
 * Binding required: MEDIA_DB (Cloudflare D1). Optional secret: YOUTUBE_API_KEY.
 */
const SEEDS = ["science", "technology", "education", "nature", "history", "engineering", "Nigeria", "space"];
const PEERTUBE = "https://peertube.tv";
// Use several public PeerTube instances so search is not tied to one instance's
// federation/search-index settings. Failed instances are isolated per request.
const PEERTUBE_INSTANCES = [
  PEERTUBE,
  "https://peer.tube",
  "https://spectra.video"
];

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
  // An empty optional URL must stay empty; new URL("", base) resolves to the
  // base homepage, which can otherwise masquerade as a video or embed URL.
  const raw = value == null ? "" : String(value).trim();
  if (!raw) return "";
  try {
    const u = base ? new URL(raw, base) : new URL(raw);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch (_) { return ""; }
}
function terms(q) { return String(q || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(function (x) { return x.length > 1; }).slice(0, 8); }
function fallbackQuery(q) {
  const stop = new Set(["a","an","and","are","as","at","be","by","for","from","how","in","is","it","of","on","or","the","to","was","what","when","where","which","who","why","with"]);
  const original = String(q || "").trim();
  const focused = terms(original).filter(function (word) { return !stop.has(word); }).slice(0, 4).join(" ");
  return focused && focused.toLowerCase() !== original.toLowerCase() ? focused : "";
}
async function getJson(url) {
  // Bound provider latency so one slow external service cannot stall search or the daily index.
  const r = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "GOZIE-SEARCH/1.0 metadata-index" },
    signal: AbortSignal.timeout(8000)
  });
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

function flickrRow(item) {
  if (!item || !item.media || typeof item.media.m !== "string") return null;
  const page = safeUrl(item.link);
  const media = safeUrl(item.media.m);
  if (!page || !media) return null;
  const publishedMs = item.published ? Date.parse(item.published) : NaN;
  return {
    kind: "image", source: "Flickr public feed", source_id: page,
    title: clean(item.title || "Untitled image", 250),
    description: clean(item.description || "", 900),
    page_url: page, media_url: media, thumbnail_url: media, embed_url: "",
    author: clean(item.author || item.author_id || "", 200),
    license: "License information unavailable",
    published_at: Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : "",
    duration_seconds: null, tags: clean(item.tags || "", 400)
  };
}
async function flickr(q, count) {
  const tags = (fallbackQuery(q) || String(q || "").trim()).split(/\s+/).filter(Boolean).slice(0, 5).join(",");
  if (!tags) return [];
  const u = new URL("https://www.flickr.com/services/feeds/photos_public.gne");
  [["format","json"],["nojsoncallback","1"],["tags",tags],["tagmode","any"],["lang","en-us"]]
    .forEach(function (p) { u.searchParams.set(p[0], p[1]); });
  const data = await getJson(u.href);
  const limit = Math.min(12, Math.max(1, Number(count) || 12));
  return (Array.isArray(data.items) ? data.items : []).slice(0, limit).map(flickrRow).filter(Boolean);
}
function normalizeNumericDuration(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const seconds = Number(normalized);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
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
    duration_seconds: normalizeNumericDuration(v && v.duration),
    tags: ""
  };
}
function peertubeSearchTargets(q, count) {
  const search = String(q || "").trim();
  if (!search) return [];
  const requested = Number(count);
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(20, Math.floor(requested))
    : 15;
  return PEERTUBE_INSTANCES.map(function (base) {
    const url = new URL("/api/v1/search/videos", base);
    url.searchParams.set("search", search);
    url.searchParams.set("count", String(limit));
    url.searchParams.set("sort", "-match");
    return { base: base, url: url.href };
  });
}
async function peertube(q, count) {
  const targets = peertubeSearchTargets(q, count);
  const responses = await Promise.allSettled(targets.map(async function (target) {
    const data = await getJson(target.url);
    const items = Array.isArray(data.data) ? data.data
      : Array.isArray(data.results) ? data.results : [];
    return items.map(function (video) {
      // Relative URLs from a queried instance must resolve against that instance.
      const row = video && typeof video === "object"
        ? Object.assign({}, video, { host: video.host || target.base })
        : video;
      return videoRow(row);
    }).filter(Boolean);
  }));
  const rows = [];
  responses.forEach(function (response, index) {
    if (response.status === "fulfilled") {
      rows.push.apply(rows, response.value);
    } else {
      console.warn("PeerTube instance search failed", targets[index].base,
        response.reason && response.reason.message || response.reason);
    }
  });
  return rows;
}
function isoDurationSeconds(value) {
  const match = String(value || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match || !match.slice(1).some(function (part) { return part !== undefined; })) return null;
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
function sqlWordText(column) {
  // Restrict the column name to a small internal allowlist before embedding it in SQL.
  if (!["title", "description", "tags"].includes(column)) {
    throw new Error("Unsupported indexed text column");
  }
  // Convert common punctuation and whitespace to spaces so "art" is a whole word
  // in "art/painting" but not inside "party", "cartoon", or "heart".
  const separators = [".", ",", ":", ";", "!", "?", "/", "\\", "-", "_", "(", ")", "[", "]", "{", "}", '"', "'", "<", ">", "|", "+", "=", "%", "&", "#", "@", "~", "*", "\n", "\r", "\t"];
  let expression = "LOWER(COALESCE(" + column + ", ''))";
  separators.forEach(function (separator) {
    let sqlSeparator;
    if (separator === "\n") sqlSeparator = "char(10)";
    else if (separator === "\r") sqlSeparator = "char(13)";
    else if (separator === "\t") sqlSeparator = "char(9)";
    else if (separator === "?") sqlSeparator = "char(63)";
    else sqlSeparator = "'" + separator.replace(/'/g, "''") + "'";
    expression = "REPLACE(" + expression + ", " + sqlSeparator + ", ' ')";
  });
  return "(' ' || " + expression + " || ' ')";
}

function indexedQuery(kind, q, limit) {
  const w = terms(q);
  if (!w.length) return null;

  // Keep the broad substring prefilter so punctuation and provider metadata do
  // not create false negatives, but rank its capped candidate list by whole-word
  // matches. This stops a short query like "art" being crowded out by "party".
  const conditions = w.map(function () {
    return "(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags) LIKE ?)";
  }).join(" OR ");
  const conditionArgs = [];
  const scoreArgs = [];
  w.forEach(function (word) {
    const cleanWord = word.replace(/[%_]/g, "");
    const broadPattern = "%" + cleanWord + "%";
    conditionArgs.push(broadPattern, broadPattern, broadPattern);
    const wholeWordPattern = "% " + cleanWord + " %";
    scoreArgs.push(wholeWordPattern, wholeWordPattern, wholeWordPattern);
  });

  const titleWords = sqlWordText("title");
  const descriptionWords = sqlWordText("description");
  const tagsWords = sqlWordText("tags");
  const score = w.map(function () {
    return "(CASE WHEN title_words LIKE ? THEN 6 WHEN description_words LIKE ? THEN 2 WHEN tags_words LIKE ? THEN 1 ELSE 0 END)";
  }).join(" + ");
  const phraseText = String(q || "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  const phrase = phraseText ? "% " + phraseText + " %" : "%";
  const requestedLimit = Number(limit);
  const rowLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(120, Math.floor(requestedLimit))
    : 100;

  return {
    sql: "WITH normalized AS (SELECT *, " + titleWords + " AS title_words, " +
      descriptionWords + " AS description_words, " + tagsWords +
      " AS tags_words FROM media_items WHERE kind=?) " +
      "SELECT *, (" + score + ") AS relevance_score, " +
      "CASE WHEN title_words LIKE ? THEN 0 ELSE 1 END AS phrase_rank " +
      "FROM normalized WHERE (" + conditions + ") " +
      "ORDER BY phrase_rank ASC, relevance_score DESC, indexed_at DESC LIMIT ?",
    params: [kind].concat(scoreArgs, [phrase], conditionArgs, [rowLimit])
  };
}
async function indexed(env, kind, q, limit) {
  const query = indexedQuery(kind, q, limit);
  if (!query) return [];
  const data = await env.MEDIA_DB.prepare(query.sql).bind(...query.params).all();
  return data.results || [];
}
function canonicalMediaKey(value) {
  const href = safeUrl(value);
  if (!href) return "";
  try {
    const u = new URL(href);
    let host = u.hostname.toLowerCase().replace(/^www\./, "");
    let videoId = "";
    if (host === "youtu.be") videoId = u.pathname.split("/").filter(Boolean)[0] || "";
    if ((host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") &&
        (u.pathname === "/watch" || u.pathname.startsWith("/embed/") || u.pathname.startsWith("/shorts/"))) {
      videoId = u.searchParams.get("v") || u.pathname.split("/").filter(Boolean).pop() || "";
    }
    if (videoId) {
      const canonical = new URL("https://youtube.com/watch");
      canonical.searchParams.set("v", videoId);
      return canonical.href;
    }
    u.hostname = host;
    u.hash = "";
    for (const key of Array.from(u.searchParams.keys())) {
      if (/^utm_/i.test(key) || ["fbclid", "gclid", "dclid", "si", "feature"].includes(key.toLowerCase())) {
        u.searchParams.delete(key);
      }
    }
    u.searchParams.sort();
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.href;
  } catch (_) {
    return href;
  }
}
function rank(rows,q,limit) {
  const query=String(q || "").trim().toLowerCase();
  const ts=terms(query);
  // Ignore generic media/search words so they cannot make an unrelated item look relevant.
  const stop=new Set(["a","an","and","are","as","at","be","by","for","from","how","in","is","it","of","on","or","the","to","was","what","when","where","which","who","why","with","about","this","that","video","videos","image","images","photo","photos","picture","pictures","clip","clips","search","find"]);
  const queryTerms=ts.filter(function(t){return !stop.has(t);});
  if(!queryTerms.length)return [];
  const candidates=[];
  for (const r of rows) {
    const url=safeUrl(r.page_url || r.url || r.page);
    const key=canonicalMediaKey(url);
    if (!url || !key) continue;
    const title=String(r.title || "").toLowerCase();
    const details=[r.description,r.tags,r.author].map(function(v){return String(v || "").toLowerCase();}).join(" ");
    // Compare whole tokens, not substrings: "art" must not match "party".
    const titleTokens=title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const titleWords=new Set(titleTokens);
    const detailWords=new Set(details.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
    const normalizedTitle=titleTokens.join(" ");
    const normalizedQuery=query.split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ");
    const exact=!!(normalizedQuery && (" "+normalizedTitle+" ").indexOf(" "+normalizedQuery+" ")>=0);
    let score=exact?12:0, matched=0, titleMatches=0;
    queryTerms.forEach(function(t){
      if(titleWords.has(t)){score+=6;matched++;titleMatches++;}
      else if(detailWords.has(t)){score+=2;matched++;}
    });
    if(titleMatches===queryTerms.length && queryTerms.length>1)score+=4;
    // Long queries need at least two meaningful terms to match. This prevents a
    // generic word in a title from filling the gallery with unrelated media.
    const minimumMatches=queryTerms.length>=3?2:1;
    if(!exact && matched<minimumMatches)continue;
    let host="";
    try { host=new URL(url).hostname.toLowerCase().replace(/^www\./,""); } catch (_) {}
    candidates.push({r:r,score:score,host:host,matched:matched,titleMatches:titleMatches,key:key});
  }
  // Rank before deduplication: a weak duplicate from one provider must not hide
  // a better-titled version of the same media returned by another provider.
  candidates.sort(function(a,b){return b.score-a.score || b.matched-a.matched || b.titleMatches-a.titleMatches;});
  const uniqueCandidates=[], seenKeys=new Set();
  for (const item of candidates) {
    if (seenKeys.has(item.key)) continue;
    seenKeys.add(item.key);
    uniqueCandidates.push(item);
  }
  const target=Math.max(1,limit || 40);
  // Give different source hosts a fair first pass, then fill remaining places
  // with the closest matches if the query has only a few available sources.
  const sourceCap=Math.max(3,Math.ceil(target/5));
  const picked=[], counts=new Map(), selected=new Set();
  for (const item of uniqueCandidates) {
    if (picked.length>=target) break;
    const host=item.host || "unknown";
    if ((counts.get(host)||0)>=sourceCap) continue;
    picked.push(item); selected.add(item); counts.set(host,(counts.get(host)||0)+1);
  }
  if (picked.length<target) {
    for (const item of uniqueCandidates) {
      if (picked.length>=target) break;
      if (selected.has(item)) continue;
      picked.push(item);
    }
  }
  return picked.map(function(x){return x.r;});
}
function front(r) {
  if (r.kind==="image") return {title:r.title,description:r.description,page:r.page_url,image:r.media_url,thumbnail:r.thumbnail_url,license:r.license,source:r.source};
  let host="";try{host=new URL(r.page_url).hostname;}catch(_){}
  return {title:r.title,description:r.description,url:r.page_url,watchUrl:r.page_url,embedUrl:r.embed_url,thumbnailUrl:r.thumbnail_url,thumbnail:r.thumbnail_url,host:host,channel:r.author,duration:r.duration_seconds,publishedAt:r.published_at,source:r.source};
}
function capFlickrResults(rows, limit) {
  const maximum = Math.max(0, Number.isFinite(Number(limit)) ? Number(limit) : 20);
  let flickrCount = 0;
  return rows.filter(function (row) {
    if (row && row.source === "Flickr public feed") {
      flickrCount++;
      return flickrCount <= maximum;
    }
    return true;
  });
}
async function provider(fn) { try { return await fn(); } catch(e) { console.warn("Provider error",e && e.message || e); return []; } }
async function search(request,env,kind) {
  const q=(new URL(request.url).searchParams.get("q")||"").trim().slice(0,180);
  if(!q)return reply({error:"Please provide a search query.",results:[]},400);
  const saved=await indexed(env,kind,q,100);
  const fetchLive=async function(query) {
    if(kind==="image") {
      const providers=await Promise.all([
        provider(function(){return commons(query,16);}),
        provider(function(){return flickr(query,12);})
      ]);
      return providers.flat();
    }
    const providers=await Promise.all([
      provider(function(){return peertube(query,15);}),
      provider(function(){return youtube(query,env.YOUTUBE_API_KEY,10);})
    ]);
    return providers.flat();
  };
  let live=await fetchLive(q);
  let ranked=rank(live.concat(saved),q,40);
  let results=capFlickrResults(ranked,20);
  let expandedQuery="";
  // Only spend extra provider requests when the exact search is sparse.
  // Keep the focused query short and merge through the same deduper/ranker.
  if(ranked.length<8) {
    expandedQuery=fallbackQuery(q);
    if(expandedQuery) {
      const expandedLive=await fetchLive(expandedQuery);
      if(expandedLive.length) {
        live=live.concat(expandedLive);
        ranked=rank(live.concat(saved),q,40);
        results=capFlickrResults(ranked,20);
      }
    }
  }
  const sourceNames=Array.from(new Set(results.map(function(r){return r.source;}).filter(Boolean))).slice(0,8);
  const source=sourceNames.length ? sourceNames.join(" + ")
    : kind==="image" ? "Wikimedia Commons + Flickr public feed"
    : env.YOUTUBE_API_KEY ? "PeerTube + YouTube" : "PeerTube; YouTube requires an optional API key";
  return reply({query:q,results:results.map(front),count:results.length,source:source,expanded:!!expandedQuery,expandedQuery:expandedQuery||null});
}
function shouldIndexYouTubeSeed(seedIndex, daySlot, hasKey) {
  if (!hasKey || !Number.isInteger(seedIndex) || !Number.isInteger(daySlot) || !SEEDS.length) return false;
  const slot = ((daySlot % SEEDS.length) + SEEDS.length) % SEEDS.length;
  return seedIndex === slot;
}
async function refresh(env) {
  let saved=0, failures=[];
  const daySlot=Math.floor(Date.now()/86400000)%SEEDS.length;
  for(let index=0;index<SEEDS.length;index++) {
    const q=SEEDS[index];
    const calls=[commons(q,12),flickr(q,12),peertube(q,12)];
    // Keep daily external provider requests under the free-plan subrequest cap.
    // One YouTube seed rotates per day; live searches can still query YouTube immediately.
    if(shouldIndexYouTubeSeed(index,daySlot,Boolean(env.YOUTUBE_API_KEY))) {
      calls.push(youtube(q,env.YOUTUBE_API_KEY,8));
    }
    const settled=await Promise.allSettled(calls);
    for(const c of settled) {
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
