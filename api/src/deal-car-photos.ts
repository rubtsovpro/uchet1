/**
 * Фото автомобиля при приёме — на сделку (хаб «Документы» под СТС).
 * Оригиналы в S3: deal-car-photos/{dealId}/{photoId}.{ext}
 * meta.json локально (индекс + ракурс). Старые локальные файлы читаются как fallback.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureStsJpeg, isHeifBuffer } from './sts-media.js';
import {
  detectMediaType,
  s3ConfigFromEnv,
  s3DeleteObject,
  s3GetObject,
  s3PutObject,
} from './s3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEAL_CAR_PHOTOS_MIN = 12;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_PHOTOS = 48;

export const DEAL_CAR_PHOTO_SIDES = [
  { id: 'front', label: 'Перед' },
  { id: 'rear', label: 'Зад' },
  { id: 'left', label: 'Левый бок' },
  { id: 'right', label: 'Правый бок' },
  { id: 'top', label: 'Крыша' },
  { id: 'interior', label: 'Салон' },
  { id: 'odometer', label: 'Пробег / панель' },
  { id: 'trunk', label: 'Багажник' },
  { id: 'damage', label: 'Повреждение' },
  { id: 'other', label: 'Ещё' },
] as const;

export type DealCarPhotoSide = (typeof DEAL_CAR_PHOTO_SIDES)[number]['id'];

type PhotoMetaEntry = {
  side?: string;
  s3_key?: string;
  mime?: string;
  size?: number;
  created_at?: string;
};

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

export function dealCarPhotosDir(dealId: string): string {
  const dir = path.join(dataDir(), 'deal-car-photos', safeDealId(dealId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function metaPath(dealId: string): string {
  return path.join(dealCarPhotosDir(dealId), 'meta.json');
}

function readMeta(dealId: string): Record<string, PhotoMetaEntry> {
  try {
    const p = metaPath(dealId);
    if (!fs.existsSync(p)) return {};
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, PhotoMetaEntry>;
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function writeMeta(dealId: string, meta: Record<string, PhotoMetaEntry>): void {
  fs.writeFileSync(metaPath(dealId), JSON.stringify(meta, null, 2), 'utf8');
}

function normalizeSide(raw: unknown): DealCarPhotoSide | undefined {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (!s) return undefined;
  return DEAL_CAR_PHOTO_SIDES.some((x) => x.id === s)
    ? (s as DealCarPhotoSide)
    : 'other';
}

function sideLabel(side?: string): string {
  const id = String(side || '').trim();
  const hit = DEAL_CAR_PHOTO_SIDES.find((x) => x.id === id);
  return hit?.label || '';
}

function photoUrl(dealId: string, photoId: string): string {
  return `/api/crm/deals/${encodeURIComponent(dealId)}/car-photos/${encodeURIComponent(photoId)}`;
}

export type DealCarPhoto = {
  id: string;
  mime: string;
  size: number;
  created_at: string;
  url: string;
  side?: string;
  side_label?: string;
  storage?: 's3' | 'local';
};

function parsePhotoFile(name: string): { id: string; ext: string } | null {
  const m = /^([a-zA-Z0-9_-]+)\.(jpe?g|png|webp|gif|heic|heif)$/i.exec(String(name || ''));
  if (!m) return null;
  return { id: m[1], ext: m[2].toLowerCase() };
}

function mimeForExt(ext: string): string {
  const e = String(ext || '')
    .toLowerCase()
    .replace(/^\./, '');
  if (e === 'png') return 'image/png';
  if (e === 'webp') return 'image/webp';
  if (e === 'gif') return 'image/gif';
  if (e === 'heic' || e === 'heif') return 'image/heic';
  return 'image/jpeg';
}

function detectStoreExt(buf: Buffer, mimeHint?: string): { ext: string; mime: string } {
  const detected = detectMediaType(buf);
  if (detected.kind === 'image' && detected.ext !== 'bin') {
    return { ext: detected.ext, mime: detected.mime };
  }
  if (isHeifBuffer(buf)) {
    return { ext: 'heic', mime: 'image/heic' };
  }
  const m = String(mimeHint || '').toLowerCase();
  if (m.includes('heic') || m.includes('heif')) return { ext: 'heic', mime: 'image/heic' };
  if (m.includes('png')) return { ext: 'png', mime: 'image/png' };
  if (m.includes('webp')) return { ext: 'webp', mime: 'image/webp' };
  if (m.includes('gif')) return { ext: 'gif', mime: 'image/gif' };
  if (m.includes('jpeg') || m.includes('jpg')) return { ext: 'jpg', mime: 'image/jpeg' };
  return { ext: 'bin', mime: m || 'application/octet-stream' };
}

export function listDealCarPhotos(dealId: string): DealCarPhoto[] {
  const id = safeDealId(dealId);
  const dir = dealCarPhotosDir(id);
  const meta = readMeta(id);
  const byId = new Map<string, DealCarPhoto>();

  for (const [pid, entry] of Object.entries(meta)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(pid)) continue;
    if (!entry?.s3_key) continue;
    const side = String(entry.side || '').trim() || undefined;
    byId.set(pid, {
      id: pid,
      mime: String(entry.mime || 'image/jpeg'),
      size: Number(entry.size) || 0,
      created_at: String(entry.created_at || new Date(0).toISOString()),
      url: photoUrl(id, pid),
      side,
      side_label: sideLabel(side) || undefined,
      storage: 's3',
    });
  }

  for (const name of fs.readdirSync(dir)) {
    const parsed = parsePhotoFile(name);
    if (!parsed) continue;
    if (byId.has(parsed.id)) continue;
    const full = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }
    const side = String(meta[parsed.id]?.side || '').trim() || undefined;
    byId.set(parsed.id, {
      id: parsed.id,
      mime: mimeForExt(parsed.ext),
      size: st.size,
      created_at: st.mtime.toISOString(),
      url: photoUrl(id, parsed.id),
      side,
      side_label: sideLabel(side) || undefined,
      storage: 'local',
    });
  }

  const items = [...byId.values()];
  items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return items;
}

export function dealCarPhotosSummary(dealId: string): {
  items: DealCarPhoto[];
  count: number;
  min_required: number;
  photos_ok: boolean;
  sides: typeof DEAL_CAR_PHOTO_SIDES;
  /** ISO первого снимка — момент приёмки авто */
  first_at: string;
} {
  const items = listDealCarPhotos(dealId);
  const count = items.length;
  return {
    items,
    count,
    min_required: DEAL_CAR_PHOTOS_MIN,
    photos_ok: count >= DEAL_CAR_PHOTOS_MIN,
    sides: DEAL_CAR_PHOTO_SIDES,
    first_at: count ? String(items[0].created_at || '') : '',
  };
}

