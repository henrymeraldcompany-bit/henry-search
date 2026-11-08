"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const requireFromGlobal = createRequire(path.join(process.cwd(), "__gozie_frontend_test__.cjs"));
const { chromium } = requireFromGlobal("playwright");

const ROOT = process.cwd();
const MIME = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".webmanifest":"application/manifest+json", ".svg":"image/svg+xml" };
let server, browser, baseUrl;

before(async () => {
  server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const target = path.resolve(ROOT, relative);
    if (!target.startsWith(ROOT + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404).end("Not found"); return;
    }
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    fs.createReadStream(target).pipe(response);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = "http://127.0.0.1:" + server.address().port + "/";
  browser = await chromium.launch({ headless:true, args:["--no-sandbox"] });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
async function newPage() {
  const page = await browser.newPage();
  await page.route("https://images.example.com/**", route => route.fulfill({
    status:200,
    contentType:"image/svg+xml",
    body:"<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'><rect width='2' height='2' fill='#789'/></svg>"
  }));
  await page.route(url => {
    const parsed = new URL(url);
    return parsed.hostname === "henry-search-api.henrymeraldcompany.workers.dev" &&
      parsed.pathname === "/news" && parsed.searchParams.get("q") === "world";
  }, route => route.fulfill({ json:{ source:"Homepage news fixture", results:[
    { title:"World leaders meet for a major international summit", url:"https://news.example.com/world-summit", imageUrl:"https://images.example.com/world-summit.jpg", source:"World Desk", sources:["World Desk"], published:"2026-11-08T08:00:00.000Z", snippet:"A report covering the latest international meeting and its global impact." },
    { title:"New climate report highlights global environment changes", url:"https://news.example.com/climate-report", imageUrl:"https://images.example.com/climate-report.jpg", source:"Climate News", sources:["Climate News"], published:"2026-11-08T07:00:00.000Z", snippet:"A new report looks at environmental changes and the response from researchers." },
    { title:"Global technology developments draw worldwide attention", url:"https://news.example.com/technology", imageUrl:"https://images.example.com/technology.jpg", source:"Technology Desk", sources:["Technology Desk"], published:"2026-11-08T06:00:00.000Z", snippet:"The latest technology developments and their effect on people around the world." }
  ] } }));
  await page.goto(baseUrl, { waitUntil:"networkidle" });
  return page;
}
async function mockSearchApis(page, calls) {
  await page.route("https://henry-search-api.henrymeraldcompany.workers.dev/**", async route => {
    const url = new URL(route.request().url());
    calls.push({ host:url.host, path:url.pathname, query:url.searchParams.get("q") });
    if (url.pathname === "/search") return route.fulfill({ json:{ source:"Regression fixture", results:[
      { title:"Regression result", url:"https://example.com/regression", originalUrl:"https://example.com/original-regression", sources:["Example Publisher"], published:"2026-11-07T10:00:00.000Z", providers:["Regression Provider"], snippet:"A safe test result." },
      { title:"Unsafe URL fixture", url:"javascript:alert(1)", snippet:"This must not render." }
    ] } });
    if (url.pathname === "/news") return route.fulfill({ json:{ source:"Regression news", results:[
      { title:"Regression news headline", url:"https://news.example.com/story", imageUrl:"https://images.example.com/news.jpg", snippet:"News fixture." }
    ] } });
    return route.fulfill({ json:{ results:[] } });
  });
  await page.route("https://gozie-search-media.henrymeraldcompany.workers.dev/**", async route => {
    const url = new URL(route.request().url());
    calls.push({ host:url.host, path:url.pathname, query:url.searchParams.get("q") });
    if (url.pathname === "/images") return route.fulfill({ json:{ source:"Regression images", results:[
      { title:"Regression image", thumbnail:"https://images.example.com/thumb.jpg", image:"https://images.example.com/image.jpg", page:"https://images.example.com/page", license:"CC0", author:"Test author" }
    ] } });
    if (url.pathname === "/videos") return route.fulfill({ json:{ source:"Regression videos", safeSearch:true, results:[] } });
    return route.fulfill({ json:{ results:[] } });
  });
}
test("homepage loads with accessible search controls and no page errors", async () => {
  const page = await newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.reload({ waitUntil:"networkidle" });
  assert.match(await page.title(), /GOZIE SEARCH/);
  await page.locator("#query").waitFor();
  assert.equal(await page.locator(".search-tab").count(), 5);
  assert.equal(await page.locator(".search-tab[aria-pressed='true']").textContent(), "All");
  assert.deepEqual(errors, []);
  await page.close();
});
test("homepage removes the old footer and displays image-led world news", async () => {
  const page = await newPage();
  assert.equal(await page.locator("footer").count(), 0, "the old footer should be removed completely");
  assert.equal(await page.getByText("Search results are provided by external search services.", { exact:false }).count(), 0);
  const cards = page.locator(".home-news-card");
  await cards.first().waitFor();
  assert.equal(await cards.count(), 3);
  assert.equal(await cards.first().locator(".home-news-image-link img").getAttribute("src"), "https://images.example.com/world-summit.jpg");
  assert.equal(await cards.first().locator(".home-news-title").getAttribute("href"), "https://news.example.com/world-summit");
  assert.match(await page.locator("#home-news-title").textContent(), /Latest world news/);
  await page.close();
});

test("sticky search appears after the original search form scrolls off screen and submits", async () => {
  const page = await newPage();
  assert.equal(await page.locator("#sticky-search-shell").isVisible(), false);
  await page.route(url => {
    const parsed = new URL(url);
    return parsed.hostname === "henry-search-api.henrymeraldcompany.workers.dev" &&
      parsed.pathname === "/search";
  }, route => route.fulfill({
    json:{ source:"Sticky search fixture", results:[
      { title:"Sticky search result", url:"https://example.com/sticky", snippet:"Search submitted from the floating search bar." }
    ] }
  }));
  await page.evaluate(() => {
    const search = document.querySelector("#search-form");
    window.scrollTo(0, search.getBoundingClientRect().bottom + window.scrollY + 10);
  });
  await page.locator("#sticky-search-shell:not([hidden])").waitFor();
  assert.equal(await page.locator("#sticky-search-form").evaluate(el => getComputedStyle(el).position), "static");
  await page.locator("#sticky-query").fill("world from sticky bar");
  await page.locator("#sticky-search-form button[type='submit']").click();
  await page.getByText("Sticky search result", { exact:true }).waitFor();
  assert.equal(await page.locator("#query").inputValue(), "world from sticky bar");
  await page.close();
});

test("category tabs update selection and accessible state", async () => {
  const page = await newPage();
  await page.getByRole("button", { name:"Images", exact:true }).click();
  assert.equal(await page.locator(".search-tab[data-category='images']").getAttribute("aria-pressed"), "true");
  assert.match(await page.locator("#query").getAttribute("placeholder"), /images/i);
  await page.getByRole("button", { name:"Videos", exact:true }).click();
  assert.equal(await page.locator(".search-tab[data-category='videos']").getAttribute("aria-pressed"), "true");
  await page.close();
});
test("All search result source, date and website metadata stay on one line on mobile", async () => {
  const page = await newPage(), calls = [];
  await page.setViewportSize({ width:360, height:800 });
  await mockSearchApis(page, calls);
  await page.locator("#query").fill("metadata line test");
  await page.getByRole("button", { name:"Search", exact:true }).click();
  const metadata = page.locator(".web-result-card .result-attribution");
  await metadata.waitFor();
  const layout = await metadata.evaluate(el => ({
    display:getComputedStyle(el).display,
    whiteSpace:getComputedStyle(el).whiteSpace,
    height:el.getBoundingClientRect().height,
    lineHeight:parseFloat(getComputedStyle(el).lineHeight),
    text:el.innerText
  }));
  assert.equal(layout.display, "block");
  assert.equal(layout.whiteSpace, "nowrap");
  assert.ok(layout.height <= layout.lineHeight + 1, "metadata should occupy one visual line");
  assert.match(layout.text, /Example Publisher/);
  assert.match(layout.text, /Website/);
  assert.equal(await metadata.locator(".result-source-link").getAttribute("href"), "https://example.com/original-regression");
  await page.close();
});

test("web search renders safe results and stores local history", async () => {
  const page = await newPage(), calls = [];
  await mockSearchApis(page, calls);
  await page.locator("#query").fill("regression test");
  await page.getByRole("button", { name:"Search", exact:true }).click();
  await page.getByText("Regression result", { exact:true }).waitFor();
  assert.equal(await page.locator(".web-result-card").count(), 1);
  assert.equal(await page.locator("#results-title").textContent(), "regression test");
  assert.equal(await page.locator("#results-list img").count(), 0);
  assert.equal(calls.some(call => call.path === "/search" && call.query === "regression test"), true);
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem("gozie-search-history") || "[]"));
  assert.equal(history[0].query, "regression test");
  await page.close();
});
test("image and news searches reach their dedicated API endpoints", async () => {
  const page = await newPage(), calls = [];
  await mockSearchApis(page, calls);
  await page.getByRole("button", { name:"Images", exact:true }).click();
  await page.locator("#query").fill("test image");
  const imageResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.hostname === "gozie-search-media.henrymeraldcompany.workers.dev" && url.pathname === "/images";
  });
  await page.getByRole("button", { name:"Search", exact:true }).click();
  assert.equal((await imageResponse).status(), 200);
  assert.equal(calls.some(call => call.path === "/images" && call.host.startsWith("gozie-search-media")), true);

  await page.getByRole("button", { name:"News", exact:true }).click();
  await page.locator("#query").fill("test news");
  const newsResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.hostname === "henry-search-api.henrymeraldcompany.workers.dev" && url.pathname === "/news";
  });
  await page.getByRole("button", { name:"Search", exact:true }).click();
  assert.equal((await newsResponse).status(), 200);
  assert.equal(calls.some(call => call.path === "/news" && call.host.startsWith("henry-search-api")), true);
  await page.close();
});
test("sidebar, settings, theme and history controls remain functional", async () => {
  const page = await newPage();
  await page.locator("#menu-toggle").click();
  assert.equal(await page.locator("#app-sidebar").getAttribute("aria-hidden"), "false");
  const sidebarPosition = await page.locator("#app-sidebar").evaluate(el => {
    const style = getComputedStyle(el);
    return { left: style.left, right: style.right, transform: style.transform };
  });
  assert.equal(sidebarPosition.right, "0px", "sidebar should be anchored to the right edge");
  assert.notEqual(sidebarPosition.left, "0px", "sidebar should not be anchored to the left edge");
  await page.locator("#sidebar-settings").click();
  assert.equal(await page.locator("#settings-view").isVisible(), true);
  await page.locator("#setting-reduced-motion").check();
  assert.match(await page.locator("#settings-status").textContent(), /saved/i);
  await page.locator("#menu-toggle").click();
  const previousTheme = await page.locator("html").getAttribute("data-theme");
  await page.locator("#theme-toggle").click();
  assert.notEqual(await page.locator("html").getAttribute("data-theme"), previousTheme);
  await page.locator("#sidebar-history").click();
  assert.equal(await page.locator("#history-view").isVisible(), true);
  await page.close();
});

