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
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
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
const MEDIA_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "how", "i", "in", "is", "it", "of", "on", "or", "the", "to", "with",
  "what", "when", "where", "who", "why", "you", "your"
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

  let score = 0;
  if (normalizedQuery && title.includes(normalizedQuery)) score += 12;

  let titleHits = 0;
  for (const word of words) {
    if (title.includes(word)) {
      score += 5;
      titleHits++;
    } else if (details.includes(word)) {
      score += 1;
    }
  }

  if (titleHits === words.length && words.length > 1) score += 4;
  return score;
}

function rankMediaResults(items, query, titleKeys, detailKeys, urlKeys) {
  if (!Array.isArray(items)) return [];
  const ranked = [];
  const seenUrls = new Set();
  const seenTitles = new Set();

  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object") continue;
    const rawUrl = urlKeys.map((key) => item[key]).find((value) => typeof value === "string" && value);
    let canonicalUrl = "";
    if (rawUrl) {
      const safeUrl = resolveSafeHttpUrl(rawUrl);
      if (safeUrl) {
        const parsed = new URL(safeUrl);
        parsed.hash = "";
        canonicalUrl = parsed.href.toLowerCase();
      }
    }

    const title = normalizeMediaText(titleKeys.map((key) => item[key]).filter(Boolean).join(" "));
    const host = canonicalUrl ? new URL(canonicalUrl).hostname : "";
    const titleKey = title && host ? title + "|" + host : "";
    if ((canonicalUrl && seenUrls.has(canonicalUrl)) || (titleKey && seenTitles.has(titleKey))) continue;
    if (canonicalUrl) seenUrls.add(canonicalUrl);
    if (titleKey) seenTitles.add(titleKey);

    ranked.push({
      item,
      index,
      score: mediaRelevanceScore(item, query, titleKeys, detailKeys)
    });
  }

  const hasRelevantMatches = ranked.some((entry) => entry.score > 0);
  if (hasRelevantMatches) {
    ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  }

  return ranked.map((entry) => entry.item);
}

function formatVideoDuration(value) {
  let seconds = Number(value);
  if (typeof value === "string" && !/^\d+(\.\d+)?$/.test(value.trim())) {
    const parts = value.trim().split(":").map(Number);
    if (parts.length >= 2 && parts.length <= 3 && parts.every(Number.isFinite)) {
      seconds = parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts[0] * 60 + parts[1];
    }
  }
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function parseDurationSeconds(value) {
  if (Number.isFinite(Number(value)) && String(value).trim() !== "") return Math.max(0, Number(value));
  if (typeof value !== "string") return null;
  const parts = value.trim().split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || !parts.every(Number.isFinite)) return null;
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

function getVideoHost(value) {
  try { return new URL(value).hostname.replace(/^www\./i, "").toLowerCase(); }
  catch { return ""; }
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
  const candidate = resolveSafeHttpUrl(video?.embedUrl);
  if (!candidate) {
    const youtubeId = getYouTubeVideoId(video?.url || "");
    return youtubeId ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}` : null;
  }

  try {
    const embed = new URL(candidate);
    const watch = new URL(video.url);
    const host = embed.hostname.toLowerCase();
    const isYouTubeEmbed = host === "youtube.com" || host === "www.youtube.com" ||
      host === "youtube-nocookie.com" || host === "www.youtube-nocookie.com";
    // Other platforms may only embed from the same origin as the result itself.
    return isYouTubeEmbed || embed.origin === watch.origin ? embed.href : null;
  } catch {
    return null;
  }
}

async function fetchImageResults(query) {
  let lastData = null;
  let lastError = null;

  // Prefer the dedicated media index; retain the existing Worker as a fallback.
  for (const api of [MEDIA_API, SEARCH_API]) {
    try {
      const endpoint = new URL("/images", api);
      endpoint.searchParams.set("q", query);
      const data = await fetchJson(endpoint.toString());
      const items = Array.isArray(data.results) ? data.results : [];
      if (items.length) return { ...data, results: items };
      lastData = { ...data, results: items };
    } catch (error) {
      lastError = error;
      console.warn("GOZIE image endpoint unavailable; trying the next provider.", error);
    }
  }

  if (lastData) return lastData;
  throw lastError || new Error("Image search is temporarily unavailable.");
}

async function fetchVideoResults(query) {
  // Prefer the dedicated multi-source media Worker, then keep the original Worker,
  // and finally use the direct PeerTube fallback if neither Worker returns matches.
  for (const api of [MEDIA_API, SEARCH_API]) {
    try {
      const endpoint = new URL("/videos", api);
      endpoint.searchParams.set("q", query);
      const data = await fetchJson(endpoint.toString());
      const items = Array.isArray(data.results) ? data.results
        : Array.isArray(data.items) ? data.items : [];
      const normalized = items.map(normalizeVideoResult).filter(Boolean);
      if (normalized.length) {
        return {
          items: normalized,
          source: data.source || `GOZIE SEARCH media provider (${new URL(api).hostname})`
        };
      }
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
  const filterStatus = document.createElement("p");
  filterStatus.className = "video-filter-status";
  filterStatus.setAttribute("aria-live", "polite");
  resultsList.append(filterBar, filterStatus, gallery);

  function applyFilters() {
    const now = Date.now();
    const sourceFilter = sourceSelect.value;
    const dateFilter = dateSelect.value;
    const durationFilter = durationSelect.value;
    const filtered = videos.filter((video) => {
      const host = video.source || getVideoHost(video.url);
      if (sourceFilter !== "all" && host !== sourceFilter) return false;

      if (dateFilter !== "any") {
        const date = video.publishedAt ? Date.parse(video.publishedAt) : NaN;
        if (!Number.isFinite(date)) return false;
        const maxAge = dateFilter === "day" ? 86400000
          : dateFilter === "week" ? 7 * 86400000 : 30 * 86400000;
        if (date > now || now - date > maxAge) return false;
      }

      if (durationFilter !== "any") {
        if (!Number.isFinite(video.durationSeconds)) return false;
        if (durationFilter === "short" && video.durationSeconds >= 240) return false;
        if (durationFilter === "medium" && (video.durationSeconds < 240 || video.durationSeconds > 1200)) return false;
        if (durationFilter === "long" && video.durationSeconds <= 1200) return false;
      }
      return true;
    });

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
      thumbnailButton.setAttribute("aria-label", `Play video in GOZIE SEARCH: ${video.title}`);

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
        placeholder.textContent = "▶ Play video";
        thumbnailButton.appendChild(placeholder);
      }

      const playerTarget = document.createElement("div");
      playerTarget.className = "video-player-target";
      const playerButton = document.createElement("button");
      playerButton.type = "button";
      playerButton.className = "video-play-button";
      playerButton.textContent = getPlayableEmbedUrl(video) ? "Play here" : "Playback unavailable here";
      playerButton.disabled = !getPlayableEmbedUrl(video);
      playerButton.addEventListener("click", () => {
        const player = createVideoPlayer(video);
        if (!player) return;
        playerTarget.replaceChildren(player);
        playerButton.textContent = "Player loaded";
        playerButton.disabled = true;
      });

      const externalLink = makeLink(video.url, "Open original video ↗");
      externalLink.className = "video-original-link";
      thumbnailButton.addEventListener("click", () => {
        const player = createVideoPlayer(video);
        if (player) {
          playerTarget.replaceChildren(player);
          playerButton.textContent = "Player loaded";
          playerButton.disabled = true;
          playerTarget.scrollIntoView({ behavior: "smooth", block: "nearest" });
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