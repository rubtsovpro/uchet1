#!/usr/bin/env node
/**
 * Импорт основных товаров с листа «Закупка Миша Клод» → вкладка «Номенклатура».
 * Ключ карточки: номер + категория (у компрессоров и амортизаторов номера могут совпадать).
 *
 *   node --experimental-sqlite bin/import-misha-mraer.mjs /tmp/nomen-masters.json
 *   node --experimental-sqlite bin/import-misha-mraer.mjs /tmp/nomen-masters.json --apply
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const apply = process.argv.includes('--apply');
const jsonPath = process.argv.find((a) => a.endsWith('.json')) || '/tmp/nomen-masters.json';
const dbPath =
  process.env.WMS_SQLITE ||
  `${process.env.WMS_DATA_DIR || '/root/1c_pnevmopodveska1_ru/warehouse/data'}/warehouse.sqlite`;

const masters = JSON.parse(readFileSync(jsonPath, 'utf8'));
if (!Array.isArray(masters) || !masters.length) {
  console.error('Пустой JSON мастеров');
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 60000');
db.exec('PRAGMA foreign_keys = ON');

const all = (sql, params = []) => db.prepare(sql).all(...params);
const get = (sql, params = []) => db.prepare(sql).get(...params) || null;
const run = (sql, params = []) => db.prepare(sql).run(...params);

const prodCols = all(`PRAGMA table_info(products)`).map((c) => c.name);
if (!prodCols.includes('warehouse_sku')) {
  db.exec(`ALTER TABLE products ADD COLUMN warehouse_sku TEXT NOT NULL DEFAULT ''`);
}

function norm(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/Ё/g, 'Е');
}

function normCat(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function splitCodes(raw) {
  return String(raw || '')
    .split(/[,;|/\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function mergeArraySku(existing, extras) {
  const set = new Set();
  for (const x of [...splitCodes(existing), ...extras]) {
    const n = x.trim();
    if (n) set.add(n);
  }
  return [...set].join(', ');
}

function parsePrice(raw) {
  const s = String(raw || '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const MARK_PREFIXES = [
  ['mercedes-benz', 'Mercedes'],
  ['mercedes benz', 'Mercedes'],
  ['mercedes', 'Mercedes'],
  ['land rover', 'Land Rover'],
  ['rolls-royce', 'Rolls-Royce'],
  ['rolls royce', 'Rolls-Royce'],
  ['alfa romeo', 'Alfa Romeo'],
  ['great wall', 'Great Wall'],
  ['range rover', 'Land Rover'],
];

function takeMark(text) {
  const raw = String(text || '')
    .replace(/^[:\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return { mark: '', rest: '' };
  const low = raw.toLowerCase();
  for (const [prefix, mark] of MARK_PREFIXES) {
    if (low === prefix || low.startsWith(prefix + ' ') || low.startsWith(prefix + ':')) {
      return { mark, rest: raw.slice(prefix.length).replace(/^[:\s]+/, '').trim() };
    }
  }
  const m = raw.match(/^([A-Za-zА-Яа-яЁё-]+):?\s*(.*)$/);
  if (!m) return { mark: raw.replace(/:$/, ''), rest: '' };
  let mark = m[1].replace(/:$/, '');
  if (/^mercedes/i.test(mark)) mark = 'Mercedes';
  return { mark, rest: String(m[2] || '').trim() };
}

function splitModelGen(raw) {
  let s = String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+\d+(?:\.\d+)?\s*$/, '')
    .trim();
  if (!s) return { model: '', only_model: '', generation: '' };
  let m = s.match(/^(.*?)\s+([IVX]+)\s*(\([^)]+\))\s*$/i);
  if (m?.[1]?.trim()) {
    const only = m[1].trim();
    const generation = `${m[2]} ${m[3]}`.replace(/\s+/g, ' ').trim();
    return { model: `${only} ${generation}`, only_model: only, generation };
  }
  m = s.match(/^(.*?)\s+([IVX]+)\s*$/i);
  if (m?.[1]?.trim()) {
    return { model: s, only_model: m[1].trim(), generation: m[2] };
  }
  m = s.match(/^(.*?)\s+\(([IVX]+)\)\s*$/i);
  if (m?.[1]?.trim()) {
    return { model: s, only_model: m[1].trim(), generation: m[2] };
  }
  return { model: s, only_model: s, generation: '' };
}

const YEAR_RE = /\b((?:19|20)\d{2}(?:\s*[-–—]\s*(?:(?:19|20)\d{2}|н\.?\s*в\.?))?)\b/i;

const KNOWN_MARKS = new Set(
  [
    ...MARK_PREFIXES.flatMap(([p, m]) => [p, m.toLowerCase()]),
    'audi',
    'bmw',
    'porsche',
    'volkswagen',
    'vw',
    'bentley',
    'lexus',
    'toyota',
    'volvo',
    'jaguar',
    'cadillac',
    'infiniti',
    'hyundai',
    'jeep',
    'tesla',
    'chevrolet',
    'ford',
    'kia',
    'maybach',
    'acura',
    'lixiang',
    'dodge',
    'gmc',
    'nissan',
    'zeekr',
    'lincoln',
    'genesis',
    'lamborghini',
    'seat',
    'voyah',
    'hongqi',
    'maserati',
    'renault',
    'mini',
    'honda',
    'mazda',
    'subaru',
    'skoda',
    'opel',
    'fiat',
    'chrysler',
    'haval',
    'chery',
    'geely',
    'byd',
  ].map((x) => x.toLowerCase())
);

function isKnownMark(mark) {
  return KNOWN_MARKS.has(String(mark || '').toLowerCase());
}

function parseOneApp(part, inheritMark = '') {
  const chunk = String(part || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!chunk) return [];
  const yearsM = chunk.match(YEAR_RE);
  const years = yearsM ? yearsM[1].replace(/\s+/g, '') : '';
  const left = yearsM ? chunk.replace(yearsM[0], ' ').replace(/\s+/g, ' ').trim() : chunk;
  let { mark, rest } = takeMark(left);
  if (inheritMark && mark && !isKnownMark(mark)) {
    rest = [mark, rest].filter(Boolean).join(' ');
    mark = inheritMark;
  }
  if (!mark && inheritMark) mark = inheritMark;
  const { model, only_model, generation } = splitModelGen(rest);
  if (!mark) return [];
  return [{ mark, model: model || rest, only_model, generation, years, _inherit: mark }];
}

function parseApps(raw) {
  const out = [];
  const seen = new Set();
  for (const block of String(raw || '').split('|')) {
    let inherit = '';
    for (const part of block.split(';')) {
      const rows = parseOneApp(part, inherit);
      for (const row of rows) {
        inherit = row._inherit || inherit;
        const key = [row.mark, row.model, row.years].join('|').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          mark: row.mark,
          model: row.model,
          only_model: row.only_model,
          generation: row.generation,
          years: row.years,
        });
      }
    }
  }
  return out;
}

function appsFromColumns(m) {
  const years = String(m.years || '').replace(/\s+/g, '');
  const marks = String(m.brands || '')
    .split(/[,;|]/)
    .map((x) => takeMark(x).mark || x.trim())
    .filter(Boolean);
  const models = String(m.model || '')
    .split(/\s*[/|]\s*/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  const markList = marks.length ? marks : [''];
  const modelList = models.length ? models : [''];
  for (const mark of markList) {
    for (const modelRaw of modelList) {
      if (!mark && !modelRaw) continue;
      const { model, only_model, generation } = splitModelGen(modelRaw);
      const key = [mark, model || modelRaw, years].join('|').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        mark: mark || firstBrand(m.brands),
        model: model || modelRaw,
        only_model,
        generation,
        years,
      });
    }
  }
  return out.filter((a) => a.mark);
}

