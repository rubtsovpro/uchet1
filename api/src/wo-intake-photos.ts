/**
 * Фотофиксация приёма авто — к заказ-наряду (дело ЗН).
 * Локально: data/wo-photos/{docId}/ (не публичный S3: авто / ПДн).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureStsJpeg } from './sts-media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Минимум кадров по регламенту приёмщика. */
export const WO_INTAKE_PHOTOS_MIN = 12;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_PHOTOS = 48;

function dataDir(): string {
  return process.env.WMS_DATA_DIR || path.resolve(__dirname, '..', '..', 'data');
}

function safeDocId(docId: string): string {
  const id = String(docId || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!id) throw new Error('doc_id required');
  return id;
}

export function woPhotosDir(docId: string): string {
  const dir = path.join(dataDir(), 'wo-photos', safeDocId(docId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function extForMime(mime: string): string {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'jpg';
}

function mimeForExt(ext: string): string {
  const e = String(ext || '')
    .toLowerCase()
    .replace(/^\./, '');
  if (e === 'png') return 'image/png';
  if (e === 'webp') return 'image/webp';
  if (e === 'gif') return 'image/gif';
  return 'image/jpeg';
}

export type WoIntakePhoto = {
  id: string;
  mime: string;
  size: number;
  created_at: string;
  url: string;
};

function photoUrl(docId: string, photoId: string): string {
  return `/api/sales-docs/${encodeURIComponent(docId)}/intake-photos/${encodeURIComponent(photoId)}`;
}

function parsePhotoFile(name: string): { id: string; ext: string } | null {
  const m = /^([a-zA-Z0-9_-]+)\.(jpe?g|png|webp|gif)$/i.exec(String(name || ''));
  if (!m) return null;
  return { id: m[1], ext: m[2].toLowerCase() };
}

export function listWoIntakePhotos(docId: string): WoIntakePhoto[] {
  const id = safeDocId(docId);
  const dir = woPhotosDir(id);
  const files = fs.readdirSync(dir);
  const items: WoIntakePhoto[] = [];
  for (const name of files) {
    const parsed = parsePhotoFile(name);
    if (!parsed) continue;
    const full = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }
    items.push({
      id: parsed.id,
      mime: mimeForExt(parsed.ext),
      size: st.size,
      created_at: st.mtime.toISOString(),
      url: photoUrl(id, parsed.id),
    });
  }
  items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return items;
}

export function woIntakePhotosSummary(docId: string): {
  items: WoIntakePhoto[];
  count: number;
  min_required: number;
  photos_ok: boolean;
} {
  const items = listWoIntakePhotos(docId);
  const count = items.length;
  return {
    items,
    count,
    min_required: WO_INTAKE_PHOTOS_MIN,
    photos_ok: count >= WO_INTAKE_PHOTOS_MIN,
  };
}

export function readWoIntakePhoto(
  docId: string,
  photoId: string
): { buf: Buffer; mime: string } | null {
  const id = safeDocId(docId);
  const pid = String(photoId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  if (!pid) return null;
  const dir = woPhotosDir(id);
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
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

export async function saveWoIntakePhoto(
  docId: string,
  buf: Buffer,
  mime?: string
): Promise<WoIntakePhoto> {
  if (!buf?.length) throw new Error('Пустое фото');
  if (buf.length > MAX_FILE_BYTES) throw new Error('Фото больше 12 МБ');
  const existing = listWoIntakePhotos(docId);
  if (existing.length >= MAX_PHOTOS) {
    throw new Error(`Уже ${MAX_PHOTOS} фото — удалите лишние`);
  }
  const normalized = await ensureStsJpeg(buf, mime);
  const pid = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  const ext = extForMime(normalized.mime);
  const dest = path.join(woPhotosDir(docId), `${pid}.${ext}`);
  fs.writeFileSync(dest, normalized.buf);
  const st = fs.statSync(dest);
  return {
    id: pid,
    mime: mimeForExt(ext),
    size: st.size,
    created_at: st.mtime.toISOString(),
    url: photoUrl(safeDocId(docId), pid),
  };
}

export function deleteWoIntakePhoto(docId: string, photoId: string): boolean {
  const id = safeDocId(docId);
  const pid = String(photoId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  if (!pid) return false;
  const dir = woPhotosDir(id);
  let deleted = false;
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']) {
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
