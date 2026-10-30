import { t, useLocale } from "../i18n.js";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { sourceTypeFromFilename, slugify, titleFromFilename } from "../utils.js";
import { CloseIcon, UploadIcon } from "./Icons.jsx";
import LanguageSwitch from "./LanguageSwitch.jsx";

const EMPTY_FORM = {
  title: "",
  slug: "",
  entryFile: "index.html",
  accessMode: "public",
};

function Dropzone({ file, onChange, mode }) {
  useLocale();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  function accept(nextFile) {
    if (nextFile) {
      onChange(nextFile);
    }
  }

  return (
    <div
      className={`dropzone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        accept(event.dataTransfer.files?.[0]);
      }}
    >
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept=".html,.htm,.zip"
        onChange={(event) => accept(event.target.files?.[0])}
      />
      <UploadIcon />
      {file ? (
        <>
          <strong className="dropzone__filename">{file.name}</strong>
          <span className="dropzone__meta">{t("Ready to publish")}</span>
          <button className="link-button" type="button" onClick={() => inputRef.current?.click()}>{t("Choose another file")}</button>
        </>
      ) : (
        <>
          <strong>{t("Drop your {type} here", { type: mode === "zip" ? t("ZIP archive") : t("HTML file") })}</strong>
          <span className="dropzone__or">{t("or")}</span>
          <button className="link-button" type="button" onClick={() => inputRef.current?.click()}>{t("click to browse")}</button>
          <span className="dropzone__meta">
            {t("Max 50 MB.")} {mode === "zip" ? t("ZIP sites are supported.") : t("Single .html file only.")}
          </span>
        </>
      )}
    </div>
  );
}

export default function PageDrawer({
  open,
  mode,
  page,
  onClose,
  onSaved,
  onReplaced,
  onNotify,
}) {
  const locale = useLocale();
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replaceFile, setReplaceFile] = useState(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceError, setReplaceError] = useState("");
  const [releases, setReleases] = useState([]);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [releasesError, setReleasesError] = useState("");
  const [releasesRetry, setReleasesRetry] = useState(0);
  const [activationBusy, setActivationBusy] = useState(false);
  const [activationError, setActivationError] = useState("");
  const closeRef = useRef(null);

  const editing = mode === "edit" && page;
  const fileMode = file ? sourceTypeFromFilename(file.name) : "html";
  const effectiveMode = editing ? page.sourceType : fileMode;

  useEffect(() => {
    if (!open || mode !== "edit" || !page?.id) return undefined;
    let cancelled = false;
    setReleases([]);
    setReleasesError("");
    setActivationError("");
    setReleasesLoading(true);
    api.listReleases(page.id).then(({ releases: items }) => {
      if (!cancelled) setReleases(items);
    }).catch((failure) => {
      if (!cancelled) setReleasesError(failure.message);
    }).finally(() => {
      if (!cancelled) setReleasesLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, mode, page?.id, releasesRetry]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setError("");
    setBusy(false);
    setReplaceError("");
    setReplaceBusy(false);
    setActivationBusy(false);
    setFile(null);
    setReplaceFile(null);
    setSlugTouched(false);
    if (editing) {
      setForm({
        title: page.title,
        slug: page.slug,
        entryFile: page.entryFile,
        accessMode: page.accessMode,
      });
    } else {
      setForm(EMPTY_FORM);
    }

    const timeout = window.setTimeout(() => closeRef.current?.focus(), 50);
    return () => window.clearTimeout(timeout);
  }, [open, mode, page]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleKey(event) {
      if (event.key === "Escape" && !busy && !replaceBusy && !activationBusy) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, busy, replaceBusy, activationBusy, onClose]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function chooseFile(nextFile) {
    setFile(nextFile);
    if (!editing) {
      setForm((current) => ({
        ...current,
        title: current.title || titleFromFilename(nextFile.name),
        slug: slugTouched ? current.slug : slugify(nextFile.name),
        entryFile: sourceTypeFromFilename(nextFile.name) === "zip" ? "index.html" : nextFile.name,
      }));
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!editing && !file) {
      setError("Choose an HTML file or ZIP archive.");
      return;
    }
    setBusy(true);

    try {
      if (editing) {
        await api.updatePage(page.id, form);
        onSaved("Page settings saved.");
      } else {
        const formData = new FormData();
        formData.set("title", form.title);
        formData.set("slug", form.slug);
        formData.set("entryFile", form.entryFile);
        formData.set("accessMode", form.accessMode);
        formData.set("file", file);
        await api.createPage(formData);
        onSaved("Page published.");
      }
    } catch (submitError) {
      setError(submitError.message);
      setBusy(false);
    }
  }

  async function handleReplace(event) {
    event.preventDefault();
    if (!replaceFile) {
      setReplaceError("Choose a new HTML file or ZIP archive.");
      return;
    }
    setReplaceError("");
    setReplaceBusy(true);
    try {
      const formData = new FormData();
      formData.set("entryFile", form.entryFile);
      formData.set("file", replaceFile);
      await api.replacePage(page.id, formData);
      onReplaced("A new release is live.");
    } catch (replaceFailure) {
      setReplaceError(replaceFailure.message);
      setReplaceBusy(false);
    }
  }

  async function handleActivate(release) {
    if (!window.confirm(t("Make {filename} the current release? This changes the live page.", { filename: release.originalFilename }))) return;
    setActivationError("");
    setActivationBusy(true);
    try {
      await api.activateRelease(page.id, release.releaseId);
      onReplaced("Release restored.");
    } catch (failure) {
      setActivationError(failure.message);
      setActivationBusy(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="drawer-layer" role="presentation">
      <button
        type="button"
        className="drawer-scrim"
        aria-label={t("Close panel")}
        onClick={() => !busy && !replaceBusy && !activationBusy && onClose()}
      />
      <aside className="drawer" aria-label={editing ? t("Edit page") : t("Upload page")}>
        <button ref={closeRef} className="drawer__close icon-button" type="button" onClick={onClose} disabled={activationBusy} aria-label={t("Close panel")}>
          <CloseIcon />
        </button>

        <div className="drawer__scroll">
          <header className="drawer__header">
            <LanguageSwitch />
            <h2>{editing ? t("Page settings") : t("Upload a page")}</h2>
            <p>
              {editing
                ? t("Change how this page appears and who can open it.")
                : t("Add a single HTML file or a ZIP archive, set a path, and choose who can access it.")}
            </p>
          </header>

          {!editing ? (
            <form className="drawer__form" onSubmit={handleSubmit}>
              <fieldset className="field">
                <legend className="field__label">{t("File type")}</legend>
                <div className="segmented" aria-label={t("Uploaded file type")}>
                  <span className={effectiveMode === "html" ? "is-selected" : ""}>{t("HTML file")}</span>
                  <span className={effectiveMode === "zip" ? "is-selected" : ""}>{t("ZIP archive")}</span>
                </div>
              </fieldset>

              <Dropzone file={file} onChange={chooseFile} mode={effectiveMode} />

              <label className="field">
                <span className="field__label">{t("Page title")}</span>
                <input
                  value={form.title}
                  onChange={(event) => update("title", event.target.value)}
                  placeholder={t("e.g. Product demo")}
                  maxLength={80}
                  required
                />
                <span className="field__hint">{t("This is just for your reference.")}</span>
              </label>

              <label className="field">
                <span className="field__label">{t("Mount path")}</span>
                <span className="input-prefix">
                  <span>/p/</span>
                  <input
                    value={form.slug}
                    onChange={(event) => {
                      setSlugTouched(true);
                      update("slug", slugify(event.target.value));
                    }}
                    placeholder="product-demo"
                    pattern="[a-z0-9](?:(?:[a-z0-9]|-){0,61}[a-z0-9])?"
                    required
                  />
                </span>
                <span className="field__hint">{t("Lowercase letters, numbers, and hyphens.")}</span>
              </label>

              <label className="field">
                <span className="field__label">{t("Entry file")}</span>
                <input
                  value={form.entryFile}
                  onChange={(event) => update("entryFile", event.target.value)}
                  placeholder="index.html"
                  required
                />
                <span className="field__hint">{t("The HTML file to serve. Usually index.html.")}</span>
              </label>

              <fieldset className="field">
                <legend className="field__label">{t("Access mode")}</legend>
                <div className="access-options">
                  <label className="access-option">
                    <input
                      type="radio"
                      name="accessMode"
                      value="public"
                      checked={form.accessMode === "public"}
                      onChange={() => update("accessMode", "public")}
                    />
                    <span className="radio-mark" />
                    <span>
                      <strong>{t("Public")}</strong>
                      <small>{t("Anyone with the link can view this page.")}</small>
                    </span>
                  </label>
                  <label className="access-option">
                    <input
                      type="radio"
                      name="accessMode"
                      value="private"
                      checked={form.accessMode === "private"}
                      onChange={() => update("accessMode", "private")}
                    />
                    <span className="radio-mark" />
                    <span>
                      <strong>{t("Private")}</strong>
                      <small>{t("Visitors must enter the host password.")}</small>
                    </span>
                  </label>
                </div>
              </fieldset>

              {error ? <p className="form-error" role="alert">{t(error)}</p> : null}

              <div className="drawer__actions">
                <button className="button button--primary" type="submit" disabled={busy}>
                  {busy ? t("Publishing…") : t("Publish page")}
                </button>
                <button className="button button--secondary" type="button" onClick={onClose} disabled={busy}>{t("Cancel")}</button>
              </div>
            </form>
          ) : (
            <>
              <form className="drawer__form" onSubmit={handleSubmit}>
                <div className="current-release">
                  <span className="eyebrow">{t("Current release")}</span>
                  <strong>{page.originalFilename}</strong>
                  <span>{t("{count} files", { count: page.fileCount })} · {page.sourceType === "zip" ? t("ZIP site") : t("Single HTML")}</span>
                </div>

                <label className="field">
                  <span className="field__label">{t("Page title")}</span>
                  <input
                    value={form.title}
                    onChange={(event) => update("title", event.target.value)}
                    maxLength={80}
                    required
                  />
                </label>

                <label className="field">
                  <span className="field__label">{t("Mount path")}</span>
                  <span className="input-prefix">
                    <span>/p/</span>
                    <input
                      value={form.slug}
                      onChange={(event) => update("slug", slugify(event.target.value))}
                      required
                    />
                  </span>
                  <span className="field__hint">{t("Changing this breaks existing links.")}</span>
                </label>

                <label className="field">
                  <span className="field__label">{t("Entry file")}</span>
                  <input
                    value={form.entryFile}
                    onChange={(event) => update("entryFile", event.target.value)}
                    required
                  />
                </label>

                <fieldset className="field">
                  <legend className="field__label">{t("Access mode")}</legend>
                  <div className="access-options">
                    <label className="access-option">
                      <input
                        type="radio"
                        name="accessMode"
                        value="public"
                        checked={form.accessMode === "public"}
                        onChange={() => update("accessMode", "public")}
                      />
                      <span className="radio-mark" />
                      <span>
                        <strong>{t("Public")}</strong>
                        <small>{t("Anyone with the link can view this page.")}</small>
                      </span>
                    </label>
                    <label className="access-option">
                      <input
                        type="radio"
                        name="accessMode"
                        value="private"
                        checked={form.accessMode === "private"}
                        onChange={() => update("accessMode", "private")}
                      />
                      <span className="radio-mark" />
                      <span>
                        <strong>{t("Private")}</strong>
                        <small>{t("Visitors must enter the host password.")}</small>
                      </span>
                    </label>
                  </div>
                </fieldset>

                {error ? <p className="form-error" role="alert">{t(error)}</p> : null}
                <div className="drawer__actions">
                  <button className="button button--primary" type="submit" disabled={busy || replaceBusy || activationBusy}>
                    {busy ? t("Saving…") : t("Save changes")}
                  </button>
                  <button className="button button--secondary" type="button" onClick={onClose} disabled={busy || replaceBusy || activationBusy}>{t("Cancel")}</button>
                </div>
              </form>

              <section className="replace-panel">
                <div>
                  <h3>{t("Replace the release")}</h3>
                  <p>{t("Upload a new HTML file or ZIP archive. The public path and settings stay the same.")}</p>
                </div>
                <form onSubmit={handleReplace}>
                  <Dropzone file={replaceFile} onChange={setReplaceFile} mode={page.sourceType} />
                  {replaceError ? <p className="form-error" role="alert">{t(replaceError)}</p> : null}
                  <button className="button button--secondary button--full" type="submit" disabled={replaceBusy || busy || activationBusy}>
                    {replaceBusy ? t("Publishing new release…") : t("Publish replacement")}
                  </button>
                </form>
              </section>

              <section className="replace-panel release-history" aria-labelledby="release-history-heading">
                <div>
                  <h3 id="release-history-heading">{t("Version history")}</h3>
                  <p>{t("Restore an earlier release to make it live again.")}</p>
                </div>
                {releasesLoading ? <p role="status">{t("Loading versions…")}</p> : null}
                {releasesError ? (
                  <div>
                    <p className="form-error" role="alert">{t("Could not load version history.")} {t(releasesError)}</p>
                    <button className="link-button" type="button" onClick={() => setReleasesRetry((value) => value + 1)}>{t("Try again")}</button>
                  </div>
                ) : null}
                {!releasesLoading && !releasesError && releases.length === 0 ? <p>{t("No versions found.")}</p> : null}
                {!releasesLoading && !releasesError && releases.length > 0 ? (
                  <ul className="release-history__list">
                    {releases.map((release) => (
                      <li className="release-history__item" key={release.releaseId}>
                        <div className="release-history__details">
                          <strong>{release.originalFilename}</strong>
                          <span>{Number.isNaN(new Date(release.createdAt).getTime()) ? t("Unknown") : new Date(release.createdAt).toLocaleString(locale)}</span>
                        </div>
                        {release.current ? <span className="release-history__current">{t("Current")}</span> : (
                          <button className="button button--secondary release-history__restore" type="button" disabled={activationBusy || busy || replaceBusy} onClick={() => handleActivate(release)}>
                            {activationBusy ? t("Restoring…") : t("Restore")}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {activationError ? <p className="form-error" role="alert">{t("Could not restore this version.")} {t(activationError)}</p> : null}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

