/**
 * Фото СТС по сделке — локально в data/sts/{dealId}/ (не в публичный S3: ПДн).
 * iPhone часто шлёт HEIC с mime image/jpeg — конвертируем в настоящий JPEG для браузера и OCR.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import convertHeic from 'heic-convert';

export type StsSide = 'front' | 'back';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function dataDir(): string {
  return process.env.WMS_DATA_DIR || path.resolve(__dirname, '..', '..', 'data');
}

/** HEIF/HEIC по сигнатуре ftyp (даже если файл назван .jpg). */
export function isHeifBuffer(buf: Buffer): boolean {
  if (!buf || buf.length < 12) return false;
  if (buf.slice(4, 8).toString('ascii') !== 'ftyp') return false;
  const brands = buf.slice(8, Math.min(buf.length, 32)).toString('ascii').toLowerCase();
  return /heic|heif|mif1|msf1|hevx|heim|heis/.test(brands);
}

/** Привести буфер к JPEG, если это HEIC/HEIF. */
export async function ensureStsJpeg(
  buf: Buffer,
  mime?: string
): Promise<{ buf: Buffer; mime: string }> {
  const m = String(mime || '').toLowerCase();
  const looksHeif = isHeifBuffer(buf) || m.includes('heic') || m.includes('heif');
  if (!looksHeif) {
    return { buf, mime: m && m.startsWith('image/') ? m : 'image/jpeg' };
  }
  const out = await convertHeic({
    buffer: buf,
    format: 'JPEG',
    quality: 0.88,
  });
  return { buf: Buffer.from(out), mime: 'image/jpeg' };
}

export function stsDealDir(dealId: string): string {
  const id = String(dealId || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!id) throw new Error('deal_id required');
  const dir = path.join(dataDir(), 'sts', id);
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
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (e === 'png') return 'image/png';
  if (e === 'webp') return 'image/webp';
  if (e === 'gif') return 'image/gif';
  return 'image/jpeg';
}

function findSideFile(dir: string, side: StsSide): string | null {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
    const p = path.join(dir, `${side}.${ext}`);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function hasStsImage(dealId: string, side: StsSide): boolean {
  try {
    return Boolean(findSideFile(stsDealDir(dealId), side));
  } catch {
    return false;
  }
}

export function stsMediaInfo(dealId: string): {
  front: boolean;
  back: boolean;
  front_url: string;
  back_url: string;
} {
  const id = String(dealId || '').trim();
  const front = id ? hasStsImage(id, 'front') : false;
  const back = id ? hasStsImage(id, 'back') : false;
  const base = `/api/crm/deals/${encodeURIComponent(id)}/vehicle/sts/`;
  return {
    front,
    back,
    front_url: front ? base + 'front' : '',
    back_url: back ? base + 'back' : '',
  };
}

/** Сохранить фото стороны СТС (перезаписывает предыдущее). HEIC → JPEG. */
export async function saveStsImage(
  dealId: string,
  side: StsSide,
  buf: Buffer,
  mime?: string
): Promise<{ side: StsSide; path: string; mime: string; size: number }> {
  if (!buf?.length) throw new Error('Пустое фото СТС');
  if (buf.length > 12 * 1024 * 1024) throw new Error('Фото СТС больше 12 МБ');
  const normalized = await ensureStsJpeg(buf, mime);
  const dir = stsDealDir(dealId);
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']) {
    const old = path.join(dir, `${side}.${ext}`);
    try {
      if (fs.existsSync(old)) fs.unlinkSync(old);
    } catch {
      /* ignore */
    }
  }
  const ext = extForMime(normalized.mime);
  const dest = path.join(dir, `${side}.${ext}`);
  fs.writeFileSync(dest, normalized.buf);
  return { side, path: dest, mime: mimeForExt(ext), size: normalized.buf.length };
}

export function readStsImage(
  dealId: string,
  side: StsSide
): { buf: Buffer; mime: string } | null {
  try {
    const p = findSideFile(stsDealDir(dealId), side);
    if (!p) return null;
    const ext = path.extname(p).slice(1);
    return { buf: fs.readFileSync(p), mime: mimeForExt(ext) };
  } catch {
    return null;
  }
}

/** Прочитать фото; HEIC на диске → JPEG и перезапись. */
export async function readStsImageNormalized(
  dealId: string,
  side: StsSide
): Promise<{ buf: Buffer; mime: string } | null> {
  const raw = readStsImage(dealId, side);
  if (!raw) return null;
  if (!isHeifBuffer(raw.buf)) return raw;
  const normalized = await ensureStsJpeg(raw.buf, raw.mime);
  await saveStsImage(dealId, side, normalized.buf, normalized.mime);
  return normalized;
}

/**
 * Распределить фото по сторонам: сначала метки модели, затем свободные слоты по порядку.
 */
export function assignStsSides(
  labels: Array<'front' | 'back' | 'unknown'>,
  count: number
): Array<StsSide | null> {
  const n = Math.max(0, Math.min(count, labels.length || count));
  const out: Array<StsSide | null> = Array.from({ length: n }, () => null);
  let frontTaken = false;
  let backTaken = false;
  for (let i = 0; i < n; i++) {
    const lab = labels[i] || 'unknown';
    if (lab === 'front' && !frontTaken) {
      out[i] = 'front';
      frontTaken = true;
    } else if (lab === 'back' && !backTaken) {
      out[i] = 'back';
      backTaken = true;
    }
  }
  for (let i = 0; i < n; i++) {
    if (out[i]) continue;
    if (!frontTaken) {
      out[i] = 'front';
      frontTaken = true;
    } else if (!backTaken) {
      out[i] = 'back';
      backTaken = true;
    }
  }
  return out;
}
