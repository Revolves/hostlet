import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../i18n.js";
import LanguageSwitch from "./LanguageSwitch.jsx";
import { applicationUrl, hostingConfig, validPageId } from "../hosting-address.js";
import "../account-portal.css";

// Consume sensitive fragments before rendering or making any requests. The value is
// held only in memory until the user completes or abandons the operation.
const pathModes = { "/verify-email": "verify", "/reset-password": "reset", "/join-workspace": "join" };
let initialLink = null;
if (typeof window !== "undefined" && pathModes[window.location.pathname]) {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("token");
  if (token !== null) {
    params.delete("token");
    const remainder = params.toString();
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + (remainder ? `#${remainder}` : ""));
    initialLink = { mode: pathModes[window.location.pathname], token };
  }
}
// A second link to the current route changes only the fragment, so the module
// would otherwise keep using its first token. Reload to consume the new link
// before rendering or sending requests, exactly as on an initial navigation.
if (typeof window !== "undefined") window.addEventListener("hashchange", () => {
  if (pathModes[window.location.pathname] && new URLSearchParams(window.location.hash.slice(1)).has("token")) window.location.reload();
});

const zh = {
  "Single-IP mode is only for mutually trusted users. Applications share browser storage. Use relative resource paths under the application base path; root-relative paths may not work.": "单 IP 模式仅供互信用户使用。各应用共享浏览器存储。资源请使用应用基路径下的相对路径，根路径引用可能无法使用。",
  "Applications run in visitors’ browsers. Never put private keys in frontend files. Use relative paths under the application base path; SPA fallback routing is not supported.": "应用运行在访问者的浏览器中，请勿在前端文件中放置私钥。资源请使用应用基路径下的相对路径；不支持 SPA 回退路由。",
  "Team activity": "团队操作记录", "Show activity": "查看操作记录", "Hide activity": "收起操作记录", "Load older activity": "加载更早记录", "No activity yet.": "暂无操作记录。",
  "Report an application": "举报应用",
  "Workspace activity": "工作空间操作记录", "Created application": "创建应用", "Uploaded new version": "上传新版本", "Restored version": "回滚版本", "Renamed application": "修改应用名称", "Deleted application": "删除应用", "Deleted version": "删除历史版本", "Made application public": "设为公开", "Made application private": "设为私有", "Created share": "创建分享", "Revoked share": "撤销分享", "Application ID": "应用标识",
  "Leave team": "退出团队", "Leave this team? You will lose access to its private applications.": "确定退出团队？退出后将无法访问团队的私有应用。", "You left the team.": "已退出团队。", "Left team": "退出团队",
  "Created workspace": "创建工作空间", "Created or renewed join link": "创建或更新加入链接", "Revoked join link": "停用加入链接", "Submitted join request": "提交加入申请", "Approved join request": "批准加入申请", "Rejected join request": "拒绝加入申请", "Changed member role": "更改成员角色", "Removed member": "移除成员",
  "If you do not receive an email, check spam, try again, or contact the administrator.": "如果没有收到邮件，请检查垃圾邮件、重试或联系管理员。",
  "The ZIP contains more than 4,000 entries, including folders. Remove unnecessary files or folders and try again.": "ZIP 包含超过 4,000 个条目（包括文件夹）。请移除不需要的文件或文件夹后重试。",
  "ZIP64 is not supported. Recreate the archive as a standard ZIP and try again.": "不支持 ZIP64，请重新打包为标准 ZIP 后重试。",
  "The workspace has reached its application limit. Remove an application or ask an administrator to increase the limit.": "工作空间的应用数量已达上限。请删除应用，或联系管理员提高额度。",
  "Not enough workspace storage for this upload. Delete old versions or applications, wait for other uploads to finish, or ask an administrator to increase the limit. ZIP contents count toward storage after extraction.": "工作空间存储空间不足。请删除历史版本或应用、等待其他上传完成，或联系管理员提高额度。ZIP 解压后的内容计入存储空间。",
  "The workspace quota does not allow this upload. Check application and storage limits or ask an administrator.": "工作空间配额不允许此次上传。请检查应用数量和存储额度，或联系管理员。",
  "Share": "分享", "Hide shares": "收起分享", "Create share": "创建分享", "Optional password": "可选密码", "Optional expiration": "可选到期时间", "No expiration": "永不过期", "Password protected": "有密码", "No password": "无密码", "Active": "有效", "Expired": "已过期", "Revoked": "已撤销", "Revoke share": "撤销分享", "Revoke this share? Existing access will be invalidated.": "确定撤销此分享？已有访问权限将失效。", "Share created. Copy the link now; it cannot be retrieved later.": "分享已创建，请立即复制链接；之后无法再次获取。", "Share revoked.": "分享已撤销。", "Share link": "分享链接", "Copy share link": "复制分享链接", "No shares yet.": "暂无分享。", "Unable to load shares.": "无法加载分享列表。", "Please choose a future expiration time.": "请选择未来的到期时间。", "Share creation may have completed. Refresh the list before trying again; its link cannot be recovered.": "分享可能已创建，请先刷新列表再操作；该链接无法找回。", "Applications open in a new window. Share links are managed per application.": "应用将在新窗口打开，可在各应用中管理分享链接。", "Application access is unavailable until a hosting domain is configured.": "配置托管域名后才能访问应用。",
  "Version history": "版本历史", "Hide version history": "收起版本历史", "Replace application": "替换应用", "Replace with new file": "上传新版本", "Version history could not be loaded.": "无法加载版本历史。", "No versions found.": "暂无版本。", "Current version": "当前版本", "Restore version": "回滚到此版本", "Restore this version? It will become the current application.": "确定回滚到此版本？它将成为当前应用。", "Application replaced.": "应用已替换。", "Version restored.": "版本已回滚。", "The application changed. Refresh applications before trying again.": "应用已发生变化，请刷新应用列表后再操作。", "Refresh applications before trying again.": "请刷新应用列表后再操作。", "Version": "版本", "Created": "创建时间", "The entry file defaults to index.html if left blank.": "入口文件留空时默认为 index.html。", "Application revision is unavailable. Refresh applications.": "无法获取应用版本号，请刷新应用列表。",
  "Delete version": "删除版本", "Delete this old version? It cannot be restored.": "删除后无法再回滚到此版本，确定删除？", "Version deleted.": "版本已删除。", "The version limit is reached. Delete an old version before uploading another.": "已达到版本数量上限，请先删除一个历史版本再上传。", "Each application keeps up to 20 versions, including the current version.": "每个应用最多保留 20 个版本，包含当前版本。",
  "Choose an entry file from the ZIP and upload again.": "压缩包中有多个入口，请选择后重新上传。", "Choose an entry file": "请选择入口文件", "Leave blank to detect the ZIP entry automatically.": "留空时自动识别 ZIP 入口。",
  "The ZIP has no matching HTML entry. Add one or check the entry path.": "压缩包中没有匹配的 HTML 入口，请添加入口文件或检查入口路径。", "The ZIP has too many HTML entries. Enter the desired entry path.": "压缩包中的 HTML 入口过多，请手动填写所需入口路径。", "Applications run in visitors’ browsers. Never put private keys in frontend files. Root paths refer to the application; SPA fallback routing is not supported.": "应用在访问者的浏览器中运行，请勿在前端文件中放入私密密钥。根路径指向当前应用；不支持单页应用的回退路由。",
  "Retention policy": "保留策略", "Applications are kept long-term.": "应用长期保留。", "Applications may be deleted after": "应用未更新达到以下天数后可能被清理：", "days without updates; owners are notified at least": "天；会至少提前", "days beforehand. Visits do not reset this period.": "天通知所有者。访问不会重置该期限。", "Retention status is unavailable. Refresh to check.": "保留策略状态不可用，请刷新查看。",
  "Unable to safely isolate the application window. Please try again.": "无法安全隔离应用窗口，请重试。",
  "Open application": "打开应用", "Opening…": "正在打开…", "Application access is not available yet; preview and sharing are not available.": "应用访问暂不可用，预览和分享功能尚未开放。", "Application access configuration could not be loaded. Try again.": "无法读取应用访问配置，请重试。", "Application access configuration is invalid.": "应用访问域名配置无效。", "Checking application access…": "正在检查应用访问配置…", "Retry access configuration": "重试读取访问配置", "Pop-up blocked. Allow pop-ups for this site and try again.": "弹窗被阻止，请允许此网站打开弹窗后重试。", "Unable to open the application. Please try again.": "无法打开应用，请重试。", "The application window was closed. Please try again.": "应用窗口已关闭，请重试。", "Invalid application identifier.": "应用标识无效。", "Applications open in a new window. Preview and sharing are not available yet.": "应用将在新窗口打开，预览和分享功能尚未开放。",
  "Applications": "应用", "Upload application": "上传应用", "Application title": "应用标题", "HTML or ZIP file": "HTML 或 ZIP 文件", "Entry file": "入口文件", "For ZIP files, enter the HTML path inside the archive. Defaults to index.html.": "ZIP 文件请输入压缩包内的 HTML 路径，默认为 index.html。", "Private": "私有", "Public": "公开", "Make public": "设为公开", "Make private": "设为私有", "Public link": "公开链接", "Make this application publicly accessible? Anyone with the address can access it.": "设为公开后，任何知道地址的人都可以访问。确定继续？", "Make this application private?": "确定将此应用设为私有？", "Application access updated.": "应用访问权限已更新。", "Upload": "上传", "Uploading…": "正在上传…", "No applications in this workspace.": "此工作空间暂无应用。", "Application access, preview and sharing are not available yet.": "应用访问、预览和分享功能暂不可用。", "File size and archive limits are enforced by the server.": "文件大小和压缩包限制由服务器控制。", "Edit title": "修改标题", "Save title": "保存标题", "Confirm changing this application title?": "确定修改此应用的标题？", "Delete application": "删除应用", "Delete this application? This cannot be undone.": "确定删除此应用？此操作无法撤销。", "Application uploaded.": "应用已上传。", "Application deleted.": "应用已删除。", "Application title updated.": "应用标题已更新。", "Could not load applications.": "无法加载应用列表。", "Please check the title, file, entry path and server upload limits.": "请检查标题、文件、入口路径及服务器上传限制。", "The file exceeds the server upload limit.": "文件超过服务器上传限制。", "The request may have completed. Refresh the application list before retrying.": "请求可能已完成，请刷新应用列表后再重试。", "Application list": "应用列表", "Refresh applications": "刷新应用列表", "Type": "类型", "Access": "访问权限",
  "Account and workspaces": "账户与工作空间", "A place for your work.": "为你的工作留一处空间。", "Sign in to manage your personal and team spaces.": "登录后管理个人和团队空间。",
  "Delete account": "注销账户", "Permanently delete this account and all personal applications? This cannot be undone.": "确定永久注销账户并删除全部个人应用？此操作无法撤销。", "Your personal applications and account email will be removed. Team applications remain with the team. Limited moderation and security records may be retained as described in the privacy notice.": "个人应用和账户邮箱将被删除；团队应用仍归团队所有。按隐私说明，有限的管理和安全记录可能保留。", "Current password": "当前密码", "Delete account permanently": "永久注销账户", "Checking account deletion…": "正在检查账户注销条件…", "You are the last owner of these teams. Transfer ownership before deleting your account.": "你是以下团队的最后一名所有者，请先转移所有权再注销账户。", "Account deleted. A new account can be created with the same email.": "账户已注销，可使用同一邮箱重新注册。", "Account deletion status could not be loaded.": "无法读取账户注销条件。", "Transfer ownership of every team you own before deleting your account.": "注销前请先为每个团队转移所有权。",
  "Account sign in": "账户登录", "Create account": "注册账户", "Forgot password": "忘记密码", "Reset password": "重置密码", "Verify email": "验证邮箱", "Email": "邮箱", "Password": "密码", "New password": "新密码", "At least 12 characters": "至少 12 个字符", "Sign in": "登录", "Register": "注册", "Send reset link": "发送重置链接", "Save password": "保存密码", "Verify": "验证", "Back to sign in": "返回登录", "Resend verification": "重新发送验证邮件", "Send verification link": "发送验证链接", "Administrator access": "管理员入口", "Working…": "处理中…", "Try again": "重试", "Refresh": "刷新", "Sign out": "退出登录", "Workspaces": "工作空间", "Personal": "个人", "Team": "团队", "Create a team": "创建团队", "Team name": "团队名称", "Create": "创建", "Join a team": "申请加入团队", "Join link or token": "加入链接或令牌", "Request to join": "申请加入", "Members": "成员", "Join requests": "加入申请", "Owner": "所有者", "Editor": "编辑者", "Viewer": "查看者", "Approve": "批准", "Reject": "拒绝", "Remove": "移除", "Generate a new join link": "生成新的加入链接", "Revoke join link": "停用加入链接", "Generating a new link invalidates the previous link.": "生成新链接将使旧链接失效。", "Copy link": "复制链接", "Link copied.": "链接已复制。", "Copy the link before leaving this page; it will not be shown again.": "请在离开页面前复制链接；之后无法再次查看。", "No pending requests.": "暂无待审批申请。", "No workspaces yet.": "暂无工作空间。", "Application upload is under development and is not available here yet.": "应用上传功能正在开发，暂不可用。", "If applicable, check your email for further instructions.": "如果符合条件，请查看邮件中的后续说明。", "Email verified. You can now sign in.": "邮箱已验证，现在可以登录。", "Password reset. You can now sign in.": "密码已重置，现在可以登录。", "Join request submitted.": "加入申请已提交。", "Changes saved.": "更改已保存。", "Link revoked.": "链接已停用。", "The link is missing or expired. Request a new one.": "链接缺失或已失效，请重新申请。", "Network error. Check your connection and try again.": "网络连接失败，请检查网络后重试。", "Your session has expired. Please sign in again.": "会话已过期，请重新登录。", "Request denied or registration is disabled.": "请求被拒绝，或注册功能未启用。", "The link or item was not found.": "链接或项目不存在。", "The request conflicts with the current state. Refresh and try again.": "操作与当前状态冲突，请刷新后重试。", "The last owner cannot be removed or changed.": "不能移除或更改最后一位所有者。", "Too many requests. Please try again later.": "请求过于频繁，请稍后重试。", "Invalid details or expired link. Please check and try again.": "信息无效或链接已过期，请检查后重试。", "Unable to complete the request. Please try again.": "无法完成请求，请重试。", "Could not access the clipboard. Select and copy the link instead.": "无法访问剪贴板，请手动选择并复制链接。", "Select a workspace to see its members.": "选择一个空间以查看成员。", "Loading…": "加载中…", "Remove this member?": "确定移除此成员？", "Cancel": "取消", "Use another account": "切换账户", "Join link": "加入链接", "Your role": "你的角色", "You": "你", "Request status may have changed. Refresh to check before retrying.": "申请状态可能已变化，请刷新后再重试。"
};
Object.assign(zh, {"Team and members":"团队与成员", "Account settings":"账户设置"});
const roles = ["owner", "editor", "viewer"];
Object.assign(zh, {"Submit for review":"提交公开审核", "Review submitted.":"已提交公开审核。", "Review pending":"待审核", "Review approved":"审核已批准", "Review rejected":"审核未通过", "Approve publication":"批准公开", "Reject publication":"驳回申请", "Review comment (optional)":"审核意见（可选）", "Review decision saved.":"审核决定已保存。", "Review comment":"审核意见", "Make this public team application private before changing its version.":"请先将团队公开应用设为私有，再更换版本并重新提交审核。"});
zh['Review outdated; submit again']='版本已变更，请重新提交审核';
Object.assign(zh, {"API credentials":"API 凭据", "Create credential":"创建凭据", "Credential name":"凭据名称", "Valid for 30 days; allows reading, publishing, and managing shares in your workspaces.":"有效期 30 天，可在你有权限的工作空间中读取、发布和管理分享。", "Copy this credential now; it will not be shown again.":"请立即复制此凭据，之后无法再次查看。", "Credential":"凭据", "Revoke credential":"撤销凭据", "Revoke this credential?":"确定撤销此凭据？", "No credentials yet.":"暂无凭据。", "Expires":"到期", "Revoked":"已撤销"});
const roleLabels = { owner: "Owner", editor: "Editor", viewer: "Viewer" };
const auditActions = {"workspace.created":"Created workspace","join_link.created":"Created or renewed join link","join_link.revoked":"Revoked join link","join_request.submitted":"Submitted join request","join_request.approved":"Approved join request","join_request.rejected":"Rejected join request","member.role_changed":"Changed member role","member.removed":"Removed member","member.left":"Left team","page.created":"Created application","page.replaced":"Uploaded new version","page.restored":"Restored version","page.renamed":"Renamed application","page.deleted":"Deleted application","page.version_deleted":"Deleted version","page.visibility_public":"Made application public","page.visibility_private":"Made application private","share.created":"Created share","share.revoked":"Revoked share"};
auditActions['page.cli_published']='Published via CLI';
Object.assign(auditActions, {'page.review_submitted':'Submitted publication review','page.review_approved':'Approved publication','page.review_rejected':'Rejected publication'});
Object.assign(zh, {'Submitted publication review':'提交公开审核','Approved publication':'批准公开','Rejected publication':'驳回公开申请'});
zh['Published via CLI']='通过命令行发布';
function label(locale, text) { return locale === "zh-CN" ? (zh[text] || t(text)) : text; }
export { validPageId, validHostingDomain } from "../hosting-address.js";

