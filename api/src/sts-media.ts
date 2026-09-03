/**
 * Фото СТС по сделке — локально в data/sts/{dealId}/ (не в публичный S3: ПДн).
 * iPhone часто шлёт HEIC с mime image/jpeg — конвертируем в настоящий JPEG для браузера и OCR.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import convertHeic from 'heic-convert';
import jpegJs from 'jpeg-js';

export type StsSide = 'front' | 'back';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Ширина/высота превью в UI (~98×72 CSS, 2× retina). */
const THUMB_MAX_SIDE = 240;
const THUMB_JPEG_QUALITY = 58;

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

/** СТС конкретного авто в гараже контрагента (не общее на сделку). */
export function stsVehicleDir(vehicleId: string): string {
  const id = String(vehicleId || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!id) throw new Error('vehicle_id required');
  const dir = path.join(dataDir(), 'sts', 'vehicles', id);
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

function thumbPath(dir: string, side: StsSide): string {
  return path.join(dir, `${side}.thumb.jpg`);
}

function removeSideFiles(dir: string, side: StsSide): boolean {
  let hit = false;
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']) {
    const p = path.join(dir, `${side}.${ext}`);
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        hit = true;
      }
    } catch {
      /* ignore */
    }
  }
  try {
    const tp = thumbPath(dir, side);
    if (fs.existsSync(tp)) {
      fs.unlinkSync(tp);
      hit = true;
    }
  } catch {
    /* ignore */
  }
  return hit;
}

/**
 * Уменьшить JPEG до превью (лёгкий файл для списка миниатюр).
 * Не-JPEG → null (превью не строим).
 */
export function makeStsThumbJpeg(buf: Buffer, maxSide = THUMB_MAX_SIDE): Buffer | null {
  if (!buf?.length) return null;
  try {
    const decoded = jpegJs.decode(buf, { useTArray: true });
    const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height));
    const w = Math.max(1, Math.round(decoded.width * scale));
    const h = Math.max(1, Math.round(decoded.height * scale));
    let rgba: Buffer;
    if (scale < 0.999) {
      rgba = Buffer.alloc(w * h * 4);
      for (let y = 0; y < h; y++) {
        const sy = Math.min(decoded.height - 1, Math.floor(y / scale));
        for (let x = 0; x < w; x++) {
          const sx = Math.min(decoded.width - 1, Math.floor(x / scale));
          const si = (sy * decoded.width + sx) * 4;
          const di = (y * w + x) * 4;
          rgba[di] = decoded.data[si];
          rgba[di + 1] = decoded.data[si + 1];
          rgba[di + 2] = decoded.data[si + 2];
          rgba[di + 3] = 255;
        }
      }
    } else {
      rgba = Buffer.from(decoded.data);
    }
    const out = jpegJs.encode({ data: rgba, width: w, height: h }, THUMB_JPEG_QUALITY).data;
    return Buffer.from(out);
  } catch {
    return null;
  }
}

function writeThumbBeside(dir: string, side: StsSide, fullBuf: Buffer, mime: string): void {
  const m = String(mime || '').toLowerCase();
  const isJpeg =
    m.includes('jpeg') ||
    m.includes('jpg') ||
    (fullBuf.length >= 2 && fullBuf[0] === 0xff && fullBuf[1] === 0xd8);
  if (!isJpeg) return;
  const thumb = makeStsThumbJpeg(fullBuf);
  if (!thumb) return;
  try {
    fs.writeFileSync(thumbPath(dir, side), thumb);
  } catch {
    /* ignore */
  }
}

export function hasStsImage(dealId: string, side: StsSide): boolean {
  try {
    return Boolean(findSideFile(stsDealDir(dealId), side));
  } catch {
    return false;
  }
}

export function hasStsImageVehicle(vehicleId: string, side: StsSide): boolean {
  try {
    return Boolean(findSideFile(stsVehicleDir(vehicleId), side));
  } catch {
    return false;
  }
}

/** Удалить фото СТС со сделки (не трогает гараж авто). */
export function clearStsImagesForDeal(dealId: string): { removed: StsSide[] } {
  const removed: StsSide[] = [];
  try {
    const dir = stsDealDir(dealId);
    for (const side of ['front', 'back'] as const) {
      if (removeSideFiles(dir, side)) removed.push(side);
    }
  } catch {
    /* ignore */
  }
  return { removed };
}

export function stsMediaInfo(dealId: string): {
  front: boolean;
  back: boolean;
  front_url: string;
  back_url: string;
  front_thumb_url: string;
  back_thumb_url: string;
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
    front_thumb_url: front ? base + 'front?thumb=1' : '',
    back_thumb_url: back ? base + 'back?thumb=1' : '',
  };
}

export function stsMediaInfoForVehicle(vehicleId: string): {
  front: boolean;
  back: boolean;
  front_url: string;
  back_url: string;
  front_thumb_url: string;
  back_thumb_url: string;
} {
  const id = String(vehicleId || '').trim();
  const front = id ? hasStsImageVehicle(id, 'front') : false;
  const back = id ? hasStsImageVehicle(id, 'back') : false;
  const base = `/api/counterparties/vehicles/${encodeURIComponent(id)}/sts/`;
  return {
    front,
    back,
    front_url: front ? base + 'front' : '',
    back_url: back ? base + 'back' : '',
    front_thumb_url: front ? base + 'front?thumb=1' : '',
    back_thumb_url: back ? base + 'back?thumb=1' : '',
  };
}

