/**
 * Multi-source image-search orchestration.
 * Provider adapters return normalized image rows; this module isolates failures,
 * merges duplicate originals and reports which sources actually responded.
 */
function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch (_) { return ""; }
}

function normalizeImage(item, providerName) {
  if (!item || typeof item !== "object") return null;
  const page = safeHttpUrl(item.page_url || item.page || item.url);
  const media = safeHttpUrl(item.media_url || item.image);
  const thumbnail = safeHttpUrl(item.thumbnail_url || item.thumbnail || media);
  if (!page || !media || !thumbnail) return null;
  return {
    ...item,
    kind: "image",
    source: String(item.source || providerName).slice(0, 120),
    source_id: String(item.source_id || page).slice(0, 300),
    title: String(item.title || "Untitled image").trim().slice(0, 250),
    description: String(item.description || "").trim().slice(0, 900),
    page_url: page,
    media_url: media,
    thumbnail_url: thumbnail,
    author: String(item.author || "").trim().slice(0, 200),
    license: String(item.license || "").trim().slice(0, 120),
    license_url: safeHttpUrl(item.license_url),
    attribution: String(item.attribution || "").trim().slice(0, 500),
    provider: String(item.provider || "").trim().slice(0, 100),
    creator_url: safeHttpUrl(item.creator_url)
  };
}

function canonicalImageUrl(value) {
  const safe = safeHttpUrl(value);
  if (!safe) return "";
  try {
    const url = new URL(safe);
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_.+|fbclid|gclid|dclid|ref|ref_src|source)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch (_) { return ""; }
}

function mergeImage(existing, incoming) {
  return {
    ...existing,
    title: (!existing.title || existing.title === "Untitled image") && incoming.title ? incoming.title : existing.title,
    description: incoming.description.length > existing.description.length ? incoming.description : existing.description,
    author: existing.author || incoming.author,
    license: existing.license || incoming.license,
    license_url: existing.license_url || incoming.license_url,
    attribution: existing.attribution || incoming.attribution,
    provider: existing.provider || incoming.provider,
    creator_url: existing.creator_url || incoming.creator_url,
    thumbnail_url: existing.thumbnail_url.length >= incoming.thumbnail_url.length ? existing.thumbnail_url : incoming.thumbnail_url,
    page_url: existing.page_url || incoming.page_url,
    media_url: existing.media_url || incoming.media_url,
    sources: [...new Set([...(existing.sources || [existing.source]), ...(incoming.sources || [incoming.source])])]
  };
}

export async function runImageProviders(providers, query) {
  const configured = Array.isArray(providers) ? providers.filter(provider =>
    provider && typeof provider.name === "string" && provider.name.trim() && typeof provider.search === "function"
  ) : [];
  const settled = await Promise.allSettled(configured.map(provider =>
    Promise.resolve().then(() => provider.search(query))
  ));
  const results = [];
  const indexes = new Map();
  const successful = new Set();
  const failures = [];
  settled.forEach((outcome, index) => {
    const name = configured[index].name.trim();
    if (outcome.status === "rejected") {
      failures.push({provider:name,message:String(outcome.reason && outcome.reason.message || "Provider request failed").slice(0,200)});
      return;
    }
    successful.add(name);
    for (const raw of Array.isArray(outcome.value) ? outcome.value : []) {
      const item = normalizeImage(raw,name);
      if (!item) continue;
      const keys = [
        canonicalImageUrl(item.page_url) && "page:" + canonicalImageUrl(item.page_url),
        canonicalImageUrl(item.media_url) && "media:" + canonicalImageUrl(item.media_url)
      ].filter(Boolean);
      const positions = [...new Set(keys.map(key => indexes.get(key)).filter(position => position !== undefined))];
      if (positions.length) {
        const position = positions[0];
        results[position] = mergeImage(results[position], item);
        for (const duplicatePosition of positions.slice(1)) {
          results[position] = mergeImage(results[position], results[duplicatePosition]);
          results[duplicatePosition] = null;
        }
        for (const key of keys) indexes.set(key, position);
      } else {
        const position = results.length;
        results.push({...item,sources:[item.source]});
        for (const key of keys) indexes.set(key, position);
      }
    }
  });
  return {results:results.filter(Boolean),providers:[...successful],failures,attempted:configured.length};
}


const IMAGE_STOP_WORDS = new Set([
  "a","an","and","are","as","at","be","by","for","from","how","in","is","it","of","on","or","the","to","was","what","when","where","which","who","why","with","about","this","that",
  "image","images","photo","photos","picture","pictures","wallpaper","illustration","search","find"
]);