function sheetApps(m) {
  const fromApps = parseApps(m.apps);
  return fromApps.length ? fromApps : appsFromColumns(m);
}

function firstBrand(raw) {
  const s = String(raw || '')
    .split(/[/;,|]/)[0]
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  if (/^mercedes/i.test(s)) return 'Mercedes';
  return s;
}

function cleanProp(raw) {
  const s = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || s === '—' || s === '-' || s === '–') return '';
  return s;
}

const unitId =
  get(`SELECT id FROM units WHERE short_name = ? LIMIT 1`, ['шт'])?.id ||
  get(`SELECT id FROM units LIMIT 1`)?.id ||
  '';
if (!unitId) {
  console.error('Нет единицы измерения');
  process.exit(1);
}

const catCache = new Map();
function ensureCategory(name) {
  const key = String(name || '').trim();
  if (!key) return null;
  const low = normCat(key);
  if (catCache.has(low)) return catCache.get(low);
  let row = get(`SELECT id FROM categories WHERE lower(trim(name)) = lower(?) LIMIT 1`, [key]);
  if (!row) {
    if (!apply) {
      catCache.set(low, 'new-cat');
      return 'new-cat';
    }
    const id = randomUUID();
    run(`INSERT INTO categories (id, name, parent_id) VALUES (?, ?, NULL)`, [id, key]);
    row = { id };
  }
  catCache.set(low, row.id);
  return row.id;
}

