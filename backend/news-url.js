/**
 * Replace Bing News tracking redirects with the HTTPS publisher URL.
 * Keep ordinary provider URLs unchanged; never follow or fetch the redirect here.
 */
export function normalizeNewsArticleUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "bing.com" && url.pathname.toLowerCase() === "/news/apiclick.aspx") {
      const destination = url.searchParams.get("url");
      if (!destination) return "";
      const target = new URL(destination);
      if (target.protocol !== "https:" || target.username || target.password) return "";
      return target.href;
    }
    return url.href;
  } catch {
    return "";
  }
}