export function openIsolatedWindow() {
  const random = new Uint8Array(16);
  window.crypto.getRandomValues(random);
  const target = `hostlet_${Array.from(random, byte => byte.toString(16).padStart(2, "0")).join("")}`;
  const popup = window.open("about:blank", target);
  if (!popup) throw new Error("Pop-up blocked. Allow pop-ups for this site and try again.");
  try {
    popup.opener = null;
    if (popup.closed || popup.opener !== null) throw new Error();
  } catch {
    try { popup.close(); } catch { /* Window may already be inaccessible. */ }
    throw new Error("Unable to safely isolate the application window. Please try again.");
  }
  return { popup, target };
}

export function submitHostingTicket({ popup, target }, pageId, config, ticket) {
  const url = applicationUrl(config, pageId);
  if (!url || typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error("Unable to open the application. Please try again.");
  if (popup.closed) throw new Error("The application window was closed. Please try again.");
  try {
    if (popup.opener !== null || popup.location.href !== "about:blank") throw new Error();
  } catch { throw new Error("Unable to safely isolate the application window. Please try again."); }
  const form = document.createElement("form");
  form.method = "POST"; form.action = new URL("__host/exchange", url).href; form.target = target; form.hidden = true;
  const input = document.createElement("input");
  input.type = "hidden"; input.name = "ticket"; input.value = ticket;
  form.appendChild(input); document.body.appendChild(form);
  try { form.submit(); } finally { form.remove(); }
}

const validEntryOptions = values => Array.isArray(values) && values.length >= 2 && values.length <= 200 && values.every(value => typeof value === "string" && value.length > 0 && value.length <= 4096);

async function request(path, method = "GET", body) {
  let response;
  try {
    const multipart = body instanceof FormData;
    response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers: body === undefined || multipart ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
  } catch { throw new Error("Network error. Check your connection and try again."); }
  let data = null;
  if (response.status !== 204) { try { data = await response.json(); } catch { /* An unavailable API may return HTML. */ } }
  if (!response.ok) {
    const pageRequest = path.startsWith("/api/workspaces/") && path.includes("/pages");
    const message = data?.code === "ZIP_TOO_MANY_ENTRIES" ? "The ZIP contains more than 4,000 entries, including folders. Remove unnecessary files or folders and try again." : data?.code === "ZIP_UNSUPPORTED" ? "ZIP64 is not supported. Recreate the archive as a standard ZIP and try again." : data?.code === "QUOTA_EXCEEDED" ? data.reason === "apps" ? "The workspace has reached its application limit. Remove an application or ask an administrator to increase the limit." : data.reason === "storage" ? "Not enough workspace storage for this upload. Delete old versions or applications, wait for other uploads to finish, or ask an administrator to increase the limit. ZIP contents count toward storage after extraction." : "The workspace quota does not allow this upload. Check application and storage limits or ask an administrator." : data?.code === "ENTRY_SELECTION_REQUIRED" && validEntryOptions(data?.candidates) ? "Choose an entry file from the ZIP and upload again." : data?.code === "ENTRY_NOT_FOUND" ? "The ZIP has no matching HTML entry. Add one or check the entry path." : data?.code === "ENTRY_TOO_MANY" ? "The ZIP has too many HTML entries. Enter the desired entry path." : data?.code === "HISTORY_LIMIT" ? "The version limit is reached. Delete an old version before uploading another." : data?.code === "LAST_OWNER" ? "The last owner cannot be removed or changed." : ({ 400: pageRequest ? "Please check the title, file, entry path and server upload limits." : "Invalid details or expired link. Please check and try again.", 401: path === "/api/account/login" ? "Invalid details or expired link. Please check and try again." : "Your session has expired. Please sign in again.", 403: "Request denied or registration is disabled.", 404: "The link or item was not found.", 409: "The request conflicts with the current state. Refresh and try again.", 413: "The file exceeds the server upload limit.", 429: "Too many requests. Please try again later." })[response.status] || "Unable to complete the request. Please try again.";
    const error = new Error(data?.code === 'PUBLIC_REVIEW_REQUIRED' ? 'Make this public team application private before changing its version.' : message); error.status = response.status; error.code = data?.code; error.candidates = data?.candidates; throw error;
  }
  if (response.status !== 204 && data === null) throw new Error("Unable to complete the request. Please try again.");
  return data;
}

function RoleSelect({ value, onChange, disabled, L, ariaLabel }) {
  return <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={onChange}>{roles.map(role => <option key={role} value={role}>{L(roleLabels[role])}</option>)}</select>;
}

function PageShares({ workspaceId, page, L, busy, setBusy }) {
  const base = `/api/shares/${encodeURIComponent(workspaceId)}/pages/${encodeURIComponent(page.id)}`;
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generated, setGenerated] = useState(null);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    request(`${base}/list`, "POST", {}).then(data => {
      if (!Array.isArray(data.shares)) throw new Error("Unable to load shares.");
      if (active) { setShares(data.shares); setError(""); }
    }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base, revision]);

  async function create(event) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    const password = String(values.get("password") || "");
    const expiry = String(values.get("expiresAt") || "");
    const expiresAt = expiry ? new Date(expiry).getTime() : undefined;
    if (expiry && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) { setError("Please choose a future expiration time."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await request(base, "POST", { ...(password ? { password } : {}), ...(expiry ? { expiresAt } : {}) });
      if (!data.share || typeof data.share.id !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(data.share.token) || !validPageId(page.id)) throw new Error();
      const url = new URL("/share", window.location.origin);
      url.hash = new URLSearchParams({ page: page.id, token: data.share.token }).toString();
      if (mounted.current) { setGenerated({ id: data.share.id, url: url.href }); setNotice("Share created. Copy the link now; it cannot be retrieved later."); setRevision(value => value + 1); form.reset(); }
    } catch (err) {
      if (mounted.current) setError(!err.status || err.status >= 500 ? "Share creation may have completed. Refresh the list before trying again; its link cannot be recovered." : err.message);
    } finally { if (mounted.current) setBusy(false); }
  }

  async function revoke(share) {
    if (!window.confirm(L("Revoke this share? Existing access will be invalidated."))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(`${base}/${encodeURIComponent(share.id)}`, "DELETE");
      if (mounted.current) { setGenerated(value => value?.id === share.id ? null : value); setNotice("Share revoked."); setRevision(value => value + 1); }
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <div className="account-portal__shares">
    <form className="account-portal__replacement" onSubmit={create}><h4>{L("Create share")}</h4><label>{L("Optional password")}<input name="password" type="password" autoComplete="new-password" /></label><label>{L("Optional expiration")}<input name="expiresAt" type="datetime-local" /></label><button type="submit" disabled={busy}>{L("Create share")}</button></form>
    {error ? <p className="account-portal__alert" role="alert">{L(error)} <button type="button" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>{L("Refresh")}</button></p> : null}
    {notice ? <p className="account-portal__notice" role="status">{L(notice)}</p> : null}
    {generated ? <div className="account-portal__generated"><label>{L("Share link")}<input readOnly value={generated.url} onFocus={event => event.target.select()} /></label><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(generated.url); setNotice("Link copied."); } catch { setError("Could not access the clipboard. Select and copy the link instead."); } }}>{L("Copy share link")}</button><small>{L("Copy the link before leaving this page; it will not be shown again.")}</small></div> : null}
    <div className="account-portal__version-heading"><h4>{L("Share")}</h4><button type="button" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>{L("Refresh")}</button></div>
    {loading ? <p role="status">{L("Loading…")}</p> : !shares.length && !error ? <p>{L("No shares yet.")}</p> : null}
    <ul className="account-portal__release-list">{shares.map(share => <li key={share.id}><div><strong>{share.revokedAt != null ? L("Revoked") : share.expiresAt != null && share.expiresAt <= Date.now() ? L("Expired") : L("Active")}</strong><span>{share.passwordProtected ? L("Password protected") : L("No password")}</span><span>{L("Created")}: {new Date(share.createdAt).toLocaleString()}</span><span>{L("Optional expiration")}: {share.expiresAt == null ? L("No expiration") : new Date(share.expiresAt).toLocaleString()}</span></div>{share.revokedAt == null ? <button type="button" disabled={busy} onClick={() => revoke(share)}>{L("Revoke share")}</button> : null}</li>)}</ul>
  </div>;
}

