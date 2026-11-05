import { runVideoProviders, rankVideoResults, diversifyVideoResults, buildVideoFallbackQuery } from "./video-search.js";
import { createYouTubeProvider } from "./youtube-search.js";
import { createWikimediaVideoProvider } from "./wikimedia-video-search.js";
import { runImageProviders, rankImageResults } from "./image-search.js";
import { filterImageResults } from "./image-filters.js";
import { createDailyRequestBudget, discoverDailyNews, discoverDailyWeb } from "./daily-search-discovery.js";
import { createRequestDiagnostic, recordRequestDiagnostic } from "./diagnostics.js";

/**
 * GOZIE SEARCH Media Worker
 * Indexes metadata and original URLs only; does not re-host media files.
 * Binding required: MEDIA_DB (Cloudflare D1). Optional secret: YOUTUBE_API_KEY.
 */
const SEEDS = [
  "science", "technology", "education", "nature",
  "history", "engineering", "Nigeria", "space",
  "mathematics", "biology", "computer science", "programming",
  "geography", "African history", "Nigerian culture", "climate science",
  "renewable energy", "language learning", "architecture", "art education",
  "music performance", "literature", "astronomy", "wildlife"
];
const DAILY_SEED_BATCH_SIZE = 6;
// Freshness is measured from the last successful metadata refresh, not publication date.
const INDEX_FRESH_DAYS = 30;
const INDEX_RETENTION_DAYS = 180;
const PEERTUBE = "https://peertube.tv";
// Use several public PeerTube instances so search is not tied to one instance's
// federation/search-index settings. Failed instances are isolated per request.
const PEERTUBE_INSTANCES = [
  PEERTUBE,
  "https://peer.tube",
  "https://spectra.video"
];

// Explicit Workers Free / D1 resource envelope for one scheduled refresh.
const INDEX_EXTERNAL_SUBREQUEST_LIMIT = 50;
const INDEX_EXTERNAL_SUBREQUEST_RESERVE = 3;
const INDEX_D1_BATCH_REQUEST_LIMIT = 50;
const INDEX_D1_BATCH_REQUEST_RESERVE = 5;
const INDEX_D1_BATCH_SIZE = 40;
const INDEX_RETENTION_PRUNE_BATCH_SIZE = 500;
const MAX_DAILY_WEB_NEWS_REQUESTS = 5;
const INDEX_MAX_SEARCH_ROWS_PER_RUN = 40;
const INDEX_MAX_ROWS_PER_RUN = DAILY_SEED_BATCH_SIZE *
  (12 + 12 + 12 + PEERTUBE_INSTANCES.length * 12) + 8;
function calculateIndexRetryBudget(limit, reserve, seedCount, peerTubeInstances, youtubeRequests, additionalRequests) {
  const extra = Math.max(0, Math.floor(Number(additionalRequests) || 0));
  const baseline = seedCount * (3 + peerTubeInstances) + youtubeRequests + extra;
  const retryFanout = Math.max(1, peerTubeInstances);
  return Math.max(0, Math.floor((limit - reserve - baseline) / retryFanout));
}
const MAX_INDEX_RETRIES_PER_RUN = calculateIndexRetryBudget(
  INDEX_EXTERNAL_SUBREQUEST_LIMIT, INDEX_EXTERNAL_SUBREQUEST_RESERVE,
  DAILY_SEED_BATCH_SIZE, PEERTUBE_INSTANCES.length, 2, MAX_DAILY_WEB_NEWS_REQUESTS
);
function createIndexD1BatchRequestBudget(limit, reserve) {
  const total = Math.max(0, Math.floor(Number(limit) || 0));
  const held = Math.max(0, Math.min(total, Math.floor(Number(reserve) || 0)));
  return { remaining: total - held, used: 0, reserved: held };
}
function reserveIndexD1BatchRequestBudget(budget, count) {
  const requested = Math.max(0, Math.floor(Number(count) || 0));
  if (!budget || requested > budget.remaining) return false;
  budget.remaining -= requested;
  budget.used += requested;
  return true;
}

