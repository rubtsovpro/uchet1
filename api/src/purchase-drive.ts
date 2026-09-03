/**
 * Google Drive → прайсы закупки.
 * Корень: GDRIVE_PURCHASE_ROOT (папка Жени). Подпапки ↔ поставщики.
 * Опрос раз в 3 мин: новые xlsx/csv → purchase_price_imports.
 */
import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import type { Hono } from 'hono';
import { all, get, run, db } from './db.js';
import { newGuid } from './ids.js';
import { actorFromContext, type Actor } from './auth.js';
import { canUsePurchaseIntake } from './staff.js';
import { auditFromContext } from './audit.js';

const DEFAULT_ROOT = '14719E16hSlz2EXuiMdEjbsnFJfhI5sKs';
const SA_EMAIL = 'pnevmopodveska1-bank@pnevmopodveska1.iam.gserviceaccount.com';
const POLL_MS = Math.max(60_000, Number(process.env.GDRIVE_PURCHASE_POLL_MS || 180_000) || 180_000);

type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  size?: string;
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollRunning = false;
let lastPollAt = '';
let lastPollError = '';
let lastPollSummary: Record<string, unknown> = {};

function deny(c: { json: (b: unknown, s: number) => Response }, actor: Actor | null) {
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canUsePurchaseIntake(actor)) {
    return c.json({ error: 'Доступ только у админа и отдела закупки' }, 403);
  }
  return null;
}

export function ensurePurchaseDriveSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_drive_folders (
      id TEXT PRIMARY KEY,
      drive_folder_id TEXT NOT NULL UNIQUE,
      folder_name TEXT NOT NULL DEFAULT '',
      supplier_id TEXT NOT NULL DEFAULT '',
      supplier_name TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pdf_supplier ON purchase_drive_folders(supplier_id);

    CREATE TABLE IF NOT EXISTS purchase_drive_files (
      id TEXT PRIMARY KEY,
      drive_file_id TEXT NOT NULL UNIQUE,
      drive_folder_id TEXT NOT NULL DEFAULT '',
      folder_row_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      md5 TEXT NOT NULL DEFAULT '',
      modified_at TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'seen',
      import_id TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      imported_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_pdfile_folder ON purchase_drive_files(drive_folder_id);
    CREATE INDEX IF NOT EXISTS idx_pdfile_status ON purchase_drive_files(status);

    CREATE TABLE IF NOT EXISTS purchase_price_history (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL DEFAULT '',
      article TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'RUB',
      observed_at TEXT NOT NULL DEFAULT (datetime('now')),
      import_id TEXT NOT NULL DEFAULT '',
      source_file TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_pph_article ON purchase_price_history(supplier_id, article, observed_at DESC);
  `);
  addCol('purchase_price_imports', 'drive_file_id', `drive_file_id TEXT NOT NULL DEFAULT ''`);
  addCol('purchase_price_imports', 'drive_folder_id', `drive_folder_id TEXT NOT NULL DEFAULT ''`);
}

function addCol(table: string, col: string, ddl: string): void {
  try {
    const info = all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (info.some((c) => c.name === col)) return;
    run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch {
    /* ignore */
  }
}

function rootFolderId(): string {
  return String(process.env.GDRIVE_PURCHASE_ROOT || DEFAULT_ROOT).trim();
}

function saJsonPath(): string {
  const candidates = [
    process.env.GOOGLE_SA_JSON || '',
    '/root/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json',
    '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0] || '';
}

type SaJson = { client_email: string; private_key: string };

function loadSa(): SaJson {
  const p = saJsonPath();
  if (!existsSync(p)) throw new Error(`Нет GOOGLE_SA_JSON: ${p}`);
  const j = JSON.parse(readFileSync(p, 'utf8')) as SaJson;
  if (!j.client_email || !j.private_key) throw new Error('Битый SA JSON');
  return j;
}

let cachedToken: { token: string; exp: number } | null = null;

async function driveAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;
  const sa = loadSa();
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  ).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${sign.sign(sa.private_key, 'base64url')}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Google token: ${data.error || res.status}`);
  }
  cachedToken = {
    token: data.access_token,
    exp: now + (Number(data.expires_in) || 3600),
  };
  return data.access_token;
}

async function driveGet<T>(url: string): Promise<T> {
  const token = await driveAccessToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg =
      (json as { error?: { message?: string } })?.error?.message || text.slice(0, 200) || res.statusText;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json as T;
}

