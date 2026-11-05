import assert from "node:assert/strict";
import test from "node:test";
import {
  createDailyRequestBudget,
  discoverDailyNews,
  discoverDailyWeb
} from "./daily-search-discovery.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" }
});

test("daily web discovery merges safe DuckDuckGo and Wikipedia metadata", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requested.push(url.hostname);
    if (url.hostname === "api.duckduckgo.com") {
      return json({
        Heading: "Solar energy",
        AbstractText: "A useful overview of solar energy research.",
        AbstractURL: "https://energy.example/solar",
        RelatedTopics: [{
          Text: "Solar panels - An introduction",
          FirstURL: "https://energy.example/panels"
        }]
      });
    }
    if (url.hostname === "en.wikipedia.org") {
      return json({ query: { search: [{
        pageid: 42,
        title: "Solar power",
        snippet: "Solar power is the conversion of energy from sunlight."
      }] } });
    }
    throw new Error("Unexpected endpoint " + url.href);
  };
  try {
    const budget = createDailyRequestBudget(5);
    const result = await discoverDailyWeb("solar energy", { budget });
    assert.equal(result.attempted, 2);
    assert.deepEqual(result.providers, ["DuckDuckGo", "Wikipedia"]);
    assert.ok(result.results.length >= 2);
    assert.ok(result.results.every(item => item.canonicalUrl.startsWith("https://")));
    assert.deepEqual(requested.sort(), ["api.duckduckgo.com", "en.wikipedia.org"]);
    assert.equal(budget.snapshot().used, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("daily web discovery isolates one provider failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === "api.duckduckgo.com") return json({ error: "temporarily unavailable" }, 503);
    if (url.hostname === "en.wikipedia.org") {
      return json({ query: { search: [{
        pageid: 7, title: "Renewable energy research",
        snippet: "Research into renewable energy technologies."
      }] } });
    }
    throw new Error("Unexpected endpoint " + url.href);
  };
  try {
    const result = await discoverDailyWeb("renewable energy", {
      budget: createDailyRequestBudget(5)
    });
    assert.equal(result.results.length, 1);
    assert.deepEqual(result.providers, ["Wikipedia"]);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].provider, "DuckDuckGo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("daily news discovery queries all providers and normalizes GDELT publication dates", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requested.push(url.hostname);
    if (url.hostname === "api.gdeltproject.org") {
      return json({ articles: [{
        title: "New solar energy research breakthrough announced",
        url: "https://science.example/solar-breakthrough?utm_source=gdelt",
        domain: "science.example",
        seendate: "20261102T080000Z"
      }] });
    }
    if (url.hostname === "news.google.com" || url.hostname === "www.bing.com") {
      return new Response("<rss><channel></channel></rss>");
    }
    throw new Error("Unexpected endpoint " + url.href);
  };
  try {
    const budget = createDailyRequestBudget(5);
    const result = await discoverDailyNews("solar energy", { budget });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].published, "2026-11-02T08:00:00.000Z");
    assert.equal(result.results[0].canonicalUrl, "https://science.example/solar-breakthrough");
    assert.deepEqual(result.attempts.map(item => item.name), [
      "GDELT news index", "Google News RSS", "Bing News RSS"
    ]);
    assert.ok(result.attempts.every(item => item.ok));
    assert.deepEqual(requested.sort(), [
      "api.gdeltproject.org", "news.google.com", "www.bing.com"
    ]);
    assert.equal(budget.snapshot().used, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("news discovery keeps successful providers when another source fails", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    requested.push(url.hostname);
    if (url.hostname === "api.gdeltproject.org") return json({ error: "unavailable" }, 503);
    if (url.hostname === "news.google.com") {
      return new Response("<rss><channel><item><title>Google feed solar research report</title><link>https://publisher.example/google-story</link><source>Publisher One</source><pubDate>Mon, 02 Nov 2026 08:00:00 GMT</pubDate><description>Detailed solar research coverage.</description></item></channel></rss>", { status: 503 });
    }
    if (url.hostname === "www.bing.com") {
      return new Response("<rss><channel><item><title>Bing feed solar technology research update</title><link>https://publisher.example/bing-story</link><source>Bing Publisher</source><pubDate>Mon, 02 Nov 2026 09:00:00 GMT</pubDate><description>More solar research coverage.</description></item></channel></rss>");
    }
    throw new Error("Unexpected endpoint " + url.href);
  };
  try {
    const budget = createDailyRequestBudget(5);
    const result = await discoverDailyNews("solar research", { budget });
    assert.equal(result.results.length, 1);
    assert.match(result.results[0].title, /Bing feed/);
    assert.deepEqual(requested.sort(), [
      "api.gdeltproject.org", "news.google.com", "www.bing.com"
    ]);
    assert.deepEqual(result.attempts.map(item => item.ok), [false, false, true]);
    assert.equal(result.failures.length, 2);
    assert.equal(budget.snapshot().used, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("news discovery merges duplicate articles and retains every provider attribution", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === "api.gdeltproject.org") {
      return json({ articles: [{
        title: "Solar research breakthrough reported by science journal",
        url: "https://publisher.example/story?utm_source=gdelt",
        domain: "publisher.example",
        seendate: "20261102T080000Z"
      }] });
    }
    const provider = url.hostname === "news.google.com" ? "Google" : "Bing";
    return new Response("<rss><channel><item><title>Solar research breakthrough reported by science journal</title><link>https://publisher.example/story?utm_source=" + provider.toLowerCase() + "</link><source>Publisher " + provider + "</source><pubDate>Mon, 02 Nov 2026 09:00:00 GMT</pubDate><description>Additional reporting details about the solar research breakthrough.</description></item></channel></rss>");
  };
  try {
    const result = await discoverDailyNews("solar research", {
      budget: createDailyRequestBudget(5)
    });
    assert.equal(result.results.length, 1);
    assert.deepEqual(result.results[0].providers, [
      "GDELT news index", "Google News RSS", "Bing News RSS"
    ]);
    assert.ok(result.results[0].sources.includes("Publisher Google"));
    assert.ok(result.results[0].sources.includes("Publisher Bing"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("daily web and multi-source news discovery cannot exceed its five-request allocation", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return json({});
  };
  try {
    const budget = createDailyRequestBudget(5);
    await discoverDailyWeb("science", { budget });
    await discoverDailyNews("science", { budget });
    assert.ok(requests <= 5);
    assert.equal(budget.snapshot().used, 5);
    assert.equal(budget.snapshot().remaining, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("daily news discovery unwraps Bing News tracking redirects to publisher URLs", async () => {
  const originalFetch = globalThis.fetch;
  const target = "https://news.example/education-report";
  const wrapped = "http://www.bing.com/news/apiclick.aspx?ref=FexRss&url=" +
    encodeURIComponent(target) + "&c=123";
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === "api.gdeltproject.org") return json({ articles: [] });
    if (url.hostname === "news.google.com") return new Response("<rss><channel></channel></rss>");
    if (url.hostname === "www.bing.com") {
      return new Response("<rss><channel><item><title>Education policy research report</title><link>" +
        wrapped + "</link><source>Education Publisher</source><description>Education research coverage.</description></item></channel></rss>");
    }
    throw new Error("Unexpected endpoint " + url.href);
  };
  try {
    const result = await discoverDailyNews("education policy", {
      budget: createDailyRequestBudget(5)
    });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].url, target);
    assert.equal(result.results[0].canonicalUrl, target);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
