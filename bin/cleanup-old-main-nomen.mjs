#!/usr/bin/env node
/**
 * Удаляет СТАРУЮ основную номенклатуру.
 * Оставляет: услуги, не-основные, и основную из Google (MRAER мастер).
 *
 *   node --experimental-sqlite bin/cleanup-old-main-nomen.mjs /tmp/nomen-masters.json
 *   node --experimental-sqlite bin/cleanup-old-main-nomen.mjs /tmp/nomen-masters.json --apply
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const apply = process.argv.includes('--apply');
const jsonPath = process.argv.find((a) => a.endsWith('.json')) || '/tmp/nomen-masters.json';
const dbPath =
  process.env.WMS_SQLITE ||
  `${process.env.WMS_DATA_DIR || '/root/1c_pnevmopodveska1_ru/warehouse/data'}/warehouse.sqlite`;

const masters = JSON.parse(readFileSync(jsonPath, 'utf8'));
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 60000');
db.exec('PRAGMA foreign_keys = ON');

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

const keepCodes = new Set();
for (const m of masters) {
  const sku = String(m.sku || '').trim();
  if (!sku || !/^MRA/i.test(sku)) continue;
  keepCodes.add(norm(sku));
}

const products = all(
  `SELECT id, sku, IFNULL(code,'') AS code, name,
          IFNULL(item_kind,'product') AS item_kind,
          IFNULL(is_main,0) AS is_main,
          IFNULL(is_active,1) AS is_active
   FROM products`
);

function isService(p) {
  return (
    String(p.item_kind) === 'service' ||
    /ремонт/i.test(String(p.name || ''))
  );
}

function inGoogleMain(p) {
  const sku = norm(p.sku);
  const code = norm(p.code);
  return (sku && keepCodes.has(sku)) || (code && keepCodes.has(code));
}

function linkInfo(id) {
  const counts = {};
  const add = (key, sql, params) => {
    try {
      counts[key] = get(sql, params)?.c ?? 0;
    } catch {
      counts[key] = 0;
    }
  };
  add(
    'stock_doc_lines',
    `SELECT COUNT(*) AS c FROM stock_doc_lines WHERE product_id = ?`,
    [id]
  );
  add(
    'stock_balances',
    `SELECT COUNT(*) AS c FROM stock_balances WHERE product_id = ? AND ABS(qty) > 0.0000001`,
    [id]
  );
  add(
    'product_store_rests',
    `SELECT COUNT(*) AS c FROM product_store_rests WHERE product_id = ? AND ABS(qty) > 0.0000001`,
    [id]
  );
  if (tableExists('sales_doc_lines')) {
    add('sales_doc_lines', `SELECT COUNT(*) AS c FROM sales_doc_lines WHERE product_guid = ?`, [id]);
  }
  if (tableExists('warehouse_task_lines')) {
    add(
      'warehouse_task_lines',
      `SELECT COUNT(*) AS c FROM warehouse_task_lines WHERE product_id = ?`,
      [id]
    );
  }
  if (tableExists('sto_wo_materials')) {
    add('sto_wo_materials', `SELECT COUNT(*) AS c FROM sto_wo_materials WHERE product_id = ?`, [id]);
  }
  const stockish =
    (counts.stock_doc_lines || 0) +
    (counts.stock_balances || 0) +
    (counts.product_store_rests || 0) +
    (counts.sales_doc_lines || 0) +
    (counts.warehouse_task_lines || 0) +
    (counts.sto_wo_materials || 0);
  return { counts, stockish };
}

function hardDelete(id) {
  run('BEGIN');
  try {
    run('DELETE FROM product_applicability WHERE product_id = ?', [id]);
    run('DELETE FROM product_properties WHERE product_id = ?', [id]);
    run('DELETE FROM product_prices WHERE product_id = ?', [id]);
    run('DELETE FROM product_related WHERE product_id = ? OR related_id = ?', [id, id]);
    run('DELETE FROM product_media WHERE product_id = ?', [id]);
    run('DELETE FROM product_store_rests WHERE product_id = ?', [id]);
    run('DELETE FROM stock_balances WHERE product_id = ?', [id]);
    if (tableExists('supplier_product_apps')) {
      run('DELETE FROM supplier_product_apps WHERE product_id = ?', [id]);
    }
    run('DELETE FROM products WHERE id = ?', [id]);
    run('COMMIT');
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
}

const stats = {
  apply,
  google_masters: keepCodes.size,
  kept_google: 0,
  kept_non_main: 0,
  kept_service: 0,
  deleted: 0,
  archived: 0,
  delete_failed: 0,
};

const victims = [];
for (const p of products) {
  if (isService(p)) {
    stats.kept_service += 1;
    continue;
  }
  if (Number(p.is_main) !== 1) {
    stats.kept_non_main += 1;
    continue;
  }
  if (inGoogleMain(p)) {
    stats.kept_google += 1;
    continue;
  }
  victims.push(p);
}

if (apply) {
  for (const p of victims) {
    const links = linkInfo(p.id);
    try {
      if (links.stockish > 0) {
        run(`UPDATE products SET is_active = 0, is_main = 0 WHERE id = ?`, [p.id]);
        stats.archived += 1;
      } else {
        hardDelete(p.id);
        stats.deleted += 1;
      }
    } catch {
      stats.delete_failed += 1;
      try {
        run(`UPDATE products SET is_active = 0, is_main = 0 WHERE id = ?`, [p.id]);
        stats.archived += 1;
      } catch {
        /* ignore */
      }
    }
  }
} else {
  let wouldDelete = 0;
  let wouldArchive = 0;
  for (const p of victims) {
    const links = linkInfo(p.id);
    if (links.stockish > 0) wouldArchive += 1;
    else wouldDelete += 1;
  }
  stats.deleted = wouldDelete;
  stats.archived = wouldArchive;
}

console.log(
  JSON.stringify(
    {
      ...stats,
      old_main_to_remove: victims.length,
      sample: victims.slice(0, 8).map((p) => ({ sku: p.sku, name: String(p.name || '').slice(0, 60) })),
    },
    null,
    2
  )
);
