import { useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n.js";
import LanguageSwitch from "./LanguageSwitch.jsx";
import { openIsolatedWindow, submitHostingTicket, validPageId } from "./AccountPortal.jsx";
import { hostingConfig } from "../hosting-address.js";
import "../account-portal.css";

// Load this module as early as possible on /share, before analytics or other scripts.
let sharedLink = null;
if (typeof window !== "undefined" && window.location.pathname === "/share") {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const page = params.get("page");
  const token = params.get("token");
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  if (params.getAll("page").length === 1 && params.getAll("token").length === 1 && validPageId(page) && /^[A-Za-z0-9_-]{43}$/.test(token || "")) sharedLink = { page, token };
}
if (typeof window !== "undefined") window.addEventListener("hashchange", () => {
  if (window.location.pathname === "/share" && window.location.hash) window.location.reload();
});

const chinese = {
  "Single-IP mode is only for mutually trusted users. Applications share browser storage. Use relative resource paths under the application base path; root-relative paths may not work.": "单 IP 模式仅供互信用户使用。各应用共享浏览器存储。资源请使用应用基路径下的相对路径，根路径引用可能无法使用。",
  "Report this application": "举报此应用", "Report category": "举报类别", "Description": "举报说明", "Submit report": "提交举报", "Submitting…": "正在提交…", "Your report has been submitted.": "举报已提交。", "Please enter a category and description.": "请输入举报类别和说明。", "Reporting is unavailable or this application no longer exists.": "举报接口未启用或此应用不存在。", "Reporting is unavailable or the request was denied.": "举报接口不可用或请求被拒绝。", "Could not submit the report. Please try again.": "举报提交失败，请重试。",
  "Shared application": "分享的应用", "Open a shared application.": "打开分享的应用。", "Enter the password if the sender provided one.": "如果分享者设置了密码，请输入密码。", "Optional password": "可选密码", "Open application": "打开应用", "Opening…": "正在打开…", "This link is missing or invalid. Open the original share link again.": "分享链接缺失或无效，请重新打开原始分享链接。", "Checking application access…": "正在检查应用访问配置…", "Application access is unavailable. Please try again later.": "应用访问暂不可用，请稍后重试。", "Could not load application access settings. Please try again.": "无法读取应用访问配置，请重试。", "Retry": "重试", "The link or password is invalid, expired, or revoked.": "链接或密码无效，或分享已过期、撤销。", "Too many requests. Please try again later.": "请求过于频繁，请稍后重试。", "Network error. Check your connection and try again.": "网络连接失败，请检查网络后重试。", "Unable to open the application. Please try again.": "无法打开应用，请重试。", "Pop-up blocked. Allow pop-ups for this site and try again.": "弹窗被阻止，请允许此网站打开弹窗后重试。", "Unable to safely isolate the application window. Please try again.": "无法安全隔离应用窗口，请重试。", "The application window was closed. Please try again.": "应用窗口已关闭，请重试。"
};

export default function ShareVisitor() {
  const locale = useLocale();
  const L = text => locale === "zh-CN" ? (chinese[text] || text) : text;
  const link = useRef(sharedLink);
  const mounted = useRef(false);
  const [hosting, setHosting] = useState({ status: "loading", domain: null });
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reported, setReported] = useState(false);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setHosting({ status: "loading", domain: null });
    fetch("/api/features", { credentials: "same-origin", cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      const config = hostingConfig(data);
      if (active) setHosting(config ? { status: "ready", config } : { status: "unavailable", config: null });
    }).catch(() => { if (active) setHosting({ status: "error", domain: null }); });
    return () => { active = false; };
  }, [retry]);

  async function open(event) {
    event.preventDefault();
    if (!link.current || hosting.status !== "ready") return;
    const form = event.currentTarget;
    const password = String(new FormData(form).get("password") || "");
    let windowHandle;
    try { windowHandle = openIsolatedWindow(); }
    catch (err) { setError(["Pop-up blocked. Allow pop-ups for this site and try again.", "Unable to safely isolate the application window. Please try again."].includes(err.message) ? err.message : "Unable to open the application. Please try again."); return; }
    setBusy(true); setError("");
    try {
      let response;
      try { response = await fetch("/api/shares/ticket", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId: link.current.page, token: link.current.token, ...(password ? { password } : {}) }) }); }
      catch { throw new Error("Network error. Check your connection and try again."); }
      if (!response.ok) throw new Error(response.status === 401 ? "The link or password is invalid, expired, or revoked." : response.status === 429 ? "Too many requests. Please try again later." : "Unable to open the application. Please try again.");
      const data = await response.json();
      if (!mounted.current) { windowHandle.popup.close(); return; }
      submitHostingTicket(windowHandle, link.current.page, hosting.config, data.ticket);
      form.reset();
    } catch (err) {
      try { windowHandle.popup.close(); } catch { /* Window may already be inaccessible. */ }
      const messages = ["The link or password is invalid, expired, or revoked.", "Too many requests. Please try again later.", "Network error. Check your connection and try again.", "Unable to safely isolate the application window. Please try again.", "The application window was closed. Please try again."];
      if (mounted.current) setError(messages.includes(err.message) ? err.message : "Unable to open the application. Please try again.");
    } finally { if (mounted.current) setBusy(false); }
  }

  async function submitReport(event) {
    event.preventDefault();
    if (!link.current || reportBusy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const category = String(values.get("category") || "").trim();
    const description = String(values.get("description") || "").trim();
    if (!category || !description) { setReportError("Please enter a category and description."); return; }
    setReportBusy(true); setReportError(""); setReported(false);
    try {
      let response;
      try { response = await fetch("/api/platform/reports", { method: "POST", credentials: "omit", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId: link.current.page, category, description }) }); }
      catch { throw new Error("Network error. Check your connection and try again."); }
      if (!response.ok) throw new Error(response.status === 404 ? "Reporting is unavailable or this application no longer exists." : response.status === 401 || response.status === 403 || response.status === 405 ? "Reporting is unavailable or the request was denied." : response.status === 429 ? "Too many requests. Please try again later." : "Could not submit the report. Please try again.");
      let data;
      try { data = await response.json(); } catch { throw new Error("Reporting is unavailable or the request was denied."); }
      if (!data || typeof data.id !== "string" || !data.id) throw new Error("Reporting is unavailable or the request was denied.");
      if (mounted.current) { form.reset(); setReported(true); }
    } catch (err) {
      if (mounted.current) setReportError(err.message || "Could not submit the report. Please try again.");
    } finally { if (mounted.current) setReportBusy(false); }
  }

  return <main className="account-portal"><header className="account-portal__header"><strong className="account-portal__brand">Hostlet <span>/ {L("Shared application")}</span></strong><LanguageSwitch /></header><div className="account-portal__body"><section className="account-portal__intro"><p className="account-portal__eyebrow">HOSTLET / SHARE</p><h1>{L("Open a shared application.")}</h1><p>{L("Enter the password if the sender provided one.")}</p></section><section className="account-portal__main"><div className="account-portal__panel">
    {!link.current ? <p className="account-portal__alert" role="alert">{L("This link is missing or invalid. Open the original share link again.")}</p> : <>
      {hosting.status === "loading" ? <p role="status">{L("Checking application access…")}</p> : null}
      {hosting.status === "unavailable" || hosting.status === "error" ? <p className="account-portal__alert" role="alert">{L(hosting.status === "error" ? "Could not load application access settings. Please try again." : "Application access is unavailable. Please try again later.")} <button type="button" onClick={() => setRetry(value => value + 1)}>{L("Retry")}</button></p> : null}
      {hosting.config?.mode === "ip" ? <p className="account-portal__alert" role="note">{L("Single-IP mode is only for mutually trusted users. Applications share browser storage. Use relative resource paths under the application base path; root-relative paths may not work.")}</p> : null}
      {error ? <p className="account-portal__alert" role="alert">{L(error)}</p> : null}
      <form className="account-portal__form" onSubmit={open}><label>{L("Optional password")}<input type="password" name="password" autoComplete="off" /></label><button className="account-portal__primary" type="submit" disabled={busy || hosting.status !== "ready"}>{L(busy ? "Opening…" : "Open application")}</button></form>
      <details className="account-portal__report"><summary>{L("Report this application")}</summary><form className="account-portal__form" onSubmit={submitReport}><label>{L("Report category")}<input name="category" maxLength={64} required /></label><label>{L("Description")}<textarea name="description" maxLength={2000} rows={5} required /></label>{reportError ? <p className="account-portal__alert" role="alert">{L(reportError)}</p> : null}{reported ? <p className="account-portal__notice" role="status">{L("Your report has been submitted.")}</p> : null}<button type="submit" disabled={reportBusy}>{L(reportBusy ? "Submitting…" : "Submit report")}</button></form></details>
    </>}
  </div></section></div></main>;
}
