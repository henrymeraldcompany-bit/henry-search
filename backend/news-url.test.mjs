import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNewsArticleUrl } from "./news-url.js";

test("unwraps Bing News tracking redirects to their HTTPS publisher article", () => {
  const target = "https://www.unesco.org/sdg4education2030/en/articles/education-agenda?ref=feed";
  const wrapped = "http://www.bing.com/news/apiclick.aspx?ref=FexRss&url=" +
    encodeURIComponent(target) + "&c=123&mkt=en-us";
  assert.equal(normalizeNewsArticleUrl(wrapped), target);
});

test("leaves ordinary publisher URLs unchanged", () => {
  assert.equal(
    normalizeNewsArticleUrl("https://news.example/story?source=rss"),
    "https://news.example/story?source=rss"
  );
});

test("rejects unsafe or missing Bing redirect destinations", () => {
  assert.equal(
    normalizeNewsArticleUrl("http://www.bing.com/news/apiclick.aspx?url=" + encodeURIComponent("http://news.example/story")),
    ""
  );
  assert.equal(
    normalizeNewsArticleUrl("http://www.bing.com/news/apiclick.aspx?url=" + encodeURIComponent("javascript:alert(1)")),
    ""
  );
  assert.equal(normalizeNewsArticleUrl("http://www.bing.com/news/apiclick.aspx"), "");
  assert.equal(normalizeNewsArticleUrl("not a URL"), "");
});
