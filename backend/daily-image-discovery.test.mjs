import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.js";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function makeDatabase() {
  const rows = [];
  const runs = [];
  const statements = [];
  return {
    rows, runs, statements,
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) { this.values = values; return this; },
        async run() {
          if (sql.startsWith("INSERT INTO index_runs")) {
            runs.push({
              finishedAt: this.values[0],
              rowsProcessed: this.values[1],
              failureCount: this.values[2],
              note: this.values[3],
              stats: JSON.parse(this.values[4])
            });
          }
          return { success: true };
        },
        async first() { return null; },
        async all() { return { results: [] }; }
      };
      statements.push(statement);
      return statement;
    },
    async batch(batch) {
      for (const statement of batch) rows.push(statement.values);
      return batch.map(() => ({ success: true }));
    }
  };
}

function imageProviderResponse(url) {
  const query = url.searchParams.get("gsrsearch") ||
    url.searchParams.get("q") || url.searchParams.get("tags") || "daily";
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (url.hostname === "commons.wikimedia.org") {
    return jsonResponse({ query: { pages: {
      [slug]: {
        pageid: slug,
        title: "File:Commons " + query + ".jpg",
        imageinfo: [{
          descriptionurl: "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(slug),
          url: "https://upload.wikimedia.org/images/" + slug + ".jpg",
          thumburl: "https://upload.wikimedia.org/thumbs/" + slug + ".jpg",
          extmetadata: {
            ObjectName: { value: "Commons " + query },
            Artist: { value: "Test creator" },
            LicenseShortName: { value: "CC BY-SA" },
            ImageWidth: { value: "1200" },
            ImageHeight: { value: "800" },
            MimeType: { value: "image/jpeg" }
          }
        }]
      }
    } } });
  }
  if (url.hostname === "api.openverse.org") {
    return jsonResponse({ results: [{
      id: slug,
      title: "Openverse " + query,
      foreign_landing_url: "https://openverse.example/" + slug,
      url: "https://openverse.example/media/" + slug + ".jpg",
      thumbnail: "https://openverse.example/thumb/" + slug + ".jpg",
      creator: "Openverse creator",
      license: "by",
      license_version: "4.0",
      width: 1000,
      height: 700,
      mime_type: "image/jpeg"
    }] });
  }
  if (url.hostname === "api.duckduckgo.com") return jsonResponse({});
  if (url.hostname === "en.wikipedia.org") return jsonResponse({ query: { search: [] } });
  if (url.hostname === "api.gdeltproject.org") return jsonResponse({ articles: [{
    title: "Daily news discovery fixture report",
    url: "https://news-fixture.example/daily-report",
    domain: "news-fixture.example",
    seendate: "20261102T080000Z"
  }] });
  if (url.hostname === "www.flickr.com") {
    return jsonResponse({ items: [{
      title: "Flickr " + query,
      link: "https://www.flickr.com/photos/daily/" + slug,
      media: { m: "https://live.staticflickr.com/" + slug + ".jpg" },
      author: "Flickr creator",
      published: "2026-11-01T07:00:00Z",
      tags: query
    }] });
  }
  if (["peertube.tv", "peer.tube", "spectra.video"].includes(url.hostname)) {
    return jsonResponse({ data: [] });
  }
  throw new Error("Unexpected discovery endpoint: " + url.href);
}

async function runScheduledIndex(fetchImpl) {
  const database = makeDatabase();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    let scheduledTask;
    worker.scheduled({}, { MEDIA_DB: database }, {
      waitUntil(promise) { scheduledTask = promise; }
    });
    assert.ok(scheduledTask, "scheduled handler must register the refresh task");
    await scheduledTask;
    return database;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("daily scheduled refresh discovers and stores images from all three image providers", async () => {
  const requestedHosts = [];
  const database = await runScheduledIndex(async input => {
    const url = new URL(input);
    requestedHosts.push(url.hostname);
    return imageProviderResponse(url);
  });

  const images = database.rows.filter(row => row[0] === "image");
  assert.equal(images.length, 18, "six daily seeds should save three image results each");
  assert.equal(database.rows.some(row => row[0] === "video"), false,
    "empty video fixtures must not create video rows");
  for (const host of ["commons.wikimedia.org", "api.openverse.org", "www.flickr.com"]) {
    assert.equal(requestedHosts.filter(value => value === host).length, 6,
      host + " should be queried once for each daily seed");
  }
  assert.equal(database.runs.length, 1);
  assert.equal(database.runs[0].rowsProcessed, 19);
  assert.equal(database.runs[0].stats.seedsProcessed, 6);
  assert.equal(database.runs[0].stats.providers["Wikimedia Commons"].rowsSaved, 6);
  assert.equal(database.runs[0].stats.providers.Openverse.rowsSaved, 6);
  assert.equal(database.runs[0].stats.providers["Flickr public feed"].rowsSaved, 6);
});

test("a failing daily image provider is isolated while other providers continue indexing", async () => {
  const requestedHosts = [];
  const database = await runScheduledIndex(async input => {
    const url = new URL(input);
    requestedHosts.push(url.hostname);
    if (url.hostname === "api.openverse.org") return jsonResponse({ error: "temporarily unavailable" }, 503);
    return imageProviderResponse(url);
  });

  const images = database.rows.filter(row => row[0] === "image");
  assert.equal(images.length, 12, "Wikimedia and Flickr should still save six images each");
  assert.equal(requestedHosts.filter(value => value === "api.openverse.org").length, 5,
    "Openverse should be disabled after two logical failures, with three bounded retries globally");
  assert.equal(database.runs.length, 1);
  assert.equal(database.runs[0].stats.providers.Openverse.failed, 2);
  assert.equal(database.runs[0].stats.providers["Wikimedia Commons"].rowsSaved, 6);
  assert.equal(database.runs[0].stats.providers["Flickr public feed"].rowsSaved, 6);
  assert.ok(database.runs[0].stats.disabledProviders.includes("Openverse"));
  assert.match(database.runs[0].note, /Openverse: Provider HTTP 503/);
});
