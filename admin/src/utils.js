export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "") || "page";
}

export function titleFromFilename(filename) {
  const stem = String(filename || "Untitled page").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  return stem.replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 80);
}

export function sourceTypeFromFilename(filename) {
  return /\.zip$/i.test(String(filename || "")) ? "zip" : "html";
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value === 0) {
    return "0 MB";
  }
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
}

export function relativeDate(value, language = "en") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return language === "zh-CN" ? "未知" : "Unknown";
  }

  const seconds = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) {
    return language === "zh-CN" ? "刚刚" : "Just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return new Intl.RelativeTimeFormat(language).format(-minutes, "minute");
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return new Intl.RelativeTimeFormat(language).format(-hours, "hour");
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return new Intl.RelativeTimeFormat(language).format(-days, "day");
  }
  const weeks = Math.round(days / 7);
  if (weeks < 5) {
    return new Intl.RelativeTimeFormat(language).format(-weeks, "week");
  }
  return new Intl.DateTimeFormat(language, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

