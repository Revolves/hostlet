export const publicDirectorySchema = `
CREATE TABLE IF NOT EXISTS public_page_visits (
  page_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('legacy', 'workspace')),
  page_id TEXT NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0 CHECK(visits >= 0),
  first_visited_at TEXT NOT NULL,
  last_visited_at TEXT NOT NULL
);
`;

const legacyPageKey = (pageId) => `legacy:${pageId}`;
const workspacePageKey = (pageId) => `workspace:${pageId}`;

function rowToApp(row, className) {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    className,
    workspaceName: row.workspace_name ?? null,
    workspaceType: row.workspace_type ?? null,
    sourceType: row.source_type ?? "html",
    fileCount: Number(row.file_count ?? 1),
    sizeBytes: Number(row.size_bytes ?? 0),
    updatedAt: row.updated_at,
    url: row.url,
    visits: Number(row.visits ?? 0),
  };
}

export function createPublicDirectoryService({
  db,
  legacyUrl,
  workspaceUrl,
  now = () => new Date(),
} = {}) {
  if (!db || typeof legacyUrl !== "function" || typeof workspaceUrl !== "function" || typeof now !== "function") {
    throw new TypeError("Invalid public directory configuration");
  }

  const currentTime = () => {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error("Invalid clock");
    return date.toISOString();
  };

  const legacyRows = () => db.prepare(`
    SELECT p.id, p.title, p.updated_at, p.source_type, p.file_count, p.size_bytes,
           p.slug, COALESCE(v.visits, 0) AS visits
    FROM pages p
    LEFT JOIN public_page_visits v ON v.page_key = 'legacy:' || p.id
    WHERE p.access_mode = 'public'
    ORDER BY p.updated_at DESC, p.id
  `).all();

  const workspaceRows = () => db.prepare(`
    SELECT p.id, p.title, p.updated_at, p.source_type, p.file_count, p.size_bytes,
           w.name AS workspace_name, w.type AS workspace_type,
           COALESCE(v.visits, 0) AS visits
    FROM workspace_page_visibility visible
    JOIN workspace_pages p ON p.id = visible.page_id
    JOIN workspaces w ON w.id = p.workspace_id
    LEFT JOIN platform_page_suspensions s ON s.page_id = p.id
    LEFT JOIN public_page_visits v ON v.page_key = 'workspace:' || p.id
    WHERE s.page_id IS NULL
    ORDER BY p.updated_at DESC, p.id
  `).all();

  return {
    recordVisit({ kind, pageId, method = "GET", entryDocument = true } = {}) {
      if (method !== "GET" || entryDocument !== true || !["legacy", "workspace"].includes(kind) || typeof pageId !== "string" || !pageId) {
        return false;
      }
      const exists = kind === "legacy"
        ? db.prepare("SELECT 1 FROM pages WHERE id=? AND access_mode='public'").get(pageId)
        : db.prepare("SELECT 1 FROM workspace_page_visibility WHERE page_id=? AND page_id NOT IN (SELECT page_id FROM platform_page_suspensions)").get(pageId);
      if (!exists) return false;
      const at = currentTime();
      const key = kind === "legacy" ? legacyPageKey(pageId) : workspacePageKey(pageId);
      const updated = db.prepare("UPDATE public_page_visits SET visits = visits + 1, last_visited_at = ? WHERE page_key = ?").run(at, key);
      if (updated.changes === 0) {
        db.prepare("INSERT INTO public_page_visits (page_key, kind, page_id, visits, first_visited_at, last_visited_at) VALUES (?, ?, ?, 1, ?, ?)").run(key, kind, pageId, at, at);
      }
      return true;
    },
    list() {
      const apps = [
        ...legacyRows().map((row) => rowToApp({ ...row, kind: "legacy", url: legacyUrl(row.slug) }, "editorial")),
        ...workspaceRows().map((row, index) => rowToApp({ ...row, kind: "workspace", url: workspaceUrl(row.id) }, ["studio", "archive", "signal"][index % 3])),
      ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
      return {
        apps,
        stats: {
          applications: apps.length,
          workspaces: new Set(apps.filter((app) => app.kind === "workspace").map((app) => app.workspaceName)).size,
          visits: apps.reduce((total, app) => total + app.visits, 0),
        },
      };
    },
  };
}
