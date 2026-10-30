import { t, useLocale } from "../i18n.js";
import { useEffect, useRef, useState } from "react";
import Brand from "./Brand.jsx";
import LanguageSwitch from "./LanguageSwitch.jsx";
import { ArrowUpRightIcon, GlobeIcon, LockIcon, StorageIcon } from "./Icons.jsx";

export default function LoginView({ onLogin }) {
  useLocale();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountEnabled, setAccountEnabled] = useState(false);
  const passwordRef = useRef(null);

  useEffect(() => {
    passwordRef.current?.focus();
    let cancelled = false;
    fetch("/api/features")
      .then((response) => response.ok ? response.json() : null)
      .then((features) => {
        if (!cancelled) {
          setAccountEnabled(Boolean(features?.multiuser));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onLogin(password);
    } catch (loginError) {
      setError(loginError.message);
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <section className="login__intro">
        <header className="login__top">
          <Brand inverse />
          <LanguageSwitch />
        </header>

        <div className="login__statement">
          <p className="eyebrow">{t("Administrator access")}</p>
          <h1>{t("Publish your work,")}<span>{t("without the overhead.")}</span></h1>
          <p className="login__copy">
            {t("Upload a single HTML file or a complete ZIP site. Choose where it lives, decide who can see it, and share one clean link.")}
          </p>
          <ul className="login__features" aria-label={t("Platform capabilities")}>
            <li><GlobeIcon /><span>{t("Public links for work you want to share")}</span></li>
            <li><LockIcon /><span>{t("Private access for work in progress")}</span></li>
            <li><StorageIcon /><span>{t("Release history with one step rollback")}</span></li>
          </ul>
        </div>

        <footer className="login__footer">
          <span className="login__footer-mark" aria-hidden="true" />
          {t("Built for small sites, quick demos, and work that should simply be online.")}
        </footer>
      </section>

      <section className="login__panel">
        <div className="login__panel-inner">
          <div className="login__form-heading">
            <span className="login__form-status"><span aria-hidden="true" />{t("Secure administration")}</span>
            <h2>{t("Sign in")}</h2>
            <p className="login__form-copy">{t("Enter the administrator password configured for this installation.")}</p>
          </div>

          <form className="login__form" onSubmit={handleSubmit}>
            <label className="field">
              <span className="field__label">{t("Password")}</span>
              <input
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            {error ? <p className="form-error" role="alert">{t(error)}</p> : null}

            <button className="button button--primary button--full button--large" disabled={busy} type="submit">
              {busy ? t("Checking…") : t("Continue")}
              {!busy ? <ArrowUpRightIcon size={18} /> : null}
            </button>
          </form>

          <p className="login__aside">{t("Session access expires automatically after 12 hours.")}</p>

          {accountEnabled ? (
            <nav className="login__account-links" aria-label={t("Related access")}>
              <a href="/account">{t("Account and workspaces")}</a>
              <a href="/report">{t("Report an application")}</a>
            </nav>
          ) : null}
        </div>
      </section>
    </main>
  );
}
