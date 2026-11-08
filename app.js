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

// ========================================
// TEXT TO SPEECH / READ ALOUD
// ========================================
const ttsPlayButton = document.querySelector("#tts-play");
const ttsPauseButton = document.querySelector("#tts-pause");
const ttsStopButton = document.querySelector("#tts-stop");
let ttsUtterance = null;
let ttsChunks = [];
let ttsChunkIndex = 0;
let ttsIsPaused = false;

function getReadableSearchText() {
  if (!resultsList) return "";
  const clone = resultsList.cloneNode(true);
  clone.querySelectorAll("button, input, select, textarea, nav, .image-filter-bar, .video-filter-bar, .web-filter-bar").forEach(node => node.remove());
  return (clone.innerText || clone.textContent || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

function updateTtsControls(state) {
  if (!ttsPlayButton || !ttsPauseButton || !ttsStopButton) return;
  const speaking = state === "speaking";
  const paused = state === "paused";
  ttsPlayButton.disabled = speaking || paused;
  ttsPauseButton.disabled = !speaking && !paused;
  ttsPauseButton.textContent = paused ? "Resume" : "Pause";
  ttsStopButton.disabled = state === "idle";
  ttsPlayButton.textContent = state === "idle" ? "▶ Read aloud" : "▶ Read aloud";
}

function splitSpeechText(text, maxLength = 1800) {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if ((current + " " + part).trim().length > maxLength && current) {
      chunks.push(current);
      current = "";
    }
    if (part.length > maxLength) {
      for (let offset = 0; offset < part.length; offset += maxLength) {
        const fragment = part.slice(offset, offset + maxLength).trim();
        if (fragment) chunks.push(fragment);
      }
    } else {
      current = (current + " " + part).trim();
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function speakNextChunk() {
  if (!("speechSynthesis" in window) || ttsChunkIndex >= ttsChunks.length) {
    updateTtsControls("idle");
    ttsUtterance = null;
    ttsChunks = [];
    return;
  }
  const utterance = new SpeechSynthesisUtterance(ttsChunks[ttsChunkIndex]);
  const rate = Number(getPreference("speechRate", 1));
  utterance.rate = [0.8, 1, 1.2, 1.4].includes(rate) ? rate : 1;
  const lang = getVoiceLanguage();
  utterance.lang = lang;
  const voices = window.speechSynthesis.getVoices();
  const preferredVoice = voices.find(voice => voice.lang.toLowerCase() === lang.toLowerCase()) ||
    voices.find(voice => voice.lang.toLowerCase().startsWith(lang.split("-")[0].toLowerCase()));
  if (preferredVoice) utterance.voice = preferredVoice;
  utterance.onstart = () => updateTtsControls("speaking");
  utterance.onend = () => {
    if (ttsUtterance !== utterance) return;
    ttsChunkIndex += 1;
    speakNextChunk();
  };
  utterance.onerror = event => {
    if (event.error !== "canceled" && event.error !== "interrupted") {
      const status = document.querySelector("#result-status");
      if (status) status.textContent = "Read aloud stopped: " + event.error;
    }
    updateTtsControls("idle");
  };
  ttsUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

function startReadAloud() {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    const status = document.querySelector("#result-status");
    if (status) status.textContent = "Read aloud is not supported by this browser. Try an updated browser with speech synthesis support.";
    return;
  }
  const text = getReadableSearchText();
  if (!text) {
    const status = document.querySelector("#result-status");
    if (status) status.textContent = "There is no readable search-result text yet.";
    return;
  }
  window.speechSynthesis.cancel();
  ttsChunks = splitSpeechText(text);
  ttsChunkIndex = 0;
  ttsIsPaused = false;
  updateTtsControls("speaking");
  speakNextChunk();
}

function stopReadAloud() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  ttsUtterance = null;
  ttsChunks = [];
  ttsChunkIndex = 0;
  ttsIsPaused = false;
  updateTtsControls("idle");
}

ttsPlayButton?.addEventListener("click", startReadAloud);
ttsPauseButton?.addEventListener("click", () => {
  if (!("speechSynthesis" in window)) return;
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
    ttsIsPaused = false;
    updateTtsControls("speaking");
  } else if (window.speechSynthesis.speaking) {
    window.speechSynthesis.pause();
    ttsIsPaused = true;
    updateTtsControls("paused");
  }
});
ttsStopButton?.addEventListener("click", stopReadAloud);

// Release queued speech and its retained text chunks when the page is discarded.
window.addEventListener("pagehide", stopReadAloud, { once: true });


const themeToggle = document.querySelector("#theme-toggle");
const themeIcon = document.querySelector("#theme-icon");
const themeLabel = document.querySelector(".theme-label");

const voiceButton = document.querySelector("#voice-search");
const searchHint = document.querySelector("#search-hint");
const searchTabs = document.querySelectorAll(".search-tab");

let preferenceCache = null;
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

let activeSearchRequest = 0;

function showSearchLoading(message, requestId) {
  if (!resultsList) return;
  resultsList.replaceChildren();

  const card = document.createElement("div");
  card.className = "message-card search-loading-card";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");
  card.setAttribute("aria-atomic", "true");

  const spinner = document.createElement("span");
  spinner.className = "search-loading-spinner";
  spinner.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.className = "search-loading-label";
  label.textContent = message;

  card.append(spinner, label);
  resultsList.appendChild(card);
  resultsList.setAttribute("aria-busy", "true");
  if (resultStatus) resultStatus.textContent = message;
  if (form) form.setAttribute("aria-busy", "true");
}

function finishSearchRequest(requestId) {
  if (requestId !== activeSearchRequest) return;
  resultsList?.setAttribute("aria-busy", "false");
  form?.setAttribute("aria-busy", "false");
  const submitButton = form?.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = false;
    submitButton.classList.remove("is-searching");
    submitButton.setAttribute("aria-label", "Search");
    const label = submitButton.querySelector(".search-button-text");
    if (label) label.textContent = "Search";
  }
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
  link.target = getPreference("newTab", true) ? "_blank" : "_self";
  link.rel = "noopener noreferrer";

  return link;
}

async function fetchJson(url, timeoutMs = 12000) {
  // Keep a slow provider from hanging the whole search on mobile connections.
  // The caller can then move on to the next configured provider.
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(timeoutMs)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || `The service returned error ${response.status}.`
    );
  }

  return data;
}

