/**
 * Шаблоны СТО: рабочий текст — кэш на диске / локальный txt.
 * Google Drive только по явному force (кнопка «Подтянуть» в настройках) —
 * не дергаем Drive при открытии заказа / meta / печати.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportDriveFilePlainText } from './google-sa.js';
import {
  getStoDocTemplate,
  readStoTemplateText,
  STO_CONTRACT_LEGAL,
  STO_CONTRACT_LEGAL_MSK,
  STO_SELLER_INN_ROMAN,
  STO_TEMPLATES_ROOT,
} from './sto-doc-templates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs/sto-templates/gdrive-sto-edit.json');

/** ИНН ИП Безматерных М.П. (Краснодар). */
export const STO_SELLER_INN_MIKHAIL = '231295963240';

/** In-memory только ускоряет повтор в том же процессе; сброс — clearStoDriveMemCache / «Подтянуть». */
const MEM_TTL_MS = Math.max(
  60_000,
  Number(process.env.STO_DRIVE_TTL_MS || 60 * 60 * 1000) || 3_600_000
);

export type StoDriveOwnerKey = 'roman' | 'mikhail';

type StoDriveManifest = {
  default_owner?: string;
  owners?: Record<string, { inn?: string }>;
  docs?: Record<
    string,
    {
      title?: string;
      sto_template_id?: string;
      google_doc_id?: string;
      by_owner?: Record<string, string>;
    }
  >;
};

type MemHit = { text: string; at: number; source: 'drive' | 'cache' | 'local'; driveId?: string };

const mem = new Map<string, MemHit>();
let manifestCache: { at: number; data: StoDriveManifest | null } = { at: 0, data: null };

export function stoOwnerKeyFromInn(inn: string | null | undefined): StoDriveOwnerKey {
  const d = String(inn || '').replace(/\D/g, '');
  if (d === STO_SELLER_INN_MIKHAIL) return 'mikhail';
  return 'roman';
}

/** id в манифесте Drive (legal-msk → тот же файл, что legal у Ромы). */
export function stoDriveManifestKey(templateId: string): string {
  const id = String(templateId || '').trim();
  if (id === STO_CONTRACT_LEGAL_MSK) return STO_CONTRACT_LEGAL;
  return id;
}

function readManifest(): StoDriveManifest | null {
  const now = Date.now();
  if (manifestCache.data && now - manifestCache.at < 60_000) return manifestCache.data;
  try {
    if (!fs.existsSync(MANIFEST_PATH)) {
      manifestCache = { at: now, data: null };
      return null;
    }
    const data = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as StoDriveManifest;
    manifestCache = { at: now, data };
    return data;
  } catch {
    manifestCache = { at: now, data: null };
    return null;
  }
}

export function resolveStoDriveFileId(
  templateId: string,
  sellerInn?: string | null
): { owner: StoDriveOwnerKey; fileId: string; title: string } | null {
  const man = readManifest();
  if (!man?.docs) return null;
  const key = stoDriveManifestKey(templateId);
  const doc = man.docs[key];
  if (!doc) return null;
  const owner = stoOwnerKeyFromInn(sellerInn);
  const by = doc.by_owner || {};
  const fileId = String(by[owner] || doc.google_doc_id || '').trim();
  if (!fileId) return null;
  return {
    owner,
    fileId,
    title: String(doc.title || key),
  };
}

function cacheDir(owner: StoDriveOwnerKey): string {
  return path.join(STO_TEMPLATES_ROOT, 'cache', owner);
}

function cachePath(owner: StoDriveOwnerKey, txtFile: string): string {
  return path.join(cacheDir(owner), path.basename(txtFile));
}

function writeOwnerCache(owner: StoDriveOwnerKey, txtFile: string, text: string): void {
  const dir = cacheDir(owner);
  fs.mkdirSync(dir, { recursive: true });
  const p = cachePath(owner, txtFile);
  fs.writeFileSync(p, text.endsWith('\n') ? text : text + '\n', 'utf8');
  // зеркало в общий txt — чтобы старый sync-код и diff видели последнее
  try {
    const shared = path.join(STO_TEMPLATES_ROOT, 'txt', path.basename(txtFile));
    fs.writeFileSync(shared, text.endsWith('\n') ? text : text + '\n', 'utf8');
  } catch {
    /* ignore */
  }
}

