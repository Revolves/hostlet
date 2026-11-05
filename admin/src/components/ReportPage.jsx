import {useEffect, useState} from "react";
import {useLocale} from "../i18n.js";
import LanguageSwitch from "./LanguageSwitch.jsx";
import {hostingConfig, reportPageId} from "../hosting-address.js";
import "../account-portal.css";

const zh = {
  "Report an application":"举报应用", "Tell us about an application.":"举报应用内容。", "Paste the application address and describe the issue.":"粘贴应用地址并说明问题。",
  "Application address":"应用地址", "Report category":"举报类别", "Description":"举报说明", "Submit report":"提交举报", "Submitting…":"正在提交…", "Your report has been submitted.":"举报已提交。",
  "Enter an application address hosted by this platform.":"请输入本平台托管的应用地址。", "Reporting is unavailable. Please try again later.":"举报功能暂不可用，请稍后重试。", "The application was not found.":"未找到该应用。", "Too many requests. Please try again later.":"请求过于频繁，请稍后重试。", "Could not submit the report. Please try again.":"举报提交失败，请重试。", "Checking application access…":"正在检查应用访问配置…", "Account and workspaces":"账户与工作空间"
};

export default function ReportPage() {
  const locale=useLocale(),L=text=>locale === "zh-CN" ? (zh[text] || text) : text;
  const [domain,setDomain]=useState(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[reported,setReported]=useState(false);
  useEffect(()=>{let active=true;fetch('/api/features',{cache:'no-store'}).then(async response=>{
    if(!response.ok)throw new Error();const data=await response.json();const config=hostingConfig(data);if(!config)throw new Error();if(active)setDomain(config);
  }).catch(()=>{if(active)setError('Reporting is unavailable. Please try again later.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
  async function submit(event) {
    event.preventDefault();if(!domain || busy)return;
    const form=event.currentTarget,values=new FormData(form);
    const id=reportPageId(domain,String(values.get('address') || '').trim());
    if(!id) {setError('Enter an application address hosted by this platform.');return;}
    const category=String(values.get('category') || '').trim(),description=String(values.get('description') || '').trim();
    if(!category || !description) {setError('Could not submit the report. Please try again.');return;}
    setBusy(true);setError('');setReported(false);
    try {
      const response=await fetch('/api/platform/reports',{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageId:id,category,description})});
      if(!response.ok)throw new Error(response.status===404 ? 'The application was not found.' : response.status===429 ? 'Too many requests. Please try again later.' : 'Could not submit the report. Please try again.');
      const data=await response.json();if(typeof data?.id!=='string' || !data.id)throw new Error('Could not submit the report. Please try again.');
      form.reset();setReported(true);
    } catch(err) {setError(err.message || 'Could not submit the report. Please try again.');} finally {setBusy(false);}
  }
  return <main className="account-portal"><header className="account-portal__header"><strong className="account-portal__brand">Hostlet <span>/ {L('Report an application')}</span></strong><div className="account-portal__header-actions"><a href="/workspace">{L('Account and workspaces')}</a><LanguageSwitch /></div></header><div className="account-portal__body"><section className="account-portal__intro"><p className="account-portal__eyebrow">HOSTLET / REPORT</p><h1>{L('Tell us about an application.')}</h1><p>{L('Paste the application address and describe the issue.')}</p></section><section className="account-portal__main"><div className="account-portal__panel"><h2>{L('Report an application')}</h2>{loading && <p role="status">{L('Checking application access…')}</p>}{error && <p className="account-portal__alert" role="alert">{L(error)}</p>}{reported && <p className="account-portal__notice" role="status">{L('Your report has been submitted.')}</p>}<form className="account-portal__form" onSubmit={submit}><label>{L('Application address')}<input name="address" type="url" maxLength={2048} required /></label><label>{L('Report category')}<input name="category" maxLength={64} required /></label><label>{L('Description')}<textarea name="description" maxLength={2000} rows={5} required /></label><button className="account-portal__primary" disabled={loading || !domain || busy}>{L(busy ? 'Submitting…' : 'Submit report')}</button></form></div></section></div></main>;
}