let currentWebResults = [];
let currentWebFilters = { domain: 'all', source: 'all', date: 'any' };
let currentWebPage = 1;
const WEB_RESULTS_PER_PAGE = 25;
function applyWebResultFilters(items) {
 const now=Date.now();
 return items.filter(item=>{
  let host=String(item.domain||''); if(!host){try{host=new URL(item.url||item.link).hostname;}catch{}}
  host=host.toLowerCase().replace(/^www\./i,'');
  if(currentWebFilters.domain!=='all'&&host!==currentWebFilters.domain)return false;
  const sources=Array.isArray(item.sources)?item.sources:[item.source];
  if(currentWebFilters.source!=='all'&&!sources.some(v=>String(v||'').toLowerCase()===currentWebFilters.source))return false;
  if(currentWebFilters.date!=='any'){const ages={day:86400000,week:604800000,month:2592000000,year:31536000000};const date=Date.parse(item.published||'');if(!ages[currentWebFilters.date]||!Number.isFinite(date)||date>now||now-date>ages[currentWebFilters.date])return false;}
  return true;
 });
}
function renderWebFilterBar(items) {
 const bar=document.createElement('div');bar.className='web-filter-bar';bar.setAttribute('aria-label','Filter search results');
 const domains=[...new Set(items.map(item=>{let h=item.domain||'';if(!h){try{h=new URL(item.url||item.link).hostname;}catch{}}return String(h).toLowerCase().replace(/^www\./i,'');}).filter(Boolean))].sort();
 const sources=[...new Set(items.flatMap(item=>Array.isArray(item.sources)?item.sources:[item.source]).filter(Boolean).map(v=>String(v).trim()))].sort();
 const add=(caption,key,opts)=>{const label=document.createElement('label');label.className='web-filter';const span=document.createElement('span');span.textContent=caption;const select=document.createElement('select');select.setAttribute('aria-label',caption);for(const [value,name] of opts){const option=document.createElement('option');option.value=value;option.textContent=name;select.appendChild(option);}select.value=currentWebFilters[key];select.addEventListener('change',()=>{currentWebFilters[key]=select.value;currentWebPage=1;renderResults(currentWebResults);});label.append(span,select);bar.appendChild(label);};
 add('Website','domain',[['all','All websites'],...domains.map(v=>[v,v])]);
 add('Source','source',[['all','All sources'],...sources.map(v=>[v.toLowerCase(),v])]);
 add('Date','date',[['any','Any time'],['day','Past 24 hours'],['week','Past week'],['month','Past month'],['year','Past year']]);
 const count=document.createElement('span');count.className='web-filter-count';count.textContent=applyWebResultFilters(items).length+' of '+items.length+' results';bar.appendChild(count);return bar;
}

// ========================================
// DISPLAY NORMAL WEB RESULTS
// ========================================

function renderNewsResults(items) {
  if (!resultsList) return;
  const articles = Array.isArray(items) ? items : [];
  resultsList.replaceChildren();

  if (!articles.length) {
    const message = document.createElement("div");
    message.className = "message-card";
    message.textContent = "No news articles were returned. Try another search.";
    resultsList.appendChild(message);
    return;
  }

  for (const item of articles) {
    const originalUrl = safeHttpUrl(item.originalUrl || item.url || item.link || "");
    if (!originalUrl) continue;

    const card = document.createElement("article");
    card.className = "result-card news-preview-card";

    const sourceLine = document.createElement("div");
    sourceLine.className = "result-url";
    const publisher = (Array.isArray(item.sources) ? item.sources : [item.source])
      .find(value => typeof value === "string" && value.trim());
    sourceLine.textContent = publisher || new URL(originalUrl).hostname;

    const title = makeLink(originalUrl, item.title || originalUrl);
    title.className = "result-title";

    const metadata = document.createElement("p");
    metadata.className = "result-attribution";
    const published = item.published && Number.isFinite(Date.parse(item.published))
      ? new Date(item.published).toLocaleString()
      : "";
    metadata.textContent = published
      ? "Published " + published
      : "News preview";
    const providers = [...new Set((Array.isArray(item.providers) ? item.providers : [item.provider])
      .filter(value => typeof value === "string" && value.trim()))];
    if (providers.length) metadata.textContent += " · Found via " + providers.join(", ");

    const summaryText = String(item.preview?.summary || item.snippet || item.description || "").trim();
    card.append(sourceLine, title, metadata);
    if (summaryText) {
      const summary = document.createElement("p");
      summary.className = "result-description news-preview-summary";
      summary.textContent = summaryText;
      card.appendChild(summary);
    }

    const originalLink = makeLink(originalUrl, "Read full article at original source");
    originalLink.className = "result-source-link news-original-source";
    card.appendChild(originalLink);
    resultsList.appendChild(card);
  }
}

