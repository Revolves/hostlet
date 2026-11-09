import { useEffect, useRef, useState } from "react";
import { setDocumentTitle, setLanguage, useLocale } from "./i18n.js";
import {
  PUBLIC_PAGE_SIZE,
  PUBLIC_QUERY_MAX_LENGTH,
  formatPublicDate,
  formatPublicNumber,
  interpolate,
  publicCopy,
  publicDirectoryQuery,
  publicMeta,
  statementTokens,
  visitLabel,
} from "../../shared/public-site.js";
import { hostingConfig } from "./hosting-address.js";
import "./public-home.css";
import { publicFaq } from "../../shared/public-faq.js";
import { publicInstall, skillInstallCommand } from "../../shared/public-install.js";

const toneNames = ["editorial", "studio", "archive", "signal"];

function initialQuery() {
  if (typeof window === "undefined") return "";
  return (new URLSearchParams(window.location.search).get("q") || "").slice(0, PUBLIC_QUERY_MAX_LENGTH);
}

function initialSort() {
  if (typeof window === "undefined") return "recent";
  return new URLSearchParams(window.location.search).get("sort") === "popular" ? "popular" : "recent";
}

function setMeta(selector, content) {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    const property = selector.match(/property="([^"]+)"/)?.[1];
    const name = selector.match(/name="([^"]+)"/)?.[1];
    if (property) element.setAttribute("property", property);
    if (name) element.setAttribute("name", name);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function setLink(rel, href) {
  let element = document.head.querySelector(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement("link");
    element.rel = rel;
    document.head.appendChild(element);
  }
  element.setAttribute("href", href);
}

function setAlternate(hreflang, href) {
  let element = document.head.querySelector(`link[rel="alternate"][hreflang="${hreflang}"]`);
  if (!element) {
    element = document.createElement("link");
    element.rel = "alternate";
    element.hreflang = hreflang;
    document.head.appendChild(element);
  }
  element.setAttribute("href", href);
}

function useReveal(key) {
  useEffect(() => {
    const elements = [...document.querySelectorAll("[data-reveal]:not(.is-visible)")];
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
  }, [key]);
}

function Mark() {
  return <span className="public-mark" aria-hidden="true"><span>H</span></span>;
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 .8a11.4 11.4 0 0 0-3.6 22.2c.6.1.8-.2.8-.5v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.4-1.3-5.4-5.8 0-1.3.5-2.3 1.2-3.2-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.9 1.2 1.9 1.2 3.2 0 4.5-2.8 5.5-5.4 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5A11.4 11.4 0 0 0 12 .8Z" />
    </svg>
  );
}

function Count({ value, locale, unavailable }) {
  const text = value === null || value === undefined ? "—" : formatPublicNumber(value, locale);
  return <span className="public-count" aria-label={text === "—" ? unavailable : text}>{text}</span>;
}

function CopyText({ text, label, copy }) {
  const [status, setStatus] = useState("");
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(copy.copied);
    } catch {
      setStatus(copy.failed);
    }
  }
  return <div className="public-install__block">
    <div className="public-install__label"><h3>{label}</h3><button type="button" onClick={handleCopy}>{copy.copy}</button></div>
    <p className="public-install__text">{text}</p>
    <p className="public-install__status" role="status" aria-live="polite">{status}</p>
  </div>;
}

