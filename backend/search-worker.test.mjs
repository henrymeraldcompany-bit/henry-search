import worker from "./search-worker.js";
import assert from "node:assert/strict";
import test from "node:test";
import { safePublicUrl, robotsPathAllowed, extractHtmlMetadata, extractReadableText, retrievePublicPage, extractPublicPage } from "./search-extract.js";

test("rejects local, private literal, credential and non-standard-port targets", () => {
  for (const value of ["http://localhost/page","http://127.0.0.1/","http://192.168.1.2/","http://service.local/","https://user:pass@example.com/","https://example.com:8443/"]) assert.equal(safePublicUrl(value), null);
  assert.equal(safePublicUrl("https://example.com/article").hostname, "example.com");
});
test("rejects trailing-dot local hosts, reserved DNS zones and common private-IP DNS aliases", () => {
  for (const value of [
    "http://localhost./",
    "http://service.local./",
    "http://metadata.google.internal./",
    "http://printer.home.arpa/",
    "http://host.example.test/",
    "http://host.example.invalid/",
    "http://169.254.169.254.nip.io/",
    "http://192.168.1.10.sslip.io/",
    "http://127.0.0.1.xip.io/",
    "http://127.0.0.1.localtest.me/",
    "http://0x7f000001/",
    "http://2130706433/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/"
  ]) assert.equal(safePublicUrl(value), null, value);
  const normalized = safePublicUrl("https://example.com./article");
  assert.equal(normalized.hostname, "example.com");
  assert.equal(normalized.href, "https://example.com/article");
});

test("blocks the GOZIE Search API host to prevent recursive page extraction", () => {
  assert.equal(
    safePublicUrl("https://henry-search-api.henrymeraldcompany.workers.dev/extract"),
    null
  );
});