function reply(data, status) {
  const code = Number(status) || 200;
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "cache-control": code >= 400 ? "no-store" : "public, max-age=60"
  };
  if (code === 503) headers["retry-after"] = "5";
  return new Response(JSON.stringify(data), { status: code, headers: headers });
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
  if (!r.ok) {
    const error = new Error("Provider HTTP " + r.status);
    error.status = r.status;
    throw error;
  }
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
    published_at: clean((m.DateTimeOriginal && m.DateTimeOriginal.value) || (m.DateTime && m.DateTime.value) || "", 80), width: Number(m.ImageWidth && m.ImageWidth.value) || null, height: Number(m.ImageHeight && m.ImageHeight.value) || null, format: clean((m.MimeType && m.MimeType.value) || "", 40), duration_seconds: null, tags: ""
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
    published_at: Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : "", width: Number(item.width) || null, height: Number(item.height) || null, format: clean(item.media.m.split("?")[0].split(".").pop() || "", 12).toLowerCase(),
    duration_seconds: null, tags: clean(item.tags || "", 400)
  };
}
function openverseRow(item) {
  if (!item || typeof item !== "object") return null;
  const page = safeUrl(item.foreign_landing_url);
  const media = safeUrl(item.url);
  const thumb = safeUrl(item.thumbnail);
  if (!page || !media || !thumb) return null;
  const license = clean(item.license || "", 80);
  const licenseVersion = clean(item.license_version || "", 30);
  return {
    kind: "image", source: "Openverse", provider: clean(item.provider || item.source || "Openverse", 100),
    source_id: String(item.id || page), title: clean(item.title || "Untitled image", 250),
    description: clean((Array.isArray(item.tags) ? item.tags.map(function(tag){return tag && tag.name || "";}).filter(Boolean).join(", ") : ""), 900),
    page_url: page, media_url: media, thumbnail_url: thumb, embed_url: "",
    author: clean(item.creator || "", 200), creator_url: safeUrl(item.creator_url),
    license: license ? license.toUpperCase() + (licenseVersion ? " " + licenseVersion : "") : "License details unavailable",
    license_url: safeUrl(item.license_url), attribution: clean(item.attribution || "", 500),
    published_at: clean(item.created_on || item.created || "", 80), width: Number(item.width) || null, height: Number(item.height) || null, format: clean(item.mime_type || "", 40), duration_seconds: null, tags: ""
  };
}
function googleImageRow(item) {
  if (!item || typeof item !== "object") return null;
  const page = safeUrl(item.image && item.image.contextLink);
  const media = safeUrl(item.link);
  const thumb = safeUrl(item.image && item.image.thumbnailLink);
  if (!page || !media || !thumb) return null;
  return { kind:"image", source:"Google Images", provider:"Google Programmable Search",
    source_id:media, title:clean(item.title || "Untitled image",250), description:clean(item.snippet || "",900),
    page_url:page, media_url:media, thumbnail_url:thumb, embed_url:"", author:"",
    license:"License details not supplied by Google", license_url:"", attribution:"",
    published_at:"", width:Number(item.image.width)||null, height:Number(item.image.height)||null, format:clean(item.mime||"",40), duration_seconds:null, tags:"" };
}
async function googleImages(q, env, count) {
  const key=String(env && env.GOOGLE_CSE_API_KEY || "").trim();
  const cx=String(env && env.GOOGLE_CSE_ID || "").trim();
  if(!key || !cx) return [];
  const query=String(q || "").trim().slice(0,180);
  if(!query) return [];
  const u=new URL("https://www.googleapis.com/customsearch/v1");
  [["key",key],["cx",cx],["q",query],["searchType","image"],["safe","active"],
   ["num",String(Math.min(10,Math.max(1,Number(count)||10)))],
   ["rights","cc_publicdomain,cc_attribute,cc_sharealike"]].forEach(function(p){u.searchParams.set(p[0],p[1]);});
  const data=await getJson(u.href);
  return (Array.isArray(data.items)?data.items:[]).map(googleImageRow).filter(Boolean);
}
async function openverse(q, count) {
  const query = String(q || "").trim().slice(0, 180);
  if (!query) return [];
  const u = new URL("https://api.openverse.org/v1/images/");
  [["q", query], ["page_size", String(Math.min(20, Math.max(1, Number(count) || 12)))],
   ["license_type", "commercial,modification"], ["mature", "false"], ["filter_dead", "true"]]
    .forEach(function (p) { u.searchParams.set(p[0], p[1]); });
  const data = await getJson(u.href);
  return (Array.isArray(data.results) ? data.results : []).map(openverseRow).filter(Boolean);
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
function canonicalIndexUrl(value, kind) {
  const href = safeUrl(value);
  if (!href) return "";
  if (kind === "video") return canonicalMediaKey({ page_url: href });
  try {
    const url = new URL(href);
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_.+|fbclid|gclid|dclid|ref|ref_src|source)$/i.test(key)) url.searchParams.delete(key);
    }
    if ((url.protocol === "https:" && url.port === "443") ||
        (url.protocol === "http:" && url.port === "80")) url.port = "";
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch (_) { return ""; }
}
function indexDedupKeys(row) {
  const kind = row && row.kind;
  if (kind === "video") return {
    canonical_page_url: canonicalIndexUrl(row.page_url || row.media_url, "video"),
    canonical_media_url: ""
  };
  if (kind === "image") return {
    canonical_page_url: "",
    canonical_media_url: canonicalIndexUrl(row.media_url, "image")
  };
  return { canonical_page_url: "", canonical_media_url: "" };
}

