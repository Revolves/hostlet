import { normalizeLanguage, translate } from "../shared/locales.js";

export function requestLanguage(req) {
  const explicit = req.query?.lang || req.body?.lang || req.cookies?.hosting_language;
  if (explicit === "zh-CN" || explicit === "en") return explicit;
  if (!req.headers?.["accept-language"]) return "en";
  return normalizeLanguage(req.acceptsLanguages?.("en", "zh-CN", "zh") || "en");
}

export function serverText(req, message) {
  return translate(message, requestLanguage(req));
}

export function languageLinks(req) {
  const url = new URL(req.originalUrl || "/", "http://localhost");
  const href = (language) => {
    url.searchParams.set("lang", language);
    return `${url.pathname}${url.search}`.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  };
  return `<nav aria-label="Language"><a lang="zh-CN" href="${href("zh-CN")}">中文</a> / <a lang="en" href="${href("en")}">English</a></nav>`;
}
