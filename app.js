
const form = document.querySelector("#search-form");
const queryInput = document.querySelector("#query");
const hero = document.querySelector("#hero");
const resultsSection = document.querySelector("#results-section");
const resultsTitle = document.querySelector("#results-title");
const resultStatus = document.querySelector("#result-status");
const resultsList = document.querySelector("#results-list");
const newSearchButton = document.querySelector("#new-search");

const themeToggle = document.querySelector("#theme-toggle");
const themeIcon = document.querySelector("#theme-icon");
const themeLabel = document.querySelector(".theme-label");

const SEARCH_API =
  "https://henry-search-api.henrymeraldcompany.workers.dev";

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

function renderResults(items) {
  resultsList.replaceChildren();

  if (!Array.isArray(items) || items.length === 0) {
    showMessage(
      "No results were returned. Try another search. The search provider may not have information for every query."
    );
    return;
  }

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
  }

  if (!resultsList.children.length) {
    showMessage(
      "The provider returned results, but none had a valid web address."
    );
  }
}

// Search
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
  resultStatus.textContent = "Searching…";
  showMessage("Searching with GOZIE SEARCH…");

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
        data.error || `Search service returned error ${response.status}.`
      );
    }

    const items = data.results || data.items || [];

    resultStatus.textContent =
      `${items.length} result${items.length === 1 ? "" : "s"} returned by ${data.source || "the search provider"}.`;

    renderResults(items);
  } catch (error) {
    resultStatus.textContent = "Search unavailable";

    showMessage(
      `${error.message || "Could not reach GOZIE SEARCH."} Please check your connection and try again.`
    );
  }
});

// Return to the homepage
if (newSearchButton) {
  newSearchButton.addEventListener("click", () => {
    resultsSection.hidden = true;
    hero.hidden = false;
    queryInput.focus();
  });
}

// Quick-search buttons
document.querySelectorAll("[data-query]").forEach((button) => {
  button.addEventListener("click", () => {
    queryInput.value = button.dataset.query || "";
    form.requestSubmit();
  });
});

// Light and dark themes
function applyTheme(theme) {
  const selectedTheme = theme === "light" ? "light" : "dark";

  document.documentElement.dataset.theme = selectedTheme;

  if (themeIcon) {
    themeIcon.textContent = selectedTheme === "dark" ? "☀" : "☾";
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
  // Continue with the default theme if storage is unavailable.
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
      // Theme switching still works if storage is unavailable.
    }
  });
}

// Menu button: focus the search box
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