async function listChildren(folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = '';
  do {
    const q = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`;
    const u = new URL('https://www.googleapis.com/drive/v3/files');
    u.searchParams.set('q', q);
    u.searchParams.set('pageSize', '200');
    u.searchParams.set('orderBy', 'folder,name');
    u.searchParams.set(
      'fields',
      'nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,size)'
    );
    u.searchParams.set('supportsAllDrives', 'true');
    u.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const data = await driveGet<{ files?: DriveFile[]; nextPageToken?: string }>(u.toString());
    out.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

async function downloadFile(fileId: string): Promise<Buffer> {
  const token = await driveAccessToken();
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`download ${fileId}: ${res.status} ${t.slice(0, 120)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function isPriceFile(name: string, mime?: string): boolean {
  const n = name.toLowerCase();
  if (/\.(xlsx|xls|csv|txt)$/i.test(n)) return true;
  if (mime === 'application/vnd.google-apps.spreadsheet') return true;
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return true;
  if (mime === 'text/csv') return true;
  return false;
}

async function exportGoogleSheet(fileId: string): Promise<Buffer> {
  const token = await driveAccessToken();
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `/export?mimeType=${encodeURIComponent(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`export sheet ${fileId}: ${res.status} ${t.slice(0, 120)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function normName(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/['"«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Короткие коды папок Drive → аббревиатура поставщика (полное имя не показываем). */
const FOLDER_SUPPLIER_ALIASES: Record<string, string> = {
  т: 'Т',
  тиани: 'Т',
  tiani: 'Т',
  t: 'Т',
  тнк: 'ТНК',
  тайник: 'ТНК',
  taynic: 'ТНК',
  tnk: 'ТНК',
  x: 'X',
  xgm: 'X',
  g: 'G',
  gold: 'G',
  голд: 'G',
};

function resolveAliasTarget(folderName: string): string | null {
  const n = normName(folderName);
  if (!n) return null;
  if (FOLDER_SUPPLIER_ALIASES[n]) return FOLDER_SUPPLIER_ALIASES[n];
  const compact = n.replace(/[./\\|_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [alias, target] of Object.entries(FOLDER_SUPPLIER_ALIASES)) {
    if (
      compact === alias ||
      compact.startsWith(alias + ' ') ||
      compact.endsWith(' ' + alias)
    ) {
      return target;
    }
  }
  return null;
}

function findSupplierByName(name: string): { id: string; name: string } | null {
  const n = normName(name);
  if (!n) return null;
  const row = get<{ id: string; name: string }>(
    `SELECT id, name FROM counterparties
     WHERE IFNULL(is_active,1)=1 AND (kind = 'supplier' OR kind = 'both')
       AND lower(name) = ?
     ORDER BY IFNULL(is_main,0) DESC LIMIT 1`,
    [n]
  );
  if (row) return row;
  return (
    get<{ id: string; name: string }>(
      `SELECT id, name FROM counterparties
       WHERE IFNULL(is_active,1)=1 AND (kind = 'supplier' OR kind = 'both')
         AND lower(name) LIKE ?
       ORDER BY IFNULL(is_main,0) DESC, length(name) ASC LIMIT 1`,
      [`%${n}%`]
    ) || null
  );
}

function suggestSupplier(folderName: string): { id: string; name: string } | null {
  const alias = resolveAliasTarget(folderName);
  if (alias) {
    const hit = findSupplierByName(alias);
    if (hit) return hit;
  }
  const n = normName(folderName);
  if (!n) return null;
  const rows = all<{ id: string; name: string }>(
    `SELECT id, name FROM counterparties
     WHERE (kind = 'supplier' OR kind = 'both') AND IFNULL(is_active,1) = 1
     ORDER BY IFNULL(is_main,0) DESC, name
     LIMIT 2000`
  );
  const exact = rows.find((r) => normName(r.name) === n);
  if (exact) return exact;
  const starts = rows.find(
    (r) => normName(r.name).startsWith(n) || n.startsWith(normName(r.name))
  );
  if (starts) return starts;
  const fuzzy = rows.find((r) => {
    const rn = normName(r.name);
    return rn.includes(n) || n.includes(rn);
  });
  return fuzzy || null;
}

export async function syncPurchaseDriveFolders(): Promise<{
  folders: number;
  linked: number;
  error?: string;
}> {
  ensurePurchaseDriveSchema();
  const root = rootFolderId();
  try {
    await driveGet<{ id: string; name: string }>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(root)}` +
        `?fields=id,name&supportsAllDrives=true`
    );
  } catch (e) {
    const status = (e as { status?: number }).status;
    const msg =
      status === 404
        ? `Папка Drive недоступна SA (${SA_EMAIL}). Расшарьте Viewer на ${root}`
        : e instanceof Error
          ? e.message
          : String(e);
    lastPollError = msg;
    return { folders: 0, linked: 0, error: msg };
  }

  const children = await listChildren(root);
  const folders = children.filter(
    (f) => f.mimeType === 'application/vnd.google-apps.folder'
  );
  let linked = 0;
  for (const f of folders) {
    const existing = get<{ id: string; supplier_id: string }>(
      `SELECT id, supplier_id FROM purchase_drive_folders WHERE drive_folder_id = ?`,
      [f.id]
    );
    if (existing) {
      run(
        `UPDATE purchase_drive_folders SET folder_name = ?, last_seen_at = datetime('now'),
         updated_at = datetime('now'), is_active = 1 WHERE id = ?`,
        [f.name, existing.id]
      );
      if (existing.supplier_id) {
        linked += 1;
      } else {
        const sug = suggestSupplier(f.name);
        if (sug?.id) {
          run(
            `UPDATE purchase_drive_folders SET supplier_id=?, supplier_name=?,
             updated_at=datetime('now') WHERE id=?`,
            [sug.id, sug.name, existing.id]
          );
          linked += 1;
        }
      }
      continue;
    }
    const sug = suggestSupplier(f.name);
    const id = newGuid();
    run(
      `INSERT INTO purchase_drive_folders (
         id, drive_folder_id, folder_name, supplier_id, supplier_name, last_seen_at
       ) VALUES (?,?,?,?,?,datetime('now'))`,
      [id, f.id, f.name, sug?.id || '', sug?.name || '']
    );
    if (sug?.id) linked += 1;
  }
  return { folders: folders.length, linked };
}

export async function pollPurchaseDrive(opts?: {
  force?: boolean;
}): Promise<Record<string, unknown>> {
  if (pollRunning && !opts?.force) {
    return { ok: false, skipped: true, reason: 'already_running' };
  }
  pollRunning = true;
  ensurePurchaseDriveSchema();
  const summary: Record<string, unknown> = {
    at: new Date().toISOString(),
    imported: 0,
    seen: 0,
    errors: [] as string[],
  };
  try {
    const sync = await syncPurchaseDriveFolders();
    summary.folders = sync.folders;
    summary.linked = sync.linked;
    if (sync.error) {
      summary.error = sync.error;
      lastPollError = sync.error;
      lastPollAt = String(summary.at);
      lastPollSummary = summary;
      return summary;
    }
    lastPollError = '';

    const mapped = all<{
      id: string;
      drive_folder_id: string;
      folder_name: string;
      supplier_id: string;
      supplier_name: string;
    }>(
      `SELECT id, drive_folder_id, folder_name, supplier_id, supplier_name
       FROM purchase_drive_folders WHERE is_active = 1 AND supplier_id != ''`
    );

    for (const folder of mapped) {
      let files: DriveFile[] = [];
      try {
        files = await listChildren(folder.drive_folder_id);
      } catch (e) {
        (summary.errors as string[]).push(
          `${folder.folder_name}: ${e instanceof Error ? e.message : e}`
        );
        continue;
      }
      for (const f of files) {
        if (f.mimeType === 'application/vnd.google-apps.folder') continue;
        if (!isPriceFile(f.name, f.mimeType)) continue;
        summary.seen = Number(summary.seen) + 1;
        const prev = get<{ id: string; md5: string; modified_at: string; import_id: string }>(
          `SELECT id, md5, modified_at, import_id FROM purchase_drive_files WHERE drive_file_id = ?`,
          [f.id]
        );
        const md5 = String(f.md5Checksum || '');
        const modified = String(f.modifiedTime || '');
        if (
          prev &&
          prev.import_id &&
          ((md5 && prev.md5 === md5) || (!md5 && prev.modified_at === modified))
        ) {
          continue;
        }
        const rowId = prev?.id || newGuid();
        if (!prev) {
          run(
            `INSERT INTO purchase_drive_files (
               id, drive_file_id, drive_folder_id, folder_row_id, name, mime_type, md5,
               modified_at, size_bytes, status
             ) VALUES (?,?,?,?,?,?,?,?,?,'seen')`,
            [
              rowId,
              f.id,
              folder.drive_folder_id,
              folder.id,
              f.name,
              f.mimeType || '',
              md5,
              modified,
              Number(f.size) || 0,
            ]
          );
        } else {
          run(
            `UPDATE purchase_drive_files SET name=?, mime_type=?, md5=?, modified_at=?, size_bytes=?,
             status='seen', error='' WHERE id=?`,
            [f.name, f.mimeType || '', md5, modified, Number(f.size) || 0, rowId]
          );
        }
        try {
          let buf: Buffer;
          let fileName = f.name;
          if (f.mimeType === 'application/vnd.google-apps.spreadsheet') {
            buf = await exportGoogleSheet(f.id);
            if (!/\.xlsx$/i.test(fileName)) fileName = `${fileName}.xlsx`;
          } else {
            buf = await downloadFile(f.id);
          }
          const { createPurchaseImportFromBuffer } = await import('./purchase-intake.js');
          const created = await createPurchaseImportFromBuffer({
            buf,
            fileName,
            supplier_id: folder.supplier_id,
            supplier_name: folder.supplier_name,
            created_by: 'drive-poll',
            drive_file_id: f.id,
            drive_folder_id: folder.drive_folder_id,
          });
          run(
            `UPDATE purchase_drive_files SET status='imported', import_id=?, imported_at=datetime('now'),
             error='' WHERE id=?`,
            [created.id, rowId]
          );
          summary.imported = Number(summary.imported) + 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          run(`UPDATE purchase_drive_files SET status='error', error=? WHERE id=?`, [msg.slice(0, 500), rowId]);
          (summary.errors as string[]).push(`${f.name}: ${msg}`);
        }
      }
    }
    lastPollAt = String(summary.at);
    lastPollSummary = summary;
    return { ok: true, ...summary };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    lastPollError = msg;
    lastPollAt = new Date().toISOString();
    summary.error = msg;
    lastPollSummary = summary;
    return { ok: false, ...summary };
  } finally {
    pollRunning = false;
  }
}

export function startPurchaseDrivePoller(): void {
  if (String(process.env.GDRIVE_PURCHASE_POLL || '1') === '0') {
    console.log('[cron] purchase-drive: disabled (GDRIVE_PURCHASE_POLL=0)');
    return;
  }
  ensurePurchaseDriveSchema();
  const boot = () => {
    void pollPurchaseDrive().then((r) => {
      console.log(
        '[cron] purchase-drive boot:',
        r.error || `folders ${r.folders ?? 0}, imported ${r.imported ?? 0}`
      );
    });
  };
  setTimeout(boot, 45_000);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    void pollPurchaseDrive().then((r) => {
      if (r.error || Number(r.imported) > 0 || (r.errors as string[] | undefined)?.length) {
        console.log('[cron] purchase-drive:', JSON.stringify(r));
      }
    });
  }, POLL_MS);
  console.log(`[cron] purchase-drive: every ${Math.round(POLL_MS / 1000)}s · root ${rootFolderId()}`);
}

export function mountPurchaseDriveRoutes(api: Hono): void {
  ensurePurchaseDriveSchema();

  api.get('/purchase-drive/status', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    // Без имён папок / id Drive / SA — сотрудникам только служебный статус опроса
    return c.json({
      poll_ms: POLL_MS,
      last_poll_at: lastPollAt,
      last_poll_error: lastPollError,
      last_poll: {
        at: lastPollSummary.at,
        imported: lastPollSummary.imported,
        seen: lastPollSummary.seen,
        error: lastPollSummary.error,
        errors_count: Array.isArray(lastPollSummary.errors)
          ? (lastPollSummary.errors as string[]).length
          : 0,
      },
    });
  });

  api.get('/purchase-drive/folders', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const rows = all<{
      id: string;
      folder_name: string;
      supplier_id: string;
      supplier_name: string;
      files_count: number;
      imported_count: number;
    }>(
      `SELECT f.id, f.folder_name, f.supplier_id, f.supplier_name,
         (SELECT COUNT(*) FROM purchase_drive_files x WHERE x.drive_folder_id = f.drive_folder_id) AS files_count,
         (SELECT COUNT(*) FROM purchase_drive_files x WHERE x.drive_folder_id = f.drive_folder_id AND x.status='imported') AS imported_count
       FROM purchase_drive_folders f
       WHERE f.is_active = 1
       ORDER BY IFNULL(NULLIF(f.supplier_name,''), f.folder_name)`
    );
    // В UI только аббревиатура поставщика — без имени папки Drive и folder id
    const items = rows.map((f) => {
      const code =
        String(f.supplier_name || '').trim() ||
        resolveAliasTarget(f.folder_name) ||
        '';
      return {
        id: f.id,
        supplier_id: f.supplier_id || '',
        supplier_name: code,
        files_count: f.files_count || 0,
        imported_count: f.imported_count || 0,
      };
    });
    return c.json({ items });
  });

  api.post('/purchase-drive/sync-folders', async (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    try {
      const r = await syncPurchaseDriveFolders();
      auditFromContext(c, {
        action: 'purchase_drive.sync_folders',
        entity: 'purchase_drive',
        summary: r.error || `Папок Drive: ${r.folders}, с поставщиком: ${r.linked}`,
        after: r,
      });
      if (r.error) return c.json({ ok: false, ...r }, 400);
      return c.json({ ok: true, ...r });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'sync failed' }, 400);
    }
  });

  api.patch('/purchase-drive/folders/:id', async (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const id = c.req.param('id');
    const row = get<Record<string, unknown>>(
      `SELECT * FROM purchase_drive_folders WHERE id = ?`,
      [id]
    );
    if (!row) return c.json({ error: 'not found' }, 404);
    const body = await c.req.json<{
      supplier_id?: string;
      supplier_name?: string;
      notes?: string;
      is_active?: boolean | number;
    }>();
    let supplier_id =
      body.supplier_id !== undefined ? String(body.supplier_id || '') : String(row.supplier_id || '');
    let supplier_name =
      body.supplier_name !== undefined
        ? String(body.supplier_name || '')
        : String(row.supplier_name || '');
    if (supplier_id && !supplier_name) {
      supplier_name =
        get<{ name: string }>('SELECT name FROM counterparties WHERE id = ?', [supplier_id])
          ?.name || '';
    }
    const notes = body.notes !== undefined ? String(body.notes || '').slice(0, 500) : String(row.notes || '');
    const is_active =
      body.is_active !== undefined ? (body.is_active ? 1 : 0) : Number(row.is_active) ? 1 : 0;
    run(
      `UPDATE purchase_drive_folders SET supplier_id=?, supplier_name=?, notes=?, is_active=?,
       updated_at=datetime('now') WHERE id=?`,
      [supplier_id, supplier_name, notes, is_active, id]
    );
    const after = get(`SELECT * FROM purchase_drive_folders WHERE id = ?`, [id]);
    auditFromContext(c, {
      action: 'purchase_drive.folder_link',
      entity: 'purchase_drive_folder',
      entityId: id,
      summary: `Папка «${row.folder_name}» → ${supplier_name || 'без поставщика'}`,
      after: after || undefined,
    });
    return c.json(after);
  });

  api.post('/purchase-drive/poll', async (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const r = await pollPurchaseDrive({ force: true });
    auditFromContext(c, {
      action: 'purchase_drive.poll',
      entity: 'purchase_drive',
      summary: r.error
        ? String(r.error)
        : `Drive poll: новых ${r.imported || 0}, файлов ${r.seen || 0}`,
      after: r,
    });
    return c.json(r, r.error ? 400 : 200);
  });

  api.get('/purchase-drive/files', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const folder = String(c.req.query('folder_id') || '').trim();
    const params: string[] = [];
    let where = '1=1';
    if (folder) {
      where += ' AND drive_folder_id = ?';
      params.push(folder);
    }
    const items = all(
      `SELECT * FROM purchase_drive_files WHERE ${where}
       ORDER BY first_seen_at DESC LIMIT 200`,
      params
    );
    return c.json({ items });
  });

  api.get('/purchase-drive/price-history', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const article = String(c.req.query('article') || '').trim();
    const supplier_id = String(c.req.query('supplier_id') || '').trim();
    if (!article) return c.json({ error: 'article required' }, 400);
    const params: Array<string | number> = [article];
    let where = 'article = ?';
    if (supplier_id) {
      where += ' AND supplier_id = ?';
      params.push(supplier_id);
    }
    const items = all(
      `SELECT * FROM purchase_price_history WHERE ${where}
       ORDER BY observed_at DESC LIMIT 200`,
      params
    );
    return c.json({ items });
  });
}
