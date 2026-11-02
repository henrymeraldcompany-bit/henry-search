const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://henrymeraldcompany-bit.github.io"
]);

function parseOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["https:", "http:"].includes(url.protocol) || url.origin !== value ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

export function isAllowedApiOrigin(origin, env = {}) {
  const normalized = parseOrigin(origin);
  if (!normalized) return false;
  if (DEFAULT_ALLOWED_ORIGINS.has(normalized)) return true;
  const configured = String(env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
  return configured.some(value => parseOrigin(value) === normalized);
}

export function buildApiSecurityHeaders(origin, env = {}) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Vary": "Origin"
  };
  if (origin && isAllowedApiOrigin(origin, env)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
