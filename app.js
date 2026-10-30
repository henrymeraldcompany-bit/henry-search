// ========================================
// GOZIE SEARCH — MAIN APPLICATION
// ========================================

const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const hero = document.querySelector("#hero");
const resultsSection = document.querySelector("#results-section");
const resultsTitle = document.querySelector("#results-title");
const resultStatus = document.querySelector("#result-status");
const resultsList = document.querySelector("#results-list");

const themeToggle = document.querySelector("#theme-toggle");
const themeIcon = document.querySelector("#theme-icon");
const themeLabel = document.querySelector(".theme-label");

const voiceButton = document.querySelector("#voice-search");
const searchHint = document.querySelector("#search-hint");
const searchTabs = document.querySelectorAll(".search-tab");

const SEARCH_API =
  "https://henry-search-api.henrymeraldcompany.workers.dev";

// Dedicated metadata-indexed media API. Keep SEARCH_API for normal web search and news.
const MEDIA_API =
  "https://gozie-search-media.henrymeraldcompany.workers.dev";

let currentCategory = "all";
let recognition = null;
let isListening = false;

// ========================================
// SAFE HTML ELEMENT HELPERS
// ========================================

function showMessage(message) {
  if (!resultsList) return;

  resultsList.replaceChildren();

  const card = document.createElement("div");
  card.className = "message-card";
  card.textContent = message;

  resultsList.appendChild(card);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);

    return ["http:", "https:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function makeLink(url, text) {
  const link = document.createElement("a");

  link.href = url;
  link.textContent = text;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  return link;
}

async function fetchJson(url) {
  // Keep a slow provider from hanging the whole search on mobile connections.
  // The caller can then move on to the next configured provider.
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(12000)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || `The service returned error ${response.status}.`
    );
  }

  return data;
}

// ========================================
// DISPLAY NORMAL WEB RESULTS
// ========================================

function renderResults(items) {
  if (!resultsList) return;

  resultsList.replaceChildren();

  if (!Array.isArray(items) || items.length === 0) {
    showMessage(
      "No results were returned. Try another search. " +
      "The search provider may not have information for every query."
    );
    return;
  }

  let validCount = 0;

  for (const item of items) {
    const url = safeHttpUrl(item.url || item.link || "");

    if (!url) continue;

    const card = document.createElement("article");
    card.className = "result-card";

    const urlLine = document.createElement("div");
    urlLine.className = "result-url";
    urlLine.textContent = new URL(url).hostname;

    const title = makeLink(url, item.title || url);
    title.className = "result-title";

    card.append(urlLine, title);

    const descriptionText =
      item.content || item.description || item.snippet || "";

    if (descriptionText) {
      const description = document.createElement("p");
      description.className = "result-description";
      description.textContent = descriptionText;
      card.appendChild(description);
    }

    resultsList.appendChild(card);
    validCount++;
  }

  if (!validCount) {
    showMessage(
      "The provider returned results, but none had a valid web address."
    );
  }
}

// ========================================
// FULL-SIZE IMAGE VIEWER
// ========================================

let imageZoom = 1;

function openImageViewer(imageUrl, title) {
  const safeImageUrl = safeHttpUrl(imageUrl);
  if (!safeImageUrl) return;

  document.querySelector("#image-viewer")?.remove();

  imageZoom = 1;

  const previousOverflow = document.body.style.overflow;

  const viewer = document.createElement("div");
  viewer.id = "image-viewer";
  viewer.className = "image-viewer";

  const toolbar = document.createElement("div");
  toolbar.className = "image-viewer-toolbar";

  const heading = document.createElement("div");
  heading.className = "image-viewer-heading";
  heading.textContent = title || "Image preview";

  const controls = document.createElement("div");
  controls.className = "image-viewer-controls";

  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.textContent = "−";
  zoomOut.setAttribute("aria-label", "Zoom out");

  const zoomLabel = document.createElement("span");
  zoomLabel.className = "image-zoom-label";
  zoomLabel.textContent = "100%";

  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.textContent = "+";
  zoomIn.setAttribute("aria-label", "Zoom in");

  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset";
  reset.setAttribute("aria-label", "Reset image zoom");

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close image viewer");

  controls.append(zoomOut, zoomLabel, zoomIn, reset, close);
  toolbar.append(heading, controls);

  const stage = document.createElement("div");
  stage.className = "image-viewer-stage";

  const image = document.createElement("img");
  image.className = "image-viewer-image";
  image.src = safeImageUrl;
  image.alt = title || "Full-size image";
  image.draggable = false;

  stage.appendChild(image);
  viewer.append(toolbar, stage);
  document.body.appendChild(viewer);

  document.body.style.overflow = "hidden";

  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let startX = 0;
  let startY = 0;

  function updateImage() {
    image.style.transform =
      `translate(${offsetX}px, ${offsetY}px) scale(${imageZoom})`;

    zoomLabel.textContent = `${Math.round(imageZoom * 100)}%`;
    image.style.cursor = imageZoom > 1 ? "grab" : "default";
  }

  function zoomBy(amount) {
    imageZoom = Math.max(0.5, Math.min(5, imageZoom + amount));
    updateImage();
  }

  function resetImage() {
    imageZoom = 1;
    offsetX = 0;
    offsetY = 0;
    updateImage();
  }

  function closeViewer() {
    viewer.remove();
    document.body.style.overflow = previousOverflow;
    document.removeEventListener("keydown", handleKey);
  }

  function handleKey(event) {
    if (event.key === "Escape") closeViewer();
    if (event.key === "+" || event.key === "=") zoomBy(0.25);
    if (event.key === "-") zoomBy(-0.25);
  }

  zoomIn.addEventListener("click", () => zoomBy(0.25));
  zoomOut.addEventListener("click", () => zoomBy(-0.25));
  reset.addEventListener("click", resetImage);
  close.addEventListener("click", closeViewer);

  viewer.addEventListener("click", (event) => {
    if (event.target === viewer || event.target === stage) {
      closeViewer();
    }
  });

  image.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 0.15 : -0.15);
  }, { passive: false });

  image.addEventListener("pointerdown", (event) => {
    if (imageZoom <= 1) return;

    dragging = true;
    startX = event.clientX - offsetX;
    startY = event.clientY - offsetY;

    image.setPointerCapture(event.pointerId);
    image.style.cursor = "grabbing";
  });

  image.addEventListener("pointermove", (event) => {
    if (!dragging) return;

    offsetX = event.clientX - startX;
    offsetY = event.clientY - startY;
    updateImage();
    image.style.cursor = "grabbing";
  });

  function stopDragging() {
    dragging = false;
    image.style.cursor = imageZoom > 1 ? "grab" : "default";
  }

  image.addEventListener("pointerup", stopDragging);
  image.addEventListener("pointercancel", stopDragging);

  document.addEventListener("keydown", handleKey);

  image.addEventListener("error", () => {
    heading.textContent = "Could not load this image";
  });

  updateImage();
}