function imageTerms(value) {
  return String(value || "").toLowerCase()
    .split(/[^\\p{L}\\p{N}]+/u).filter(word => word.length > 1 && !IMAGE_STOP_WORDS.has(word));
}

function imageMetadataText(value) {
  if (Array.isArray(value)) return value.map(item => typeof item === "string" ? item : item && item.name || "").join(" ");
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed[0] === "[" || trimmed[0] === "{") {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map(item => typeof item === "string" ? item : item && item.name || "").join(" ") : "";
    } catch (_) {}
  }
  return trimmed;
}

/**
 * Rank image candidates by query relevance before provider preference.
 * Exact phrases and title matches outweigh description/tags; metadata and
 * source preference are tie-breakers only, never substitutes for relevance.
 */
export function rankImageResults(rows, query, limit = 40) {
  const rawQuery = String(query || "").trim().toLowerCase();
  const queryTokens = imageTerms(rawQuery);
  if (!queryTokens.length || !Array.isArray(rows)) return [];
  const normalizedPhrase = rawQuery.split(/[^\\p{L}\\p{N}]+/u).filter(Boolean).join(" ");
  const candidates = [];
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const title = String(row.title || "").toLowerCase();
    const description = String(row.description || "").toLowerCase();
    const tags = imageMetadataText(row.tags).toLowerCase();
    const author = String(row.author || "").toLowerCase();
    const titleTokens = imageTerms(title);
    const titleSet = new Set(titleTokens);
    const detailSet = new Set(imageTerms([description, tags, author].join(" ")));
    const titlePhrase = title.split(/[^\\p{L}\\p{N}]+/u).filter(Boolean).join(" ");
    const exactTitlePhrase = !!normalizedPhrase && (" " + titlePhrase + " ").includes(" " + normalizedPhrase + " ");
    const matchedTitle = queryTokens.filter(token => titleSet.has(token)).length;
    const matchedDetails = queryTokens.filter(token => !titleSet.has(token) && detailSet.has(token)).length;
    const matched = matchedTitle + matchedDetails;
    const minMatches = queryTokens.length >= 3 ? 2 : 1;
    if (!exactTitlePhrase && matched < minMatches) return;
    const coverage = matched / queryTokens.length;
    const score = (exactTitlePhrase ? 30 : 0) + matchedTitle * 8 + matchedDetails * 3 +
      (matchedTitle === queryTokens.length ? 6 : 0) + coverage * 5;
    const page = String(row.page_url || row.page || row.url || "");
    let host = "";
    try { host = new URL(page).hostname.toLowerCase().replace(/^www\\./, ""); } catch (_) {}
    candidates.push({
      row, index, score, host,
      providerPriority: row.source === "Google Images" ? 1 : 0,
      metadataCompleteness: [row.author, row.license, row.license_url, row.attribution].filter(Boolean).length
    });
  });
  candidates.sort((a, b) =>
    b.score - a.score ||
    b.providerPriority - a.providerPriority ||
    b.metadataCompleteness - a.metadataCompleteness ||
    a.index - b.index
  );
  const max = Math.max(1, Math.min(100, Number(limit) || 40));
  const perHostCap = Math.max(2, Math.ceil(max / 5));
  const providerKeys = candidate => {
    const values = Array.isArray(candidate.row.sources) ? candidate.row.sources : [candidate.row.source];
    return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))];
  };
  const providerCount = new Set(candidates.flatMap(providerKeys)).size;
  const perProviderCap = Math.max(1, Math.ceil(max / Math.max(1, providerCount)));
  const selected = [];
  const hostCounts = new Map();
  const providerCounts = new Map();
  const deferred = [];
  for (const candidate of candidates) {
    const hostCount = candidate.host ? (hostCounts.get(candidate.host) || 0) : 0;
    const sources = providerKeys(candidate);
    const hasProviderRoom = !sources.length || sources.some(name => (providerCounts.get(name) || 0) < perProviderCap);
    if ((candidate.host && hostCount >= perHostCap) || !hasProviderRoom) {
      deferred.push(candidate);
      continue;
    }
    selected.push(candidate);
    if (candidate.host) hostCounts.set(candidate.host, hostCount + 1);
    for (const name of sources) providerCounts.set(name, (providerCounts.get(name) || 0) + 1);
    if (selected.length >= max) break;
  }
  // Relax diversity caps only after all eligible alternatives have been considered.
  for (const candidate of deferred) {
    if (selected.length >= max) break;
    selected.push(candidate);
  }
  return selected.map(candidate => candidate.row);
}
