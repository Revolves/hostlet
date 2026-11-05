import { useEffect, useMemo, useRef, useState } from "react";
import "./public-home.css";

const labels = {
  brand: "Hostlet",
  nav: { platform: "平台", applications: "公开应用", workflow: "工作方式", start: "进入工作台" },
  hero: {
    eyebrow: "开源静态应用托管平台",
    lineOne: "让每个作品，",
    lineTwo: "都有独立的地址。",
    description: "上传 HTML 或 ZIP，管理公开与私有访问，保留每次发布版本。这里展示本实例已经公开的应用，以及它们真实的访问足迹。",
    primary: "浏览公开应用",
    secondary: "进入工作台",
    proof: "MIT 开源 · 静态托管 · 版本可回滚",
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
    all: "全部",
    empty: "目前还没有公开应用。发布第一个作品后，它会出现在这里。",
    loading: "正在读取公开应用…",
    error: "暂时无法读取应用列表，请稍后重试。",
    visit: "次访问",
    open: "打开应用",
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
  footer: { note: "Hostlet · 你的网站，应该由你做主", workspace: "工作台", account: "账户与工作空间", report: "举报应用" },
};

const number = (value) => new Intl.NumberFormat("zh-CN").format(value || 0);
const date = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(parsed);
};

function useReveal() {
  useEffect(() => {
    const elements = document.querySelectorAll("[data-reveal]");
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14 });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
}

function Mark() {
  return <span className="public-mark" aria-hidden="true"><span>H</span></span>;
}

function Count({ value }) {
  return <span className="public-count" aria-label={number(value)}>{number(value)}</span>;
}

function ApplicationCard({ app, index }) {
  const initials = app.title.trim().slice(0, 2).toUpperCase() || "HL";
  return (
    <article className={`public-app public-app--${app.className}`} data-reveal style={{ "--delay": `${Math.min(index, 6) * 60}ms` }}>
      <a className="public-app__link" href={app.url} target="_blank" rel="noopener noreferrer" aria-label={`${labels.showcase.open}：${app.title}`}>
        <div className="public-app__visual" aria-hidden="true">
          <span className="public-app__index">{String(index + 1).padStart(2, "0")}</span>
          <span className="public-app__monogram">{initials}</span>
          <span className="public-app__orbit" />
          <span className="public-app__line public-app__line--one" />
          <span className="public-app__line public-app__line--two" />
        </div>
        <div className="public-app__body">
          <div className="public-app__meta">
            <span>{app.workspaceName || (app.kind === "legacy" ? "平台应用" : "个人空间")}</span>
            <time dateTime={app.updatedAt}>{date(app.updatedAt)}</time>
          </div>
          <h3>{app.title}</h3>
          <div className="public-app__foot">
            <span><strong>{number(app.visits)}</strong> {labels.showcase.visit}</span>
            <span className="public-app__arrow" aria-hidden="true">↗</span>
          </div>
        </div>
      </a>
    </article>
  );
}

