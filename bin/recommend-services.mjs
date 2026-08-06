import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const dbPath = process.argv[2] || './data/warehouse.sqlite';
const outJson = process.argv[3] || './services-with-rec.json';

const db = new DatabaseSync(dbPath, { readOnly: true });

const services = db
  .prepare(
    `SELECT p.id, p.sku, p.code, p.name,
            COALESCE(p.brand, '') AS brand,
            COALESCE(c.name, '') AS category,
            COALESCE(u.short_name, COALESCE(u.name, '')) AS unit,
            p.is_active AS is_active
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE COALESCE(p.item_kind, 'product') = 'service'
     ORDER BY p.name COLLATE NOCASE`
  )
  .all();

const usage = db
  .prepare(
    `SELECT product_guid AS id, COUNT(*) AS lines, COUNT(DISTINCT deal_id) AS deals
     FROM crm_deal_items
     WHERE COALESCE(product_guid, '') != ''
     GROUP BY product_guid`
  )
  .all();
const useMap = new Map(usage.map((u) => [String(u.id), u]));

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const byNorm = new Map();
for (const s of services) {
  const n = norm(s.name);
  if (!byNorm.has(n)) byNorm.set(n, []);
  byNorm.get(n).push(s);
}

const out = [];
for (const s of services) {
  const u = useMap.get(String(s.id)) || { lines: 0, deals: 0 };
  const n = norm(s.name);
  const dups = byNorm.get(n) || [];
  const reasons = [];
  let rec = 'оставить';
  const lines = Number(u.lines) || 0;
  const deals = Number(u.deals) || 0;

  if (lines === 0 && deals === 0) {
    reasons.push('нет в заказах');
    rec = 'удалить';
  }

  if (dups.length > 1) {
    reasons.push('дубль названия×' + dups.length);
    const sorted = dups.slice().sort((a, b) => {
      const ua = Number((useMap.get(String(a.id)) || {}).lines) || 0;
      const ub = Number((useMap.get(String(b.id)) || {}).lines) || 0;
      if (ub !== ua) return ub - ua;
      return String(a.sku || '').localeCompare(String(b.sku || ''), 'ru');
    });
    if (String(sorted[0].id) !== String(s.id)) {
      rec = 'удалить';
      reasons.push('оставить другой: ' + (sorted[0].sku || sorted[0].id));
    } else if (lines > 0) {
      rec = 'оставить';
    }
  }

  const name = String(s.name || '').trim();
  if (!name || name.length < 3) {
    rec = 'удалить';
    reasons.push('пустое/короткое имя');
  }

  out.push({
    id: s.id,
    sku: s.sku,
    code: s.code,
    name: s.name,
    brand: s.brand,
    category: s.category,
    unit: s.unit,
    is_active: s.is_active,
    item_kind: 'service',
    deals,
    lines,
    recommendation: rec,
    reason: reasons.join('; ') || (rec === 'оставить' ? 'используется или уникальна' : ''),
  });
}

const del = out.filter((x) => x.recommendation === 'удалить').length;
const keep = out.filter((x) => x.recommendation === 'оставить').length;
console.log(JSON.stringify({ total: out.length, keep, del }));
fs.writeFileSync(outJson, JSON.stringify(out, null, 2));