// ========================================
// IMAGE GALLERY
// ========================================

function renderImageGallery(items, query = "") {
  if (!resultsList) return;

  items = rankMediaResults(items, query, ["title", "name", "alt"], ["description", "caption"], ["image", "url"]);
  resultsList.replaceChildren();

  if (!Array.isArray(items) || items.length === 0) {
    showMessage("No images were found. Try another search.");
    return;
  }

  const gallery = document.createElement("div");
  gallery.className = "image-gallery";

  let validCount = 0;

  for (const item of items) {
    const thumbnailUrl = safeHttpUrl(item.thumbnail);
    const fullImageUrl = safeHttpUrl(item.image);
    const sourcePage = safeHttpUrl(item.page || item.image);

    if (!thumbnailUrl || !fullImageUrl || !sourcePage) {
      continue;
    }

    const card = document.createElement("article");
    card.className = "image-card";

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "image-preview-button";
    previewButton.setAttribute(
      "aria-label",
      `View full-size image: ${item.title || "Image"}`
    );

    const image = document.createElement("img");
    image.src = thumbnailUrl;
    image.alt = item.title || "Image search result";
    image.loading = "lazy";
    image.decoding = "async";

    image.addEventListener("error", () => {
      image.alt = "Image preview unavailable";
      image.classList.add("image-unavailable");
    });

    previewButton.appendChild(image);

    previewButton.addEventListener("click", () => {
      openImageViewer(fullImageUrl, item.title || "Image preview");
    });

    const title = document.createElement("p");
    title.className = "image-card-title";
    title.textContent = item.title || "Untitled image";

    const license = document.createElement("p");
    license.className = "image-card-license";
    license.textContent = item.license
      ? `License: ${item.license}`
      : "License information unavailable";

    const sourceLink = makeLink(sourcePage, "View source ↗");
    sourceLink.className = "image-source-link";

    card.append(previewButton, title, license, sourceLink);
    gallery.appendChild(card);
    validCount++;
  }

  if (!validCount) {
    showMessage("No usable images were returned. Try another search.");
    return;
  }

  resultsList.appendChild(gallery);
}

// ========================================
// VIDEO SEARCH, RELEVANCE, FILTERS AND INLINE PLAYBACK
// ========================================

const VIDEO_SEARCH_BASE = "https://peertube.tv";
// Cross-origin PeerTube embeds are permitted only on the same three instances
// queried by the Media Worker. Other cross-origin players remain blocked.
const PEERTUBE_EMBED_HOSTS = new Set([
  "peertube.tv",
  "peer.tube",
  "spectra.video"
]);
const MEDIA_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "how", "i", "in", "is", "it", "of", "on", "or", "the", "to", "with",
  "what", "when", "where", "who", "why", "you", "your",
  "video", "videos", "image", "images", "photo", "photos", "picture",
  "pictures", "clip", "clips", "search", "find"
]);