function PageVersions({ page, base, canEdit, L, listVersion, listLoading, busy, setBusy, onUpdated, refreshPages }) {
  const path = `${base}/${encodeURIComponent(page.id)}`;
  const [releases, setReleases] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [entryOptions, setEntryOptions] = useState([]);
  const mounted = useRef(false);
  const revisionValid = Number.isSafeInteger(page.revision) && page.revision >= 0;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setNeedsRefresh(false); setActionError(""); }, [listVersion]);
  useEffect(() => {
    let active = true;
    setHistoryLoading(true); setHistoryError("");
    request(`${path}/releases`).then(data => {
      if (!Array.isArray(data.releases)) throw new Error("Version history could not be loaded.");
      if (active) setReleases(data.releases);
    }).catch(err => { if (active) setHistoryError(err.message); })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [path, listVersion, historyRevision]);

  async function perform(url, body, success) {
    setBusy(true); setActionError(""); setNotice("");
    try {
      const result = await request(url, "POST", body);
      if (!result.page || result.page.id !== page.id || !Number.isSafeInteger(result.page.revision)) throw new Error("Unable to complete the request. Please try again.");
      if (mounted.current) { onUpdated(result.page); setNotice(success); setEntryOptions([]); }
      return true;
    } catch (err) {
      if (mounted.current) {
        if (err.code === "ENTRY_SELECTION_REQUIRED" && validEntryOptions(err.candidates)) { setEntryOptions(err.candidates); setActionError(err.message); }
        else if (err.code === "HISTORY_LIMIT" || err.code === "QUOTA_EXCEEDED") setActionError(err.message);
        else if (err.status === 409) { setNeedsRefresh(true); setActionError("The application changed. Refresh applications before trying again."); }
        else if (err.message === "Network error. Check your connection and try again." || !err.status || err.status >= 500) { setNeedsRefresh(true); setActionError("The request may have completed. Refresh the application list before retrying."); }
        else setActionError(err.message);
      }
      return false;
    } finally { if (mounted.current) setBusy(false); }
  }

  async function deleteVersion(release) {
    if (!window.confirm(L("Delete this old version? It cannot be restored."))) return;
    setBusy(true); setActionError(""); setNotice("");
    try {
      await request(`${path}/releases/${encodeURIComponent(release.releaseId)}`, "DELETE", { revision: page.revision });
      if (mounted.current) { setNeedsRefresh(true); setNotice("Version deleted."); refreshPages(); }
    } catch (err) {
      if (mounted.current) { setNeedsRefresh(true); setActionError(err.status === 409 ? "The application changed. Refresh applications before trying again." : err.status && err.status < 500 ? err.message : "The request may have completed. Refresh the application list before retrying."); }
    } finally { if (mounted.current) setBusy(false); }
  }

  return <div className="account-portal__versions">
    {canEdit ? <form className="account-portal__replacement" onSubmit={async event => {
      event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
      if (!revisionValid || needsRefresh || listLoading) return;
      const entry = String(data.get("entryFile") || "").trim();
      if (entry) data.set("entryFile", entry); else data.delete("entryFile");
      data.set("revision", String(page.revision));
      if (await perform(`${path}/replace`, data, "Application replaced.")) form.reset();
    }}><h4>{L("Replace application")}</h4><label>{L("HTML or ZIP file")}<input name="file" type="file" accept=".html,.htm,.zip" required onChange={() => { setEntryOptions([]); setActionError(""); }} /></label><label>{L("Entry file")}{entryOptions.length ? <select name="entryFile" defaultValue="" required><option value="">{L("Choose an entry file")}</option>{entryOptions.map(entry=><option key={entry} value={entry}>{entry}</option>)}</select> : <input name="entryFile" placeholder="index.html" autoComplete="off" />}<small>{L("Leave blank to detect the ZIP entry automatically.")}</small></label><button type="submit" disabled={busy || listLoading || needsRefresh || !revisionValid}>{L("Replace with new file")}</button></form> : null}
    {!revisionValid && canEdit ? <p className="account-portal__alert" role="alert">{L("Application revision is unavailable. Refresh applications.")}</p> : null}
    {actionError ? <p className="account-portal__alert" role="alert">{L(actionError)} {needsRefresh ? <button type="button" disabled={busy || listLoading} onClick={refreshPages}>{L("Refresh applications")}</button> : null}</p> : null}
    {notice ? <p className="account-portal__notice" role="status">{L(notice)}</p> : null}
    <div className="account-portal__version-heading"><h4>{L("Version history")}</h4><button type="button" disabled={historyLoading || busy} onClick={() => setHistoryRevision(value => value + 1)}>{L("Refresh")}</button></div>
    <p>{L("Each application keeps up to 20 versions, including the current version.")}</p>
    {historyError ? <p className="account-portal__alert" role="alert">{L(historyError)} <button type="button" onClick={() => setHistoryRevision(value => value + 1)}>{L("Try again")}</button></p> : null}
    {historyLoading ? <p role="status">{L("Loading…")}</p> : null}
    {!historyLoading && !historyError && !releases.length ? <p>{L("No versions found.")}</p> : null}
    <ul className="account-portal__release-list">{releases.map(release => <li key={release.releaseId}><div><strong>{release.originalFilename}</strong><span>{L("Version")}: {release.releaseId}</span><span>{L("Entry file")}: {release.entryFile}</span><span>{L("Created")}: {release.createdAt}</span>{release.current ? <span className="account-portal__current">{L("Current version")}</span> : null}</div>{canEdit && !release.current ? <div><button type="button" disabled={busy || listLoading || historyLoading || Boolean(historyError) || needsRefresh || !revisionValid} onClick={() => { if (window.confirm(L("Restore this version? It will become the current application."))) perform(`${path}/releases/${encodeURIComponent(release.releaseId)}/activate`, { revision: page.revision }, "Version restored."); }}>{L("Restore version")}</button><button type="button" disabled={busy || listLoading || historyLoading || Boolean(historyError) || needsRefresh || !revisionValid} onClick={() => deleteVersion(release)}>{L("Delete version")}</button></div> : null}</li>)}</ul>
  </div>;
}

