import { useEffect, useState } from "react";
import { useLocale } from "../i18n.js";
import AdminShell from "./AdminShell.jsx";
import "../platform-admin.css";

const zh = {
  "Workspaces": "工作空间", "Workspace quotas": "工作空间配额", "Owner email": "所有者邮箱", "Workspace ID": "工作空间 ID", "Personal": "个人", "Team": "团队", "Select workspace": "选择空间", "Selected": "已选择", "Load more": "加载更多", "No workspaces found.": "暂无工作空间。", "Select a workspace to view its quota.": "请选择工作空间以查看配额。", "Current effective quota": "当前生效配额", "The API does not indicate whether these values are defaults or an override. Saving creates a workspace override that takes precedence over platform defaults.": "接口未标明当前值来自默认配额还是单独覆盖。保存后将设置该空间的单独配额，优先于平台默认配额。", "Save workspace quota": "保存空间配额", "Workspace quota saved.": "空间配额已保存。", "Discard unsaved workspace quota changes?": "放弃尚未保存的空间配额更改？", "Confirm workspace quota change for:": "确认修改以下空间的配额：", "Reload workspace list": "重新加载空间列表", "Reload quota": "重新加载配额", "Quota changes may have been applied. Reload the quota before retrying.": "配额更改可能已经生效，请重新加载配额后再试。", "Loading workspaces…": "正在加载工作空间…", "Loading quota…": "正在加载配额…", "Refresh replaces unsaved changes. Continue?": "刷新将覆盖尚未保存的更改，是否继续？",
  "Platform administration": "平台管理", "Administration": "平台管理", "Settings and moderation": "设置与内容治理", "Manage registration, default limits and reported pages.": "管理注册、默认配额和被举报的页面。", "Back to workspace": "返回工作台", "Refresh": "刷新", "Refreshing…": "刷新中…", "Loading…": "加载中…", "Settings": "平台设置", "Registration": "用户注册", "Allow account registration": "允许注册账户", "Default workspace quotas": "工作空间默认配额", "Maximum applications (count)": "应用数量上限（个）", "Maximum storage (bytes)": "存储上限（字节）", "Maximum upload (bytes)": "单次上传上限（字节）", "Enter whole numbers in bytes; 1 MiB = 1,048,576 bytes. Upload cannot exceed storage.": "请输入整数，存储单位为字节；1 MiB = 1,048,576 字节。单次上传上限不能超过存储上限。", "Workspace-specific quotas take precedence over these defaults. All retained versions count toward storage usage.": "工作空间单独配置的配额优先于默认配额；所有保留的历史版本均计入存储用量。", "Retention policy": "保留策略", "Current configured policy": "当前配置的策略", "Long-term": "长期保留", "Inactivity": "按不活跃时间保留", "Inactivity period": "不活跃期限", "Advance notice": "提前通知", "days": "天", "Automatic cleanup is not enabled. This interface cannot enable cleanup; the existing policy is shown only and remains unchanged when saving.": "自动清理尚未启用，此界面不能启用清理；这里只展示现有策略，保存时不会修改它。", "Save settings": "保存设置", "Saving…": "保存中…", "Reports": "举报列表", "The latest 50 reports are shown.": "显示最近 50 条举报。", "No reports yet.": "暂无举报。", "Page ID": "页面 ID", "Report ID": "举报 ID", "Submitted": "提交时间", "Resolved": "已解决", "Pending": "待处理", "Resolve report": "标记为已解决", "Suspend page": "停用页面", "Restore page": "恢复页面", "The API does not provide the page’s current suspension status. Check the outcome of each action.": "接口未提供页面当前停用状态，请根据操作结果确认。", "Resolve this report?": "确定将此举报标记为已解决？", "Suspend this page? Its content will no longer be accessible.": "确定停用此页面？停用后其内容将无法访问。", "Restore this page? Its content may become accessible again.": "确定恢复此页面？恢复后其内容可能重新开放访问。", "Settings saved.": "设置已保存。", "Report resolved.": "举报已标记为已解决。", "Page suspended.": "页面已停用。", "Page restored.": "页面已恢复。", "Enter non-negative whole numbers within the safe integer range; upload must not exceed storage.": "请输入安全整数范围内的非负整数，且单次上传上限不能超过存储上限。", "Network error. Check your connection and refresh before retrying; the operation may have completed.": "网络连接失败，请检查网络并刷新后再试；操作可能已经完成。", "Your administrator session has expired. Sign in again, then refresh this page.": "管理员会话已过期，请重新登录后刷新此页面。", "Access denied. Check the management address and administrator permissions.": "访问被拒绝，请检查管理地址和管理员权限。", "The page, report or platform API was not found. Refresh and check that the platform service is enabled.": "页面、举报或平台接口不存在。请刷新并检查平台服务是否启用。", "The state has changed or the page is already in that state. Refresh before trying again.": "状态已变化，或页面已处于该状态。请刷新后再操作。", "Invalid request. Check the values and refresh before trying again.": "请求无效，请检查输入并刷新后重试。", "The request is too large.": "请求内容过大。", "Unsupported request format.": "请求格式不受支持。", "Too many requests. Please try again later.": "请求过于频繁，请稍后重试。", "The platform service is unavailable or returned an unexpected response. Refresh before trying again.": "平台服务不可用或返回了异常响应，请刷新后重试。", "Refreshing replaces unsaved settings. Continue?": "刷新将覆盖尚未保存的设置，是否继续？", "Changes may have been applied. Refresh before trying again.": "更改可能已经生效，请刷新后再操作。", "Working…": "处理中…", "Unknown": "未知"
};
const errors = { 400: "Invalid request. Check the values and refresh before trying again.", 401: "Your administrator session has expired. Sign in again, then refresh this page.", 403: "Access denied. Check the management address and administrator permissions.", 404: "The page, report or platform API was not found. Refresh and check that the platform service is enabled.", 409: "The state has changed or the page is already in that state. Refresh before trying again.", 413: "The request is too large.", 415: "Unsupported request format.", 429: "Too many requests. Please try again later." };
const fallback = "The platform service is unavailable or returned an unexpected response. Refresh before trying again.";
Object.assign(zh, {
  "Load older reports": "加载更早的举报",
  "Application status": "应用状态", "Not suspended": "未停用", "Suspended": "已停用", "Deleted": "已删除",
  "Using platform defaults": "使用平台默认配额", "Using workspace-specific quota": "使用空间单独配额", "Restore platform defaults": "恢复平台默认配额", "Restore platform defaults for this workspace? Unsaved changes will be discarded.": "确定恢复此空间的平台默认配额？未保存的更改将被放弃。", "Platform defaults restored.": "已恢复平台默认配额。", "Existing applications and ongoing uploads are retained when limits change.": "调整额度不会删除已有应用，也不会取消正在进行的上传。",
  "Service status": "服务状态", "Account email": "账号邮件", "Retention scan": "保留策略扫描", "Temporary record cleanup": "临时记录清理",
  "No result yet": "暂无结果", "Last result: successful": "最近一次成功", "Last result: failed": "最近一次失败", "Failures since startup": "启动以来失败次数", "Consecutive failures": "连续失败次数",
  "Notification failures": "通知失败数", "Deletion failures": "清理失败数", "Applications requiring attention": "需要检查的应用数", "Check workspace owners and verified email addresses; data inconsistencies may also prevent cleanup.": "请检查工作空间所有者及其已验证邮箱；数据不一致也可能导致清理被阻止。",
  "View affected applications": "查看受影响的应用", "Refresh affected applications": "刷新受影响的应用", "No current issues in this batch.": "本批次暂无问题。", "Owner or verified email unavailable": "所有者或已验证邮箱不可用", "Application metadata invalid": "应用元数据无效", "Current results may differ from the last scan.": "当前结果可能与上次扫描不同。",
  "Status is reset when the service restarts. Email acceptance does not guarantee delivery. Set up external monitoring for persistent alerts.": "服务重启后状态会重置。邮件服务器接受邮件不代表已送达；持续告警请配置外部监控。",
  "Choose how long inactive applications are kept.": "设置应用长期未更新时的保留方式。",
  "Updating an application resets its inactivity period; visits do not. Owners are notified before cleanup.": "更新应用会重新计算不活跃时间，访问不会。清理前会通知所有者。",
  "Enter a notice period of at least one day, shorter than the inactivity period (up to 36500 days).": "提前通知至少为 1 天，且必须短于不活跃期限；不活跃期限最多 36500 天。",
  "Enable automatic cleanup for inactive applications? Owners will be notified before deletion.": "确定启用不活跃应用自动清理？删除前会通知所有者。"
});

