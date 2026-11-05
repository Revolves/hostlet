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

const catalogSql = `
  SELECT p.id, p.title, 'legacy' AS kind, p.updated_at,
         p.source_type, p.file_count, p.size_bytes,
         NULL AS workspace_name, NULL AS workspace_type,
         p.slug, COALESCE(v.visits, 0) AS visits
  FROM pages p
  LEFT JOIN public_page_visits v ON v.page_key = 'legacy:' || p.id
  WHERE p.access_mode = 'public'
  UNION ALL
  SELECT p.id, p.title, 'workspace' AS kind, p.updated_at,
         p.source_type, p.file_count, p.size_bytes,
         w.name AS workspace_name, w.type AS workspace_type,
         NULL AS slug, COALESCE(v.visits, 0) AS visits
  FROM workspace_page_visibility visible
  JOIN workspace_pages p ON p.id = visible.page_id
  JOIN workspaces w ON w.id = p.workspace_id
  LEFT JOIN platform_page_suspensions s ON s.page_id = p.id
  LEFT JOIN public_page_visits v ON v.page_key = 'workspace:' || p.id
  WHERE s.page_id IS NULL
`;
const filterSql = `WHERE instr(lower(title), ?) > 0
  OR instr(lower(coalesce(workspace_name, '')), ?) > 0
  OR instr(lower(coalesce(workspace_type, '')), ?) > 0`;
const classNames = ["editorial", "studio", "archive", "signal"];

function classNameFor(kind, id) {
  let hash = 2166136261;
  for (const character of `${kind}:${id}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return classNames[(hash >>> 0) % classNames.length];
}

function rowToApp(row, { legacyUrl, workspaceUrl }) {
  const kind = row.kind === "workspace" ? "workspace" : "legacy";
  return {
    id: row.id,
    title: row.title,
    kind,
    className: classNameFor(kind, row.id),
    workspaceName: row.workspace_name ?? null,
    workspaceType: row.workspace_type ?? null,
    sourceType: row.source_type ?? "html",
    fileCount: Number(row.file_count ?? 1),
    sizeBytes: Number(row.size_bytes ?? 0),
    updatedAt: row.updated_at,
    url: kind === "legacy" ? legacyUrl(row.slug) : workspaceUrl(row.id),
    visits: Number(row.visits ?? 0),
  };
}

function integerOption(value, fallback, min, max, name) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" && typeof value !== "number") throw new TypeError(`${name} must be a single integer.`);
  if (typeof value === "string" && !/^\d+$/.test(value)) throw new TypeError(`${name} must be a nonnegative integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new RangeError(`${name} is out of range.`);
  return parsed;
}

export function parsePublicDirectoryQuery(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid public directory query.");
  const limit = integerOption(input.limit, 9, 1, 48, "limit");
  const offset = integerOption(input.offset, 0, 0, 1_000_000, "offset");
  const sort = input.sort === undefined || input.sort === "" ? "recent" : input.sort;
  if (sort !== "recent" && sort !== "popular") throw new TypeError("sort must be recent or popular.");
  if (input.q !== undefined && typeof input.q !== "string") throw new TypeError("q must be a single string.");
  const q = String(input.q ?? "").trim();
  if (q.length > 120) throw new RangeError("q is too long.");
  return { limit, offset, sort, q };
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
    list(options = {}) {
      const { limit, offset, sort, q } = parsePublicDirectoryQuery(options);
      const filterParams = q ? [q.toLowerCase(), q.toLowerCase(), q.toLowerCase()] : [];
      const statsRow = db.prepare(`
        WITH catalog AS (${catalogSql})
        SELECT COUNT(*) AS applications,
               COUNT(DISTINCT CASE WHEN kind = 'workspace' THEN workspace_name END) AS workspaces,
               COALESCE(SUM(visits), 0) AS visits
        FROM catalog
      `).get();
      const totalRow = db.prepare(`
        WITH catalog AS (${catalogSql})
        SELECT COUNT(*) AS total FROM catalog ${q ? filterSql : ""}
      `).get(...filterParams);
      const order = sort === "popular" ? "visits DESC, updated_at DESC, id ASC" : "updated_at DESC, id ASC";
      const rows = db.prepare(`
        WITH catalog AS (${catalogSql})
        SELECT * FROM catalog ${q ? filterSql : ""}
        ORDER BY ${order}
        LIMIT ? OFFSET ?
      `).all(...filterParams, limit, offset);
      const apps = rows.map((row) => rowToApp(row, { legacyUrl, workspaceUrl }));
      const total = Number(totalRow?.total ?? 0);
      return {
        apps,
        stats: {
          applications: Number(statsRow?.applications ?? 0),
          workspaces: Number(statsRow?.workspaces ?? 0),
          visits: Number(statsRow?.visits ?? 0),
        },
        page: { limit, offset, total, hasMore: offset + apps.length < total },
      };
    },
  };
}