function renderResults(items) {
  if (!resultsList) return;
  if (Array.isArray(items) && items !== currentWebResults) { currentWebResults = items; currentWebFilters = { domain: 'all', source: 'all', date: 'any' }; currentWebPage = 1; }
  const originalItems = Array.isArray(currentWebResults) ? currentWebResults : [];
  const filteredItems = applyWebResultFilters(originalItems);
  resultsList.replaceChildren();
  if (originalItems.length) resultsList.appendChild(renderWebFilterBar(originalItems));
  items = filteredItems;
  const pageCount = Math.max(1, Math.ceil(items.length / WEB_RESULTS_PER_PAGE));
  currentWebPage = Math.min(Math.max(1, currentWebPage), pageCount);
  const pageStart = (currentWebPage - 1) * WEB_RESULTS_PER_PAGE;
  const pageItems = items.slice(pageStart, pageStart + WEB_RESULTS_PER_PAGE);
  if (!items.length) {
    const message=document.createElement('div');message.className='message-card';
    message.textContent=originalItems.length?'No results match these filters. Change a filter or choose the default options.':'No results were returned. Try another search.';
    resultsList.appendChild(message);return;
  }

  let validCount = 0;

  for (const item of pageItems) {
    const url = safeHttpUrl(item.url || item.link || "");

    if (!url) continue;

    const card = document.createElement("article");
    card.className = "result-card web-result-card";

    const urlLine = document.createElement("div");
    urlLine.className = "result-url-line";
    const rank = document.createElement("span");
    rank.className = "result-rank";
    rank.textContent = String(pageStart + validCount + 1);
    rank.setAttribute("aria-label", "Result " + (pageStart + validCount + 1));
    const siteMark = document.createElement("span");
    siteMark.className = "result-site-mark";
    const hostName = new URL(url).hostname.replace(/^www\\./i, "");
    siteMark.textContent = (hostName.replace(/^m\\./i, "").charAt(0) || "W").toUpperCase();
    siteMark.setAttribute("aria-hidden", "true");
    const siteName = document.createElement("span");
    siteName.className = "result-url";
    siteName.textContent = hostName;
    urlLine.append(rank, siteMark, siteName);

    const title = makeLink(url, item.title || url);
    title.className = "result-title";

    card.append(urlLine, title);

    const attribution = document.createElement("p");
    attribution.className = "result-attribution";
    const publisherNames = [...new Set((Array.isArray(item.sources) ? item.sources : [item.source])
      .filter(value => typeof value === "string" && value.trim()))];
    const publisherLabel = document.createElement("span");
    publisherLabel.textContent = publisherNames.length
      ? "Source: " + publisherNames.join(" · ")
      : "Original source: " + new URL(url).hostname;
    const publishedDate = item.published && Number.isFinite(Date.parse(item.published))
      ? new Date(item.published).toLocaleDateString()
      : "";
    if (publishedDate) publisherLabel.textContent += " · " + publishedDate;
    attribution.appendChild(publisherLabel);

    const originalUrl = safeHttpUrl(item.originalUrl || item.url || item.link || "");
    if (originalUrl) {
      const originalLink = makeLink(originalUrl, "Open original source");
      originalLink.className = "result-source-link";
      attribution.append(" · ", originalLink);
    }

    const providerNames = [...new Set((Array.isArray(item.providers) ? item.providers : [item.provider])
      .filter(value => typeof value === "string" && value.trim()))];
    if (providerNames.length) {
      const provider = document.createElement("span");
      provider.className = "result-provider-attribution";
      provider.textContent = " · Found via " + providerNames.join(", ");
      attribution.appendChild(provider);
    }
    card.appendChild(attribution);

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

  if (pageCount > 1) resultsList.appendChild(renderWebPagination(pageCount, items.length));

  if (!validCount) {
    showMessage(
      "The provider returned results, but none had a valid web address."
    );
  }
}


function renderWebPagination(pageCount, totalCount) {
  const nav = document.createElement("nav");
  nav.className = "web-pagination";
  nav.setAttribute("aria-label", "Search result pages");

  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "web-page-button";
  previous.textContent = "Previous";
  previous.disabled = currentWebPage <= 1;
  previous.addEventListener("click", () => {
    currentWebPage = Math.max(1, currentWebPage - 1);
    renderResults(currentWebResults);
  });

  const status = document.createElement("span");
  status.className = "web-page-status";
  status.setAttribute("aria-live", "polite");
  const first = (currentWebPage - 1) * WEB_RESULTS_PER_PAGE + 1;
  const last = Math.min(currentWebPage * WEB_RESULTS_PER_PAGE, totalCount);
  status.textContent = `Page ${currentWebPage} of ${pageCount} · Showing ${first}–${last} of ${totalCount}`;

  const next = document.createElement("button");
  next.type = "button";
  next.className = "web-page-button";
  next.textContent = "Next";
  next.disabled = currentWebPage >= pageCount;
  next.addEventListener("click", () => {
    currentWebPage = Math.min(pageCount, currentWebPage + 1);
    renderResults(currentWebResults);
  });

  nav.append(previous, status, next);
  return nav;
}

// ========================================
// FULL-SIZE IMAGE VIEWER
// ========================================

let imageZoom = 1;

function openImageViewer(imageUrl, title, sourcePage = "") {
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

  const actions = document.createElement("div");
  actions.className = "image-viewer-actions";
  const originalLink = makeLink(safeImageUrl, "Open original image ↗");
  originalLink.className = "image-viewer-link";
  originalLink.target = "_blank";
  originalLink.rel = "noopener noreferrer";
  actions.appendChild(originalLink);
  const safeSourcePage = safeHttpUrl(sourcePage);
  if (safeSourcePage && safeSourcePage !== safeImageUrl) {
    const sourceLink = makeLink(safeSourcePage, "Visit source page ↗");
    sourceLink.className = "image-viewer-link";
    sourceLink.target = "_blank";
    sourceLink.rel = "noopener noreferrer";
    actions.appendChild(sourceLink);
  }

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
  toolbar.append(heading, actions, controls);

  const stage = document.createElement("div");
  stage.className = "image-viewer-stage";

  const image = document.createElement("img");
  image.className = "image-viewer-image";
  image.src = safeImageUrl;
  image.alt = title || "Full-size image";
  image.draggable = false;

  const imageStatus = document.createElement("p");
  imageStatus.className = "image-viewer-status";
  imageStatus.setAttribute("role", "status");
  imageStatus.textContent = "Loading full-size image…";
  image.addEventListener("load", () => {
    imageStatus.textContent = image.naturalWidth && image.naturalHeight
      ? `${image.naturalWidth} × ${image.naturalHeight} px`
      : "Full-size image loaded";
  });
  image.addEventListener("error", () => {
    imageStatus.textContent = "The original image could not be loaded. Use Open original image to try the source directly.";
  });
  stage.append(imageStatus, image);
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

let currentImageFilters = {date:"any",dimensions:"any",source:"all",format:"all"};
let currentImageFilterQuery = "";
function applyImageFilters(items, now = Date.now()) {
  const windows = {day:86400000,week:604800000,month:2592000000,year:31536000000};
  return items.filter(item => {
    const source = String(item.source || item.provider || "").trim().toLowerCase();
    if (currentImageFilters.source !== "all" && source !== currentImageFilters.source) return false;
    const mime = String(item.format || "").toLowerCase();
    const path = String(item.image || "").split("?")[0];
    const ext = (mime.includes("/") ? mime.split("/").pop().replace("jpeg","jpg") : mime) || (path.match(/\.([a-z0-9]{2,5})$/i)||[])[1]?.toLowerCase() || "";
    if (currentImageFilters.format !== "all" && ext.replace("jpeg","jpg") !== currentImageFilters.format) return false;
    const width = Number(item.width), height = Number(item.height), dimension = currentImageFilters.dimensions;
    if (dimension !== "any") {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
      const longest = Math.max(width,height);
      if (dimension === "small" && longest >= 640) return false;
      if (dimension === "medium" && (longest < 640 || longest >= 1600)) return false;
      if (dimension === "large" && longest < 1600) return false;
      if (dimension === "landscape" && width <= height) return false;
      if (dimension === "portrait" && height <= width) return false;
      if (dimension === "square" && width !== height) return false;
    }
    if (currentImageFilters.date !== "any") {
      const published = Date.parse(item.publishedAt || "");
      if (!Number.isFinite(published) || published > now || now - published > windows[currentImageFilters.date]) return false;
    }
    return true;
  });
}
function renderImageFilterBar(items) {
  const bar=document.createElement("div"); bar.className="image-filter-bar"; bar.setAttribute("aria-label","Image filters");
  const choices=[
    ["date","Date",[["any","Any date"],["day","Past 24 hours"],["week","Past week"],["month","Past month"],["year","Past year"]]],
    ["dimensions","Dimensions",[["any","Any dimensions"],["small","Small (<640 px)"],["medium","Medium"],["large","Large (1600+ px)"],["landscape","Landscape"],["portrait","Portrait"],["square","Square"]]],
    ["source","Source",[["all","All sources"],...Array.from(new Set(items.map(x=>x.source).filter(Boolean))).sort().map(x=>[x.toLowerCase(),x])]],
    ["format","Format",[["all","All formats"],...Array.from(new Set(items.map(x=>{const mime=String(x.format||"").toLowerCase();const ext=mime.includes("/")?mime.split("/").pop().replace("jpeg","jpg"):mime;return ext||((String(x.image||"").split("?")[0].match(/\.([a-z0-9]{2,5})$/i)||[])[1]||"").toLowerCase().replace("jpeg","jpg");}).filter(Boolean))).sort().map(x=>[x,x.toUpperCase()])]]
  ];
  for(const [key,label,options] of choices){
    const wrapper=document.createElement("label"); wrapper.className="image-filter";
    const caption=document.createElement("span"); caption.textContent=label;
    const select=document.createElement("select"); select.setAttribute("aria-label",label);
    for(const [value,name] of options){const option=document.createElement("option");option.value=value;option.textContent=name;select.appendChild(option);}
    select.value=currentImageFilters[key]; select.addEventListener("change",()=>{currentImageFilters[key]=select.value;renderImageGallery(items,currentImageFilterQuery);});
    wrapper.append(caption,select);bar.appendChild(wrapper);
  }
  const count=document.createElement("span");count.className="image-filter-count";count.textContent=applyImageFilters(items).length+" of "+items.length+" images";bar.appendChild(count);
  return bar;
}

function renderImageGallery(items, query = "") {
  if (!resultsList) return;

  const originalItems = rankMediaResults(items, query, ["title", "name", "alt"], ["description", "caption"], ["image", "url"]);
  if (currentImageFilterQuery !== query) { currentImageFilterQuery = query; currentImageFilters = {date:"any",dimensions:"any",source:"all",format:"all"}; }
  items = applyImageFilters(originalItems);
  resultsList.replaceChildren();
  resultsList.appendChild(renderImageFilterBar(originalItems));

  if (!Array.isArray(items) || items.length === 0) {
    showMessage(originalItems.length ? "No images match these filters. Change a filter or choose the default options." : "No images were found. Try another search.");
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
    image.fetchPriority = "low";
    image.referrerPolicy = "no-referrer";
    image.title = item.title || "Open full-size image";

    image.addEventListener("error", () => {
      image.remove();
      const fallback = document.createElement("span");
      fallback.className = "image-preview-unavailable";
      fallback.textContent = "Preview unavailable";
      fallback.setAttribute("aria-label", "Image preview unavailable; activate to try the full-size image");
      previewButton.appendChild(fallback);
    });

    previewButton.appendChild(image);

    previewButton.addEventListener("click", () => {
      openImageViewer(fullImageUrl, item.title || "Image preview", sourcePage);
    });

    const title = document.createElement("p");
    title.className = "image-card-title";
    title.textContent = item.title || "Untitled image";

    const sourceMeta = document.createElement("p");
    sourceMeta.className = "image-card-source-meta";
    const imageMeta = [new URL(sourcePage).hostname.replace(/^www\./i, "")];
    const imageDate = item.publishedAt || item.createdAt || item.date || item.uploadedAt;
    if (imageDate && Number.isFinite(Date.parse(imageDate))) imageMeta.push(new Date(imageDate).toLocaleDateString());
    sourceMeta.textContent = imageMeta.join(" · ");

    const license = document.createElement("p");
    license.className = "image-card-license";
    license.textContent = item.license
      ? `License: ${item.license}`
      : "License information unavailable";

    const creator = document.createElement("p");
    creator.className = "image-card-license";
    creator.textContent = item.author ? `Creator: ${item.author}` : "";

    const attribution = document.createElement("p");
    attribution.className = "image-card-license";
    attribution.textContent = item.attribution || "";

    const licenseLinkUrl = safeHttpUrl(item.licenseUrl);
    const licenseLink = licenseLinkUrl ? makeLink(licenseLinkUrl, "License terms ↗") : null;
    const sourceLink = makeLink(sourcePage, "View source ↗");
    sourceLink.className = "image-source-link";

    card.append(previewButton, title, sourceMeta, license);
    if (creator.textContent) card.appendChild(creator);
    if (attribution.textContent) card.appendChild(attribution);
    if (licenseLink) card.appendChild(licenseLink);
    card.appendChild(sourceLink);
    gallery.appendChild(card);
    validCount++;
  }

  if (!validCount) {
    showMessage("No images match these filters. Change a filter or choose the default options.");
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

function isApplicationOriginUrl(value) {
  if (typeof window === "undefined" || !window.location?.origin) return false;
  try {
    return new URL(value).origin === window.location.origin;
  } catch {
    return false;
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
  if (!item || typeof item !== "object" || item.nsfw === true) return null;

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
    source: typeof item.source === "string" && item.source.trim() ? item.source.trim()
      : typeof item.provider === "string" && item.provider.trim() ? item.provider.trim() : getVideoHost(url),
    provider: typeof item.provider === "string" ? item.provider : "",
    sources: Array.isArray(item.sources) ? item.sources.filter(value => typeof value === "string" && value.trim()).slice(0, 8)
      : [typeof item.source === "string" && item.source.trim() ? item.source.trim() : getVideoHost(url)],
    license: typeof item.license === "string" ? item.license.trim().slice(0, 100) : ""
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
    // Never sandbox the application's own origin: allow-scripts plus
    // allow-same-origin can let a same-origin frame escape its sandbox.
    if (isApplicationOriginUrl(watch.href) || isApplicationOriginUrl(embed.href)) {
      return null;
    }
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
      if (data.safeSearch !== true) {
        throw new Error("Video endpoint did not confirm restricted-content filtering");
      }
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
  endpoint.searchParams.set("sort", "-match");
  endpoint.searchParams.set("nsfw", "false");

  const data = await fetchJson(endpoint.toString());
  const items = Array.isArray(data.data) ? data.data : Array.isArray(data.results) ? data.results : [];
  return {
    items: items.filter((item) => item && item.nsfw === false).map((item) => {
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

function createVideoPreviewIndicator(playable) {
  const indicator = document.createElement("span");
  indicator.className = "video-preview-indicator";
  indicator.textContent = playable ? "▶ Preview here" : "↗ Open original source";
  indicator.setAttribute("aria-hidden", "true");
  return indicator;
}

function createVideoThumbnailPlaceholder() {
  const placeholder = document.createElement("span");
  placeholder.className = "video-thumb-placeholder";
  placeholder.textContent = "No thumbnail available";
  return placeholder;
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
        image.fetchPriority = "low";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => {
          image.remove();
          thumbnailButton.appendChild(createVideoThumbnailPlaceholder());
        });
        thumbnailButton.appendChild(image);
      } else {
        thumbnailButton.appendChild(createVideoThumbnailPlaceholder());
      }

      thumbnailButton.appendChild(createVideoPreviewIndicator(!!playableEmbedUrl));

      const playerTarget = document.createElement("div");
      playerTarget.className = "video-player-target";
      const playerButton = document.createElement("button");
      playerButton.type = "button";
      playerButton.className = "video-play-button";
      playerButton.textContent = playableEmbedUrl ? "Play here" : "Playback unavailable here";
      playerButton.disabled = !playableEmbedUrl;
      playerButton.setAttribute("aria-pressed", "false");
      playerButton.addEventListener("click", () => {
        const started = toggleActiveVideoPlayer(video, playerTarget, playerButton, activePlayerState);
        if (started) {
          playerTarget.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });

      const externalLink = makeLink(video.url, "Open original video ↗");
      externalLink.className = "video-original-link";
      thumbnailButton.addEventListener("click", () => {
        if (playableEmbedUrl) {
          // The thumbnail is a play action; use the dedicated Stop button once loaded.
          if (activePlayerState.target !== playerTarget) {
            const started = toggleActiveVideoPlayer(video, playerTarget, playerButton, activePlayerState);
            if (started) {
              playerTarget.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
          }
        } else {
          window.open(video.url, "_blank", "noopener,noreferrer");
        }
      });

      const title = makeLink(video.url, video.title);
      title.className = "video-card-title";
      const source = document.createElement("p");
      source.className = "video-card-source";
      const sourceNames = Array.isArray(video.sources) && video.sources.length
        ? video.sources : [video.source || getVideoHost(video.url)];
      const videoMeta = [];
      if (video.channel) videoMeta.push(video.channel);
      videoMeta.push(...sourceNames);
      if (video.publishedAt && Number.isFinite(Date.parse(video.publishedAt))) {
        videoMeta.push("Uploaded " + new Date(video.publishedAt).toLocaleDateString());
      }
      source.textContent = videoMeta.filter(Boolean).join(" · ");

      card.append(thumbnailButton, playerTarget, title, source);
      if (video.license) {
        const license = document.createElement("p");
        license.className = "video-card-license";
        license.textContent = `Licence: ${video.license}`;
        card.appendChild(license);
      }
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
  if (!allowedCategories.includes(category)) category = "all";

  currentCategory = category;
  searchTabs.forEach(tab => {
    const isActive = tab.dataset.category === category;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });

  const details = categoryDetails[category];
  if (queryInput) queryInput.placeholder = details.placeholder;
  if (searchHint && !isListening) searchHint.textContent = details.hint;
}

function runCurrentQueryInCategory() {
  const hasActiveSearch = Boolean(
    queryInput?.value.trim() && resultsSection && !resultsSection.hidden
  );
  if (!hasActiveSearch || !form) return;
  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
  } else {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }
}

searchTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    const nextCategory = tab.dataset.category;
    if (!nextCategory || nextCategory === currentCategory) return;
    setCategory(nextCategory);
    runCurrentQueryInCategory();
  });

  tab.addEventListener("keydown", event => {
    const tabs = [...searchTabs];
    const currentIndex = tabs.indexOf(tab);
    let nextIndex = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    const changed = nextTab.dataset.category !== currentCategory;
    setCategory(nextTab.dataset.category);
    nextTab.focus();
    nextTab.scrollIntoView?.({ behavior: getPreference("reduceMotion", false) ? "auto" : "smooth", block: "nearest", inline: "nearest" });
    if (changed) runCurrentQueryInCategory();
  });
});

// ========================================
// SEARCH SUBMISSION
// ========================================

let lastSubmittedQuery = "";

if (form && queryInput && resultsList) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const query = queryInput.value.trim();

    if (!query) {
      queryInput.focus();
      return;
    }

    lastSubmittedQuery = query;
    const requestId = ++activeSearchRequest;
    saveSearchHistory(query, currentCategory);
    if (hero) hero.hidden = true;
    if (resultsSection) resultsSection.hidden = false;

    if (resultsTitle) resultsTitle.textContent = query;

    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.classList.add("is-searching");
      submitButton.setAttribute("aria-label", "Searching");
      const label = submitButton.querySelector(".search-button-text");
      if (label) label.textContent = "Searching…";
    }

    const loadingText = currentCategory === "images" ? "Finding matching images…"
      : currentCategory === "videos" ? "Finding matching videos…"
      : currentCategory === "news" ? "Gathering the latest news…"
      : "Searching the web…";
    showSearchLoading(loadingText, requestId);

    // IMAGE SEARCH
    if (currentCategory === "images") {
      try {
        const data = await fetchImageResults(query);
        if (requestId !== activeSearchRequest) return;
        const items = Array.isArray(data.results) ? data.results : [];

        if (resultStatus) {
          resultStatus.textContent =
            `${items.length} image${items.length === 1 ? "" : "s"} ` +
            `found via ${data.source || "the image provider"}.`;
        }

        renderImageGallery(items, query);
      } catch (error) {
        if (requestId !== activeSearchRequest) return;
        if (resultStatus) {
          resultStatus.textContent = "Image search unavailable";
        }

        showMessage(
          `${error.message || "Could not load images."} ` +
          "Check your connection and try again."
        );
      } finally {
        finishSearchRequest(requestId);
      }

      return;
    }

    // NEWS SEARCH: render results inside GOZIE SEARCH.
    if (currentCategory === "news") {
      try {
        const endpoint = new URL("/news", SEARCH_API);
        endpoint.searchParams.set("q", query);
        const data = await fetchJson(endpoint.toString());
        if (requestId !== activeSearchRequest) return;
        const items = Array.isArray(data.results) ? data.results : [];

        if (resultStatus) {
          resultStatus.textContent =
            `${items.length} news result${items.length === 1 ? "" : "s"} from ${data.source || "the news provider"}.`;
        }

        renderNewsResults(items);
      } catch (error) {
        if (requestId !== activeSearchRequest) return;
        if (resultStatus) resultStatus.textContent = "News search unavailable";
        showMessage(
          `${error.message || "Could not load news."} Check your connection and try again.`
        );
      } finally {
        finishSearchRequest(requestId);
      }
      return;
    }

    // VIDEO SEARCH: show real results inside GOZIE SEARCH.
    if (currentCategory === "videos") {
      try {
        const data = await fetchVideoResults(query);
        if (requestId !== activeSearchRequest) return;
        if (resultStatus) {
          resultStatus.textContent =
            `${data.items.length} video${data.items.length === 1 ? "" : "s"} found via ${data.source}.`;
        }
        renderVideoResults(data.items, query);
      } catch (error) {
        if (requestId !== activeSearchRequest) return;
        if (resultStatus) resultStatus.textContent = "Video search unavailable";
        showVideoSearchError(
          query,
          `${error?.message || "Could not load videos."} Check your connection and try again.`
        );
      } finally {
        finishSearchRequest(requestId);
      }
      return;
    }

    // NORMAL WEB SEARCH
    try {
      const endpoint = new URL("/search", SEARCH_API);
      endpoint.searchParams.set("q", query);

      const data = await fetchJson(endpoint.toString());
      if (requestId !== activeSearchRequest) return;

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
      if (requestId !== activeSearchRequest) return;
      if (resultStatus) {
        resultStatus.textContent = "Search unavailable";
      }

      showMessage(
        `${error.message || "Could not reach GOZIE SEARCH."} ` +
        "Please check your connection and try again."
      );
    } finally {
      finishSearchRequest(requestId);
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

const voiceLanguageSelect = document.querySelector("#voice-language");

function getVoiceLanguage() {
  const saved = getPreference("voiceLanguage", "en-NG");
  const supportedChoices = ["en-NG", "en-GB", "en-US", "ig-NG", "yo-NG", "ha-NG"];
  return supportedChoices.includes(saved) ? saved : "en-NG";
}

if (voiceLanguageSelect) {
  voiceLanguageSelect.value = getVoiceLanguage();
  voiceLanguageSelect.addEventListener("change", () => {
    savePreference("voiceLanguage", voiceLanguageSelect.value);
    if (searchHint && !isListening) {
      searchHint.textContent = "Voice language set to " +
        voiceLanguageSelect.options[voiceLanguageSelect.selectedIndex].text +
        ". Browser support for individual languages may vary.";
    }
  });
}

function setVoiceListening(listening, message) {
  isListening = listening;
  if (!voiceButton) return;

  voiceButton.classList.toggle("listening", listening);
  voiceButton.setAttribute("aria-pressed", String(listening));
  voiceButton.setAttribute("aria-label", listening ? "Stop voice search" : "Start voice search");
  voiceButton.title = listening ? "Stop voice search" : "Start voice search";

  const icon = voiceButton.querySelector("span");
  if (icon) icon.textContent = listening ? "■" : "🎙";

  if (searchHint && message) searchHint.textContent = message;
  else if (searchHint && !listening) searchHint.textContent = categoryDetails[currentCategory].hint;
}

function stopVoiceSearch() {
  if (recognition && isListening) {
    try { recognition.stop(); } catch {}
  }
  setVoiceListening(false, "Voice search stopped.");
}

function submitVoiceQuery(transcript) {
  const cleaned = transcript.trim().replace(/\\s+/g, " ");
  if (!cleaned || !queryInput || !form) return false;
  queryInput.value = cleaned;
  if (typeof form.requestSubmit === "function") form.requestSubmit();
  else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  return true;
}

function startVoiceSearch() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    setVoiceListening(false,
      "Voice input is not available in this browser. Try an updated browser that supports speech recognition.");
    return;
  }

  if (isListening) {
    stopVoiceSearch();
    return;
  }

  if (!window.isSecureContext && location.hostname !== "localhost") {
    setVoiceListening(false, "Voice search requires a secure HTTPS connection.");
    return;
  }

  try {
    recognition = new SpeechRecognition();
    recognition.lang = voiceLanguageSelect?.value || getVoiceLanguage();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = "";
    let submitted = false;

    recognition.onstart = () => {
      setVoiceListening(true, "Listening… Speak clearly. Tap the microphone to stop.");
    };

    recognition.onresult = (event) => {
      let interimTranscript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript || "";
        if (result.isFinal) finalTranscript += " " + text;
        else interimTranscript += " " + text;
      }

      const preview = (finalTranscript + " " + interimTranscript).trim();
      if (preview && queryInput) queryInput.value = preview;

      if (searchHint) {
        searchHint.textContent = interimTranscript.trim()
          ? "Hearing: " + preview
          : "Speech captured. Preparing your search…";
      }

      // Wait for recognition.onend before submitting so the browser can
      // deliver every final speech segment, not just the first segment.
    };

    recognition.onnomatch = () => {
      setVoiceListening(false, "I couldn't recognise those words. Please try again or choose another voice language.");
    };

    recognition.onerror = (event) => {
      const messages = {
        "not-allowed": "Microphone access was blocked. Allow microphone permission in your browser settings.",
        "service-not-allowed": "The browser's speech service is unavailable or blocked.",
        "no-speech": "No speech was detected. Tap the microphone and try again.",
        "network": "Speech recognition needs an internet connection in this browser.",
        "audio-capture": "No microphone was detected. Check your device microphone permission.",
        "aborted": "Voice search was cancelled."
      };
      setVoiceListening(false, messages[event.error] || "Voice input encountered an error. Please try again.");
    };

    recognition.onend = () => {
      isListening = false;
      if (voiceButton) {
        voiceButton.classList.remove("listening");
        voiceButton.setAttribute("aria-pressed", "false");
        voiceButton.setAttribute("aria-label", "Start voice search");
        voiceButton.title = "Start voice search";
        const icon = voiceButton.querySelector("span");
        if (icon) icon.textContent = "🎙";
      }
      if (!submitted && finalTranscript.trim()) {
        if (searchHint) searchHint.textContent = "Searching for: " + finalTranscript.trim();
        submitted = submitVoiceQuery(finalTranscript);
        if (!submitted && searchHint) {
          searchHint.textContent = "The spoken search could not be submitted. Please try again.";
        }
      } else if (!submitted && !finalTranscript.trim() && searchHint) {
        searchHint.textContent = "No complete speech was captured. Tap the microphone and try again.";
      }
    };

    recognition.start();
  } catch (error) {
    const message = error?.name === "NotAllowedError"
      ? "Microphone access was denied. Allow microphone permission and try again."
      : "Could not start voice input. Check microphone permission and try again.";
    setVoiceListening(false, message);
  }
}

if (voiceButton) {
  voiceButton.addEventListener("click", startVoiceSearch);
}

// ========================================

// DEVICE PREFERENCES, SIDEBAR AND VIEWS
// ========================================
// Cache the small preference object in memory. Result rendering can create many
// links; reparsing localStorage for every link adds avoidable work on mobile CPUs.
function readPreferences() {
  if (preferenceCache) return preferenceCache;
  try {
    const parsed = JSON.parse(localStorage.getItem("gozie-preferences") || "{}");
    preferenceCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    preferenceCache = {};
  }
  return preferenceCache;
}
function getPreference(key, fallback) {
  const value = readPreferences()[key];
  return value === undefined ? fallback : value;
}
function savePreference(key, value) {
  const prefs = { ...readPreferences(), [key]: value };
  preferenceCache = prefs;
  try { localStorage.setItem("gozie-preferences", JSON.stringify(prefs)); } catch {}
}
window.addEventListener("storage", event => {
  if (event.key === "gozie-preferences" || event.key === null) preferenceCache = null;
});
function readSearchHistory() {
  try {
    const value = JSON.parse(localStorage.getItem("gozie-search-history") || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
function saveSearchHistory(query, category) {
  const previous = readSearchHistory().find(item => item.query.toLowerCase() === query.toLowerCase());
  const history = readSearchHistory().filter(item => item.query.toLowerCase() !== query.toLowerCase());
  history.unshift({ query, category, date: new Date().toISOString(), starred: Boolean(previous?.starred) });
  try { localStorage.setItem("gozie-search-history", JSON.stringify(history.slice(0, 40))); } catch {}
}
function applyTheme(theme) {
  const selectedTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = selectedTheme;
  document.documentElement.style.colorScheme = selectedTheme;
  if (themeIcon) themeIcon.textContent = selectedTheme === "dark" ? "☀" : "☾";
  if (themeLabel) themeLabel.textContent = selectedTheme === "dark" ? "Light mode" : "Dark mode";
  if (themeToggle) {
    const actionLabel = selectedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    themeToggle.setAttribute("aria-label", actionLabel);
    themeToggle.setAttribute("title", actionLabel);
  }
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute("content", selectedTheme === "dark" ? "#080d13" : "#f3f7fb");
}
let savedTheme = null;
try { savedTheme = localStorage.getItem("gozie-theme"); } catch {}
const systemTheme = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
applyTheme(savedTheme === "light" || savedTheme === "dark" ? savedTheme : systemTheme);
themeToggle?.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  syncGoogleTheme(true);
  try { localStorage.setItem("gozie-theme", nextTheme); } catch {}
});
const systemThemeQuery = window.matchMedia?.("(prefers-color-scheme: light)");
systemThemeQuery?.addEventListener?.("change", event => {
  let explicitTheme = null;
  try { explicitTheme = localStorage.getItem("gozie-theme"); } catch {}
  if (explicitTheme !== "light" && explicitTheme !== "dark") {
    applyTheme(event.matches ? "light" : "dark");
    syncGoogleTheme(true);
  }
});

const menuToggle = document.querySelector("#menu-toggle");
const sidebar = document.querySelector("#app-sidebar");
const sidebarBackdrop = document.querySelector("#sidebar-backdrop");
const page = document.querySelector(".page");
const settingsView = document.querySelector("#settings-view");
const historyView = document.querySelector("#history-view");
const historyList = document.querySelector("#history-list");
const googleView = document.querySelector("#google-view");
const googleFrame = document.querySelector("#google-frame");
const googleQueryLabel = document.querySelector("#google-query-label");
const googleEmptyState = document.querySelector("#google-empty-state");
const googleViewStatus = document.querySelector("#google-view-status");
const googleReloadButton = document.querySelector("#google-reload");
function syncGoogleTheme(reloadFrame = false) {
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  if (googleView) googleView.dataset.theme = theme;
  if (googleFrame) {
    // The embedded page may honor the inherited preferred color scheme.
    // Google controls its own page styles, so it may ignore this preference.
    googleFrame.style.colorScheme = theme;
    googleFrame.setAttribute("data-gozie-theme", theme);
    if (reloadFrame && googleFrame.getAttribute("src")) {
      googleFrame.setAttribute("src", googleFrame.getAttribute("src"));
    }
  }
}
let sidebarOpener = null;
function getSidebarFocusableItems() {
  if (!sidebar) return [];
  return [...sidebar.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(element => element.getAttribute("aria-hidden") !== "true");
}
function openSidebar() {
  if (!sidebar || sidebar.classList.contains("is-open")) return;
  sidebarOpener = document.activeElement;
  sidebar.classList.add("is-open");
  sidebar.setAttribute("aria-hidden", "false");
  if (sidebarBackdrop) sidebarBackdrop.hidden = false;
  menuToggle?.setAttribute("aria-expanded", "true");
  menuToggle?.setAttribute("aria-label", "Close navigation menu");
  document.body.classList.add("sidebar-visible");
  requestAnimationFrame(() => (getSidebarFocusableItems()[0] || sidebar).focus());
}
function closeSidebar() {
  if (!sidebar || !sidebar.classList.contains("is-open")) return;
  sidebar.classList.remove("is-open");
  sidebar.setAttribute("aria-hidden", "true");
  if (sidebarBackdrop) sidebarBackdrop.hidden = true;
  menuToggle?.setAttribute("aria-expanded", "false");
  menuToggle?.setAttribute("aria-label", "Open navigation menu");
  document.body.classList.remove("sidebar-visible");
  const returnTarget = sidebarOpener && document.contains(sidebarOpener) ? sidebarOpener : menuToggle;
  requestAnimationFrame(() => returnTarget?.focus());
}
menuToggle?.addEventListener("click", () => {
  if (sidebar?.classList.contains("is-open")) closeSidebar();
  else openSidebar();
});
document.querySelector("#sidebar-close")?.addEventListener("click", closeSidebar);
sidebarBackdrop?.addEventListener("click", closeSidebar);
document.addEventListener("keydown", event => {
  if (!sidebar?.classList.contains("is-open")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeSidebar();
    return;
  }
  if (event.key === "Tab") {
    const items = getSidebarFocusableItems();
    if (!items.length) {
      event.preventDefault();
      sidebar.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === sidebar)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

function showUtilityView(view) {
  closeSidebar();
  if (page) page.classList.toggle("utility-open", Boolean(view));
  if (settingsView) settingsView.hidden = view !== "settings";
  if (historyView) historyView.hidden = view !== "history";
  if (googleView) googleView.hidden = view !== "google";
  if (!view) {
    if (hero) hero.hidden = false;
    if (resultsSection) resultsSection.hidden = true;
    queryInput?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: getPreference("reduceMotion", false) ? "auto" : "smooth" });
  } else {
    window.scrollTo({ top: 0, behavior: "auto" });
  }
}
function buildGoogleSearchUrl(query) {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("igu", "1");
  url.searchParams.set("q", query);
  return url.toString();
}
function openGoogleSearchView() {
  const query = lastSubmittedQuery.trim();
  showUtilityView("google");

  if (!query) {
    if (googleFrame) {
      googleFrame.hidden = true;
      googleFrame.removeAttribute("src");
      delete googleFrame.dataset.query;
    }
    if (googleEmptyState) googleEmptyState.hidden = false;
    if (googleQueryLabel) googleQueryLabel.textContent = "No recent search yet";
    if (googleViewStatus) googleViewStatus.textContent = "Search in GOZIE SEARCH first, then choose Google from the sidebar.";
    if (googleReloadButton) googleReloadButton.disabled = true;
    return;
  }

  if (googleQueryLabel) googleQueryLabel.textContent = 'Google results for "' + query + '"';
  if (googleEmptyState) googleEmptyState.hidden = true;
  syncGoogleTheme();
  if (googleFrame) {
    googleFrame.hidden = false;
    if (googleFrame.dataset.query !== query) {
      googleFrame.dataset.query = query;
      googleFrame.src = buildGoogleSearchUrl(query);
    }
  }
  if (googleViewStatus) googleViewStatus.textContent = "Google is opening inside GOZIE SEARCH. If the results area stays blank, Google may be restricting embedded display.";
  if (googleReloadButton) googleReloadButton.disabled = false;
}
googleReloadButton?.addEventListener("click", () => {
  const query = lastSubmittedQuery.trim();
  if (!query || !googleFrame) return;
  googleFrame.src = buildGoogleSearchUrl(query);
  if (googleViewStatus) googleViewStatus.textContent = 'Reloading Google results for "' + query + '" inside GOZIE SEARCH.';
});
document.querySelector("#sidebar-new-search")?.addEventListener("click", () => {
  showUtilityView(null);
  if (queryInput) queryInput.value = "";
});
document.querySelector("#sidebar-settings")?.addEventListener("click", () => {
  loadSettings();
  showUtilityView("settings");
});
document.querySelector("#sidebar-history")?.addEventListener("click", () => {
  renderSearchHistory();
  showUtilityView("history");
});
document.querySelector("#sidebar-google")?.addEventListener("click", openGoogleSearchView);
document.querySelectorAll("[data-return-home]").forEach(button => button.addEventListener("click", () => showUtilityView(null)));

function loadSettings() {
  const prefs = readPreferences();
  const newTab = document.querySelector("#setting-new-tab");
  const reduced = document.querySelector("#setting-reduced-motion");
  const category = document.querySelector("#setting-default-category");
  if (newTab) newTab.checked = prefs.newTab !== false;
  if (reduced) reduced.checked = Boolean(prefs.reduceMotion);
  if (category) category.value = prefs.defaultCategory || "all";
}
function announceSettings(message) {
  const status = document.querySelector("#settings-status");
  if (status) status.textContent = message;
}
document.querySelector("#setting-new-tab")?.addEventListener("change", event => { savePreference("newTab", event.target.checked); announceSettings("Link-opening preference saved."); });
document.querySelector("#setting-reduced-motion")?.addEventListener("change", event => {
  savePreference("reduceMotion", event.target.checked);
  document.documentElement.classList.toggle("reduce-motion", event.target.checked);
  announceSettings("Motion preference saved.");
});
document.querySelector("#setting-default-category")?.addEventListener("change", event => { savePreference("defaultCategory", event.target.value); announceSettings("Default search category saved."); });
document.querySelector("#clear-search-history")?.addEventListener("click", () => {
  renderSearchHistory();
  showUtilityView("history");
  announceSettings("Choose the searches you want to delete.");
});
function writeSearchHistory(history) {
  try { localStorage.setItem("gozie-search-history", JSON.stringify(history)); } catch {}
}
function removeSearchHistoryItem(item) {
  const history = readSearchHistory();
  const next = history.filter(entry => !(entry.query === item.query && entry.date === item.date));
  writeSearchHistory(next);
  renderSearchHistory();
}
function renderSearchHistory() {
  if (!historyList) return;
  historyList.replaceChildren();
  const history = readSearchHistory();
  const selectionBar = document.createElement("div");
  selectionBar.className = "history-selection-bar";
  const selectAllLabel = document.createElement("label");
  selectAllLabel.className = "history-select-all";
  const selectAll = document.createElement("input");
  selectAll.type = "checkbox";
  selectAll.id = "history-select-all";
  selectAll.setAttribute("aria-label", "Select all search history");
  selectAllLabel.append(selectAll, document.createTextNode("Select all"));
  const deleteSelected = document.createElement("button");
  deleteSelected.type = "button";
  deleteSelected.className = "settings-action danger-action";
  deleteSelected.textContent = "Delete selected";
  deleteSelected.disabled = true;
  selectionBar.append(selectAllLabel, deleteSelected);
  historyList.appendChild(selectionBar);
  const selected = new Set();
  const updateSelection = () => {
    deleteSelected.disabled = selected.size === 0;
    deleteSelected.textContent = selected.size ? "Delete selected (" + selected.size + ")" : "Delete selected";
    selectAll.checked = history.length > 0 && selected.size === history.length;
    selectAll.indeterminate = selected.size > 0 && selected.size < history.length;
  };
  selectAll.addEventListener("change", () => {
    history.forEach((item, index) => selectAll.checked ? selected.add(index) : selected.delete(index));
    historyList.querySelectorAll(".history-select").forEach((checkbox, index) => { checkbox.checked = selected.has(index); });
    updateSelection();
  });
  deleteSelected.addEventListener("click", () => {
    if (!selected.size) return;
    const count = selected.size;
    if (!window.confirm("Delete " + count + " selected search " + (count === 1 ? "history item" : "history items") + "? This cannot be undone.")) return;
    writeSearchHistory(history.filter((item, index) => !selected.has(index)));
    renderSearchHistory();
  });
  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "settings-note";
    empty.textContent = "No searches saved yet.";
    historyList.appendChild(empty);
    return;
  }
  history.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "history-select";
    checkbox.setAttribute("aria-label", "Select " + item.query);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(index); else selected.delete(index);
      updateSelection();
    });
    const open = document.createElement("button");
    open.type = "button";
    open.className = "history-item";
    const name = document.createElement("strong");
    name.textContent = (item.starred ? "★ " : "") + item.query;
    const meta = document.createElement("small");
    meta.textContent = (item.category || "all").toUpperCase() + " · " + new Date(item.date).toLocaleString();
    open.append(name, meta);
    open.addEventListener("click", () => {
      showUtilityView(null);
      queryInput.value = item.query;
      setCategory(item.category || "all");
      form?.requestSubmit();
    });
    const menuWrap = document.createElement("div");
    menuWrap.className = "history-menu-wrap";
    const more = document.createElement("button");
    more.type = "button";
    more.className = "history-more";
    more.textContent = "⋮";
    more.setAttribute("aria-label", "More options for " + item.query);
    more.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "history-item-menu";
    menu.hidden = true;
    const star = document.createElement("button");
    star.type = "button";
    star.textContent = item.starred ? "Remove star" : "Star search";
    star.addEventListener("click", () => {
      const latest = readSearchHistory();
      const target = latest.find(entry => entry.query === item.query && entry.date === item.date);
      if (target) target.starred = !target.starred;
      writeSearchHistory(latest);
      renderSearchHistory();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.className = "history-delete-item";
    remove.addEventListener("click", () => {
      if (!window.confirm('Delete the search "' + item.query + '" from history?')) return;
      removeSearchHistoryItem(item);
    });
    menu.append(star, remove);
    more.addEventListener("click", event => {
      event.stopPropagation();
      const opening = menu.hidden;
      historyList.querySelectorAll(".history-item-menu").forEach(other => { other.hidden = true; });
      historyList.querySelectorAll(".history-more").forEach(button => button.setAttribute("aria-expanded", "false"));
      menu.hidden = !opening;
      more.setAttribute("aria-expanded", String(opening));
    });
    menuWrap.append(more, menu);
    row.append(checkbox, open, menuWrap);
    historyList.appendChild(row);
  });
  updateSelection();
}
loadSettings();
document.documentElement.classList.toggle("reduce-motion", Boolean(getPreference("reduceMotion", false)));
setCategory(["all", "images", "news", "videos"].includes(getPreference("defaultCategory", "all")) ? getPreference("defaultCategory", "all") : "all");
