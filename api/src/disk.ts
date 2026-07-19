/**
 * Свободное место на диске сервера + объём фото в БД (оценка S3).
 */
import fs from 'node:fs';
import { get } from './db.js';

export type DiskStats = {
  path: string;
  total_bytes: number;
  free_bytes: number;
  used_bytes: number;
  free_pct: number;
  free_human: string;
  used_human: string;
  total_human: string;
  media_bytes: number;
  media_human: string;
  media_images: number;
  /** Опциональная квота S3 из env S3_QUOTA_GB */
  s3_quota_bytes: number | null;
  s3_quota_human: string | null;
  s3_free_human: string | null;
};

function humanBytes(n: number): string {
  const v = Math.max(0, Number(n) || 0);
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i += 1;
  }
  const digits = i === 0 ? 0 : i === 1 ? 0 : 1;
  return `${x.toFixed(digits).replace(/\.0$/, '')} ${u[i]}`;
}

export function diskStats(path = process.env.WMS_DATA_DIR || '/'): DiskStats {
  let total = 0;
  let free = 0;
  try {
    const st = fs.statfsSync(path);
    total = Number(st.blocks) * Number(st.bsize);
    free = Number(st.bavail) * Number(st.bsize);
  } catch {
    try {
      const st = fs.statfsSync('/');
      total = Number(st.blocks) * Number(st.bsize);
      free = Number(st.bavail) * Number(st.bsize);
      path = '/';
    } catch {
      /* ignore */
    }
  }
  const used = Math.max(0, total - free);
  const freePct = total > 0 ? Math.round((free / total) * 1000) / 10 : 0;

  let mediaBytes = 0;
  let mediaImages = 0;
  try {
    const mediaRow = get<{ s: number; c: number }>(
      `SELECT COALESCE(SUM(size),0) AS s, COUNT(*) AS c FROM product_media WHERE kind = 'image'`
    );
    mediaBytes = Number(mediaRow?.s) || 0;
    mediaImages = Number(mediaRow?.c) || 0;
  } catch {
    /* таблица ещё не создана */
  }

  const quotaGb = Number(process.env.S3_QUOTA_GB || '') || 0;
  const s3QuotaBytes = quotaGb > 0 ? Math.round(quotaGb * 1024 * 1024 * 1024) : null;
  const s3Free =
    s3QuotaBytes != null ? Math.max(0, s3QuotaBytes - mediaBytes) : null;

  return {
    path,
    total_bytes: total,
    free_bytes: free,
    used_bytes: used,
    free_pct: freePct,
    free_human: humanBytes(free),
    used_human: humanBytes(used),
    total_human: humanBytes(total),
    media_bytes: mediaBytes,
    media_human: humanBytes(mediaBytes),
    media_images: mediaImages,
    s3_quota_bytes: s3QuotaBytes,
    s3_quota_human: s3QuotaBytes != null ? humanBytes(s3QuotaBytes) : null,
    s3_free_human: s3Free != null ? humanBytes(s3Free) : null,
  };
}
