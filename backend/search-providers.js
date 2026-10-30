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

    url.hostname = url.hostname.toLowerCase();
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
  const seen = new Set();
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
      if (!normalized || seen.has(normalized.canonicalUrl)) continue;
      seen.add(normalized.canonicalUrl);
      results.push(normalized);
    }
  }

  return {
    results,
    providers: successfulProviders,
    failures,
    attempted: configured.length
  };
}