function WorkspaceApplications({ workspace, L, onSessionExpired, hosting, retryHosting }) {
  const base = `/api/workspaces/${encodeURIComponent(workspace.id)}/pages`;
  const canEdit = workspace.role === "owner" || workspace.role === "editor";
  const canDelete = workspace.role === "owner";
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [editing, setEditing] = useState(null);
  const [revision, setRevision] = useState(0);
  const [listVersion, setListVersion] = useState(0);
  const [versionsPage, setVersionsPage] = useState(null);
  const [sharesPage, setSharesPage] = useState(null);
  const [opening, setOpening] = useState(false);
  const [entryOptions, setEntryOptions] = useState([]);
  const mounted = useRef(false);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    request(base).then(data => {
      if (!Array.isArray(data.pages)) throw new Error("Could not load applications.");
      if (active) { setPages(data.pages); setError(""); setUncertain(false); setListVersion(value => value + 1); }
    }).catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base, revision]);

  async function change(path, method, body, message, onEntryOptions) {
    setBusy(true); setError(""); setNotice(""); setUncertain(false);
    try {
      await request(path, method, body);
      if (mounted.current) { setNotice(message); setRevision(value => value + 1); }
      return true;
    } catch (err) {
      if (mounted.current) { if (onEntryOptions && err.code === "ENTRY_SELECTION_REQUIRED" && validEntryOptions(err.candidates)) onEntryOptions(err.candidates); setError(err.message); setUncertain(err.message === "Network error. Check your connection and try again."); }
      return false;
    } finally { if (mounted.current) setBusy(false); }
  }

  async function upload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("title", String(data.get("title") || "").trim());
    const entry=String(data.get("entryFile") || "").trim();
    if (entry) data.set("entryFile",entry); else data.delete("entryFile");
    data.set("accessMode", "private");
    if (await change(base, "POST", data, "Application uploaded.", setEntryOptions)) { form.reset(); setEntryOptions([]); }
  }

  async function openApplication(page) {
    if (!applicationUrl(hosting.config, page.id)) { setError("Invalid application identifier."); return; }
    let windowHandle;
    try { windowHandle = openIsolatedWindow(); }
    catch (err) { setError(["Pop-up blocked. Allow pop-ups for this site and try again.", "Unable to safely isolate the application window. Please try again."].includes(err.message) ? err.message : "Unable to open the application. Please try again."); return; }
    const { popup } = windowHandle;
    setOpening(true); setError(""); setNotice(""); setUncertain(false);
    try {
      const result = await request(`/api/host/${page.id}/tickets`, "POST", {});
      if (!mounted.current) { popup.close(); return; }
      submitHostingTicket(windowHandle, page.id, hosting.config, result.ticket);
    } catch (err) {
      try { popup.close(); } catch { /* The window may already be inaccessible. */ }
      if (mounted.current) setError(["The application window was closed. Please try again.", "Unable to safely isolate the application window. Please try again."].includes(err.message) || err.status === 401 ? err.message : "Unable to open the application. Please try again.");
    } finally { if (mounted.current) setOpening(false); }
  }

  return <section className="account-portal__applications" aria-label={L("Applications")}>
    <div className="account-portal__heading"><h2>{L("Applications")}</h2><button type="button" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>{L("Refresh applications")}</button></div>
    <p className="account-portal__access-note">{L(hosting.status === "ready" ? "Applications open in a new window. Share links are managed per application." : hosting.status === "loading" ? "Checking application access…" : hosting.status === "error" ? "Application access configuration could not be loaded. Try again." : hosting.status === "invalid" ? "Application access configuration is invalid." : "Application access is unavailable until a hosting domain is configured.")} {hosting.status === "error" || hosting.status === "invalid" ? <button type="button" className="account-portal__access-retry" onClick={retryHosting}>{L("Retry access configuration")}</button> : null}</p>
    {hosting.config?.mode === "ip" ? <p className="account-portal__alert" role="note">{L("Single-IP mode is only for mutually trusted users. Applications share browser storage. Use relative resource paths under the application base path; root-relative paths may not work.")}</p> : null}
    {error ? <div className="account-portal__alert" role="alert">{L(error)} {uncertain ? L("The request may have completed. Refresh the application list before retrying.") : null} {error === "Your session has expired. Please sign in again." ? <button type="button" onClick={onSessionExpired}>{L("Use another account")}</button> : null} <button type="button" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>{L("Refresh applications")}</button></div> : null}
    {notice ? <p className="account-portal__notice" role="status">{L(notice)}</p> : null}
    {canEdit ? <form className="account-portal__upload" onSubmit={upload}>
      <h3>{L("Upload application")}</h3>
      <p>{L(hosting.config?.mode === "ip" ? "Applications run in visitors’ browsers. Never put private keys in frontend files. Use relative paths under the application base path; SPA fallback routing is not supported." : "Applications run in visitors’ browsers. Never put private keys in frontend files. Root paths refer to the application; SPA fallback routing is not supported.")}</p>
      <label>{L("Application title")}<input name="title" maxLength={80} required /></label>
      <label>{L("HTML or ZIP file")}<input name="file" type="file" accept=".html,.htm,.zip" required onChange={() => { setEntryOptions([]); setError(""); }} /></label>
      <label>{L("Entry file")}{entryOptions.length ? <select name="entryFile" defaultValue="" required><option value="">{L("Choose an entry file")}</option>{entryOptions.map(entry=><option key={entry} value={entry}>{entry}</option>)}</select> : <input name="entryFile" placeholder="index.html" autoComplete="off" />}<small>{L("Leave blank to detect the ZIP entry automatically.")}</small></label>
      <p>{L("Access")}: {L("Private")}. {L("File size and archive limits are enforced by the server.")}</p>
      <button type="submit" disabled={busy}>{L(busy ? "Uploading…" : "Upload")}</button>
    </form> : null}
    <h3>{L("Application list")}</h3>
    {loading ? <p role="status">{L("Loading…")}</p> : null}
    {!loading && !pages.length && !error ? <p>{L("No applications in this workspace.")}</p> : null}
    <ul className="account-portal__page-list">{pages.map(page => <li key={page.id}>
      <div className="account-portal__page-meta"><strong>{page.title}</strong><span>{L("Type")}: {String(page.sourceType || "").toUpperCase()} · {L("Access")}: {L(page.visibility === "public" ? "Public" : "Private")}</span></div>
      {canEdit && hosting.status === "ready" && (page.visibility === "public" || workspace.type !== "team" || workspace.role === "owner") ? <button type="button" disabled={busy || loading} onClick={() => { const next=page.visibility === "public" ? "private" : "public"; if (window.confirm(L(next === "public" ? "Make this application publicly accessible? Anyone with the address can access it." : "Make this application private?"))) change(`${base}/${encodeURIComponent(page.id)}/visibility`, "PATCH", {visibility:next}, "Application access updated."); }}>{L(page.visibility === "public" ? "Make private" : "Make public")}</button> : null}
      {workspace.type === "team" && page.visibility === "private" && canEdit ? <button type="button" disabled={busy || loading} onClick={() => change(`${base}/${encodeURIComponent(page.id)}/publication-review`, "POST", {}, "Review submitted.")}>{L("Submit for review")}</button> : null}
      {workspace.type === "team" && page.review ? <p role="status">{L(page.review.status === 'pending' ? 'Review pending' : page.review.status === 'approved' ? 'Review approved' : page.review.status === 'stale' ? 'Review outdated; submit again' : 'Review rejected')}{page.review.comment ? ` · ${L('Review comment')}: ${page.review.comment}` : ''}</p> : null}
      {workspace.type === "team" && workspace.role === "owner" && page.visibility === "private" && page.review?.status === "pending" ? <div>{['approve','reject'].map(decision => <button key={decision} type="button" disabled={busy || loading} onClick={() => {const comment=window.prompt(L('Review comment (optional)'), ''); if (comment !== null) change(`${base}/${encodeURIComponent(page.id)}/publication-review/decision`, 'POST', {decision,comment}, 'Review decision saved.');}}>{L(decision === 'approve' ? 'Approve publication' : 'Reject publication')}</button>)}</div> : null}
      {workspace.type === "team" && page.visibility === "public" && canEdit ? <p>{L("Make this public team application private before changing its version.")}</p> : null}
      {page.visibility === "public" && hosting.status === "ready" && applicationUrl(hosting.config, page.id) ? <label>{L("Public link")}<input readOnly value={applicationUrl(hosting.config, page.id)} onFocus={event => event.target.select()} /></label> : null}
      {editing === page.id && canEdit ? <form className="account-portal__edit-title" onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget; const title = String(new FormData(form).get("title") || "").trim();
        if (!title || !window.confirm(L("Confirm changing this application title?"))) return;
        if (await change(`${base}/${encodeURIComponent(page.id)}`, "PATCH", { title }, "Application title updated.")) setEditing(null);
      }}><label>{L("Application title")}<input name="title" defaultValue={page.title} maxLength={80} required /></label><div><button type="submit" disabled={busy}>{L("Save title")}</button><button type="button" disabled={busy} onClick={() => setEditing(null)}>{L("Cancel")}</button></div></form> : <div className="account-portal__page-actions">{hosting.status === "ready" ? validPageId(page.id) ? <button type="button" disabled={busy || opening} onClick={() => openApplication(page)}>{L(opening ? "Opening…" : "Open application")}</button> : <span>{L("Invalid application identifier.")}</span> : null}<button type="button" disabled={busy} aria-expanded={versionsPage === page.id} onClick={() => setVersionsPage(id => id === page.id ? null : page.id)}>{L(versionsPage === page.id ? "Hide version history" : "Version history")}</button>{canEdit ? <><button type="button" disabled={busy} aria-expanded={sharesPage === page.id} onClick={() => setSharesPage(id => id === page.id ? null : page.id)}>{L(sharesPage === page.id ? "Hide shares" : "Share")}</button><button type="button" disabled={busy || opening} onClick={() => setEditing(page.id)}>{L("Edit title")}</button></> : null}{canDelete ? <button type="button" disabled={busy || opening} onClick={() => { if (window.confirm(L("Delete this application? This cannot be undone."))) change(`${base}/${encodeURIComponent(page.id)}`, "DELETE", undefined, "Application deleted."); }}>{L("Delete application")}</button> : null}</div>}
      {versionsPage === page.id ? <PageVersions page={page} base={base} canEdit={canEdit} L={L} listVersion={listVersion} listLoading={loading} busy={busy} setBusy={setBusy} refreshPages={() => setRevision(value => value + 1)} onUpdated={updated => { setPages(current => current.map(item => item.id === updated.id ? updated : item)); setRevision(value => value + 1); }} /> : null}
      {canEdit && sharesPage === page.id ? <PageShares workspaceId={workspace.id} page={page} L={L} busy={busy} setBusy={setBusy} /> : null}
    </li>)}</ul>
  </section>;
}

