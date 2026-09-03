/**
 * Логотип компании на печатных бланках (PDF / HTML).
 * Краснодар (ИП Безматерных) — Fogel; Москва (ИП Безматерных Р.П.) — Пневмоподвеска.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error no types for svg-to-pdfkit
import SVGtoPDF from 'svg-to-pdfkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** ИНН ИП Безматерных М.П. (Краснодар / Fogel / Стрела). */
export const ORG_INN_FOGEL = '231295963240';
/** ИНН ИП Безматерных Р.П. (Москва / Пневмоподвеска). */
export const ORG_INN_PNEVMO = '231215603728';

export type OrgLogoBrand = 'fogel' | 'pnevmo';

export function orgLogoBrandByInn(inn?: string): OrgLogoBrand {
  const d = String(inn || '').replace(/\D/g, '');
  return d === ORG_INN_FOGEL ? 'fogel' : 'pnevmo';
}

export function orgLogoPublicPath(inn?: string): string {
  return orgLogoBrandByInn(inn) === 'fogel' ? '/logo-fogel.svg' : '/logo-pnevmopodveska.svg';
}

function logoAssetFile(brand: OrgLogoBrand): string {
  return brand === 'fogel' ? 'logo-fogel.svg' : 'org-logo.svg';
}

export function resolveOrgLogoSvgPath(orgInn?: string): string | null {
  const brand = orgLogoBrandByInn(orgInn);
  const asset = logoAssetFile(brand);
  const webFallback =
    brand === 'fogel' ? 'logo-fogel.svg' : 'logo-pnevmopodveska.svg';
  const candidates = [
    path.resolve(__dirname, '..', 'assets', asset),
    path.resolve(__dirname, '..', '..', 'web', 'public', webFallback),
    path.resolve(__dirname, '..', '..', 'web', 'dist', webFallback),
    `/root/1c_pnevmopodveska1_ru/warehouse/api/assets/${asset}`,
    `/root/1c_pnevmopodveska1_ru/warehouse/web/dist/${webFallback}`,
    `/root/1c_pnevmopodveska1_ru/warehouse/web/public/${webFallback}`,
    // legacy: один файл org-logo.svg = Пневмоподвеска
    ...(brand === 'pnevmo'
      ? [
          path.resolve(__dirname, '..', 'assets', 'org-logo.svg'),
          '/root/1c_pnevmopodveska1_ru/warehouse/api/assets/org-logo.svg',
        ]
      : []),
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

export function readOrgLogoSvg(orgInn?: string): string | null {
  const p = resolveOrgLogoSvgPath(orgInn);
  if (!p) return null;
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Рисует логотип и сдвигает курсор вниз.
 * @returns y после логотипа
 */
export function drawOrgLogoPdf(
  doc: PDFKit.PDFDocument,
  opts?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    align?: 'left' | 'right';
    gapBelow?: number;
    orgInn?: string;
  }
): number {
  const svg = readOrgLogoSvg(opts?.orgInn);
  const width = opts?.width ?? 155;
  const height = opts?.height ?? 22;
  const gap = opts?.gapBelow ?? 8;
  const y = opts?.y ?? doc.y;
  let x = opts?.x ?? doc.page.margins.left;
  if (opts?.align === 'right') {
    x = doc.page.width - doc.page.margins.right - width;
  }
  if (!svg) {
    doc.x = doc.page.margins.left;
    doc.y = y;
    return y;
  }
  try {
    SVGtoPDF(doc, svg, x, y, {
      width,
      height,
      preserveAspectRatio: 'xMinYMid meet',
    });
  } catch (e) {
    console.warn('org-logo pdf:', e instanceof Error ? e.message : e);
    doc.x = doc.page.margins.left;
    doc.y = y;
    return y;
  }
  doc.x = doc.page.margins.left;
  doc.y = y + height + gap;
  return doc.y;
}

/** HTML-блок логотипа для бланков печати. */
export function orgLogoHtml(opts?: { height?: number; orgInn?: string }): string {
  const h = Math.max(16, Number(opts?.height) || 28);
  const src = orgLogoPublicPath(opts?.orgInn);
  return `<div class="doc-logo"><img src="${src}" alt="" height="${h}" /></div>`;
}
