import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "./styles.css";
import ShareVisitor from "./components/ShareVisitor.jsx";
import ReportPage from "./components/ReportPage.jsx";
import PublicHome from "./PublicHome.jsx";
import {
  AccountFlowRoute,
  AccountRoute,
  ConsoleRoute,
  PlatformAdminRoute,
  WorkspaceRoute,
} from "./route-guards.jsx";
import { isAccountFlowPath } from "./routing.js";

if ("scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

function resetInitialScroll() {
  if (!window.location.hash) {
    window.scrollTo(0, 0);
  }
}

requestAnimationFrame(resetInitialScroll);
window.addEventListener("load", resetInitialScroll, { once: true });

function renderRoute() {
  const pathname = window.location.pathname;
  if (pathname === "/") return <PublicHome />;
  if (pathname === "/share") return <ShareVisitor />;
  if (pathname === "/report") return <ReportPage />;
  if (pathname === "/platform-admin") return <PlatformAdminRoute />;
  if (pathname === "/workspace") return <WorkspaceRoute />;
  if (pathname === "/console") return <ConsoleRoute />;
  if (pathname === "/account") return <AccountRoute />;
  if (isAccountFlowPath(pathname)) return <AccountFlowRoute />;
  return <WorkspaceRoute />;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {renderRoute()}
  </React.StrictMode>,
);

