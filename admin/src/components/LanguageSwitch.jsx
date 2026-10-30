import { setLanguage, useLocale } from "../i18n.js";

export default function LanguageSwitch() {
  const language = useLocale();
  return (
    <div className="language-switch" role="group" aria-label={language === "zh-CN" ? "界面语言" : "Interface language"}>
      <button type="button" lang="zh-CN" aria-pressed={language === "zh-CN"} onClick={() => setLanguage("zh-CN")}>中文</button>
      <span aria-hidden="true">/</span>
      <button type="button" lang="en" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button>
    </div>
  );
}
