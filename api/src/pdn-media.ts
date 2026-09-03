/**
 * Подписанное согласие ПДн — сканы/фото к сделке.
 * Локально: data/pdn/{dealId}/ (не публичный S3: ПДн).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureStsJpeg } from './sts-media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_FILES = 24;

function dataDir(): string {
  return process.env.WMS_DATA_DIR || path.resolve(__dirname, '..', '..', 'data');
}

function safeDealId(dealId: string): string {
  const id = String(dealId || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!id) throw new Error('deal_id required');
  return id;
}

export function pdnDealDir(dealId: string): string {
  const dir = path.join(dataDir(), 'pdn', safeDealId(dealId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extForMime(mime: string): string {
  const m = String(mime || '').toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'jpg';
}

function mimeForExt(ext: string): string {
  const e = String(ext || '')
    .toLowerCase()
    .replace(/^\./, '');
  if (e === 'pdf') return 'application/pdf';
  if (e === 'png') return 'image/png';
  if (e === 'webp') return 'image/webp';
  if (e === 'gif') return 'image/gif';
  return 'image/jpeg';
}

export type PdnScanFile = {
  id: string;
  mime: string;
  size: number;
  created_at: string;
  url: string;
  kind: 'image' | 'pdf';
};

function fileUrl(dealId: string, fileId: string): string {
  return `/api/crm/deals/${encodeURIComponent(dealId)}/pdn-scans/${encodeURIComponent(fileId)}`;
}

function parseScanFile(name: string): { id: string; ext: string } | null {
  const m = /^([a-zA-Z0-9_-]+)\.(jpe?g|png|webp|gif|pdf)$/i.exec(String(name || ''));
  if (!m) return null;
  return { id: m[1], ext: m[2].toLowerCase() };
}

export function listPdnScans(dealId: string): PdnScanFile[] {
  const id = safeDealId(dealId);
  const dir = pdnDealDir(id);
  const items: PdnScanFile[] = [];
  for (const name of fs.readdirSync(dir)) {
    const parsed = parseScanFile(name);
    if (!parsed) continue;
    const full = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }
    const mime = mimeForExt(parsed.ext);
    items.push({
      id: parsed.id,
      mime,
      size: st.size,
      created_at: st.mtime.toISOString(),
      url: fileUrl(id, parsed.id),
      kind: mime === 'application/pdf' ? 'pdf' : 'image',
    });
  }
  items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return items;
}

export function pdnScansSummary(dealId: string): {
  items: PdnScanFile[];
  count: number;
  scans_ok: boolean;
} {
  const items = listPdnScans(dealId);
  const count = items.length;
  return { items, count, scans_ok: count > 0 };
}

export function readPdnScan(
  dealId: string,
  fileId: string
): { buf: Buffer; mime: string } | null {
  const id = safeDealId(dealId);
  const pid = String(fileId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  if (!pid) return null;
  const dir = pdnDealDir(id);
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf']) {
    const full = path.join(dir, `${pid}.${ext}`);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        return { buf: fs.readFileSync(full), mime: mimeForExt(ext) };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function savePdnScan(
  dealId: string,
  buf: Buffer,
  mime?: string
): Promise<PdnScanFile> {
  if (!buf?.length) throw new Error('Пустой файл');
  if (buf.length > MAX_FILE_BYTES) throw new Error('Файл больше 12 МБ');
  const existing = listPdnScans(dealId);
  if (existing.length >= MAX_FILES) {
    throw new Error(`Уже ${MAX_FILES} файлов — удалите лишние`);
  }
  const m = String(mime || '').toLowerCase();
  const isPdf =
    m.includes('pdf') ||
    (buf.length >= 5 && buf.slice(0, 5).toString('ascii') === '%PDF-');
  let outBuf = buf;
  let outMime = isPdf ? 'application/pdf' : m && m.startsWith('image/') ? m : 'image/jpeg';
  if (!isPdf) {
    const normalized = await ensureStsJpeg(buf, mime);
    outBuf = normalized.buf;
    outMime = normalized.mime;
  }
  const pid = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  const ext = extForMime(outMime);
  const dest = path.join(pdnDealDir(dealId), `${pid}.${ext}`);
  fs.writeFileSync(dest, outBuf);
  const st = fs.statSync(dest);
  const id = safeDealId(dealId);
  return {
    id: pid,
    mime: mimeForExt(ext),
    size: st.size,
    created_at: st.mtime.toISOString(),
    url: fileUrl(id, pid),
    kind: ext === 'pdf' ? 'pdf' : 'image',
  };
}

export function deletePdnScan(dealId: string, fileId: string): boolean {
  const id = safeDealId(dealId);
  const pid = String(fileId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  if (!pid) return false;
  const dir = pdnDealDir(id);
  let deleted = false;
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'heic', 'heif']) {
    const full = path.join(dir, `${pid}.${ext}`);
    try {
      if (fs.existsSync(full)) {
        fs.unlinkSync(full);
        deleted = true;
      }
    } catch {
      /* ignore */
    }
  }
  return deleted;
}
