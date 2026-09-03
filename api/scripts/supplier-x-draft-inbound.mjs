/**
 * Поставщик X — черновик прихода по Excel «по факту».
 *
 * 1) Артикул строки = колонка «по факту»
 * 2) Если есть «старый номер» — на карточке по факту добавить старый в warehouse_sku / array_sku
 * 3) Дубли факта — отдельные строки документа
 * 4) Поставщик X / склад Основной / орг. Рома (МСК)
 * 5) Цены в приходе = 0
 *
 * Usage on VPS:
 *   set -a; source /etc/warehouse-wms.env; set +a
 *   cd /root/1c_pnevmopodveska1_ru/warehouse/api
 *   node scripts/supplier-x-draft-inbound.mjs /tmp/supplier_x_lines.json
 *   node scripts/supplier-x-draft-inbound.mjs /tmp/supplier_x_lines.json --apply
 */
import fs from 'node:fs';
import { all, get, run } from '../dist/db.js';
import { createDocument } from '../dist/stock.js';
import { ensureSeqAtLeast, newGuid, nextCode } from '../dist/ids.js';

const MAIN = 'b7142cc4-2b3a-11ec-80bf-00155d3d52d2';
const CP = 'c0de0a47-d714-43f8-b0e5-654760a43efc'; // Поставщик X (лист закупки)
const ORG = '8e2d4c6e-5e47-4ee5-9cf8-e25822776c5f'; // ИП Безматерных Р.П. (МСК)
const COMMENT = 'Поставщик X · приход по факту · черновик (цены не заполняем)';

/** Новые карточки: факт → источник клонирования (ближайший аналог MRAER). */
const CLONE_FROM = {
  MRAA21718: 'MRAA21118',
  MRAA21719: 'MRAA21119',
  MRAE12718: 'MRAE12118',
};

const path = process.argv[2] || '/tmp/supplier_x_lines.json';
const apply = process.argv.includes('--apply');

