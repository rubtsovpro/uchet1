#!/usr/bin/env node
/**
 * Старые MRAER / НФ с листа → слить архивные карточки в мастера.
 * Ключ слияния: номер + категория (компрессор и амортизатор с одним номером — разные товары).
 *
 *   node --experimental-sqlite bin/merge-old-sku-into-masters.mjs /tmp/nomen-merge.json
 *   node --experimental-sqlite bin/merge-old-sku-into-masters.mjs /tmp/nomen-merge.json --apply
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const apply = process.argv.includes('--apply');
const jsonPath = process.argv.find((a) => a.endsWith('.json')) || '/tmp/nomen-merge.json';
const dbPath =
  process.env.WMS_SQLITE ||
  `${process.env.WMS_DATA_DIR || '/root/1c_pnevmopodveska1_ru/warehouse/data'}/warehouse.sqlite`;

const payload = JSON.parse(readFileSync(jsonPath, 'utf8'));
const masters = payload.masters || payload;
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 60000');
db.exec('PRAGMA foreign_keys = OFF');

const all = (sql, params = []) => db.prepare(sql).all(...params);
const get = (sql, params = []) => db.prepare(sql).get(...params) || null;
const run = (sql, params = []) => db.prepare(sql).run(...params);
const tableExists = (name) =>
  Boolean(get(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, [name]));

function norm(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/Ё/g, 'Е');
}
function splitCodes(raw) {
  return String(raw || '')
    .split(/[,;|/\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normCat(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

const masterSkus = new Set(masters.map((m) => norm(m.sku)).filter(Boolean));
const codeCats = new Map();
for (const m of masters) {
  const cat = normCat(m.cat);
  if (!cat) continue;
  for (const code of [...splitCodes(m.old), ...splitCodes(m.nf), m.sku].map(norm).filter(Boolean)) {
    const set = codeCats.get(code) || new Set();
    set.add(cat);
    codeCats.set(code, set);
  }
}

const byCode = new Map();
for (const p of all(
  `SELECT p.id, p.sku, IFNULL(p.code,'') AS code, lower(trim(IFNULL(c.name,''))) AS cat
   FROM products p LEFT JOIN categories c ON c.id = p.category_id`
)) {
  for (const k of [norm(p.sku), norm(p.code)]) {
    if (!k) continue;
    const list = byCode.get(k) || [];
    list.push(p);
    byCode.set(k, list);
  }
}

function findMasterId(sku, catName) {
  const n = norm(sku);
  const cat = normCat(catName);
  const hit = get(
    `SELECT p.id FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE upper(replace(p.sku,' ','')) = ?
       AND (? = '' OR lower(trim(IFNULL(c.name,''))) = ?)
     LIMIT 1`,
    [n, cat, cat]
  );
  return hit?.id || null;
}

const catCache = new Map();
function ensureCategory(name) {
  const key = String(name || '').trim();
  if (!key) return null;
  const low = key.toLowerCase();
  if (catCache.has(low)) return catCache.get(low);
  let row = get(`SELECT id FROM categories WHERE lower(trim(name)) = lower(?) LIMIT 1`, [key]);
  if (!row) {
    if (!apply) {
      catCache.set(low, 'new');
      return 'new';
    }
    const id = randomUUID();
    run(`INSERT INTO categories (id, name, parent_id) VALUES (?, ?, NULL)`, [id, key]);
    row = { id };
  }
  catCache.set(low, row.id);
  return row.id;
}

/** extraId → { masterId, masterSku, via } — только та же категория, что у номера на листе */
const pairs = new Map();
let skippedOtherCat = 0;
let skippedAmbiguous = 0;
for (const m of masters) {
  const masterCat = normCat(m.cat);
  const masterId = findMasterId(m.sku, m.cat);
  if (!masterId) continue;
  const oldSet = new Set(splitCodes(m.old).map(norm));
  const nfSet = new Set(splitCodes(m.nf).map(norm));
  for (const [via, set] of [
    ['old', oldSet],
    ['nf', nfSet],
  ]) {
    for (const code of set) {
      if (!code || masterSkus.has(code)) continue;
      const sheetCats = codeCats.get(code) || new Set();
      for (const p of byCode.get(code) || []) {
        if (p.id === masterId) continue;
        if (masterSkus.has(norm(p.sku))) continue;
        const extraCat = normCat(p.cat);
        if (extraCat && extraCat !== masterCat) {
          skippedOtherCat += 1;
          continue;
        }
        if (!extraCat && sheetCats.size > 1) {
          skippedAmbiguous += 1;
          continue;
        }
        const prev = pairs.get(p.id);
        if (!prev) {
          pairs.set(p.id, { masterId, masterSku: m.sku, via, extraSku: p.sku, cat: m.cat });
        } else if (prev.via === 'nf' && via === 'old' && prev.masterId === masterId) {
          pairs.set(p.id, { masterId, masterSku: m.sku, via, extraSku: p.sku, cat: m.cat });
        }
      }
    }
  }
}