function ApplicationCard({ app, index, copy, locale }) {
  const tonal = toneNames.includes(app.className) ? app.className : "studio";
  const initials = app.title.trim().slice(0, 2).toUpperCase() || "HL";
  const workspace = app.workspaceName || (app.kind === "legacy" ? copy.app.platform : copy.app.workspace);
  const updated = formatPublicDate(app.updatedAt, locale);
  const visits = formatPublicNumber(app.visits, locale);
  return (
    <article className={`public-app public-app--${tonal}`} data-reveal style={{ "--delay": `${Math.min(index, 6) * 60}ms` }}>
      <a className="public-app__link" href={app.url} target="_blank" rel="noopener noreferrer" aria-label={`${copy.showcase.open}: ${app.title}`}>
        <div className="public-app__visual" aria-hidden="true">
          <span className="public-app__index">{String(index + 1).padStart(2, "0")}</span>
          <span className="public-app__monogram">{initials}</span>
          <span className="public-app__orbit" />
          <span className="public-app__line public-app__line--one" />
          <span className="public-app__line public-app__line--two" />
        </div>
        <div className="public-app__body">
          <div className="public-app__meta">
            <span>{workspace}</span>
            {updated ? <time dateTime={app.updatedAt}>{updated}</time> : null}
          </div>
          <h3>{app.title}</h3>
          <div className="public-app__foot">
            <span><strong>{visits}</strong> {visitLabel(app.visits, locale)}</span>
            <span className="public-app__arrow" aria-hidden="true">↗</span>
          </div>
        </div>
      </a>
    </article>
  );
}

