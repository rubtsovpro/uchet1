/**
 * Покрытие фотографиями номенклатуры: по категориям + поиск sku/code.
 * Очередь фотографа: остаток > 0 и нет image в product_media.
 */
import { all, get } from './db.js';

export type MediaCoverageCategory = {
  category_id: string | null;
  category_name: string;
  products: number;
  with_photo: number;
  without_photo: number;
  /** Остаток > 0 и нет фото — как очередь /photo */
  stock_without_photo: number;
  pct: number;
};

/** Остаток > 0: stock_balances, иначе product_store_rests (как productStockQty). */
const STOCK_QTY_SQL = `CASE
  WHEN EXISTS (SELECT 1 FROM stock_balances b WHERE b.product_id = p.id AND b.qty != 0)
  THEN IFNULL((SELECT SUM(b2.qty) FROM stock_balances b2 WHERE b2.product_id = p.id), 0)
  ELSE IFNULL((SELECT SUM(r.qty) FROM product_store_rests r WHERE r.product_id = p.id), 0)
END`;

const HAS_IMAGE_SQL = `EXISTS (
  SELECT 1 FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image'
)`;

const STOCK_WAREHOUSES_SQL = `CASE
  WHEN EXISTS (SELECT 1 FROM stock_balances b WHERE b.product_id = p.id AND b.qty != 0)
  THEN (
    SELECT GROUP_CONCAT(w.name || ' (' || CAST(b.qty AS TEXT) || ')', ', ')
    FROM stock_balances b
    JOIN warehouses w ON w.id = b.warehouse_id
    WHERE b.product_id = p.id AND b.qty > 0
  )
  ELSE (
    SELECT GROUP_CONCAT(IFNULL(w.name, r.warehouse_id) || ' (' || CAST(r.qty AS TEXT) || ')', ', ')
    FROM product_store_rests r
    LEFT JOIN warehouses w ON w.id = r.warehouse_id
    WHERE r.product_id = p.id AND r.qty > 0
  )
END`;

export function mediaCoverageByCategory(): {
  categories: MediaCoverageCategory[];
  totals: {
    products: number;
    with_photo: number;
    without_photo: number;
    stock_without_photo: number;
    pct: number;
    images: number;
  };
} {
  const rows = all<{
    category_id: string | null;
    category_name: string;
    products: number;
    with_photo: number;
    stock_without_photo: number;
  }>(
    `SELECT
       p.category_id AS category_id,
       IFNULL(NULLIF(TRIM(c.name), ''), '— Без категории —') AS category_name,
       COUNT(*) AS products,
       SUM(CASE WHEN ${HAS_IMAGE_SQL} THEN 1 ELSE 0 END) AS with_photo,
       SUM(CASE
         WHEN (${STOCK_QTY_SQL}) > 0 AND NOT ${HAS_IMAGE_SQL} THEN 1
         ELSE 0
       END) AS stock_without_photo
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = 1
     GROUP BY p.category_id, category_name
     ORDER BY stock_without_photo DESC, products DESC, category_name COLLATE NOCASE`
  );

  const categories: MediaCoverageCategory[] = rows.map((r) => {
    const products = Number(r.products) || 0;
    const withPhoto = Number(r.with_photo) || 0;
    const without = Math.max(0, products - withPhoto);
    const stockWithout = Number(r.stock_without_photo) || 0;
    return {
      category_id: r.category_id ? String(r.category_id) : null,
      category_name: String(r.category_name || '— Без категории —'),
      products,
      with_photo: withPhoto,
      without_photo: without,
      stock_without_photo: stockWithout,
      pct: products ? Math.round((withPhoto / products) * 1000) / 10 : 0,
    };
  });

  const products = categories.reduce((s, c) => s + c.products, 0);
  const withPhoto = categories.reduce((s, c) => s + c.with_photo, 0);
  const without = products - withPhoto;
  const images =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM product_media WHERE kind = 'image'`)?.c ?? 0;
  const stockWithout =
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM products p
       WHERE p.is_active = 1
         AND (${STOCK_QTY_SQL}) > 0
         AND NOT ${HAS_IMAGE_SQL}`
    )?.c ?? 0;

  return {
    categories,
    totals: {
      products,
      with_photo: withPhoto,
      without_photo: without,
      stock_without_photo: Number(stockWithout) || 0,
      pct: products ? Math.round((withPhoto / products) * 1000) / 10 : 0,
      images: Number(images) || 0,
    },
  };
}

