import test from "node:test";
import assert from "node:assert/strict";
import { renderPublicIndexHtml } from "../server/public-index.js";

test("homepage exposes localized product information to crawlers", () => {
  for (const lang of ["zh-CN", "en"]) {
    const html = renderPublicIndexHtml('<html lang="zh-CN"><head><!-- HOSTLET_META_START --><!-- HOSTLET_META_END --></head></html>', { origin: "https://example.test", lang });
    const match = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/);
    assert.ok(match);
    const data = JSON.parse(match[1]);
    assert.equal(data.name, "Hostlet");
    assert.equal(data.url, `https://example.test/${lang === "en" ? "?lang=en" : ""}`);
    assert.equal(data.creator.name, "Revolves");
    assert.equal(data.inLanguage, lang);
    assert.ok(data.description);
  }
});

test("homepage includes readable localized content without JavaScript", () => {
  const template = '<html lang="zh-CN"><head><!-- HOSTLET_META_START --><!-- HOSTLET_META_END --></head><body><div id="root"></div></body></html>';
  const zh = renderPublicIndexHtml(template, { origin: "https://example.test" });
  const en = renderPublicIndexHtml(template, { origin: "https://example.test", lang: "en" });
  assert.match(zh, /Hostlet 是什么/);
  assert.match(en, /What is Hostlet/);
  assert.match(en, /Application scripts run in the visitor&#39;s browser/);
  assert.match(en, /href="\/\?lang=zh-CN"/);
  assert.doesNotMatch(en, /Hostlet 是什么/);
});