test("rejects redirects to local or reserved destinations before fetching them", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requested.push(url.href);
    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\\nAllow: /", {
        status: 200, headers: { "content-type": "text/plain" }
      });
    }
    return new Response(null, {
      status: 302,
      headers: { location: "http://metadata.google.internal./latest/meta-data/" }
    });
  };
  try {
    const result = await retrievePublicPage("https://public.example/article");
    assert.equal(result.status, 502);
    assert.equal(requested.some(value => value.includes("metadata.google.internal")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails closed when robots.txt redirects instead of following an unverified robots destination", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requested.push(url.href);
    return new Response(null, {
      status: 302,
      headers: { location: "https://robots-redirect.example/robots.txt" }
    });
  };
  try {
    const result = await retrievePublicPage("https://public.example/article");
    assert.equal(result.status, 403);
    assert.equal(requested.length, 1);
    assert.equal(requested[0], "https://public.example/robots.txt");
  } finally {
    globalThis.fetch = originalFetch;
  }
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

import { canonicalizeResultUrl, runSearchProviders, rankSearchResults, scoreSearchResult, diversifySearchResults, filterSearchResults, rankArticles, deduplicateNewsStories, filterNewsByDate, diversifyNewsSources, summarizeNewsSourceDiversity } from "./search-providers.js";

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



test("news source diversity round-robins publishers while preserving relevance order within each source", () => {
 const ranked=[
  {title:"A1",source:"Publisher A",relevanceScore:20},
  {title:"A2",source:"Publisher A",relevanceScore:19},
  {title:"A3",source:"Publisher A",relevanceScore:18},
  {title:"B1",source:"Publisher B",relevanceScore:17},
  {title:"B2",source:"Publisher B",relevanceScore:16},
  {title:"C1",source:"Publisher C",relevanceScore:15}
 ];
 const diverse=diversifyNewsSources(ranked);
 assert.deepEqual(diverse.map(item=>item.title),["A1","B1","C1","A2","B2","A3"]);
 assert.deepEqual(diverse.filter(item=>item.source==="Publisher A").map(item=>item.title),["A1","A2","A3"]);
 assert.deepEqual(summarizeNewsSourceDiversity(diverse),{
  uniqueSources:3,
  distribution:{"Publisher A":3,"Publisher B":2,"Publisher C":1}
 });
});

test("news source diversity uses merged lead publisher and does not duplicate syndicated coverage", () => {
 const stories=[
  {title:"Shared story",source:"Publisher A",sources:["Publisher A","Publisher B","Publisher C"]},
  {title:"Other A story",source:"Publisher A",sources:["Publisher A"]},
  {title:"Publisher B exclusive",source:"Publisher B",sources:["Publisher B"]}
 ];
 const diverse=diversifyNewsSources(stories);
 assert.deepEqual(diverse.map(item=>item.title),["Shared story","Publisher B exclusive","Other A story"]);
 assert.deepEqual(diverse[0].sources,["Publisher A","Publisher B","Publisher C"]);
 assert.equal(diverse.length,3);
});

test("news publication-date filters support presets and inclusive UTC date ranges", () => {
 const now=Date.parse("2026-11-02T12:00:00.000Z");
 const articles=[
  {title:"Today",published:"2026-11-02T08:00:00.000Z"},
  {title:"Yesterday",published:"2026-11-01T08:00:00.000Z"},
  {title:"Last week",published:"2026-10-25T08:00:00.000Z"},
  {title:"Undated",published:""},
  {title:"Future",published:"2026-11-03T08:00:00.000Z"}
 ];
 assert.deepEqual(filterNewsByDate(articles,{date:"day"},now).results.map(x=>x.title),["Today"]);
 assert.deepEqual(filterNewsByDate(articles,{date:"week"},now).results.map(x=>x.title),["Today","Yesterday"]);
 assert.deepEqual(filterNewsByDate(articles,{date:"any",from:"2026-11-01",to:"2026-11-02"},now).results.map(x=>x.title),["Today","Yesterday"]);
 assert.equal(filterNewsByDate(articles,{date:"any"},now).results.length,5);
});

test("news publication-date filters reject invalid dates and reversed ranges", () => {
 assert.equal(filterNewsByDate([],{date:"decade"}).valid,false);
 assert.equal(filterNewsByDate([],{from:"2026-02-30"}).valid,false);
 assert.equal(filterNewsByDate([],{from:"2026-11-03",to:"2026-11-02"}).valid,false);
 assert.equal(filterNewsByDate([],{from:"2026-11-02"}).valid,true);
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


test("in-page reader returns a longer readable article excerpt with metadata", async () => {
  const originalFetch = globalThis.fetch;
  const longParagraph = "A useful article sentence. ".repeat(250);
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } });
    return new Response('<html lang="en"><head><title>Reader Article</title><meta name="author" content="Test Author"><meta property="og:site_name" content="Example Journal"><meta name="description" content="Reader summary"></head><body><nav>Do not include navigation</nav><article><h1>Reader Article</h1><p>' + longParagraph + '</p></article><footer>Do not include footer</footer></body></html>', { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  try {
    const result = await extractPublicPage("https://example.com/reader-story");
    assert.equal(result.status, 200);
    assert.equal(result.data.title, "Reader Article");
    assert.equal(result.data.author, "Test Author");
    assert.equal(result.data.siteName, "Example Journal");
    assert.ok(result.data.text.length > 800);
    assert.ok(result.data.text.length <= 12000);
    assert.doesNotMatch(result.data.text, /Do not include navigation|Do not include footer/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("ranks news articles by query relevance before quality and freshness", () => {
 const now=Date.parse("2026-10-30T12:00:00Z");
 const articles=[
  {title:"General world update from today",url:"https://news.example/general",snippet:"A detailed report with enough background and context to be useful to readers following world events and current affairs.",source:"News Desk",published:"2026-10-30T11:30:00Z"},
  {title:"Solar energy research reveals new battery breakthrough",url:"https://science.example/solar",snippet:"Researchers report a solar energy battery breakthrough with additional details, background, and context for readers.",source:"Science Journal",published:"2026-10-28T09:00:00Z"},
  {title:"Government policy update for clean power",url:"https://policy.example/solar",snippet:"Solar energy policy coverage.",source:"Policy News",published:"2026-10-29T09:00:00Z"},
  {title:"News",url:"https://junk.example/home",snippet:"",source:""}
 ];
 const ranked=rankArticles(articles,"solar energy",now);
 assert.equal(ranked.length,3);
 assert.equal(ranked[0].url,"https://science.example/solar");
 assert.ok(ranked[0].relevanceScore>ranked[1].relevanceScore);
 assert.ok(ranked.every(item=>Number.isFinite(item.qualityScore)));
});
test("article ranking removes invalid URLs, placeholder headlines and duplicate URLs", () => {
 const ranked=rankArticles([
  {title:"A meaningful article headline",url:"https://example.com/story?utm_source=one",snippet:"A useful article summary."},
  {title:"A meaningful article headline",url:"https://example.com/story#top",snippet:"A much longer article summary that adds useful context for the same report."},
  {title:"Breaking News",url:"https://example.com/breaking"},
  {title:"No URL article title",url:"javascript:alert(1)"}
 ],"article");
 assert.equal(ranked.length,1);
 assert.match(ranked[0].snippet,/much longer/);
});


test("news route integrates search and publisher feeds, merging duplicates and filtering unrelated headlines", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  const publisherHosts = {
    "feeds.bbci.co.uk": "BBC Publisher",
    "www.aljazeera.com": "Al Jazeera Publisher",
    "www.theguardian.com": "Guardian Publisher",
    "feeds.npr.org": "NPR Publisher"
  };
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requested.push(url.hostname);
    if (url.hostname === "api.gdeltproject.org") {
      return new Response(JSON.stringify({ articles: [{
        title: "Solar energy research breakthrough reported by science journal",
        url: "https://publisher.example/story?utm_source=gdelt",
        domain: "publisher.example",
        seendate: "20261102T080000Z"
      }] }), { headers: { "content-type": "application/json" } });
    }
    let provider, publisher;
    if (url.hostname === "news.google.com") {
      provider = "Google News RSS"; publisher = "Publisher Google";
    } else if (url.hostname === "www.bing.com") {
      provider = "Bing News RSS"; publisher = "Publisher Bing";
    } else {
      provider = Object.keys(publisherHosts).includes(url.hostname) ? publisherHosts[url.hostname] : "Publisher";
      publisher = provider;
    }
    const story = "<item><title>Solar energy research breakthrough reported by science journal</title><link>https://publisher.example/story?utm_source=" + encodeURIComponent(provider.toLowerCase()) + "</link><source>" + publisher + "</source><pubDate>Mon, 02 Nov 2026 09:00:00 GMT</pubDate><description>Additional reporting details about solar energy research.</description></item>";
    const unrelated = url.hostname === "feeds.bbci.co.uk"
      ? "<item><title>Unrelated football transfer update from local league</title><link>https://sports.example/transfer</link><description>Sports transfer coverage.</description></item>"
      : "";
    return new Response("<rss><channel>" + story + unrelated + "</channel></rss>", {
      headers: { "content-type": "application/rss+xml" }
    });
  };
  try {
    const response = await worker.fetch(new Request("https://search.example/news?q=solar%20energy"));
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.deepEqual(requested.sort(), [
      "api.gdeltproject.org", "feeds.bbci.co.uk", "feeds.npr.org",
      "news.google.com", "www.aljazeera.com", "www.bing.com", "www.theguardian.com"
    ]);
    assert.equal(payload.attemptedProviders, 7);
    assert.equal(payload.results.length, 1);
    assert.deepEqual(payload.results[0].providers, [
      "GDELT", "Google News RSS", "Bing News RSS",
      "BBC News World", "Al Jazeera English", "The Guardian World", "NPR News"
    ]);
    assert.ok(payload.results[0].sources.includes("Publisher Google"));
    assert.ok(payload.results[0].sources.includes("Publisher Bing"));
    assert.ok(payload.results[0].sources.includes("BBC Publisher"));
    assert.equal(payload.results[0].published, "2026-11-02T09:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("news results expose bounded preview metadata and preserve original publisher links", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === "api.gdeltproject.org") {
      return new Response(JSON.stringify({ articles: [{
        title: "Solar energy research breakthrough reported by science journal",
        url: "https://publisher.example/story?utm_source=gdelt",
        domain: "publisher.example",
        seendate: "20261102T080000Z"
      }] }), { headers: { "content-type": "application/json" } });
    }
    if (url.hostname === "news.google.com") {
      return new Response("<rss><channel><item><title>Solar energy research breakthrough reported by science journal</title><link>https://publisher.example/story?utm_source=google</link><source>Publisher Google</source><pubDate>Mon, 02 Nov 2026 09:00:00 GMT</pubDate><description>A useful preview about solar energy research.</description></item></channel></rss>");
    }
    if (url.hostname === "www.bing.com" || ["feeds.bbci.co.uk","www.aljazeera.com","www.theguardian.com","feeds.npr.org"].includes(url.hostname)) {
      return new Response("<rss><channel></channel></rss>");
    }
    throw new Error("Unexpected endpoint " + url.href);
  };
  try {
    const response = await worker.fetch(new Request("https://search.example/news?q=solar%20energy"));
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    const article = payload.results[0];
    assert.equal(article.originalUrl, article.url);
    assert.equal(article.preview.url, article.url);
    assert.equal(article.preview.publisher, "publisher.example");
    assert.ok(article.preview.summary.length <= 1200);
    assert.equal(article.preview.published, article.published);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("news route keeps healthy provider results when another live provider fails", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  const publisherHosts = ["feeds.bbci.co.uk", "www.aljazeera.com", "www.theguardian.com", "feeds.npr.org"];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requested.push(url.hostname);
    if (url.hostname === "api.gdeltproject.org") return new Response("temporarily unavailable", { status: 503 });
    if (url.hostname === "news.google.com") {
      return new Response("<rss><channel><item><title>Technology policy report explains major research changes</title><link>https://news.example/technology-policy</link><source>Example News</source><pubDate>Mon, 02 Nov 2026 08:00:00 GMT</pubDate><description>A detailed report about technology policy and research.</description></item></channel></rss>", {
        headers: { "content-type": "application/rss+xml" }
      });
    }
    if (url.hostname === "www.bing.com" || publisherHosts.includes(url.hostname)) {
      return new Response("<rss><channel></channel></rss>");
    }
    throw new Error("Unexpected endpoint " + url.href);
  };
  try {
    const response = await worker.fetch(new Request("https://search.example/news?q=technology%20policy"));
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.deepEqual(requested.sort(), [
      "api.gdeltproject.org", "feeds.bbci.co.uk", "feeds.npr.org",
      "news.google.com", "www.aljazeera.com", "www.bing.com", "www.theguardian.com"
    ]);
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].url, "https://news.example/technology-policy");
    assert.deepEqual(payload.providers, [
      "Google News RSS", "Bing News RSS", "BBC News World",
      "Al Jazeera English", "The Guardian World", "NPR News"
    ]);
    assert.equal(payload.failedProviders.length, 1);
    assert.equal(payload.failedProviders[0].provider, "GDELT");
    assert.equal(requested.some(value => value.includes("index/search")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("news route falls back to the daily indexed news when live providers are unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  const publisherHosts = ["feeds.bbci.co.uk", "www.aljazeera.com", "www.theguardian.com", "feeds.npr.org"];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requested.push(url.href);
    if (url.hostname === "api.gdeltproject.org" || url.hostname === "news.google.com") {
      return new Response("temporarily unavailable", { status: 503 });
    }
    if (url.hostname === "www.bing.com" || publisherHosts.includes(url.hostname)) {
      return new Response("<rss><channel></channel></rss>", {
        headers: { "content-type": "application/rss+xml" }
      });
    }
    if (url.hostname === "gozie-search-media.henrymeraldcompany.workers.dev") {
      return new Response(JSON.stringify({
        kind: "news",
        query: "technology",
        count: 1,
        results: [{
          title: "Technology policy report",
          url: "https://news.example/technology-policy",
          domain: "news.example",
          snippet: "A recent report about technology policy.",
          source: "news.example",
          published_at: "2026-11-02T07:00:00.000Z",
          indexed_at: "2026-11-02T08:00:00.000Z"
        }]
      }), { headers: { "content-type": "application/json" } });
    }
    throw new Error("Unexpected endpoint " + url.href);
  };
  try {
    const response = await worker.fetch(
      new Request("https://search.example/news?q=technology")
    );
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.source, "GOZIE daily news index");
    assert.equal(payload.fallback, "daily-index");
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].url, "https://news.example/technology-policy");
    assert.ok(requested.some(value => value.includes("/index/search?kind=news")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("news ranking normalizes headline whitespace and rejects repeated-character placeholders", () => {
 const ranked=rankArticles([
  {title:"Solar   energy   research   breakthrough",url:"https://science.example/solar",snippet:"A useful report about solar energy research."},
  {title:"xxxxxxxxxxxxxxxx",url:"https://junk.example/repeated",snippet:"Solar energy"},
  {title:"   ",url:"https://junk.example/blank",snippet:"Solar energy"}
 ],"solar energy");
 assert.equal(ranked.length,1);
 assert.equal(ranked[0].title,"Solar energy research breakthrough");
 assert.ok(ranked[0].relevanceScore>0);
});


test("detects syndicated duplicate news stories across different URLs and preserves coverage", () => {
 const stories=deduplicateNewsStories([
  {title:"Central bank cuts interest rates as inflation slows",url:"https://publisher-a.example/economy/story",snippet:"Short report.",source:"Publisher A",provider:"Feed A",published:"2026-11-02T08:00:00Z"},
  {title:"Central bank cuts interest rates as inflation slows today",url:"https://publisher-b.example/news/interest-rates",snippet:"A longer report with additional context about the central bank decision.",source:"Publisher B",provider:"Feed B",published:"2026-11-02T09:00:00Z"},
  {title:"Central bank announces new digital currency rules",url:"https://publisher-c.example/finance/digital-currency",snippet:"A separate central bank story.",source:"Publisher C",provider:"Feed C"}
 ]);
 assert.equal(stories.length,2);
 assert.equal(stories[0].title,"Central bank cuts interest rates as inflation slows today");
 assert.match(stories[0].snippet,/additional context/);
 assert.deepEqual(stories[0].sources,["Publisher A","Publisher B"]);
 assert.deepEqual(stories[0].providers,["Feed A","Feed B"]);
 assert.deepEqual(stories[0].alternateUrls,["https://publisher-b.example/news/interest-rates"]);
 assert.equal(stories[0].published,"2026-11-02T09:00:00Z");
});

test("keeps different stories separate when headlines only share a broad topic", () => {
 const stories=deduplicateNewsStories([
  {title:"President announces new education funding programme",url:"https://one.example/policy"},
  {title:"President announces new security funding programme",url:"https://two.example/policy"},
  {title:"Local football club wins national championship final",url:"https://three.example/sport"}
 ]);
 assert.equal(stories.length,3);
});

test("news ranking applies cross-publisher story deduplication", () => {
 const ranked=rankArticles([
  {title:"Scientists discover new battery material for electric vehicles",url:"https://science-a.example/battery",snippet:"Initial report.",source:"Science A"},
  {title:"Scientists discover new battery material for electric vehicles today",url:"https://science-b.example/research",snippet:"A more complete report on the battery material discovery.",source:"Science B"},
  {title:"Scientists publish separate research on battery recycling methods",url:"https://science-c.example/recycling",snippet:"A different research story about recycling."}
 ],"battery material");
 assert.equal(ranked.length,2);
 assert.deepEqual(ranked[0].sources,["Science A","Science B"]);
 assert.equal(ranked[0].alternateUrls.length,1);
});

import { buildApiSecurityHeaders, isAllowedApiOrigin } from "./api-security.js";

test("API CORS allows only the production frontend and explicitly configured origins", () => {
  assert.equal(isAllowedApiOrigin("https://henrymeraldcompany-bit.github.io"), true);
  assert.equal(isAllowedApiOrigin("https://evil.example"), false);
  assert.equal(isAllowedApiOrigin("null"), false);
  assert.equal(isAllowedApiOrigin("https://henrymeraldcompany-bit.github.io.attacker.example"), false);
  assert.equal(isAllowedApiOrigin("https://preview.example", { ALLOWED_ORIGINS: "https://preview.example,https://other.example" }), true);
  assert.equal(isAllowedApiOrigin("http://192.168.1.5"), false);
  assert.equal(isAllowedApiOrigin("http://localhost:5173"), false);
});

test("API security headers are present without granting wildcard browser access", () => {
  const allowed = buildApiSecurityHeaders("https://henrymeraldcompany-bit.github.io");
  assert.equal(allowed["Access-Control-Allow-Origin"], "https://henrymeraldcompany-bit.github.io");
  assert.equal(allowed["X-Content-Type-Options"], "nosniff");
  assert.equal(allowed["X-Frame-Options"], "DENY");
  assert.equal(allowed["Referrer-Policy"], "no-referrer");
  assert.match(allowed["Strict-Transport-Security"], /max-age=31536000/);
  assert.equal(allowed.Vary, "Origin");
  const denied = buildApiSecurityHeaders("https://attacker.example");
  assert.equal(denied["Access-Control-Allow-Origin"], undefined);
  assert.equal(denied["Access-Control-Allow-Methods"], "GET, OPTIONS");
});

import { validateApiRequest } from "./api-validation.js";

test("validates supported API routes, required queries and route-specific parameters", () => {
  assert.equal(validateApiRequest(new URL("https://api.example/search?q=solar")).valid, true);
  assert.equal(validateApiRequest(new URL("https://api.example/images?q=cats")).valid, true);
  assert.equal(validateApiRequest(new URL("https://api.example/news?q=technology&date=week")).valid, true);
  assert.equal(validateApiRequest(new URL("https://api.example/extract?url=https%3A%2F%2Fexample.com%2Fstory")).valid, true);
  assert.equal(validateApiRequest(new URL("https://api.example/search")).valid, false);
  assert.equal(validateApiRequest(new URL("https://api.example/search?q=solar&unexpected=1")).valid, false);
});

test("rejects duplicate parameters, control characters and oversized search queries", () => {
  assert.equal(validateApiRequest(new URL("https://api.example/search?q=one&q=two")).valid, false);
  assert.equal(validateApiRequest(new URL("https://api.example/search?q=solar%00energy")).valid, false);
  assert.equal(validateApiRequest(new URL("https://api.example/search?q=" + "x".repeat(301))).valid, false);
  assert.equal(validateApiRequest(new URL("https://api.example/search?q=%20solar")).valid, false);
});

test("validates web search filters and news date ranges", () => {
  assert.equal(validateApiRequest(new URL("https://api.example/search?q=solar&domain=example.com&date=month")).valid, true);
  assert.equal(validateApiRequest(new URL("https://api.example/search?q=solar&domain=bad_domain")).valid, false);
  assert.equal(validateApiRequest(new URL("https://api.example/search?q=solar&date=forever")).valid, false);
  assert.equal(validateApiRequest(new URL("https://api.example/news?q=world&from=2026-02-30")).valid, false);
  assert.equal(validateApiRequest(new URL("https://api.example/news?q=world&from=2026-11-03&to=2026-11-02")).valid, false);
});

test("validates webpage URL input before extraction", () => {
  assert.equal(validateApiRequest(new URL("https://api.example/extract?url=javascript%3Aalert(1)")).valid, false);
  assert.equal(validateApiRequest(new URL("https://api.example/extract?url=https%3A%2F%2Fuser%3Apass%40example.com")).valid, false);
  assert.equal(validateApiRequest(new URL("https://api.example/extract?url=https%3A%2F%2Fexample.com%2F%2500")).valid, true);
});
