export const PUBLIC_PAGE_SIZE = 9;
export const PUBLIC_QUERY_MAX_LENGTH = 120;

export const publicCopy = {
  "zh-CN": {
    htmlLang: "zh-CN",
    meta: {
      title: "Hostlet · 让 AI 助手直接发布你的作品",
      description: "通过 Hostlet Skill，让 AI 助手发布 HTML 页面、报告和静态应用，持续更新同一作品、管理私有访问和发布版本。由 Revolves 开发，MIT 开源。",
      ogLocale: "zh_CN",
      ogImageAlt: "Hostlet：让 AI 助手直接发布你的作品",
    },
    brand: "Hostlet",
    nav: { start: "进入工作台" },
    hero: {
      eyebrow: "为 AI 创作者准备的发布 Skill",
      lineOne: "让 AI 助手，",
      lineTwo: "直接发布你的作品。",
      description: "网页、报告、可视化做好后，告诉 AI 助手“把这个项目发布到 Hostlet”。通过 Skill 完成发布，之后继续更新同一作品，管理访问权限和历史版本。",
      primary: "了解发布 Skill",
      secondary: "浏览公开作品",
      proof: "MIT 开源 · 默认私有 · 支持版本回滚",
      scroll: "SCROLL",
    },
    metrics: { applications: "公开应用", workspaces: "活跃空间", visits: "累计访问" },
    statement: ["从 AI 对话里的成果，", "到可以交付的作品。"],
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
      title: "从一句指令，到一次交付",
      steps: [
        ["01", "准备 Skill", "按安装说明配置 Hostlet Skill，在新的 AI 助手会话中加载。首次使用时完成账号与凭据授权。"],
        ["02", "告诉 AI 要发布什么", "指定项目目录、名称与工作空间，让助手调用 CLI 发布静态文件。新应用默认私有。"],
        ["03", "持续更新与交付", "继续更新同一应用、查询发布版本，必要时回滚。在工作台设置公开访问或分享方式。"],
      ],
    },
    cta: { title: "下一次发布，从告诉 AI 开始。", description: "查看 Hostlet Skill 的安装说明与发布流程。也可以进入工作台，手动管理你的作品。", action: "查看 Skill 与安装说明" },
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
      title: "Hostlet · Let your AI assistant publish your work",
      description: "Use Hostlet Skill to publish HTML pages, reports, and static apps through your AI assistant. Update existing projects, manage private access, and keep release history. MIT licensed, by Revolves.",
      ogLocale: "en_US",
      ogImageAlt: "Hostlet: let your AI assistant publish your work",
    },
    brand: "Hostlet",
    nav: { start: "Open workspace" },
    hero: {
      eyebrow: "A PUBLISHING SKILL FOR AI CREATORS",
      lineOne: "Let your AI assistant",
      lineTwo: "publish your work.",
      description: "Finished a page, report, or visualization? Tell your AI assistant to publish it to Hostlet. The Skill handles static app publishing, while you keep control of updates, access, and release history.",
      primary: "Explore the Skill",
      secondary: "Browse public work",
      proof: "MIT licensed · Private by default · Version rollback",
      scroll: "SCROLL",
    },
    metrics: { applications: "Public apps", workspaces: "Active spaces", visits: "Total visits" },
    statement: ["From work created with AI", "to work you can deliver."],
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
      title: "From an instruction to a delivery",
      steps: [
        ["01", "Set up the Skill", "Follow the installation guide and load Hostlet Skill in a new assistant session. Authorize your account and credentials on first use."],
        ["02", "Tell your assistant what to publish", "Specify the project folder, title, and workspace. Your assistant uses the CLI to publish static files. New apps are private by default."],
        ["03", "Update and deliver", "Update the same app, inspect releases, or roll back. Use the workspace to configure public access or sharing."],
      ],
    },
    cta: { title: "Your next release starts with a conversation.", description: "Explore the Hostlet Skill installation guide and publishing workflow. You can also manage projects directly in the workspace.", action: "View the Skill and setup guide" },
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
