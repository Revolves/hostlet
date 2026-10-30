import { t, useLocale } from "../i18n.js";
import { useEffect, useRef } from "react";

export default function ConfirmDialog({ page, onCancel, onConfirm, busy }) {
  useLocale();
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function handleKey(event) {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onCancel]);

  if (!page) {
    return null;
  }

  return (
    <div className="dialog-layer">
      <button className="drawer-scrim" type="button" aria-label={t("Close dialog")} onClick={onCancel} />
      <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-heading">
        <h2 id="delete-heading">{t("Delete “{title}”?", { title: page.title })}</h2>
        <p>{t("This removes the page, its uploaded files, and its public path")}<code>/p/{page.slug}</code>.
          {t("Existing links will stop working.")}
        </p>
        <div className="dialog__actions">
          <button ref={cancelRef} className="button button--secondary" type="button" onClick={onCancel} disabled={busy}>{t("Keep page")}</button>
          <button className="button button--danger" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? t("Deleting…") : t("Delete page")}
          </button>
        </div>
      </section>
    </div>
  );
}

