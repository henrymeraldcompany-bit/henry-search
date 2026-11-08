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
  await page.goto(baseUrl, { waitUntil:"networkidle" });
  return page;
}
async function mockSearchApis(page, calls) {
  await page.route("https://henry-search-api.henrymeraldcompany.workers.dev/**", async route => {
    const url = new URL(route.request().url());
    calls.push({ host:url.host, path:url.pathname, query:url.searchParams.get("q") });
    if (url.pathname === "/search") return route.fulfill({ json:{ source:"Regression fixture", results:[
      { title:"Regression result", url:"https://example.com/regression", snippet:"A safe test result." },
      { title:"Unsafe URL fixture", url:"javascript:alert(1)", snippet:"This must not render." }
    ] } });
    if (url.pathname === "/news") return route.fulfill({ json:{ source:"Regression news", results:[
      { title:"Regression news headline", url:"https://news.example.com/story", snippet:"News fixture." }
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
test("category tabs update selection and accessible state", async () => {
  const page = await newPage();
  await page.getByRole("button", { name:"Images", exact:true }).click();
  assert.equal(await page.locator(".search-tab[data-category='images']").getAttribute("aria-pressed"), "true");
  assert.match(await page.locator("#query").getAttribute("placeholder"), /images/i);
  await page.getByRole("button", { name:"Videos", exact:true }).click();
  assert.equal(await page.locator(".search-tab[data-category='videos']").getAttribute("aria-pressed"), "true");
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
  assert.equal(identity.choices?.[0]?.message?.content, "My name is Gozie AI.");

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
