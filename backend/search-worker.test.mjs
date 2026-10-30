import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
const source = await readFile(new URL("./search-worker.js", import.meta.url), "utf8");
function extract(name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " must exist");
  const brace = source.indexOf("{", start);
  let depth = 0, quote = "", escaped = false;
  for (let i = brace; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'" || c === "\`") { quote = c; continue; }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("Could not extract " + name);
}
const helpers = ["safePublicUrl","robotsPathAllowed","decodeHtml","htmlAttribute","extractHtmlMetadata"].map(extract).join("\n");
const api = vm.runInNewContext("(function(){"+helpers+";return {safePublicUrl,robotsPathAllowed,extractHtmlMetadata};})()", {URL});
test("rejects local, private literal, credential and non-standard-port targets", () => {
  for (const value of ["http://localhost/page","http://127.0.0.1/","http://192.168.1.2/","http://service.local/","https://user:pass@example.com/","https://example.com:8443/"]) assert.equal(api.safePublicUrl(value), null);
  assert.equal(api.safePublicUrl("https://example.com/article").hostname, "example.com");
});
test("honors robots disallow and more-specific allow rules", () => {
  const url = new URL("https://example.com/private/open");
  assert.equal(api.robotsPathAllowed("User-agent: *\nDisallow: /private\nAllow: /private/open", url), true);
  assert.equal(api.robotsPathAllowed("User-agent: *\nDisallow: /private", new URL("https://example.com/private/secret")), false);
  assert.equal(api.robotsPathAllowed("User-agent: *\nDisallow: /admin", new URL("https://example.com/article")), true);
});
test("extracts readable metadata, article text and safe media references", () => {
  const html = '<html><head><title>Example Article</title><meta name="description" content="A useful summary"><meta property="og:image" content="/cover.jpg"><link rel="canonical" href="/story"></head><body><nav>Menu</nav><article><h1>Heading</h1><p>Useful article text &amp; facts.</p><script>secret()</script></article><footer>Footer noise</footer></body></html>';
  const result = api.extractHtmlMetadata(html, "https://example.com/story?ref=1");
  assert.equal(result.title, "Example Article");
  assert.equal(result.description, "A useful summary");
  assert.match(result.text, /Useful article text & facts/);
  assert.doesNotMatch(result.text, /secret|Footer noise|Menu/);
  assert.equal(result.canonical, "https://example.com/story");
  assert.equal(result.image, "https://example.com/cover.jpg");
});
test("does not accept cross-origin canonical URLs or unsafe image URLs", () => {
  const html = '<title>Safe title</title><meta property="og:image" content="javascript:alert(1)"><link rel="canonical" href="https://attacker.example/">';
  const result = api.extractHtmlMetadata(html, "https://example.com/a");
  assert.equal(result.canonical, "https://example.com/a");
  assert.equal(result.image, "");
});
