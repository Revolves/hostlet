import { t, useLocale } from "../i18n.js";
import { UploadIcon } from "./Icons.jsx";

export default function EmptyState({ onUpload, filtered, onClear }) {
  useLocale();
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><UploadIcon size={34} /></span>
      <h2>{filtered ? t("No pages match that search.") : t("A quiet place for your pages.")}</h2>
      <p>
        {filtered
          ? t("Try a different title, filename, or mount path.")
          : t("Upload a standalone HTML file or a complete ZIP site. Your first page will appear here.")}
      </p>
      {!filtered ? (
        <button className="button button--primary" type="button" onClick={onUpload}>{t("Upload your first page")}</button>
      ) : onClear ? (
        <button className="button button--secondary" type="button" onClick={onClear}>{t("Clear filters")}</button>
      ) : null}
    </div>
  );
}

