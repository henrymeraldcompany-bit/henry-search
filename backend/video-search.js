function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch (_) { return ""; }
}
function videoKey(row) {
  // Canonical page URLs unify the same video returned by different providers
  // while preserving meaningful query parameters such as YouTube's video ID.
  try {
    const url = new URL(row.page_url);
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^(utm_.+|fbclid|gclid|dclid|ref|ref_src|source|feature)$/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch (_) {
    const id = String(row.source_id || "").trim();
    return id ? String(row.source || "").toLowerCase() + ":" + id.toLowerCase() : "";
  }
}
function mergeVideo(existing, incoming) {
  const merged = { ...existing };
  for (const field of ["title","description","thumbnail_url","embed_url","author","published_at","duration_seconds"]) {
    if ((!merged[field] || merged[field] === "Untitled video") && incoming[field]) merged[field] = incoming[field];
    else if (field === "description" && String(incoming[field] || "").length > String(merged[field] || "").length) merged[field] = incoming[field];
    else if (field === "thumbnail_url" && incoming[field] && !merged[field]) merged[field] = incoming[field];
  }
  merged.sources = [...new Set([...(existing.sources || [existing.source]), ...(incoming.sources || [incoming.source])].filter(Boolean))];
  return merged;
}
/**
 * Runs independent video providers concurrently, isolates provider failures,
 * normalizes safe HTTP(S) result URLs and merges duplicate video records.
 */
export async function runVideoProviders(providers, query) {
  const configured = Array.isArray(providers) ? providers.filter(provider =>
    provider && typeof provider.name === "string" && provider.name.trim() &&
    typeof provider.search === "function"
  ) : [];
  const settled = await Promise.allSettled(configured.map(provider =>
    Promise.resolve().then(() => provider.search(query))
  ));
  const results = [];
  const indexes = new Map();
  const successful = [];
  const failures = [];
  settled.forEach((outcome, index) => {
    const name = configured[index].name.trim();
    if (outcome.status === "rejected") {
      failures.push({ provider: name, message: String(outcome.reason && outcome.reason.message || "Provider request failed").slice(0, 200) });
      return;
    }
    successful.push(name);
    for (const raw of Array.isArray(outcome.value) ? outcome.value : []) {
      if (!raw || typeof raw !== "object" || raw.nsfw === true || Number(raw.nsfw) > 0) continue;
      const page = safeHttpUrl(raw.page_url || raw.url);
      if (!page) continue;
      const media = safeHttpUrl(raw.media_url || page);
      const key = videoKey({ ...raw, page_url: page });
      if (!key) continue;
      const row = {
        ...raw, kind: "video", source: String(raw.source || name).slice(0, 120),
        source_id: String(raw.source_id || page).slice(0, 300),
        title: String(raw.title || "Untitled video").trim().slice(0, 250),
        description: String(raw.description || "").trim().slice(0, 1000),
        page_url: page, media_url: media || page,
        thumbnail_url: safeHttpUrl(raw.thumbnail_url || raw.thumbnail),
        embed_url: safeHttpUrl(raw.embed_url),
        author: String(raw.author || "").trim().slice(0, 200),
        license: String(raw.license || "").trim().slice(0, 100),
        published_at: typeof raw.published_at === "string" ? raw.published_at.slice(0, 80) : "",
        duration_seconds: typeof raw.duration_seconds === "number" && Number.isFinite(raw.duration_seconds) && raw.duration_seconds >= 0 ? raw.duration_seconds : null,
        provider: String(raw.provider || name).slice(0, 120),
        nsfw: 0
      };
      const position = indexes.get(key);
      if (position !== undefined) results[position] = mergeVideo(results[position], row);
      else { indexes.set(key, results.length); results.push({ ...row, sources: [row.source] }); }
    }
  });
  return { results, providers: successful, failures, attempted: configured.length };
}

const VIDEO_STOP_WORDS = new Set([
  "a","an","and","are","as","at","be","by","for","from","how","in","is","it","of","on","or","the","to","was","what","when","where","which","who","why","with","about","this","that",
  "video","videos","clip","clips","watch","search","find"
]);
function videoTerms(value) {
  return String(value || "").toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length > 1 && !VIDEO_STOP_WORDS.has(word));
}

/**
 * Rank normalized video candidates by query relevance. Exact title phrases
 * and title matches lead; descriptions, tags and creator names are secondary.
 * Provider preference never overrides relevance.
 */
export function rankVideoResults(rows, query, limit = 40) {
  const rawQuery = String(query || "").trim().toLowerCase();
  const queryTokens = videoTerms(rawQuery);
  if (!queryTokens.length || !Array.isArray(rows)) return [];
  const normalizedPhrase = rawQuery.split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ");
  const candidates = [];
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const title = String(row.title || "").toLowerCase();
    const titleTokens = videoTerms(title);
    const titleSet = new Set(titleTokens);
    const detailText = [
      row.description, row.author, row.channel, row.tags,
      row.title === "Untitled video" ? "" : ""
    ].map(value => Array.isArray(value) ? value.join(" ") : String(value || "")).join(" ");
    const detailSet = new Set(videoTerms(detailText));
    const titlePhrase = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ");
    const exactTitlePhrase = !!normalizedPhrase &&
      (" " + titlePhrase + " ").includes(" " + normalizedPhrase + " ");
    const matchedTitle = queryTokens.filter(token => titleSet.has(token)).length;
    const matchedDetails = queryTokens.filter(token => !titleSet.has(token) && detailSet.has(token)).length;
    const matched = matchedTitle + matchedDetails;
    const minMatches = queryTokens.length >= 3 ? 2 : 1;
    if (!exactTitlePhrase && matched < minMatches) return;
    const coverage = matched / queryTokens.length;
    const score = (exactTitlePhrase ? 30 : 0) + matchedTitle * 8 +
      matchedDetails * 3 + (matchedTitle === queryTokens.length ? 6 : 0) + coverage * 5;
    candidates.push({ row, index, score });
  });
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const max = Math.max(1, Math.min(100, Number(limit) || 40));
  return candidates.slice(0, max).map(candidate => candidate.row);
}