function resolveSafeHttpUrl(value, base) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = base ? new URL(value, base) : new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeMediaText(value) {
  return String(value || "").toLowerCase().normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function queryWords(query) {
  return normalizeMediaText(query).split(/\s+/)
    .filter((word) => word.length > 1 && !MEDIA_STOP_WORDS.has(word));
}

function mediaRelevanceScore(item, query, titleKeys, detailKeys) {
  const normalizedQuery = normalizeMediaText(query);
  const words = queryWords(query);
  if (!words.length) return 0;

  const title = normalizeMediaText(titleKeys.map((key) => item?.[key]).filter(Boolean).join(" "));
  const details = normalizeMediaText(detailKeys.map((key) => {
    const value = item?.[key];
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      return [value.displayName, value.name, value.username].filter(Boolean).join(" ");
    }
    return "";
  }).filter(Boolean).join(" "));
  // Whole-word matching prevents short queries such as "art" matching "party".
  const titleWords = new Set(title.split(/\s+/).filter(Boolean));
  const detailWords = new Set(details.split(/\s+/).filter(Boolean));

  let score = 0;
  const exactTitleMatch = Boolean(normalizedQuery && (` ${title} `).includes(` ${normalizedQuery} `));
  if (exactTitleMatch) score += 12;

  let titleHits = 0;
  let matchedWords = 0;
  for (const word of words) {
    if (titleWords.has(word)) {
      score += 5;
      titleHits++;
      matchedWords++;
    } else if (detailWords.has(word)) {
      score += 1;
      matchedWords++;
    }
  }

  if (titleHits === words.length && words.length > 1) score += 4;

  // Match the backend's threshold: a longer query needs two meaningful words
  // unless the title contains the complete phrase.
  const minimumMatches = words.length >= 3 ? 2 : 1;
  if (!exactTitleMatch && matchedWords < minimumMatches) return 0;
  return score;
}

function canonicalizeMediaResultUrl(value) {
  const safeUrl = resolveSafeHttpUrl(value);
  if (!safeUrl) return "";
  try {
    const parsed = new URL(safeUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    let videoId = "";
    if (host === "youtu.be") {
      videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
    } else if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
      if (parsed.pathname === "/watch") videoId = parsed.searchParams.get("v") || "";
      else {
        const match = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/);
        videoId = match?.[1] || "";
      }
    }
    if (videoId) {
      const canonical = new URL("https://youtube.com/watch");
      canonical.searchParams.set("v", videoId);
      return canonical.href;
    }

    parsed.hostname = host;
    parsed.hash = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (/^utm_/i.test(key) || ["fbclid", "gclid", "dclid", "si", "feature"].includes(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.href;
  } catch {
    return "";
  }
}

function rankMediaResults(items, query, titleKeys, detailKeys, urlKeys) {
  if (!Array.isArray(items)) return [];
  const ranked = [];

  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object") continue;
    const rawUrl = urlKeys.map((key) => item[key]).find((value) => typeof value === "string" && value);
    const canonicalUrl = rawUrl ? canonicalizeMediaResultUrl(rawUrl) : "";
    const title = normalizeMediaText(titleKeys.map((key) => item[key]).filter(Boolean).join(" "));
    const host = canonicalUrl ? new URL(canonicalUrl).hostname : "";
    const titleKey = title && host ? title + "|" + host : "";

    ranked.push({
      item,
      index,
      canonicalUrl,
      titleKey,
      score: mediaRelevanceScore(item, query, titleKeys, detailKeys)
    });
  }

  // Do not let unrelated provider results fill the gallery. Keep only
  // candidates that meet the meaningful-word threshold before sorting.
  const relevant = ranked.filter((entry) => entry.score > 0);
  if (!relevant.length) return [];

  relevant.sort((a, b) => b.score - a.score || a.index - b.index);

  // Deduplicate after relevance sorting so a low-quality duplicate encountered
  // first cannot suppress a better matching result from another provider.
  const seenUrls = new Set();
  const seenTitles = new Set();
  const unique = [];
  for (const entry of relevant) {
    if ((entry.canonicalUrl && seenUrls.has(entry.canonicalUrl)) ||
        (entry.titleKey && seenTitles.has(entry.titleKey))) continue;
    if (entry.canonicalUrl) seenUrls.add(entry.canonicalUrl);
    if (entry.titleKey) seenTitles.add(entry.titleKey);
    unique.push(entry.item);
  }
  return unique;
}

function formatVideoDuration(value) {
  // Reuse the strict parser so missing metadata is not displayed as 0:00,
  // and ISO-8601 values are displayed consistently with duration filters.
  const seconds = parseDurationSeconds(value);
  if (seconds === null) return "";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function parseDurationSeconds(value) {
  // Unknown metadata must stay unknown: Number(null) and Number(false) are 0.
  if (value == null || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;

  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const seconds = Number(normalized);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }

  const iso = normalized.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (iso && iso.slice(1).some((part) => part !== undefined)) {
    return Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0);
  }

  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3 ||
      !parts.every((part) => /^\d+(?:\.\d+)?$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((part) => part >= 60)) return null;
  return numbers.length === 3
    ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    : numbers[0] * 60 + numbers[1];
}

function getVideoHost(value) {
  try { return new URL(value).hostname.replace(/^www\./i, "").toLowerCase(); }
  catch { return ""; }
}

function videoMatchesFilters(video, sourceFilter, dateFilter, durationFilter, now = Date.now()) {
  const host = video.source || getVideoHost(video.url);
  if (sourceFilter && sourceFilter !== "all" && host !== sourceFilter) return false;

  if (dateFilter && dateFilter !== "any") {
    const date = video.publishedAt ? Date.parse(video.publishedAt) : NaN;
    const maxAgeByFilter = {
      day: 86400000,
      week: 7 * 86400000,
      month: 30 * 86400000,
      year: 365 * 86400000
    };
    const maxAge = maxAgeByFilter[dateFilter];
    if (!maxAge || !Number.isFinite(date) || date > now || now - date > maxAge) return false;
  }

  if (durationFilter && durationFilter !== "any") {
    if (!Number.isFinite(video.durationSeconds)) return false;
    if (durationFilter === "short" && video.durationSeconds >= 240) return false;
    if (durationFilter === "medium" && (video.durationSeconds < 240 || video.durationSeconds > 1200)) return false;
    if (durationFilter === "long" && video.durationSeconds <= 1200) return false;
    if (!["short", "medium", "long"].includes(durationFilter)) return false;
  }

  return true;
}

