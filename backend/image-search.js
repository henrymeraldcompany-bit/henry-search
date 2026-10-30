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

function mergeImage(existing, incoming) {
  return {
    ...existing,
    description: incoming.description.length > existing.description.length ? incoming.description : existing.description,
    author: existing.author || incoming.author,
    license: existing.license || incoming.license,
    license_url: existing.license_url || incoming.license_url,
    attribution: existing.attribution || incoming.attribution,
    provider: existing.provider || incoming.provider,
    creator_url: existing.creator_url || incoming.creator_url,
    thumbnail_url: existing.thumbnail_url || incoming.thumbnail_url,
    sources: [...new Set([...(existing.sources || [existing.source]), incoming.source])]
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
      const key = item.page_url;
      if (indexes.has(key)) {
        const position = indexes.get(key);
        results[position] = mergeImage(results[position],item);
      } else {
        indexes.set(key,results.length);
        results.push({...item,sources:[item.source]});
      }
    }
  });
  return {results,providers:[...successful],failures,attempted:configured.length};
}
