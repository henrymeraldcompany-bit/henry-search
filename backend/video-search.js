function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch (_) { return ""; }
}
function videoKey(row) {
  const id = String(row.source_id || "").trim();
  if (id) return String(row.source || "").toLowerCase() + ":" + id.toLowerCase();
  try {
    const url = new URL(row.page_url);
    url.hash = "";
    url.searchParams.sort();
    return url.href;
  } catch (_) { return ""; }
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
