/**
 * Покрытие фотографиями номенклатуры: по категориям + поиск sku/code.
 */
import { all, get } from './db.js';

export type MediaCoverageCategory = {
  category_id: string | null;
  category_name: string;
  products: number;
  with_photo: number;
  without_photo: number;
  pct: number;
};

export function mediaCoverageByCategory(): {
  categories: MediaCoverageCategory[];
  totals: { products: number; with_photo: number; without_photo: number; pct: number; images: number };
} {
  const rows = all<{
    category_id: string | null;
    category_name: string;
    products: number;
    with_photo: number;
  }>(
    `SELECT
       p.category_id AS category_id,
       IFNULL(NULLIF(TRIM(c.name), ''), '— Без категории —') AS category_name,
       COUNT(*) AS products,
       SUM(CASE WHEN EXISTS (
         SELECT 1 FROM product_media m
         WHERE m.product_id = p.id AND m.kind = 'image'
       ) THEN 1 ELSE 0 END) AS with_photo
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = 1
     GROUP BY p.category_id, category_name
     ORDER BY products DESC, category_name COLLATE NOCASE`
  );

  const categories: MediaCoverageCategory[] = rows.map((r) => {
    const products = Number(r.products) || 0;
    const withPhoto = Number(r.with_photo) || 0;
    const without = Math.max(0, products - withPhoto);
    return {
      category_id: r.category_id ? String(r.category_id) : null,
      category_name: String(r.category_name || '— Без категории —'),
      products,
      with_photo: withPhoto,
      without_photo: without,
      pct: products ? Math.round((withPhoto / products) * 1000) / 10 : 0,
    };
  });

  const products = categories.reduce((s, c) => s + c.products, 0);
  const withPhoto = categories.reduce((s, c) => s + c.with_photo, 0);
  const without = products - withPhoto;
  const images =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM product_media WHERE kind = 'image'`)?.c ?? 0;

  return {
    categories,
    totals: {
      products,
      with_photo: withPhoto,
      without_photo: without,
      pct: products ? Math.round((withPhoto / products) * 1000) / 10 : 0,
      images: Number(images) || 0,
    },
  };
}

export function listMediaProducts(opts: {
  q?: string;
  category_id?: string;
  status?: 'all' | 'with' | 'without';
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

  const hasPhotoSql = `EXISTS (
    SELECT 1 FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image'
  )`;
  if (status === 'with') where.push(hasPhotoSql);
  if (status === 'without') where.push(`NOT ${hasPhotoSql}`);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

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
       (SELECT COUNT(*) FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image') AS images_count,
       (SELECT m.url FROM product_media m
         WHERE m.product_id = p.id AND m.kind = 'image'
         ORDER BY m.sort_order, m.synced_at LIMIT 1) AS thumb_url
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     ${whereSql}
     ORDER BY
       CASE WHEN (SELECT COUNT(*) FROM product_media m WHERE m.product_id = p.id AND m.kind = 'image') > 0 THEN 1 ELSE 0 END,
       c.name COLLATE NOCASE,
       p.sku
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
