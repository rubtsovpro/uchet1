/**
 * Логотип компании на печатных бланках (PDF / HTML).
 * Файл: api/assets/org-logo.svg (копия web/public/logo-pnevmopodveska.svg).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error no types for svg-to-pdfkit
import SVGtoPDF from 'svg-to-pdfkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveOrgLogoSvgPath(): string | null {
  const candidates = [
    path.resolve(__dirname, '..', 'assets', 'org-logo.svg'),
    path.resolve(__dirname, '..', '..', 'web', 'public', 'logo-pnevmopodveska.svg'),
    path.resolve(__dirname, '..', '..', 'web', 'dist', 'logo-pnevmopodveska.svg'),
    '/root/1c_pnevmopodveska1_ru/warehouse/api/assets/org-logo.svg',
    '/root/1c_pnevmopodveska1_ru/warehouse/web/dist/logo-pnevmopodveska.svg',
    '/root/1c_pnevmopodveska1_ru/warehouse/web/public/logo-pnevmopodveska.svg',
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

export function readOrgLogoSvg(): string | null {
  const p = resolveOrgLogoSvgPath();
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
  }
): number {
  const svg = readOrgLogoSvg();
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
export function orgLogoHtml(opts?: { height?: number }): string {
  const h = Math.max(16, Number(opts?.height) || 28);
  return `<div class="doc-logo"><img src="/logo-pnevmopodveska.svg" alt="" height="${h}" /></div>`;
}
