import { t, useLocale } from "../i18n.js";
import { useEffect } from "react";
import { CheckIcon } from "./Icons.jsx";

export default function Toast({ message, tone = "success", onDismiss }) {
  useLocale();
  useEffect(() => {
    if (!message) {
      return undefined;
    }
    const timeout = window.setTimeout(onDismiss, 3200);
    return () => window.clearTimeout(timeout);
  }, [message, onDismiss]);

  if (!message) {
    return null;
  }

  return (
    <div className={`toast toast--${tone}`} role="status" aria-live="polite">
      {tone === "success" ? <CheckIcon /> : null}
      <span>{t(message)}</span>
      <button type="button" className="toast__dismiss" onClick={onDismiss} aria-label={t("Dismiss notification")}>×</button>
    </div>
  );
}