test("history supports starring, individual deletion and confirmed bulk deletion", async () => {
  const page = await newPage();
  await page.evaluate(() => localStorage.setItem("gozie-search-history", JSON.stringify([
    { query:"first saved search", category:"all", date:"2026-11-01T10:00:00.000Z" },
    { query:"second saved search", category:"news", date:"2026-11-02T10:00:00.000Z" },
    { query:"third saved search", category:"images", date:"2026-11-03T10:00:00.000Z" }
  ])));
  await page.reload({ waitUntil:"networkidle" });
  await page.locator("#menu-toggle").click();
  await page.locator("#sidebar-history").click();
  await page.getByRole("button", { name:"More options for first saved search" }).click();
  await page.getByRole("button", { name:"Star search" }).click();
  let history = await page.evaluate(() => JSON.parse(localStorage.getItem("gozie-search-history") || "[]"));
  assert.equal(history[0].starred, true);
  assert.match(await page.locator(".history-item").first().innerText(), /★ first saved search/);

  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name:"More options for second saved search" }).click();
  await page.getByRole("button", { name:"Delete", exact:true }).click();
  history = await page.evaluate(() => JSON.parse(localStorage.getItem("gozie-search-history") || "[]"));
  assert.deepEqual(history.map(item => item.query), ["first saved search", "third saved search"]);

  await page.locator("#history-select-all").check();
  assert.equal(await page.locator(".history-select:checked").count(), 2);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name:/Delete selected/ }).click();
  history = await page.evaluate(() => JSON.parse(localStorage.getItem("gozie-search-history") || "[]"));
  assert.equal(history.length, 0);
  assert.match(await page.locator("#history-list").innerText(), /No searches saved yet/);
  await page.close();
});

