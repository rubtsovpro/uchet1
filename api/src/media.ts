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
import { supplierLotsTableReady } from './supplier-lots.js';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** GUID 1С из id строки WMS (`pnevmopodveska_2025::uuid` → uuid). */
function catalogGuidFromProductId(productId: string): string {
  const id = String(productId || '').trim();
  const idx = id.indexOf('::');
  return (idx >= 0 ? id.slice(idx + 2) : id).trim().toLowerCase();
}

function isMediaProductId(productId: string): boolean {
  return isUuid(catalogGuidFromProductId(productId));
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

/** Ручная загрузка фото (экран фотографа) → S3 + product_media. */
export async function uploadManualProductPhoto(
  productId: string,
  buf: Buffer
): Promise<{
  id: string;
  url: string;
  size: number;
  mime: string;
  orientation: string;
  new_file: boolean;
}> {
  const rawId = String(productId || '').trim();
  if (!isMediaProductId(rawId)) throw new Error('Некорректный id товара');
  const product = get<{ id: string }>(
    'SELECT id FROM products WHERE id = ? OR lower(id) = lower(?) LIMIT 1',
    [rawId, rawId]
  );
  if (!product) throw new Error('Товар не найден');
  const pid = String(product.id);
  if (!buf || buf.length < 32) throw new Error('Файл слишком маленький');
  if (buf.length > 25 * 1024 * 1024) throw new Error('Файл больше 25 МБ');

  const cfg = s3ConfigFromEnv();
  if (!cfg) throw new Error('S3 не настроен (S3_ENDPOINT / BUCKET / ACCESS_KEY / SECRET_KEY)');

  const { ext, mime, kind } = detectMediaType(buf);
  if (kind !== 'image') throw new Error('Нужно изображение (JPEG, PNG, WebP, GIF)');

  const sha = createHash('sha256').update(buf).digest('hex');
  const dims = readImageSize(buf);
  const existing = get<{ id: string; url: string; size: number; mime: string; orientation: string }>(
    'SELECT id, url, size, mime, orientation FROM product_media WHERE product_id = ? AND sha256 = ?',
    [pid, sha]
  );
  if (existing) {
    if (!existing.orientation && dims) applyOrientation(existing.id, dims);
    // убрать маркер «пусто в 1С», если был
    run(`DELETE FROM product_media WHERE product_id = ? AND kind = 'empty'`, [pid]);
    return {
      id: existing.id,
      url: existing.url,
      size: Number(existing.size) || buf.length,
      mime: existing.mime || mime,
      orientation: existing.orientation || dims?.orientation || '',
      new_file: false,
    };
  }

  const maxSort =
    get<{ m: number }>(
      `SELECT COALESCE(MAX(sort_order), -1) AS m FROM product_media WHERE product_id = ? AND kind = 'image'`,
      [pid]
    )?.m ?? -1;
  const sortOrder = Number(maxSort) + 1;
  const key = `wms/products/${pid}/${String(sortOrder).padStart(2, '0')}_${sha.slice(0, 10)}.${ext}`;
  const url = await s3PutObject(cfg, key, buf, mime, true);
  const id = `${pid}|${sha}`;
  run(
    `INSERT INTO product_media (id, product_id, kind, mime, ext, s3_key, url, size, sha256, sort_order, width, height, orientation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       url=excluded.url, s3_key=excluded.s3_key, sort_order=excluded.sort_order,
       width=excluded.width, height=excluded.height, orientation=excluded.orientation,
       synced_at=datetime('now')`,
    [
      id,
      pid,
      'image',
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
  run(`DELETE FROM product_media WHERE product_id = ? AND kind = 'empty'`, [pid]);
  return {
    id,
    url,
    size: buf.length,
    mime,
    orientation: dims?.orientation || '',
    new_file: true,
  };
}

const VIDEO_URL_RE =
  /^(https?:\/\/)(www\.)?(youtube\.com|youtu\.be|rutube\.ru|vk\.com|vkvideo\.ru|vimeo\.com|drive\.google\.com|disk\.yandex\.(ru|com)|cloud\.mail\.ru)\b/i;

export function normalizeProductVideoUrl(raw: string): string {
  const url = String(raw || '').trim();
  if (!url) throw new Error('Укажите ссылку на видео');
  if (url.length > 2000) throw new Error('Ссылка слишком длинная');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Некорректная ссылка');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Ссылка должна начинаться с http(s)://');
  }
  // Разрешаем известные видеохостинги + любые https (фотограф может кинуть прямую mp4)
  if (!VIDEO_URL_RE.test(url) && !/\.(mp4|webm|mov)(\?|$)/i.test(parsed.pathname)) {
    // всё равно принимаем https — не режем жёстко
  }
  return parsed.toString();
}

/** Ссылка на видео в карточке товара (без файла в S3). */
export function addProductVideoLink(
  productId: string,
  rawUrl: string,
  title = ''
): { id: string; url: string; title: string; kind: 'video' } {
  const rawId = String(productId || '').trim();
  if (!isMediaProductId(rawId)) throw new Error('Некорректный id товара');
  const product = get<{ id: string }>(
    'SELECT id FROM products WHERE id = ? OR lower(id) = lower(?) LIMIT 1',
    [rawId, rawId]
  );
  if (!product) throw new Error('Товар не найден');
  const pid = String(product.id);
  const url = normalizeProductVideoUrl(rawUrl);
  const label = String(title || '').trim().slice(0, 200);
  const sha = createHash('sha256').update(`video|${url}`).digest('hex');
  const existing = get<{ id: string; url: string }>(
    `SELECT id, url FROM product_media WHERE product_id = ? AND kind = 'video' AND sha256 = ?`,
    [pid, sha]
  );
  if (existing) {
    return { id: existing.id, url: existing.url, title: label, kind: 'video' };
  }
  const maxSort =
    get<{ m: number }>(
      `SELECT COALESCE(MAX(sort_order), -1) AS m FROM product_media WHERE product_id = ?`,
      [pid]
    )?.m ?? -1;
  const id = `${pid}|video|${sha.slice(0, 16)}`;
  run(
    `INSERT INTO product_media (id, product_id, kind, mime, ext, s3_key, url, size, sha256, sort_order)
     VALUES (?, ?, 'video', 'text/uri-list', 'url', '', ?, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET url=excluded.url, synced_at=datetime('now')`,
    [id, pid, url, sha, Number(maxSort) + 1]
  );
  if (label) {
    try {
      run(`UPDATE product_media SET orientation = ? WHERE id = ?`, [label, id]);
    } catch {
      /* orientation reused as title for video links */
    }
  }
  run(`DELETE FROM product_media WHERE product_id = ? AND kind = 'empty'`, [pid]);
  return { id, url, title: label, kind: 'video' };
}

function findProductMediaRow(
  productId: string,
  mediaId: string
): { id: string; kind: string } | null {
  const pid = String(productId || '').trim();
  const mid = String(mediaId || '').trim();
  if (!pid || !mid) return null;
  const row = get<{ id: string; kind: string }>(
    `SELECT id, kind FROM product_media WHERE id = ? AND product_id = ?`,
    [mid, pid]
  );
  if (row) return row;
  return (
    get<{ id: string; kind: string }>(
      `SELECT id, kind FROM product_media WHERE id = ? AND lower(product_id) = lower(?)`,
      [mid, pid]
    ) || null
  );
}

export function deleteProductMediaItem(productId: string, mediaId: string): boolean {
  const row = findProductMediaRow(productId, mediaId);
  if (!row) return false;
  run(`DELETE FROM product_media WHERE id = ?`, [row.id]);
  return true;
}

/** Удаление пачки медиа; возвращает удалённые id и виды. */
export function deleteProductMediaBatch(
  productId: string,
  mediaIds: string[]
): { deleted: number; ids: string[]; kinds: Record<string, number> } {
  const ids = [...new Set((mediaIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  const kinds: Record<string, number> = {};
  const deletedIds: string[] = [];
  for (const mid of ids.slice(0, 100)) {
    const row = findProductMediaRow(productId, mid);
    if (!row) continue;
    run(`DELETE FROM product_media WHERE id = ?`, [row.id]);
    deletedIds.push(row.id);
    const k = String(row.kind || 'image') || 'image';
    kinds[k] = (kinds[k] || 0) + 1;
  }
  return { deleted: deletedIds.length, ids: deletedIds, kinds };
}

/**
 * Порядок фото карточки: ids слева направо, первое = титульное (sort_order 0).
 * Не принадлежащие товару / не image — пропускаем; остальные image сдвигаем в хвост.
 */
export function reorderProductMediaImages(
  productId: string,
  mediaIds: string[]
): { ok: boolean; ordered: string[]; title_id: string | null } {
  const pid = String(productId || '').trim();
  if (!pid) throw new Error('Товар не указан');
  const wanted = [
    ...new Set((mediaIds || []).map((x) => String(x || '').trim()).filter(Boolean)),
  ].slice(0, 200);
  if (wanted.length < 2) throw new Error('Нужно минимум 2 фото для смены порядка');

  const existing = all<{ id: string }>(
    `SELECT id FROM product_media
     WHERE product_id = ? AND kind = 'image'
     ORDER BY sort_order, synced_at`,
    [pid]
  ).map((r) => String(r.id));
  if (existing.length < 2) throw new Error('На карточке меньше двух своих фото');

  const own = new Set(existing);
  const ordered: string[] = [];
  for (const id of wanted) {
    if (!own.has(id) || ordered.includes(id)) continue;
    ordered.push(id);
  }
  for (const id of existing) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  if (ordered.length < 2) throw new Error('Не удалось сопоставить фото карточки');

  const upd = `UPDATE product_media SET sort_order = ? WHERE id = ? AND product_id = ?`;
  ordered.forEach((id, idx) => {
    run(upd, [idx, id, pid]);
  });
  return { ok: true, ordered, title_id: ordered[0] || null };
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
  for (const guid of guids) {
    const raw = await hsGet('Get/image', [{ guid }]);
    const rows = Array.isArray(raw) ? (raw as ImgRow[]) : [];
    for (const row of rows) {
      const g = String(row.guid || '')
        .trim()
        .toLowerCase();
      if (g) byGuid.set(g, row);
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
    const pid = String(productIds[i] || '').trim();
    const guid = catalogGuidFromProductId(pid);
    if (!isUuid(guid)) {
      skipped += 1;
      productsDone += 1;
      continue;
    }
    try {
      const byGuid = await fetchImagesForGuids([guid]);
      const row = byGuid.get(guid);
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
      const msg = e instanceof Error ? e.message : String(e);
      // HS Get/image >220MB: skip + mark empty so onlyMissing не крутит вечно
      if (/response too large/i.test(msg)) {
        console.warn('media skip oversized', pid, msg);
        markProductMediaChecked(pid, true);
        empty += 1;
      } else {
        errors += 1;
        console.warn('media upload fail', pid, msg);
      }
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

export async function syncMediaFrom1c(opts: {
  limit?: number;
  onlyMissing?: boolean;
  replace?: boolean;
  productIds?: string[];
} = {}): Promise<MediaSyncResult> {
  if (!hsConfigured()) throw new Error('HS не настроен');
  const cfg = s3ConfigFromEnv();
  if (!cfg) throw new Error('S3 не настроен (S3_ENDPOINT / BUCKET / ACCESS_KEY / SECRET_KEY)');

  const t0 = Date.now();
  const limit = Math.max(1, opts.limit ?? 200);
  const onlyMissing = opts.onlyMissing !== false;
  const replace = !!opts.replace;

  if (opts.productIds?.length) {
    const ids = opts.productIds.filter(isMediaProductId).slice(0, limit);
    const r = await syncGuidList(cfg, ids, replace);
    run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      'media_synced_at',
      new Date().toISOString(),
    ]);
    return { ...r, seconds: Math.round((Date.now() - t0) / 1000) };
  }

  const candidates = onlyMissing
    ? all<{ id: string }>(
        `SELECT p.id FROM products p
         LEFT JOIN categories c ON c.id = COALESCE(p.hs_category_id, p.category_id)
         LEFT JOIN (
           SELECT product_id, SUM(qty) AS qty
           FROM product_store_rests
           GROUP BY product_id
         ) r ON r.product_id = p.id
         WHERE p.is_active = 1
           AND NOT EXISTS (SELECT 1 FROM product_media m WHERE m.product_id = p.id)
         ORDER BY
           CASE
             WHEN IFNULL(c.name,'') LIKE '%Пневмостойк%' THEN 0
             WHEN IFNULL(c.name,'') LIKE '%Пневмобаллон%' THEN 0
             WHEN IFNULL(c.name,'') LIKE '%Амортизатор%' THEN 0
             WHEN IFNULL(c.name,'') LIKE '%Компрессор%' THEN 1
             WHEN IFNULL(c.name,'') LIKE '%Рулев%' THEN 1
             WHEN IFNULL(c.name,'') LIKE '%Датчик%' THEN 1
             WHEN IFNULL(c.name,'') LIKE '%Клапан%' THEN 2
             ELSE 5
           END,
           CASE WHEN IFNULL(r.qty, 0) > 0 THEN 0 ELSE 1 END,
           p.name
         LIMIT ?`,
        [limit]
      )
    : all<{ id: string }>(
        `SELECT id FROM products WHERE is_active = 1 ORDER BY name LIMIT ?`,
        [limit]
      );

  const productIds = candidates.map((r) => r.id).filter(isMediaProductId);
  console.log(`media from local products queue=${productIds.length} limit=${limit}`);
  const r = await syncGuidList(cfg, productIds, replace);

  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'media_synced_at',
    new Date().toISOString(),
  ]);

  return {
    products: r.products,
    uploaded: r.uploaded,
    skipped: r.skipped,
    empty: r.empty,
    errors: r.errors,
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

/** База артикула без @podveska/@fogel и без :8hex. */
export function productSkuBase(sku: string): string {
  let s = String(sku || '').trim();
  if (!s) return '';
  const at = s.indexOf('@');
  if (at > 0) s = s.slice(0, at);
  const colon = s.indexOf(':');
  if (colon > 0 && /^[0-9a-f]{6,}$/i.test(s.slice(colon + 1))) s = s.slice(0, colon);
  return s.trim();
}

function normalizeWarehouseSkuTokens(warehouseSku: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of String(warehouseSku || '').split(/[;,|\/\n]+/)) {
    const t = productSkuBase(part).toUpperCase().replace(/\s+/g, '');
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Id карточек, с которых берём фото для мастера:
 * сам мастер + любые товары с sku = факт / факт@… / факт:… из warehouse_sku и лотов.
 */
export function photoSourceProductIds(productId: string): string[] {
  const id = String(productId || '').trim();
  if (!id) return [];
  const row = get<{ id: string; sku: string; warehouse_sku: string }>(
    `SELECT id, sku, IFNULL(warehouse_sku,'') AS warehouse_sku FROM products WHERE id = ?`,
    [id]
  );
  if (!row) return [];
  const ids = new Set<string>([row.id]);
  const facts = new Set<string>(normalizeWarehouseSkuTokens(row.warehouse_sku));
  try {
    const lots = all<{ fact_sku: string }>(
      `SELECT DISTINCT fact_sku FROM product_supplier_lots
       WHERE product_id = ? OR master_sku = ? COLLATE NOCASE`,
      [row.id, row.sku]
    );
    for (const l of lots) {
      const f = productSkuBase(l.fact_sku).toUpperCase().replace(/\s+/g, '');
      if (f) facts.add(f);
    }
  } catch {
    /* таблицы лотов может не быть */
  }
  for (const fact of facts) {
    const hits = all<{ id: string }>(
      `SELECT id FROM products
       WHERE upper(replace(sku,' ','')) = ?
          OR upper(replace(sku,' ','')) LIKE (? || '@%')
          OR upper(replace(sku,' ','')) LIKE (? || ':%')`,
      [fact, fact, fact]
    );
    for (const h of hits) {
      if (h?.id) ids.add(h.id);
    }
  }
  return [...ids];
}

/**
 * Медиа для карточки: свои; если картинок нет — с фактов (Номер на складе).
 */
export function listProductMediaForDisplay(productId: string): Array<Record<string, unknown>> {
  const id = String(productId || '').trim();
  if (!id) return [];
  const own = all<Record<string, unknown>>(
    `SELECT id, kind, mime, ext, url, size, sort_order, width, height, orientation, product_id
     FROM product_media WHERE product_id = ?
     ORDER BY sort_order, synced_at`,
    [id]
  );
  const ownImages = own.filter((m) => String(m.kind || '') === 'image');
  if (ownImages.length > 0) return own;

  const sourceIds = photoSourceProductIds(id).filter((x) => x !== id);
  if (!sourceIds.length) return own;

  // Предпочитаем карточку с точным fact sku (без @/:), иначе первую с фото.
  const ranked = all<{ id: string; sku: string; c: number }>(
    `SELECT p.id, p.sku,
            (SELECT COUNT(*) FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image') AS c
     FROM products p
     WHERE p.id IN (${sourceIds.map(() => '?').join(',')})`,
    sourceIds
  )
    .filter((r) => (Number(r.c) || 0) > 0)
    .sort((a, b) => {
      const aExact = productSkuBase(a.sku).toUpperCase() === String(a.sku || '').toUpperCase() ? 1 : 0;
      const bExact = productSkuBase(b.sku).toUpperCase() === String(b.sku || '').toUpperCase() ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return (Number(b.c) || 0) - (Number(a.c) || 0);
    });
  const bestId = ranked[0]?.id;
  if (!bestId) return own;

  const inherited = all<Record<string, unknown>>(
    `SELECT id, kind, mime, ext, url, size, sort_order, width, height, orientation, product_id
     FROM product_media
     WHERE product_id = ? AND kind = 'image'
     ORDER BY sort_order, synced_at`,
    [bestId]
  ).map((m) => ({ ...m, inherited_from_fact: 1 }));

  return [...own.filter((m) => String(m.kind || '') !== 'image'), ...inherited];
}

/**
 * SQL: свои фото мастера (без fallback — fallback в enrichMasterListPhotos).
 */
export function sqlMasterImagesCountExpr(alias = 'p'): string {
  return `(SELECT COUNT(*) FROM product_media m WHERE m.product_id = ${alias}.id AND m.kind = 'image')`;
}

/** SQL: своё превью. */
export function sqlMasterThumbUrlExpr(alias = 'p'): string {
  return `(SELECT m.url FROM product_media m
         WHERE m.product_id = ${alias}.id AND m.kind = 'image'
         ORDER BY m.sort_order, m.synced_at LIMIT 1)`;
}

/**
 * Для строк списка без своих фото — подставить счётчик и thumb с карточек
 * «Номер на складе (факт)» / лотов. Один-два запроса на страницу.
 */
export function enrichMasterListPhotos<T extends Record<string, unknown>>(items: T[]): T[] {
  if (!items.length) return items;
  const factToItemIdx = new Map<string, number[]>();
  const needMeta: Array<{ idx: number; id: string; sku: string }> = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if ((Number(it.images_count) || 0) > 0) continue;
    if (String(it.item_kind || '') === 'service') continue;
    const facts = new Set<string>(normalizeWarehouseSkuTokens(String(it.warehouse_sku || '')));
    const masterSku = String(it.sku || '');
    const productId = String(it.id || '');
    needMeta.push({ idx: i, id: productId, sku: masterSku });
    for (const f of facts) {
      if (!factToItemIdx.has(f)) factToItemIdx.set(f, []);
      factToItemIdx.get(f)!.push(i);
    }
  }
  if (!needMeta.length) return items;

  if (supplierLotsTableReady()) {
    const ids = needMeta.map((x) => x.id).filter(Boolean);
    const skus = needMeta.map((x) => x.sku).filter(Boolean);
    const byId = new Map(needMeta.map((x) => [x.id, x.idx]));
    const bySku = new Map(needMeta.map((x) => [x.sku.toUpperCase(), x.idx]));
    try {
      if (ids.length) {
        const ph = ids.map(() => '?').join(',');
        const lots = all<{ product_id: string; master_sku: string; fact_sku: string }>(
          `SELECT product_id, master_sku, fact_sku FROM product_supplier_lots
           WHERE product_id IN (${ph})`,
          ids
        );
        for (const l of lots) {
          const f = productSkuBase(l.fact_sku).toUpperCase().replace(/\s+/g, '');
          if (!f) continue;
          const idx = byId.get(String(l.product_id));
          if (idx == null) continue;
          if (!factToItemIdx.has(f)) factToItemIdx.set(f, []);
          factToItemIdx.get(f)!.push(idx);
        }
      }
      if (skus.length) {
        const ph = skus.map(() => '?').join(',');
        const lots = all<{ master_sku: string; fact_sku: string }>(
          `SELECT master_sku, fact_sku FROM product_supplier_lots
           WHERE master_sku IN (${ph})`,
          skus
        );
        for (const l of lots) {
          const f = productSkuBase(l.fact_sku).toUpperCase().replace(/\s+/g, '');
          if (!f) continue;
          const idx = bySku.get(String(l.master_sku || '').toUpperCase());
          if (idx == null) continue;
          if (!factToItemIdx.has(f)) factToItemIdx.set(f, []);
          factToItemIdx.get(f)!.push(idx);
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (!factToItemIdx.size) return items;

  const facts = [...factToItemIdx.keys()];
  const placeholders = facts.map(() => '?').join(',');
  const factProducts = all<{ id: string; sku: string; base: string }>(
    `SELECT id, sku,
            UPPER(REPLACE(
              CASE
                WHEN INSTR(sku, '@') > 0 THEN SUBSTR(sku, 1, INSTR(sku, '@') - 1)
                WHEN INSTR(sku, ':') > 0 THEN SUBSTR(sku, 1, INSTR(sku, ':') - 1)
                ELSE sku
              END, ' ', '')) AS base
     FROM products
     WHERE UPPER(REPLACE(
              CASE
                WHEN INSTR(sku, '@') > 0 THEN SUBSTR(sku, 1, INSTR(sku, '@') - 1)
                WHEN INSTR(sku, ':') > 0 THEN SUBSTR(sku, 1, INSTR(sku, ':') - 1)
                ELSE sku
              END, ' ', '')) IN (${placeholders})`,
    facts
  );
  if (!factProducts.length) return items;

  const pidToFacts = new Map<string, string[]>();
  const pids: string[] = [];
  const exactFactIds = new Set<string>();
  for (const fp of factProducts) {
    pids.push(fp.id);
    const base = String(fp.base || '').toUpperCase();
    if (!pidToFacts.has(fp.id)) pidToFacts.set(fp.id, []);
    pidToFacts.get(fp.id)!.push(base);
    if (productSkuBase(fp.sku).toUpperCase().replace(/\s+/g, '') === String(fp.sku || '').toUpperCase().replace(/\s+/g, '')) {
      exactFactIds.add(fp.id);
    }
    // точное совпадение sku с фактом (без @/: )
    if (String(fp.sku || '').toUpperCase().replace(/\s+/g, '') === base) {
      exactFactIds.add(fp.id);
    }
  }
  const ph2 = pids.map(() => '?').join(',');
  const mediaAgg = all<{ product_id: string; c: number; thumb: string }>(
    `SELECT product_id,
            COUNT(*) AS c,
            (SELECT m2.url FROM product_media m2
             WHERE m2.product_id = product_media.product_id AND m2.kind = 'image'
             ORDER BY m2.sort_order, m2.synced_at LIMIT 1) AS thumb
     FROM product_media
     WHERE kind = 'image' AND product_id IN (${ph2})
     GROUP BY product_id`,
    pids
  );

  // На мастер — одна лучшая карточка факта (точный sku предпочтительнее клонов).
  type Cand = { c: number; thumb: string; exact: boolean };
  const bestByItem = new Map<number, Cand>();
  for (const row of mediaAgg) {
    const pid = String(row.product_id);
    const c = Number(row.c) || 0;
    if (c <= 0) continue;
    const exact = exactFactIds.has(pid);
    const bases = pidToFacts.get(pid) || [];
    for (const base of bases) {
      for (const idx of factToItemIdx.get(base) || []) {
        const cur = bestByItem.get(idx);
        const next: Cand = { c, thumb: String(row.thumb || ''), exact };
        if (
          !cur ||
          (exact && !cur.exact) ||
          (exact === cur.exact && c > cur.c)
        ) {
          bestByItem.set(idx, next);
        }
      }
    }
  }

  return items.map((it, i) => {
    const st = bestByItem.get(i);
    if (!st || st.c <= 0) return it;
    return {
      ...it,
      images_count: st.c,
      thumb_url: st.thumb || it.thumb_url || '',
      photos_from_fact: 1,
    };
  });
}
