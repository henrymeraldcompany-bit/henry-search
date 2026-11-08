const ROUTE_PARAMETERS = {
  "/": new Set(),
  "/search": new Set(["q", "domain", "source", "date"]),
  "/images": new Set(["q"]),
  "/news": new Set(["q", "date", "from", "to", "page"]),
  "/extract": new Set(["url"])
};
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateApiRequest(url) {
  const route = url.pathname;
  const allowed = ROUTE_PARAMETERS[route];
  if (!allowed) return { valid: false, error: "Unknown API endpoint." };
  const counts = new Map();
  for (const [key, value] of url.searchParams) {
    if (!allowed.has(key)) return { valid: false, error: "Unsupported query parameter: " + key.slice(0, 40) };
    counts.set(key, (counts.get(key) || 0) + 1);
    if (counts.get(key) > 1) return { valid: false, error: "Duplicate query parameters are not allowed." };
    if (CONTROL_CHARACTERS.test(value)) return { valid: false, error: "Query parameters contain invalid control characters." };
    if (value.length > 2048) return { valid: false, error: "A query parameter exceeds the maximum length." };
  }
  if (route === "/") return { valid: true };
  if (route === "/extract") {
    const target = url.searchParams.get("url") || "";
    if (!target) return { valid: false, error: "Provide a webpage URL using the url parameter." };
    if (target.length > 2048 || /\s/.test(target)) return { valid: false, error: "The webpage URL is invalid or too long." };
    let parsed;
    try { parsed = new URL(target); } catch { return { valid: false, error: "The webpage URL must be a valid absolute URL." }; }
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
      return { valid: false, error: "Only absolute HTTP or HTTPS webpage URLs are accepted." };
    }
    return { valid: true };
  }
  const query = url.searchParams.get("q") || "";
  if (!query.trim()) return { valid: false, error: "Enter a search query." };
  if (query.length > 300) return { valid: false, error: "Search query must be 300 characters or fewer." };
  if (query.trim() !== query) return { valid: false, error: "Remove leading or trailing spaces from the search query." };
  if (route === "/search") {
    const domain = url.searchParams.get("domain") || "";
    if (domain && (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain) || domain.length > 253)) {
      return { valid: false, error: "The domain filter must be a valid hostname." };
    }
    const source = url.searchParams.get("source") || "";
    if (source.length > 120) return { valid: false, error: "The source filter must be 120 characters or fewer." };
    const date = url.searchParams.get("date") || "any";
    if (!new Set(["any", "day", "week", "month", "year"]).has(date)) return { valid: false, error: "The date filter is not supported." };
  }
  if (route === "/news") {
    const page = url.searchParams.get("page") || "1";
    if (!/^[1-9]\d{0,2}$/.test(page) || Number(page) > 100) return { valid: false, error: "The news page must be between 1 and 100." };
    const date = url.searchParams.get("date") || "any";
    if (!new Set(["any", "day", "week", "month", "year"]).has(date)) return { valid: false, error: "The news date filter is not supported." };
    const from = url.searchParams.get("from") || "", to = url.searchParams.get("to") || "";
    if ((from && !validCalendarDate(from)) || (to && !validCalendarDate(to))) return { valid: false, error: "Dates must use valid YYYY-MM-DD calendar dates." };
    if (from && to && from > to) return { valid: false, error: "The start date must not be later than the end date." };
  }
  return { valid: true };
}
