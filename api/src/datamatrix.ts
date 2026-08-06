/**
 * Генерация Data Matrix (PNG / SVG) через bwip-js.
 * Для складских ШК (OZN…) и локальных кодов маркировки.
 * Официальные КМ Честного знака по-прежнему только из ЦРПТ.
 */
import bwipjs from 'bwip-js';

const MAX_TEXT = 2000;

export function normalizeDmText(raw: unknown): string {
  const t = String(raw ?? '').trim();
  if (!t) throw new Error('Пустой текст для Data Matrix');
  if (t.length > MAX_TEXT) throw new Error(`Слишком длинный текст (макс. ${MAX_TEXT})`);
  return t;
}

export async function renderDataMatrixPng(
  textRaw: unknown,
  opts?: { scale?: number; padding?: number }
): Promise<Buffer> {
  const text = normalizeDmText(textRaw);
  const scale = Math.min(12, Math.max(1, Number(opts?.scale) || 4));
  const padding = Math.min(20, Math.max(0, Number(opts?.padding) || 2));
  const png = await bwipjs.toBuffer({
    bcid: 'datamatrix',
    text,
    scale,
    paddingwidth: padding,
    paddingheight: padding,
    backgroundcolor: 'FFFFFF',
    includetext: false,
  });
  return png;
}

export async function renderDataMatrixSvg(
  textRaw: unknown,
  opts?: { scale?: number; padding?: number }
): Promise<string> {
  const text = normalizeDmText(textRaw);
  const scale = Math.min(12, Math.max(1, Number(opts?.scale) || 4));
  const padding = Math.min(20, Math.max(0, Number(opts?.padding) || 2));
  const svg = bwipjs.toSVG({
    bcid: 'datamatrix',
    text,
    scale,
    paddingwidth: padding,
    paddingheight: padding,
    backgroundcolor: 'FFFFFF',
    includetext: false,
  });
  return String(svg || '');
}

/** data-URL для встраивания в HTML этикеток без отдельного запроса. */
export async function dataMatrixDataUrl(textRaw: unknown, scale = 3): Promise<string> {
  const buf = await renderDataMatrixPng(textRaw, { scale });
  return `data:image/png;base64,${buf.toString('base64')}`;
}
