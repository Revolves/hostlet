import fs from "node:fs";
import { normalizePublicLocale, publicMeta, publicCopy } from "../shared/public-site.js";
import { publicFaq } from "../shared/public-faq.js";
import { publicInstall, skillInstallCommand } from "../shared/public-install.js";

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
  const copy = publicCopy[locale];
  const install = publicInstall[locale];
  const meta = publicMeta({ locale, origin });
  const alternateLocale = locale === "en" ? "zh_CN" : "en_US";
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Hostlet",
    url: meta.canonical,
    description: meta.description,
    inLanguage: meta.htmlLang,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    creator: { "@type": "Person", name: "Revolves", url: "https://github.com/Revolves" },
    license: "https://opensource.org/license/mit",
  }).replace(/</g, "\\u003c");
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`,
    ...meta.alternates.map((item) => `<link rel="alternate" hreflang="${escapeHtml(item.hreflang)}" href="${escapeHtml(item.href)}" />`),
    `<meta name="robots" content="index, follow, max-image-preview:large" />`,
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
    `<script type="application/ld+json">${structuredData}</script>`,
  ];
  let html = String(template);
  const start = html.indexOf(metaStart);
  const end = html.indexOf(metaEnd, start + metaStart.length);
  if (start >= 0 && end > start) {
    html = `${html.slice(0, start + metaStart.length)}\n    ${tags.join("\n    ")}\n    ${html.slice(end)}`;
  }
  const content = `<header><a href="/">Hostlet</a> · by Revolves <nav><a href="/?lang=zh-CN" lang="zh-CN">中文</a> / <a href="/?lang=en" lang="en">English</a></nav></header><main><h1>${escapeHtml(copy.hero.lineOne)} ${escapeHtml(copy.hero.lineTwo)}</h1><p>${escapeHtml(copy.hero.description)}</p><a href="/workspace">${escapeHtml(copy.nav.start)}</a><section id="skill"><h2>${escapeHtml(copy.workflow.title)}</h2><ol>${copy.workflow.steps.map(([, title, description]) => `<li><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></li>`).join("")}</ol><section><h3>${escapeHtml(install.title)}</h3><p>${escapeHtml(install.description)}</p><h4>${escapeHtml(install.commandLabel)}</h4><pre><code>${escapeHtml(skillInstallCommand)}</code></pre><h4>${escapeHtml(install.promptLabel)}</h4><p>${escapeHtml(install.prompt)}</p><p>${escapeHtml(install.note)}</p></section><a href="https://github.com/Revolves/hostlet/tree/master/skills/hostlet-publish">${escapeHtml(copy.cta.action)}</a></section><section><h2>${escapeHtml(publicFaq[locale].title)}</h2>${publicFaq[locale].items.map(([q, a]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join("")}</section><a href="https://github.com/Revolves/hostlet">GitHub · Revolves/hostlet</a></main>`;
  html = html.replace('<div id="root"></div>', `<div id="root">${content}</div>`).replace(/<noscript>[\s\S]*?<\/noscript>/, "");
  return html.replace(/<html\s+lang="[^"]*"/i, `<html lang="${meta.htmlLang}"`);
}

export function readPublicIndexTemplate(file) {
  return fs.readFileSync(file, "utf8");
}
