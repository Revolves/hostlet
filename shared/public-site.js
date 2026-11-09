export const PUBLIC_PAGE_SIZE = 9;
export const PUBLIC_QUERY_MAX_LENGTH = 120;

export const publicCopy = {
  "zh-CN": {
    htmlLang: "zh-CN",
    meta: {
      title: "Hostlet · 让每个作品都有独立的地址",
      description: "Hostlet 是开源的静态应用托管平台。浏览本实例公开的作品，查看真实访问量，并了解发布、版本与分享方式。",
      ogLocale: "zh_CN",
      ogImageAlt: "Hostlet：让每个作品都有独立的地址",
    },
    brand: "Hostlet",
    nav: { start: "进入工作台" },
    hero: {
      eyebrow: "开源静态应用托管平台",
      lineOne: "让每个作品，",
      lineTwo: "都有独立的地址。",
      description: "上传 HTML 或 ZIP，管理公开与私有访问，保留每次发布版本。这里展示本实例已经公开的应用，以及它们真实的访问足迹。",
      primary: "浏览公开应用",
      secondary: "进入工作台",
      proof: "MIT 开源 · 静态托管 · 版本可回滚",
      scroll: "SCROLL",
    },
    metrics: { applications: "公开应用", workspaces: "活跃空间", visits: "累计访问" },
    statement: ["作品不该困在文件夹里。", "发布，分享，然后被看见。"],
    showcase: {
      eyebrow: "公开应用",
      title: "正在被访问的作品",
      description: "只收录当前仍可公开访问的应用。私有应用、分享链接与临时预览不会出现在这里。",
      search: "搜索应用或空间",
      sortRecent: "最近更新",
      sortPopular: "最多访问",
      empty: "目前还没有公开应用。发布第一个作品后，它会出现在这里。",
      searchEmpty: "没有找到匹配的应用，换个关键词试试。",
      clearSearch: "清除搜索",
      loading: "正在读取公开应用…",
      error: "暂时无法读取应用列表，请稍后重试。",
      retry: "重新加载",
      loadMore: "加载更多",
      loadingMore: "正在加载…",
      loadMoreError: "加载更多失败，请重试。",
      allLoaded: "已展示全部公开应用",
      resultCount: "共 {count} 个公开应用",
      visit: "次访问",
      visits: "次访问",
      open: "打开应用",
    },
    app: { platform: "平台应用", workspace: "个人空间" },
    a11y: {
      skip: "跳到主要内容",
      language: "界面语言",
      footerNav: "页脚导航",
      statement: "平台主张",
      sort: "排序",
      showcase: "公开应用列表",
      unavailable: "暂不可用",
      visitCount: "{count} 次访问",
    },
    workflow: {
      eyebrow: "工作方式",
      title: "从构建产物到公开链接",
      steps: [
        ["01", "上传", "放入单个 HTML 或完整 ZIP 站点，保留目录结构和入口文件。"],
        ["02", "发布", "选择公开或私有，记录版本，必要时一键回滚到旧版本。"],
        ["03", "分享", "公开应用拥有独立地址，访问次数在服务端自动记录。"],
      ],
    },
    cta: { title: "准备好发布下一个作品了吗？", description: "进入工作台完成上传、权限设置和版本管理。", action: "进入工作台" },
    source: {
      eyebrow: "GitHub",
      title: "开源项目与构建记录",
      description: "查看 Hostlet 的源码、提交记录与版本发布。问题与建议欢迎在 GitHub 提出。",
      action: "访问 GitHub",
    },
    footer: { note: "Hostlet · 你的网站，应该由你做主", workspace: "工作台", account: "账户与工作空间", report: "举报应用" },
  },
  en: {
    htmlLang: "en",
    meta: {
      title: "Hostlet · Every project deserves its own address",
      description: "Hostlet is an open-source static app hosting platform. Browse the projects currently public on this instance, see real visit counts, and learn how publishing, versions, and sharing work.",
      ogLocale: "en_US",
      ogImageAlt: "Hostlet: every project deserves its own address",
    },
    brand: "Hostlet",
    nav: { start: "Open workspace" },
    hero: {
      eyebrow: "OPEN-SOURCE STATIC HOSTING",
      lineOne: "Every project deserves",
      lineTwo: "its own address.",
      description: "Upload HTML or ZIP, choose public or private access, and keep every release. This page shows the applications currently public on this instance and their real visit counts.",
      primary: "Browse public apps",
      secondary: "Open workspace",
      proof: "MIT licensed · Static hosting · Version rollback",
      scroll: "SCROLL",
    },
    metrics: { applications: "Public apps", workspaces: "Active spaces", visits: "Total visits" },
    statement: ["Work should not stay buried in a folder.", "Publish, share, and be seen."],
    showcase: {
      eyebrow: "PUBLIC SHOWCASE",
      title: "Work being visited right now",
      description: "Only applications that are currently public are listed. Private apps, share links, and temporary previews never appear here.",
      search: "Search apps or spaces",
      sortRecent: "Recently updated",
      sortPopular: "Most visited",
      empty: "No public apps yet. Publish your first project and it will appear here.",
      searchEmpty: "No matching apps. Try a different keyword.",
      clearSearch: "Clear search",
      loading: "Loading public apps…",
      error: "The app list is unavailable right now. Please try again.",
      retry: "Try again",
      loadMore: "Load more",
      loadingMore: "Loading…",
      loadMoreError: "Could not load more apps. Please try again.",
      allLoaded: "All public apps are shown",
      resultCount: "{count} public apps",
      visit: "visit",
      visits: "visits",
      open: "Open app",
    },
    app: { platform: "Platform app", workspace: "Workspace" },
    a11y: {
      skip: "Skip to main content",
      language: "Interface language",
      footerNav: "Footer navigation",
      statement: "Platform statement",
      sort: "Sort",
      showcase: "Public app list",
      unavailable: "Not available",
      visitCount: "{count} visits",
    },
    workflow: {
      eyebrow: "HOW IT WORKS",
      title: "From build output to a public link",
      steps: [
        ["01", "Upload", "Add a single HTML file or a complete ZIP site with its folder structure and entry file."],
        ["02", "Publish", "Choose public or private, keep a release history, and roll back in one step when needed."],
        ["03", "Share", "Public apps get their own address, and visits are counted by the server."],
      ],
    },
    cta: { title: "Ready to publish your next project?", description: "Open the workspace to upload, set access, and manage releases.", action: "Open workspace" },
    source: {
      eyebrow: "GITHUB",
      title: "Open-source work, in the open",
      description: "Read the Hostlet source, commit history, and releases. Issues and ideas are welcome on GitHub.",
      action: "Visit GitHub",
    },
    footer: { note: "Hostlet · Your site should be yours to control", workspace: "Workspace", account: "Account and workspaces", report: "Report an app" },
  },
};

