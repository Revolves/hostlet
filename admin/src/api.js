export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers,
    });
  } catch {
    throw new ApiError("Could not reach the Hostlet service.", 0, "NETWORK_ERROR");
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    throw new ApiError(payload?.error || "The request could not be completed.", response.status, payload?.code);
  }
  return payload;
}

export const api = {
  me: () => request("/api/auth/me"),
  health: () => request("/api/health"),
  login: (password) => request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  listPages: () => request("/api/pages"),
  createPage: (formData) => request("/api/pages", { method: "POST", body: formData }),
  updatePage: (id, data) => request(`/api/pages/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  }),
  replacePage: (id, formData) => request(`/api/pages/${id}/replace`, {
    method: "POST",
    body: formData,
  }),
  listReleases: (id) => request(`/api/pages/${encodeURIComponent(id)}/releases`),
  activateRelease: (id, releaseId) => request(`/api/pages/${encodeURIComponent(id)}/releases/${encodeURIComponent(releaseId)}/activate`, {
    method: "POST",
  }),
  previewLink: (id) => request(`/api/pages/${id}/preview-link`, { method: "POST" }),
  deletePage: (id) => request(`/api/pages/${id}`, { method: "DELETE" }),
};

