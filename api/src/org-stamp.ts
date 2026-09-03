/**
 * Печать и факсимиле подписи организации на бланках PDF / HTML.
 * 1) Загруженные сканы: data/org-stamps/{inn}-stamp.png | {inn}-sign.png
 * 2) Встроенные: api/assets/stamps/bezmaternykh-{mp|rp}.png — по ИНН
 *
 * ?stamps=0 / ?signs=0 — выключить печать / подпись отдельно.
 * ?stamps=0 без ?signs — оба выкл (старое поведение).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type FacsimileFlags = { stamp: boolean; sign: boolean };

const facsimileStore = new AsyncLocalStorage<FacsimileFlags>();

function flagsOrDefault(): FacsimileFlags {
  return facsimileStore.getStore() || { stamp: true, sign: true };
}

export function orgStampEnabled(): boolean {
  return flagsOrDefault().stamp;
}

export function orgSignEnabled(): boolean {
  return flagsOrDefault().sign;
}

/** true, если включено хотя бы одно из факсимиле (для старых вызовов). */
export function orgFacsimileEnabled(): boolean {
  const f = flagsOrDefault();
  return f.stamp || f.sign;
}

export function runWithOrgFacsimile<T>(
  enabled: boolean | Partial<FacsimileFlags>,
  fn: () => T
): T {
  const flags =
    typeof enabled === 'boolean'
      ? { stamp: !!enabled, sign: !!enabled }
      : {
          stamp: enabled.stamp !== false,
          sign: enabled.sign !== false,
        };
  return facsimileStore.run(flags, fn);
}

export async function runWithOrgFacsimileAsync<T>(
  enabled: boolean | Partial<FacsimileFlags>,
  fn: () => Promise<T>
): Promise<T> {
  const flags =
    typeof enabled === 'boolean'
      ? { stamp: !!enabled, sign: !!enabled }
      : {
          stamp: enabled.stamp !== false,
          sign: enabled.sign !== false,
        };
  return facsimileStore.run(flags, fn);
}

/** Query flag: пусто → true; 0/false/no/off → false. */
export function parseOrgFacsimileQuery(raw: string | undefined | null): boolean {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return true;
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off' || v === 'without');
}

/** Разобрать ?stamps= и ?signs= из query. */
export function parseOrgFacsimileFlags(query: {
  stamps?: string;
  seal?: string;
  facsimile?: string;
  signs?: string;
  sign?: string;
}): FacsimileFlags {
  const combined = query.stamps ?? query.seal ?? query.facsimile;
  const hasSeparateSign = query.signs != null || query.sign != null;
  if (combined != null && combined !== '' && !hasSeparateSign) {
    const on = parseOrgFacsimileQuery(combined);
    return { stamp: on, sign: on };
  }
  const stamp = parseOrgFacsimileQuery(query.stamps ?? query.seal ?? query.facsimile);
  const sign = parseOrgFacsimileQuery(query.signs ?? query.sign ?? query.stamps ?? '1');
  return { stamp, sign };
}

export type OrgPrintAssetKind = 'stamp' | 'sign';

const BUNDLED_STAMP_BY_INN: Record<string, string> = {
  '231215603728': 'bezmaternykh-rp.png',
  '231295963240': 'bezmaternykh-mp.png',
};

function normalizeInn(inn?: string | null): string {
  return String(inn || '')
    .replace(/\D/g, '')
    .trim();
}

function dataDir(): string {
  return (
    process.env.WMS_DATA_DIR ||
    path.resolve(__dirname, '..', '..', 'data')
  );
}

