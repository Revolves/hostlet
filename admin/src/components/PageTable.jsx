import { t, useLocale } from "../i18n.js";
import PageTypeIcon from "./PageTypeIcon.jsx";
import StatusDot from "./StatusDot.jsx";
import { CopyIcon, EyeIcon, LinkIcon, MoreIcon } from "./Icons.jsx";
import { relativeDate } from "../utils.js";

export default function PageTable({ pages, onPreview, onCopy, onEdit, onMore, menuPageId }) {
  const language = useLocale();
  return (
    <div className="page-table-wrap">
      <table className="page-table">
        <thead>
          <tr>
            <th scope="col">{t("Page")}</th>
            <th scope="col">{t("Path")}</th>
            <th scope="col">{t("Access")}</th>
            <th scope="col">{t("Updated")}</th>
            <th scope="col" className="page-table__actions-head">{t("Actions")}</th>
          </tr>
        </thead>
        <tbody>
          {pages.map((page) => (
            <tr key={page.id}>
              <td data-label={t("Page")}>
                <div className="page-identity">
                  <PageTypeIcon type={page.sourceType} />
                  <div className="page-identity__text">
                    <button className="page-title" type="button" onClick={() => onEdit(page)}>
                      {page.title}
                    </button>
                    <span className="page-filename">{page.originalFilename}</span>
                  </div>
                </div>
              </td>
              <td data-label={t("Path")}>
                <div className="path-cell">
                  <code>/p/{page.slug}</code>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("Copy path for {title}", { title: page.title })}
                    onClick={() => onCopy(`/p/${page.slug}`, "Path copied")}
                  >
                    <CopyIcon size={15} />
                  </button>
                </div>
              </td>
              <td data-label={t("Access")}><StatusDot mode={page.accessMode} /></td>
              <td data-label={t("Updated")}><span className="updated">{relativeDate(page.updatedAt, language)}</span></td>
              <td data-label={t("Actions")}>
                <div className="row-actions">
                  <button className="text-action" type="button" onClick={() => onPreview(page)}>
                    <EyeIcon />{t("Preview")}</button>
                  <button className="text-action" type="button" onClick={() => onCopy(page.url, "Link copied")}>
                    <LinkIcon />{t("Copy link")}</button>
                  <div className="row-menu-wrap">
                    <button
                      type="button"
                      className={`icon-button row-more${menuPageId === page.id ? " is-open" : ""}`}
                      aria-label={t("More actions for {title}", { title: page.title })}
                      aria-expanded={menuPageId === page.id}
                      onClick={(event) => onMore(page, event.currentTarget)}
                    >
                      <MoreIcon />
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

