import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const workerSource = await readFile(new URL("./worker.js", import.meta.url), "utf8");
const embedHostDeclaration = source.match(/const PEERTUBE_EMBED_HOSTS = new Set\(\[[^\]]*\]\);/);
assert.ok(embedHostDeclaration, "PEERTUBE_EMBED_HOSTS must exist in app.js");
function extract(name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " must exist in app.js");
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1, "Could not find end of " + name);
  return source.slice(start, end + 2);
}
const helpers = [
  extract("normalizeMediaText"),
  extract("queryWords"),
  extract("mediaRelevanceScore"),
  extract("rankMediaResults"),
  extract("resolveSafeHttpUrl"),
  extract("canonicalizeMediaResultUrl"),
  extract("getYouTubeVideoId"),
  embedHostDeclaration[0],
  extract("getPlayableEmbedUrl"),
  extract("stopActiveVideoPlayer"),
  extract("toggleActiveVideoPlayer"),
].join("\n");
const api = vm.runInNewContext(
  "(function(){ " + helpers + "; return {canonicalizeMediaResultUrl, getPlayableEmbedUrl, rankMediaResults, PEERTUBE_EMBED_HOSTS, stopActiveVideoPlayer, toggleActiveVideoPlayer}; })()",
  {
    URL,
    MEDIA_STOP_WORDS: new Set([
      "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
      "how", "i", "in", "is", "it", "of", "on", "or", "the", "to", "with",
      "what", "when", "where", "who", "why", "you", "your"
    ]),
    createVideoPlayer: (video) => video?.unplayable ? null : ({ video })
  }
);

test("deduplicates YouTube watch, short, and embed URLs", () => {
  const keys = [
    api.canonicalizeMediaResultUrl("https://youtu.be/abc123?t=30"),
    api.canonicalizeMediaResultUrl("https://www.youtube.com/watch?v=abc123&si=tracking"),
    api.canonicalizeMediaResultUrl("https://www.youtube-nocookie.com/embed/abc123"),
  ];
  assert.equal(new Set(keys).size, 1);
});

test("removes common tracking parameters, fragments, and www aliases", () => {
  assert.equal(
    api.canonicalizeMediaResultUrl("https://www.example.org/media?id=7&utm_source=test#preview"),
    api.canonicalizeMediaResultUrl("https://example.org/media?id=7")
  );
});

test("keeps the best-matching frontend duplicate instead of the first URL variant", () => {
  const results = api.rankMediaResults([
    {url:"https://example.org/video?id=1", title:"Football highlights"},
    {url:"https://www.example.org/video?id=1&utm_source=feed", title:"Science documentary about stars"}
  ], "science", ["title"], ["description"], ["url"]);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Science documentary about stars");
});

test("rejects non-HTTP media links", () => {
  assert.equal(api.canonicalizeMediaResultUrl("javascript:alert(1)"), "");
  assert.equal(api.canonicalizeMediaResultUrl("data:text/html,hello"), "");
});

test("preserves case-sensitive paths", () => {
  assert.notEqual(
    api.canonicalizeMediaResultUrl("https://example.org/Video/ABC"),
    api.canonicalizeMediaResultUrl("https://example.org/video/abc")
  );
});

test("allows same-origin PeerTube embeds and matching YouTube embeds", () => {
  assert.equal(
    api.getPlayableEmbedUrl({
      url: "https://videos.example/videos/watch/abc",
      embedUrl: "https://videos.example/videos/embed/abc"
    }),
    "https://videos.example/videos/embed/abc"
  );
  assert.equal(
    api.getPlayableEmbedUrl({
      url: "https://www.youtube.com/watch?v=abc123",
      embedUrl: "https://www.youtube-nocookie.com/embed/abc123"
    }),
    "https://www.youtube-nocookie.com/embed/abc123"
  );
});

test("allows only the canonical same-origin PeerTube player path", () => {
  const watch = "https://videos.example/videos/watch/abc";
  assert.equal(
    api.getPlayableEmbedUrl({
      url: watch,
      embedUrl: "https://videos.example/videos/embed/abc"
    }),
    "https://videos.example/videos/embed/abc"
  );
  assert.equal(
    api.getPlayableEmbedUrl({
      url: watch,
      embedUrl: "https://videos.example/videos/embed/abc?start=30"
    }),
    "https://videos.example/videos/embed/abc?start=30"
  );

  for (const embedUrl of [
    "https://videos.example/videos/watch/abc",
    "https://videos.example/about",
    "https://videos.example/videos/embed/",
    "https://videos.example/videos/embed/abc/extra",
    "https://videos.example.evil.test/videos/embed/abc",
    "https://user:pass@videos.example/videos/embed/abc"
  ]) {
    assert.equal(
      api.getPlayableEmbedUrl({ url: watch, embedUrl }),
      null,
      embedUrl
    );
  }
});