/** Ищем только в той же категории. Номер без категории — другой товар. */
function findByKey(codes, catName) {
  const uniq = [...new Set(codes.map(norm).filter(Boolean))];
  const cat = normCat(catName);
  for (const c of uniq) {
    const hit = get(
      `SELECT p.id, p.sku, IFNULL(p.code,'') AS code, IFNULL(p.array_sku,'') AS array_sku, p.name,
              lower(trim(IFNULL(cat.name,''))) AS cat
       FROM products p
       LEFT JOIN categories cat ON cat.id = p.category_id
       WHERE (upper(replace(p.sku,' ','')) = ? OR upper(replace(IFNULL(p.code,''),' ','')) = ?)
         AND lower(trim(IFNULL(cat.name,''))) = ?
       ORDER BY IFNULL(p.is_main,0) DESC, IFNULL(p.is_active,1) DESC
       LIMIT 1`,
      [c, c, cat]
    );
    if (hit) return hit;
  }
  for (const c of uniq) {
    const hit = get(
      `SELECT p.id, p.sku, IFNULL(p.code,'') AS code, IFNULL(p.array_sku,'') AS array_sku, p.name,
              lower(trim(IFNULL(cat.name,''))) AS cat
       FROM products p
       LEFT JOIN categories cat ON cat.id = p.category_id
       WHERE (upper(replace(p.sku,' ','')) = ? OR upper(replace(IFNULL(p.code,''),' ','')) = ?)
         AND (p.category_id IS NULL OR trim(IFNULL(cat.name,'')) = '')
       ORDER BY IFNULL(p.is_main,0) DESC, IFNULL(p.is_active,1) DESC
       LIMIT 1`,
      [c, c]
    );
    if (hit) return hit;
  }
  return null;
}

function upsertProp(productId, property, value) {
  const prop = String(property || '').trim();
  const val = cleanProp(value);
  if (!productId || !prop) return;
  const existing = get(
    `SELECT id FROM product_properties WHERE product_id = ? AND property = ? LIMIT 1`,
    [productId, prop]
  );
  if (!val) {
    if (existing) run(`DELETE FROM product_properties WHERE id = ?`, [existing.id]);
    return;
  }
  if (existing) {
    run(`UPDATE product_properties SET value = ? WHERE id = ?`, [val, existing.id]);
  } else {
    run(`INSERT INTO product_properties (id, product_id, property, value) VALUES (?,?,?,?)`, [
      randomUUID(),
      productId,
      prop,
      val,
    ]);
  }
}

function replaceApps(productId, apps) {
  run(`DELETE FROM product_applicability WHERE product_id = ?`, [productId]);
  const seen = new Set();
  for (const app of apps) {
    const mark = String(app.mark || '').trim();
    if (!mark) continue;
    const model = String(app.model || '').trim();
    const onlyModel = String(app.only_model || '').trim();
    const generation = String(app.generation || '').trim();
    const years = String(app.years || '').trim();
    const key = [mark, model, onlyModel, generation, years].join('|').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    run(
      `INSERT INTO product_applicability (id, product_id, mark, model, only_model, generation, years)
       VALUES (?,?,?,?,?,?,?)`,
      [randomUUID(), productId, mark, model, onlyModel, generation, years]
    );
  }
}

function upsertRetailPrice(productId, price) {
  if (!(price > 0)) return;
  const existing = get(
    `SELECT id FROM product_prices WHERE product_id = ? AND price_type = ? LIMIT 1`,
    [productId, 'Розничная цена']
  );
  if (existing) {
    run(`UPDATE product_prices SET price = ? WHERE id = ?`, [price, existing.id]);
  } else {
    run(`INSERT INTO product_prices (id, product_id, price_type, price) VALUES (?,?,?,?)`, [
      randomUUID(),
      productId,
      'Розничная цена',
      price,
    ]);
  }
}

