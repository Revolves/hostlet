import { useEffect, useState } from "react";
import { t, useLocale } from "../i18n.js";
import Brand from "./Brand.jsx";
import LanguageSwitch from "./LanguageSwitch.jsx";
import {
  CloseIcon,
  GlobeIcon,
  MenuIcon,
  OverviewIcon,
  PagesIcon,
  PlatformIcon,
  SignOutIcon,
} from "./Icons.jsx";

function NavigationItem({ active, href, icon, children }) {
  return (
    <a className={`admin-nav__item${active ? " is-active" : ""}`} href={href} aria-current={active ? "page" : undefined}>
      <span className="admin-nav__icon" aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </a>
  );
}

export default function AdminShell({
  active,
  children,
  signedIn = false,
  platformEnabled = false,
  onLogout,
  basePath = "/console",
}) {
  useLocale();
  const [navigationOpen, setNavigationOpen] = useState(false);

  useEffect(() => {
    function handleKey(event) {
      if (event.key === "Escape") {
        setNavigationOpen(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    const closeNavigation = () => setNavigationOpen(false);
    window.addEventListener("resize", closeNavigation);
    return () => window.removeEventListener("resize", closeNavigation);
  }, []);

  return (
    <div className={`admin-shell${navigationOpen ? " is-navigation-open" : ""}`}>
      <a className="skip-link" href="#admin-content">{t("Skip to content")}</a>
      <button
        className="admin-shell__scrim"
        type="button"
        aria-label={t("Close navigation")}
        tabIndex={navigationOpen ? 0 : -1}
        onClick={() => setNavigationOpen(false)}
      />

      <aside className="admin-sidebar" aria-label={t("Workspace navigation")}>
        <div className="admin-sidebar__top">
          <a className="admin-sidebar__brand" href={basePath} aria-label="Hostlet">
            <Brand compact inverse />
            <span className="admin-sidebar__brand-label">{t("Workspace")}</span>
          </a>
          <button
            className="admin-sidebar__close"
            type="button"
            aria-label={t("Close navigation")}
            onClick={() => setNavigationOpen(false)}
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <nav className="admin-nav" aria-label={t("Workspace navigation")}>
          <p className="admin-nav__label">{t("Workspace")}</p>
          <NavigationItem active={active === "overview"} href={basePath} icon={<OverviewIcon />}>
            {t("Overview")}
          </NavigationItem>
          <NavigationItem active={active === "library"} href={`${basePath}#library`} icon={<PagesIcon />}>
            {t("Page library")}
          </NavigationItem>
          {platformEnabled ? (
            <>
              <p className="admin-nav__label admin-nav__label--spaced">{t("Platform")}</p>
              <NavigationItem active={active === "platform"} href="/platform-admin" icon={<PlatformIcon />}>
                {t("Platform administration")}
              </NavigationItem>
            </>
          ) : null}
        </nav>

        <div className="admin-sidebar__bottom">
          <div className="admin-services">
            <span className="admin-services__dot" aria-hidden="true" />
            <div>
              <strong>{t("Service online")}</strong>
              <span>{t("Admin session active")}</span>
            </div>
          </div>
          {signedIn && onLogout ? (
            <button className="admin-identity" type="button" onClick={onLogout}>
              <span className="admin-identity__avatar" aria-hidden="true">H</span>
              <span className="admin-identity__copy">
                <strong>{t("Administrator")}</strong>
                <span>{t("Sign out")}</span>
              </span>
              <SignOutIcon />
            </button>
          ) : null}
        </div>
      </aside>

      <div className="admin-shell__content">
        <header className="admin-topbar">
          <div className="admin-topbar__leading">
            <button
              className="admin-topbar__menu"
              type="button"
              aria-label={t("Open navigation")}
              aria-expanded={navigationOpen}
              onClick={() => setNavigationOpen(true)}
            >
              <MenuIcon />
            </button>
            <span className="admin-topbar__context">{t(active === "platform" ? "Platform administration" : "Workspace")}</span>
          </div>
          <div className="admin-topbar__actions">
            <span className="admin-topbar__status">
              <span aria-hidden="true" />
              {t("Service online")}
            </span>
            <a className="admin-topbar__site-link" href="/">
              <GlobeIcon size={16} />
              <span>{t("View public site")}</span>
            </a>
            <LanguageSwitch />
          </div>
        </header>
        <main className="admin-main" id="admin-content">{children}</main>
      </div>
    </div>
  );
}