test("Google sidebar opens Google results inside GOZIE SEARCH for the last searched query", async () => {
  const page = await newPage(), calls = [];
  await mockSearchApis(page, calls);
  await page.route("https://www.google.com/**", route => route.fulfill({
    status:200,
    contentType:"text/html; charset=utf-8",
    body:"<!doctype html><html><body><main id='google-frame-fixture'>Google embedded test results <a id='result-link' href='https://example.com/in-app-result'>Open result inside this panel</a></main></body></html>"
  }));

  await page.locator("#query").fill("GOZIE in-app Google test");
  await page.getByRole("button", { name:"Search", exact:true }).click();
  await page.getByText("Regression result", { exact:true }).waitFor();

  const mainPageUrl = page.url();
  const googleResponse = page.waitForResponse(response =>
    response.url().startsWith("https://www.google.com/search?") && response.status() === 200
  );
  await page.locator("#menu-toggle").click();
  await page.getByRole("button", { name:"Google", exact:true }).click();
  assert.equal(await page.locator("#google-view").isVisible(), true);
  assert.equal(await page.locator("#google-frame").isVisible(), true);
  assert.equal(await page.locator("#google-empty-state").isVisible(), false);

  const googleUrl = new URL(await page.locator("#google-frame").getAttribute("src"));
  assert.equal(googleUrl.hostname, "www.google.com");
  assert.equal(googleUrl.pathname, "/search");
  assert.equal(googleUrl.searchParams.get("igu"), "1");
  assert.equal(googleUrl.searchParams.get("q"), "GOZIE in-app Google test");
  assert.equal(page.url(), mainPageUrl, "opening Google must not navigate the GOZIE page");
  assert.equal(page.context().pages().length, 1, "Google must remain inside the current app tab");
  await googleResponse;
  await page.frameLocator("#google-frame").locator("#google-frame-fixture").waitFor();
  const sandboxTokens = await page.locator("#google-frame").getAttribute("sandbox");
  assert.ok(sandboxTokens.includes("allow-scripts"));
  assert.ok(!sandboxTokens.includes("allow-top-navigation"), "embedded result pages must not navigate the whole GOZIE tab");
  assert.ok(!sandboxTokens.includes("allow-popups"), "embedded result pages must not open external pop-up tabs");
  await page.route("https://example.com/in-app-result", route => route.fulfill({
    status:200,
    contentType:"text/html; charset=utf-8",
    body:"<!doctype html><html><body><h1 id='in-app-destination'>Destination loaded inside GOZIE</h1></body></html>"
  }));
  await page.frameLocator("#google-frame").locator("#result-link").click();
  await page.frameLocator("#google-frame").locator("#in-app-destination").waitFor();
  assert.equal(page.url(), mainPageUrl, "opening a result must keep the main GOZIE tab in place");
  assert.equal(page.context().pages().length, 1, "opening a result must not create another browser tab");

  assert.match(await page.locator("#google-query-label").textContent(), /GOZIE in-app Google test/);
  const initialTheme = await page.locator("html").getAttribute("data-theme");
  assert.equal(await page.locator("#google-view").getAttribute("data-theme"), initialTheme);
  assert.equal(await page.locator("#google-frame").evaluate(el => el.style.colorScheme), initialTheme);
  const nextTheme = initialTheme === "dark" ? "light" : "dark";
  await page.locator("#menu-toggle").click();
  await page.locator("#theme-toggle").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), nextTheme);
  assert.equal(await page.locator("#google-view").getAttribute("data-theme"), nextTheme);
  assert.equal(await page.locator("#google-frame").evaluate(el => el.style.colorScheme), nextTheme);
  const googleSurface = await page.locator(".google-frame-content").evaluate(el => getComputedStyle(el).backgroundColor);
  assert.equal(googleSurface, nextTheme === "dark" ? "rgb(16, 24, 32)" : "rgb(255, 255, 255)");
  await page.close();
});

