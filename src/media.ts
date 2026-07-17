/**
 * Картинки/файлы номенклатуры из 1С Get/image → FirstVDS S3.
 * Отдельного Get для документов в HS нет — PDF приходят в array_image, если 1С их отдаёт.
 */
import { createHash } from 'node:crypto';
import { get, run, all } from './db.js';
import { hsConfigured, hsGet } from './hs.js';
import {
  detectMediaType,
  s3ConfigFromEnv,
  s3PutObject,
  type S3Config,
} from './s3.js';
import { readImageSize, type ImageSize } from './image-size.js';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

type ImgRow = { guid?: string; array_image?: Array<{ image?: string }> };

export type MediaSyncResult = {
  products: number;
  uploaded: number;
  skipped: number;
  empty: number;
  errors: number;
  seconds: number;
};

export function mediaSyncMeta() {
  return {
    configured: Boolean(hsConfigured() && s3ConfigFromEnv()),
    files: get<{ c: number }>('SELECT COUNT(*) AS c FROM product_media')?.c ?? 0,
    images:
      get<{ c: number }>(`SELECT COUNT(*) AS c FROM product_media WHERE kind = 'image'`)?.c ?? 0,
    documents:
      get<{ c: number }>(`SELECT COUNT(*) AS c FROM product_media WHERE kind = 'document'`)?.c ??
      0,
    empty:
      get<{ c: number }>(`SELECT COUNT(*) AS c FROM product_media WHERE kind = 'empty'`)?.c ?? 0,
    withOrientation:
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM product_media WHERE kind = 'image' AND orientation != ''`
      )?.c ?? 0,
    lastSync:
      get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['media_synced_at'])?.value ??
      null,
  };
}

function applyOrientation(id: string, dims: ImageSize | null): void {
  if (!dims) return;
  run(
    `UPDATE product_media SET width = ?, height = ?, orientation = ? WHERE id = ?`,
    [dims.width, dims.height, dims.orientation, id]
  );
}

async function uploadProductImages(
  cfg: S3Config,
  productId: string,
  images: Array<{ image?: string }>,
  replace: boolean
): Promise<{ uploaded: number; skipped: number }> {
  if (replace) {
    run('DELETE FROM product_media WHERE product_id = ?', [productId]);
  }

  let uploaded = 0;
  let skipped = 0;
  let idx = 0;

  for (const item of images) {
    const b64 = String(item.image || '').trim();
    item.image = ''; // не держим base64 в памяти после копирования
    if (!b64) continue;
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch {
      continue;
    }
    if (buf.length < 32) continue;

    const sha = createHash('sha256').update(buf).digest('hex');
    const dims = readImageSize(buf);
    const existing = get<{ id: string; orientation: string }>(
      'SELECT id, orientation FROM product_media WHERE product_id = ? AND sha256 = ?',
      [productId, sha]
    );
    if (existing) {
      if (!existing.orientation && dims) applyOrientation(existing.id, dims);
      skipped += 1;
      idx += 1;
      continue;
    }

    const { ext, mime, kind } = detectMediaType(buf);
    const sortOrder = idx;
    const key = `wms/products/${productId}/${String(sortOrder).padStart(2, '0')}_${sha.slice(0, 10)}.${ext}`;
    const url = await s3PutObject(cfg, key, buf, mime, true);
    const id = `${productId}|${sha}`;
    run(
      `INSERT INTO product_media (id, product_id, kind, mime, ext, s3_key, url, size, sha256, sort_order, width, height, orientation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         url=excluded.url, s3_key=excluded.s3_key, sort_order=excluded.sort_order,
         width=excluded.width, height=excluded.height, orientation=excluded.orientation,
         synced_at=datetime('now')`,
      [
        id,
        productId,
        kind,
        mime,
        ext,
        key,
        url,
        buf.length,
        sha,
        sortOrder,
        dims?.width || 0,
        dims?.height || 0,
        dims?.orientation || '',
      ]
    );
    uploaded += 1;
    idx += 1;
  }

  return { uploaded, skipped };
}

async function fetchImagesForGuids(guids: string[]): Promise<Map<string, ImgRow>> {
  const byGuid = new Map<string, ImgRow>();
  // По 1 guid: на VPS 2ГБ RAM пачка base64 из 1С убивает процесс (OOM).
  for (const guid of guids) {
    try {
      const raw = await hsGet('Get/image', [{ guid }]);
      const rows = Array.isArray(raw) ? (raw as ImgRow[]) : [];
      for (const row of rows) {
        const g = String(row.guid || '').trim();
        if (g) byGuid.set(g, row);
      }
    } catch {
      /* empty */
    }
  }
  return byGuid;
}

function markProductMediaChecked(productId: string, empty: boolean): void {
  if (!empty) return;
  // чтобы onlyMissing не крутил товары без фото снова и снова
  const id = `${productId}|empty`;
  run(
    `INSERT OR IGNORE INTO product_media (
       id, product_id, kind, mime, ext, s3_key, url, size, sha256, sort_order
     ) VALUES (?, ?, 'empty', '', '', '', '', 0, '', 0)`,
    [id, productId]
  );
}

async function syncGuidList(
  cfg: S3Config,
  productIds: string[],
  replace: boolean
): Promise<Omit<MediaSyncResult, 'seconds'>> {
  let uploaded = 0;
  let skipped = 0;
  let empty = 0;
  let errors = 0;
  let productsDone = 0;

  for (let i = 0; i < productIds.length; i++) {
    const pid = productIds[i];
    try {
      const byGuid = await fetchImagesForGuids([pid]);
      const row = byGuid.get(pid);
      const images = row?.array_image || [];
      if (!images.length) {
        empty += 1;
        productsDone += 1;
        markProductMediaChecked(pid, true);
        continue;
      }
      const r = await uploadProductImages(cfg, pid, images, replace);
      uploaded += r.uploaded;
      skipped += r.skipped;
      productsDone += 1;
      // освобождаем ссылки на base64 до GC
      if (row) row.array_image = [];
      byGuid.clear();
    } catch (e) {
      errors += 1;
      console.warn('media upload fail', pid, e instanceof Error ? e.message : e);
      productsDone += 1;
    }
    if ((i + 1) % 5 === 0 || i + 1 === productIds.length) {
      console.log(
        `media progress products=${productsDone}/${productIds.length} uploaded=${uploaded} empty=${empty} errors=${errors}`
      );
    }
  }

  return { products: productsDone, uploaded, skipped, empty, errors };
}

/** Приоритетные категории (автозапчасти с фото). Остальные тоже обойдём. */
const PRIORITY_CAT_NAMES = [
  'Пневмостойки',
  'Пневмобаллоны',
  'Амортизаторы',
  'Компрессоры',
  'Рулевые рейки',
  'Блоки клапанов',
  'Датчики',
];

export async function syncMediaFrom1c(opts: {
  limit?: number;
  onlyMissing?: boolean;
  replace?: boolean;
  productIds?: string[];
  /** Если false — не пропускать категорию по сэмплу «нет фото» (полная выгрузка). */
  skipEmptyCategories?: boolean;
} = {}): Promise<MediaSyncResult> {
  if (!hsConfigured()) throw new Error('HS не настроен');
  const cfg = s3ConfigFromEnv();
  if (!cfg) throw new Error('S3 не настроен (S3_ENDPOINT / BUCKET / ACCESS_KEY / SECRET_KEY)');

  const t0 = Date.now();
  const limit = Math.max(1, opts.limit ?? 200);
  const onlyMissing = opts.onlyMissing !== false;
  const replace = !!opts.replace;
  const skipEmptyCategories = opts.skipEmptyCategories !== false && limit < 5000;

  if (opts.productIds?.length) {
    const ids = opts.productIds.filter(isUuid).slice(0, limit);
    const r = await syncGuidList(cfg, ids, replace);
    run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      'media_synced_at',
      new Date().toISOString(),
    ]);
    return { ...r, seconds: Math.round((Date.now() - t0) / 1000) };
  }

  const catsRaw = await hsGet('Get/Categories', '');
  const cats = (Array.isArray(catsRaw) ? catsRaw : []) as Array<{ guid?: string; name?: string }>;
  const sorted = [...cats].sort((a, b) => {
    const an = String(a.name || '');
    const bn = String(b.name || '');
    const ap = PRIORITY_CAT_NAMES.some((x) => an.includes(x)) ? 0 : 1;
    const bp = PRIORITY_CAT_NAMES.some((x) => bn.includes(x)) ? 0 : 1;
    return ap - bp;
  });

  let uploaded = 0;
  let skipped = 0;
  let empty = 0;
  let errors = 0;
  let productsDone = 0;

  for (const cat of sorted) {
    if (productsDone >= limit) break;
    const catGuid = String(cat.guid || '').trim();
    if (!isUuid(catGuid)) continue;
    console.log('media category', cat.name, catGuid);

    let products: Array<{ guid?: string }> = [];
    try {
      const prodRaw = await hsGet('Get/products', [{ guid: catGuid }]);
      products = Array.isArray(prodRaw) ? (prodRaw as Array<{ guid?: string }>) : [];
    } catch (e) {
      console.warn('Get/products skip', cat.name, e instanceof Error ? e.message : e);
      continue;
    }

    const guids: string[] = [];
    for (const p of products) {
      const id = String(p.guid || '').trim();
      if (!isUuid(id)) continue;
      if (!get('SELECT 1 AS ok FROM products WHERE id = ?', [id])) continue;
      if (onlyMissing && get('SELECT 1 AS ok FROM product_media WHERE product_id = ?', [id])) {
        continue;
      }
      guids.push(id);
    }
    if (!guids.length) continue;

    // Сэмпл: если у первых 3 нет фото — категорию пропускаем (только для малых пачек UI)
    if (skipEmptyCategories) {
      const sample = await fetchImagesForGuids(guids.slice(0, 3));
      const sampleHas = [...sample.values()].some((r) => (r.array_image || []).length > 0);
      if (!sampleHas) {
        console.log('media skip category (no photos in sample):', cat.name);
        continue;
      }
    }

    const room = limit - productsDone;
    const slice = guids.slice(0, room);
    const r = await syncGuidList(cfg, slice, replace);
    uploaded += r.uploaded;
    skipped += r.skipped;
    empty += r.empty;
    errors += r.errors;
    productsDone += r.products;
  }

  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'media_synced_at',
    new Date().toISOString(),
  ]);

  return {
    products: productsDone,
    uploaded,
    skipped,
    empty,
    errors,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

/** Дозаполнить orientation у уже загруженных фото (скачивает с S3 URL). */
export async function backfillMediaOrientation(opts: {
  limit?: number;
  productId?: string;
} = {}): Promise<{ checked: number; updated: number; failed: number; left: number; seconds: number }> {
  const limit = Math.max(1, Math.min(opts.limit ?? 200, 2000));
  const t0 = Date.now();
  const params: Array<string | number> = [];
  let where =
    `WHERE kind = 'image' AND (IFNULL(orientation,'') = '' OR IFNULL(width,0) = 0)`;
  if (opts.productId) {
    where += ` AND product_id = ?`;
    params.push(opts.productId);
  }
  const rows = all<{ id: string; url: string }>(
    `SELECT id, url FROM product_media ${where} ORDER BY synced_at DESC LIMIT ?`,
    [...params, limit]
  );
  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const res = await fetch(row.url, {
        headers: { Range: 'bytes=0-65535' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok && res.status !== 206) {
        failed += 1;
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const dims = readImageSize(buf);
      if (!dims) {
        failed += 1;
        continue;
      }
      applyOrientation(row.id, dims);
      updated += 1;
    } catch {
      failed += 1;
    }
  }
  const left =
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM product_media
       WHERE kind = 'image' AND (IFNULL(orientation,'') = '' OR IFNULL(width,0) = 0)`
    )?.c ?? 0;
  return {
    checked: rows.length,
    updated,
    failed,
    left,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}