export function normalizePublicLocale(value) {
  const text = String(value ?? "").toLowerCase();
  if (text === "en" || text.startsWith("en-")) return "en";
  if (text === "zh" || text.startsWith("zh-")) return "zh-CN";
  return null;
}

export function publicLocaleTag(locale) {
  return normalizePublicLocale(locale) === "en" ? "en-US" : "zh-CN";
}

export function formatPublicNumber(value, locale = "zh-CN") {
  const number = Number(value);
  return new Intl.NumberFormat(publicLocaleTag(locale)).format(Number.isFinite(number) ? number : 0);
}

export function formatPublicDate(value, locale = "zh-CN") {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(publicLocaleTag(locale), { month: "short", day: "numeric" }).format(parsed);
}

export function publicDirectoryQuery({ limit = PUBLIC_PAGE_SIZE, offset = 0, sort = "recent", query = "" } = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("sort", sort === "popular" ? "popular" : "recent");
  const keyword = String(query ?? "").trim().slice(0, PUBLIC_QUERY_MAX_LENGTH);
  if (keyword) params.set("q", keyword);
  return params.toString();
}

export function publicMeta({ locale = "zh-CN", origin = "" } = {}) {
  const normalized = normalizePublicLocale(locale) || "zh-CN";
  const copy = publicCopy[normalized];
  const base = String(origin || "").replace(/\/+$/, "");
  const english = normalized === "en";
  return {
    locale: normalized,
    htmlLang: copy.htmlLang,
    title: copy.meta.title,
    description: copy.meta.description,
    ogLocale: copy.meta.ogLocale,
    ogImageAlt: copy.meta.ogImageAlt,
    canonical: `${base}/${english ? "?lang=en" : ""}`,
    ogImage: `${base}/social-card.png`,
    alternates: [
      { hreflang: "zh-CN", href: `${base}/` },
      { hreflang: "en", href: `${base}/?lang=en` },
      { hreflang: "x-default", href: `${base}/` },
    ],
  };
}

export function statementTokens(line, locale = "zh-CN") {
  const text = String(line ?? "");
  return normalizePublicLocale(locale) === "en" ? text.split(/\s+/).filter(Boolean) : Array.from(text);
}

export function interpolate(template, values = {}) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(values, key) ? String(values[key]) : match));
}

export function visitLabel(count, locale = "zh-CN") {
  const copy = publicCopy[normalizePublicLocale(locale) || "zh-CN"];
  return Number(count) === 1 ? copy.showcase.visit : copy.showcase.visits;
}
