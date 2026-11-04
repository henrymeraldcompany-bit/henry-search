// Small, low-volume diagnostics for Cloudflare Worker request paths.
// Never record query strings, request bodies, cookies, authorization headers,
// client IP addresses, or provider URLs.
export function createRequestDiagnostic(request, service) {
  const route = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  const ray = String(request.headers.get("cf-ray") || "").trim();
  const requestId = ray.slice(0, 80) || crypto.randomUUID();
  return {
    requestId,
    service: String(service || "gozie-worker").slice(0, 48),
    method: String(request.method || "GET").slice(0, 10),
    route: route.slice(0, 100),
    startedAt: Date.now()
  };
}

export function recordRequestDiagnostic(context, status, error) {
  if (!context || typeof context !== "object") return;
  const durationMs = Math.max(0, Date.now() - Number(context.startedAt || Date.now()));
  const code = Number(status) || 0;
  // Avoid log-volume growth: record failures and unusually slow requests only.
  if (code < 500 && durationMs < 1500) return;
  const event = {
    event: "http-request-diagnostic",
    service: String(context.service || "gozie-worker").slice(0, 48),
    requestId: String(context.requestId || "").slice(0, 80),
    method: String(context.method || "GET").slice(0, 10),
    route: String(context.route || "/").slice(0, 100),
    status: code,
    durationMs,
    outcome: code >= 500 ? "error" : "slow"
  };
  if (error) event.errorName = String(error.name || "Error").slice(0, 48);
  const line = JSON.stringify(event);
  if (code >= 500) console.error(line);
  else console.warn(line);
}