export default function PublicHome() {
  const [data, setData] = useState({ apps: [], stats: { applications: 0, workspaces: 0, visits: 0 } });
  const [state, setState] = useState("loading");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [menuOpen, setMenuOpen] = useState(false);
  const heroRef = useRef(null);
  const statementRef = useRef(null);
  useReveal();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/apps", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Request failed")))
      .then((payload) => {
        if (!cancelled) {
          setData({ apps: payload.apps || [], stats: payload.stats || data.stats });
          setState("ready");
        }
      })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onPointer = (event) => {
      const hero = heroRef.current;
      if (!hero || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const bounds = hero.getBoundingClientRect();
      hero.style.setProperty("--pointer-x", `${((event.clientX - bounds.left) / bounds.width - 0.5) * 14}px`);
      hero.style.setProperty("--pointer-y", `${((event.clientY - bounds.top) / bounds.height - 0.5) * 14}px`);
    };
    window.addEventListener("pointermove", onPointer);
    return () => window.removeEventListener("pointermove", onPointer);
  }, []);

  useEffect(() => {
    const statement = statementRef.current;
    if (!statement) return undefined;
    if (!("IntersectionObserver" in window)) {
      statement.classList.add("is-lit");
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          statement.classList.add("is-lit");
          observer.unobserve(statement);
        }
      });
    }, { threshold: 0.45 });
    observer.observe(statement);
    return () => observer.disconnect();
  }, []);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.apps
      .filter((app) => !needle || [app.title, app.workspaceName, app.workspaceType].some((value) => String(value || "").toLowerCase().includes(needle)))
      .sort((left, right) => sort === "popular"
        ? right.visits - left.visits || right.updatedAt.localeCompare(left.updatedAt)
        : right.updatedAt.localeCompare(left.updatedAt));
  }, [data.apps, query, sort]);

  return (
    <div className="public-site">
      <a className="public-skip" href="#main">跳到主要内容</a>
      <header className="public-nav">
        <a className="public-nav__brand" href="/" aria-label="Hostlet"><Mark /><span>{labels.brand}</span></a>
        <nav className={`public-nav__links${menuOpen ? " is-open" : ""}`} aria-label="主导航">
          <a href="#platform" onClick={() => setMenuOpen(false)}>{labels.nav.platform}</a>
          <a href="#applications" onClick={() => setMenuOpen(false)}>{labels.nav.applications}</a>
          <a href="#workflow" onClick={() => setMenuOpen(false)}>{labels.nav.workflow}</a>
          <a className="public-nav__cta" href="/workspace" onClick={() => setMenuOpen(false)}>{labels.nav.start}<span aria-hidden="true">↗</span></a>
        </nav>
        <button className="public-nav__toggle" type="button" aria-label="打开导航" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <span /><span />
        </button>
      </header>

      <main id="main">
        <section className="public-hero" id="platform" ref={heroRef}>
          <div className="public-hero__grid" aria-hidden="true" />
          <div className="public-hero__orb" aria-hidden="true" />
          <div className="public-hero__inner">
            <p className="public-eyebrow"><span />{labels.hero.eyebrow}</p>
            <h1><span>{labels.hero.lineOne}</span><span>{labels.hero.lineTwo}</span></h1>
            <p className="public-hero__description">{labels.hero.description}</p>
            <div className="public-hero__actions">
              <a className="public-button public-button--primary" href="#applications">{labels.hero.primary}<span aria-hidden="true">↓</span></a>
              <a className="public-button public-button--quiet" href="/workspace">{labels.hero.secondary}<span aria-hidden="true">↗</span></a>
            </div>
            <p className="public-hero__proof">{labels.hero.proof}</p>
          </div>
          <div className="public-hero__metrics" data-reveal>
            <div><span>{labels.metrics.applications}</span><strong><Count value={data.stats.applications} /></strong></div>
            <div><span>{labels.metrics.workspaces}</span><strong><Count value={data.stats.workspaces} /></strong></div>
            <div><span>{labels.metrics.visits}</span><strong><Count value={data.stats.visits} /></strong></div>
          </div>
          <div className="public-hero__scroll" aria-hidden="true"><span />SCROLL</div>
        </section>

        <section className="public-statement" aria-label="平台主张" ref={statementRef}>
          <p>
            {labels.statement.map((line, lineIndex) => (
              <span className="public-statement__line" key={line}>
                {line.split("").map((character, index) => (
                  <span className="public-statement__word" key={`${lineIndex}-${index}`} style={{ "--word": index }}>{character}</span>
                ))}
              </span>
            ))}
          </p>
        </section>

        <section className="public-showcase" id="applications">
          <div className="public-section-head" data-reveal>
            <div>
              <p className="public-eyebrow"><span />{labels.showcase.eyebrow}</p>
              <h2>{labels.showcase.title}</h2>
            </div>
            <p>{labels.showcase.description}</p>
          </div>

          <div className="public-toolbar" data-reveal>
            <label className="public-search">
              <span className="visually-hidden">{labels.showcase.search}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={labels.showcase.search} />
            </label>
            <div className="public-sort" role="group" aria-label="排序">
              <button type="button" aria-pressed={sort === "recent"} onClick={() => setSort("recent")}>{labels.showcase.sortRecent}</button>
              <button type="button" aria-pressed={sort === "popular"} onClick={() => setSort("popular")}>{labels.showcase.sortPopular}</button>
            </div>
          </div>

          {state === "loading" ? (
            <div className="public-grid" aria-label={labels.showcase.loading}>
              {[0, 1, 2].map((item) => <div className="public-skeleton" key={item}><span /><span /><span /></div>)}
            </div>
          ) : state === "error" ? (
            <div className="public-empty" role="alert">{labels.showcase.error}</div>
          ) : shown.length ? (
            <div className="public-grid">{shown.map((app, index) => <ApplicationCard app={app} index={index} key={app.id} />)}</div>
          ) : (
            <div className="public-empty">{query ? "没有找到匹配的应用。" : labels.showcase.empty}</div>
          )}
        </section>

        <section className="public-workflow" id="workflow">
          <div className="public-workflow__head" data-reveal>
            <p className="public-eyebrow"><span />{labels.workflow.eyebrow}</p>
            <h2>{labels.workflow.title}</h2>
          </div>
          <ol className="public-steps">
            {labels.workflow.steps.map(([index, title, description], stepIndex) => (
              <li key={index} data-reveal style={{ "--delay": `${stepIndex * 100}ms` }}>
                <span className="public-steps__index">{index}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="public-cta" data-reveal>
          <div>
            <h2>{labels.cta.title}</h2>
            <p>{labels.cta.description}</p>
          </div>
          <a className="public-button public-button--primary" href="/workspace">{labels.cta.action}<span aria-hidden="true">↗</span></a>
        </section>
      </main>

      <footer className="public-footer">
        <div><Mark /><span>{labels.footer.note}</span></div>
        <nav aria-label="页脚导航"><a href="/workspace">{labels.footer.workspace}</a><a href="/account">{labels.footer.account}</a><a href="/report">{labels.footer.report}</a></nav>
      </footer>
    </div>
  );
}
