import { useSyncExternalStore } from "react";
import { normalizeLanguage, translate } from "../../shared/locales.js";

const KEY = "html-hosting-language";
let requestedLanguage = null;
try {
  if (window.location.pathname === "/") requestedLanguage = "zh-CN";
  const requested = new URLSearchParams(window.location.search).get("lang");
  if (requested && /^(zh|en)(-|$)/i.test(requested)) requestedLanguage = normalizeLanguage(requested);
} catch { /* Query strings are unavailable outside a browser. */ }
let language;
try { language = localStorage.getItem(KEY); } catch { /* Browser storage may be disabled. */ }
language = requestedLanguage || (language === "zh-CN" || language === "en" ? language : normalizeLanguage(navigator.language));
if (requestedLanguage) { try { localStorage.setItem(KEY, language); } catch { /* Keep the query choice for this session. */ } }
const listeners = new Set();
let documentTitle = null;

export function t(message, values) {
  return translate(message, language, values);
}

function updateDocument() {
  document.documentElement.lang = language;
  document.title = documentTitle || (language === "zh-CN" ? "HTML 页面托管" : "HTML Hosting");
}
updateDocument();

export function setDocumentTitle(title) {
  documentTitle = typeof title === "string" && title.trim() ? title : null;
  updateDocument();
}

export function setLanguage(next) {
  language = normalizeLanguage(next);
  try { localStorage.setItem(KEY, language); } catch { /* Keep the choice for this session. */ }
  updateDocument();
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocale() {
  return useSyncExternalStore(subscribe, () => language);
}

window.addEventListener("storage", (event) => {
  if (event.key === KEY) {
    language = event.newValue ? normalizeLanguage(event.newValue) : normalizeLanguage(navigator.language);
    updateDocument();
    listeners.forEach((listener) => listener());
  }
});
