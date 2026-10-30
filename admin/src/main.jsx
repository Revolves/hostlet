import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "./styles.css";
import App from "./App.jsx";
import AccountPortal from "./components/AccountPortal.jsx";
import PlatformAdmin from "./components/PlatformAdmin.jsx";
import ShareVisitor from "./components/ShareVisitor.jsx";
import ReportPage from "./components/ReportPage.jsx";

const accountPaths = new Set(["/account", "/verify-email", "/reset-password", "/join-workspace"]);
const isAccountPath = accountPaths.has(window.location.pathname);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {window.location.pathname === "/share" ? <ShareVisitor /> : window.location.pathname === "/report" ? <ReportPage /> : window.location.pathname === "/platform-admin" ? <PlatformAdmin /> : isAccountPath ? <AccountPortal onLegacyLogin={() => { window.location.href = "/"; }} /> : <App />}
  </React.StrictMode>,
);

