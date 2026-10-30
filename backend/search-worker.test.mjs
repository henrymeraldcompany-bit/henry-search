import assert from "node:assert/strict";
import test from "node:test";
import { safePublicUrl, robotsPathAllowed, extractHtmlMetadata, extractReadableText, retrievePublicPage } from "./search-extract.js";

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
test("extracts extended webpage metadata with safe relative icon and language", () => {
  const html = '<html lang="en-NG"><head><meta name="author" content="Ada Writer"><meta property="og:site_name" content="Example News"><meta property="og:type" content="article"><meta name="keywords" content="science, technology; research"><meta property="article:published_time" content="2026-10-29T10:00:00Z"><meta property="article:modified_time" content="2026-10-30T08:00:00Z"><meta name="twitter:title" content="Social title"><link rel="icon" href="/favicon.ico"></head><body><p>Article body</p></body></html>';
  const result = extractHtmlMetadata(html, "https://example.com/story");
  assert.equal(result.title, "Social title");
  assert.equal(result.author, "Ada Writer");
  assert.equal(result.siteName, "Example News");
  assert.equal(result.type, "article");
  assert.equal(result.language, "en-NG");
  assert.deepEqual(result.keywords, ["science", "technology", "research"]);
  assert.equal(result.published, "2026-10-29T10:00:00Z");
  assert.equal(result.modified, "2026-10-30T08:00:00Z");
  assert.equal(result.icon, "https://example.com/favicon.ico");
  assert.match(result.text, /Article body/);
});

test("uses safe metadata fallbacks and bounds metadata values", () => {
  const long = "x".repeat(700);
  const result = extractHtmlMetadata('<meta name="description" content="' + long + '"><meta name="author" content="Writer"><link rel="icon" href="javascript:alert(1)">', "https://example.com/page");
  assert.equal(result.title, "example.com");
  assert.equal(result.description.length, 500);
  assert.equal(result.author, "Writer");
  assert.equal(result.icon, "");
  assert.deepEqual(result.keywords, []);
});

test("rejects cross-origin canonical URLs and unsafe image URLs", () => {
  const result = extractHtmlMetadata('<title>Safe</title><meta property="og:image" content="javascript:alert(1)"><link rel="canonical" href="https://attacker.example/">', "https://example.com/a");
  assert.equal(result.canonical, "https://example.com/a"); assert.equal(result.image, "");
});

import { canonicalizeResultUrl, runSearchProviders, rankSearchResults, scoreSearchResult, diversifySearchResults, filterSearchResults } from "./search-providers.js";

test("canonicalizes equivalent URLs and removes common tracking parameters", () => {
  assert.equal(
    canonicalizeResultUrl("https://Example.com/story/?utm_source=news#section"),
    "https://example.com/story"
  );
  assert.equal(
    canonicalizeResultUrl("https://example.com/story?fbclid=abc"),
    "https://example.com/story"
  );
  assert.equal(canonicalizeResultUrl("javascript:alert(1)"), null);
  assert.equal(canonicalizeResultUrl("https://user:pass@example.com/"), null);
});

test("queries providers independently and preserves results when one provider fails", async () => {
  const result = await runSearchProviders([
    {
      name: "Provider A",
      search: async () => [
        { title: "First result", url: "https://example.com/first?utm_medium=test", snippet: "A useful summary" },
        { title: "Duplicate", url: "https://example.com/shared#top" }
      ]
    },
    {
      name: "Provider B",
      search: async () => [
        { title: "Same page from another provider", url: "https://example.com/shared?fbclid=123" },
        { title: "Second result", url: "https://another.example/article" }
      ]
    },
    {
      name: "Unavailable",
      search: async () => { throw new Error("temporary outage"); }
    }
  ], "test query");

  assert.deepEqual(result.providers, ["Provider A", "Provider B"]);
  assert.equal(result.attempted, 3);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].provider, "Unavailable");
  assert.equal(result.results.length, 3);
  assert.deepEqual(result.results.map(item => item.title), [
    "First result", "Second result", "Duplicate"
  ]);
  assert.equal(result.results[0].provider, "Provider A");
  assert.equal(result.results[0].originalUrl, "https://example.com/first?utm_medium=test");
});

test("drops malformed provider results and rejects unsafe result URLs", async () => {
  const result = await runSearchProviders([{
    name: "Test provider",
    search: async () => [
      { title: "Unsafe", url: "javascript:alert(1)" },
      { title: "", url: "https://example.com/no-title" },
      null,
      { title: "Valid", url: "https://example.com/valid" }
    ]
  }], "test");

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].title, "Valid");
});


test("ranks query matches in titles above snippet-only matches", () => {
  const ranked = rankSearchResults([
    { title: "General guide", snippet: "Information about solar energy" },
    { title: "Solar energy guide", snippet: "Panels and power" },
    { title: "Another page", snippet: "Unrelated topic" }
  ], "solar energy");
  assert.equal(ranked[0].title, "Solar energy guide");
  assert.ok(ranked[0].relevanceScore > ranked[1].relevanceScore);
  assert.equal(ranked[2].relevanceScore, 0);
});

test("ranking is stable for ties and handles empty or stop-word-only queries", () => {
  const items = [{ title: "Alpha", snippet: "same" }, { title: "Beta", snippet: "same" }];
  assert.deepEqual(rankSearchResults(items, "unmatched").map(x => x.title), ["Alpha", "Beta"]);
  assert.equal(scoreSearchResult(items[0], "the and of"), 0);
  assert.equal(rankSearchResults(null, "query").length, 0);
});


