/**
 * Dump products (not services) + usage + duplicate marks → JSON,
 * then push to Google Sheet tab «Товары».
 *
 * Usage on VPS (dump):
 *   node tools/dump-products-for-sheet.mjs /path/to/warehouse.sqlite > /tmp/products-export.json
 *
 * Local push:
 *   php tools/export_products_dedupe_to_google_sheet.php /tmp/products-export.json
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const dbPath = process.argv[2] || 'data/warehouse.sqlite';
const outPath = process.argv[3] || '';

const db = new DatabaseSync(dbPath, { readOnly: true });

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normCode(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

const rows = db
  .prepare(
    `SELECT p.id, p.sku, p.code, p.name, p.brand, p.barcode, p.array_sku, p.is_active, p.item_kind,
            IFNULL(c.name,'') AS category,
            IFNULL(u.short_name,'') AS unit
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE IFNULL(p.item_kind, 'product') != 'service'
     ORDER BY p.name COLLATE NOCASE, p.sku`
  )
  .all();

const usage = db
  .prepare(
    `SELECT product_guid AS id,
            COUNT(DISTINCT deal_id) AS deals,
            COUNT(*) AS lines
     FROM crm_deal_items
     WHERE IFNULL(TRIM(product_guid),'') != ''
     GROUP BY product_guid`
  )
  .all();
const usageMap = new Map(usage.map((u) => [String(u.id), u]));

const stock = db
  .prepare(
    `SELECT product_id AS id, SUM(IFNULL(qty,0)) AS qty
     FROM stock_balances
     GROUP BY product_id`
  )
  .all();
const stockMap = new Map(stock.map((s) => [String(s.id), Number(s.qty) || 0]));

const enriched = rows.map((r) => {
  const id = String(r.id);
  const u = usageMap.get(id) || { deals: 0, lines: 0 };
  // В 1С: Код = sku/code (00-/НФ-…); Артикул = barcode / array_sku (каталожный номер)
  const code1c = String(r.sku || r.code || '').trim();
  const arrayFirst = String(r.array_sku || '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)[0] || '';
  const article = String(r.barcode || '').trim() || arrayFirst;
  return {
    id,
    /** Каталожный артикул (штрихкод / array_sku) */
    article,
    /** Код 1С */
    code: code1c,
    sku: String(r.sku || ''),
    code_raw: String(r.code || ''),
    array_sku: String(r.array_sku || ''),
    barcode: String(r.barcode || ''),
    name: String(r.name || ''),
    brand: String(r.brand || ''),
    category: String(r.category || ''),
    unit: String(r.unit || ''),
    is_active: Number(r.is_active) === 1 ? 1 : 0,
    deals: Number(u.deals) || 0,
    lines: Number(u.lines) || 0,
    stock: stockMap.get(id) || 0,
    name_norm: normName(r.name),
    article_norm: normCode(article),
    code_norm: normCode(code1c),
    category_norm: normName(r.category) || '—без категории—',
  };
});

function score(r) {
  return (
    (r.deals > 0 ? 100000 : 0) +
    (r.lines > 0 ? 10000 : 0) +
    (r.stock > 0 ? 1000 : 0) +
    (r.is_active ? 100 : 0) +
    (r.name ? 10 : 0) +
    (r.article ? 1 : 0)
  );
}

/** Group key → list of indices */
function groupBy(keyFn) {
  const m = new Map();
  enriched.forEach((r, i) => {
    const k = keyFn(r);
    if (!k) return;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(i);
  });
  return m;
}

// Дубли только внутри одной категории: один артикул в разных категориях — норма
const byArticle = groupBy((r) =>
  r.article_norm ? `${r.category_norm}||${r.article_norm}` : ''
);
const byCode = groupBy((r) => (r.code_norm ? `${r.category_norm}||${r.code_norm}` : ''));
const byName = groupBy((r) =>
  r.name_norm.length >= 4 ? `${r.category_norm}||${r.name_norm}` : ''
);

const keep = new Array(enriched.length).fill(null);
const reasons = new Array(enriched.length).fill('');
const dupNo = new Array(enriched.length).fill(0);
const dupKind = new Array(enriched.length).fill('');
let nextDupNo = 1;

