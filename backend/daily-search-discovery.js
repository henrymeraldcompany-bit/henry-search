import { normalizeNewsArticleUrl } from "./news-url.js";
import {
  canonicalizeResultUrl,
  rankArticles,
  rankSearchResults,
  runSearchProviders
} from "./search-providers.js";

const DEFAULT_TIMEOUT_MS = 6000;
const MAX_RESULTS = 20;

export function createDailyRequestBudget(limit = 5) {
  const maximum = Math.max(0, Math.floor(Number(limit) || 0));
  let remaining = maximum;
  let used = 0;
  return {
    reserve() {
      if (remaining < 1) return false;
      remaining -= 1;
      used += 1;
      return true;
    },
    snapshot() {
      return { limit: maximum, used, remaining };
    }
  };
}

async function request(url, budget, accept, timeoutMs) {
  if (!budget || typeof budget.reserve !== "function" || !budget.reserve()) {
    throw new Error("Daily web/news discovery request budget exhausted");
  }
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "GOZIE-SEARCH/1.0 daily-metadata-index"
    },
    signal: AbortSignal.timeout(timeoutMs || DEFAULT_TIMEOUT_MS)
  });
  if (!response.ok) {
    const error = new Error("Provider HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  return response;
}

async function requestJson(url, budget, timeoutMs) {
  return (await request(url, budget, "application/json", timeoutMs)).json();
}

async function requestText(url, budget, timeoutMs) {
  return (await request(url, budget, "application/rss+xml, application/xml, text/xml", timeoutMs)).text();
}

function stripMarkup(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, function (_, digits) {
      const code = Number(digits);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([\da-f]+);/gi, function (_, digits) {
      const code = parseInt(digits, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function xmlTag(source, name) {
  const match = String(source || "").match(new RegExp(
    "<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">",
    "i"
  ));
  return match ? stripMarkup(match[1]) : "";
}

function normalizePublished(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(raw);
  const candidate = compact
    ? compact[1] + "-" + compact[2] + "-" + compact[3] + "T" +
      compact[4] + ":" + compact[5] + ":" + compact[6] + "Z"
    : raw;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function parseRss(xml, providerName) {
  const results = [];
  for (const match of String(xml || "").matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const title = xmlTag(item, "title");
    const url = normalizeNewsArticleUrl(xmlTag(item, "link"));
    const source = xmlTag(item, "source") || providerName;
    const published = normalizePublished(xmlTag(item, "pubDate"));
    const description = xmlTag(item, "description");
    if (!title || !canonicalizeResultUrl(url)) continue;
    results.push({
      title: title.slice(0, 250),
      url,
      snippet: [source, published, description].filter(Boolean).join(" · ").slice(0, 1200),
      source: source.slice(0, 160),
      published,
      provider: providerName
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

function normalizeNewsItems(items, providerName) {
  return (Array.isArray(items) ? items : []).map(function (item) {
    const url = normalizeNewsArticleUrl(item && (item.url || item.url_mobile) || "");
    const title = stripMarkup(item && (item.title || item.domain) || "News article");
    const domain = String(item && item.domain || "").trim();
    const published = normalizePublished(item && (item.seendate || item.published || item.publishedAt) || "");
    return {
      title: title.slice(0, 250),
      url,
      snippet: [domain, published].filter(Boolean).join(" · ").slice(0, 1200),
      source: domain || providerName,
      published,
      provider: providerName
    };
  }).filter(function (item) {
    return item.title.length >= 8 && !!canonicalizeResultUrl(item.url);
  }).slice(0, MAX_RESULTS);
}

export async function discoverDailyWeb(query, options = {}) {
  const budget = options.budget;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const providers = [
    {
      name: "DuckDuckGo",
      search: async function (searchQuery) {
        const endpoint = new URL("https://api.duckduckgo.com/");
        Object.entries({
          q: searchQuery,
          format: "json",
          no_html: "1",
          skip_disambig: "1"
        }).forEach(function (entry) { endpoint.searchParams.set(entry[0], entry[1]); });
        const data = await requestJson(endpoint.toString(), budget, timeoutMs);
        const results = [];
        if (data.AbstractText && data.AbstractURL) {
          results.push({
            title: data.Heading || searchQuery,
            url: data.AbstractURL,
            snippet: data.AbstractText,
            source: "DuckDuckGo"
          });
        }
        const walk = function (topics) {
          for (const item of topics || []) {
            if (item && item.FirstURL && item.Text) {
              results.push({
                title: String(item.Text).split(" - ")[0],
                url: item.FirstURL,
                snippet: item.Text,
                source: "DuckDuckGo"
              });
            }
            if (item && Array.isArray(item.Topics)) walk(item.Topics);
            if (results.length >= MAX_RESULTS) return;
          }
        };
        walk(data.RelatedTopics);
        return results.slice(0, MAX_RESULTS);
      }
    },
    {
      name: "Wikipedia",
      search: async function (searchQuery) {
        const endpoint = new URL("https://en.wikipedia.org/w/api.php");
        Object.entries({
          action: "query",
          list: "search",
          srsearch: searchQuery,
          srlimit: "8",
          srprop: "snippet",
          format: "json",
          origin: "*"
        }).forEach(function (entry) { endpoint.searchParams.set(entry[0], entry[1]); });
        const data = await requestJson(endpoint.toString(), budget, timeoutMs);
        return (data.query && Array.isArray(data.query.search) ? data.query.search : [])
          .map(function (page) {
            return {
              title: stripMarkup(page.title || searchQuery),
              url: "https://en.wikipedia.org/?curid=" + encodeURIComponent(page.pageid),
              snippet: stripMarkup(page.snippet || ""),
              source: "Wikipedia"
            };
          }).filter(function (item) { return !!canonicalizeResultUrl(item.url); });
      }
    }
  ];
  const outcome = await runSearchProviders(providers, String(query || "").trim());
  const ranked = rankSearchResults(outcome.results, query).slice(0,
    Math.min(MAX_RESULTS, Math.max(1, Number(options.maxResults) || MAX_RESULTS)));
  const attempts = providers.map(function (provider) {
    const failure = outcome.failures.find(function (item) { return item.provider === provider.name; });
    return {
      name: provider.name,
      ok: !failure,
      rowsReceived: outcome.results.filter(function (item) {
        return (item.providers || [item.provider]).includes(provider.name);
      }).length,
      error: failure && failure.message ? String(failure.message) : ""
    };
  });
  return {
    results: ranked,
    providers: outcome.providers,
    failures: outcome.failures,
    attempted: outcome.attempted,
    attempts
  };
}

export async function discoverDailyNews(query, options = {}) {
  const budget = options.budget;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const providers = [
    {
      name: "GDELT news index",
      search: async function (searchQuery) {
        const endpoint = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
        Object.entries({
          query: String(searchQuery || "").trim(),
          mode: "artlist",
          format: "json",
          maxrecords: String(MAX_RESULTS),
          sort: "datedesc"
        }).forEach(function (entry) { endpoint.searchParams.set(entry[0], entry[1]); });
        const data = await requestJson(endpoint.toString(), budget, timeoutMs);
        return normalizeNewsItems(data.articles, "GDELT news index");
      }
    },
    {
      name: "Google News RSS",
      search: async function (searchQuery) {
        const endpoint = new URL("https://news.google.com/rss/search");
        Object.entries({ q: searchQuery, hl: "en-NG", gl: "NG", ceid: "NG:en" })
          .forEach(function (entry) { endpoint.searchParams.set(entry[0], entry[1]); });
        return parseRss(await requestText(endpoint.toString(), budget, timeoutMs), "Google News RSS");
      }
    },
    {
      name: "Bing News RSS",
      search: async function (searchQuery) {
        const endpoint = new URL("https://www.bing.com/news/search");
        Object.entries({ q: searchQuery, format: "rss", setlang: "en-ng" })
          .forEach(function (entry) { endpoint.searchParams.set(entry[0], entry[1]); });
        return parseRss(await requestText(endpoint.toString(), budget, timeoutMs), "Bing News RSS");
      }
    }
  ];

  // Query every configured source independently. A provider outage must not
  // suppress healthy providers, and successful sources are combined rather
  // than using RSS only as a fallback when GDELT is empty.
  const settled = await Promise.allSettled(providers.map(function (provider) {
    return Promise.resolve().then(function () {
      return provider.search(String(query || "").trim());
    });
  }));
  const attempts = [];
  const errors = [];
  const merged = new Map();

  for (let index = 0; index < settled.length; index += 1) {
    const outcome = settled[index];
    const providerName = providers[index].name;
    if (outcome.status === "rejected") {
      const message = String(outcome.reason && outcome.reason.message || outcome.reason || "Provider request failed");
      attempts.push({ name: providerName, ok: false, rowsReceived: 0, error: message.slice(0, 240) });
      errors.push({ provider: providerName, error: message.slice(0, 240) });
      continue;
    }

    const rows = Array.isArray(outcome.value) ? outcome.value : [];
    attempts.push({ name: providerName, ok: true, rowsReceived: rows.length, error: "" });
    for (const row of rows) {
      const canonicalUrl = canonicalizeResultUrl(row && row.url);
      if (!canonicalUrl) continue;
      const incoming = {
        ...row,
        canonicalUrl,
        sources: [String(row.source || providerName)],
        providers: [providerName]
      };
      const existing = merged.get(canonicalUrl);
      if (!existing) {
        merged.set(canonicalUrl, incoming);
        continue;
      }
      existing.sources = [...new Set([...(existing.sources || []), ...incoming.sources])];
      existing.providers = [...new Set([...(existing.providers || []), ...incoming.providers])];
      if (String(incoming.snippet || "").length > String(existing.snippet || "").length) {
        existing.snippet = incoming.snippet;
      }
      if (!existing.published || (incoming.published && Date.parse(incoming.published) > Date.parse(existing.published))) {
        existing.published = incoming.published;
      }
      if (String(incoming.title || "").length > String(existing.title || "").length) {
        existing.title = incoming.title;
      }
    }
  }

  const maxResults = Math.min(MAX_RESULTS, Math.max(1, Number(options.maxResults) || MAX_RESULTS));
  const results = rankArticles(Array.from(merged.values()), query).slice(0, maxResults);
  return {
    results,
    providers: attempts.filter(function (attempt) { return attempt.ok; }).map(function (attempt) { return attempt.name; }),
    failures: errors,
    attempted: providers.length,
    attempts
  };
}
