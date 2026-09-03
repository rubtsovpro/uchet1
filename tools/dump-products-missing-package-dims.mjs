/**
 * Товары (не услуги) с остатком без габаритов упаковки + остатки по складам.
 *
 *   node tools/dump-products-missing-package-dims.mjs /path/to/warehouse.sqlite /tmp/missing-dims.json
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const dbPath = process.argv[2] || 'data/warehouse.sqlite';
const outPath = process.argv[3] || '';

const db = new DatabaseSync(dbPath, { readOnly: true });

const warehouses = db
  .prepare(
    `SELECT id, IFNULL(NULLIF(TRIM(code),''), id) AS code, IFNULL(NULLIF(TRIM(name),''), code) AS name
     FROM warehouses
     ORDER BY name COLLATE NOCASE`
  )
  .all();

const balRows = db
  .prepare(
    `SELECT product_id, warehouse_id, SUM(IFNULL(qty,0)) AS qty
     FROM stock_balances
     GROUP BY product_id, warehouse_id
     HAVING SUM(IFNULL(qty,0)) > 0.0001`
  )
  .all();

/** product_id → { warehouse_id → qty } */
const byProduct = new Map();
for (const b of balRows) {
  const pid = String(b.product_id);
  if (!byProduct.has(pid)) byProduct.set(pid, new Map());
  byProduct.get(pid).set(String(b.warehouse_id), Number(b.qty) || 0);
}

const products = db
  .prepare(
    `SELECT p.id, p.sku, p.code, p.name, p.brand, p.barcode, p.array_sku, p.is_active,
            p.package_width_cm, p.package_height_cm, p.package_length_cm, p.package_weight_g,
            IFNULL(c.name,'') AS category,
            IFNULL(u.short_name,'') AS unit
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE IFNULL(p.item_kind, 'product') = 'product'
       AND (
         p.package_width_cm IS NULL OR p.package_width_cm <= 0
         OR p.package_height_cm IS NULL OR p.package_height_cm <= 0
         OR p.package_length_cm IS NULL OR p.package_length_cm <= 0
       )
     ORDER BY p.name COLLATE NOCASE`
  )
  .all();

const whUsedIds = new Set();
const out = [];
for (const r of products) {
  const id = String(r.id);
  const stocks = byProduct.get(id);
  if (!stocks || !stocks.size) continue;
  let stockTotal = 0;
  const stockByWh = {};
  const where = [];
  for (const [wid, qty] of stocks) {
    stockTotal += qty;
    stockByWh[wid] = qty;
    whUsedIds.add(wid);
    const wh = warehouses.find((w) => String(w.id) === wid);
    const label = wh ? String(wh.name || wh.code) : wid;
    where.push(`${label}: ${qty}`);
  }
  if (stockTotal <= 0.0001) continue;

  const code1c = String(r.sku || r.code || '').trim();
  const arrayFirst =
    String(r.array_sku || '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)[0] || '';
  const article = String(r.barcode || '').trim() || arrayFirst;
  const w = r.package_width_cm;
  const h = r.package_height_cm;
  const l = r.package_length_cm;
  const missing = [];
  if (w == null || Number(w) <= 0) missing.push('ширина');
  if (h == null || Number(h) <= 0) missing.push('высота');
  if (l == null || Number(l) <= 0) missing.push('длина');

  out.push({
    id,
    article,
    code: code1c,
    sku: String(r.sku || ''),
    name: String(r.name || ''),
    brand: String(r.brand || ''),
    category: String(r.category || ''),
    unit: String(r.unit || ''),
    is_active: Number(r.is_active) === 1 ? 1 : 0,
    stock: stockTotal,
    stock_by_wh: stockByWh,
    stock_where: where.join('; '),
    package_width_cm: w == null ? '' : Number(w),
    package_height_cm: h == null ? '' : Number(h),
    package_length_cm: l == null ? '' : Number(l),
    package_weight_g: r.package_weight_g == null ? '' : Number(r.package_weight_g),
    missing_dims: missing.join(', '),
  });
}

out.sort((a, b) => {
  const d = (b.stock || 0) - (a.stock || 0);
  if (d) return d;
  return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
});

const warehousesOut = warehouses
  .filter((w) => whUsedIds.has(String(w.id)))
  .map((w) => ({
    id: String(w.id),
    code: String(w.code || ''),
    name: String(w.name || ''),
  }));

const payload = { warehouses: warehousesOut, items: out };
const json = JSON.stringify(payload);
if (outPath) {
  fs.writeFileSync(outPath, json);
  console.error(
    `OK ${out.length} products (товар) without package dims, stock>0, warehouses=${warehousesOut.length} → ${outPath}`
  );
  for (const w of warehousesOut) {
    const sum = out.reduce((s, it) => s + (Number(it.stock_by_wh?.[w.id]) || 0), 0);
    const n = out.filter((it) => (Number(it.stock_by_wh?.[w.id]) || 0) > 0).length;
    console.error(`  ${w.name}: ${n} SKU, qty ${sum}`);
  }
} else {
  process.stdout.write(json);
}