function getYouTubeVideoId(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
    if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
      if (url.pathname === "/watch") return url.searchParams.get("v") || "";
      const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/);
      return match?.[1] || "";
    }
  } catch {}
  return "";
}

function normalizeVideoResult(item) {
  if (!item || typeof item !== "object") return null;

  let instanceBase = VIDEO_SEARCH_BASE;
  const hostValue = typeof item.host === "string" ? item.host
    : typeof item.instance === "string" ? item.instance : "";
  if (hostValue.trim()) {
    const normalizedHost = hostValue.startsWith("http") ? hostValue : `https://${hostValue}`;
    instanceBase = resolveSafeHttpUrl(normalizedHost, VIDEO_SEARCH_BASE) || VIDEO_SEARCH_BASE;
  }

  const rawUrl = item.url || item.watchUrl || item.watch_url || item.originalUrl ||
    (item.shortUUID ? `/w/${item.shortUUID}` : "") ||
    (item.uuid ? `/videos/watch/${item.uuid}` : "") ||
    item.embedPath || item.embedUrl || "";
  const url = resolveSafeHttpUrl(rawUrl, instanceBase);
  if (!url) return null;

  const rawEmbed = item.embedUrl || item.embedURL || item.embedPath || "";
  let embedUrl = rawEmbed ? resolveSafeHttpUrl(rawEmbed, instanceBase) : null;
  const youtubeId = getYouTubeVideoId(url);
  if (!embedUrl && youtubeId) {
    embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}`;
  }

  const rawThumbnail = item.thumbnailUrl || item.thumbnailPath || item.previewPath ||
    item.thumbnail || item.preview || item.thumbnail_url || "";
  const thumbnail = resolveSafeHttpUrl(rawThumbnail, instanceBase);
  const rawDuration = item.durationSeconds ?? item.duration_seconds ?? item.duration;
  const durationSeconds = parseDurationSeconds(rawDuration);
  const published = item.publishedAt || item.published_at || item.createdAt ||
    item.created_at || item.uploadedAt || item.uploaded_at || "";
  const publishedMs = published ? Date.parse(published) : NaN;
  const publishedAt = Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : "";

  return {
    url,
    embedUrl,
    thumbnail,
    title: typeof item.title === "string" && item.title.trim() ? item.title.trim()
      : typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Untitled video",
    description: typeof item.description === "string" ? item.description.trim() : "",
    channel: item.channel?.displayName || item.account?.displayName ||
      item.account?.name || item.channelName || item.uploader || "",
    duration: formatVideoDuration(rawDuration),
    durationSeconds,
    publishedAt,
    source: getVideoHost(url)
  };
}

function getPlayableEmbedUrl(video) {
  const youtubeId = getYouTubeVideoId(video?.url || "");
  const candidate = resolveSafeHttpUrl(video?.embedUrl);
  if (!candidate) {
    return youtubeId ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}` : null;
  }

  try {
    const embed = new URL(candidate);
    const watch = new URL(video.url);
    const embedHost = embed.hostname.toLowerCase().replace(/^www\./, "");
    const youtubeFallback = youtubeId
      ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}`
      : null;

    if (watch.username || watch.password) return null;

    // YouTube uses a separate privacy-enhanced player origin. Require HTTPS,
    // the expected host, and the exact video ID; otherwise use a safe fallback.
    if (youtubeId) {
      if (embed.username || embed.password || embed.protocol !== "https:" || embed.port) {
        return youtubeFallback;
      }
      const isYouTubeEmbedHost = [
        "youtube.com", "youtube-nocookie.com"
      ].includes(embedHost);
      const embedId = embed.pathname.match(/^\/embed\/([\w-]+)\/?$/)?.[1] || "";
      return isYouTubeEmbedHost && embedId === youtubeId
        ? embed.href
        : youtubeFallback;
    }

    // PeerTube may return its official player URL from another configured
    // search instance. Permit that cross-origin case only for the three
    // instances queried by the backend; arbitrary third-party embeds stay blocked.
    const isPeerTubePlayerPath =
      /^\/videos\/embed\/[A-Za-z0-9_-]+\/?$/.test(embed.pathname);
    const securePlayer = embed.protocol === "https:" && watch.protocol === "https:" &&
      !embed.port && !watch.port;
    const sameOrigin = embed.origin === watch.origin;
    const trustedPeerTubeOrigin = PEERTUBE_EMBED_HOSTS.has(embedHost);

    if (embed.username || embed.password || !securePlayer || !isPeerTubePlayerPath) {
      return null;
    }
    return sameOrigin || trustedPeerTubeOrigin ? embed.href : null;
  } catch {
    return youtubeId
      ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}`
      : null;
  }
}

