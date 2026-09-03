import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { all } = require('../dist/db.js');

const DEPT = 'pnevmopodveska_2025';

const priceTypes = all(
  `SELECT IFNULL(name,'') AS name FROM dict_price_types WHERE IFNULL(name,'') != '' ORDER BY name COLLATE NOCASE`
).map((r) => String(r.name));

const products = all(
  `SELECT p.id,
          IFNULL(p.sku,'') AS sku,
          IFNULL(p.code,'') AS code,
          IFNULL(p.warehouse_sku,'') AS warehouse_sku,
          IFNULL(p.array_sku,'') AS array_sku,
          IFNULL(p.name,'') AS name,
          IFNULL(p.item_kind,'product') AS item_kind,
          IFNULL(p.brand,'') AS brand,
          IFNULL(c.name,'') AS category,
          IFNULL(p.is_active,1) AS is_active,
          IFNULL(p.is_main,0) AS is_main,
          IFNULL(p.dedup_role,'') AS dedup_role,
          IFNULL(p.source_department,'') AS source_department,
          IFNULL(p.catalog_guid,'') AS catalog_guid
   FROM products p
   LEFT JOIN categories c ON c.id = p.category_id
   WHERE IFNULL(p.source_department,'') = ?
     AND IFNULL(p.item_kind,'product') != 'service'
     AND IFNULL(p.is_active,1) = 1
   ORDER BY p.sku COLLATE NOCASE, p.name COLLATE NOCASE`,
  [DEPT]
);

const propRows = all(
  `SELECT pp.product_id AS product_id,
          IFNULL(pp.property,'') AS name,
          IFNULL(pp.value,'') AS value
   FROM product_properties pp
   INNER JOIN products p ON p.id = pp.product_id
   WHERE IFNULL(p.source_department,'') = ?`,
  [DEPT]
);

const oemByProduct = new Map();
for (const r of propRows) {
  const n = String(r.name || '');
  if (!/oem|оем|артикул\s*произв|номер\s*произв|кросс|cross|аналог/i.test(n)) continue;
  const pid = String(r.product_id);
  const v = String(r.value || '').trim();
  if (!v) continue;
  const cur = oemByProduct.get(pid) || [];
  if (!cur.includes(v)) cur.push(v);
  oemByProduct.set(pid, cur);
}

const priceRows = all(
  `SELECT pp.product_id AS product_id,
          IFNULL(pp.price_type,'') AS price_type,
          IFNULL(pp.price,0) AS price
   FROM product_prices pp
   INNER JOIN products p ON p.id = pp.product_id
   WHERE IFNULL(p.source_department,'') = ?`,
  [DEPT]
);
const pricesByProduct = new Map();
for (const r of priceRows) {
  const pid = String(r.product_id);
  const map = pricesByProduct.get(pid) || {};
  map[String(r.price_type)] = Number(r.price) || 0;
  pricesByProduct.set(pid, map);
}

const out = {
  source_department: DEPT,
  price_types: priceTypes,
  exported_at: new Date().toISOString(),
  count: products.length,
  items: products.map((p) => {
    const pid = String(p.id);
    const oemFromProps = oemByProduct.get(pid) || [];
    const arraySku = String(p.array_sku || '')
      .split(/[,;|\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const oem = [...new Set([...oemFromProps, ...arraySku])].join('; ');
    return {
      id: pid,
      sku: String(p.sku || ''),
      code: String(p.code || ''),
      warehouse_sku: String(p.warehouse_sku || ''),
      name: String(p.name || ''),
      item_kind: String(p.item_kind || 'product') === 'service' ? 'услуга' : 'товар',
      brand: String(p.brand || ''),
      category: String(p.category || ''),
      oem,
      is_main: Number(p.is_main) === 1 ? 'да' : '',
      dedup_role: String(p.dedup_role || ''),
      prices: pricesByProduct.get(pid) || {},
    };
  }),
};

const dest = process.argv[2] || '/tmp/pnevmo_msk_products.json';
fs.writeFileSync(dest, JSON.stringify(out));
console.log(
  JSON.stringify({
    ok: true,
    path: dest,
    count: out.count,
    price_types: priceTypes.length,
    with_oem: out.items.filter((i) => i.oem).length,
  })
);
