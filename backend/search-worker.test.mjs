import assert from "node:assert/strict";
import test from "node:test";
import { safePublicUrl, robotsPathAllowed, extractHtmlMetadata } from "./search-extract.js";

test("rejects local, private literal, credential and non-standard-port targets", () => {
  for (const value of ["http://localhost/page","http://127.0.0.1/","http://192.168.1.2/","http://service.local/","https://user:pass@example.com/","https://example.com:8443/"]) assert.equal(safePublicUrl(value), null);
  assert.equal(safePublicUrl("https://example.com/article").hostname, "example.com");
});
test("honors robots disallow and more-specific allow rules", () => {
  assert.equal(robotsPathAllowed("User-agent: *\nDisallow: /private\nAllow: /private/open", new URL("https://example.com/private/open")), true);
  assert.equal(robotsPathAllowed("User-agent: *\nDisallow: /private", new URL("https://example.com/private/secret")), false);
  assert.equal(robotsPathAllowed("User-agent: *\nDisallow: /admin", new URL("https://example.com/article")), true);
});
test("extracts readable metadata, article text and safe media references", () => {
  const html = '<html><head><title>Example Article</title><meta name="description" content="A useful summary"><meta property="og:image" content="/cover.jpg"><link rel="canonical" href="/story"></head><body><nav>Menu</nav><article><h1>Heading</h1><p>Useful article text &amp; facts.</p><script>secret()</script></article><footer>Footer noise</footer></body></html>';
  const result = extractHtmlMetadata(html, "https://example.com/story?ref=1");
  assert.equal(result.title, "Example Article"); assert.equal(result.description, "A useful summary");
  assert.match(result.text, /Useful article text & facts/); assert.doesNotMatch(result.text, /secret|Footer noise|Menu/);
  assert.equal(result.canonical, "https://example.com/story"); assert.equal(result.image, "https://example.com/cover.jpg");
});
test("rejects cross-origin canonical URLs and unsafe image URLs", () => {
  const result = extractHtmlMetadata('<title>Safe</title><meta property="og:image" content="javascript:alert(1)"><link rel="canonical" href="https://attacker.example/">', "https://example.com/a");
  assert.equal(result.canonical, "https://example.com/a"); assert.equal(result.image, "");
});
