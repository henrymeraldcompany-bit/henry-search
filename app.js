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

    const title = document.createElement("a");
    title.className = "result-title";
    title.href = url;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.textContent = item.title || url;

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
// CATEGORY SEARCH DESTINATIONS
// ========================================

function getCategoryDestination(query) {
  const encodedQuery = encodeURIComponent(query);

  const destinations = {
    images: {
      name: "Image search",
      description:
        "Explore pictures related to your search using Google Images.",
      url: `https://www.google.com/search?tbm=isch&q=${encodedQuery}`
    },

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
    hint: "Search for pictures and images."
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

  if (searchHint) {
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

  // Image, news and video searches use their
  // dedicated external search destinations.
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