function norm(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function splitCodes(s) {
  return String(s || '')
    .split(/[,;|/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function joinComma(parts) {
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const k = norm(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(p).trim());
  }
  return out.join(',');
}

function joinSemi(parts) {
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const k = norm(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(p).trim());
  }
  return out.join(';');
}

function findCleanProduct(sku) {
  const k = norm(sku);
  const rows = all(
    `SELECT id, sku, code, name, brand, category_id, unit_id,
            IFNULL(array_sku,'') AS array_sku,
            IFNULL(warehouse_sku,'') AS warehouse_sku,
            IFNULL(barcode,'') AS barcode,
            IFNULL(gtin,'') AS gtin,
            IFNULL(item_kind,'product') AS item_kind,
            IFNULL(is_active,1) AS is_active,
            package_width_cm, package_height_cm, package_length_cm, package_weight_g,
            IFNULL(requires_marking,0) AS requires_marking,
            IFNULL(serial_tracked,0) AS serial_tracked,
            IFNULL(min_stock,0) AS min_stock,
            IFNULL(install_price,0) AS install_price,
            IFNULL(notupload,0) AS notupload,
            IFNULL(is_main,0) AS is_main
     FROM products
     WHERE upper(replace(IFNULL(sku,''),' ','')) = ?
     ORDER BY
       CASE WHEN id LIKE 'pnevmopodveska%' THEN 2 ELSE 0 END,
       CASE WHEN sku LIKE '%:%' THEN 1 ELSE 0 END,
       CASE WHEN upper(IFNULL(brand,'')) = 'MRAER' THEN 0 ELSE 1 END,
       length(sku)
     LIMIT 5`,
    [k]
  );
  return rows[0] || null;
}

function twinId(productId) {
  const id = String(productId || '');
  if (id.startsWith('pnevmopodveska_2025::')) return id;
  return `pnevmopodveska_2025::${id}`;
}

function copyChildRows(table, cols, fromId, toId) {
  const rows = all(`SELECT * FROM ${table} WHERE product_id = ?`, [fromId]);
  for (const row of rows) {
    const id = newGuid();
    const values = cols.map((c) => {
      if (c === 'id') return id;
      if (c === 'product_id') return toId;
      return row[c];
    });
    run(
      `INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      values
    );
  }
  return rows.length;
}

function cloneProduct(newSku, fromSku) {
  const existing = findCleanProduct(newSku);
  if (existing) return { product: existing, created: false };

  const src = findCleanProduct(fromSku);
  if (!src) throw new Error(`clone source missing: ${fromSku} → ${newSku}`);

  const mx = get(
    `SELECT MAX(CAST(substr(v, instr(v, '-') + 1) AS INTEGER)) AS m FROM (
       SELECT sku AS v FROM products WHERE sku LIKE 'НФ-%'
       UNION ALL
       SELECT code AS v FROM products WHERE code LIKE 'НФ-%'
     )`
  )?.m;
  if (mx && Number.isFinite(Number(mx))) ensureSeqAtLeast('НФ', Number(mx));

  const id = newGuid();
  const code = nextCode('НФ');
  const arraySku = joinComma([...splitCodes(src.array_sku), newSku, fromSku]);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  run(
    `INSERT INTO products (
       id, sku, name, category_id, unit_id, barcode, is_active, created_at, brand, code,
       array_sku, notupload, package_width_cm, package_height_cm, package_length_cm, package_weight_g,
       gtin, requires_marking, min_stock, serial_tracked, item_kind, install_price,
       is_main, warehouse_sku
     ) VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      newSku,
      src.name,
      src.category_id,
      src.unit_id,
      newSku,
      now,
      src.brand || 'MRAER',
      code,
      arraySku,
      src.notupload || 0,
      src.package_width_cm,
      src.package_height_cm,
      src.package_length_cm,
      src.package_weight_g,
      src.gtin || '',
      src.requires_marking || 0,
      src.min_stock || 0,
      src.serial_tracked || 0,
      src.item_kind || 'product',
      src.install_price || 0,
      0,
      '',
    ]
  );

  const twin = twinId(src.id);
  const twinExists = !!get(`SELECT id FROM products WHERE id = ?`, [twin]);
  const appFrom =
    twinExists &&
    get(`SELECT product_id FROM product_applicability WHERE product_id = ? LIMIT 1`, [twin])
      ? twin
      : src.id;
  const priceFrom =
    twinExists &&
    get(`SELECT product_id FROM product_prices WHERE product_id = ? LIMIT 1`, [twin])
      ? twin
      : src.id;
  const propFrom =
    twinExists &&
    get(`SELECT product_id FROM product_properties WHERE product_id = ? LIMIT 1`, [twin])
      ? twin
      : src.id;

  const apps = copyChildRows(
    'product_applicability',
    ['id', 'product_id', 'mark', 'model', 'only_model', 'generation', 'years'],
    appFrom,
    id
  );
  const prices = copyChildRows(
    'product_prices',
    ['id', 'product_id', 'price_type', 'price'],
    priceFrom,
    id
  );
  const props = copyChildRows(
    'product_properties',
    ['id', 'product_id', 'property', 'value'],
    propFrom,
    id
  );

  const mediaSrc = all(
    `SELECT * FROM product_media WHERE product_id = ? AND IFNULL(kind,'') != 'empty'`,
    [src.id]
  );
  for (const m of mediaSrc) {
    const suffix = String(m.id || '').includes('|')
      ? String(m.id).split('|').slice(1).join('|')
      : newGuid();
    const mid = `${id}|${suffix}`;
    run(
      `INSERT OR IGNORE INTO product_media
        (id, product_id, kind, mime, ext, s3_key, url, size, sha256, sort_order, synced_at, width, height, orientation)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        mid,
        id,
        m.kind,
        m.mime,
        m.ext,
        m.s3_key,
        m.url,
        m.size,
        m.sha256,
        m.sort_order,
        m.synced_at,
        m.width,
        m.height,
        m.orientation,
      ]
    );
  }

  return {
    product: findCleanProduct(newSku),
    created: true,
    meta: { id, code, from: fromSku, apps, prices, props, media: mediaSrc.length },
  };
}

function ensureOldOnCard(productId, oldSku) {
  const p = get(
    `SELECT id, IFNULL(array_sku,'') AS array_sku, IFNULL(warehouse_sku,'') AS warehouse_sku
     FROM products WHERE id = ?`,
    [productId]
  );
  if (!p) return { changed: false };
  const asku = joinComma([...splitCodes(p.array_sku), oldSku]);
  const wsku = joinSemi([...splitCodes(p.warehouse_sku), oldSku]);
  const changed = asku !== p.array_sku || wsku !== p.warehouse_sku;
  if (changed) {
    run(`UPDATE products SET array_sku = ?, warehouse_sku = ? WHERE id = ?`, [
      asku,
      wsku,
      productId,
    ]);
  }
  return { changed, array_sku: asku, warehouse_sku: wsku };
}

const linesRaw = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!Array.isArray(linesRaw) || !linesRaw.length) {
  console.error('empty lines');
  process.exit(1);
}

const already = get(
  `SELECT id, number, comment, posted FROM stock_docs
   WHERE doc_type = 'in' AND comment LIKE ?
   ORDER BY created_at DESC LIMIT 1`,
  ['%Поставщик X · приход по факту%']
);
if (already?.id) {
  console.error('Уже есть документ:', already.number, 'posted=', already.posted, already.comment);
  process.exit(2);
}

const plan = {
  apply,
  clones_needed: [],
  remaps: [],
  lines: [],
  missing: [],
  total_qty: 0,
};

for (const [newSku, fromSku] of Object.entries(CLONE_FROM)) {
  const existing = findCleanProduct(newSku);
  const src = findCleanProduct(fromSku);
  plan.clones_needed.push({
    sku: newSku,
    from: fromSku,
    exists: !!existing,
    source_ok: !!src,
    source_id: src?.id || null,
    existing_id: existing?.id || null,
  });
}

for (const line of linesRaw) {
  const fact = String(line.fact || line.sku || '').trim();
  const qty = Number(line.qty) || 0;
  const old = String(line.old || '').trim();
  if (!fact || !(qty > 0)) continue;

  let p = findCleanProduct(fact);
  if (!p && CLONE_FROM[fact]) {
    // будет создан при apply
    p = null;
  }
  if (!p && !CLONE_FROM[fact]) {
    plan.missing.push({ row: line.row, fact, qty, old });
    continue;
  }

  if (old) {
    plan.remaps.push({ fact, old, product_id: p?.id || null });
  }

  plan.lines.push({
    row: line.row,
    fact,
    qty,
    old: old || null,
    product_id: p?.id || null,
    product_sku: p?.sku || fact,
    product_name: p?.name || null,
    will_clone: !p && !!CLONE_FROM[fact],
  });
  plan.total_qty += qty;
}

console.log(
  JSON.stringify(
    {
      dry_run: !apply,
      lines: plan.lines.length,
      total_qty: plan.total_qty,
      missing: plan.missing,
      clones_needed: plan.clones_needed,
      remaps: plan.remaps,
      sample_lines: plan.lines.slice(0, 5),
    },
    null,
    2
  )
);

if (plan.missing.length) {
  console.error('Есть несматченные позиции — стоп');
  process.exit(3);
}

if (!apply) {
  console.log('OK dry-run. Запуск с --apply для записи.');
  process.exit(0);
}

try {
  const created = [];
  for (const [newSku, fromSku] of Object.entries(CLONE_FROM)) {
    const r = cloneProduct(newSku, fromSku);
    if (r.created) created.push({ sku: newSku, ...r.meta, id: r.product?.id });
  }

  const remapped = [];
  const seenRemap = new Set();
  for (const line of plan.lines) {
    if (!line.old) continue;
    const key = `${line.fact}|${line.old}`;
    if (seenRemap.has(key)) continue;
    seenRemap.add(key);
    const p = findCleanProduct(line.fact);
    if (!p) throw new Error('remap target missing ' + line.fact);
    const r = ensureOldOnCard(p.id, line.old);
    remapped.push({ fact: line.fact, old: line.old, product_id: p.id, ...r });
  }

  const docLines = [];
  for (const line of plan.lines) {
    const p = findCleanProduct(line.fact);
    if (!p?.id) throw new Error('product missing after clone: ' + line.fact);
    docLines.push({
      product_id: p.id,
      qty: line.qty,
      price: 0,
    });
  }

  const docId = createDocument({
    doc_type: 'in',
    warehouse_id: MAIN,
    counterparty_id: CP,
    organization_id: ORG,
    comment: COMMENT,
    lines: docLines,
    post: false,
  });

  const doc = get(
    `SELECT id, number, posted, comment, counterparty_id, warehouse_id, organization_id
     FROM stock_docs WHERE id = ?`,
    [docId]
  );
  const lineCount = get(
    `SELECT COUNT(*) AS c, SUM(qty) AS qty FROM stock_doc_lines WHERE doc_id = ?`,
    [docId]
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        doc,
        lineCount,
        created,
        remapped,
      },
      null,
      2
    )
  );
} catch (e) {
  console.error('FAILED', e);
  process.exit(1);
}