async function fetchImageResults(query) {
  const endpoint = new URL("/images", MEDIA_API);
  endpoint.searchParams.set("q", query);

  try {
    const data = await fetchJson(endpoint.toString());
    // A successful empty response means the media search completed and found
    // no relevant matches. Do not replace that with weaker legacy results.
    return {
      ...data,
      results: Array.isArray(data.results) ? data.results : []
    };
  } catch (error) {
    console.warn("GOZIE image endpoint unavailable; trying the legacy provider.", error);
  }

  const fallbackEndpoint = new URL("/images", SEARCH_API);
  fallbackEndpoint.searchParams.set("q", query);
  const fallbackData = await fetchJson(fallbackEndpoint.toString());
  return {
    ...fallbackData,
    results: Array.isArray(fallbackData.results) ? fallbackData.results : []
  };
}

async function fetchVideoResults(query) {
  // A successful response from the dedicated index is authoritative, including
  // an empty result set. Use the legacy worker only when the preferred endpoint
  // fails; use direct PeerTube only when both workers are unavailable.
  for (const api of [MEDIA_API, SEARCH_API]) {
    try {
      const endpoint = new URL("/videos", api);
      endpoint.searchParams.set("q", query);
      const data = await fetchJson(endpoint.toString());
      const items = Array.isArray(data.results) ? data.results
        : Array.isArray(data.items) ? data.items : [];
      return {
        items: items.map(normalizeVideoResult).filter(Boolean),
        source: data.source || `GOZIE SEARCH media provider (${new URL(api).hostname})`
      };
    } catch (error) {
      console.warn("GOZIE video endpoint unavailable; trying the next provider.", error);
    }
  }

  const endpoint = new URL("/api/v1/search/videos", VIDEO_SEARCH_BASE);
  endpoint.searchParams.set("search", query);
  endpoint.searchParams.set("count", "24");
  endpoint.searchParams.set("sort", "-publishedAt");

  const data = await fetchJson(endpoint.toString());
  const items = Array.isArray(data.data) ? data.data : Array.isArray(data.results) ? data.results : [];
  return {
    items: items.map((item) => {
      const normalized = normalizeVideoResult({ ...item, host: item.host || VIDEO_SEARCH_BASE });
      return normalized;
    }).filter(Boolean),
    source: `PeerTube (${new URL(VIDEO_SEARCH_BASE).hostname})`
  };
}

function appendVideoFallbackLink(query) {
  if (!resultsList || !query) return;
  const fallback = document.createElement("p");
  fallback.className = "video-search-fallback";
  const label = document.createTextNode("Looking for more choices? ");
  const link = makeLink(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    "Search YouTube ↗"
  );
  fallback.append(label, link);
  resultsList.appendChild(fallback);
}

function addFilterOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}

function createVideoPlayer(video) {
  const embedUrl = getPlayableEmbedUrl(video);
  if (!embedUrl) return null;

  const wrapper = document.createElement("div");
  wrapper.className = "video-player-wrap";
  const frame = document.createElement("iframe");
  frame.className = "video-player-frame";
  frame.src = embedUrl;
  frame.title = `Video player: ${video.title}`;
  frame.loading = "lazy";
  frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
  frame.allowFullscreen = true;
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
  wrapper.appendChild(frame);
  return wrapper;
}


function stopActiveVideoPlayer(state) {
  if (!state || !state.target) return false;

  state.target.replaceChildren();
  if (state.button) {
    state.button.textContent = "Play here";
    state.button.disabled = false;
    state.button.setAttribute("aria-pressed", "false");
  }

  state.target = null;
  state.button = null;
  return true;
}

function toggleActiveVideoPlayer(video, target, button, state) {
  if (!target || !button || !state) return false;

  if (state.target === target) {
    stopActiveVideoPlayer(state);
    return false;
  }

  const player = createVideoPlayer(video);
  if (!player) return false;

  // A phone should not keep several external players consuming data/audio.
  stopActiveVideoPlayer(state);
  target.replaceChildren(player);
  button.textContent = "Stop playback";
  button.disabled = false;
  button.setAttribute("aria-pressed", "true");
  state.target = target;
  state.button = button;
  return true;
}