function readOwnerCache(owner: StoDriveOwnerKey, txtFile: string): string | null {
  const p = cachePath(owner, txtFile);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

export type LoadStoTemplateResult = {
  text: string;
  source: 'drive' | 'cache' | 'local';
  owner: StoDriveOwnerKey;
  driveId?: string;
  title?: string;
  syncedAt?: string;
};

/**
 * Текст бланка: кэш владельца → локальный txt.
 * Drive — только при opts.force (явное «Подтянуть»).
 */
export async function loadStoTemplateText(
  templateId: string,
  sellerInn?: string | null,
  opts?: { force?: boolean }
): Promise<LoadStoTemplateResult | null> {
  const id = String(templateId || '').trim();
  const meta = getStoDocTemplate(id);
  if (!meta) return null;

  const owner = stoOwnerKeyFromInn(sellerInn);
  const memKey = `${owner}::${stoDriveManifestKey(id)}`;
  const now = Date.now();
  const drive = resolveStoDriveFileId(id, sellerInn);

  if (opts?.force && drive) {
    try {
      let text = await exportDriveFilePlainText(drive.fileId);
      text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (!text.endsWith('\n')) text += '\n';
      writeOwnerCache(owner, meta.txtFile, text);
      mem.set(memKey, { text, at: now, source: 'drive', driveId: drive.fileId });
      return {
        text,
        source: 'drive',
        owner,
        driveId: drive.fileId,
        title: drive.title,
        syncedAt: new Date(now).toISOString(),
      };
    } catch (e) {
      console.warn(
        `[sto-drive] force ${id}/${owner}: ${e instanceof Error ? e.message : e} — fallback cache`
      );
    }
  }

  if (!opts?.force) {
    const hit = mem.get(memKey);
    if (hit && now - hit.at < MEM_TTL_MS) {
      return {
        text: hit.text,
        source: hit.source,
        owner,
        driveId: hit.driveId,
        syncedAt: new Date(hit.at).toISOString(),
      };
    }
  }

  const cached = readOwnerCache(owner, meta.txtFile);
  if (cached != null && cached.trim()) {
    mem.set(memKey, { text: cached, at: now, source: 'cache', driveId: drive?.fileId });
    return {
      text: cached,
      source: 'cache',
      owner,
      driveId: drive?.fileId,
      title: drive?.title,
      syncedAt: new Date(now).toISOString(),
    };
  }

  const local = readStoTemplateText(id);
  if (local == null) return null;
  mem.set(memKey, { text: local, at: now, source: 'local' });
  return {
    text: local,
    source: 'local',
    owner,
    title: meta.title,
    syncedAt: new Date(now).toISOString(),
  };
}

/** Подтянуть сразу несколько бланков (пакет / доп.документы). */
export async function preloadStoTemplates(
  templateIds: string[],
  sellerInn?: string | null,
  opts?: { force?: boolean }
): Promise<{ id: string; source: string; ok: boolean; error?: string }[]> {
  const out: { id: string; source: string; ok: boolean; error?: string }[] = [];
  for (const id of templateIds) {
    try {
      const r = await loadStoTemplateText(id, sellerInn, opts);
      out.push({
        id,
        source: r?.source || 'missing',
        ok: !!r?.text,
      });
    } catch (e) {
      out.push({
        id,
        source: 'error',
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

export const STO_EXTRA_DEAL_TEMPLATE_IDS = [
  'sto-no-show',
  'sto-checklist',
] as const;

/** Подписи для вкладки «Доп. документы» — только бланки из Google Drive. */
export const STO_EXTRA_DEAL_DOCS: ReadonlyArray<{
  id: (typeof STO_EXTRA_DEAL_TEMPLATE_IDS)[number];
  label: string;
  meta: string;
  group: 'intake' | 'repair' | 'handover' | 'extra';
}> = [
  {
    id: 'sto-no-show',
    label: 'Акт о неявке',
    meta: 'не забирает авто',
    group: 'extra',
  },
  {
    id: 'sto-checklist',
    label: 'Чек-лист приёма/выдачи',
    meta: 'контроль по ЗН',
    group: 'extra',
  },
];

export function isStoExtraDealTemplateId(id: string): boolean {
  return (STO_EXTRA_DEAL_TEMPLATE_IDS as readonly string[]).includes(String(id || '').trim());
}

/** Сброс in-memory TTL (после «Подтянуть» в настройках). */
export function clearStoDriveMemCache(templateId?: string, sellerInn?: string | null): void {
  if (!templateId) {
    mem.clear();
    return;
  }
  const key = stoDriveManifestKey(templateId);
  if (sellerInn != null && String(sellerInn).trim()) {
    mem.delete(`${stoOwnerKeyFromInn(sellerInn)}::${key}`);
    return;
  }
  for (const k of [...mem.keys()]) {
    if (k.endsWith(`::${key}`)) mem.delete(k);
  }
}

/** Подпись источника для UI (drive / cache / local). */
export function stoTemplateSourceLabel(source: string | undefined): string {
  const s = String(source || '').trim();
  if (s === 'drive') return 'Google Drive';
  if (s === 'cache') return 'кэш Drive';
  if (s === 'local') return 'локальный бланк';
  if (s.includes(',')) {
    const parts = [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];
    if (parts.length === 1) return stoTemplateSourceLabel(parts[0]);
    return parts.map(stoTemplateSourceLabel).join(' + ');
  }
  return s || '—';
}