const stats = {
  sheet: masters.length,
  skipped_no_mraer: 0,
  matched: 0,
  created: 0,
  updated: 0,
  with_price: 0,
  with_old_sku: 0,
  apps_rows: 0,
  apps_empty: 0,
};

if (apply) db.exec('BEGIN');

try {
  for (const m of masters) {
    const sku = String(m.sku || '').trim();
    if (!sku || !/^MRA/i.test(sku)) {
      stats.skipped_no_mraer += 1;
      continue;
    }
    const catName = String(m.cat || '').trim();
    const nfCodes = splitCodes(m.nf);
    const oldCodes = splitCodes(m.old);
    const hit = findByKey([sku, ...oldCodes, ...nfCodes], catName);
    const name = String(m.name || '').trim() || sku;
    const brand = firstBrand(m.brands);
    const crosses = [
      sku,
      ...nfCodes,
      ...oldCodes,
      m.oe,
      m.mra_t,
      m.mra_tnk,
      m.mra_x,
      m.mra_w,
      m.mra_g,
      m.mra_j,
      ...splitCodes(m.crosses),
    ];
    const warehouseSku = oldCodes.filter((c) => norm(c) !== norm(sku)).join('; ');
    const price = parsePrice(m.price);
    if (price) stats.with_price += 1;
    if (warehouseSku) stats.with_old_sku += 1;
    const catId = ensureCategory(catName);
    const apps = sheetApps(m);
    if (apps.length) stats.apps_rows += apps.length;
    else stats.apps_empty += 1;

    if (!apply) {
      if (hit) stats.matched += 1;
      else stats.created += 1;
      continue;
    }

    let id;
    if (hit) {
      id = hit.id;
      const arraySku = mergeArraySku(hit.array_sku, crosses);
      const code = String(hit.code || '').trim() || nfCodes[0] || sku;
      const hitSku = String(hit.sku || '').trim();
      const skuTaken = get(
        `SELECT p.id FROM products p
         LEFT JOIN categories cat ON cat.id = p.category_id
         WHERE upper(replace(p.sku,' ','')) = upper(replace(?, ' ',''))
           AND p.id != ?
           AND lower(trim(IFNULL(cat.name,''))) = ?
         LIMIT 1`,
        [sku, id, normCat(catName)]
      );
      const canTakeSku =
        !skuTaken &&
        (norm(hitSku) === norm(sku) ||
          /^НФ-/i.test(hitSku) ||
          /^00-/i.test(hitSku) ||
          oldCodes.some((c) => norm(c) === norm(hitSku)));
      const nextSku = canTakeSku ? sku : hitSku;
      run(
        `UPDATE products SET
           sku = ?,
           name = ?,
           brand = CASE WHEN trim(IFNULL(brand,'')) = '' AND ? != '' THEN ? ELSE brand END,
           array_sku = ?,
           warehouse_sku = ?,
           code = ?,
           category_id = COALESCE(?, category_id),
           is_active = 1,
           is_main = 1,
           item_kind = CASE WHEN IFNULL(item_kind,'') = '' THEN 'product' ELSE item_kind END
         WHERE id = ?`,
        [nextSku, name, brand, brand, arraySku, warehouseSku, code, catId, id]
      );
      stats.matched += 1;
      stats.updated += 1;
    } else {
      id = randomUUID();
      run(
        `INSERT INTO products (
           id, sku, name, category_id, unit_id, barcode, item_kind, code, brand, array_sku,
           warehouse_sku, is_active, is_main
         ) VALUES (?,?,?,?,?, '','product', ?, ?, ?, ?, 1, 1)`,
        [
          id,
          sku,
          name,
          catId,
          unitId,
          nfCodes[0] || sku,
          brand,
          mergeArraySku('', crosses),
          warehouseSku,
        ]
      );
      stats.created += 1;
    }

    upsertProp(id, 'Ось', m.axis);
    upsertProp(id, 'Сторона', m.side);
    upsertProp(id, 'Привод', m.drive);
    upsertProp(id, 'Тип / исполнение', m.typ);
    upsertProp(id, 'Кузова', m.bodies);
    upsertProp(id, 'Оригинальный номер', m.oe);
    replaceApps(id, apps);
    upsertRetailPrice(id, price);
  }

  if (apply) db.exec('COMMIT');
} catch (e) {
  if (apply) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
  }
  throw e;
}

console.log(
  JSON.stringify(
    {
      apply,
      db: dbPath,
      ...stats,
    },
    null,
    2
  )
);
