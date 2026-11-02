const GENERAL_LIMIT = 120;
const GENERAL_PERIOD = 60;
const EXTRACT_LIMIT = 12;
const EXTRACT_PERIOD = 60;

/**
 * Enforce approximate Cloudflare edge limits for the public, unauthenticated API.
 * Cloudflare supplies cf-connecting-ip at the edge; client-supplied forwarding
 * headers are deliberately ignored because they can be spoofed.
 *
 * The native binding is location-scoped and eventually consistent. It is a
 * lightweight abuse guard, not a strict global quota or identity system.
 */
export async function checkApiRateLimit(request, env = {}, pathname = "") {
  const general = env.API_RATE_LIMITER;
  const extraction = env.API_EXTRACT_RATE_LIMITER;
  const configured = Boolean(
    general && typeof general.limit === "function" &&
    extraction && typeof extraction.limit === "function"
  );

  if (!general || typeof general.limit !== "function") {
    return { allowed: true, configured: false, scope: null };
  }

  const address = String(request.headers.get("cf-connecting-ip") || "unknown")
    .trim()
    .slice(0, 64) || "unknown";
  const key = "client:" + address;

  try {
    const generalResult = await general.limit({ key });
    if (!generalResult || generalResult.success !== true) {
      return {
        allowed: false,
        configured,
        scope: "api",
        limit: GENERAL_LIMIT,
        period: GENERAL_PERIOD
      };
    }

    if (pathname === "/extract") {
      if (!extraction || typeof extraction.limit !== "function") {
        return { allowed: true, configured: false, scope: null };
      }
      const extractionResult = await extraction.limit({ key });
      if (!extractionResult || extractionResult.success !== true) {
        return {
          allowed: false,
          configured: true,
          scope: "extract",
          limit: EXTRACT_LIMIT,
          period: EXTRACT_PERIOD
        };
      }
    }

    return { allowed: true, configured, scope: null };
  } catch {
    // Do not turn a Cloudflare rate-limit service hiccup into a full API outage.
    // Production smoke tests verify both bindings are present and active.
    return { allowed: true, configured: false, scope: null, error: true };
  }
}

export const API_RATE_LIMIT_POLICY = Object.freeze({
  general: { limit: GENERAL_LIMIT, period: GENERAL_PERIOD },
  extract: { limit: EXTRACT_LIMIT, period: EXTRACT_PERIOD }
});