async function request(path, method = "GET", body) {
  let response;
  try {
    response = await fetch(`/api/platform${path}`, { method, credentials: "same-origin", cache: "no-store", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new Error("Network error. Check your connection and refresh before retrying; the operation may have completed."); }
  if (response.status === 401) window.dispatchEvent(new Event("hostlet:admin-session-expired"));
  if (!response.ok) throw new Error(errors[response.status] || fallback);
  if (response.status === 204) return null;
  try { return await response.json(); } catch { throw new Error(fallback); }
}

function validSettings(value) {
  return value && typeof value.registrationEnabled === "boolean" && value.retention && ["long-term", "inactivity"].includes(value.retention.mode) && value.defaultQuotas && ["maxApps", "maxStorageBytes", "maxUploadBytes"].every(key => Number.isSafeInteger(value.defaultQuotas[key]) && value.defaultQuotas[key] >= 0);
}
function date(value, locale) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString(locale) : "—";
}

const quotaFields = [["maxApps", "Maximum applications (count)"], ["maxStorageBytes", "Maximum storage (bytes)"], ["maxUploadBytes", "Maximum upload (bytes)"]];
const quotaDraft = quota => Object.fromEntries(quotaFields.map(([key]) => [key, String(quota[key])]));
const retentionDraft = value => ({mode:value.mode,days:String(value.days ?? 30),notifyBeforeDays:String(value.notifyBeforeDays ?? 7)});
const settingsDraft = value => ({registrationEnabled:value.registrationEnabled,defaultQuotas:quotaDraft(value.defaultQuotas),retention:retentionDraft(value.retention)});
const validQuota = quota => quota && quotaFields.every(([key]) => Number.isSafeInteger(quota[key]) && quota[key] >= 0) && quota.maxUploadBytes <= quota.maxStorageBytes;
const validQuotaConfig = value => value && quotaFields.every(([key])=>Number.isSafeInteger(value[key]) && value[key]>=0) && ['default','override'].includes(value.source);
const validWorkspacePage = (result, offset) => Array.isArray(result?.workspaces) && result.workspaces.every(item => item && typeof item.id === "string" && item.id.trim() && typeof item.name === "string" && typeof item.type === "string" && typeof item.ownerEmail === "string") && (result.nextOffset === null || (Number.isSafeInteger(result.nextOffset) && result.nextOffset > offset));
const validReportPage = result => Array.isArray(result?.reports) && result.reports.every(report=>['active','suspended','deleted'].includes(report.pageState)) && (result.nextCursor === null || (Number.isSafeInteger(result.nextCursor?.createdAt) && result.nextCursor.createdAt >= 0 && typeof result.nextCursor.id === "string" && result.nextCursor.id.length > 0));

function RetentionIssues({L}) {
  const [issues,setIssues]=useState(null),[cursor,setCursor]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
  async function load(after=null) {
    setLoading(true);setError("");
    try {
      const result=await request(after ? `/retention-issues/after/${encodeURIComponent(after)}` : '/retention-issues');
      if (!Array.isArray(result?.issues) || !result.issues.every(item=>typeof item.pageId==='string' && typeof item.workspaceId==='string' && ['metadata','owners'].includes(item.reason)) || !(result.nextCursor===null || typeof result.nextCursor==='string')) throw new Error(fallback);
      setIssues(current=>after ? [...current,...result.issues] : result.issues);setCursor(result.nextCursor);
    } catch(err) {setError(err.message);} finally {setLoading(false);}
  }
  return <div><button type="button" disabled={loading} onClick={()=>load()}>{L(issues===null ? 'View affected applications' : 'Refresh affected applications')}</button>{issues!==null && <><p className="platform-admin__hint">{L('Current results may differ from the last scan.')}</p>{issues.length===0 && <p>{L('No current issues in this batch.')}</p>}<ul>{issues.map(item=><li key={item.pageId}>{L('Page ID')}: {item.pageId} · {L('Workspace ID')}: {item.workspaceId} · {L(item.reason==='owners' ? 'Owner or verified email unavailable' : 'Application metadata invalid')}</li>)}</ul>{cursor && <button type="button" disabled={loading} onClick={()=>load(cursor)}>{L('Load more')}</button>}</>}{loading && <p role="status">{L('Loading…')}</p>}{error && <p role="alert">{L(error)}</p>}</div>;
}

function OperationsStatus({L, locale}) {
  const [status,setStatus]=useState(null);
  const [error,setError]=useState("");
  useEffect(()=>{let active=true;request("/operations").then(value=>{
    if (!['accountMail','retention','temporaryCleanup'].every(key=>value?.[key] && ['unknown','ok','failed'].includes(value[key].lastResult) && (value[key].lastAt === null || Number.isSafeInteger(value[key].lastAt)) && Number.isSafeInteger(value[key].failures) && Number.isSafeInteger(value[key].consecutiveFailures))) throw new Error(fallback);
    if(active)setStatus(value);
  }).catch(err=>{if(active)setError(err.message);});return()=>{active=false;};},[]);
  return <section className="platform-admin__panel"><h2>{L("Service status")}</h2><p className="platform-admin__hint">{L("Status is reset when the service restarts. Email acceptance does not guarantee delivery. Set up external monitoring for persistent alerts.")}</p>{error ? <p role="alert">{L(error)}</p> : !status ? <p role="status">{L("Loading…")}</p> : <><ul>{[['accountMail','Account email'],['retention','Retention scan'],['temporaryCleanup','Temporary record cleanup']].map(([key,title])=>{const item=status[key];return <li key={key}><strong>{L(title)}</strong>: {L(item.lastResult === 'ok' ? 'Last result: successful' : item.lastResult === 'failed' ? 'Last result: failed' : 'No result yet')}{item.lastAt !== null ? ` · ${date(item.lastAt,locale)}` : ''} · {L('Failures since startup')}: {item.failures} · {L('Consecutive failures')}: {item.consecutiveFailures}</li>;})}</ul>{status.retentionDetails && <p>{L('Notification failures')}: {status.retentionDetails.deliveryFailures} · {L('Deletion failures')}: {status.retentionDetails.deletionFailures} · {L('Applications requiring attention')}: {status.retentionDetails.blockedPages}{status.retentionDetails.blockedPages > 0 && <> · {L('Check workspace owners and verified email addresses; data inconsistencies may also prevent cleanup.')}</>}</p>}{status.retentionDetails?.blockedPages > 0 && <RetentionIssues L={L} />}</>}</section>;
}

function WorkspaceManager({ L, onDirtyChange, onBusyChange }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [offset, setOffset] = useState(null);
  const [selected, setSelected] = useState(null);
  const [quota, setQuota] = useState(null);
  const [draft, setDraft] = useState(null);
  const [listLoading, setListLoading] = useState(false);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState("");
  const [quotaError, setQuotaError] = useState("");
  const [notice, setNotice] = useState("");
  const [listKey, setListKey] = useState(0);
  const [quotaKey, setQuotaKey] = useState(0);
  const [reloadRequired, setReloadRequired] = useState(false);
  const dirty = Boolean(quota && draft && quotaFields.some(([key]) => String(quota[key]) !== draft[key]));

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(saving); return () => onBusyChange(false); }, [saving, onBusyChange]);
  useEffect(() => {
    let active = true;
    setListLoading(true); setListError(""); setWorkspaces([]); setOffset(null);
    request("/workspaces").then(result => {
      if (!validWorkspacePage(result, 0)) throw new Error(fallback);
      if (active) { setWorkspaces(result.workspaces); setOffset(result.nextOffset); }
    }).catch(err => { if (active) setListError(err.message); }).finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [listKey]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setQuotaLoading(true); setQuota(null); setDraft(null); setQuotaError(""); setReloadRequired(false);
    request(`/workspaces/${encodeURIComponent(selected.id)}/quota`).then(result => {
      if (!validQuotaConfig(result)) throw new Error(fallback);
      if (active) { setQuota(result); setDraft(quotaDraft(result)); }
    }).catch(err => { if (active) setQuotaError(err.message); }).finally(() => { if (active) setQuotaLoading(false); });
    return () => { active = false; };
  }, [selected, quotaKey]);

  async function loadMore() {
    setListLoading(true); setListError("");
    try {
      const result = await request(`/workspaces/page/${offset}`);
      if (!validWorkspacePage(result, offset)) throw new Error(fallback);
      setWorkspaces(previous => { const ids = new Set(previous.map(item => item.id)); return [...previous, ...result.workspaces.filter(item => !ids.has(item.id))]; });
      setOffset(result.nextOffset);
    } catch (err) { setListError(err.message); } finally { setListLoading(false); }
  }
  function selectWorkspace(item) {
    if (selected?.id === item.id) return;
    if (dirty && !window.confirm(L("Discard unsaved workspace quota changes?"))) return;
    setNotice(""); setSelected(item);
  }
  function reloadList() {
    if (dirty && !window.confirm(L("Discard unsaved workspace quota changes?"))) return;
    setSelected(null); setQuota(null); setDraft(null); setQuotaError(""); setNotice(""); setListKey(value => value + 1);
  }
  function reloadQuota() {
    if (dirty && !window.confirm(L("Discard unsaved workspace quota changes?"))) return;
    setNotice(""); setQuotaKey(value => value + 1);
  }
  async function saveQuota(event) {
    event.preventDefault();
    const value = Object.fromEntries(quotaFields.map(([key]) => [key, /^\d+$/.test(draft[key]) ? Number(draft[key]) : NaN]));
    if (!validQuota(value)) { setQuotaError("Enter non-negative whole numbers within the safe integer range; upload must not exceed storage."); return; }
    if (!window.confirm(`${L("Confirm workspace quota change for:")}\n${selected.name}\n${L("Owner email")}: ${selected.ownerEmail}\n${L("Workspace ID")}: ${selected.id}`)) return;
    setSaving(true); setQuotaError(""); setNotice("");
    try {
      const result = await request(`/workspaces/${encodeURIComponent(selected.id)}/quota`, "PUT", value);
      if (!validQuotaConfig(result)) throw new Error(fallback);
      setQuota(result); setDraft(quotaDraft(result)); setNotice("Workspace quota saved.");
    } catch (err) { setQuotaError(err.message); setReloadRequired(true); } finally { setSaving(false); }
  }
  async function restoreDefaults() {
    if (!window.confirm(L('Restore platform defaults for this workspace? Unsaved changes will be discarded.'))) return;
    setSaving(true);setQuotaError('');setNotice('');
    try {
      const result=await request(`/workspaces/${encodeURIComponent(selected.id)}/quota`,'DELETE',{});
      if(!validQuotaConfig(result))throw new Error(fallback);
      setQuota(result);setDraft(quotaDraft(result));setNotice('Platform defaults restored.');
    } catch(err) {setQuotaError(err.message);setReloadRequired(true);} finally {setSaving(false);}
  }
  return <section className="platform-admin__panel"><div className="platform-admin__workspace-heading"><h2>{L("Workspaces")}</h2><button type="button" disabled={listLoading || quotaLoading || saving} onClick={reloadList}>{L("Reload workspace list")}</button></div>
    {listError && <p className="platform-admin__alert" role="alert">{L(listError)}</p>}
    {listLoading && <p role="status">{L("Loading workspaces…")}</p>}
    {!listLoading && !listError && workspaces.length === 0 && <p>{L("No workspaces found.")}</p>}
    <ul className="platform-admin__workspaces">{workspaces.map(item => <li key={item.id}><div className="platform-admin__workspace-identity"><strong>{item.name}</strong><span>{L(item.type === "personal" ? "Personal" : item.type === "team" ? "Team" : "Unknown")}</span><span>{L("Owner email")}: {item.ownerEmail}</span><span>{L("Workspace ID")}: {item.id}</span></div><button type="button" aria-pressed={selected?.id === item.id} disabled={saving || quotaLoading || listLoading} onClick={() => selectWorkspace(item)}>{L(selected?.id === item.id ? "Selected" : "Select workspace")}</button></li>)}</ul>
    {offset !== null && <button type="button" disabled={listLoading || saving || quotaLoading} onClick={loadMore}>{L("Load more")}</button>}
    {!selected && <p className="platform-admin__hint">{L("Select a workspace to view its quota.")}</p>}
    {selected && <div className="platform-admin__workspace-quota"><h3>{L("Workspace quotas")}</h3><div className="platform-admin__workspace-identity"><strong>{selected.name}</strong><span>{L("Owner email")}: {selected.ownerEmail}</span><span>{L("Workspace ID")}: {selected.id}</span></div>
      {quota && <p className="platform-admin__hint">{L(quota.source === 'default' ? 'Using platform defaults' : 'Using workspace-specific quota')}. {L('Existing applications and ongoing uploads are retained when limits change.')}</p>}
      {quotaLoading && <p role="status">{L("Loading quota…")}</p>}
      {quotaError && <p className="platform-admin__alert" role="alert">{L(quotaError)} {reloadRequired && L("Quota changes may have been applied. Reload the quota before retrying.")}{quotaError === errors[401] && <> <a href="/console">{L("Back to workspace")}</a></>}</p>}
      {notice && <p className="platform-admin__notice" role="status">{L(notice)}</p>}
      <button type="button" disabled={quotaLoading || saving} onClick={reloadQuota}>{L("Reload quota")}</button>
      {quota?.source === 'override' && <button type="button" disabled={quotaLoading || saving || reloadRequired} onClick={restoreDefaults}>{L('Restore platform defaults')}</button>}
      {quota && draft && <form onSubmit={saveQuota}><fieldset disabled={quotaLoading || saving || reloadRequired}><legend>{L("Current effective quota")}</legend><div className="platform-admin__quotas">{quotaFields.map(([key, title]) => <label key={key}>{L(title)}<input type="number" min="0" max="9007199254740991" step="1" required value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></label>)}</div><p className="platform-admin__hint">{L("Enter whole numbers in bytes; 1 MiB = 1,048,576 bytes. Upload cannot exceed storage.")}</p></fieldset><button className="platform-admin__primary" disabled={quotaLoading || saving || reloadRequired || !dirty} type="submit">{L(saving ? "Saving…" : "Save workspace quota")}</button></form>}
    </div>}
  </section>;
}