function TeamActivity({workspaceId,L}) {
  const [open,setOpen]=useState(false),[events,setEvents]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[more,setMore]=useState(false);
  const base=`/api/workspaces/${encodeURIComponent(workspaceId)}/audit`;
  async function load(before=null) {
    setBusy(true);setError("");
    try {
      const result=await request(before === null ? base : `${base}/before/${before}`);
      if (!Array.isArray(result) || result.some(event=>!Number.isSafeInteger(event.id))) throw new Error("Unable to complete the request. Please try again.");
      setEvents(current=>before === null ? result : [...current,...result]);setMore(result.length===100);
    } catch(err) {setError(err.message);} finally {setBusy(false);}
  }
  return <section><h3>{L("Workspace activity")}</h3><button type="button" disabled={busy} onClick={()=>{if(!open)load();setOpen(!open);}}>{L(open ? "Hide activity" : "Show activity")}</button>{open && <>{error && <p role="alert">{L(error)}</p>}{busy && <p role="status">{L("Loading…")}</p>}{!busy && !error && events.length===0 && <p>{L("No activity yet.")}</p>}<ul className="account-portal__list">{events.map(event=><li key={event.id}><span>{event.actorEmail || event.actorId} · {L(auditActions[event.action] || event.action)}{event.targetEmail && event.targetUserId !== event.actorId ? ` · ${event.targetEmail}` : ""}{event.role ? ` · ${L(roleLabels[event.role] || event.role)}` : ""}{event.pageId ? ` · ${L("Application ID")}: ${event.pageId}` : ""} · {new Date(event.createdAt).toLocaleString()}</span></li>)}</ul>{more && <button type="button" disabled={busy} onClick={()=>load(events.at(-1).id)}>{L("Load older activity")}</button>}</>}</section>;
}

