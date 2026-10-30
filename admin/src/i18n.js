import { useSyncExternalStore } from "react";
import { normalizeLanguage, translate } from "../../shared/locales.js";

const KEY = "html-hosting-language";
let language;
try { language = localStorage.getItem(KEY); } catch { /* Browser storage may be disabled. */ }
language = language === "zh-CN" || language === "en" ? language : normalizeLanguage(navigator.language);
const listeners = new Set();

export function t(message, values) {
  return translate(message, language, values);
}

function updateDocument() {
  document.documentElement.lang = language;
  document.title = language === "zh-CN" ? "HTML 页面托管" : "HTML Hosting";
}
updateDocument();

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
