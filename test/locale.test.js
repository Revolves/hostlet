import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLanguage, translate } from "../shared/locales.js";
import { requestLanguage } from "../server/locale.js";

test("selects explicit language before cookie and negotiated browser language", () => {
  const request = { query: { lang: "en" }, cookies: { hosting_language: "zh-CN" }, headers: { "accept-language": "zh-CN" }, acceptsLanguages: () => "zh-CN" };
  assert.equal(requestLanguage(request), "en");
  assert.equal(requestLanguage({ ...request, query: {} }), "zh-CN");
  assert.equal(requestLanguage({ ...request, query: {}, cookies: {} }), "zh-CN");
  assert.equal(requestLanguage({ query: {}, headers: {} }), "en");
  assert.equal(normalizeLanguage("zh-TW"), "zh-CN");
  assert.equal(normalizeLanguage("fr-FR"), "en");
});

test("translates UI messages and dynamic errors without interpreting user content", () => {
  assert.equal(translate("Upload page", "zh-CN"), "上传页面");
  assert.equal(translate("Upload page", "en"), "Upload page");
  assert.equal(translate("Delete “{title}”?", "zh-CN", { title: "{count}<demo>" }), "删除“{count}<demo>”？");
  assert.equal(translate("Entry file about.html does not exist in this release.", "zh-CN"), "当前版本中不存在入口文件 about.html。");
  assert.equal(translate("Unknown source", "zh-CN"), "Unknown source");
});
