import { useEffect, useState } from "react";
import { t, useLocale } from "./i18n.js";
import { api } from "./api.js";
import { platformAdminAvailable, workspaceMode } from "./routing.js";
import App from "./App.jsx";
import AccountPortal from "./components/AccountPortal.jsx";
import LoginView from "./components/LoginView.jsx";
import PlatformAdmin from "./components/PlatformAdmin.jsx";

function useFeatures() {
  useLocale();
  const [state, setState] = useState({ status: "loading", features: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", features: null });
    fetch("/api/features", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load workspace configuration.");
        return response.json();
      })
      .then((features) => {
        if (!cancelled) setState({ status: "ready", features });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", features: null });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return {
    ...state,
    retry: () => setAttempt((value) => value + 1),
  };
}

function RouteLoading() {
  return (
    <main className="boot" aria-label={t("Loading workspace…")}>
      <span className="boot__line" />
    </main>
  );
}

function RouteError({ onRetry }) {
  useLocale();
  return (
    <main className="route-error" role="alert">
      <p className="eyebrow">Hostlet</p>
      <h1>{t("Workspace unavailable")}</h1>
      <p>{t("Unable to load workspace configuration.")}</p>
      <button className="button button--primary" type="button" onClick={onRetry}>
        {t("Try again")}
      </button>
    </main>
  );
}

function Redirect({ to }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return <RouteLoading />;
}

function AccountScreen() {
  return <AccountPortal onLegacyLogin={() => { window.location.href = "/console"; }} />;
}

function AdminGate({ children }) {
  useLocale();
  const [state, setState] = useState({ status: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "checking" });
    fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to check administrator session.");
        return response.json();
      })
      .then((session) => {
        if (!cancelled) {
          setState({ status: session?.authenticated ? "authorized" : "unauthenticated" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    const handleExpired = () => setState({ status: "unauthenticated" });
    window.addEventListener("hostlet:admin-session-expired", handleExpired);
    return () => window.removeEventListener("hostlet:admin-session-expired", handleExpired);
  }, []);

  if (state.status === "checking") return <RouteLoading />;
  if (state.status === "error") return <RouteError onRetry={() => setAttempt((value) => value + 1)} />;
  if (state.status === "unauthenticated") {
    return (
      <LoginView
        onLogin={async (password) => {
          await api.login(password);
          setState({ status: "authorized" });
        }}
      />
    );
  }
  return children;
}

export function WorkspaceRoute() {
  const state = useFeatures();
  if (state.status === "loading") return <RouteLoading />;
  if (state.status === "error") return <RouteError onRetry={state.retry} />;
  return workspaceMode(state.features) === "account"
    ? <AccountScreen />
    : <App basePath="/workspace" />;
}

export function AccountRoute() {
  const state = useFeatures();
  if (state.status === "loading") return <RouteLoading />;
  if (state.status === "error") return <RouteError onRetry={state.retry} />;
  return workspaceMode(state.features) === "account"
    ? <AccountScreen />
    : <Redirect to="/workspace" />;
}

export function AccountFlowRoute() {
  const state = useFeatures();
  if (state.status === "loading") return <RouteLoading />;
  if (state.status === "error") return <RouteError onRetry={state.retry} />;
  return workspaceMode(state.features) === "account"
    ? <AccountScreen />
    : <Redirect to="/workspace" />;
}

export function ConsoleRoute() {
  return <App basePath="/console" />;
}

export function PlatformAdminRoute() {
  const state = useFeatures();
  if (state.status === "loading") return <RouteLoading />;
  if (state.status === "error") return <RouteError onRetry={state.retry} />;
  if (!platformAdminAvailable(state.features)) return <Redirect to="/workspace" />;
  return (
    <AdminGate>
      <PlatformAdmin />
    </AdminGate>
  );
}
