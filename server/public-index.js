import fs from "node:fs";
import { normalizePublicLocale, publicMeta } from "../shared/public-site.js";

const metaStart = "<!-- HOSTLET_META_START -->";
const metaEnd = "<!-- HOSTLET_META_END -->";
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[character]));

export function publicIndexLanguage(value) {
  return normalizePublicLocale(value) === "en" ? "en" : "zh-CN";
}

export function renderPublicIndexHtml(template, { origin = "", lang = "zh-CN" } = {}) {
  const locale = publicIndexLanguage(lang);
  const meta = publicMeta({ locale, origin });
  const alternateLocale = locale === "en" ? "zh_CN" : "en_US";
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`,
    ...meta.alternates.map((item) => `<link rel="alternate" hreflang="${escapeHtml(item.hreflang)}" href="${escapeHtml(item.href)}" />`),
    `<meta name="robots" content="index, follow" />`,
    `<meta property="og:site_name" content="Hostlet" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(meta.canonical)}" />`,
    `<meta property="og:locale" content="${escapeHtml(meta.ogLocale)}" />`,
    `<meta property="og:locale:alternate" content="${alternateLocale}" />`,
    `<meta property="og:image" content="${escapeHtml(meta.ogImage)}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(meta.ogImageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(meta.ogImage)}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(meta.ogImageAlt)}" />`,
  ];
  let html = String(template);
  const start = html.indexOf(metaStart);
  const end = html.indexOf(metaEnd, start + metaStart.length);
  if (start >= 0 && end > start) {
    html = `${html.slice(0, start + metaStart.length)}\n    ${tags.join("\n    ")}\n    ${html.slice(end)}`;
  }
  return html.replace(/<html\s+lang="[^"]*"/i, `<html lang="${meta.htmlLang}"`);
}

export function readPublicIndexTemplate(file) {
  return fs.readFileSync(file, "utf8");
}
