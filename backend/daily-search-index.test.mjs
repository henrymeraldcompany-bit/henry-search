import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" }
});

function database() {
  const rows = [];
  const runs = [];
  const retentionDeletes = [];
  return {
    rows,
    runs,
    retentionDeletes,
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) { this.values = values; return this; },
        async run() {
          if (sql.startsWith("DELETE FROM media_items") || sql.startsWith("DELETE FROM search_index_items")) {
            retentionDeletes.push({ table: sql.startsWith("DELETE FROM media_items") ? "media_items" : "search_index_items", cutoff: this.values[0], limit: this.values[1] });
          }
          if (sql.startsWith("INSERT INTO index_runs")) {
            runs.push({
              rowsProcessed: this.values[1],
              failureCount: this.values[2],
              note: this.values[3],
              stats: JSON.parse(this.values[4])
            });
          }
          return { success: true };
        },
        async all() {
          if (sql.includes("FROM search_index_items")) {
            const kind = this.values[0];
            return { results: rows.filter(row => row.kind === kind) };
          }
          return { results: [] };
        },
        async first() { return null; }
      };
      return statement;
    },
    async batch(statements) {
      for (const statement of statements) {
        const v = statement.values;
        rows.push({
          kind: v[0], canonical_url: v[1], title: v[2], url: v[3],
          domain: v[4], snippet: v[5], source: v[6], provider: v[7],
          sources_json: v[8], providers_json: v[9], published_at: v[10],
          indexed_at: v[11]
        });
      }
      return statements.map(() => ({ success: true }));
    }
  };
}

test("scheduled refresh stores webpage and news metadata separately from media rows", async () => {
  const db = database();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === "commons.wikimedia.org") return json({ query: { pages: {} } });
    if (url.hostname === "api.openverse.org") return json({ results: [] });
    if (url.hostname === "www.flickr.com") return json({ items: [] });
    if (["peertube.tv", "peer.tube", "spectra.video"].includes(url.hostname)) return json({ data: [] });
    if (url.hostname === "api.duckduckgo.com") return json({
      Heading: "Daily topic research",
      AbstractText: "A useful daily overview and background.",
      AbstractURL: "https://web-index.example/daily-topic"
    });
    if (url.hostname === "en.wikipedia.org") return json({ query: { search: [{
      pageid: 12, title: "Daily topic reference", snippet: "A reference page for the daily topic."
    }] } });
    if (url.hostname === "api.gdeltproject.org") return json({ articles: [{
      title: "Daily topic news report",
      url: "https://news-index.example/daily-report?utm_source=gdelt",
      domain: "news-index.example",
      seendate: "20261102T080000Z"
    }] });
    if (url.hostname === "news.google.com" || url.hostname === "www.bing.com") {
      const provider = url.hostname === "news.google.com" ? "google" : "bing";
      const xml = `<rss><channel><item><title>Daily topic news report</title><link>https://news-index.example/daily-report?utm_source=${provider}</link><source>news-index.example</source><pubDate>Mon, 02 Nov 2026 08:00:00 GMT</pubDate><description>Daily topic coverage from ${provider}.</description></item></channel></rss>`;
      return new Response(xml, { headers: { "content-type": "application/rss+xml" } });
    }
    throw new Error("Unexpected endpoint " + url.href);
  };
  try {
    let scheduledTask;
    worker.scheduled({}, { MEDIA_DB: db }, {
      waitUntil(promise) { scheduledTask = promise; }
    });
    assert.ok(scheduledTask);
    await scheduledTask;

    assert.equal(db.rows.filter(row => row.kind === "web").length, 2);
    assert.equal(db.rows.filter(row => row.kind === "news").length, 1);
    assert.ok(db.rows.every(row => row.canonical_url.startsWith("https://")));
    assert.equal(db.rows.find(row => row.kind === "news").canonical_url,
      "https://news-index.example/daily-report");
    assert.equal(db.runs.length, 1);
    assert.equal(db.runs[0].failureCount, 0);
    assert.equal(db.runs[0].stats.providers.DuckDuckGo.rowsSaved, 1);
    assert.equal(db.runs[0].stats.providers.Wikipedia.rowsSaved, 1);
    const savedNews = db.rows.find(row => row.kind === "news");
    assert.deepEqual(JSON.parse(savedNews.providers_json), [
      "GDELT news index", "Google News RSS", "Bing News RSS"
    ]);
    assert.equal(db.runs[0].stats.providers["GDELT news index"].rowsSaved, 1);
    assert.equal(db.runs[0].stats.providers["GDELT news index"].rowsContributed, 1);
    assert.equal(db.runs[0].stats.providers["Google News RSS"].rowsContributed, 1);
    assert.equal(db.runs[0].stats.providers["Bing News RSS"].rowsContributed, 1);
    assert.equal(db.runs[0].stats.rowsSaved, 3);
    assert.equal(db.runs[0].stats.rowsContributed, 5);
    assert.deepEqual(db.retentionDeletes.map(item => item.table), ["media_items", "search_index_items"]);
    assert.ok(db.retentionDeletes.every(item => Number.isFinite(Date.parse(item.cutoff))));
    assert.ok(db.retentionDeletes.every(item => item.limit === 500));

    const response = await worker.fetch(new Request(
      "https://media.example/index/search?kind=web&q=daily"
    ), { MEDIA_DB: db });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.kind, "web");
    assert.equal(payload.count, 2);
    assert.ok(payload.results.every(row => row.kind === "web"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