test("merges duplicate canonical URLs while retaining the richer result metadata", async () => {
  const result = await runSearchProviders([
    { name: "Provider A", search: async () => [
      { title: "Original title", url: "https://example.com/story?utm_source=a", snippet: "Short summary", source: "Publisher A" }
    ] },
    { name: "Provider B", search: async () => [
      { title: "Alternate title", url: "https://www.example.com/story#section", snippet: "A much longer and more useful summary of the same article.", source: "Publisher B", published: "2026-10-30" }
    ] }
  ], "story");

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].title, "Original title");
  assert.match(result.results[0].snippet, /much longer/);
  assert.equal(result.results[0].published, "2026-10-30");
  assert.deepEqual(result.results[0].sources, ["Publisher A", "Publisher B"]);
  assert.deepEqual(result.results[0].providers, ["Provider A", "Provider B"]);
});


test("diversifies domains without dropping results or changing within-domain order", () => {
  const input = [
    { title: "A1", domain: "alpha.example" },
    { title: "A2", domain: "alpha.example" },
    { title: "A3", domain: "alpha.example" },
    { title: "B1", domain: "beta.example" },
    { title: "C1", domain: "charlie.example" },
    { title: "B2", domain: "beta.example" }
  ];
  const output = diversifySearchResults(input);
  assert.deepEqual(output.map(item => item.title), ["A1", "B1", "C1", "A2", "B2", "A3"]);
  assert.equal(output.length, input.length);
  assert.deepEqual(output.filter(item => item.domain === "alpha.example").map(item => item.title), ["A1", "A2", "A3"]);
});

test("provider results are interleaved across domains while retaining every result", async () => {
  const result = await runSearchProviders([{
    name: "Provider A",
    search: async () => [
      { title: "A1", url: "https://alpha.example/1" },
      { title: "A2", url: "https://alpha.example/2" },
      { title: "A3", url: "https://alpha.example/3" },
      { title: "B1", url: "https://beta.example/1" }
    ]
  }], "query");
  assert.deepEqual(result.results.map(item => item.title), ["A1", "B1", "A2", "A3"]);
});

test('filters web results by domain and publisher, including combined filters', () => {
 const items=[{domain:'alpha.example',source:'Publisher A',sources:['Publisher A']},{domain:'beta.example',source:'Publisher B',sources:['Publisher B']},{domain:'alpha.example',source:'Publisher C',sources:['Publisher C']}];
 assert.equal(filterSearchResults(items,{domain:'alpha.example'}).length,2);
 assert.equal(filterSearchResults(items,{source:'Publisher B'})[0].domain,'beta.example');
 assert.equal(filterSearchResults(items,{domain:'alpha.example',source:'Publisher C'}).length,1);
});
test('date filtering excludes unknown and future dates but any-time preserves all results', () => {
 const now=Date.parse('2026-10-30T12:00:00Z');
 const items=[{published:'2026-10-30T11:00:00Z'},{published:'2026-10-20T12:00:00Z'},{published:''},{published:'invalid'},{published:'2026-10-31T12:00:00Z'}];
 assert.equal(filterSearchResults(items,{date:'day'},now).length,1);
 assert.equal(filterSearchResults(items,{date:'month'},now).length,2);
 assert.equal(filterSearchResults(items,{date:'any'},now).length,5);
 assert.equal(filterSearchResults(items,{date:'invalid'},now).length,0);
});


test("retrieves public HTML through the reusable page retrieval engine", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requested.push(url.href);
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } });
    if (url.pathname === "/start") return new Response(null, { status: 302, headers: { location: "/article" } });
    return new Response("<html><body><article><p>Retrieved article body.</p></article></body></html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  try {
    const result = await retrievePublicPage("https://example.com/start");
    assert.equal(result.status, 200);
    assert.equal(result.data.url, "https://example.com/article");
    assert.match(result.data.html, /Retrieved article body/);
    assert.ok(result.data.contentType.includes("text/html"));
    assert.ok(requested.includes("https://example.com/robots.txt"));
    assert.ok(requested.includes("https://example.com/article"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retrieval engine rejects non-HTML responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } });
    return new Response("not a webpage", { status: 200, headers: { "content-type": "application/pdf" } });
  };
  try {
    const result = await retrievePublicPage("https://example.com/file");
    assert.equal(result.status, 415);
    assert.match(result.data.error, /not an HTML webpage/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("extracts readable text while excluding scripts, navigation and hidden content", () => {
  const html = '<html><body><nav>Navigation noise</nav><main><h1>Useful heading</h1><p>Readable &amp; safe text.</p><script>doNotRun()</script><div hidden>Hidden text</div><section aria-hidden="true">Screen-reader-hidden content</section><div style="display:none">Invisible text</div></main><footer>Footer noise</footer></body></html>';
  const text = extractReadableText(html, 500);
  assert.match(text, /Useful heading/);
  assert.match(text, /Readable & safe text/);
  assert.doesNotMatch(text, /Navigation noise|doNotRun|Hidden text|Screen-reader-hidden|Invisible text|Footer noise/);
});

test("limits extracted text and safely handles invalid numeric HTML entities", () => {
  const text = extractReadableText('<article><p>Alpha &#x110000; Beta &#99999999; Gamma</p></article>', 12);
  assert.ok(text.length <= 12);
  assert.match(extractReadableText('<p>Safe &#x110000; text</p>'), /Safe/);
});
