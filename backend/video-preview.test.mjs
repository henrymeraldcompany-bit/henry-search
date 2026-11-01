import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../style.css", import.meta.url), "utf8");
const start = source.indexOf("function createVideoPreviewIndicator(");
assert.notEqual(start, -1, "createVideoPreviewIndicator must exist");
const end = source.indexOf("\n}", start);
assert.notEqual(end, -1, "preview indicator helper must close");
const helper = source.slice(start, end + 2);
const document = {
  createElement(tag) {
    return {
      tagName: tag.toUpperCase(),
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; }
    };
  }
};
const api = vm.runInNewContext(
  "(function(){ " + helper + "; return createVideoPreviewIndicator; })()",
  { document }
);

test("playable video thumbnails receive a visible preview indicator", () => {
  const indicator = api(true);
  assert.equal(indicator.className, "video-preview-indicator");
  assert.equal(indicator.textContent, "▶ Preview here");
  assert.equal(indicator.attributes["aria-hidden"], "true");
});

test("videos without permitted in-page playback are labelled as original-site links", () => {
  const indicator = api(false);
  assert.equal(indicator.textContent, "↗ Open original source");
  assert.equal(indicator.className, "video-preview-indicator");
});

test("missing video thumbnails use a clear fallback label", () => {
  const placeholderStart = source.indexOf("function createVideoThumbnailPlaceholder(");
  assert.notEqual(placeholderStart, -1, "createVideoThumbnailPlaceholder must exist");
  const placeholderEnd = source.indexOf("\n}", placeholderStart);
  assert.notEqual(placeholderEnd, -1, "thumbnail placeholder helper must close");
  const placeholderHelper = source.slice(placeholderStart, placeholderEnd + 2);
  const createPlaceholder = vm.runInNewContext(
    "(function(){ " + placeholderHelper + "; return createVideoThumbnailPlaceholder; })()",
    { document }
  );
  const placeholder = createPlaceholder();
  assert.equal(placeholder.className, "video-thumb-placeholder");
  assert.equal(placeholder.textContent, "No thumbnail available");
  assert.match(source, /thumbnailButton\.appendChild\(createVideoThumbnailPlaceholder\(\)\)/);
});

test("video result cards attach the preview cue after the thumbnail content", () => {
  assert.match(source, /thumbnailButton\.appendChild\(createVideoPreviewIndicator\(!!playableEmbedUrl\)\)/);
  assert.match(source, /image\.loading = "lazy"/);
  assert.match(source, /image\.decoding = "async"/);
});

test("preview indicator remains readable over thumbnails and keyboard focus is visible", () => {
  assert.match(css, /\.video-preview-indicator\s*\{/);
  assert.match(css, /background:\s*rgba\(5,\s*12,\s*20,\s*\.86\)/);
  assert.match(css, /\.video-thumb-button:focus-visible\s*\{/);
});


function extractFunction(name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " must exist in app.js");
  const end = source.indexOf("\\n}", start);
  assert.notEqual(end, -1, "Could not find end of " + name);
  return source.slice(start, end + 2);
}

function makePlayerHarness() {
  const document = {
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        attributes: {},
        children: [],
        setAttribute(name, value) { this.attributes[name] = value; },
        appendChild(child) { this.children.push(child); },
        replaceChildren(...children) { this.children = children; }
      };
    }
  };
  const helpers = [
    'const PEERTUBE_EMBED_HOSTS = new Set(["peertube.tv", "peer.tube", "spectra.video"]);',
    extractFunction("resolveSafeHttpUrl"),
    extractFunction("isApplicationOriginUrl"),
    extractFunction("getYouTubeVideoId"),
    extractFunction("getPlayableEmbedUrl"),
    extractFunction("createVideoPlayer"),
    extractFunction("stopActiveVideoPlayer"),
    extractFunction("toggleActiveVideoPlayer")
  ].join("\\n");
  const api = vm.runInNewContext(
    "(function(){ " + helpers + "; return {getPlayableEmbedUrl,createVideoPlayer,stopActiveVideoPlayer,toggleActiveVideoPlayer}; })()",
    { URL, document, window: { location: { origin: "https://gozie.example" } } }
  );
  return { api, document };
}