function renderVideoResults(items, query) {
  if (!resultsList) return;
  const rankedItems = rankMediaResults(items, query, ["title", "name"], ["description", "channel", "account"], ["url", "watchUrl", "originalUrl"]);
  const videos = rankedItems.map((item) => item?.durationSeconds !== undefined && item?.source
    ? item : normalizeVideoResult(item)).filter((item) => item?.url);

  resultsList.replaceChildren();
  if (!videos.length) {
    showMessage("No matching videos were found in the available open-source index.");
    appendVideoFallbackLink(query);
    return;
  }

  const filterBar = document.createElement("div");
  filterBar.className = "video-filter-bar";
  filterBar.setAttribute("aria-label", "Filter video results");

  const sourceLabel = document.createElement("label");
  sourceLabel.className = "video-filter";
  sourceLabel.appendChild(document.createTextNode("Source"));
  const sourceSelect = document.createElement("select");
  sourceSelect.setAttribute("aria-label", "Filter videos by source");
  addFilterOption(sourceSelect, "all", "All sources");
  [...new Set(videos.map((video) => video.source || getVideoHost(video.url)).filter(Boolean))]
    .sort().forEach((source) => addFilterOption(sourceSelect, source, source));
  sourceLabel.appendChild(sourceSelect);

  const dateLabel = document.createElement("label");
  dateLabel.className = "video-filter";
  dateLabel.appendChild(document.createTextNode("Uploaded"));
  const dateSelect = document.createElement("select");
  dateSelect.setAttribute("aria-label", "Filter videos by upload date");
  addFilterOption(dateSelect, "any", "Any time");
  addFilterOption(dateSelect, "day", "Past 24 hours");
  addFilterOption(dateSelect, "week", "Past week");
  addFilterOption(dateSelect, "month", "Past month");
  addFilterOption(dateSelect, "year", "Past year");
  dateLabel.appendChild(dateSelect);

  const durationLabel = document.createElement("label");
  durationLabel.className = "video-filter";
  durationLabel.appendChild(document.createTextNode("Duration"));
  const durationSelect = document.createElement("select");
  durationSelect.setAttribute("aria-label", "Filter videos by duration");
  addFilterOption(durationSelect, "any", "Any length");
  addFilterOption(durationSelect, "short", "Under 4 minutes");
  addFilterOption(durationSelect, "medium", "4–20 minutes");
  addFilterOption(durationSelect, "long", "Over 20 minutes");
  durationLabel.appendChild(durationSelect);

  filterBar.append(sourceLabel, dateLabel, durationLabel);
  const gallery = document.createElement("div");
  gallery.className = "video-gallery";
  const activePlayerState = { target: null, button: null };
  const filterStatus = document.createElement("p");
  filterStatus.className = "video-filter-status";
  filterStatus.setAttribute("aria-live", "polite");
  resultsList.append(filterBar, filterStatus, gallery);

  function applyFilters() {
    const now = Date.now();
    const sourceFilter = sourceSelect.value;
    const dateFilter = dateSelect.value;
    const durationFilter = durationSelect.value;
    const filtered = videos.filter((video) =>
      videoMatchesFilters(video, sourceFilter, dateFilter, durationFilter, now)
    );

    stopActiveVideoPlayer(activePlayerState);
    gallery.replaceChildren();
    if (!filtered.length) {
      filterStatus.textContent = "No videos match all selected filters. Try relaxing one filter; some sources do not provide dates or durations.";
      return;
    }
    filterStatus.textContent = `Showing ${filtered.length} of ${videos.length} videos. Results are ranked by title and description match where metadata is available.`;

    for (const video of filtered) {
      const card = document.createElement("article");
      card.className = "video-card";

      const thumbnailButton = document.createElement("button");
      thumbnailButton.type = "button";
      thumbnailButton.className = "video-thumb-link video-thumb-button";
      const playableEmbedUrl = getPlayableEmbedUrl(video);
      thumbnailButton.setAttribute(
        "aria-label",
        playableEmbedUrl
          ? `Play video in GOZIE SEARCH: ${video.title}`
          : `Open original video: ${video.title}`
      );

      if (video.thumbnail) {
        const image = document.createElement("img");
        image.src = video.thumbnail;
        image.alt = `Thumbnail for ${video.title}`;
        image.loading = "lazy";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => {
          image.remove();
          const fallback = document.createElement("span");
          fallback.className = "video-thumb-placeholder";
          fallback.textContent = "Video preview unavailable";
          thumbnailButton.appendChild(fallback);
        });
        thumbnailButton.appendChild(image);
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "video-thumb-placeholder";
        placeholder.textContent = playableEmbedUrl ? "▶ Play video" : "↗ Open original video";
        thumbnailButton.appendChild(placeholder);
      }

      const playerTarget = document.createElement("div");
      playerTarget.className = "video-player-target";
      const playerButton = document.createElement("button");
      playerButton.type = "button";
      playerButton.className = "video-play-button";
      playerButton.textContent = playableEmbedUrl ? "Play here" : "Playback unavailable here";
      playerButton.disabled = !playableEmbedUrl;
      playerButton.setAttribute("aria-pressed", "false");
      playerButton.addEventListener("click", () => {
        toggleActiveVideoPlayer(video, playerTarget, playerButton, activePlayerState);
      });

      const externalLink = makeLink(video.url, "Open original video ↗");
      externalLink.className = "video-original-link";
      thumbnailButton.addEventListener("click", () => {
        if (playableEmbedUrl) {
          const started = toggleActiveVideoPlayer(video, playerTarget, playerButton, activePlayerState);
          if (started) {
            playerTarget.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        } else {
          window.open(video.url, "_blank", "noopener,noreferrer");
        }
      });

      const title = makeLink(video.url, video.title);
      title.className = "video-card-title";
      const source = document.createElement("p");
      source.className = "video-card-source";
      source.textContent = video.channel
        ? `${video.channel} · ${video.source || getVideoHost(video.url)}`
        : (video.source || getVideoHost(video.url));

      card.append(thumbnailButton, playerTarget, title, source);
      const actions = document.createElement("div");
      actions.className = "video-card-actions";
      actions.append(playerButton, externalLink);
      card.appendChild(actions);

      if (video.duration) {
        const duration = document.createElement("span");
        duration.className = "video-card-duration";
        duration.textContent = video.duration;
        card.appendChild(duration);
      }

      if (video.publishedAt) {
        const date = document.createElement("p");
        date.className = "video-card-date";
        date.textContent = `Uploaded ${new Date(video.publishedAt).toLocaleDateString()}`;
        card.appendChild(date);
      }

      if (video.description) {
        const description = document.createElement("p");
        description.className = "video-card-description";
        description.textContent = video.description.replace(/\s+/g, " ").slice(0, 240);
        card.appendChild(description);
      }
      gallery.appendChild(card);
    }
  }

  sourceSelect.addEventListener("change", applyFilters);
  dateSelect.addEventListener("change", applyFilters);
  durationSelect.addEventListener("change", applyFilters);
  applyFilters();
  appendVideoFallbackLink(query);
}

