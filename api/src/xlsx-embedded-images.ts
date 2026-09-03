/**
 * Извлечение встроенных картинок Excel (xl/media + drawings) → Map<rowIndex, image>.
 * Строка = 0-based индекс листа (как в sheet_to_json).
 */
import * as XLSX from 'xlsx';

export type EmbeddedImage = {
  buf: Buffer;
  ext: string;
  mime: string;
};

function mimeExt(name: string): { ext: string; mime: string } {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return { ext: 'png', mime: 'image/png' };
  if (lower.endsWith('.gif')) return { ext: 'gif', mime: 'image/gif' };
  if (lower.endsWith('.webp')) return { ext: 'webp', mime: 'image/webp' };
  if (lower.endsWith('.bmp')) return { ext: 'bmp', mime: 'image/bmp' };
  return { ext: 'jpg', mime: 'image/jpeg' };
}

function fileContent(
  files: Record<string, { content?: Buffer | string; data?: Buffer | string }>,
  key: string
): Buffer | null {
  const ent = files[key] || files['/' + key] || files[key.replace(/^\//, '')];
  if (!ent) return null;
  const raw = ent.content ?? ent.data;
  if (!raw) return null;
  return Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
}

function resolvePath(baseDir: string, target: string): string {
  const t = target.replace(/\\/g, '/');
  if (t.startsWith('/')) return t.replace(/^\//, '');
  const base = baseDir.replace(/\/$/, '').split('/');
  for (const part of t.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return base.join('/');
}

/** row (0-based) → первая подходящая картинка в строке. */
export function extractXlsxImagesByRow(xlsxBuf: Buffer): Map<number, EmbeddedImage> {
  const out = new Map<number, EmbeddedImage>();
  let wb: XLSX.WorkBook & { files?: Record<string, { content?: Buffer; data?: Buffer }> };
  try {
    wb = XLSX.read(xlsxBuf, { type: 'buffer', bookFiles: true }) as typeof wb;
  } catch {
    return out;
  }
  const files = wb.files || {};
  const drawingXmlKeys = Object.keys(files).filter(
    (k) => /xl\/drawings\/drawing\d+\.xml$/i.test(k) && !k.includes('_rels')
  );
  for (const drawingKey of drawingXmlKeys) {
    const xmlBuf = fileContent(files, drawingKey);
    if (!xmlBuf) continue;
    const xml = xmlBuf.toString('utf8');
    const relKey =
      drawingKey.replace(/drawings\/(drawing\d+\.xml)$/i, 'drawings/_rels/$1.rels') ||
      `${drawingKey}.rels`;
    const relBuf = fileContent(files, relKey);
    const ridToMedia = new Map<string, string>();
    if (relBuf) {
      const relXml = relBuf.toString('utf8');
      for (const m of relXml.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/gi)) {
        const abs = resolvePath('xl/drawings', m[2]!.replace(/^\//, ''));
        ridToMedia.set(m[1]!, abs.startsWith('xl/') ? abs : `xl/drawings/${m[2]}`.replace(/\/+/g, '/'));
        // normalize ../media/
        if (m[2]!.includes('media/')) {
          const mediaName = m[2]!.replace(/^.*media\//, '');
          ridToMedia.set(m[1]!, `xl/media/${mediaName}`);
        }
      }
    }
    // oneCellAnchor / twoCellAnchor blocks
    const anchors = [
      ...xml.matchAll(/<xdr:oneCellAnchor\b[\s\S]*?<\/xdr:oneCellAnchor>/gi),
      ...xml.matchAll(/<xdr:twoCellAnchor\b[\s\S]*?<\/xdr:twoCellAnchor>/gi),
    ];
    for (const a of anchors) {
      const block = a[0]!;
      const from = block.match(/<xdr:from>([\s\S]*?)<\/xdr:from>/i);
      if (!from) continue;
      const rowM = from[1]!.match(/<xdr:row>(\d+)<\/xdr:row>/i);
      const colM = from[1]!.match(/<xdr:col>(\d+)<\/xdr:col>/i);
      if (!rowM) continue;
      const row = Number(rowM[1]);
      if (!Number.isFinite(row) || row < 0) continue;
      if (out.has(row)) continue; // первая картинка строки
      const embed = block.match(/r:embed="(rId\d+)"/i);
      if (!embed) continue;
      const mediaPath = ridToMedia.get(embed[1]!);
      if (!mediaPath) continue;
      const imgBuf = fileContent(files, mediaPath);
      if (!imgBuf || imgBuf.length < 32) continue;
      // skip tiny icons / emf if not image magic
      const isJpeg = imgBuf[0] === 0xff && imgBuf[1] === 0xd8;
      const isPng = imgBuf[0] === 0x89 && imgBuf[1] === 0x50;
      const isGif = imgBuf[0] === 0x47 && imgBuf[1] === 0x49;
      const isWebp = imgBuf.toString('ascii', 0, 4) === 'RIFF';
      if (!isJpeg && !isPng && !isGif && !isWebp) continue;
      const { ext, mime } = mimeExt(mediaPath);
      out.set(row, { buf: imgBuf, ext: isPng ? 'png' : isGif ? 'gif' : isWebp ? 'webp' : ext, mime });
    }
  }
  return out;
}
