/**
 * Размеры изображения из буфера (без sharp).
 * Учитывает EXIF Orientation у JPEG (поворот 5–8 → swap width/height).
 */

export type ImageSize = {
  width: number;
  height: number;
  orientation: 'landscape' | 'portrait' | 'square';
};

function orient(w: number, h: number): ImageSize['orientation'] {
  if (w === h) return 'square';
  return w > h ? 'landscape' : 'portrait';
}

function sizeOf(w: number, h: number): ImageSize | null {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;
  return { width: w, height: h, orientation: orient(w, h) };
}

/** JPEG EXIF Orientation: 5–8 означают поворот на 90° — меняем стороны. */
function jpegExifOrientation(buf: Buffer): number {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) break;
    // APP1 EXIF
    if (marker === 0xe1) {
      const start = i + 4;
      if (buf.toString('ascii', start, start + 4) !== 'Exif') return 1;
      const tiff = start + 6;
      if (tiff + 8 > buf.length) return 1;
      const le = buf.toString('ascii', tiff, tiff + 2) === 'II';
      const read16 = (off: number) => (le ? buf.readUInt16LE(off) : buf.readUInt16BE(off));
      const read32 = (off: number) => (le ? buf.readUInt32LE(off) : buf.readUInt32BE(off));
      const ifd0 = tiff + read32(tiff + 4);
      if (ifd0 + 2 > buf.length) return 1;
      const count = read16(ifd0);
      for (let e = 0; e < count; e++) {
        const entry = ifd0 + 2 + e * 12;
        if (entry + 12 > buf.length) break;
        const tag = read16(entry);
        if (tag === 0x0112) {
          // Orientation — SHORT, value in offset field for count=1
          return read16(entry + 8) || 1;
        }
      }
      return 1;
    }
    // SOF markers — stop scanning APP after we passed them without EXIF? continue until SOS
    if (marker === 0xda) break; // SOS
    i += 2 + len;
  }
  return 1;
}

function jpegSize(buf: Buffer): ImageSize | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  let w = 0;
  let h = 0;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) break;
    // SOF0–SOF3, SOF5–SOF7, SOF9–SOF11, SOF13–SOF15
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      h = buf.readUInt16BE(i + 5);
      w = buf.readUInt16BE(i + 7);
      break;
    }
    i += 2 + len;
  }
  if (!w || !h) return null;
  const ori = jpegExifOrientation(buf);
  if (ori >= 5 && ori <= 8) {
    const t = w;
    w = h;
    h = t;
  }
  return sizeOf(w, h);
}

function pngSize(buf: Buffer): ImageSize | null {
  if (buf.length < 24) return null;
  if (buf.toString('ascii', 1, 4) !== 'PNG') return null;
  // IHDR at offset 16
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return sizeOf(w, h);
}

function gifSize(buf: Buffer): ImageSize | null {
  if (buf.length < 10) return null;
  const sig = buf.toString('ascii', 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  return sizeOf(buf.readUInt16LE(6), buf.readUInt16LE(8));
}

function webpSize(buf: Buffer): ImageSize | null {
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && buf.length >= 30) {
    const w = 1 + buf[24] + (buf[25] << 8) + (buf[26] << 16);
    const h = 1 + buf[27] + (buf[28] << 8) + (buf[29] << 16);
    return sizeOf(w, h);
  }
  if (chunk === 'VP8 ' && buf.length >= 30) {
    // lossy: frame header after 10 bytes of VP8 chunk payload start
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return sizeOf(w, h);
  }
  if (chunk === 'VP8L' && buf.length >= 25) {
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    const w = 1 + (((b1 & 0x3f) << 8) | b0);
    const h = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return sizeOf(w, h);
  }
  return null;
}

export function readImageSize(buf: Buffer): ImageSize | null {
  if (!buf || buf.length < 16) return null;
  return jpegSize(buf) || pngSize(buf) || gifSize(buf) || webpSize(buf);
}

export const ORIENT_RU: Record<ImageSize['orientation'], string> = {
  landscape: 'Горизонтальное',
  portrait: 'Вертикальное',
  square: 'Квадрат',
};