test("Google sidebar explains that a search is needed before opening Google", async () => {
  const page = await newPage();
  const mainPageUrl = page.url();
  await page.locator("#menu-toggle").click();
  await page.getByRole("button", { name:"Google", exact:true }).click();
  assert.equal(await page.locator("#google-view").isVisible(), true);
  assert.equal(await page.locator("#google-empty-state").isVisible(), true);
  assert.equal(await page.locator("#google-frame").isVisible(), false);
  assert.equal(await page.locator("#google-frame").getAttribute("src"), null);
  assert.match(await page.locator("#google-view-status").textContent(), /search in GOZIE SEARCH first/i);
  assert.equal(page.url(), mainPageUrl);
  await page.close();
});

test("integrates all four search categories through their production API routes", async () => {
  const page = await newPage(), calls = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await mockSearchApis(page, calls);

  const searchIn = async (category, query, expectedPath, expectedHost) => {
    await page.locator("#query").fill(query);
    const tab = page.locator(`.search-tab[data-category='${category}']`);
    const categoryAlreadyActive = await tab.getAttribute("aria-pressed") === "true";
    const response = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.hostname === expectedHost && url.pathname === expectedPath;
    });
    if (categoryAlreadyActive) {
      await page.locator("#search-form button[type='submit']").click();
    } else {
      // Changing categories automatically reruns the current query; fill it first
      // so the category-switch request is the integration request under test.
      await tab.click();
    }
    assert.equal((await response).status(), 200, `${category} route should return HTTP 200`);
    await page.waitForFunction(() => document.querySelector("#results-list")?.getAttribute("aria-busy") === "false");
  };

  await searchIn("all", "regression", "/search", "henry-search-api.henrymeraldcompany.workers.dev");
  assert.equal(await page.locator(".web-result-card").count(), 1);

  await searchIn("images", "regression image", "/images", "gozie-search-media.henrymeraldcompany.workers.dev");
  assert.equal(await page.locator(".image-card").count(), 1, `Image result card did not render. Status: ${await page.locator("#result-status").innerText()}. Results: ${await page.locator("#results-list").innerText()}`);
  assert.equal(await page.locator(".image-card-title").textContent(), "Regression image");
  assert.equal(await page.locator(".image-source-link").count(), 1);

  await searchIn("news", "regression news", "/news", "henry-search-api.henrymeraldcompany.workers.dev");
  assert.equal(await page.locator(".news-preview-card").count(), 1);

  await searchIn("videos", "regression video", "/videos", "gozie-search-media.henrymeraldcompany.workers.dev");
  assert.match(await page.locator("#results-list").innerText(), /No matching videos|Search YouTube/);

  const history = await page.evaluate(() => JSON.parse(localStorage.getItem("gozie-search-history") || "[]"));
  for (const category of ["all", "images", "news", "videos"]) {
    assert.equal(history.some(item => item.category === category), true, `${category} searches should be saved in history; actual history: ${JSON.stringify(history)}`);
  }
  assert.deepEqual(errors, []);
  assert.equal(calls.filter(call => ["/search", "/images", "/news", "/videos"].includes(call.path)).length, 4);
  await page.close();
});



