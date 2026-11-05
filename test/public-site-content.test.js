import test from "node:test";
import assert from "node:assert/strict";
import {
  formatPublicDate,
  interpolate,
  normalizePublicLocale,
  publicCopy,
  publicDirectoryQuery,
  publicMeta,
  statementTokens,
  visitLabel,
} from "../shared/public-site.js";

test("public copy keeps both languages structurally in sync", () => {
  const zh = publicCopy["zh-CN"];
  const en = publicCopy.en;
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  for (const section of ["nav", "hero", "metrics", "showcase", "app", "a11y", "workflow", "cta", "footer", "meta"]) {
    assert.deepEqual(Object.keys(zh[section]).sort(), Object.keys(en[section]).sort(), section);
  }
  assert.equal(zh.workflow.steps.length, en.workflow.steps.length);
  assert.equal(zh.statement.length, en.statement.length);
  assert.ok(zh.workflow.steps.every((step) => step.length === 3));
  assert.ok(en.workflow.steps.every((step) => step.length === 3));
  assert.match(zh.showcase.resultCount, /\{count\}/);
  assert.match(en.showcase.resultCount, /\{count\}/);
});

test("locale normalization accepts Chinese and English variants", () => {
  assert.equal(normalizePublicLocale("zh"), "zh-CN");
  assert.equal(normalizePublicLocale("zh-CN"), "zh-CN");
  assert.equal(normalizePublicLocale("en-US"), "en");
  assert.equal(normalizePublicLocale("EN"), "en");
  assert.equal(normalizePublicLocale("fr"), null);
  assert.equal(normalizePublicLocale(null), null);
});

test("directory query encodes filters and clamps search length", () => {
  assert.equal(
    publicDirectoryQuery({ limit: 9, offset: 18, sort: "popular", query: " field studio " }),
    "limit=9&offset=18&sort=popular&q=field+studio",
  );
  assert.equal(publicDirectoryQuery({ limit: 9, offset: 0, sort: "unknown", query: "" }), "limit=9&offset=0&sort=recent");
  const long = publicDirectoryQuery({ query: "x".repeat(150) });
  assert.match(long, /q=x{120}$/);
});

test("public metadata builds canonical, image and alternate URLs", () => {
  const zh = publicMeta({ locale: "zh-CN", origin: "https://hostlet.example.com/" });
  assert.equal(zh.canonical, "https://hostlet.example.com/");
  assert.equal(zh.ogImage, "https://hostlet.example.com/social-card.png");
  assert.equal(zh.ogLocale, "zh_CN");
  assert.deepEqual(zh.alternates.map((item) => item.hreflang), ["zh-CN", "en", "x-default"]);

  const en = publicMeta({ locale: "en", origin: "https://hostlet.example.com" });
  assert.equal(en.canonical, "https://hostlet.example.com/?lang=en");
  assert.equal(en.htmlLang, "en");
  assert.equal(en.ogLocale, "en_US");
  assert.equal(en.alternates[1].href, "https://hostlet.example.com/?lang=en");

  const empty = publicMeta({ locale: "en" });
  assert.equal(empty.canonical, "/?lang=en");
  assert.equal(empty.ogImage, "/social-card.png");
});

test("statement tokens split Chinese by character and English by word", () => {
  assert.deepEqual(statementTokens("发布分享", "zh-CN"), ["发", "布", "分", "享"]);
  assert.deepEqual(statementTokens("Publish, share, and be seen.", "en"), ["Publish,", "share,", "and", "be", "seen."]);
});

test("interpolation, visit labels and dates handle both languages", () => {
  assert.equal(interpolate("共 {count} 个公开应用", { count: 3 }), "共 3 个公开应用");
  assert.equal(interpolate("Hello {name}", {}), "Hello {name}");
  assert.equal(visitLabel(1, "en"), "visit");
  assert.equal(visitLabel(2, "en"), "visits");
  assert.equal(visitLabel(1, "zh-CN"), "次访问");
  assert.equal(formatPublicDate("not a date", "en"), "");
  assert.ok(formatPublicDate("2026-02-06T00:00:00.000Z", "en"));
  assert.ok(formatPublicDate("2026-02-06T00:00:00.000Z", "zh-CN"));
});