function videoRow(v) {
  // Require an explicit safe classification from PeerTube; unknown or flagged
  // items are not returned or indexed.
  if (!v || v.nsfw !== false) return null;
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
  const channel = (v && v.channel) || (v && v.account) || {};
  const rawTags = Array.isArray(v && v.tags) ? v.tags
    : Array.isArray(v && v.hashtags) ? v.hashtags : [];
  const tags = rawTags.map(function (tag) {
    return clean(typeof tag === "string" ? tag : tag && (tag.name || tag.label) || "", 80);
  }).filter(Boolean).slice(0, 30);
  let source = ""; try { source = new URL(page).hostname; } catch (_) {}
  return {
    kind: "video", source: source, source_id: String((v && (v.uuid || v.shortUUID)) || page),
    provider: "PeerTube",
    title: clean((v && (v.title || v.name)) || "Untitled video", 250),
    description: clean((v && v.description) || "", 1000),
    page_url: page, media_url: page, thumbnail_url: thumb, embed_url: embed,
    author: clean(channel.displayName || channel.name || "", 200),
    creator_url: safeUrl(channel.url || channel.account && channel.account.url || "", base),
    license: typeof (v && v.licence) === "string" ? clean(v.licence, 100) : "",
    published_at: published,
    duration_seconds: normalizeNumericDuration(v && v.duration),
    nsfw: 0,
    tags: tags
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
    url.searchParams.set("nsfw", "false");
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
  const successfulResponses = responses.filter(function (response) {
    return response.status === "fulfilled";
  }).length;
  if (targets.length && successfulResponses === 0) {
    throw new Error("All configured PeerTube instances failed");
  }
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
  [["part","snippet"],["type","video"],["maxResults",String(count || 10)],["order","relevance"],["safeSearch","strict"],["q",q],["key",key]]
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
      author:clean(s.channelTitle,200), creator_url:s.channelId
        ? "https://www.youtube.com/channel/" + encodeURIComponent(s.channelId) : "",
      provider:"YouTube", license:"", published_at:s.publishedAt || "",
      duration_seconds:null, nsfw:0, tags:[] };
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
async function saveSearchIndexRows(env, rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const indexedAt = new Date().toISOString();
  const statements = rows.map(function (row) {
    return env.MEDIA_DB.prepare(
      "INSERT INTO search_index_items (kind,canonical_url,title,url,domain,snippet,source,provider,sources_json,providers_json,published_at,indexed_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(kind,canonical_url) DO UPDATE SET " +
      "title=CASE WHEN excluded.title<>'' THEN excluded.title ELSE search_index_items.title END," +
      "url=CASE WHEN excluded.url<>'' THEN excluded.url ELSE search_index_items.url END," +
      "domain=CASE WHEN excluded.domain<>'' THEN excluded.domain ELSE search_index_items.domain END," +
      "snippet=CASE WHEN length(excluded.snippet)>length(search_index_items.snippet) THEN excluded.snippet ELSE search_index_items.snippet END," +
      "source=CASE WHEN excluded.source<>'' THEN excluded.source ELSE search_index_items.source END," +
      "provider=CASE WHEN excluded.provider<>'' THEN excluded.provider ELSE search_index_items.provider END," +
      "sources_json=CASE WHEN excluded.sources_json<>'[]' THEN excluded.sources_json ELSE search_index_items.sources_json END," +
      "providers_json=CASE WHEN excluded.providers_json<>'[]' THEN excluded.providers_json ELSE search_index_items.providers_json END," +
      "published_at=COALESCE(NULLIF(excluded.published_at,''),search_index_items.published_at)," +
      "indexed_at=excluded.indexed_at"
    ).bind(
      row.kind,row.canonical_url,row.title,row.url,row.domain,row.snippet,row.source,
      row.provider,row.sources_json,row.providers_json,row.published_at,indexedAt
    );
  });
  for (let index = 0; index < statements.length; index += INDEX_D1_BATCH_SIZE) {
    await env.MEDIA_DB.batch(statements.slice(index,index + INDEX_D1_BATCH_SIZE));
  }
  return rows.length;
}
function normalizeSearchIndexRow(kind, item) {
  if (!item || typeof item !== "object") return null;
  const url = safeUrl(item.url || item.originalUrl);
  const canonical = canonicalIndexUrl(item.canonicalUrl || url, "web");
  const title = clean(item.title || "", 250);
  if (!url || !canonical || title.length < 8) return null;
  let domain = clean(item.domain || "", 180);
  if (!domain) {
    try { domain = new URL(canonical).hostname.toLowerCase().replace(/^www\./, ""); } catch (_) {}
  }
  const sources = Array.isArray(item.sources) ? item.sources : [item.source || item.provider || ""];
  const providers = Array.isArray(item.providers) ? item.providers : [item.provider || ""];
  return {
    kind: kind,
    canonical_url: canonical,
    title: title,
    url: url,
    domain: domain,
    snippet: clean(item.snippet || "", 1200),
    source: clean(item.source || sources.find(Boolean) || "", 160),
    provider: clean(item.provider || providers.filter(Boolean).join(", "), 160),
    sources_json: JSON.stringify(sources.filter(Boolean).map(function (value) { return clean(value,160); }).slice(0,8)),
    providers_json: JSON.stringify(providers.filter(Boolean).map(function (value) { return clean(value,160); }).slice(0,8)),
    published_at: clean(item.published || "", 80)
  };
}
function indexedSearchQuery(kind, query, limit) {
  if (!["web","news"].includes(kind)) return null;
  const words = terms(query).slice(0,8);
  if (!words.length) return null;
  const conditions = words.map(function () {
    return "(LOWER(title) LIKE ? OR LOWER(snippet) LIKE ?)";
  }).join(" OR ");
  const params = [kind];
  words.forEach(function (word) {
    const pattern = "%" + word.replace(/[%_]/g,"") + "%";
    params.push(pattern,pattern);
  });
  const requested = Number(limit);
  const maximum = Number.isFinite(requested) && requested > 0 ? Math.min(50,Math.floor(requested)) : 20;
  params.push(maximum);
  return {
    sql: "SELECT kind,title,url,canonical_url,domain,snippet,source,provider,sources_json,providers_json,published_at,indexed_at " +
      "FROM search_index_items WHERE kind=? AND (" + conditions + ") " +
      "ORDER BY CASE WHEN LOWER(title) LIKE ? THEN 0 ELSE 1 END, indexed_at DESC LIMIT ?",
    params: [kind].concat(params.slice(1,-1), ["%" + String(query || "").trim().toLowerCase() + "%", maximum])
  };
}
async function indexedSearch(env, kind, query, limit) {
  const built = indexedSearchQuery(kind, query, limit);
  if (!built) return [];
  const data = await env.MEDIA_DB.prepare(built.sql).bind(...built.params).all();
  return data.results || [];
}

async function save(env, rows) {
  if (!rows.length) return 0;
  const indexedAt = new Date().toISOString();
  const stmts = rows.map(function (r) {
    return env.MEDIA_DB.prepare(
      "INSERT INTO media_items (kind,source,source_id,title,description,page_url,media_url,thumbnail_url,embed_url,author,license,provider,creator_url,license_url,attribution,width,height,format,published_at,duration_seconds,tags,nsfw,indexed_at,canonical_page_url,canonical_media_url) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET " +
      "canonical_page_url=COALESCE(NULLIF(excluded.canonical_page_url,''),media_items.canonical_page_url),canonical_media_url=COALESCE(NULLIF(excluded.canonical_media_url,''),media_items.canonical_media_url)," +
      "source_id=COALESCE(NULLIF(excluded.source_id,''),media_items.source_id),title=COALESCE(NULLIF(excluded.title,''),media_items.title),description=COALESCE(NULLIF(excluded.description,''),media_items.description),media_url=COALESCE(NULLIF(excluded.media_url,''),media_items.media_url),thumbnail_url=COALESCE(NULLIF(excluded.thumbnail_url,''),media_items.thumbnail_url),embed_url=COALESCE(NULLIF(excluded.embed_url,''),media_items.embed_url),author=COALESCE(NULLIF(excluded.author,''),media_items.author),license=CASE WHEN excluded.license IS NULL OR excluded.license='' OR excluded.license LIKE 'License %unavailable%' OR excluded.license LIKE 'License details %' THEN media_items.license ELSE excluded.license END,provider=COALESCE(NULLIF(excluded.provider,''),media_items.provider),creator_url=COALESCE(NULLIF(excluded.creator_url,''),media_items.creator_url),license_url=COALESCE(NULLIF(excluded.license_url,''),media_items.license_url),attribution=COALESCE(NULLIF(excluded.attribution,''),media_items.attribution),width=COALESCE(excluded.width,media_items.width),height=COALESCE(excluded.height,media_items.height),format=COALESCE(NULLIF(excluded.format,''),media_items.format),published_at=COALESCE(NULLIF(excluded.published_at,''),media_items.published_at),duration_seconds=COALESCE(excluded.duration_seconds,media_items.duration_seconds),tags=CASE WHEN excluded.tags IS NULL OR excluded.tags IN ('','[]') THEN media_items.tags ELSE excluded.tags END,nsfw=excluded.nsfw,indexed_at=excluded.indexed_at"
    ).bind(
      r.kind,r.source,r.source_id,r.title,r.description,r.page_url,r.media_url,
      r.thumbnail_url,r.embed_url,r.author,r.license,r.provider || "",
      r.creator_url || "",r.license_url || "",r.attribution || "",
      Number.isSafeInteger(Number(r.width)) && Number(r.width) > 0 ? Number(r.width) : null,
      Number.isSafeInteger(Number(r.height)) && Number(r.height) > 0 ? Number(r.height) : null,
      r.format || "",r.published_at,
      r.duration_seconds !== null && r.duration_seconds !== undefined && r.duration_seconds !== "" &&
        Number.isFinite(Number(r.duration_seconds)) && Number(r.duration_seconds) >= 0
        ? Number(r.duration_seconds) : null,
      JSON.stringify(r.tags || []),
      r.nsfw === 0 ? 0 : 1,indexedAt,
      indexDedupKeys(r).canonical_page_url,indexDedupKeys(r).canonical_media_url
    );
  });
  for (let i=0;i<stmts.length;i+=40) {
    await env.MEDIA_DB.batch(stmts.slice(i,i+40));
  }
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

  const safeVideoFilter = kind === "video" ? " AND nsfw=0" : "";
  return {
    sql: "WITH normalized AS (SELECT *, " + titleWords + " AS title_words, " +
      descriptionWords + " AS description_words, " + tagsWords +
      " AS tags_words FROM media_items WHERE kind=?" + safeVideoFilter + ") " +
      "SELECT *, (" + score + ") AS relevance_score, " +
      "CASE WHEN title_words LIKE ? THEN 0 ELSE 1 END AS phrase_rank " +
      "FROM normalized WHERE (" + conditions + ") " +
      "ORDER BY phrase_rank ASC, relevance_score DESC, " +
      "CASE WHEN julianday(indexed_at) >= julianday('now','-30 days') THEN 0 ELSE 1 END ASC, indexed_at DESC LIMIT ?", 
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
    if (r.nsfw === true || Number(r.nsfw) > 0) continue;
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
    candidates.push({r:r,score:score,googlePriority:r.source==="Google Images"?1:0,host:host,matched:matched,titleMatches:titleMatches,key:key});
  }
  // Rank before deduplication: a weak duplicate from one provider must not hide
  // a better-titled version of the same media returned by another provider.
  candidates.sort(function(a,b){return b.score-a.score || b.googlePriority-a.googlePriority || b.matched-a.matched || b.titleMatches-a.titleMatches;});
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
  if (r.kind==="image") return {title:r.title,description:r.description,page:r.page_url,image:r.media_url,thumbnail:r.thumbnail_url,license:r.license,licenseUrl:r.license_url,attribution:r.attribution,author:r.author,creatorUrl:r.creator_url,provider:r.provider,source:r.source,publishedAt:r.published_at||"",width:Number(r.width)||null,height:Number(r.height)||null,format:r.format||""};
  let host="";try{host=new URL(r.page_url).hostname;}catch(_){}
  return {kind:"video",id:r.source_id,sourceId:r.source_id,title:r.title,description:r.description,url:r.page_url,watchUrl:r.page_url,mediaUrl:r.media_url,embedUrl:r.embed_url,thumbnailUrl:r.thumbnail_url,thumbnail:r.thumbnail_url,host:host,channel:r.author,duration:r.duration_seconds,durationSeconds:r.duration_seconds,publishedAt:r.published_at||"",license:r.license||"",provider:r.provider||r.source,source:r.source,sources:Array.isArray(r.sources)?r.sources:[r.source]};
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
  let saved=[];
  let indexUnavailable=false;
  try {
    saved=await indexed(env,kind,q,100);
  } catch(error) {
    indexUnavailable=true;
    console.warn("Indexed search temporarily unavailable; continuing with live providers:",
      error && error.message || error);
  }
  const fetchLive=async function(query) {
    if(kind==="image") {
      const imageProviders=[
        {name:"Wikimedia Commons",search:function(searchQuery){return commons(searchQuery,16);}},
        {name:"Openverse",search:function(searchQuery){return openverse(searchQuery,12);}},
        {name:"Flickr public feed",search:function(searchQuery){return flickr(searchQuery,12);}}
      ];
      if(env.GOOGLE_CSE_API_KEY && env.GOOGLE_CSE_ID) imageProviders.unshift({name:"Google Images",search:function(searchQuery){return googleImages(searchQuery,env,10);}});
      const outcome=await runImageProviders(imageProviders,query);
      return outcome;
    }
    const providers=[
      {name:"PeerTube",search:function(searchQuery){return peertube(searchQuery,15);}},
      {name:"YouTube",search:createYouTubeProvider({apiKey:env.YOUTUBE_API_KEY,requestJson:getJson,cleanText:clean})},
      {name:"Wikimedia Commons",search:createWikimediaVideoProvider({requestJson:getJson,cleanText:clean})}
    ];
    return await runVideoProviders(providers,query);
  };
  let live=[];
  let imageProviderState={providers:[],failures:[],attempted:0};
  let videoProviderState={providers:[],failures:[],attempted:0};
  let liveResult=await fetchLive(q);
  if(kind==="image"){imageProviderState=liveResult;live=liveResult.results;}else{videoProviderState=liveResult;live=liveResult.results;}
  let ranked=kind==="image" ? rankImageResults(live.concat(saved),q,40) : diversifyVideoResults(rankVideoResults(live.concat(saved),q,100),40);
  let results=capFlickrResults(ranked,20);
  let expandedQuery="";
  // Only spend extra provider requests when the exact search is sparse.
  // Keep the focused query short and merge through the same deduper/ranker.
  if(ranked.length<8) {
    expandedQuery=kind==="video" ? buildVideoFallbackQuery(q) : fallbackQuery(q);
    if(expandedQuery) {
      const expandedLive=await fetchLive(expandedQuery);
      if(expandedLive.results.length) {
        if(kind==="image"){imageProviderState.providers=Array.from(new Set(imageProviderState.providers.concat(expandedLive.providers)));imageProviderState.failures=imageProviderState.failures.concat(expandedLive.failures);imageProviderState.attempted+=expandedLive.attempted;live=live.concat(expandedLive.results);}else{videoProviderState.providers=Array.from(new Set(videoProviderState.providers.concat(expandedLive.providers)));videoProviderState.failures=videoProviderState.failures.concat(expandedLive.failures);videoProviderState.attempted+=expandedLive.attempted;live=live.concat(expandedLive.results);}
        ranked=kind==="image" ? rankImageResults(live.concat(saved),q,40) : diversifyVideoResults(rankVideoResults(live.concat(saved),q,100),40);
        results=capFlickrResults(ranked,20);
      }
    }
  }
  if(kind==="image") {
    const params=new URL(request.url).searchParams;
    results=filterImageResults(results,{date:params.get("date")||"any",dimensions:params.get("dimensions")||"any",source:params.get("source")||"all",format:params.get("format")||"all"});
  }
  const sourceNames=Array.from(new Set(results.map(function(r){return r.source;}).filter(Boolean))).slice(0,8);
  const source=sourceNames.length ? sourceNames.join(" + ")
    : kind==="image" ? "Wikimedia Commons + Flickr public feed"
    : env.YOUTUBE_API_KEY ? "PeerTube + YouTube" : "PeerTube; YouTube requires an optional API key";
  return reply({query:q,results:results.map(front),count:results.length,source:source,
    providers:kind==="image"?imageProviderState.providers:videoProviderState.providers,
    failedProviders:kind==="image"?imageProviderState.failures:videoProviderState.failures,
    attemptedProviders:kind==="image"?imageProviderState.attempted:videoProviderState.attempted,
    safeSearch:kind==="video",
    indexStatus:indexUnavailable?"temporarily-unavailable":"available",
    expanded:!!expandedQuery,expandedQuery:expandedQuery||null});
}
function getDailySeedBatch(daySlot, seeds, batchSize) {
  const list = Array.isArray(seeds) && seeds.length ? seeds : SEEDS;
  const requested = Number(batchSize);
  const size = Number.isFinite(requested) && requested > 0
    ? Math.min(list.length, Math.floor(requested))
    : DAILY_SEED_BATCH_SIZE;
  const day = Number.isInteger(daySlot) ? daySlot : 0;
  const normalizedDay = ((day % list.length) + list.length) % list.length;
  const start = (normalizedDay * size) % list.length;
  return Array.from({ length: size }, function (_, offset) {
    return list[(start + offset) % list.length];
  });
}
function shouldIndexYouTubeSeed(seedIndex, daySlot, hasKey, batchSize) {
  const requested = Number(batchSize);
  const size = Number.isFinite(requested) && requested > 0
    ? Math.floor(requested)
    : DAILY_SEED_BATCH_SIZE;
  if (!hasKey || !Number.isInteger(seedIndex) || !Number.isInteger(daySlot) || size < 1) return false;
  const slot = ((daySlot % size) + size) % size;
  return seedIndex === slot;
}
function createIndexCircuitBreaker(threshold) {
  const requested = Number(threshold);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 2;
  const streaks = new Map();
  const disabled = new Set();
  return {
    isDisabled: function (provider) { return disabled.has(provider); },
    recordSuccess: function (provider) { streaks.delete(provider); },
    recordFailure: function (provider) {
      if (disabled.has(provider)) return streaks.get(provider) || limit;
      const streak = (streaks.get(provider) || 0) + 1;
      streaks.set(provider, streak);
      if (streak >= limit) disabled.add(provider);
      return streak;
    },
    disabledProviders: function () { return Array.from(disabled); }
  };
}
function indexFailure(provider, error) {
  const name = String(provider || "Unknown provider").trim().slice(0, 48);
  const message = String(error && error.message || error || "request failed")
    .replace(/\s+/g, " ").trim();
  return (name + ": " + message).slice(0, 150);
}

// Retry count is derived from the provider fan-out and reserved request headroom above.
function isRetryableIndexError(error) {
  const status = Number(error && error.status);
  if ([408, 425, 429].includes(status) || (status >= 500 && status <= 599)) return true;
  const name = String(error && error.name || "");
  if (name === "AbortError" || name === "TimeoutError") return true;
  if (error instanceof TypeError) return true;
  const message = String(error && error.message || error || "");
  return /(?:^|\s)Provider HTTP (?:408|425|429|5\d\d)(?:\s|$)/i.test(message) ||
    /timed? ?out|network error|fetch failed|connection reset|temporarily unavailable/i.test(message);
}
async function runIndexProviderWithRetry(run, budget, pause) {
  let retries = 0;
  while (true) {
    try { return { value: await run(), retries: retries }; }
    catch (error) {
      if (!isRetryableIndexError(error) || !budget || budget.remaining <= 0) { if (retries) { try { error.indexRetries = retries; } catch (_) { error = new Error(String(error)); error.indexRetries = retries; } } throw error; }
      budget.remaining -= 1;
      retries += 1;
      const delay = 200 + Math.floor(Math.random() * 100);
      await (pause || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); })(delay);
    }
  }
}
function buildIndexRunStats(providerStats, seedsProcessed, disabledProviders, durationMs) {
  const providers = {};
  let providerCalls = 0, providerFailures = 0, databaseSaveFailures = 0;
  let rowsReceived = 0, rowsSaved = 0, rowsContributed = 0, rowsSkipped = 0;
  const source = providerStats && typeof providerStats === "object" ? providerStats : {};
  Object.keys(source).sort().forEach(function (name) {
    const raw = source[name] && typeof source[name] === "object" ? source[name] : {};
    const count = function (value) {
      const number = Number(value);
      return Number.isSafeInteger(number) && number >= 0 ? number : 0;
    };
    const metric = {
      attempted: count(raw.attempted),
      retries: count(raw.retries),
      succeeded: count(raw.succeeded),
      failed: count(raw.failed),
      databaseSaveFailures: count(raw.databaseSaveFailures),
      rowsReceived: count(raw.rowsReceived),
      rowsSaved: count(raw.rowsSaved),
      rowsContributed: count(raw.rowsContributed),
      rowsSkipped: count(raw.rowsSkipped)
    };
    providers[String(name).slice(0, 48)] = metric;
    providerCalls += metric.attempted + metric.retries;
    providerFailures += metric.failed;
    databaseSaveFailures += metric.databaseSaveFailures;
    rowsReceived += metric.rowsReceived;
    rowsSaved += metric.rowsSaved;
    rowsContributed += metric.rowsContributed;
    rowsSkipped += metric.rowsSkipped;
  });
  const seeds = Number(seedsProcessed);
  const duration = Number(durationMs);
  return {
    version: 1,
    seedsProcessed: Number.isSafeInteger(seeds) && seeds >= 0 ? seeds : 0,
    providerCalls: providerCalls,
    providerFailures: providerFailures,
    databaseSaveFailures: databaseSaveFailures,
    rowsReceived: rowsReceived,
    rowsSaved: rowsSaved,
    rowsContributed: rowsContributed,
    rowsSkipped: rowsSkipped,
    disabledProviders: Array.from(new Set((Array.isArray(disabledProviders) ? disabledProviders : [])
      .map(function (name) { return String(name || "").trim().slice(0, 48); })
      .filter(Boolean))).slice(0, 12),
    durationMs: Number.isFinite(duration) && duration >= 0 ? Math.floor(duration) : 0,
    providers: providers
  };
}
function parseIndexRunStats(value) {
  if (typeof value !== "string" || value.length > 16000) return null;
  let parsed;
  try { parsed = JSON.parse(value); } catch (_) { return null; }
  if (!parsed || parsed.version !== 1 || !parsed.providers ||
      typeof parsed.providers !== "object" || Array.isArray(parsed.providers)) return null;
  return buildIndexRunStats(parsed.providers, parsed.seedsProcessed,
    parsed.disabledProviders, parsed.durationMs);
}