test("AI Mode opens a chat workspace and sends prompts to the GOZIE AI Worker", async () => {
  const page = await newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://gozie-search-ai.henrymeraldcompany.workers.dev/**", async route => {
    const body = route.request().postDataJSON();
    assert.equal(body.messages.at(-1).role, "user");
    assert.match(JSON.stringify(body.messages.at(-1).content), /Who are you/);
    await route.fulfill({ json:{ id:"test", choices:[{ index:0, message:{ role:"assistant", content:"My name is Gozie AI." }, finish_reason:"stop" }] } });
  });
  await page.locator("#ai-mode-tab").click();
  assert.equal(await page.locator("#ai-mode-view").isVisible(), true);
  assert.equal(await page.locator("#ai-category-slot .search-tabs .search-tab").first().getAttribute("id"), "ai-mode-tab");
  assert.equal((await page.locator("#ai-category-slot .search-tabs .search-tab").first().textContent()).trim(), "AI Mode");
  assert.equal((await page.locator(".ai-history-bottom").textContent()).includes("Henry Cee"), false);
  assert.equal((await page.locator(".ai-chat-topbar").textContent()).includes("Cloudflare"), false);
  await page.locator("#ai-mobile-history").click();
  assert.equal(await page.locator("#ai-mode-view").evaluate(el => el.classList.contains("history-open")), true);
  await page.locator("#ai-close-history").click();
  assert.equal(await page.locator("#ai-mode-view").evaluate(el => el.classList.contains("history-open")), false);
  await page.locator("#ai-prompt").fill("Who are you?");
  await page.locator("#ai-send-button").click();
  await page.getByText("My name is Gozie AI.", { exact:true }).waitFor();
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem("gozie-ai-mode-history") || "[]"));
  assert.equal(history.length, 1);
  assert.equal(history[0].messages.length, 2);
  assert.deepEqual(errors, []);
  await page.close();
});


