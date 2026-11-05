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
      { title:"Regression image", thumbnail_url:"https://images.example.com/thumb.jpg", media_url:"https://images.example.com/image.jpg", page_url:"https://images.example.com/page", license:"CC0", author:"Test author" }
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
  assert.equal(await page.locator(".search-tab").count(), 4);
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
test("image and news searches use their dedicated API endpoints", async () => {
  const page = await newPage(), calls = [];
  await mockSearchApis(page, calls);
  await page.getByRole("button", { name:"Images", exact:true }).click();
  await page.locator("#query").fill("test image");
  await page.getByRole("button", { name:"Search", exact:true }).click();
  await page.getByText("Regression image", { exact:true }).waitFor();
  assert.equal(calls.some(call => call.path === "/images" && call.host.startsWith("gozie-search-media")), true);
  await page.getByRole("button", { name:"News", exact:true }).click();
  await page.locator("#query").fill("test news");
  await page.getByRole("button", { name:"Search", exact:true }).click();
  await page.getByText("Regression news headline", { exact:true }).waitFor();
  assert.equal(calls.some(call => call.path === "/news" && call.host.startsWith("henry-search-api")), true);
  await page.close();
});
test("sidebar, settings, theme and history controls remain functional", async () => {
  const page = await newPage();
  await page.locator("#menu-toggle").click();
  assert.equal(await page.locator("#app-sidebar").getAttribute("aria-hidden"), "false");
  await page.locator("#sidebar-settings").click();
  assert.equal(await page.locator("#settings-view").isVisible(), true);
  await page.locator("#setting-reduced-motion").check();
  assert.match(await page.locator("#settings-status").textContent(), /saved/i);
  await page.locator("#menu-toggle").click();
  await page.locator("#theme-toggle").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.locator("#sidebar-history").click();
  assert.equal(await page.locator("#history-view").isVisible(), true);
  await page.close();
});
