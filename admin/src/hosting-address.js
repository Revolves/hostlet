export const validPageId = id => typeof id === "string" && /^w-[a-f0-9]{32}$/.test(id);

export function validHostingDomain(domain) {
  if (typeof domain !== "string" || /[^a-z0-9.:-]/.test(domain)) return false;
  const match = /^([^:]+)(?::([0-9]{1,5}))?$/.exec(domain);
  if (!match || match[1].length > 218 || (match[2] !== undefined && (Number(match[2]) < 1 || Number(match[2]) > 65535))) return false;
  const labels = match[1].split(".");
  return labels.length >= 2 && labels.every(part => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/.test(part)) && /[a-z]/.test(labels.at(-1));
}

export function hostingConfig(features) {
  if (features?.ipHostingOrigin != null && features.ipHostingOrigin !== "") {
    const value = features.ipHostingOrigin;
    if (typeof value !== "string" || !/^https:\/\/[^/?#]+\/?$/.test(value)) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") return null;
      return { mode: "ip", origin: url.origin };
    } catch { return null; }
  }
  return validHostingDomain(features?.hostingDomain) ? { mode: "domain", domain: features.hostingDomain } : null;
}

export function applicationUrl(config, pageId) {
  if (!validPageId(pageId)) return null;
  if (config?.mode === "ip" && hostingConfig({ ipHostingOrigin: config.origin })?.origin === config.origin) return `${config.origin}/p/${pageId}/`;
  if (config?.mode === "domain" && validHostingDomain(config.domain)) return `https://${pageId}.${config.domain}/`;
  return null;
}

export function reportPageId(config, address) {
  let url;
  try { url = new URL(address); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (config?.mode === "ip" && hostingConfig({ ipHostingOrigin: config.origin })?.origin === config.origin && url.origin === config.origin) {
    const match = /^\/p\/(w-[a-f0-9]{32})(?:\/|$)/.exec(url.pathname);
    return match ? match[1] : null;
  }
  if (config?.mode === "domain" && validHostingDomain(config.domain)) {
    const suffix = `.${config.domain}`;
    const id = url.host.endsWith(suffix) ? url.host.slice(0, -suffix.length) : "";
    return validPageId(id) ? id : null;
  }
  return null;
}
