import { t, useLocale } from "../i18n.js";
export default function StatusDot({ mode }) {
  useLocale();
  return (
    <span className={`access access--${mode}`}>
      <span className="access__dot" aria-hidden="true" />
      {mode === "public" ? t("Public") : t("Private")}
    </span>
  );
}

