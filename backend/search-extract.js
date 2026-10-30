export function safePublicUrl(value, base) {
  try {
    const url = base ? new URL(value, base) : new URL(value);
    const host = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) return null;
    if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") ||
        host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".onion") ||
        host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return null;
    return url;
  } catch { return null; }
}
export function robotsPathAllowed(robotsText, url) {
  const groups = [];
  let group = { agents: [], rules: [] };
  for (const raw of String(robotsText || "").split(/\r?\n/)) {
    const line = raw.split("#", 1)[0].trim();
    if (!line || !line.includes(":")) continue;
    const at = line.indexOf(":");
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (key === "user-agent") {
      if (group.rules.length) { groups.push(group); group = { agents: [], rules: [] }; }
      group.agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && group.agents.length && value) {
      group.rules.push({ allow: key === "allow", path: value });
    }
  }
  if (group.agents.length) groups.push(group);
  const specific = groups.filter(g => g.agents.some(a => a !== "*" && "gozie-searchbot".includes(a)));
  const selected = specific.length ? specific : groups.filter(g => g.agents.includes("*"));
  const target = url.pathname + url.search;
  let best = null;
  for (const g of selected) for (const rule of g.rules) {
    const plain = rule.path.replace(/\*.*$/, "");
    const matches = rule.path.includes("*") ? target.startsWith(plain) : target.startsWith(rule.path);
    if (matches && (!best || rule.path.length > best.path.length ||
        (rule.path.length === best.path.length && rule.allow))) best = rule;
  }
  return !best || best.allow;
}
function decodeHtml(value) {
  const decodeCodePoint = number => Number.isInteger(number) && number >= 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
    ? String.fromCodePoint(number) : "\uFFFD";
  return String(value || "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => decodeCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => decodeCodePoint(parseInt(n, 16)));
}

/** Extract readable text while discarding executable, hidden and non-content HTML. */
export function extractReadableText(html, maxLength = 800) {
  let content = String(html || "").slice(0, 1048576)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|iframe|object|embed|nav|footer|header|aside|form|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<([a-z][\w:-]*)\b(?=[^>]*(?:\shidden(?:\s|=|>)|\saria-hidden\s*=\s*["']?true|\sstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)))[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const mainMatch = content.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i);
  const articleMatch = content.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i);
  if (mainMatch) content = mainMatch[1];
  else if (articleMatch) content = articleMatch[1];
  content = content.replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|main|blockquote|tr)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  const limit = Number.isFinite(Number(maxLength)) ? Math.max(0, Math.min(20000, Number(maxLength))) : 800;
  return decodeHtml(content).replace(/[\t\f\v ]+/g, " ").replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, limit);
}
function htmlAttribute(tagText, name) {
  const attrs = String(tagText).matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g);
  for (const match of attrs) {
    if (match[1].toLowerCase() === name.toLowerCase()) return decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return "";
}
export function extractHtmlMetadata(html, pageUrl) {
  const meta = (key) => {
    const tags = String(html).match(/<meta\b[^>]*>/gi) || [];
    for (const tagText of tags) {
      if (htmlAttribute(tagText, "name").toLowerCase() === key.toLowerCase() ||
          htmlAttribute(tagText, "property").toLowerCase() === key.toLowerCase()) return htmlAttribute(tagText, "content");
    }
    return "";
  };
  const titleMatch = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = decodeHtml((titleMatch?.[1] || meta("og:title")).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 300);
  const description = (meta("description") || meta("og:description") || meta("twitter:description")).slice(0, 300);
  const published = meta("article:published_time") || meta("date") || meta("pubdate") || "";
  const imageCandidate = meta("og:image") || meta("twitter:image") || "";
  const imageUrl = imageCandidate ? safePublicUrl(imageCandidate, pageUrl) : null;
  const linkTags = String(html).match(/<link\b[^>]*>/gi) || [];
  const canonicalTag = linkTags.find(tag => htmlAttribute(tag, "rel").toLowerCase().split(/\s+/).includes("canonical")) || "";
  const canonicalCandidate = htmlAttribute(canonicalTag, "href");
  const canonicalUrl = canonicalCandidate ? safePublicUrl(canonicalCandidate, pageUrl) : null;
  const readableText = extractReadableText(html, 800);
  return {
    title: title || new URL(pageUrl).hostname,
    description: decodeHtml(description).replace(/\s+/g, " ").trim(),
    text: readableText,
    canonical: canonicalUrl && canonicalUrl.hostname === new URL(pageUrl).hostname ? canonicalUrl.href : pageUrl,
    image: imageUrl ? imageUrl.href : "",
    published: published.slice(0, 80)
  };
}
export async function readTextLimited(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new Error("Page exceeds the 1 MB extraction limit."); }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8").decode(merged);
}
export async function robotsAllows(url) {
  try {
    const response = await fetch(new URL("/robots.txt", url.origin).href, {
      headers: { "Accept": "text/plain", "User-Agent": "GOZIE-SearchBot/1.0" },
      redirect: "error", signal: AbortSignal.timeout(5000)
    });
    if (response.status === 404) return true;
    if (!response.ok) return false;
    return robotsPathAllowed(await readTextLimited(response, 65536), url);
  } catch { return false; }
}
export async function retrievePublicPage(input) {
  let current = safePublicUrl(input);
  if (!current) return { status: 400, data: { error: "Enter a public HTTP or HTTPS webpage URL. Local/private literal IPs, credential-bearing URLs and non-standard ports are not supported." } };
  for (let hop = 0; hop <= 3; hop++) {
    if (!await robotsAllows(current)) return { status: 403, data: { error: "This website blocks GOZIE SearchBot, or its robots policy could not be checked." } };
    let response;
    try {
      response = await fetch(current.href, {
        headers: { "Accept": "text/html,application/xhtml+xml;q=0.9", "User-Agent": "GOZIE-SearchBot/1.0" },
        redirect: "manual", signal: AbortSignal.timeout(9000)
      });
    } catch { return { status: 502, data: { error: "The source website could not be reached." } }; }
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      const next = location ? safePublicUrl(location, current.href) : null;
      if (!next) return { status: 502, data: { error: "The source returned an unsupported redirect." } };
      current = next;
      continue;
    }
    if (!response.ok) return { status: response.status === 429 ? 429 : 502, data: { error: "The source website returned HTTP " + response.status + "." } };
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return { status: 415, data: { error: "This source is not an HTML webpage." } };
    if (Number(response.headers.get("content-length") || 0) > 1048576) return { status: 413, data: { error: "This webpage exceeds the 1 MB retrieval limit." } };
    try {
      const html = await readTextLimited(response, 1048576);
      return { status: 200, data: { url: current.href, html, contentType: type } };
    } catch (error) { return { status: 413, data: { error: error.message || "Could not read this webpage." } }; }
  }
  return { status: 508, data: { error: "The source exceeded the redirect limit." } };
}

export async function extractPublicPage(input) {
  const retrieved = await retrievePublicPage(input);
  if (retrieved.status !== 200) return retrieved;
  const { url, html } = retrieved.data;
  const extracted = extractHtmlMetadata(html, url);
  if (!extracted.text && !extracted.description) return { status: 422, data: { error: "No readable page text was found." } };
  return { status: 200, data: { source: new URL(url).hostname, url, ...extracted, extractedAt: new Date().toISOString(), method: "public-page-fetch" } };
}