/**
 * Multi-source web-search orchestration.
 *
 * Provider adapters implement: { name: string, search(query): Promise<Result[]> }.
 * This layer owns failure isolation, result validation, canonical URL deduplication,
 * and a stable response contract. Provider-specific API logic stays in adapters.
 */

const TRACKING_PARAMETERS = new Set([
  "fbclid", "gclid", "dclid", "mc_cid", "mc_eid", "ref", "ref_src"
]);

export function canonicalizeResultUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;

    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || TRACKING_PARAMETERS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    url.hostname = url.hostname.toLowerCase().replace(/^www\./i, "");
    if ((url.protocol === "https:" && url.port === "443") ||
        (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch {
    return null;
  }
}

function normalizeResult(item, providerName) {
  if (!item || typeof item !== "object") return null;
  const url = typeof item.url === "string" ? item.url.trim() : "";
  const canonicalUrl = canonicalizeResultUrl(url);
  const title = typeof item.title === "string" ? item.title.trim() : "";
  if (!canonicalUrl || !title) return null;

  return {
    id: canonicalUrl,
    type: "web",
    title: title.slice(0, 500),
    url,
    domain: new URL(canonicalUrl).hostname.replace(/^www\\./i, ""),
    snippet: typeof item.snippet === "string" ? item.snippet.trim().slice(0, 3000) : "",
    source: typeof item.source === "string" && item.source.trim()
      ? item.source.trim().slice(0, 160)
      : providerName,
    published: typeof item.published === "string" ? item.published.slice(0, 100) : "",
    provider: providerName,
    canonicalUrl
  };
}

function mergeDuplicateResults(existing, incoming) {
  const sources = [...new Set([...(existing.sources || [existing.source]), ...(incoming.sources || [incoming.source])].filter(Boolean))];
  const providers = [...new Set([...(existing.providers || [existing.provider]), ...(incoming.providers || [incoming.provider])].filter(Boolean))];
  return {
    ...existing,
    snippet: incoming.snippet.length > existing.snippet.length ? incoming.snippet : existing.snippet,
    published: existing.published || incoming.published,
    sources,
    providers
  };
}

const RANKING_STOP_WORDS = new Set(["a","an","and","are","as","at","be","by","for","from","how","in","is","it","of","on","or","that","the","this","to","was","what","when","where","which","who","why","with"]);

function tokenize(value) {
  return String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[\p{L}\p{N}]+/gu) || [];
}

/** Score literal query relevance; title matches carry more weight than snippets. */
export function scoreSearchResult(result, query) {
  const queryTokens = [...new Set(tokenize(query).filter(token => !RANKING_STOP_WORDS.has(token)))];
  if (!queryTokens.length) return 0;
  const titleTokens = tokenize(result?.title);
  const snippetTokens = tokenize(result?.snippet);
  const titleSet = new Set(titleTokens);
  const snippetSet = new Set(snippetTokens);
  let score = 0;
  let matched = 0;
  for (const token of queryTokens) {
    const inTitle = titleSet.has(token);
    const inSnippet = snippetSet.has(token);
    if (inTitle || inSnippet) matched += 1;
    if (inTitle) score += 4;
    if (inSnippet) score += 1;
  }
  const normalizedQuery = queryTokens.join(" ");
  const normalizedTitle = titleTokens.join(" ");
  const normalizedSnippet = snippetTokens.join(" ");
  if (normalizedTitle.includes(normalizedQuery)) score += 6;
  else if (normalizedSnippet.includes(normalizedQuery)) score += 3;
  score += Math.round((matched / queryTokens.length) * 5);
  return score;
}

/** Rank by deterministic text relevance; preserve original order for equal scores. */
export function rankSearchResults(results, query) {
  return (Array.isArray(results) ? results : [])
    .map((result, index) => ({ ...result, relevanceScore: scoreSearchResult(result, query), _rankIndex: index }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore || a._rankIndex - b._rankIndex)
    .map(({ _rankIndex, ...result }) => result);
}

/**
 * Interleave results by hostname so one website cannot occupy a long run.
 * Keeps every result and preserves each host's original relative order.
 */
export function diversifySearchResults(results) {
  if (!Array.isArray(results) || results.length < 2) return Array.isArray(results) ? results : [];
  const buckets = new Map();
  for (const result of results) {
    let domain = typeof result?.domain === "string" ? result.domain.toLowerCase() : "";
    if (!domain) {
      try { domain = new URL(result?.canonicalUrl || result?.url).hostname.toLowerCase(); }
      catch { domain = "__unknown__"; }
    }
    if (!buckets.has(domain)) buckets.set(domain, []);
    buckets.get(domain).push(result);
  }
  const diversified = [];
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const bucket of buckets.values()) {
      if (bucket.length) {
        diversified.push(bucket.shift());
        remaining = true;
      }
    }
  }
  return diversified;
}

/**
 * Query all configured providers concurrently. A failed provider does not discard
 * successful providers' results. The output intentionally preserves provider order;
 * relevance ranking and pagination are separate later stages.
 */
export async function runSearchProviders(providers, query) {
  const configured = Array.isArray(providers) ? providers.filter(provider =>
    provider &&
    typeof provider.name === "string" &&
    provider.name.trim() &&
    typeof provider.search === "function"
  ) : [];

  const settled = await Promise.allSettled(
    configured.map(provider => Promise.resolve().then(() => provider.search(query)))
  );

  const results = [];
  const resultIndexes = new Map();
  const successfulProviders = [];
  const failures = [];

  for (let index = 0; index < settled.length; index += 1) {
    const outcome = settled[index];
    const providerName = configured[index].name.trim();

    if (outcome.status === "rejected") {
      failures.push({ provider: providerName, message: String(outcome.reason?.message || "Provider request failed").slice(0, 240) });
      continue;
    }

    successfulProviders.push(providerName);
    const items = Array.isArray(outcome.value) ? outcome.value : [];
    for (const item of items) {
      const normalized = normalizeResult(item, providerName);
      if (!normalized) continue;
      const existingIndex = resultIndexes.get(normalized.canonicalUrl);
      if (existingIndex !== undefined) {
        results[existingIndex] = mergeDuplicateResults(results[existingIndex], normalized);
        continue;
      }
      resultIndexes.set(normalized.canonicalUrl, results.length);
      results.push({ ...normalized, sources: [normalized.source], providers: [normalized.provider] });
    }
  }

  return {
    results: diversifySearchResults(results),
    providers: successfulProviders,
    failures,
    attempted: configured.length
  };
}