function ApiCredentials({L}) {
  const [items,setItems]=useState([]), [token,setToken]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false), [open,setOpen]=useState(false);
  async function load() { const data=await request('/api/account/credentials'); if(!Array.isArray(data.credentials)) throw new Error('Unable to complete the request. Please try again.'); setItems(data.credentials); }
  async function action(fn) {setBusy(true);setError('');try{await fn();}catch(err){setError(err.message);}finally{setBusy(false);}}
  async function create(event) {
    event.preventDefault();const form=event.currentTarget, values=new FormData(form);
    await action(async()=>{const result=await request('/api/account/credentials','POST',{name:String(values.get('name')),password:String(values.get('password')),scopes:['read','publish','share'],expiresAt:Date.now()+30*86400000});if(!/^[A-Za-z0-9_-]{43}$/.test(result.token || ''))throw new Error('Unable to complete the request. Please try again.');setToken(result.token);form.reset();await load();});
  }
  return <details className="account-portal__details" onToggle={event=>{const next=event.currentTarget.open;setOpen(next);if(next) action(load);else setToken('');}}>
    <summary>{L('API credentials')}</summary>
    {open && <><p>{L('Valid for 30 days; allows reading, publishing, and managing shares in your workspaces.')}</p>{error && <p className="account-portal__alert" role="alert">{L(error)}</p>}
      <form className="account-portal__form" onSubmit={create}><label>{L('Credential name')}<input name="name" maxLength={100} required /></label><label>{L('Current password')}<input name="password" type="password" autoComplete="current-password" required /></label><button disabled={busy}>{L('Create credential')}</button></form>
      {token && <div className="account-portal__generated"><label>{L('Credential')}<input readOnly value={token} onFocus={event=>event.target.select()} /></label><small>{L('Copy this credential now; it will not be shown again.')}</small></div>}
      {items.length===0 ? <p>{L('No credentials yet.')}</p> : <ul className="account-portal__list">{items.map(item=><li key={item.id}><span className="account-portal__identity">{item.name} · {L('Expires')}: {new Date(item.expiresAt).toLocaleString()}{item.revokedAt!==null ? ` · ${L('Revoked')}` : ''}{Array.isArray(item.scopes) ? ` · ${item.scopes.join(', ')}` : ''}</span>{item.revokedAt===null && <button type="button" disabled={busy} onClick={()=>{if(window.confirm(L('Revoke this credential?')))action(async()=>{await request(`/api/account/credentials/${encodeURIComponent(item.id)}`,'DELETE',{});setToken('');await load();});}}>{L('Revoke credential')}</button>}</li>)}</ul>}
    </>}
  </details>;
}

function AccountDeletion({ L, onDeleted, onSessionExpired }) {
  const [status, setStatus] = useState({ loading: true, canDelete: false, blockedTeams: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    request("/api/account/deletion")
      .then(data => { if (active) setStatus({ loading: false, canDelete: data?.deletion?.canDelete === true, blockedTeams: Array.isArray(data?.deletion?.blockedTeams) ? data.deletion.blockedTeams : [] }); })
      .catch(err => {
        if (!active) return;
        if (err.status === 401) onSessionExpired();
        else setError(err.message || "Account deletion status could not be loaded.");
        setStatus(current => ({ ...current, loading: false }));
      });
    return () => { active = false; };
  }, []);
  async function submit(event) {
    event.preventDefault();
    if (!window.confirm(L("Permanently delete this account and all personal applications? This cannot be undone."))) return;
    const form = event.currentTarget;
    const password = String(new FormData(form).get("password") || "");
    setBusy(true); setError("");
    try {
      await request("/api/account", "DELETE", { password });
      form.reset();
      onDeleted();
    } catch (err) {
      setError(err.code === "LAST_OWNER" ? "Transfer ownership of every team you own before deleting your account." : err.message);
    } finally { setBusy(false); }
  }
  return <details className="account-portal__danger">
    <summary>{L("Delete account")}</summary>
    <p>{L("Your personal applications and account email will be removed. Team applications remain with the team. Limited moderation and security records may be retained as described in the privacy notice.")}</p>
    {status.loading ? <p role="status">{L("Checking account deletion…")}</p> : null}
    {status.blockedTeams.length ? <div className="account-portal__alert" role="alert"><strong>{L("You are the last owner of these teams. Transfer ownership before deleting your account.")}</strong><ul>{status.blockedTeams.map(team => <li key={team.id}>{team.name}</li>)}</ul></div> : null}
    {error ? <p className="account-portal__alert" role="alert">{L(error)}</p> : null}
    <form className="account-portal__form" onSubmit={submit}>
      <label>{L("Current password")}<input name="password" type="password" autoComplete="current-password" required maxLength={1024} /></label>
      <button className="account-portal__danger-button" type="submit" disabled={busy || status.loading || !status.canDelete}>{L(busy ? "Working…" : "Delete account permanently")}</button>
    </form>
  </details>;
}

