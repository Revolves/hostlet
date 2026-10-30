import { t, useLocale } from "../i18n.js";
import { useEffect, useRef } from "react";

export default function RowMenu({ page, anchor, onClose, onEdit, onPreview, onReplace, onDelete, onCopy }) {
  useLocale();
  const menuRef = useRef(null);

  useEffect(() => {
    function handlePointer(event) {
      if (menuRef.current && !menuRef.current.contains(event.target) && !anchor?.contains(event.target)) {
        onClose();
      }
    }
    function handleKey(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [anchor, onClose]);

  const rect = anchor?.getBoundingClientRect();
  const style = rect
    ? {
        position: "fixed",
        top: Math.min(rect.bottom + 6, window.innerHeight - 240),
        left: Math.max(12, rect.right - 196),
      }
    : undefined;

  return (
    <div ref={menuRef} className="row-menu" style={style} role="menu">
      <button role="menuitem" type="button" onClick={() => onEdit(page)}>{t("Edit settings")}</button>
      <button role="menuitem" type="button" onClick={() => onPreview(page)}>{t("Open preview")}</button>
      <button role="menuitem" type="button" onClick={() => onReplace(page)}>{t("Replace release")}</button>
      <button role="menuitem" type="button" onClick={() => onCopy(page.url)}>{t("Copy public link")}</button>
      <div className="row-menu__rule" />
      <button role="menuitem" className="is-danger" type="button" onClick={() => onDelete(page)}>{t("Delete page")}</button>
    </div>
  );
}

