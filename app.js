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

let currentCategory = "all";
let recognition = null;
let isListening = false;

// ========================================
// SAFE HTML ELEMENT HELPERS
// ========================================

function showMessage(message) {
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

// ========================================
// DISPLAY NORMAL WEB RESULTS
// ========================================

function renderResults(items) {
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
let activeImage = null;

function openImageViewer(imageUrl, title) {
  const safeImageUrl = safeHttpUrl(imageUrl);
  if (!safeImageUrl) return;

  document.querySelector("#image-viewer")?.remove();

  imageZoom = 1;

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
  zoomOut.textContent = "−";
  zoomOut.setAttribute("aria-label", "Zoom out");

  const zoomLabel = document.createElement("span");
  zoomLabel.className = "image-zoom-label";
  zoomLabel.textContent = "100%";

  const zoomIn = document.createElement("button");
  zoomIn.textContent = "+";
  zoomIn.setAttribute("aria-label", "Zoom in");

  const reset = document.createElement("button");
  reset.textContent = "Reset";
  reset.setAttribute("aria-label", "Reset image zoom");

  const close = document.createElement("button");
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
  activeImage = image;

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
    imageZoom = Math.max(
      0.5,
      Math.min(5, imageZoom + amount)
    );
    updateImage();
  }

  function resetImage() {
    imageZoom = 1;
    offsetX = 0;
    offsetY = 0;
    updateImage();
  }

  zoomIn.addEventListener("click", () => zoomBy(0.25));
  zoomOut.addEventListener("click", () => zoomBy(-0.25));
  reset.addEventListener("click", resetImage);

  function closeViewer() {
    viewer.remove();
    document.body.style.overflow = "";
    activeImage = null;
    document.removeEventListener("keydown", handleKey);
  }

  function handleKey(event) {
    if (event.key === "Escape") closeViewer();
    if (event.key === "+" || event.key === "=") zoomBy(0.25);
    if (event.key === "-") zoomBy(-0.25);
  }

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

function renderImageGallery(items) {
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

    previewButton.appendChild(image);

    previewButton.addEventListener("click", () => {
      openImageViewer(
        fullImageUrl,
        item.title || "Image preview"
      );
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

     ========================================
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

  queryInput.placeholder = details.placeholder;

  if (searchHint && !isListening) {
    searchHint.textContent = details.hint;
  }

  queryInput.focus();
}

searchTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setCategory(tab.dataset.category);
  });
});

// ========================================
// SEARCH SUBMISSION
// ========================================

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const query = queryInput.value.trim();

  if (!query) {
    queryInput.focus();
    return;
  }

  hero.hidden = true;
  resultsSection.hidden = false;

  resultsTitle.textContent = query;
  resultStatus.textContent = "Preparing your search…";

  showMessage("GOZIE SEARCH is preparing your results…");

  // Real image search using your Cloudflare Worker.
  if (currentCategory === "images") {
    try {
      const endpoint = new URL("/images", SEARCH_API);
      endpoint.searchParams.set("q", query);

      const response = await fetch(endpoint.toString(), {
        headers: {
          Accept: "application/json"
        }
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ||
          `Image service returned error ${response.status}.`
        );
      }

      const items = data.results || [];

      resultStatus.textContent =
        `${items.length} image${items.length === 1 ? "" : "s"} ` +
        `found via ${data.source || "the image provider"}.`;

      renderImageGallery(items);
    } catch (error) {
      resultStatus.textContent = "Image search unavailable";

      showMessage(
        `${error.message || "Could not load images."} ` +
        "Check your connection and try again."
      );
    }

    return;
  }

  // News and video searches use their external destinations.
  if (currentCategory !== "all") {
    showCategoryDestination(query);
    return;
  }

  // Normal web search uses your existing Worker.
  try {
    const endpoint = new URL("/search", SEARCH_API);
    endpoint.searchParams.set("q", query);

    const response = await fetch(endpoint.toString(), {
      headers: {
        Accept: "application/json"
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
        `Search service returned error ${response.status}.`
      );
    }

    const items = data.results || data.items || [];

    resultStatus.textContent =
      `${items.length} result${items.length === 1 ? "" : "s"} ` +
      `returned by ${data.source || "the search provider"}.`;

    renderResults(items);
  } catch (error) {
    resultStatus.textContent = "Search unavailable";

    showMessage(
      `${error.message || "Could not reach GOZIE SEARCH."} ` +
      "Please check your connection and try again."
    );
  }
});

// ========================================
// QUICK-SEARCH BUTTONS
// ========================================

document.querySelectorAll("[data-query]").forEach((button) => {
  button.addEventListener("click", () => {
    queryInput.value = button.dataset.query || "";
    form.requestSubmit();
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
    searchHint.textContent =
      categoryDetails[currentCategory].hint;
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

      if (transcript) {
        queryInput.value = transcript;
        form.requestSubmit();
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
