import { t, useLocale } from "./i18n.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import AdminShell from "./components/AdminShell.jsx";
import LoginView from "./components/LoginView.jsx";
import PageTable from "./components/PageTable.jsx";
import PageDrawer from "./components/PageDrawer.jsx";
import EmptyState from "./components/EmptyState.jsx";
import Toast from "./components/Toast.jsx";
import RowMenu from "./components/RowMenu.jsx";
import ConfirmDialog from "./components/ConfirmDialog.jsx";
import {
  GlobeIcon,
  LockIcon,
  PagesIcon,
  SearchIcon,
  StorageIcon,
  UploadIcon,
} from "./components/Icons.jsx";
import { formatBytes } from "./utils.js";
import { hostingConfig } from "./hosting-address.js";

function MetricCard({ icon, label, value, detail, tone }) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span className="metric-card__icon" aria-hidden="true">{icon}</span>
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">{value}</strong>
      <span className="metric-card__detail">{detail}</span>
    </article>
  );
}

function AccessSummary({ publicCount, privateCount, total }) {
  const publicRatio = total > 0 ? publicCount / total : 0;
  const privateRatio = total > 0 ? privateCount / total : 0;

  return (
    <aside className="access-summary" aria-labelledby="access-summary-heading">
      <p className="eyebrow">{t("Access mix")}</p>
      <h2 id="access-summary-heading">{t("Know what is public.")}</h2>
      <p className="access-summary__copy">
        {t("Public pages open with a link. Private pages require the administrator password.")}
      </p>
      <div className="access-summary__track" aria-hidden="true">
        {publicRatio > 0 ? <span className="access-summary__track-public" style={{ flexGrow: publicCount }} /> : null}
        {privateRatio > 0 ? <span className="access-summary__track-private" style={{ flexGrow: privateCount }} /> : null}
      </div>
      <div className="access-summary__legend">
        <div>
          <span className="access-summary__key access-summary__key--public" aria-hidden="true" />
          <span>{t("Public")}</span>
          <strong>{publicCount}</strong>
        </div>
        <div>
          <span className="access-summary__key access-summary__key--private" aria-hidden="true" />
          <span>{t("Private")}</span>
          <strong>{privateCount}</strong>
        </div>
      </div>
      <a className="access-summary__link" href="#library">
        {t("Review page access")}
        <span aria-hidden="true">→</span>
      </a>
    </aside>
  );
}