test("AI Mode sidebar button opens the original drawer and its links exit AI Mode correctly", async () => {
  const page = await newPage();
  await page.setViewportSize({ width:390, height:844 });
  await page.locator("#ai-mode-tab").click();
  assert.equal(await page.locator("#ai-mode-view").isVisible(), true);
  const layers = await page.evaluate(() => ({
    ai:Number(getComputedStyle(document.querySelector("#ai-mode-view")).zIndex),
    sidebar:Number(getComputedStyle(document.querySelector("#app-sidebar")).zIndex)
  }));
  await page.locator("#ai-open-app-sidebar").click();
  assert.equal(await page.locator("#app-sidebar").getAttribute("aria-hidden"), "false");
  assert.equal(await page.locator("#app-sidebar").isVisible(), true);
  assert.ok(layers.sidebar > layers.ai, "original sidebar must layer above AI Mode");
  await page.locator("#sidebar-history").click();
  assert.equal(await page.locator("#ai-mode-view").isVisible(), false);
  assert.equal(await page.locator("#history-view").isVisible(), true);
  assert.equal(await page.locator("#app-sidebar").getAttribute("aria-hidden"), "true");
  await page.close();
});

test("AI Mode automatically runs a query already entered in the main search box", async () => {
  const page = await newPage();
  let received = "";
  await page.route("https://gozie-search-ai.henrymeraldcompany.workers.dev/**", async route => {
    const body = route.request().postDataJSON();
    received = JSON.stringify(body.messages);
    await route.fulfill({ json:{ id:"test-auto", choices:[{ index:0, message:{ role:"assistant", content:"My name is Gozie AI." }, finish_reason:"stop" }] } });
  });
  await page.locator("#query").fill("Who are you?");
  await page.locator("#ai-mode-tab").click();
  await page.getByText("My name is Gozie AI.", { exact:true }).waitFor();
  assert.match(received, /Who are you/);
  await page.close();
});