test("rejects mismatched and cross-origin embeds, using a safe YouTube fallback when possible", () => {
  assert.equal(
    api.getPlayableEmbedUrl({
      url: "https://www.youtube.com/watch?v=abc123",
      embedUrl: "https://www.youtube.com/embed/other456"
    }),
    "https://www.youtube-nocookie.com/embed/abc123"
  );
  assert.equal(
    api.getPlayableEmbedUrl({
      url: "https://videos.example/watch/abc",
      embedUrl: "https://untrusted.example/embed/abc"
    }),
    null
  );
});


test("allows canonical cross-origin PeerTube embeds only from configured search instances", () => {
  const watchUrl = "https://remote-instance.example/videos/watch/original-id";
  for (const host of api.PEERTUBE_EMBED_HOSTS) {
    assert.equal(
      api.getPlayableEmbedUrl({
        url: watchUrl,
        embedUrl: `https://${host}/videos/embed/provider-player-id`
      }),
      `https://${host}/videos/embed/provider-player-id`
    );
  }
});

test("rejects untrusted, insecure, credential-bearing, and custom-port PeerTube embeds", () => {
  const watchUrl = "https://remote-instance.example/videos/watch/original-id";
  for (const embedUrl of [
    "https://untrusted.example/videos/embed/player-id",
    "http://peertube.tv/videos/embed/player-id",
    "https://peertube.tv:8443/videos/embed/player-id",
    "https://user:pass@peertube.tv/videos/embed/player-id",
    "https://peertube.tv/videos/watch/player-id"
  ]) {
    assert.equal(
      api.getPlayableEmbedUrl({ url: watchUrl, embedUrl }),
      null,
      embedUrl
    );
  }
});

test("keeps the PeerTube embed allowlist aligned with the backend search instances", () => {
  const primary = workerSource.match(/const PEERTUBE = "([^"]+)";/);
  const instances = workerSource.match(/const PEERTUBE_INSTANCES = \[([\s\S]*?)\];/);
  assert.ok(primary, "backend PEERTUBE base must exist");
  assert.ok(instances, "backend PEERTUBE_INSTANCES must exist");
  const configuredHosts = [
    new URL(primary[1]).hostname.replace(/^www\./, ""),
    ...Array.from(instances[1].matchAll(/"https:\/\/([^"]+)"/g), match => match[1])
  ].sort();
  assert.deepEqual([...api.PEERTUBE_EMBED_HOSTS].sort(), configuredHosts);
});


test("keeps only one inline player active and lets the current player stop", () => {
  const makeTarget = () => ({
    children: [],
    replaceChildren(...children) { this.children = children; }
  });
  const makeButton = () => ({
    textContent: "Play here",
    disabled: false,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  });
  const state = { target: null, button: null };
  const firstTarget = makeTarget();
  const firstButton = makeButton();
  const secondTarget = makeTarget();
  const secondButton = makeButton();

  assert.equal(api.toggleActiveVideoPlayer({ title: "First video" }, firstTarget, firstButton, state), true);
  assert.equal(firstTarget.children.length, 1);
  assert.equal(firstButton.textContent, "Stop playback");
  assert.equal(firstButton.attributes["aria-pressed"], "true");

  assert.equal(api.toggleActiveVideoPlayer({ title: "Second video" }, secondTarget, secondButton, state), true);
  assert.equal(firstTarget.children.length, 0);
  assert.equal(firstButton.textContent, "Play here");
  assert.equal(firstButton.attributes["aria-pressed"], "false");
  assert.equal(secondTarget.children.length, 1);
  assert.equal(secondButton.textContent, "Stop playback");

  assert.equal(api.toggleActiveVideoPlayer({ title: "Second video" }, secondTarget, secondButton, state), false);
  assert.equal(secondTarget.children.length, 0);
  assert.equal(secondButton.textContent, "Play here");
  assert.equal(secondButton.attributes["aria-pressed"], "false");
  assert.equal(state.target, null);
  assert.equal(state.button, null);
});

test("stopping filters removes the active iframe and resets its control", () => {
  const target = { children: [], replaceChildren(...children) { this.children = children; } };
  const button = {
    textContent: "Play here",
    disabled: false,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const state = { target: null, button: null };
  assert.equal(api.toggleActiveVideoPlayer({ title: "Video" }, target, button, state), true);
  assert.equal(api.stopActiveVideoPlayer(state), true);
  assert.equal(target.children.length, 0);
  assert.equal(button.textContent, "Play here");
  assert.equal(button.attributes["aria-pressed"], "false");
  assert.equal(api.stopActiveVideoPlayer(state), false);
});

test("an unavailable player does not interrupt the currently active player", () => {
  const activeTarget = { children: [], replaceChildren(...children) { this.children = children; } };
  const activeButton = {
    textContent: "Play here",
    disabled: false,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const unavailableTarget = { children: [], replaceChildren(...children) { this.children = children; } };
  const unavailableButton = {
    textContent: "Playback unavailable here",
    disabled: true,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const state = { target: null, button: null };
  assert.equal(api.toggleActiveVideoPlayer({ title: "Active" }, activeTarget, activeButton, state), true);
  assert.equal(api.toggleActiveVideoPlayer({ title: "Unavailable", unplayable: true }, unavailableTarget, unavailableButton, state), false);
  assert.equal(state.target, activeTarget);
  assert.equal(activeTarget.children.length, 1);
});