export default function AccountPortal({ onLegacyLogin }) {
  const locale = useLocale();
  const L = (text) => label(locale, text);
  const link = useRef(initialLink);
  const [mode, setMode] = useState(() => initialLink?.mode === "verify" || initialLink?.mode === "reset" ? initialLink.mode : "login");
  const [account, setAccount] = useState(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [spaces, setSpaces] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [activeTab, setActiveTab] = useState(() => initialLink?.mode === "join" ? "team" : "apps");
  const [members, setMembers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [detailsError, setDetailsError] = useState("");
  const [revision, setRevision] = useState(0);
  const [joinLink, setJoinLink] = useState("");
  const [approvalRoles, setApprovalRoles] = useState({});
  const [hosting, setHosting] = useState({ status: "loading", domain: null });
  const [retention, setRetention] = useState(null);
  const [hostingRevision, setHostingRevision] = useState(0);
  const selected = spaces.find(space => space.id === selectedId);
  const isOwner = selected?.type === "team" && selected.role === "owner";

  async function loadSession() {
    setChecking(true); setError("");
    try { const data = await request("/api/account/me"); setAccount(data.account || null); }
    catch (err) { setError(err.message); }
    finally { setChecking(false); }
  }
  useEffect(() => { loadSession(); }, []);
  useEffect(() => {
    let active = true;
    setHosting({ status: "loading", domain: null });
    request("/api/features").then(data => {
      if (!active) return;
      const config = hostingConfig(data);
      const policy=data.retention;
      setRetention(policy?.mode === "long-term" ? policy : policy?.mode === "inactivity" && data.retentionActive === true && Number.isSafeInteger(policy.days) && Number.isSafeInteger(policy.notifyBeforeDays) ? policy : null);
      setHosting(config ? { status: "ready", config } : data.ipHostingOrigin || data.hostingDomain != null ? { status: "invalid", config: null } : { status: "unavailable", config: null });
    }).catch(() => { if (active) { setHosting({ status: "error", domain: null }); setRetention(null); } });
    return () => { active = false; };
  }, [hostingRevision]);
  useEffect(() => {
    if (!account) { setSpaces([]); setSelectedId(""); return; }
    let active = true;
    request("/api/workspaces").then(data => {
      if (!active) return;
      setSpaces(data); setSelectedId(id => data.some(space => space.id === id) ? id : (data[0]?.id || ""));
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [account, revision]);
  useEffect(() => {
    setMembers([]); setRequests([]); setJoinLink(""); setDetailsError("");
    if (!selectedId || !selected) return;
    let active = true;
    const base = `/api/workspaces/${encodeURIComponent(selectedId)}`;
    Promise.all([request(`${base}/members`), isOwner ? request(`${base}/join-requests`) : Promise.resolve([])])
      .then(([m, r]) => { if (active) { setMembers(m); setRequests(r.filter(item => item.status === "pending")); } })
      .catch(err => { if (active) setDetailsError(err.message); });
    return () => { active = false; };
  }, [selectedId, isOwner, revision]);

  function changeMode(next) { setMode(next); setError(""); setNotice(""); if (link.current?.mode !== "join") { link.current = null; initialLink = null; } }
  async function run(action, success) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); if (success) setNotice(success); return true; }
    catch (err) { setError(err.message); return false; }
    finally { setBusy(false); }
  }
  async function submitAccount(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const email = String(values.get("email") || "").trim();
    const password = String(values.get("password") || "");
    const token = link.current?.token;
    if ((mode === "verify" || mode === "reset") && !token) { setError("The link is missing or expired. Request a new one."); return; }
    const routes = { login: ["login", { email, password }], register: ["register", { email, password }], forgot: ["forgot-password", { email }], resend: ["resend-verification", { email }], verify: ["verify", { token }], reset: ["reset-password", { token, password }] };
    const [route, body] = routes[mode];
    const ok = await run(async () => {
      const data = await request(`/api/account/${route}`, "POST", body);
      if (mode === "login") setAccount(data.account);
      if (mode === "reset") {
        // The reset revokes the affected account's sessions, which may include
        // this tab. A link can also belong to a different signed-in account.
        const session = await request("/api/account/me").catch(() => null);
        setAccount(session?.account || null);
      }
    }, mode === "verify" ? "Email verified. You can now sign in." : mode === "reset" ? "Password reset. You can now sign in." : ["register", "forgot", "resend"].includes(mode) ? "If applicable, check your email for further instructions." : "");
    if (ok) {
      form.reset();
      if (mode === "verify" || mode === "reset") { link.current = null; initialLink = null; setMode("login"); }
    }
  }
  async function mutate(path, method, body, message = "Changes saved.") {
    const ok = await run(() => request(path, method, body), message);
    if (ok) setRevision(value => value + 1);
    return ok;
  }
  async function submitJoin(event) {
    event.preventDefault(); const form = event.currentTarget;
    let token = String(new FormData(form).get("join") || "").trim();
    try { const url = new URL(token); token = new URLSearchParams(url.hash.slice(1)).get("token") || ""; } catch { /* Accept a raw token. */ }
    if (await mutate("/api/workspaces/join-requests", "POST", { token }, "Join request submitted.")) { form.reset(); link.current = null; initialLink = null; }
  }
  const base = selectedId ? `/api/workspaces/${encodeURIComponent(selectedId)}` : "";
  const verifyOrReset = mode === "verify" || mode === "reset";
  const retentionNote = <p className="account-portal__access-note"><strong>{L("Retention policy")}: </strong>{retention?.mode === "long-term" ? L("Applications are kept long-term.") : retention?.mode === "inactivity" ? <>{L("Applications may be deleted after")} {retention.days} {L("days without updates; owners are notified at least")} {retention.notifyBeforeDays} {L("days beforehand. Visits do not reset this period.")}</> : L("Retention status is unavailable. Refresh to check.")} <button type="button" className="account-portal__access-retry" onClick={() => setHostingRevision(value => value + 1)}>{L("Refresh")}</button></p>;

  return <main className="account-portal">
    <header className="account-portal__header"><strong className="account-portal__brand">Hostlet <span>/ {L("Account and workspaces")}</span></strong><div className="account-portal__header-actions"><a href="/">{L("Back to public site")}</a><a href="/report">{L("Report an application")}</a><LanguageSwitch />{account ? <button type="button" disabled={busy} onClick={() => run(async () => { await request("/api/account/logout", "POST", {}); setAccount(null); link.current = null; initialLink = null; setJoinLink(""); setMode("login"); }, "")}>{L("Sign out")}</button> : null}</div></header>
    {checking ? <p className="account-portal__loading" role="status">{L("Loading…")}</p> : <div className={`account-portal__body${account ? ' account-portal__body--signed-in' : ''}`}>
      {!account && <section className="account-portal__intro"><p className="account-portal__eyebrow">HOSTLET / ACCOUNT</p><h1>{L("A place for your work.")}</h1><p>{L("Sign in to manage your personal and team spaces.")}</p></section>}
      <section className="account-portal__main">
        {error ? <div className="account-portal__alert" role="alert">{L(error)} {error === "Your session has expired. Please sign in again." ? <button type="button" onClick={() => { setAccount(null); setError(""); setMode("login"); }}>{L("Use another account")}</button> : null} {checking === false && !account && error === "Network error. Check your connection and try again." ? <button type="button" onClick={loadSession}>{L("Try again")}</button> : null}</div> : null}
        {notice ? <p className="account-portal__notice" role="status">{L(notice)}</p> : null}
        {notice === "If applicable, check your email for further instructions." ? <p>{L("If you do not receive an email, check spam, try again, or contact the administrator.")}</p> : null}
        {!account || verifyOrReset ? <div className="account-portal__panel"><h2>{L(({ login: "Account sign in", register: "Create account", forgot: "Forgot password", resend: "Resend verification", verify: "Verify email", reset: "Reset password" })[mode])}</h2>{mode === "register" ? retentionNote : null}
          <form onSubmit={submitAccount} className="account-portal__form">
            {["login", "register", "forgot", "resend"].includes(mode) ? <label>{L("Email")}<input name="email" type="email" autoComplete="email" required /></label> : null}
            {["login", "register", "reset"].includes(mode) ? <label>{L(mode === "reset" ? "New password" : "Password")}<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? undefined : 12} required />{mode !== "login" ? <small>{L("At least 12 characters")}</small> : null}</label> : null}
            <button className="account-portal__primary" disabled={busy} type="submit">{L(busy ? "Working…" : ({ login: "Sign in", register: "Register", forgot: "Send reset link", resend: "Send verification link", verify: "Verify", reset: "Save password" })[mode])}</button>
          </form>
          <nav className="account-portal__links" aria-label={L("Account and workspaces")}>{mode !== "login" ? <button type="button" onClick={() => changeMode("login")}>{L("Back to sign in")}</button> : <><button type="button" onClick={() => changeMode("register")}>{L("Create account")}</button><button type="button" onClick={() => changeMode("forgot")}>{L("Forgot password")}</button><button type="button" onClick={() => changeMode("resend")}>{L("Resend verification")}</button>{onLegacyLogin ? <button type="button" onClick={onLegacyLogin}>{L("Administrator access")}</button> : null}</>}</nav>
        </div> : <>
          <div className="account-portal__heading"><div><p className="account-portal__eyebrow">{account.email}</p><h2>{L("Workspaces")}</h2></div><button type="button" disabled={busy} onClick={() => { setError(""); setRevision(value => value + 1); setHostingRevision(value => value + 1); }}>{L("Refresh")}</button></div>{retentionNote}
          <div className="account-portal__spaces">{spaces.length ? spaces.map(space => <button type="button" key={space.id} aria-pressed={space.id === selectedId} onClick={() => setSelectedId(space.id)}><strong>{space.name}</strong><span>{L(space.type === "personal" ? "Personal" : "Team")} · {L(roleLabels[space.role] || space.role)}</span></button>) : <p>{L("No workspaces yet.")}</p>}</div>
          <nav className="account-portal__tabs" aria-label={L("Account and workspaces")}>{[["apps", "Applications"], ["team", "Team and members"], ["settings", "Account settings"]].map(([id, title]) => <button key={id} type="button" aria-pressed={activeTab === id} onClick={() => setActiveTab(id)}>{L(title)}</button>)}</nav>
          <div hidden={activeTab !== "team"}><details open={link.current?.mode === "join" || undefined}><summary>{L("Create a team")} / {L("Join a team")}</summary><div className="account-portal__forms"><form onSubmit={async event => { event.preventDefault(); const form = event.currentTarget; if (await mutate("/api/workspaces", "POST", { name: String(new FormData(form).get("name")).trim(), type: "team" })) form.reset(); }}><h3>{L("Create a team")}</h3><label>{L("Team name")}<input name="name" maxLength={200} required /></label><button disabled={busy}>{L("Create")}</button></form>
            <form onSubmit={submitJoin}><h3>{L("Join a team")}</h3><label>{L("Join link or token")}<input name="join" defaultValue={link.current?.mode === "join" ? link.current.token : ""} required autoComplete="off" /></label><button disabled={busy}>{L("Request to join")}</button></form></div></details></div>
          {selected ? <><div hidden={activeTab !== "apps"}><WorkspaceApplications key={selected.id} workspace={selected} L={L} hosting={hosting} retryHosting={() => setHostingRevision(value => value + 1)} onSessionExpired={() => { setAccount(null); setError(""); setMode("login"); }} /></div><section hidden={activeTab !== "team"} className="account-portal__details"><div className="account-portal__heading"><div><p className="account-portal__eyebrow">{L(selected.type === "personal" ? "Personal" : "Team")}</p><h2>{selected.name}</h2></div><span>{L("Your role")}: {L(roleLabels[selected.role] || selected.role)}</span></div>
            {selected.type === "team" && <button type="button" disabled={busy} onClick={async()=>{if(!window.confirm(L("Leave this team? You will lose access to its private applications.")))return;const leftId=selected.id;if(await run(()=>request(`${base}/leave`,"POST",{}),"You left the team.")){setSpaces(current=>current.filter(space=>space.id!==leftId));setSelectedId("");setRevision(value=>value+1);}}}>{L("Leave team")}</button>}
            {detailsError ? <p className="account-portal__alert" role="alert">{L(detailsError)} <button type="button" onClick={() => setRevision(value => value + 1)}>{L("Try again")}</button></p> : <><h3>{L("Members")}</h3><ul className="account-portal__list">{members.map(member => <li key={member.userId}><span className="account-portal__identity">{member.email || member.userId}{member.userId === account.id ? ` (${L("You")})` : ""}</span>{isOwner ? <><RoleSelect L={L} value={member.role} disabled={busy} ariaLabel={`${L("Your role")} ${member.email || member.userId}`} onChange={event => mutate(`${base}/members/${encodeURIComponent(member.userId)}`, "PATCH", { role: event.target.value })} /><button type="button" disabled={busy} onClick={() => { if (window.confirm(L("Remove this member?"))) mutate(`${base}/members/${encodeURIComponent(member.userId)}`, "DELETE"); }}>{L("Remove")}</button></> : <span>{L(roleLabels[member.role] || member.role)}</span>}</li>)}</ul>
            {isOwner ? <><h3>{L("Join requests")}</h3>{requests.length ? <ul className="account-portal__list">{requests.map(item => <li key={item.id}><span className="account-portal__identity">{item.email || item.userId}</span><RoleSelect L={L} value={approvalRoles[item.id] || "viewer"} disabled={busy} ariaLabel={`${L("Approve")} ${item.email || item.userId}`} onChange={event => setApprovalRoles(values => ({ ...values, [item.id]: event.target.value }))} /><button type="button" disabled={busy} onClick={() => mutate(`${base}/join-requests/${encodeURIComponent(item.id)}/approve`, "POST", { role: approvalRoles[item.id] || "viewer" })}>{L("Approve")}</button><button type="button" disabled={busy} onClick={() => mutate(`${base}/join-requests/${encodeURIComponent(item.id)}/reject`, "POST", {})}>{L("Reject")}</button></li>)}</ul> : <p>{L("No pending requests.")}</p>}
              <h3>{L("Join link")}</h3><p>{L("Generating a new link invalidates the previous link.")}</p><div className="account-portal__links"><button type="button" disabled={busy} onClick={() => run(async () => { const data = await request(`${base}/join-link`, "POST", {}); const url = new URL("/join-workspace", window.location.origin); url.hash = new URLSearchParams({ token: data.token }).toString(); setJoinLink(url.href); }, "")}>{L("Generate a new join link")}</button><button type="button" disabled={busy} onClick={async () => { if (await mutate(`${base}/join-link`, "DELETE", undefined, "Link revoked.")) setJoinLink(""); }}>{L("Revoke join link")}</button></div>
              {joinLink ? <div className="account-portal__generated"><label>{L("Join link")}<input value={joinLink} readOnly onFocus={event => event.target.select()} /></label><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(joinLink); setNotice("Link copied."); } catch { setError("Could not access the clipboard. Select and copy the link instead."); } }}>{L("Copy link")}</button><small>{L("Copy the link before leaving this page; it will not be shown again.")}</small></div> : null}</> : null}{selected.role === "owner" && <TeamActivity key={`audit-${selected.id}`} workspaceId={selected.id} L={L} />}</>}
          </section></> : <p>{L("Select a workspace to see its members.")}</p>}
          <div hidden={activeTab !== "settings"}><details><summary>{L("API credentials")}</summary><ApiCredentials L={L} /></details>
          <details><summary>{L("Delete account")}</summary><AccountDeletion L={L} onDeleted={() => { setAccount(null); setSpaces([]); setSelectedId(""); setMode("login"); setError(""); setNotice("Account deleted. A new account can be created with the same email."); }} onSessionExpired={() => { setAccount(null); setError(""); setMode("login"); }} /></details></div>
        </>}
      </section>
    </div>}
  </main>;
}

