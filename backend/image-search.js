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

function imageIdentityKey(item) {
  // The media file is the image identity. A gallery/source page may contain
  // several distinct images, so use the page URL only when no media URL exists.
  const media = canonicalImageUrl(item && (item.media_url || item.image));
  if (media) return "media:" + media;
  const page = canonicalImageUrl(item && (item.page_url || item.page || item.url));
  return page ? "page:" + page : "";
}

function mergeImage(existing, incoming) {
  const existingDescription = String(existing.description || "");
  const incomingDescription = String(incoming.description || "");
  const existingThumbnail = String(existing.thumbnail_url || "");
  const incomingThumbnail = String(incoming.thumbnail_url || "");
  const existingLicense = String(existing.license || "").trim();
  const incomingLicense = String(incoming.license || "").trim();
  const genericLicense = value => !value ||
    /^(license information unavailable|unknown|not provided|not specified)$/i.test(value);
  const existingSources = Array.isArray(existing.sources) ? existing.sources : [existing.source];
  const incomingSources = Array.isArray(incoming.sources) ? incoming.sources : [incoming.source];
  return {
    ...existing,
    title: (!existing.title || existing.title === "Untitled image") && incoming.title ? incoming.title : existing.title,
    description: incomingDescription.length > existingDescription.length ? incomingDescription : existingDescription,
    author: existing.author || incoming.author,
    // Prefer a real license statement over a provider's generic "unavailable" label.
    license: !genericLicense(existingLicense) ? existingLicense : incomingLicense || existingLicense,
    license_url: existing.license_url || incoming.license_url,
    attribution: existing.attribution || incoming.attribution,
    provider: existing.provider || incoming.provider,
    creator_url: existing.creator_url || incoming.creator_url,
    thumbnail_url: existingThumbnail.length >= incomingThumbnail.length ? existingThumbnail : incomingThumbnail,
    page_url: existing.page_url || incoming.page_url,
    media_url: existing.media_url || incoming.media_url,
    published_at: existing.published_at || incoming.published_at,
    sources: [...new Set([...existingSources, ...incomingSources].map(value => String(value || "").trim()).filter(Boolean))]
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
      const key = imageIdentityKey(item);
      const position = key ? indexes.get(key) : undefined;
      if (position !== undefined) {
        results[position] = mergeImage(results[position], item);
      } else {
        const nextPosition = results.length;
        results.push({...item,sources:[item.source]});
        if (key) indexes.set(key, nextPosition);
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
    .split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 1 && !IMAGE_STOP_WORDS.has(word));
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
  const normalizedPhrase = rawQuery.split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ");
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
    const titlePhrase = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ");
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
    try { host = new URL(page).hostname.toLowerCase().replace(/^www\./, ""); } catch (_) {}
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

  // Live provider results and D1 index rows can describe the same image.
  // Deduplicate by canonical media URL before diversity caps so duplicate
  // records do not consume result slots or distort provider representation.
  const uniqueCandidates = [];
  const candidateIndexes = new Map();
  for (const candidate of candidates) {
    const key = imageIdentityKey(candidate.row);
    const existingIndex = key ? candidateIndexes.get(key) : undefined;
    if (existingIndex !== undefined) {
      const existing = uniqueCandidates[existingIndex];
      uniqueCandidates[existingIndex] = {
        ...existing,
        row: mergeImage(existing.row, candidate.row)
      };
      continue;
    }
    const position = uniqueCandidates.length;
    uniqueCandidates.push(candidate);
    if (key) candidateIndexes.set(key, position);
  }
  const max = Math.max(1, Math.min(100, Number(limit) || 40));
  const perHostCap = Math.max(2, Math.ceil(max / 5));
  const providerKeys = candidate => {
    const values = Array.isArray(candidate.row.sources) ? candidate.row.sources : [candidate.row.source];
    return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))];
  };
  const providerCount = new Set(uniqueCandidates.flatMap(providerKeys)).size;
  const perProviderCap = Math.max(1, Math.ceil(max / Math.max(1, providerCount)));
  const selected = [];
  const hostCounts = new Map();
  const providerCounts = new Map();
  const deferred = [];
  for (const candidate of uniqueCandidates) {
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
  // Relax diversity caps only after the first pass, then fill fairly. A simple
  // relevance-ordered fallback would let the first provider dominate whenever
  // every provider reaches its cap. Prefer the least represented provider and
  // host first, while retaining relevance order within each group.
  const remaining = deferred.slice();
  while (selected.length < max && remaining.length) {
    remaining.sort((a, b) => {
      const providerCountFor = candidate => {
        const sources = providerKeys(candidate);
        return sources.length
          ? Math.min(...sources.map(name => providerCounts.get(name) || 0))
          : 0;
      };
      const providerDifference = providerCountFor(a) - providerCountFor(b);
      if (providerDifference) return providerDifference;
      const hostDifference = (hostCounts.get(a.host) || 0) - (hostCounts.get(b.host) || 0);
      if (hostDifference) return hostDifference;
      return a.index - b.index;
    });
    const candidate = remaining.shift();
    selected.push(candidate);
    if (candidate.host) hostCounts.set(candidate.host, (hostCounts.get(candidate.host) || 0) + 1);
    for (const name of providerKeys(candidate)) {
      providerCounts.set(name, (providerCounts.get(name) || 0) + 1);
    }
  }
  return selected.map(candidate => candidate.row);
}
