import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = (process.env.PAGES_BASE || "https://henrymeraldcompany-bit.github.io/henry-search")
  .replace(/\/+$/, "");
const trustedPeerTubeHosts = new Set(["peertube.tv", "peer.tube", "spectra.video"]);
const normalizeHost = (hostname) => hostname.toLowerCase().replace(/^www\./, "");

function validatePlayerUrl(playerUrl, sourceUrl) {
  assert.equal(playerUrl.protocol, "https:", "Player URL must use HTTPS");
  assert.equal(playerUrl.username, "", "Player URL must not contain credentials");
  assert.equal(playerUrl.password, "", "Player URL must not contain credentials");
  assert.equal(playerUrl.port, "", "Player URL must not use a custom port");

  const sourceHost = normalizeHost(sourceUrl.hostname);
  const isYouTube = ["youtube.com", "m.youtube.com", "youtu.be"].includes(sourceHost);
  if (isYouTube) {
    const watchId = sourceHost === "youtu.be"
      ? sourceUrl.pathname.split("/").filter(Boolean)[0]
      : sourceUrl.pathname === "/watch"
        ? sourceUrl.searchParams.get("v")
        : sourceUrl.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/)?.[1];
    const playerId = playerUrl.pathname.match(/^\/embed\/([\w-]+)\/?$/)?.[1];
    assert.ok(["youtube.com", "youtube-nocookie.com"].includes(normalizeHost(playerUrl.hostname)),
      "YouTube player must use a supported YouTube host");
    assert.ok(watchId && playerId === watchId, "YouTube player ID must match the source video");
    return "YouTube";
  }

  const sameOrigin = playerUrl.origin === sourceUrl.origin;
  const trustedMirror = trustedPeerTubeHosts.has(normalizeHost(playerUrl.hostname));
  assert.match(playerUrl.pathname, /^\/videos\/embed\/[A-Za-z0-9_-]+\/?$/,
    "PeerTube player must use the canonical embed path");
  assert.ok(sameOrigin || trustedMirror,
    "PeerTube player must use the source origin or a configured search instance");
  return "PeerTube";
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1
  });
  page.setDefaultTimeout(60_000);

  const response = await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  assert.ok(response && response.ok(), "Published GOZIE SEARCH page must load successfully");
  await page.locator("#search-form").waitFor({ state: "visible" });

  await page.locator('[data-category="videos"]').click();
  await page.locator("#query").fill("solar system");
  await page.locator("#search-form button[type='submit']").click();
  await page.locator(".video-card").first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(
    () => document.querySelectorAll(".video-play-button:not([disabled])").length > 0,
    null,
    { timeout: 60_000 }
  );

  const playableButtons = page.locator(".video-play-button:not([disabled])");
  const playableCount = await playableButtons.count();
  const firstButton = playableButtons.nth(0);
  const firstCard = firstButton.locator("xpath=../..");
  const firstFrame = firstCard.locator(".video-player-target iframe");

  await firstButton.click();
  await firstFrame.waitFor({ state: "attached" });
  const details = await firstFrame.evaluate((frame) => ({
    src: frame.src,
    sandbox: frame.getAttribute("sandbox") || "",
    allow: frame.getAttribute("allow") || "",
    referrerPolicy: frame.getAttribute("referrerpolicy") || "",
    allowFullscreen: frame.hasAttribute("allowfullscreen")
  }));
  const sourceHref = await firstCard.locator(".video-card-title").getAttribute("href");
  assert.ok(sourceHref, "Original video link must remain available");
  const playerType = validatePlayerUrl(new URL(details.src), new URL(sourceHref));

  for (const token of ["allow-scripts", "allow-same-origin", "allow-presentation"]) {
    assert.ok(details.sandbox.split(/\s+/).includes(token), "Player sandbox is missing " + token);
  }
  for (const token of ["autoplay", "encrypted-media", "picture-in-picture"]) {
    assert.ok(details.allow.includes(token), "Player permissions are missing " + token);
  }
  assert.equal(details.referrerPolicy, "strict-origin-when-cross-origin");
  assert.equal(details.allowFullscreen, true);

  await firstButton.click();
  await firstFrame.waitFor({ state: "detached" });
  assert.equal((await firstButton.textContent()).trim(), "Play here",
    "Stop control must reset to Play here");

  if (playableCount >= 2) {
    await firstButton.click();
    await firstFrame.waitFor({ state: "attached" });

    const secondButton = playableButtons.nth(1);
    const secondCard = secondButton.locator("xpath=../..");
    await secondButton.click();
    await secondCard.locator(".video-player-target iframe").waitFor({ state: "attached" });
    await page.waitForFunction(
      () => document.querySelectorAll(".video-player-target iframe").length === 1
    );
    assert.equal(await firstCard.locator(".video-player-target iframe").count(), 0,
      "Starting a second player must remove the first iframe");
    assert.equal((await firstButton.textContent()).trim(), "Play here");
    assert.equal((await secondButton.textContent()).trim(), "Stop playback");
  } else {
    await firstButton.click();
    await firstFrame.waitFor({ state: "attached" });
  }

  const dateFilter = page.locator('select[aria-label="Filter videos by upload date"]');
  await dateFilter.selectOption("year");
  await page.waitForFunction(
    () => document.querySelectorAll(".video-player-target iframe").length === 0
  );
  assert.equal(await page.locator(".video-player-target iframe").count(), 0,
    "Changing filters must stop and remove the active player");

  console.log(
    "Browser player smoke passed: " + playerType +
    " iframe mounted with validated URL/sandbox, Stop control worked, " +
    "filter changes stopped playback; " + playableCount + " playable result(s) were available."
  );
} finally {
  await browser.close();
}