test("GOZIE AI carries an accurate GOZIE SEARCH product knowledge base", () => {
  const worker = fs.readFileSync(path.join(ROOT, "ai-worker/worker.js"), "utf8");
  for (const fact of [
    "GOZIE SEARCH PRODUCT KNOWLEDGE",
    "All: ordinary web search",
    "Images: image gallery",
    "Videos: video discovery",
    "News: searches current articles",
    "AI Mode: ask follow-up questions",
    "Conversation history is saved in this browser on this device",
    "up to four frames",
    "speech-to-text transcription",
    "Google item in the navigation menu",
    "robots.txt",
    "does not bypass sign-in, paywalls, CAPTCHAs",
    "Do not expose internal Worker names"
  ]) {
    assert.ok(worker.includes(fact), "GOZIE AI knowledge must include: " + fact);
  }
  assert.match(worker, /GOZIE_SEARCH_KNOWLEDGE \+ \(sourceContext/);
});

test("GOZIE AI Worker is online and accepts GOZIE SEARCH cross-origin requests", async () => {
  const endpoint = "https://gozie-search-ai.henrymeraldcompany.workers.dev";
  const origin = "https://henrymeraldcompany-bit.github.io";
  const healthResponse = await fetch(endpoint + "/health", { signal:AbortSignal.timeout(25000) });
  assert.equal(healthResponse.status, 200, "GOZIE AI Worker health endpoint should respond");
  const health = await healthResponse.json();
  assert.equal(health.status, "online");
  assert.equal(health.identity, "Gozie AI");

  const preflight = await fetch(endpoint + "/v1/chat/completions", {
    method:"OPTIONS",
    headers:{
      Origin:origin,
      "Access-Control-Request-Method":"POST",
      "Access-Control-Request-Headers":"content-type"
    },
    signal:AbortSignal.timeout(25000)
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);

  const identityResponse = await fetch(endpoint + "/v1/chat/completions", {
    method:"POST",
    headers:{ Origin:origin, "Content-Type":"application/json" },
    body:JSON.stringify({messages:[{role:"user",content:"Who are you?"}]})
  });
  assert.equal(identityResponse.status, 200);
  const identity = await identityResponse.json();
  const identityAnswer=identity.choices?.[0]?.message?.content||"";
  assert.equal(identityAnswer,"GOZIE AI is the assistant built into GOZIE SEARCH. It was created and developed by Henry Cee.");
  assert.doesNotMatch(identityAnswer,/I am Gozie AI|My name is Gozie AI/i);

  const productResponse = await fetch(endpoint + "/v1/chat/completions", {
    method:"POST",
    headers:{ Origin:origin, "Content-Type":"application/json" },
    body:JSON.stringify({web_search:false,messages:[{role:"user",content:"What are all the modes in GOZIE SEARCH?"}]})
  });
  assert.equal(productResponse.status, 200);
  const product = await productResponse.json();
  const answer = product.choices?.[0]?.message?.content || "";
  for (const mode of ["AI Mode", "All", "Images", "Videos", "News"]) {
    assert.ok(answer.includes(mode), "GOZIE AI should accurately explain the " + mode + " mode. Answer: " + answer);
  }

  const reasoningResponse = await fetch(endpoint + "/v1/chat/completions", {
    method:"POST",
    headers:{ Origin:origin, "Content-Type":"application/json" },
    body:JSON.stringify({web_search:false,messages:[{role:"user",content:"What is 7 multiplied by 8? Give only the number."}]})
  });
  assert.equal(reasoningResponse.status,200);
  const reasoning=await reasoningResponse.json();
  const reasoningAnswer=reasoning.choices?.[0]?.message?.content||"";
  assert.match(reasoningAnswer,/56/,"GOZIE AI should answer the actual question, not return identity boilerplate.");
  assert.doesNotMatch(reasoningAnswer,/I am Gozie AI|My name is Gozie AI/i);

  const creatorResponse=await fetch(endpoint+"/v1/chat/completions",{
    method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},
    body:JSON.stringify({web_search:false,messages:[{role:"user",content:"Who created you?"}]})
  });
  assert.equal(creatorResponse.status,200);
  const creator=await creatorResponse.json();
  const creatorAnswer=creator.choices?.[0]?.message?.content||"";
  assert.match(creatorAnswer,/created and developed by Henry Cee/i);
  assert.doesNotMatch(creatorAnswer,/I am Gozie AI|My name is Gozie AI/i);
});


test("AI Mode history supports select-all, cancel, selected deletion, pin and long-press", async () => {
  const page=await newPage();
  await page.route("https://gozie-search-ai.henrymeraldcompany.workers.dev/**",async route=>{
    const body=route.request().postDataJSON();
    const last=body.messages.at(-1);
    const prompt=typeof last.content==="string"?last.content:(Array.isArray(last.content)?last.content.find(part=>part.type==="text")?.text:"")||"attachment";
    await route.fulfill({json:{id:"ai-history-fixture",sources:[{title:"Example source",url:"https://example.com/grounded-answer"}],choices:[{index:0,message:{role:"assistant",content:"Answer for "+prompt},finish_reason:"stop"}]}});
  });
  await page.locator("#ai-mode-tab").click();
  await page.locator("#ai-prompt").fill("First conversation");
  await page.locator("#ai-send-button").click();
  await page.getByText("Answer for First conversation",{exact:true}).waitFor();
  await page.getByRole("link",{name:"1. Example source"}).waitFor();
  await page.locator("#ai-new-chat-top").click();
  await page.locator("#ai-prompt").fill("Second conversation");
  await page.locator("#ai-send-button").click();
  await page.getByText("Answer for Second conversation",{exact:true}).waitFor();
  await page.locator("#ai-mobile-history").click();

  const first=page.getByRole("button",{name:"Open conversation: First conversation"});
  await first.dispatchEvent("pointerdown",{button:0,pointerId:1,pointerType:"touch"});
  await page.waitForTimeout(650);
  await first.dispatchEvent("pointerup",{button:0,pointerId:1,pointerType:"touch"});
  await page.getByRole("button",{name:"Pin chat",exact:true}).waitFor();
  await page.getByRole("button",{name:"Pin chat",exact:true}).click();
  let chats=await page.evaluate(()=>JSON.parse(localStorage.getItem("gozie-ai-mode-history")||"[]"));
  assert.equal(chats.find(chat=>chat.title==="First conversation").pinned,true);
  assert.equal(chats[0].title,"First conversation");

  await page.locator("#ai-clear-history").click();
  assert.equal(await page.locator("#ai-select-all-chats").isVisible(),true);
  await page.locator("#ai-select-all-chats").check();
  assert.equal(await page.locator(".ai-history-select:checked").count(),2);
  await page.getByRole("button",{name:"Cancel",exact:true}).click();
  assert.equal(await page.locator("#ai-select-all-chats").count(),0);

  await page.locator("#ai-clear-history").click();
  await page.locator(".ai-history-select").last().check();
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Delete selected"}).click();
  chats=await page.evaluate(()=>JSON.parse(localStorage.getItem("gozie-ai-mode-history")||"[]"));
  assert.equal(chats.length,1);
  await page.close();
});

test("AI Mode colors follow GOZIE SEARCH light and dark themes",async()=>{
  const page=await newPage();
  const getPanel=()=>page.locator(".ai-chat-main").evaluate(el=>getComputedStyle(el).backgroundColor);
  const getRoot=()=>page.evaluate(()=>{
    const value=getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    const probe=document.createElement("div");probe.style.backgroundColor=value;document.body.append(probe);
    const result=getComputedStyle(probe).backgroundColor;probe.remove();return result;
  });
  await page.evaluate(()=>localStorage.setItem("gozie-theme","dark"));
  await page.reload({waitUntil:"networkidle"});
  await page.locator("#ai-mode-tab").click();
  const dark=await getPanel();
  assert.equal(dark,await getRoot());
  await page.evaluate(()=>localStorage.setItem("gozie-theme","light"));
  await page.reload({waitUntil:"networkidle"});
  await page.locator("#ai-mode-tab").click();
  const light=await getPanel();
  assert.equal(light,await getRoot());
  assert.notEqual(light,dark);
  await page.close();
});

test("GOZIE AI uses a stronger free-plan-compatible model and question-first prompts",()=>{
  const worker=fs.readFileSync(path.join(ROOT,"ai-worker/worker.js"),"utf8");
  assert.match(worker,/const MODEL = "@cf\/zai-org\/glm-4\.7-flash"/);
  assert.match(worker,/Always answer the user's actual question first/);
  assert.match(worker,/GOZIE SEARCH LIVE WEB RESULTS/);
  assert.match(worker,/Cite factual claims supported by search results with \[1\]/);
});

test("mobile layouts remain usable without horizontal overflow at common phone widths", async () => {
  for (const width of [320, 360, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 800 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseUrl, { waitUntil:"networkidle" });

    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth
    }));
    assert.equal(dimensions.viewport, width, `Mobile viewport should be ${width}px`);
    assert.ok(dimensions.document <= width + 1, `Document overflows at ${width}px: ${JSON.stringify(dimensions)}`);
    assert.ok(dimensions.body <= width + 1, `Body overflows at ${width}px: ${JSON.stringify(dimensions)}`);

    const query = page.locator("#query");
    const submit = page.locator("#search-form button[type='submit']");
    const tabs = page.locator(".search-tab");
    assert.equal(await query.isVisible(), true, `Search input should be visible at ${width}px`);
    assert.equal(await submit.isVisible(), true, `Search button should be visible at ${width}px`);
    assert.equal(await tabs.count(), 5);
    for (let index = 0; index < await tabs.count(); index++) {
      assert.equal(await tabs.nth(index).isVisible(), true, `Search category tab ${index} should be visible at ${width}px`);
    }

    const searchBox = await query.boundingBox();
    const submitBox = await submit.boundingBox();
    assert.ok(searchBox && searchBox.width > 0 && searchBox.height >= 32, `Search input has unusable dimensions at ${width}px`);
    assert.ok(submitBox && submitBox.width > 0 && submitBox.height >= 32, `Search button has unusable dimensions at ${width}px`);

    await page.locator("#menu-toggle").click();
    assert.equal(await page.locator("#app-sidebar").getAttribute("aria-hidden"), "false");
    await page.locator("#sidebar-close").click();
    assert.equal(await page.locator("#app-sidebar").getAttribute("aria-hidden"), "true");
    assert.deepEqual(errors, [], `No browser errors expected at ${width}px`);
    await page.close();
  }
});