test("in-page playback permits privacy-enhanced YouTube embeds and validates the video ID", () => {
  const { api } = makePlayerHarness();
  const video = { url: "https://www.youtube.com/watch?v=abc123", embedUrl: "" };
  assert.equal(
    api.getPlayableEmbedUrl(video),
    "https://www.youtube-nocookie.com/embed/abc123"
  );
  assert.equal(
    api.getPlayableEmbedUrl({
      ...video,
      embedUrl: "https://attacker.example/embed/other"
    }),
    "https://www.youtube-nocookie.com/embed/abc123"
  );
});

test("in-page playback permits only secure official PeerTube player URLs", () => {
  const { api } = makePlayerHarness();
  const safe = {
    url: "https://peertube.tv/videos/watch/video-1",
    embedUrl: "https://peertube.tv/videos/embed/video-1"
  };
  assert.equal(api.getPlayableEmbedUrl(safe), safe.embedUrl);
  assert.equal(api.getPlayableEmbedUrl({
    url: "https://untrusted.example/videos/watch/video-1",
    embedUrl: "https://evil.example/videos/embed/video-1"
  }), null);
  assert.equal(api.getPlayableEmbedUrl({
    url: "http://peertube.tv/videos/watch/video-1",
    embedUrl: "http://peertube.tv/videos/embed/video-1"
  }), null);
});

test("in-page playback blocks application-origin frames and credential-bearing URLs", () => {
  const { api } = makePlayerHarness();
  assert.equal(api.getPlayableEmbedUrl({
    url: "https://gozie.example/videos/watch/1",
    embedUrl: "https://gozie.example/videos/embed/1"
  }), null);
  assert.equal(api.getPlayableEmbedUrl({
    url: "https://peertube.tv/videos/watch/1",
    embedUrl: "https://user:pass@peertube.tv/videos/embed/1"
  }), null);
});

test("created iframe uses lazy loading, restricted sandbox and a strict referrer policy", () => {
  const { api } = makePlayerHarness();
  const player = api.createVideoPlayer({
    url: "https://www.youtube.com/watch?v=abc123",
    embedUrl: ""
  });
  assert.ok(player);
  assert.equal(player.className, "video-player-wrap");
  const frame = player.children[0];
  assert.equal(frame.tagName, "IFRAME");
  assert.equal(frame.src, "https://www.youtube-nocookie.com/embed/abc123");
  assert.equal(frame.loading, "lazy");
  assert.equal(frame.referrerPolicy, "strict-origin-when-cross-origin");
  assert.equal(frame.attributes.sandbox, "allow-scripts allow-same-origin allow-presentation");
  assert.equal(frame.allowFullscreen, true);
});

test("only one in-page video player remains active at a time and Stop playback clears it", () => {
  const { api } = makePlayerHarness();
  const state = { target: null, button: null };
  const firstTarget = { children: [], replaceChildren(...items) { this.children = items; } };
  const secondTarget = { children: [], replaceChildren(...items) { this.children = items; } };
  const firstButton = {
    textContent: "Play here", disabled: false, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const secondButton = {
    textContent: "Play here", disabled: false, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const firstVideo = { url: "https://www.youtube.com/watch?v=abc123" };
  const secondVideo = { url: "https://peertube.tv/videos/watch/xyz", embedUrl: "https://peertube.tv/videos/embed/xyz" };

  assert.equal(api.toggleActiveVideoPlayer(firstVideo, firstTarget, firstButton, state), true);
  assert.equal(firstTarget.children.length, 1);
  assert.equal(firstButton.textContent, "Stop playback");
  assert.equal(firstButton.attributes["aria-pressed"], "true");

  assert.equal(api.toggleActiveVideoPlayer(secondVideo, secondTarget, secondButton, state), true);
  assert.equal(firstTarget.children.length, 0);
  assert.equal(firstButton.textContent, "Play here");
  assert.equal(secondTarget.children.length, 1);
  assert.equal(secondButton.textContent, "Stop playback");

  assert.equal(api.toggleActiveVideoPlayer(secondVideo, secondTarget, secondButton, state), false);
  assert.equal(secondTarget.children.length, 0);
  assert.equal(secondButton.textContent, "Play here");
  assert.equal(state.target, null);
});