export function listMediaProducts(opts: {
  q?: string;
  category_id?: string;
  status?: 'all' | 'with' | 'without' | 'stock_without';
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, opts.page || 1);
  const limit = Math.min(100, Math.max(1, opts.limit || 50));
  const offset = (page - 1) * limit;
  const status = opts.status || 'all';
  const where: string[] = ['p.is_active = 1'];
  const params: Array<string | number> = [];

  const q = (opts.q || '').trim();
  if (q) {
    const like = `%${q}%`;
    where.push(
      `(p.sku LIKE ? OR IFNULL(p.code,'') LIKE ? OR IFNULL(p.barcode,'') LIKE ? OR IFNULL(p.array_sku,'') LIKE ? OR p.name LIKE ? OR p.id LIKE ?)`
    );
    params.push(like, like, like, like, like, like);
  }

  const cat = (opts.category_id || '').trim();
  if (cat === '__none__') {
    where.push(`(p.category_id IS NULL OR TRIM(IFNULL(p.category_id,'')) = '')`);
  } else if (cat) {
    where.push(`p.category_id = ?`);
    params.push(cat);
  }

  if (status === 'with') where.push(HAS_IMAGE_SQL);
  if (status === 'without') where.push(`NOT ${HAS_IMAGE_SQL}`);
  // Как у /photo: остаток > 0 и нет фото
  if (status === 'stock_without') {
    where.push(`(${STOCK_QTY_SQL}) > 0`);
    where.push(`NOT ${HAS_IMAGE_SQL}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql =
    status === 'stock_without'
      ? `ORDER BY (${STOCK_QTY_SQL}) DESC, c.name COLLATE NOCASE, p.sku`
      : `ORDER BY
       CASE WHEN (${HAS_IMAGE_SQL}) THEN 1 ELSE 0 END,
       c.name COLLATE NOCASE,
       p.sku`;

  const total =
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM products p ${whereSql}`,
      params
    )?.c ?? 0;

  const items = all(
    `SELECT
       p.id, p.sku, p.code, p.name, p.brand, p.barcode,
       IFNULL(c.name, '') AS category,
       p.category_id,
       (${STOCK_QTY_SQL}) AS stock_qty,
       (${STOCK_WAREHOUSES_SQL}) AS stock_warehouses,
       (SELECT COUNT(*) FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image') AS images_count,
       (SELECT m.url FROM product_media m
         WHERE m.product_id = p.id AND m.kind = 'image'
         ORDER BY m.sort_order, m.synced_at LIMIT 1) AS thumb_url
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     ${whereSql}
     ${orderSql}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    items,
    total: Number(total) || 0,
    page,
    pages: Math.max(1, Math.ceil((Number(total) || 0) / limit)),
    limit,
  };
}

/** Очередь фотографа: на складе (qty > 0) и без фото. */
export function listPhotographerQueue(opts: {
  q?: string;
  warehouse_id?: string;
  category_id?: string;
  offset?: number;
  limit?: number;
}) {
  const limit = Math.min(50, Math.max(1, opts.limit || 1));
  const offset = Math.max(0, opts.offset || 0);
  const where: string[] = [
    'p.is_active = 1',
    `(${STOCK_QTY_SQL}) > 0`,
    `NOT ${HAS_IMAGE_SQL}`,
  ];
  const params: Array<string | number> = [];

  const q = (opts.q || '').trim();
  if (q) {
    const like = `%${q}%`;
    where.push(
      `(p.sku LIKE ? OR IFNULL(p.code,'') LIKE ? OR IFNULL(p.barcode,'') LIKE ? OR IFNULL(p.array_sku,'') LIKE ? OR p.name LIKE ? OR p.id LIKE ?)`
    );
    params.push(like, like, like, like, like, like);
  }

  const cat = (opts.category_id || '').trim();
  if (cat === '__none__') {
    where.push(`(p.category_id IS NULL OR TRIM(IFNULL(p.category_id,'')) = '')`);
  } else if (cat) {
    where.push(`p.category_id = ?`);
    params.push(cat);
  }

  const wh = (opts.warehouse_id || '').trim();
  if (wh) {
    where.push(`(
      EXISTS (SELECT 1 FROM stock_balances b WHERE b.product_id = p.id AND b.warehouse_id = ? AND b.qty > 0)
      OR (
        NOT EXISTS (SELECT 1 FROM stock_balances b2 WHERE b2.product_id = p.id AND b2.qty != 0)
        AND EXISTS (SELECT 1 FROM product_store_rests r WHERE r.product_id = p.id AND r.warehouse_id = ? AND r.qty > 0)
      )
    )`);
    params.push(wh, wh);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM products p ${whereSql}`, params)?.c ?? 0;

  const items = all<{
    id: string;
    sku: string | null;
    code: string | null;
    name: string | null;
    brand: string | null;
    barcode: string | null;
    category: string;
    category_id: string | null;
    stock_qty: number;
    stock_warehouses: string | null;
  }>(
    `SELECT
       p.id, p.sku, p.code, p.name, p.brand, p.barcode,
       IFNULL(c.name, '') AS category,
       p.category_id,
       (${STOCK_QTY_SQL}) AS stock_qty,
       (${STOCK_WAREHOUSES_SQL}) AS stock_warehouses
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     ${whereSql}
     ORDER BY
       CASE
         WHEN IFNULL(c.name,'') LIKE '%Пневмостойк%' THEN 0
         WHEN IFNULL(c.name,'') LIKE '%Пневмобаллон%' THEN 0
         WHEN IFNULL(c.name,'') LIKE '%Амортизатор%' THEN 0
         WHEN IFNULL(c.name,'') LIKE '%Компрессор%' THEN 1
         ELSE 5
       END,
       (${STOCK_QTY_SQL}) DESC,
       p.name COLLATE NOCASE
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    items: items.map((row) => ({
      ...row,
      warehouses: row.stock_warehouses,
    })),
    total: Number(total) || 0,
    offset,
    limit,
    done: Math.min(offset, Number(total) || 0),
    left: Math.max(0, (Number(total) || 0) - offset),
  };
}