export function orgStampsDir(): string {
  const dir = path.join(dataDir(), 'org-stamps');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function orgPrintAssetPath(inn: string | null | undefined, kind: OrgPrintAssetKind): string {
  const key = normalizeInn(inn) || 'default';
  return path.join(orgStampsDir(), `${key}-${kind}.png`);
}

export function hasOrgPrintAsset(inn: string | null | undefined, kind: OrgPrintAssetKind): boolean {
  try {
    return fs.existsSync(orgPrintAssetPath(inn, kind));
  } catch {
    return false;
  }
}

/** Сохранить PNG/JPEG/WebP скан → PNG на диск. */
export function saveOrgPrintAsset(
  inn: string | null | undefined,
  kind: OrgPrintAssetKind,
  buf: Buffer
): { ok: true; path: string; inn: string } {
  const key = normalizeInn(inn);
  if (!key) throw new Error('Сначала укажите ИНН организации');
  if (!buf?.length) throw new Error('Пустой файл');
  if (buf.length > 8 * 1024 * 1024) throw new Error('Файл больше 8 МБ');
  const dest = orgPrintAssetPath(key, kind);
  // принимаем уже png/jpeg как есть — PDFKit читает оба; для единообразия пишем как пришло с .png именем
  fs.writeFileSync(dest, buf);
  return { ok: true, path: dest, inn: key };
}

export function deleteOrgPrintAsset(
  inn: string | null | undefined,
  kind: OrgPrintAssetKind
): boolean {
  const p = orgPrintAssetPath(inn, kind);
  try {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function bundledStampPath(inn?: string | null): string | null {
  const file = BUNDLED_STAMP_BY_INN[normalizeInn(inn)];
  if (!file) return null;
  const candidates = [
    path.resolve(__dirname, '..', 'assets', 'stamps', file),
    path.resolve(__dirname, '..', '..', 'web', 'public', 'stamps', file),
    path.resolve(__dirname, '..', '..', 'web', 'dist', 'stamps', file),
    `/root/1c_pnevmopodveska1_ru/warehouse/api/assets/stamps/${file}`,
    `/root/1c_pnevmopodveska1_ru/warehouse/web/dist/stamps/${file}`,
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function resolveOrgStampPngPath(inn?: string | null): string | null {
  const custom = orgPrintAssetPath(inn, 'stamp');
  try {
    if (fs.existsSync(custom)) return custom;
  } catch {
    /* ignore */
  }
  return bundledStampPath(inn);
}

export function resolveOrgSignPngPath(inn?: string | null): string | null {
  const custom = orgPrintAssetPath(inn, 'sign');
  try {
    if (fs.existsSync(custom)) return custom;
  } catch {
    /* ignore */
  }
  return null;
}

/** Публичный URL для бланков / превью (без cookie). */
export function orgStampPublicUrl(inn?: string | null): string | null {
  if (!resolveOrgStampPngPath(inn)) return null;
  const key = normalizeInn(inn);
  if (!key) return null;
  const v = hasOrgPrintAsset(key, 'stamp') ? 'u' : 'b';
  return `/api/public/org-assets/${encodeURIComponent(key)}/stamp.png?v=${v}`;
}

export function orgSignPublicUrl(inn?: string | null): string | null {
  if (!resolveOrgSignPngPath(inn)) return null;
  const key = normalizeInn(inn);
  if (!key) return null;
  return `/api/public/org-assets/${encodeURIComponent(key)}/sign.png?v=u`;
}

export function orgStampHtml(
  inn?: string | null,
  opts?: { size?: number; sizeMm?: number; className?: string }
): string {
  if (!orgStampEnabled()) return '';
  const url = orgStampPublicUrl(inn);
  if (!url) return '';
  const cls = opts?.className ? ` class="${opts.className}"` : ' class="org-stamp"';
  // Физический размер печати ИП ≈ 38–40 мм; в px — запасной вариант для экрана.
  const mm = Number(opts?.sizeMm);
  if (Number.isFinite(mm) && mm > 0) {
    const m = Math.min(48, Math.max(28, mm));
    return `<img${cls} src="${url}" alt="М.П." style="width:${m}mm;height:${m}mm;object-fit:contain" />`;
  }
  const size = Math.max(48, Number(opts?.size) || 120);
  return `<img${cls} src="${url}" alt="М.П." width="${size}" height="${size}" style="width:${size}px;height:${size}px;object-fit:contain" />`;
}

export function orgSignHtml(
  inn?: string | null,
  opts?: { height?: number; heightMm?: number; className?: string }
): string {
  if (!orgSignEnabled()) return '';
  const url = orgSignPublicUrl(inn);
  if (!url) return '';
  const cls = opts?.className ? ` class="${opts.className}"` : ' class="org-sign"';
  const mm = Number(opts?.heightMm);
  if (Number.isFinite(mm) && mm > 0) {
    const h = Math.min(22, Math.max(8, mm));
    return `<img${cls} src="${url}" alt="Подпись" style="height:${h}mm;width:auto;max-width:55mm;object-fit:contain" />`;
  }
  const h = Math.max(28, Number(opts?.height) || 48);
  return `<img${cls} src="${url}" alt="Подпись" height="${h}" style="height:${h}px;width:auto;max-width:180px;object-fit:contain" />`;
}

/** CSS для блока «подпись на линии + печать у М.П.» (договоры / бланки). */
export function orgFacsimileCss(): string {
  return `
    .org-facsimile { position: relative; margin-top: 8px; min-height: 36mm; padding: 2mm 0 4mm; page-break-inside: avoid; }
    .org-facsimile-line { position: relative; min-height: 14mm; padding-top: 10mm; padding-left: 2mm; font-size: 11pt; }
    .org-facsimile-line .org-sign {
      position: absolute; left: 2mm; bottom: 3mm; height: 12mm; width: auto; max-width: 48mm;
      object-fit: contain; pointer-events: none; opacity: 0.95; z-index: 2;
    }
    .org-facsimile-mp { position: relative; margin-top: 4mm; min-height: 24mm; padding-left: 2mm; font-size: 10pt; color: #333; }
    .org-facsimile-mp .org-stamp {
      position: absolute; left: 55mm; top: -18mm; width: 38mm; height: 38mm;
      object-fit: contain; pointer-events: none; opacity: 0.88; z-index: 1;
    }
  `;
}

/** Подпись на линии + печать у «М.П.» (исполнитель). */
export function orgFacsimileSignBlockHtml(
  inn: string | null | undefined,
  opts?: { name?: string; mpLabel?: string }
): string {
  const name = String(opts?.name || '').trim() || '________________';
  const mp = String(opts?.mpLabel || 'М.П.').trim();
  return `<div class="org-facsimile">
  <div class="org-facsimile-line">
    ${orgSignHtml(inn, { heightMm: 12 })}
    _______________ / ${escAttr(name)} /
  </div>
  <div class="org-facsimile-mp">
    ${orgStampHtml(inn, { sizeMm: 38 })}
    ${escAttr(mp)}
  </div>
</div>`;
}

function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function drawOrgStampPdf(
  doc: PDFKit.PDFDocument,
  inn: string | null | undefined,
  opts?: { x?: number; y?: number; size?: number; opacity?: number }
): boolean {
  if (!orgStampEnabled()) return false;
  const p = resolveOrgStampPngPath(inn);
  if (!p) return false;
  // ~38 мм на A4 при 72 pt/inch ≈ 108 pt
  const size = opts?.size ?? 108;
  const x = opts?.x ?? doc.x;
  const y = opts?.y ?? doc.y;
  const opacity = opts?.opacity ?? 0.9;
  try {
    doc.save();
    if (opacity < 1) doc.opacity(opacity);
    doc.image(p, x, y, { width: size, height: size });
    doc.restore();
    return true;
  } catch (e) {
    console.warn('org-stamp pdf:', e instanceof Error ? e.message : e);
    try {
      doc.restore();
    } catch {
      /* ignore */
    }
    return false;
  }
}

export function drawOrgSignPdf(
  doc: PDFKit.PDFDocument,
  inn: string | null | undefined,
  opts?: { x?: number; y?: number; width?: number; height?: number; opacity?: number }
): boolean {
  if (!orgSignEnabled()) return false;
  const p = resolveOrgSignPngPath(inn);
  if (!p) return false;
  const width = opts?.width ?? 110;
  const height = opts?.height ?? 42;
  const x = opts?.x ?? doc.x;
  const y = opts?.y ?? doc.y;
  const opacity = opts?.opacity ?? 0.95;
  try {
    doc.save();
    if (opacity < 1) doc.opacity(opacity);
    doc.image(p, x, y, { fit: [width, height], align: 'center', valign: 'center' });
    doc.restore();
    return true;
  } catch (e) {
    console.warn('org-sign pdf:', e instanceof Error ? e.message : e);
    try {
      doc.restore();
    } catch {
      /* ignore */
    }
    return false;
  }
}

export function orgPrintAssetsMeta(inn?: string | null): {
  stamp_url: string | null;
  signature_url: string | null;
  has_stamp: boolean;
  has_signature: boolean;
  stamp_source: 'upload' | 'bundled' | null;
} {
  const key = normalizeInn(inn);
  const hasUploadStamp = hasOrgPrintAsset(key, 'stamp');
  const stampPath = resolveOrgStampPngPath(key);
  return {
    stamp_url: orgStampPublicUrl(key),
    signature_url: orgSignPublicUrl(key),
    has_stamp: Boolean(stampPath),
    has_signature: hasOrgPrintAsset(key, 'sign'),
    stamp_source: hasUploadStamp ? 'upload' : stampPath ? 'bundled' : null,
  };
}