/** Дата/время первого фото авто (приёмка), ISO или ''. */
export function dealCarPhotosFirstAt(dealId: string): string {
  return dealCarPhotosSummary(dealId).first_at;
}

function findLocalPhoto(
  dealId: string,
  photoId: string
): { buf: Buffer; mime: string } | null {
  const id = safeDealId(dealId);
  const pid = String(photoId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  if (!pid) return null;
  const dir = dealCarPhotosDir(id);
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']) {
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

/** Отдать кадр для UI: HEIC → JPEG; оригинал иначе как есть. */
export async function readDealCarPhoto(
  dealId: string,
  photoId: string
): Promise<{ buf: Buffer; mime: string } | null> {
  const id = safeDealId(dealId);
  const pid = String(photoId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  if (!pid) return null;

  const meta = readMeta(id);
  const entry = meta[pid];
  let raw: { buf: Buffer; mime: string } | null = null;

  if (entry?.s3_key) {
    const cfg = s3ConfigFromEnv();
    if (!cfg) throw new Error('S3 не настроен');
    try {
      const got = await s3GetObject(cfg, entry.s3_key);
      raw = {
        buf: got.body,
        mime: entry.mime || got.contentType || 'application/octet-stream',
      };
    } catch {
      raw = null;
    }
  }

  if (!raw) raw = findLocalPhoto(id, pid);
  if (!raw) return null;

  const m = String(raw.mime || '').toLowerCase();
  if (isHeifBuffer(raw.buf) || m.includes('heic') || m.includes('heif')) {
    return ensureStsJpeg(raw.buf, raw.mime);
  }
  return raw;
}

export async function saveDealCarPhoto(
  dealId: string,
  buf: Buffer,
  mime?: string,
  side?: string
): Promise<DealCarPhoto> {
  if (!buf?.length) throw new Error('Пустое фото');
  if (buf.length > MAX_FILE_BYTES) throw new Error('Фото больше 12 МБ');
  const cfg = s3ConfigFromEnv();
  if (!cfg) throw new Error('S3 не настроен (S3_ENDPOINT / BUCKET / ACCESS_KEY / SECRET_KEY)');

  const existing = listDealCarPhotos(dealId);
  if (existing.length >= MAX_PHOTOS) {
    throw new Error(`Уже ${MAX_PHOTOS} фото — удалите лишние`);
  }

  const id = safeDealId(dealId);
  const store = detectStoreExt(buf, mime);
  if (store.ext === 'bin') {
    throw new Error('Нужен файл изображения (JPEG/PNG/WebP/HEIC)');
  }

  const pid = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  const s3Key = `deal-car-photos/${id}/${pid}.${store.ext}`;
  await s3PutObject(cfg, s3Key, buf, store.mime, false);

  const sideNorm = normalizeSide(side);
  const createdAt = new Date().toISOString();
  const meta = readMeta(id);
  meta[pid] = {
    ...(sideNorm ? { side: sideNorm } : {}),
    s3_key: s3Key,
    mime: store.mime,
    size: buf.length,
    created_at: createdAt,
  };
  writeMeta(id, meta);

  return {
    id: pid,
    mime: store.mime,
    size: buf.length,
    created_at: createdAt,
    url: photoUrl(id, pid),
    side: sideNorm,
    side_label: sideLabel(sideNorm) || undefined,
    storage: 's3',
  };
}

export async function deleteDealCarPhoto(dealId: string, photoId: string): Promise<boolean> {
  const id = safeDealId(dealId);
  const pid = String(photoId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  if (!pid) return false;

  const meta = readMeta(id);
  const entry = meta[pid];
  let deleted = false;

  if (entry?.s3_key) {
    const cfg = s3ConfigFromEnv();
    if (cfg) {
      try {
        await s3DeleteObject(cfg, entry.s3_key);
        deleted = true;
      } catch (e) {
        console.warn(
          `[car-photos] S3 delete ${entry.s3_key}: ${e instanceof Error ? e.message : e}`
        );
      }
    }
  }

  const dir = dealCarPhotosDir(id);
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

  if (meta[pid]) {
    delete meta[pid];
    writeMeta(id, meta);
    deleted = true;
  }

  return deleted;
}