export default function PlatformAdmin() {
  const locale = useLocale();
  const L = text => locale === "zh-CN" ? (zh[text] || text) : text;
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState(null);
  const [reports, setReports] = useState(null);
  const [reportCursor, setReportCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const dirty = settings && draft && (settings.registrationEnabled !== draft.registrationEnabled || Object.keys(settings.defaultQuotas).some(key => String(settings.defaultQuotas[key]) !== draft.defaultQuotas[key]) || settings.retention.mode !== draft.retention.mode || (draft.retention.mode === "inactivity" && (String(settings.retention.days) !== draft.retention.days || String(settings.retention.notifyBeforeDays) !== draft.retention.notifyBeforeDays)));

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    Promise.all([request("/settings"), request("/reports")]).then(([next, result]) => {
      if (!validSettings(next) || !validReportPage(result)) throw new Error(fallback);
      if (!active) return;
      setSettings(next);
      setDraft(settingsDraft(next));
      setReports(result.reports); setReportCursor(result.nextCursor); setNeedsRefresh(false);
    }).catch(err => { if (active) { setError(err.message); setNeedsRefresh(true); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  function refresh() {
    if ((dirty || workspaceDirty) && !window.confirm(L("Refresh replaces unsaved changes. Continue?"))) return;
    setWorkspaceDirty(false);
    setNotice(""); setRefreshKey(key => key + 1);
  }
  async function save(event) {
    event.preventDefault();
    const quotas = Object.fromEntries(Object.entries(draft.defaultQuotas).map(([key, value]) => [key, /^\d+$/.test(value) ? Number(value) : NaN]));
    if (!Object.values(quotas).every(value => Number.isSafeInteger(value) && value >= 0) || quotas.maxUploadBytes > quotas.maxStorageBytes) { setError("Enter non-negative whole numbers within the safe integer range; upload must not exceed storage."); return; }
    const days=/^\d+$/.test(draft.retention.days) ? Number(draft.retention.days) : NaN, noticeDays=/^\d+$/.test(draft.retention.notifyBeforeDays) ? Number(draft.retention.notifyBeforeDays) : NaN;
    if (draft.retention.mode === "inactivity" && (!Number.isSafeInteger(days) || days > 36500 || !Number.isSafeInteger(noticeDays) || noticeDays < 1 || noticeDays >= days)) { setError("Enter a notice period of at least one day, shorter than the inactivity period (up to 36500 days)."); return; }
    const retention = draft.retention.mode === "long-term" ? {mode:"long-term",days:null,notifyBeforeDays:null} : {mode:"inactivity",days,notifyBeforeDays:noticeDays};
    if (retention.mode === "inactivity" && JSON.stringify(retention) !== JSON.stringify(settings.retention) && !window.confirm(L("Enable automatic cleanup for inactive applications? Owners will be notified before deletion."))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await request("/settings", "PUT", { registrationEnabled: draft.registrationEnabled, retention, defaultQuotas: quotas });
      if (!validSettings(next)) throw new Error(fallback);
      setSettings(next); setDraft(settingsDraft(next)); setNotice("Settings saved.");
    } catch (err) { setError(err.message); setNeedsRefresh(true); } finally { setBusy(false); }
  }
  async function loadOlderReports() {
    if (!reportCursor) return;
    setBusy(true); setError("");
    try {
      const result = await request(`/reports/before/${reportCursor.createdAt}/${encodeURIComponent(reportCursor.id)}`);
      if (!validReportPage(result)) throw new Error(fallback);
      setReports(previous => { const ids = new Set(previous.map(item => item.id)); return [...previous, ...result.reports.filter(item => !ids.has(item.id))]; });
      setReportCursor(result.nextCursor);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function act(path, confirmation, success, reportId, pageId, pageState) {
    if (!window.confirm(L(confirmation))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await request(path, "POST", {});
      setNotice(success);
      if (reportId || pageId) setReports(previous => previous.map(report => report.id === reportId ? {...report, status:"resolved"} : pageId && report.pageId === pageId ? {...report, pageState} : report));
    } catch (err) { setError(err.message); setNeedsRefresh(true); } finally { setBusy(false); }
  }
  const disabled = busy || loading || needsRefresh;
  async function signOut() {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } finally { window.location.href = "/console"; }
  }
  return <AdminShell active="platform" signedIn platformEnabled onLogout={signOut} basePath="/console">
    <div className="console-page platform-admin">
      <section className="console-hero console-hero--compact">
        <div className="console-hero__copy">
          <p className="eyebrow">{L("Platform administration")}</p>
          <h1>{L("Settings and moderation")}</h1>
          <p>{L("Manage registration, default limits and reported pages.")}</p>
        </div>
      </section>
      <div className="platform-admin__main">
        <div className="platform-admin__toolbar"><button type="button" disabled={busy || loading || workspaceBusy} onClick={refresh}>{L(loading ? "Refreshing…" : "Refresh")}</button></div>
        {error && <p className="platform-admin__alert" role="alert">{L(error)}{needsRefresh && error !== errors[401] ? ` ${L("Changes may have been applied. Refresh before trying again.")}` : ""} {error === errors[401] && <a href="/console">{L("Back to workspace")}</a>}</p>}
        {notice && <p className="platform-admin__notice" role="status">{L(notice)}</p>}
        {loading && !settings ? <p role="status">{L("Loading…")}</p> : null}
        {settings && draft && <section className="platform-admin__panel"><h2>{L("Settings")}</h2><form onSubmit={save}>
          <fieldset disabled={disabled}><legend>{L("Registration")}</legend><label className="platform-admin__check"><input type="checkbox" checked={draft.registrationEnabled} onChange={event => setDraft({ ...draft, registrationEnabled: event.target.checked })} />{L("Allow account registration")}</label></fieldset>
          <fieldset disabled={disabled}><legend>{L("Default workspace quotas")}</legend><p className="platform-admin__hint">{L("Workspace-specific quotas take precedence over these defaults. All retained versions count toward storage usage.")}</p><div className="platform-admin__quotas">{quotaFields.map(([key, title]) => <label key={key}>{L(title)}<input type="number" min="0" max="9007199254740991" step="1" required value={draft.defaultQuotas[key]} onChange={event => setDraft({ ...draft, defaultQuotas: { ...draft.defaultQuotas, [key]: event.target.value } })} /></label>)}</div><p className="platform-admin__hint">{L("Enter whole numbers in bytes; 1 MiB = 1,048,576 bytes. Upload cannot exceed storage.")}</p></fieldset>
          <fieldset disabled={disabled} className="platform-admin__retention"><legend>{L("Retention policy")}</legend><p>{L("Choose how long inactive applications are kept.")}</p><label>{L("Retention policy")}<select value={draft.retention.mode} onChange={event=>setDraft({...draft,retention:{...draft.retention,mode:event.target.value}})}><option value="long-term">{L("Long-term")}</option><option value="inactivity">{L("Inactivity")}</option></select></label>{draft.retention.mode === "inactivity" && <div className="platform-admin__quotas"><label>{L("Inactivity period")} ({L("days")})<input type="number" min="2" max="36500" step="1" required value={draft.retention.days} onChange={event=>setDraft({...draft,retention:{...draft.retention,days:event.target.value}})} /></label><label>{L("Advance notice")} ({L("days")})<input type="number" min="1" max="36499" step="1" required value={draft.retention.notifyBeforeDays} onChange={event=>setDraft({...draft,retention:{...draft.retention,notifyBeforeDays:event.target.value}})} /></label></div>}<p className="platform-admin__hint">{L("Updating an application resets its inactivity period; visits do not. Owners are notified before cleanup.")}</p></fieldset>
          <button className="platform-admin__primary" disabled={disabled || !dirty} type="submit">{L(busy ? "Saving…" : "Save settings")}</button>
        </form></section>}
        <WorkspaceManager key={`workspace-${refreshKey}`} L={L} onDirtyChange={setWorkspaceDirty} onBusyChange={setWorkspaceBusy} />
        <OperationsStatus key={`operations-${refreshKey}`} L={L} locale={locale} />
        {reports && <section className="platform-admin__panel"><h2>{L("Reports")}</h2>{reports.length === 0 ? <p>{L("No reports yet.")}</p> : <ul className="platform-admin__reports">{reports.map(report => <li key={report.id}><div className="platform-admin__report-head"><strong>{report.category}</strong><span className="platform-admin__status">{L(report.status === "pending" ? "Pending" : report.status === "resolved" ? "Resolved" : "Unknown")}</span></div><p className="platform-admin__description">{report.description}</p><div className="platform-admin__meta"><span>{L("Page ID")}: {report.pageId}</span><span>{L("Report ID")}: {report.id}</span><span>{L("Submitted")}: {date(report.createdAt, locale)}</span></div><p className="platform-admin__hint">{L("Application status")}: {L(report.pageState === "active" ? "Not suspended" : report.pageState === "suspended" ? "Suspended" : "Deleted")}</p><div className="platform-admin__actions">{report.status === "pending" && <button disabled={disabled} type="button" onClick={() => act(`/reports/${encodeURIComponent(report.id)}/resolve`, "Resolve this report?", "Report resolved.", report.id)}>{L("Resolve report")}</button>}{report.pageState === "active" && <button disabled={disabled} type="button" onClick={() => act(`/pages/${encodeURIComponent(report.pageId)}/suspend`, "Suspend this page? Its content will no longer be accessible.", "Page suspended.", null, report.pageId, "suspended")}>{L("Suspend page")}</button>}{report.pageState === "suspended" && <button disabled={disabled} type="button" onClick={() => act(`/pages/${encodeURIComponent(report.pageId)}/restore`, "Restore this page? Its content may become accessible again.", "Page restored.", null, report.pageId, "active")}>{L("Restore page")}</button>}</div></li>)}</ul>}{reportCursor && <button type="button" disabled={disabled} onClick={loadOlderReports}>{L("Load older reports")}</button>}</section>}
      </div>
    </div>
  </AdminShell>;
}
