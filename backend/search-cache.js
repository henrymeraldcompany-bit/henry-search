/**
 * Stable cache keys for equivalent GOZIE SEARCH API requests.
 * Query casing and whitespace are normalized; filters remain part of the key.
 */
export function isCacheableSearchRoute(path) {
  return ["/search", "/news", "/images"].includes(String(path || ""));
}

export function buildSearchCacheKey(input) {
  const url = new URL(input instanceof URL ? input.href : String(input));
  url.hash = "";
  const query = (url.searchParams.get("q") || "").trim().replace(/\\s+/g, " ").toLowerCase();
  url.searchParams.set("q", query);
  const entries = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) =>
    ak.localeCompare(bk) || av.localeCompare(bv)
  );
  url.search = "";
  for (const [key, value] of entries) url.searchParams.append(key, value);
  return url.href;
}