async function writeSideToDir(
  dir: string,
  side: StsSide,
  buf: Buffer,
  mime?: string
): Promise<{ side: StsSide; path: string; mime: string; size: number }> {
  if (!buf?.length) throw new Error('Пустое фото СТС');
  if (buf.length > 12 * 1024 * 1024) throw new Error('Фото СТС больше 12 МБ');
  const normalized = await ensureStsJpeg(buf, mime);
  removeSideFiles(dir, side);
  const ext = extForMime(normalized.mime);
  const dest = path.join(dir, `${side}.${ext}`);
  fs.writeFileSync(dest, normalized.buf);
  writeThumbBeside(dir, side, normalized.buf, normalized.mime);
  return { side, path: dest, mime: mimeForExt(ext), size: normalized.buf.length };
}

/** Сохранить фото стороны СТС (перезаписывает предыдущее). HEIC → JPEG. */
export async function saveStsImage(
  dealId: string,
  side: StsSide,
  buf: Buffer,
  mime?: string
): Promise<{ side: StsSide; path: string; mime: string; size: number }> {
  return writeSideToDir(stsDealDir(dealId), side, buf, mime);
}

export async function saveStsImageVehicle(
  vehicleId: string,
  side: StsSide,
  buf: Buffer,
  mime?: string
): Promise<{ side: StsSide; path: string; mime: string; size: number }> {
  return writeSideToDir(stsVehicleDir(vehicleId), side, buf, mime);
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

export function readStsImageVehicle(
  vehicleId: string,
  side: StsSide
): { buf: Buffer; mime: string } | null {
  try {
    const p = findSideFile(stsVehicleDir(vehicleId), side);
    if (!p) return null;
    const ext = path.extname(p).slice(1);
    return { buf: fs.readFileSync(p), mime: mimeForExt(ext) };
  } catch {
    return null;
  }
}

function readThumbFromDir(
  dir: string,
  side: StsSide,
  full: { buf: Buffer; mime: string } | null
): { buf: Buffer; mime: string } | null {
  if (!full) return null;
  const tp = thumbPath(dir, side);
  try {
    const fullFile = findSideFile(dir, side);
    if (fs.existsSync(tp)) {
      const thumbStat = fs.statSync(tp);
      const fullStat = fullFile ? fs.statSync(fullFile) : null;
      if (!fullStat || thumbStat.mtimeMs >= fullStat.mtimeMs - 1000) {
        return { buf: fs.readFileSync(tp), mime: 'image/jpeg' };
      }
    }
  } catch {
    /* regenerate below */
  }
  writeThumbBeside(dir, side, full.buf, full.mime);
  try {
    if (fs.existsSync(tp)) return { buf: fs.readFileSync(tp), mime: 'image/jpeg' };
  } catch {
    /* ignore */
  }
  // fallback: если превью не собралось — не отдаём полный файл как «thumb»
  return null;
}

/** Лёгкое превью для миниатюр в UI (кэш *.thumb.jpg). */
export function readStsThumb(
  dealId: string,
  side: StsSide
): { buf: Buffer; mime: string } | null {
  try {
    const dir = stsDealDir(dealId);
    return readThumbFromDir(dir, side, readStsImage(dealId, side));
  } catch {
    return null;
  }
}

export function readStsThumbVehicle(
  vehicleId: string,
  side: StsSide
): { buf: Buffer; mime: string } | null {
  try {
    const dir = stsVehicleDir(vehicleId);
    return readThumbFromDir(dir, side, readStsImageVehicle(vehicleId, side));
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

export async function readStsImageNormalizedVehicle(
  vehicleId: string,
  side: StsSide
): Promise<{ buf: Buffer; mime: string } | null> {
  const raw = readStsImageVehicle(vehicleId, side);
  if (!raw) return null;
  if (!isHeifBuffer(raw.buf)) return raw;
  const normalized = await ensureStsJpeg(raw.buf, raw.mime);
  await saveStsImageVehicle(vehicleId, side, normalized.buf, normalized.mime);
  return normalized;
}

/** Скопировать СТС сделки → авто гаража (если у авто ещё нет стороны). */
export async function syncStsDealToVehicle(
  dealId: string,
  vehicleId: string,
  opts?: { overwrite?: boolean }
): Promise<{ copied: StsSide[] }> {
  const overwrite = !!opts?.overwrite;
  const copied: StsSide[] = [];
  for (const side of ['front', 'back'] as const) {
    if (!overwrite && hasStsImageVehicle(vehicleId, side)) continue;
    const img = await readStsImageNormalized(dealId, side);
    if (!img) continue;
    await saveStsImageVehicle(vehicleId, side, img.buf, img.mime);
    copied.push(side);
  }
  return { copied };
}

/** Скопировать СТС авто → сделку (для текущего ЗН / OCR). */
export async function syncStsVehicleToDeal(
  vehicleId: string,
  dealId: string,
  opts?: { overwrite?: boolean }
): Promise<{ copied: StsSide[] }> {
  const overwrite = opts?.overwrite !== false;
  const copied: StsSide[] = [];
  for (const side of ['front', 'back'] as const) {
    if (!overwrite && hasStsImage(dealId, side)) continue;
    const img = await readStsImageNormalizedVehicle(vehicleId, side);
    if (!img) continue;
    await saveStsImage(dealId, side, img.buf, img.mime);
    copied.push(side);
  }
  return { copied };
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