async function refresh(env) {
  const startedAt = Date.now();
  let saved = 0, failures = [];
  const providerStats = Object.create(null);
  function metricsFor(name) {
    if (!providerStats[name]) {
      providerStats[name] = {
        attempted: 0, retries: 0, succeeded: 0, failed: 0,
        databaseSaveFailures: 0, rowsReceived: 0, rowsSaved: 0, rowsContributed: 0, rowsSkipped: 0
      };
    }
    return providerStats[name];
  }
  const daySlot = Math.floor(Date.now() / 86400000);
  const dailySeeds = getDailySeedBatch(daySlot, SEEDS, DAILY_SEED_BATCH_SIZE);
  const circuit = createIndexCircuitBreaker(2);
  const retryBudget = { remaining: MAX_INDEX_RETRIES_PER_RUN };
  const d1BatchRequestBudget = createIndexD1BatchRequestBudget(INDEX_D1_BATCH_REQUEST_LIMIT, INDEX_D1_BATCH_REQUEST_RESERVE);
  let indexRowsQueued = 0;
  for (let index = 0; index < dailySeeds.length; index++) {
    const q = dailySeeds[index];
    const calls = [
      { name: "Wikimedia Commons", run: () => commons(q, 12) },
      { name: "Openverse", run: () => openverse(q, 12) },
      { name: "Flickr public feed", run: () => flickr(q, 12) },
      { name: "PeerTube", run: () => peertube(q, 12) }
    ].filter(function (call) { return !circuit.isDisabled(call.name); });
    // Six rotating seeds keep the daily discovery set broad while leaving
    // substantial headroom under the Workers Free 50-subrequest ceiling.
    // YouTube, when configured, adds one strict-safe search and one duration lookup.
    if (shouldIndexYouTubeSeed(index, daySlot, Boolean(env.YOUTUBE_API_KEY), dailySeeds.length) &&
        !circuit.isDisabled("YouTube")) {
      calls.push({ name: "YouTube", run: () => youtube(q, env.YOUTUBE_API_KEY, 8) });
    }
    calls.forEach(function (call) { metricsFor(call.name).attempted += 1; });
    const settled = await Promise.allSettled(calls.map(function (call) {
      return runIndexProviderWithRetry(call.run, retryBudget);
    }));
    for (let callIndex = 0; callIndex < settled.length; callIndex++) {
      const outcome = settled[callIndex], providerName = calls[callIndex].name;
      const metric = metricsFor(providerName);
      if (outcome.status === "rejected") {
        metric.retries += Number(outcome.reason && outcome.reason.indexRetries) || 0;
        metric.failed += 1;
        circuit.recordFailure(providerName);
        failures.push(indexFailure(providerName, outcome.reason));
        continue;
      }
      metric.retries += outcome.value.retries;
      metric.succeeded += 1;
      const rows = Array.isArray(outcome.value.value) ? outcome.value.value : [];
      metric.rowsReceived += rows.length;
      circuit.recordSuccess(providerName);
      const availableRows = Math.max(0, INDEX_MAX_ROWS_PER_RUN - indexRowsQueued);
      const boundedRows = rows.slice(0, availableRows);
      metric.rowsSkipped += rows.length - boundedRows.length;
      indexRowsQueued += boundedRows.length;
      if (!boundedRows.length) continue;
      try {
        const batchesNeeded = Math.ceil(boundedRows.length / INDEX_D1_BATCH_SIZE);
        if (!reserveIndexD1BatchRequestBudget(d1BatchRequestBudget, batchesNeeded)) {
          throw new Error("D1 indexing batch-request budget exhausted");
        }
        const savedCount = await save(env, boundedRows);
        saved += savedCount;
        metric.rowsSaved += savedCount;
      } catch (error) {
        metric.databaseSaveFailures += 1;
        failures.push(indexFailure(providerName + " database save", error));
      }
    }
  }
  const searchRequestBudget = createDailyRequestBudget(MAX_DAILY_WEB_NEWS_REQUESTS);
  const searchSeed = SEEDS[daySlot % SEEDS.length];
  const webDiscovery = await discoverDailyWeb(searchSeed, {
    budget: searchRequestBudget,
    maxResults: 20
  });
  const newsDiscovery = await discoverDailyNews(searchSeed, {
    budget: searchRequestBudget,
    maxResults: 20
  });
  function recordDiscoveryAttempts(attempts) {
    for (const attempt of attempts || []) {
      const metric = metricsFor(attempt.name);
      metric.attempted += 1;
      metric.rowsReceived += Number(attempt.rowsReceived) || 0;
      if (attempt.ok) metric.succeeded += 1;
      else {
        metric.failed += 1;
        failures.push(indexFailure(attempt.name, new Error(attempt.error || "provider request failed")));
      }
    }
  }
  recordDiscoveryAttempts(webDiscovery.attempts);
  recordDiscoveryAttempts(newsDiscovery.attempts);
  const searchRows = webDiscovery.results.map(function (item) {
    return normalizeSearchIndexRow("web", item);
  }).concat(newsDiscovery.results.map(function (item) {
    return normalizeSearchIndexRow("news", item);
  })).filter(Boolean);
  const boundedSearchRows = searchRows.slice(0, INDEX_MAX_SEARCH_ROWS_PER_RUN);
  const searchRowsSkipped = searchRows.length - boundedSearchRows.length;
  let searchRowsSaved = 0;
  if (boundedSearchRows.length) {
    try {
      const batchesNeeded = Math.ceil(boundedSearchRows.length / INDEX_D1_BATCH_SIZE);
      if (!reserveIndexD1BatchRequestBudget(d1BatchRequestBudget, batchesNeeded)) {
        throw new Error("D1 search-index batch-request budget exhausted");
      }
      searchRowsSaved = await saveSearchIndexRows(env, boundedSearchRows);
      saved += searchRowsSaved;
      for (const row of boundedSearchRows) {
        const providerNames = JSON.parse(row.providers_json || "[]");
        const metricName = providerNames[0] || row.provider || "Search index";
        metricsFor(metricName).rowsSaved += 1;
        // A canonical result can be discovered by several providers. Keep
        // rowsSaved unique while exposing every provider's contribution.
        const contributors = new Set(providerNames.filter(name =>
          typeof name === "string" && name.trim()
        ));
        if (!contributors.size && row.provider) contributors.add(row.provider);
        for (const contributor of contributors) {
          metricsFor(contributor).rowsContributed += 1;
        }
      }
    } catch (error) {
      metricsFor("Search index database save").databaseSaveFailures += 1;
      failures.push(indexFailure("Search index database save", error));
    }
  }
  const disabledProviders = circuit.disabledProviders();
  if (disabledProviders.length) {
    console.warn("Daily index disabled repeatedly failing providers for this run:", disabledProviders.join(", "));
  }
  // Keep stale rows searchable as a fallback, but prune both media and
  // webpage/news metadata indexes beyond the shared retention horizon.
  if (!reserveIndexD1BatchRequestBudget(d1BatchRequestBudget, 2)) {
    throw new Error("D1 indexing batch-request budget exhausted before retention cleanup");
  }
  const retentionCutoff = new Date(Date.now() - INDEX_RETENTION_DAYS * 86400000).toISOString();
  await env.MEDIA_DB.prepare(
    "DELETE FROM media_items WHERE rowid IN (SELECT rowid FROM media_items WHERE indexed_at < ? ORDER BY indexed_at ASC LIMIT ?)"
  ).bind(retentionCutoff, INDEX_RETENTION_PRUNE_BATCH_SIZE).run();
  await env.MEDIA_DB.prepare(
    "DELETE FROM search_index_items WHERE rowid IN (SELECT rowid FROM search_index_items WHERE indexed_at < ? ORDER BY indexed_at ASC LIMIT ?)"
  ).bind(retentionCutoff, INDEX_RETENTION_PRUNE_BATCH_SIZE).run();
  const stats = buildIndexRunStats(providerStats, dailySeeds.length, disabledProviders, Date.now() - startedAt);
  if (!reserveIndexD1BatchRequestBudget(d1BatchRequestBudget, 1)) {
    throw new Error("D1 indexing batch-request budget exhausted before run summary");
  }
  await env.MEDIA_DB.prepare(
    "INSERT INTO index_runs (finished_at,rows_processed,failure_count,note,stats_json) VALUES (?,?,?,?,?)"
  ).bind(new Date().toISOString(), saved, failures.length,
    failures.slice(0, 10).join("; ").slice(0, 1200), JSON.stringify(stats)).run();
  console.log(JSON.stringify({
    event: "daily-index-refresh",
    saved: saved,
    failures: failures.length,
    seedsProcessed: dailySeeds.length,
    disabledProviders: disabledProviders,
    stats: stats,
    resourceBudget: {
      externalSubrequestLimit: INDEX_EXTERNAL_SUBREQUEST_LIMIT,
      externalSubrequestReserve: INDEX_EXTERNAL_SUBREQUEST_RESERVE,
      retryBudgetRemaining: retryBudget.remaining,
      d1BatchRequestLimit: INDEX_D1_BATCH_REQUEST_LIMIT,
      d1BatchRequestsUsed: d1BatchRequestBudget.used,
      d1BatchRequestsReserved: d1BatchRequestBudget.reserved,
      indexRowsQueued: indexRowsQueued,
      indexRowsLimit: INDEX_MAX_ROWS_PER_RUN,
      searchRowsQueued: boundedSearchRows.length,
      searchRowsSaved: searchRowsSaved,
      searchRowsSkipped: searchRowsSkipped,
      searchRowsLimit: INDEX_MAX_SEARCH_ROWS_PER_RUN,
      webNewsRequests: searchRequestBudget.snapshot(),
      retentionRowsPrunedMaximum: INDEX_RETENTION_PRUNE_BATCH_SIZE,
      searchIndexRetentionRowsPrunedMaximum: INDEX_RETENTION_PRUNE_BATCH_SIZE
    }
  }));
}
function searchIndexCountsQuery() {
  return "SELECT kind,COUNT(*) AS total,COUNT(DISTINCT domain) AS domains,MAX(indexed_at) AS newestIndexedAt " +
    "FROM search_index_items GROUP BY kind";
}
function searchIndexFreshnessSummaryQuery() {
  // Webpage/news metadata follows the same freshness policy as media rows.
  return "SELECT kind,COUNT(*) AS total," +
    "SUM(CASE WHEN julianday(indexed_at) IS NOT NULL AND julianday(indexed_at) >= julianday('now','-" + INDEX_FRESH_DAYS + " days') THEN 1 ELSE 0 END) AS fresh," +
    "SUM(CASE WHEN julianday(indexed_at) IS NULL OR julianday(indexed_at) < julianday('now','-" + INDEX_FRESH_DAYS + " days') THEN 1 ELSE 0 END) AS stale," +
    "MIN(indexed_at) AS oldestIndexedAt,MAX(indexed_at) AS newestIndexedAt " +
    "FROM search_index_items GROUP BY kind";
}
function indexStatusCountsQuery() {
  return "SELECT kind,COUNT(*) AS total," +
    "SUM(CASE WHEN nsfw=0 THEN 1 ELSE 0 END) AS verified_safe," +
    "SUM(CASE WHEN nsfw=1 THEN 1 ELSE 0 END) AS unverified " +
    "FROM media_items GROUP BY kind";
}
function indexFreshnessSummaryQuery() {
  // Treat an absent or unparsable timestamp as stale so every indexed row is
  // accounted for. Stale rows remain searchable as a fallback until retention.
  return "SELECT kind,COUNT(*) AS total," +
    "SUM(CASE WHEN julianday(indexed_at) IS NOT NULL AND julianday(indexed_at) >= julianday('now','-" + INDEX_FRESH_DAYS + " days') THEN 1 ELSE 0 END) AS fresh," +
    "SUM(CASE WHEN julianday(indexed_at) IS NULL OR julianday(indexed_at) < julianday('now','-" + INDEX_FRESH_DAYS + " days') THEN 1 ELSE 0 END) AS stale," +
    "MIN(indexed_at) AS oldestIndexedAt,MAX(indexed_at) AS newestIndexedAt " +
    "FROM media_items GROUP BY kind";
}
function videoSafetySummary(rows) {
  const video = Array.isArray(rows)
    ? rows.find(function (row) { return row && row.kind === "video"; })
    : null;
  const safe = Number(video && video.verified_safe);
  const unverified = Number(video && video.unverified);
  return {
    verifiedSafe: Number.isSafeInteger(safe) && safe >= 0 ? safe : 0,
    unverified: Number.isSafeInteger(unverified) && unverified >= 0 ? unverified : 0
  };
}
function indexFailureSummary(note) {
  const knownProviders = [
    "Wikimedia Commons", "Openverse", "Flickr public feed", "PeerTube", "YouTube",
    "DuckDuckGo", "Wikipedia", "GDELT news index", "Google News RSS", "Bing News RSS",
    "Search index database save"
  ];
  const grouped = new Map();
  String(note || "").split(";").forEach(function (raw) {
    const entry = raw.trim();
    if (!entry) return;
    let provider = "";
    let stage = "request";
    let message = entry;
    for (const name of knownProviders) {
      const savePrefix = name + " database save:";
      const requestPrefix = name + ":";
      if (entry.startsWith(savePrefix)) {
        provider = name;
        stage = "database-save";
        message = entry.slice(savePrefix.length).trim();
        break;
      }
      if (entry.startsWith(requestPrefix)) {
        provider = name;
        message = entry.slice(requestPrefix.length).trim();
        break;
      }
    }
    if (!provider) {
      const separator = entry.indexOf(":");
      if (separator > 0) {
        provider = entry.slice(0, separator).trim().slice(0, 48) || "Unknown provider";
        message = entry.slice(separator + 1).trim();
      } else {
        provider = "Unknown provider";
        stage = "unknown";
      }
    }
    const key = provider + "\u0000" + stage;
    const current = grouped.get(key) || { provider: provider, stage: stage, count: 0, lastError: "" };
    current.count += 1;
    current.lastError = message.slice(0, 120);
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).sort(function (a, b) {
    return a.provider.localeCompare(b.provider) || a.stage.localeCompare(b.stage);
  });
}


// Task 78: keep operational status reads in one D1 round trip.
async function readIndexStatus(env) {
  // One D1 batch replaces five sequential database round trips. These
  // statements are read-only and retain the existing response contract.
  const statements = [
    env.MEDIA_DB.prepare(indexStatusCountsQuery()),
    env.MEDIA_DB.prepare(indexFreshnessSummaryQuery()),
    env.MEDIA_DB.prepare(searchIndexCountsQuery()),
    env.MEDIA_DB.prepare(searchIndexFreshnessSummaryQuery()),
    env.MEDIA_DB.prepare("SELECT finished_at,rows_processed,failure_count,note,stats_json FROM index_runs ORDER BY id DESC LIMIT 1")
  ];
  const results = await env.MEDIA_DB.batch(statements);
  const counts = results[0] || {};
  const freshness = results[1] || {};
  const searchCounts = results[2] || {};
  const searchFreshness = results[3] || {};
  const latest = Array.isArray(results[4] && results[4].results)
    ? results[4].results[0] || null
    : null;
  return {
    counts: counts.results || [],
    searchCounts: searchCounts.results || [],
    freshness: freshness.results || [],
    searchFreshness: searchFreshness.results || [],
    freshnessPolicy: {
      freshWithinDays: INDEX_FRESH_DAYS,
      retentionDays: INDEX_RETENTION_DAYS,
      staleRowsRemainSearchable: true,
      invalidTimestampsCountAsStale: true
    },
    videoSafety: videoSafetySummary(counts.results),
    latestRun: latest ? {
      finished_at: latest.finished_at,
      rows_processed: latest.rows_processed,
      failure_count: latest.failure_count,
      note: latest.note,
      stats: parseIndexRunStats(latest.stats_json)
    } : null,
    failureSummary: indexFailureSummary(latest && latest.note)
  };
}

export default {
  async fetch(request,env) {
    const diagnostic = createRequestDiagnostic(request, "gozie-search-media");
    const finish = (response, error) => {
      recordRequestDiagnostic(diagnostic, response && response.status, error);
      return response;
    };
    if(request.method==="OPTIONS")return finish(new Response(null,{status:204,headers:{"access-control-allow-origin":"*","access-control-allow-methods":"GET, OPTIONS","access-control-allow-headers":"Content-Type"}}));
    if(request.method!=="GET")return finish(reply({error:"Only GET requests are supported."},405));
    const p=new URL(request.url).pathname.replace(/\/+$/,"")||"/";
    try {
      if(p==="/"||p==="/health")return finish(reply({name:"GOZIE SEARCH Media API",status:"ok"}));
      if(p==="/images")return finish(await search(request,env,"image"));
      if(p==="/videos")return finish(await search(request,env,"video"));
      if(p==="/index/search"){
        const params=new URL(request.url).searchParams;
        const kind=(params.get("kind")||"").trim().toLowerCase();
        const query=(params.get("q")||"").trim().slice(0,180);
        const limit=Number(params.get("limit"))||20;
        if(!["web","news"].includes(kind))return finish(reply({error:"Choose kind=web or kind=news."},400));
        if(!query)return finish(reply({error:"Provide a search query."},400));
        const results=await indexedSearch(env,kind,query,limit);
        return finish(reply({kind,query,count:results.length,results}));
      }
      if(p==="/index/status"){
        return finish(reply(await readIndexStatus(env)));
      }
      return finish(reply({error:"Not found",availableRoutes:["/health","/images?q=...","/videos?q=...","/index/search?kind=web|news&q=...","/index/status"]},404));
    }catch(e){
      return finish(reply({error:"The media service is temporarily unavailable. Please try again shortly."},503), e);
    }
  },
  async scheduled(controller,env,ctx) {
    ctx.waitUntil(refresh(env).catch(function(e){console.error("Daily index refresh failed",e&&e.message||e);}));
  }
};
