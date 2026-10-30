const RESERVED_SLUGS = new Set(["api", "admin", "__host", "assets", "static", "favicon.ico"]);

export class ValidationError extends Error {
  constructor(message, code = "VALIDATION_ERROR") {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.status = 400;
  }
}

export function validateTitle(value) {
  const title = String(value ?? "").trim();
  if (title.length < 1 || title.length > 80) {
    throw new ValidationError("Page title must be between 1 and 80 characters.");
  }
  return title;
}

export function validateSlug(value) {
  const slug = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
    throw new ValidationError("Mount path must use 1-63 lowercase letters, numbers, or hyphens.");
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw new ValidationError("That mount path is reserved.");
  }
  return slug;
}

export function validateAccessMode(value) {
  if (value !== "public" && value !== "private") {
    throw new ValidationError("Access mode must be public or private.");
  }
  return value;
}

export function validateRelativeFile(value, { htmlOnly = false } = {}) {
  const raw = String(value ?? "").trim().replace(/^\.\//, "");
  if (!raw || raw.includes("\0") || raw.includes("\\") || raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) {
    throw new ValidationError("Entry file must be a safe relative path.");
  }

  const segments = raw.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new ValidationError("Entry file must be a safe relative path.");
  }

  const normalized = segments.join("/");
  if (htmlOnly && !/\.(html?|HTML?)$/.test(normalized)) {
    throw new ValidationError("Entry file must be an HTML file.");
  }
  return normalized;
}

export function validateArchivePath(value) {
  return validateRelativeFile(value);
}

export function slugFromFilename(filename) {
  return pathlessSlug(String(filename ?? "").replace(/\.[^.]+$/, ""));
}

function pathlessSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "") || "page";
}

