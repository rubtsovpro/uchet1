import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const dbPath = process.argv[2] || './data/warehouse.sqlite';
const outCsv = process.argv[3] || './services-export.csv';
const outJson = process.argv[4] || './services-export.json';

const db = new DatabaseSync(dbPath, { readOnly: true });

const kinds = db
  .prepare(
    `SELECT COALESCE(item_kind, 'product') AS k, COUNT(*) AS c
     FROM products GROUP BY 1 ORDER BY c DESC`
  )
  .all();
console.log('kinds', kinds);

const rows = db
  .prepare(
    `SELECT
       p.sku AS sku,
       p.code AS code,
       p.name AS name,
       p.brand AS brand,
       COALESCE(c.name, '') AS category,
       COALESCE(u.short_name, COALESCE(u.name, '')) AS unit,
       p.is_active AS is_active,
       COALESCE(p.item_kind, 'product') AS item_kind,
       p.id AS id
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE COALESCE(p.item_kind, 'product') = 'service'
     ORDER BY p.name COLLATE NOCASE`
  )
  .all();

console.log('services', rows.length);

function csvEsc(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const header = ['sku', 'code', 'name', 'brand', 'category', 'unit', 'is_active', 'item_kind', 'id'];
const lines = [header.join(',')];
for (const r of rows) {
  lines.push(header.map((h) => csvEsc(r[h])).join(','));
}
fs.writeFileSync(outCsv, '\uFEFF' + lines.join('\n'), 'utf8');
fs.writeFileSync(outJson, JSON.stringify(rows, null, 2), 'utf8');
console.log('wrote', outCsv, outJson);