function showVideoSearchError(query, message) {
  showMessage(message || "Video search is temporarily unavailable. Please try again.");
  appendVideoFallbackLink(query);
}

// ========================================
// CATEGORY SEARCH DESTINATIONS
// ========================================

function getCategoryDestination(query) {
  const encodedQuery = encodeURIComponent(query);

  const destinations = {
    news: {
      name: "News search",
      description:
        "Find news articles and current reports related to your search.",
      url: `https://www.google.com/search?tbm=nws&q=${encodedQuery}`
    },

    videos: {
      name: "Video search",
      description:
        "Discover videos related to your search on YouTube.",
      url: `https://www.youtube.com/results?search_query=${encodedQuery}`
    }
  };

  return destinations[currentCategory] || null;
}

function showCategoryDestination(query) {
  const destination = getCategoryDestination(query);

  if (!destination) return;

  resultsList.replaceChildren();

  const card = document.createElement("article");
  card.className = "result-card";

  const heading = document.createElement("h3");
  heading.textContent = destination.name;

  const description = document.createElement("p");
  description.textContent = destination.description;

  const link = makeLink(
    destination.url,
    `Open ${destination.name} →`
  );

  link.className = "result-title";

  card.append(heading, description, link);
  resultsList.appendChild(card);

  resultStatus.textContent =
    "Your search is ready. Open the link to view results.";
}

// ========================================
// CATEGORY TABS
// ========================================

const categoryDetails = {
  all: {
    placeholder: "What are you looking for?",
    hint: "Ask a question. Discover something new."
  },

  images: {
    placeholder: "What images do you want to find?",
    hint: "Search for pictures and view them in a gallery."
  },

  news: {
    placeholder: "What news are you looking for?",
    hint: "Explore news articles and current reports."
  },

  videos: {
    placeholder: "What videos do you want to watch?",
    hint: "Discover videos related to any topic."
  }
};

function setCategory(category) {
  const allowedCategories = ["all", "images", "news", "videos"];

  if (!allowedCategories.includes(category)) {
    category = "all";
  }

  currentCategory = category;

  searchTabs.forEach((tab) => {
    const isActive = tab.dataset.category === category;

    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  });

  const details = categoryDetails[category];

  if (queryInput) {
    queryInput.placeholder = details.placeholder;
  }

  if (searchHint && !isListening) {
    searchHint.textContent = details.hint;
  }
}

searchTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setCategory(tab.dataset.category);
  });
});

// ========================================
// SEARCH SUBMISSION
// ========================================

if (form && queryInput && resultsList) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const query = queryInput.value.trim();

    if (!query) {
      queryInput.focus();
      return;
    }

    if (hero) hero.hidden = true;
    if (resultsSection) resultsSection.hidden = false;

    if (resultsTitle) resultsTitle.textContent = query;

    if (resultStatus) {
      resultStatus.textContent = "Preparing your search…";
    }

    showMessage("GOZIE SEARCH is preparing your results…");

    // IMAGE SEARCH
    if (currentCategory === "images") {
      try {
        const data = await fetchImageResults(query);
        const items = Array.isArray(data.results) ? data.results : [];

        if (resultStatus) {
          resultStatus.textContent =
            `${items.length} image${items.length === 1 ? "" : "s"} ` +
            `found via ${data.source || "the image provider"}.`;
        }

        renderImageGallery(items, query);
      } catch (error) {
        if (resultStatus) {
          resultStatus.textContent = "Image search unavailable";
        }

        showMessage(
          `${error.message || "Could not load images."} ` +
          "Check your connection and try again."
        );
      }

      return;
    }

    // NEWS SEARCH: render results inside GOZIE SEARCH.
    if (currentCategory === "news") {
      try {
        const endpoint = new URL("/news", SEARCH_API);
        endpoint.searchParams.set("q", query);
        const data = await fetchJson(endpoint.toString());
        const items = Array.isArray(data.results) ? data.results : [];

        if (resultStatus) {
          resultStatus.textContent =
            `${items.length} news result${items.length === 1 ? "" : "s"} from ${data.source || "the news provider"}.`;
        }

        renderResults(items);
      } catch (error) {
        if (resultStatus) resultStatus.textContent = "News search unavailable";
        showMessage(
          `${error.message || "Could not load news."} Check your connection and try again.`
        );
      }
      return;
    }

    // VIDEO SEARCH: show real results inside GOZIE SEARCH.
    if (currentCategory === "videos") {
      try {
        const data = await fetchVideoResults(query);
        if (resultStatus) {
          resultStatus.textContent =
            `${data.items.length} video${data.items.length === 1 ? "" : "s"} found via ${data.source}.`;
        }
        renderVideoResults(data.items, query);
      } catch (error) {
        if (resultStatus) resultStatus.textContent = "Video search unavailable";
        showVideoSearchError(
          query,
          `${error?.message || "Could not load videos."} Check your connection and try again.`
        );
      }
      return;
    }

    // NORMAL WEB SEARCH
    try {
      const endpoint = new URL("/search", SEARCH_API);
      endpoint.searchParams.set("q", query);

      const data = await fetchJson(endpoint.toString());

      const items = Array.isArray(data.results)
        ? data.results
        : Array.isArray(data.items)
          ? data.items
          : [];

      if (resultStatus) {
        resultStatus.textContent =
          `${items.length} result${items.length === 1 ? "" : "s"} ` +
          `returned by ${data.source || "the search provider"}.`;
      }

      renderResults(items);
    } catch (error) {
      if (resultStatus) {
        resultStatus.textContent = "Search unavailable";
      }

      showMessage(
        `${error.message || "Could not reach GOZIE SEARCH."} ` +
        "Please check your connection and try again."
      );
    }
  });
} else {
  console.error(
    "GOZIE SEARCH: Search form, query input, or results list is missing. " +
    "Check the corresponding HTML element IDs."
  );
}