function retarget(table, col, fromId, toId) {
  if (!tableExists(table)) return 0;
  try {
    const n = run(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`, [toId, fromId]);
    return Number(n.changes || 0);
  } catch {
    return 0;
  }
}

function mergeWarehouseQty(table, extraId, masterId) {
  if (!tableExists(table)) return;
  const extras = all(`SELECT * FROM ${table} WHERE product_id = ?`, [extraId]);
  for (const row of extras) {
    const wh = String(row.warehouse_id || '');
    const exist = get(
      `SELECT qty FROM ${table} WHERE product_id = ? AND warehouse_id = ? LIMIT 1`,
      [masterId, wh]
    );
    if (exist) {
      run(`UPDATE ${table} SET qty = IFNULL(qty,0) + ? WHERE product_id = ? AND warehouse_id = ?`, [
        Number(row.qty) || 0,
        masterId,
        wh,
      ]);
      run(`DELETE FROM ${table} WHERE product_id = ? AND warehouse_id = ?`, [extraId, wh]);
    } else {
      run(`UPDATE ${table} SET product_id = ? WHERE product_id = ? AND warehouse_id = ?`, [
        masterId,
        extraId,
        wh,
      ]);
    }
  }
}

function deleteProductShell(id) {
  for (const [t, col] of [
    ['product_applicability', 'product_id'],
    ['product_properties', 'product_id'],
    ['product_prices', 'product_id'],
    ['product_related', 'product_id'],
    ['product_media', 'product_id'],
    ['product_store_rests', 'product_id'],
    ['stock_balances', 'product_id'],
    ['supplier_product_apps', 'product_id'],
    ['product_dedup_members', 'product_id'],
    ['nomen_catalog_sheet', 'product_id'],
  ]) {
    if (tableExists(t)) {
      try {
        run(`DELETE FROM ${t} WHERE ${col} = ?`, [id]);
      } catch {
        /* ignore */
      }
    }
  }
  if (tableExists('product_related')) {
    try {
      run(`DELETE FROM product_related WHERE related_id = ?`, [id]);
    } catch {
      /* ignore */
    }
  }
  run(`DELETE FROM products WHERE id = ?`, [id]);
}

const stats = {
  apply,
  pairs: pairs.size,
  via_old: [...pairs.values()].filter((p) => p.via === 'old').length,
  via_nf: [...pairs.values()].filter((p) => p.via === 'nf').length,
  skipped_other_cat: skippedOtherCat,
  skipped_ambiguous: skippedAmbiguous,
  cats_fixed: 0,
  merged: 0,
  failed: 0,
};

if (apply) {
  db.exec('BEGIN');
  try {
    for (const m of masters) {
      const masterId = findMasterId(m.sku, m.cat);
      const catId = ensureCategory(m.cat);
      if (masterId && catId && catId !== 'new') {
        run(`UPDATE products SET category_id = ?, is_main = 1, is_active = 1 WHERE id = ?`, [
          catId,
          masterId,
        ]);
        stats.cats_fixed += 1;
      }
    }

    for (const [extraId, info] of pairs) {
      try {
        mergeWarehouseQty('stock_balances', extraId, info.masterId);
        mergeWarehouseQty('product_store_rests', extraId, info.masterId);
        retarget('stock_doc_lines', 'product_id', extraId, info.masterId);
        retarget('crm_deal_items', 'product_guid', extraId, info.masterId);
        retarget('sales_doc_lines', 'product_guid', extraId, info.masterId);
        retarget('warehouse_task_lines', 'product_id', extraId, info.masterId);
        retarget('inventory_sheet_lines', 'product_id', extraId, info.masterId);
        retarget('sto_wo_materials', 'product_id', extraId, info.masterId);
        retarget('product_lots', 'product_id', extraId, info.masterId);
        retarget('datamatrix_codes', 'product_id', extraId, info.masterId);
        retarget('product_units', 'product_id', extraId, info.masterId);
        retarget('supplier_order_lines', 'product_id', extraId, info.masterId);
        retarget('supplier_order_units', 'product_id', extraId, info.masterId);
        retarget('sto_transfer_request_lines', 'product_id', extraId, info.masterId);
        retarget('stock_reserves', 'product_id', extraId, info.masterId);
        retarget('purchase_basket_lines', 'product_id', extraId, info.masterId);
        retarget('stock_cell_balances', 'product_id', extraId, info.masterId);
        retarget('product_service_links', 'product_id', extraId, info.masterId);
        retarget('product_media', 'product_id', extraId, info.masterId);
        deleteProductShell(extraId);
        stats.merged += 1;
      } catch {
        stats.failed += 1;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
}

const sample = [...pairs.entries()].slice(0, 8).map(([id, p]) => ({
  extra: p.extraSku,
  master: p.masterSku,
  via: p.via,
  extra_id: id,
}));

console.log(JSON.stringify({ ...stats, sample }, null, 2));