function markDupGroup(indices, label) {
  if (indices.length < 2) return;
  // уже пронумерованы другой группой — не перетираем номер
  const needNumber = indices.some((i) => !dupNo[i]);
  const groupNo = needNumber
    ? (() => {
        const existing = indices.map((i) => dupNo[i]).find((n) => n > 0);
        if (existing) return existing;
        return nextDupNo++;
      })()
    : indices.map((i) => dupNo[i]).find((n) => n > 0) || nextDupNo++;

  const sorted = [...indices].sort((a, b) => score(enriched[b]) - score(enriched[a]));
  const winner = sorted[0];
  const cat = enriched[winner].category || 'без категории';
  for (const i of sorted) {
    if (!dupNo[i]) dupNo[i] = groupNo;
    if (!dupKind[i]) dupKind[i] = label;
    else if (!dupKind[i].includes(label)) dupKind[i] += ', ' + label;

    if (i === winner) {
      if (!keep[i] || keep[i] === 'оставить') {
        keep[i] = 'оставить';
        const extra = `дубль ${label} в «${cat}» · оставить`;
        reasons[i] = reasons[i] ? reasons[i] + '; ' + extra : extra;
      }
    } else {
      keep[i] = 'удалить';
      const w = enriched[winner];
      const why = `дубль ${label} в «${cat}» → оставить ${w.article || w.code || w.id}`;
      reasons[i] = reasons[i] ? reasons[i] + '; ' + why : why;
    }
  }
}

for (const [, idxs] of byArticle) markDupGroup(idxs, 'артикул');
for (const [, idxs] of byCode) markDupGroup(idxs, 'код');
for (const [, idxs] of byName) markDupGroup(idxs, 'название');

/** Серия MR* (MRA, MRJ, …) — всегда оставляем */
function isMrSeries(r) {
  const keys = [r.article, r.code, r.sku, r.barcode, r.array_sku];
  return keys.some((v) => /^MR/i.test(String(v || '').trim()));
}

for (let i = 0; i < enriched.length; i++) {
  const r = enriched[i];
  if (isMrSeries(r)) {
    keep[i] = 'оставить';
    reasons[i] = reasons[i]
      ? reasons[i].replace(/;\s*нет в заказах и на остатках/g, '') + '; серия MR — не удаляем'
      : 'серия MR — не удаляем';
    continue;
  }
  const errs = [];
  if (!r.name.trim()) errs.push('пустое название');
  if (!r.article.trim() && !r.code.trim()) errs.push('нет артикула и кода');
  if (!r.article.trim()) errs.push('нет артикула');
  if (!r.is_active && r.deals === 0 && r.lines === 0 && r.stock <= 0) {
    errs.push('неактивен и не используется');
  }
  if (errs.length) {
    if (keep[i] !== 'оставить' || r.deals === 0) {
      if (keep[i] !== 'удалить') keep[i] = 'удалить';
      reasons[i] = reasons[i] ? reasons[i] + '; ' + errs.join(', ') : errs.join(', ');
    } else {
      reasons[i] = reasons[i] ? reasons[i] + '; ошибка: ' + errs.join(', ') : 'ошибка: ' + errs.join(', ');
    }
  }
  if (!keep[i]) {
    if (r.deals > 0 || r.lines > 0 || r.stock > 0) {
      keep[i] = 'оставить';
      reasons[i] = reasons[i] || (r.deals > 0 ? 'есть в заказах' : r.stock > 0 ? 'есть остаток' : 'есть строки');
    } else {
      keep[i] = 'удалить';
      reasons[i] = reasons[i] || 'нет в заказах и на остатках';
    }
  }
}

const out = enriched
  .map((r, i) => ({
    id: r.id,
    article: r.article,
    sku: r.sku,
    code: r.code,
    name: r.name,
    brand: r.brand,
    category: r.category,
    unit: r.unit,
    is_active: r.is_active,
    barcode: r.barcode,
    array_sku: r.array_sku,
    deals: r.deals,
    lines: r.lines,
    stock: r.stock,
    recommendation: keep[i],
    reason: reasons[i],
    dup_no: dupNo[i] || '',
    dup_kind: dupKind[i] || '',
    dup_article:
      (byArticle.get(`${r.category_norm}||${r.article_norm}`)?.length || 0) > 1 ? 1 : 0,
    dup_code: (byCode.get(`${r.category_norm}||${r.code_norm}`)?.length || 0) > 1 ? 1 : 0,
    dup_name:
      (byName.get(
        r.name_norm.length >= 4 ? `${r.category_norm}||${r.name_norm}` : ''
      )?.length || 0) > 1
        ? 1
        : 0,
  }))
  .sort((a, b) => {
    const an = Number(a.dup_no) || 0;
    const bn = Number(b.dup_no) || 0;
    if (an && bn && an !== bn) return an - bn;
    if (an && !bn) return -1;
    if (!an && bn) return 1;
    const c = String(a.category || '').localeCompare(String(b.category || ''), 'ru');
    if (c) return c;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  });

const json = JSON.stringify(out);
if (outPath) {
  fs.writeFileSync(outPath, json);
  console.error(`OK ${out.length} products → ${outPath}`);
  console.error(
    `оставить ${out.filter((x) => x.recommendation === 'оставить').length}, удалить ${out.filter((x) => x.recommendation === 'удалить').length}`
  );
} else {
  process.stdout.write(json);
}