export default function PublicHome() {
  const locale = useLocale();
  const copy = publicCopy[locale] || publicCopy["zh-CN"];
  const [apps, setApps] = useState([]);
  const [stats, setStats] = useState(null);
  const [features, setFeatures] = useState(null);
  const [page, setPage] = useState({ limit: PUBLIC_PAGE_SIZE, offset: 0, total: 0, hasMore: false });
  const [state, setState] = useState("loading");
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [sort, setSort] = useState(initialSort);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const heroRef = useRef(null);
  const statementRef = useRef(null);
  const listRequestRef = useRef(0);
  const moreRequestRef = useRef(0);
  const moreControllerRef = useRef(null);
  useReveal(`${state}:${apps.length}`);

  useEffect(() => {
    document.documentElement.classList.add("public-site-document");
    document.body.classList.add("public-site-document");
    return () => {
      document.documentElement.classList.remove("public-site-document");
      document.body.classList.remove("public-site-document");
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/features", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => {
        if (active) setFeatures(value);
      })
      .catch(() => {
        if (active) setFeatures(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 260);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const request = ++listRequestRef.current;
    moreRequestRef.current += 1;
    moreControllerRef.current?.abort();
    setLoadingMore(false);
    setLoadMoreError(false);
    setState("loading");
    setApps([]);
    setPage({ limit: PUBLIC_PAGE_SIZE, offset: 0, total: 0, hasMore: false });
    const controller = new AbortController();
    const params = publicDirectoryQuery({ limit: PUBLIC_PAGE_SIZE, offset: 0, sort, query: debouncedQuery });
    fetch(`/api/public/apps?${params}`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Request failed");
        return response.json();
      })
      .then((payload) => {
        if (request !== listRequestRef.current) return;
        setApps(Array.isArray(payload.apps) ? payload.apps : []);
        setStats(payload.stats && typeof payload.stats === "object" ? payload.stats : { applications: 0, workspaces: 0, visits: 0 });
        setPage(payload.page || { limit: PUBLIC_PAGE_SIZE, offset: 0, total: payload.apps?.length || 0, hasMore: false });
        setState("ready");
      })
      .catch((error) => {
        if (error.name === "AbortError" || request !== listRequestRef.current) return;
        setState("error");
      });
    return () => controller.abort();
  }, [debouncedQuery, sort, reloadKey]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (debouncedQuery) url.searchParams.set("q", debouncedQuery);
    else url.searchParams.delete("q");
    if (sort === "popular") url.searchParams.set("sort", "popular");
    else url.searchParams.delete("sort");
    window.history.replaceState(null, "", url);
  }, [debouncedQuery, sort]);

  useEffect(() => {
    const meta = publicMeta({ locale, origin: window.location.origin });
    setDocumentTitle(meta.title);
    document.documentElement.lang = meta.htmlLang;
    setMeta('meta[name="description"]', meta.description);
    setMeta('meta[property="og:title"]', meta.title);
    setMeta('meta[property="og:description"]', meta.description);
    setMeta('meta[property="og:url"]', meta.canonical);
    setMeta('meta[property="og:locale"]', meta.ogLocale);
    setMeta('meta[property="og:locale:alternate"]', meta.locale === "en" ? "zh_CN" : "en_US");
    setMeta('meta[property="og:image"]', meta.ogImage);
    setMeta('meta[property="og:image:alt"]', meta.ogImageAlt);
    setMeta('meta[name="twitter:title"]', meta.title);
    setMeta('meta[name="twitter:description"]', meta.description);
    setMeta('meta[name="twitter:image"]', meta.ogImage);
    setMeta('meta[name="twitter:image:alt"]', meta.ogImageAlt);
    setLink("canonical", meta.canonical);
    for (const item of meta.alternates) setAlternate(item.hreflang, item.href);
    const structured = document.head.querySelector('script[type="application/ld+json"]');
    if (structured) {
      try {
        const data = JSON.parse(structured.textContent);
        Object.assign(data, { url: meta.canonical, description: meta.description, inLanguage: meta.htmlLang });
        structured.textContent = JSON.stringify(data);
      } catch {
        // Leave unrelated or malformed structured data untouched.
      }
    }
    return () => setDocumentTitle(null);
  }, [locale]);

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

  function changeLocale(next) {
    if (next === locale) return;
    setLanguage(next);
    const url = new URL(window.location.href);
    if (next === "en") url.searchParams.set("lang", "en");
    else url.searchParams.delete("lang");
    window.history.replaceState(null, "", url);
  }

  function clearSearch() {
    setQuery("");
    setDebouncedQuery("");
  }

  async function loadMore() {
    if (loadingMore || state !== "ready" || !page.hasMore) return;
    const request = ++moreRequestRef.current;
    const controller = new AbortController();
    moreControllerRef.current?.abort();
    moreControllerRef.current = controller;
    setLoadingMore(true);
    setLoadMoreError(false);
    const offset = page.offset + page.limit;
    const params = publicDirectoryQuery({ limit: PUBLIC_PAGE_SIZE, offset, sort, query: debouncedQuery });
    try {
      const response = await fetch(`/api/public/apps?${params}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Request failed");
      const payload = await response.json();
      if (request !== moreRequestRef.current) return;
      setApps((previous) => {
        const seen = new Set(previous.map((app) => app.id));
        const additions = Array.isArray(payload.apps) ? payload.apps.filter((app) => !seen.has(app.id)) : [];
        return [...previous, ...additions];
      });
      setStats(payload.stats && typeof payload.stats === "object" ? payload.stats : stats);
      setPage(payload.page || { ...page, offset, hasMore: false });
    } catch (error) {
      if (error.name !== "AbortError" && request === moreRequestRef.current) setLoadMoreError(true);
    } finally {
      if (request === moreRequestRef.current) setLoadingMore(false);
    }
  }

  const resultSummary = state === "ready" && page.total > 0
    ? interpolate(copy.showcase.resultCount, { count: formatPublicNumber(page.total, locale) })
    : "";
  const accountEnabled = features?.multiuser === true;
  const reportEnabled = accountEnabled && Boolean(hostingConfig(features));
  const github = features?.github?.url ? features.github : null;

  return (
    <div className="public-site">
      <a className="public-skip" href="#main">{copy.a11y.skip}</a>
      <header className="public-nav">
        <div className="public-nav__identity">
          <a className="public-nav__brand" href="/" aria-label="Hostlet"><Mark /><span>{copy.brand}</span></a>
          <span className="public-nav__developer">by Revolves</span>
        </div>
        <div className="public-nav__actions">
          {github ? <a className="public-nav__github" href={github.url} target="_blank" rel="noopener noreferrer" aria-label={`${copy.source.action}: ${github.label}`} title={copy.source.action}><GitHubMark /></a> : null}
          <div className="public-language" role="group" aria-label={copy.a11y.language}>
            <a lang="zh-CN" href="/?lang=zh-CN" aria-current={locale === "zh-CN" ? "page" : undefined}>中文</a>
            <span aria-hidden="true">/</span>
            <a lang="en" href="/?lang=en" aria-current={locale === "en" ? "page" : undefined}>EN</a>
          </div>
          <a className="public-nav__cta" href="/workspace">{copy.nav.start}<span aria-hidden="true">↗</span></a>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="public-hero" id="platform" ref={heroRef}>
          <div className="public-hero__grid" aria-hidden="true" />
          <div className="public-hero__orb" aria-hidden="true" />
          <div className="public-hero__inner">
            <p className="public-eyebrow"><span />{copy.hero.eyebrow}</p>
            <h1><span>{copy.hero.lineOne}</span>{" "}<span>{copy.hero.lineTwo}</span></h1>
            <p className="public-hero__description">{copy.hero.description}</p>
            <div className="public-hero__actions">
              <a className="public-button public-button--primary" href="#skill">{copy.hero.primary}<span aria-hidden="true">↓</span></a>
              <a className="public-button public-button--quiet" href="#applications">{copy.hero.secondary}<span aria-hidden="true">↗</span></a>
            </div>
            <p className="public-hero__proof">{copy.hero.proof}</p>
          </div>
          <div className="public-hero__metrics" data-reveal>
            <div><span>{copy.metrics.applications}</span><strong><Count value={stats ? stats.applications : null} locale={locale} unavailable={copy.a11y.unavailable} /></strong></div>
            <div><span>{copy.metrics.workspaces}</span><strong><Count value={stats ? stats.workspaces : null} locale={locale} unavailable={copy.a11y.unavailable} /></strong></div>
            <div><span>{copy.metrics.visits}</span><strong><Count value={stats ? stats.visits : null} locale={locale} unavailable={copy.a11y.unavailable} /></strong></div>
          </div>
          <div className="public-hero__scroll" aria-hidden="true"><span />{copy.hero.scroll}</div>
        </section>

        <section className="public-statement" aria-label={copy.a11y.statement} ref={statementRef}>
          <p>
            {copy.statement.map((line, lineIndex) => {
              const tokens = statementTokens(line, locale);
              return (
                <span className="public-statement__line" key={line}>
                  {tokens.map((token, index) => (
                    <span className="public-statement__word" key={`${lineIndex}-${index}`} style={{ "--word": index }}>
                      {token}{locale === "en" && index < tokens.length - 1 ? " " : ""}
                    </span>
                  ))}
                </span>
              );
            })}
          </p>
        </section>

        <section className="public-workflow" id="skill">
          <div className="public-workflow__head" data-reveal>
            <p className="public-eyebrow"><span />{copy.workflow.eyebrow}</p>
            <h2>{copy.workflow.title}</h2>
          </div>
          <ol className="public-steps">
            {copy.workflow.steps.map(([index, title, description], stepIndex) => (
              <li key={index} data-reveal style={{ "--delay": `${stepIndex * 100}ms` }}>
                <span className="public-steps__index">{index}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
          <div className="public-install">
            <h2>{publicInstall[locale].title}</h2>
            <p>{publicInstall[locale].description}</p>
            <CopyText key={`${locale}-command`} text={skillInstallCommand} label={publicInstall[locale].commandLabel} copy={publicInstall[locale]} />
            <CopyText key={`${locale}-prompt`} text={publicInstall[locale].prompt} label={publicInstall[locale].promptLabel} copy={publicInstall[locale]} />
            <p>{publicInstall[locale].note}</p>
          </div>
          <a className="public-button public-button--primary" href="https://github.com/Revolves/hostlet/tree/master/skills/hostlet-publish" target="_blank" rel="noopener noreferrer">{copy.cta.action}<span aria-hidden="true">↗</span></a>
        </section>

        <section className="public-showcase" id="applications">
          <div className="public-section-head" data-reveal>
            <div>
              <p className="public-eyebrow"><span />{copy.showcase.eyebrow}</p>
              <h2>{copy.showcase.title}</h2>
            </div>
            <p>{copy.showcase.description}</p>
          </div>

          <div className="public-toolbar" data-reveal>
            <label className="public-search">
              <span className="visually-hidden">{copy.showcase.search}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
              <input type="search" value={query} maxLength={PUBLIC_QUERY_MAX_LENGTH} autoComplete="off" onChange={(event) => setQuery(event.target.value)} placeholder={copy.showcase.search} />
            </label>
            <div className="public-sort" role="group" aria-label={copy.a11y.sort}>
              <button type="button" aria-pressed={sort === "recent"} onClick={() => setSort("recent")}>{copy.showcase.sortRecent}</button>
              <button type="button" aria-pressed={sort === "popular"} onClick={() => setSort("popular")}>{copy.showcase.sortPopular}</button>
            </div>
          </div>
          <p className="public-results" role="status" aria-live="polite">{state === "loading" ? copy.showcase.loading : resultSummary}</p>

          {state === "loading" ? (
            <div className="public-grid" aria-label={copy.showcase.loading} aria-busy="true">
              {[0, 1, 2].map((item) => <div className="public-skeleton" key={item} aria-hidden="true"><span /><span /><span /></div>)}
            </div>
          ) : state === "error" ? (
            <div className="public-empty public-empty--error" role="alert">
              <p>{copy.showcase.error}</p>
              <button type="button" className="public-button public-button--quiet" onClick={() => setReloadKey((value) => value + 1)}>{copy.showcase.retry}</button>
            </div>
          ) : apps.length ? (
            <>
              <div className="public-grid" aria-label={copy.a11y.showcase}>
                {apps.map((app, index) => <ApplicationCard app={app} index={index} key={app.id} copy={copy} locale={locale} />)}
              </div>
              <div className="public-load">
                {loadMoreError ? <p className="public-load__error" role="alert">{copy.showcase.loadMoreError}</p> : null}
                {page.hasMore ? (
                  <button type="button" className="public-load__button" onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}>
                    {loadingMore ? copy.showcase.loadingMore : copy.showcase.loadMore}
                  </button>
                ) : <p className="public-load__done">{copy.showcase.allLoaded}</p>}
              </div>
            </>
          ) : (
            <div className="public-empty">
              <p>{debouncedQuery ? copy.showcase.searchEmpty : copy.showcase.empty}</p>
              {debouncedQuery
                ? <button type="button" className="public-button public-button--quiet" onClick={clearSearch}>{copy.showcase.clearSearch}</button>
                : <a className="public-button public-button--primary" href="/workspace">{copy.hero.secondary}</a>}
            </div>
          )}
        </section>


        {github ? (
          <section className="public-source" id="source" aria-labelledby="source-title" data-reveal>
            <div className="public-source__intro">
              <p className="public-eyebrow"><span />{copy.source.eyebrow}</p>
              <h2 id="source-title">{copy.source.title}</h2>
              <p>{copy.source.description}</p>
            </div>
            <a className="public-source__link" href={github.url} target="_blank" rel="noopener noreferrer" aria-label={`${copy.source.action}: ${github.label}`}>
              <span className="public-source__icon"><GitHubMark /></span>
              <span className="public-source__identity">
                <small>{copy.source.action}</small>
                <strong>{github.label}</strong>
              </span>
              <span className="public-source__arrow" aria-hidden="true">↗</span>
            </a>
          </section>
        ) : null}

        <section className="public-faq" aria-labelledby="faq-title">
          <h2 id="faq-title">{publicFaq[locale].title}</h2>
          {publicFaq[locale].items.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}
        </section>
        <section className="public-cta" data-reveal>
          <div>
            <h2>{copy.cta.title}</h2>
            <p>{copy.cta.description}</p>
          </div>
          <a className="public-button public-button--primary" href="https://github.com/Revolves/hostlet/tree/master/skills/hostlet-publish" target="_blank" rel="noopener noreferrer">{copy.cta.action}<span aria-hidden="true">↗</span></a>
        </section>
      </main>

      <footer className="public-footer">
        <div><Mark /><span>{copy.footer.note}</span></div>
        <nav aria-label={copy.a11y.footerNav}>
          <a href="/workspace">{copy.footer.workspace}</a>
          {accountEnabled ? <a href="/account">{copy.footer.account}</a> : null}
          {reportEnabled ? <a href="/report">{copy.footer.report}</a> : null}
        </nav>
      </footer>
    </div>
  );
}