// ========================================
// QUICK-SEARCH BUTTONS
// ========================================

document.querySelectorAll("[data-query]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!queryInput || !form) return;

    queryInput.value = button.dataset.query || "";

    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
    } else {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    }
  });
});

// ========================================
// VOICE SEARCH
// ========================================

function setVoiceListening(listening) {
  isListening = listening;

  if (!voiceButton) return;

  voiceButton.classList.toggle("listening", listening);

  voiceButton.setAttribute(
    "aria-label",
    listening ? "Stop voice search" : "Search by voice"
  );

  voiceButton.title = listening
    ? "Listening…"
    : "Search by voice";

  const icon = voiceButton.querySelector("span");

  if (icon) {
    icon.textContent = listening ? "🔴" : "🎙";
  }

  if (searchHint && listening) {
    searchHint.textContent = "Listening… Speak your search now.";
  } else if (searchHint) {
    searchHint.textContent = categoryDetails[currentCategory].hint;
  }
}

function stopVoiceSearch() {
  if (recognition && isListening) {
    recognition.stop();
  }

  setVoiceListening(false);
}

function startVoiceSearch() {
  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    if (searchHint) {
      searchHint.textContent =
        "Voice search is not supported in this browser. " +
        "Try an up-to-date version of Chrome.";
    }

    return;
  }

  if (isListening) {
    stopVoiceSearch();
    return;
  }

  try {
    recognition = new SpeechRecognition();

    recognition.lang = "en-NG";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setVoiceListening(true);
    };

    recognition.onresult = (event) => {
      const transcript =
        event.results[0][0].transcript.trim();

      if (transcript && queryInput && form) {
        queryInput.value = transcript;

        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else {
          form.dispatchEvent(
            new Event("submit", {
              bubbles: true,
              cancelable: true
            })
          );
        }
      }
    };

    recognition.onerror = (event) => {
      const messages = {
        "not-allowed":
          "Microphone permission was denied. Allow microphone access in your browser settings.",
        "no-speech":
          "No speech was detected. Tap the microphone and try again.",
        "network":
          "Voice recognition needs a network connection in this browser. Please try again.",
        "audio-capture":
          "No microphone was detected. Check your phone's microphone permission."
      };

      if (searchHint) {
        searchHint.textContent =
          messages[event.error] ||
          "Voice search could not start. Please try again.";
      }

      setVoiceListening(false);
    };

    recognition.onend = () => {
      setVoiceListening(false);
    };

    recognition.start();
  } catch {
    setVoiceListening(false);

    if (searchHint) {
      searchHint.textContent =
        "Could not start voice search. Please try again.";
    }
  }
}

if (voiceButton) {
  voiceButton.addEventListener("click", startVoiceSearch);
}

// ========================================
// LIGHT AND DARK THEMES
// ========================================

function applyTheme(theme) {
  const selectedTheme = theme === "light" ? "light" : "dark";

  document.documentElement.dataset.theme = selectedTheme;

  if (themeIcon) {
    themeIcon.textContent =
      selectedTheme === "dark" ? "☀" : "☾";
  }

  if (themeLabel) {
    themeLabel.textContent =
      selectedTheme === "dark" ? "Light mode" : "Dark mode";
  }

  if (themeToggle) {
    themeToggle.setAttribute(
      "aria-label",
      selectedTheme === "dark"
        ? "Switch to light mode"
        : "Switch to dark mode"
    );
  }
}

let savedTheme = "dark";

try {
  savedTheme = localStorage.getItem("gozie-theme") || "dark";
} catch {
  // Use the default theme if storage is unavailable.
}

applyTheme(savedTheme);

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const nextTheme =
      document.documentElement.dataset.theme === "dark"
        ? "light"
        : "dark";

    applyTheme(nextTheme);

    try {
      localStorage.setItem("gozie-theme", nextTheme);
    } catch {
      // Theme switching still works without storage.
    }
  });
}

// ========================================
// MENU BUTTON
// ========================================

const menuToggle = document.querySelector("#menu-toggle");

if (menuToggle) {
  menuToggle.addEventListener("click", () => {
    if (!queryInput) return;

    queryInput.focus();

    queryInput.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  });
}

// ========================================
// INITIAL SETUP
// ========================================

setCategory("all");