export default function App() {
  const language = useLocale();
  const [checkingSession, setCheckingSession] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [platformEnabled, setPlatformEnabled] = useState(false);
  const [pages, setPages] = useState([]);
  const [stats, setStats] = useState({ total: 0, publicCount: 0, privateCount: 0, storageBytes: 0 });
  const [loadingPages, setLoadingPages] = useState(false);
  const [query, setQuery] = useState("");
  const [accessFilter, setAccessFilter] = useState("all");
  const [drawer, setDrawer] = useState({ open: false, mode: "create", page: null });
  const [menu, setMenu] = useState({ page: null, anchor: null });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const notify = useCallback((message, tone = "success") => {
    setToast({ message, tone, id: Date.now() });
  }, []);

  const loadPages = useCallback(async () => {
    setLoadingPages(true);
    try {
      const data = await api.listPages();
      setPages(data.pages);
      setStats(data.stats);
      return true;
    } catch (error) {
      if (error.status === 401) {
        setSignedIn(false);
      } else {
        notify(error.message, "error");
      }
      return false;
    } finally {
      setLoadingPages(false);
    }
  }, [notify]);

  useEffect(() => {
    let cancelled = false;
    api.me()
      .then((session) => {
        if (!cancelled) {
          setSignedIn(session.authenticated);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          notify(error.message, "error");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCheckingSession(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [notify]);

  useEffect(() => {
    if (signedIn) {
      loadPages();
      fetch("/api/features")
        .then((response) => response.ok ? response.json() : null)
        .then((features) => setPlatformEnabled(Boolean(hostingConfig(features))))
        .catch(() => setPlatformEnabled(false));
    }
  }, [signedIn, loadPages]);

  const privateCount = stats.privateCount ?? Math.max(0, stats.total - stats.publicCount);
  const filteredPages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return pages.filter((page) => {
      const matchesAccess = accessFilter === "all" || page.accessMode === accessFilter;
      const matchesQuery = !needle || [page.title, page.slug, page.originalFilename, page.entryFile]
        .some((value) => String(value).toLowerCase().includes(needle));
      return matchesAccess && matchesQuery;
    });
  }, [accessFilter, pages, query]);

  async function handleLogin(password) {
    await api.login(password);
    setSignedIn(true);
  }

  async function handleLogout() {
    try {
      await api.logout();
    } finally {
      setSignedIn(false);
      setPages([]);
      setQuery("");
      setAccessFilter("all");
    }
  }

  function openCreate() {
    setMenu({ page: null, anchor: null });
    setDrawer({ open: true, mode: "create", page: null });
  }

  function openEdit(page) {
    setMenu({ page: null, anchor: null });
    setDrawer({ open: true, mode: "edit", page });
  }

  async function openPreview(page) {
    try {
      const { url } = await api.previewLink(page.id);
      const localizedUrl = new URL(url);
      localizedUrl.searchParams.set("lang", language);
      window.open(localizedUrl.href, "_blank", "noopener,noreferrer");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function copyText(value, message = "Link copied") {
    try {
      await navigator.clipboard.writeText(value);
      notify(message);
    } catch {
      notify("Could not access the clipboard.", "error");
    }
  }

  function handleMore(page, anchor) {
    setMenu((current) => current.page?.id === page.id
      ? { page: null, anchor: null }
      : { page, anchor });
  }

  async function handleSaved(message) {
    setDrawer({ open: false, mode: "create", page: null });
    notify(message);
    await loadPages();
  }

  async function handleReplaced(message) {
    setDrawer({ open: false, mode: "create", page: null });
    notify(message);
    await loadPages();
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return;
    }
    setDeleteBusy(true);
    try {
      await api.deletePage(deleteTarget.id);
      setDeleteTarget(null);
      notify("Page deleted.");
      await loadPages();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setDeleteBusy(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="boot" aria-label={t("Loading pages")}>
        <span className="boot__line" />
      </div>
    );
  }

  if (!signedIn) {
    return (
      <>
        <LoginView onLogin={handleLogin} />
        <Toast message={toast?.message} tone={toast?.tone} onDismiss={() => setToast(null)} />
      </>
    );
  }

  const hasFilters = Boolean(query.trim()) || accessFilter !== "all";

  return (
    <>
      <AdminShell
        active="overview"
        signedIn
        platformEnabled={platformEnabled}
        onLogout={handleLogout}
      >
        <div className="console-page">
          <section className="console-hero" aria-labelledby="overview-heading">
            <div className="console-hero__copy">
              <p className="eyebrow">{t("Hosting overview")}</p>
              <h1 id="overview-heading">{t("Every page in view. Every release in control.")}</h1>
              <p>{t("Upload, preview and manage access from one workspace without losing track of a release.")}</p>
            </div>
            <div className="console-hero__action">
              <button className="button button--primary button--large" type="button" onClick={openCreate}>
                <UploadIcon size={20} />
                {t("Upload new page")}
              </button>
              <span>{t("HTML or ZIP, up to 50 MB")}</span>
            </div>
          </section>

          <div className="overview-layout">
            <section className="metrics" aria-label={t("Workspace summary")}>
              <MetricCard
                tone="ink"
                icon={<PagesIcon />}
                label={t("Total pages")}
                value={stats.total}
                detail={t("All hosted pages")}
              />
              <MetricCard
                tone="sage"
                icon={<GlobeIcon />}
                label={t("Public pages")}
                value={stats.publicCount}
                detail={t("Open by link")}
              />
              <MetricCard
                tone="amber"
                icon={<LockIcon />}
                label={t("Private pages")}
                value={privateCount}
                detail={t("Password protected")}
              />
              <MetricCard
                tone="accent"
                icon={<StorageIcon />}
                label={t("Storage used")}
                value={formatBytes(stats.storageBytes)}
                detail={t("Retained releases included")}
              />
            </section>
            <AccessSummary
              publicCount={stats.publicCount}
              privateCount={privateCount}
              total={stats.total}
            />
          </div>

          <section className="library" id="library" aria-labelledby="library-heading">
            <div className="library__heading">
              <div>
                <p className="eyebrow">{t("Content")}</p>
                <h2 id="library-heading">{t("Page library")}</h2>
              </div>
              <span>{t("{count} pages under one roof.", { count: stats.total })}</span>
            </div>

            <div className="library__toolbar">
              <div className="library__filters" role="group" aria-label={t("Filter by access")}>
                <button type="button" aria-pressed={accessFilter === "all"} onClick={() => setAccessFilter("all")}>
                  {t("All pages")}<span>{stats.total}</span>
                </button>
                <button type="button" aria-pressed={accessFilter === "public"} onClick={() => setAccessFilter("public")}>
                  {t("Public")}<span>{stats.publicCount}</span>
                </button>
                <button type="button" aria-pressed={accessFilter === "private"} onClick={() => setAccessFilter("private")}>
                  {t("Private")}<span>{privateCount}</span>
                </button>
              </div>
              <label className="search">
                <SearchIcon />
                <span className="visually-hidden">{t("Search pages")}</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("Search pages")}
                />
              </label>
            </div>

            {loadingPages && pages.length === 0 ? (
              <div className="loading-list" aria-label={t("Loading pages")}>
                <span /><span /><span />
              </div>
            ) : filteredPages.length > 0 ? (
              <PageTable
                pages={filteredPages}
                onPreview={openPreview}
                onCopy={copyText}
                onEdit={openEdit}
                onMore={handleMore}
                menuPageId={menu.page?.id}
              />
            ) : (
              <EmptyState
                onUpload={openCreate}
                filtered={hasFilters}
                onClear={() => {
                  setQuery("");
                  setAccessFilter("all");
                }}
              />
            )}
          </section>
        </div>
      </AdminShell>

      <PageDrawer
        open={drawer.open}
        mode={drawer.mode}
        page={drawer.page}
        onClose={() => setDrawer({ open: false, mode: "create", page: null })}
        onSaved={handleSaved}
        onReplaced={handleReplaced}
        onNotify={notify}
      />

      {menu.page ? (
        <RowMenu
          page={menu.page}
          anchor={menu.anchor}
          onClose={() => setMenu({ page: null, anchor: null })}
          onEdit={openEdit}
          onPreview={openPreview}
          onReplace={openEdit}
          onDelete={(page) => {
            setMenu({ page: null, anchor: null });
            setDeleteTarget(page);
          }}
          onCopy={(value) => {
            setMenu({ page: null, anchor: null });
            copyText(value);
          }}
        />
      ) : null}

      <ConfirmDialog
        page={deleteTarget}
        onCancel={() => !deleteBusy && setDeleteTarget(null)}
        onConfirm={handleDelete}
        busy={deleteBusy}
      />

      <Toast message={toast?.message} tone={toast?.tone} onDismiss={() => setToast(null)} />
    </>
  );
}
