#!/usr/bin/env node
/**
 * Перенос инв. «Склад СТО Москва» в адресные ячейки основного склада + обнуление 00-000001.
 *
 * 1. php tools/fetch-sto-moscow-cells-migration.php
 * 2. node --experimental-sqlite bin/migrate-sto-moscow-to-cells.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache =
  process.env.WMS_STO_MIGRATION_CACHE ||
  path.join(root, 'data', 'sto-moscow-cells-migration.json');
const dryRun = process.argv.includes('--dry-run');

if (!fs.existsSync(cache)) {
  console.error('Нет файла', cache, '— сначала: php tools/fetch-sto-moscow-cells-migration.php');
  process.exit(1);
}

async function loadCellsMod() {
  const dist = path.join(root, 'api', 'dist', 'warehouse-cells.js');
  const src = path.join(root, 'api', 'src', 'warehouse-cells.ts');
  if (fs.existsSync(dist)) {
    return import(pathToFileURL(dist).href);
  }
  try {
    await import('tsx/esm');
  } catch {
    /* ignore */
  }
  return import(pathToFileURL(src).href);
}

const raw = JSON.parse(fs.readFileSync(cache, 'utf8'));
const mod = await loadCellsMod();
const { normalizeInventoryCell, importCellRows, CELLS_DEFAULT_WAREHOUSE_CODE } = mod;

const { get, run, all } = await import(
  pathToFileURL(path.join(root, 'api', 'dist', 'db.js')).href
).catch(async () => {
  try {
    await import('tsx/esm');
  } catch {
    /* ignore */
  }
  return import(pathToFileURL(path.join(root, 'api', 'src', 'db.ts')).href);
});

function whId(code) {
  const row = get('SELECT id, name FROM warehouses WHERE code = ? LIMIT 1', [code]);
  if (!row?.id) throw new Error(`Склад не найден: ${code}`);
  return String(row.id);
}

function lookupProduct(sku, code) {
  const s = String(sku || '').trim();
  const c = String(code || '').trim();
  if (s) {
    const bySku = get('SELECT id, sku, name FROM products WHERE sku = ? OR barcode = ? LIMIT 1', [
      s,
      s,
    ]);
    if (bySku?.id) return bySku;
  }
  if (c) {
    const byCode = get('SELECT id, sku, name FROM products WHERE code = ? LIMIT 1', [c]);
    if (byCode?.id) return byCode;
  }
  return null;
}

const stoCode = raw.sto_warehouse_code || '00-000001';
const mainCode = raw.main_warehouse_code || CELLS_DEFAULT_WAREHOUSE_CODE;
const stoWhId = whId(stoCode);
const mainWhId = whId(mainCode);

const importRows = [];
const transfers = [];
const unmatched = [];
const badCells = [];

for (const row of raw.rows || []) {
  const qty = Number(row.qty) || 0;
  if (qty <= 0) continue;
  const product = lookupProduct(row.sku, row.code);
  if (!product?.id) {
    unmatched.push({ num: row.num, sku: row.sku, code: row.code, name: row.name });
    continue;
  }
  const sku = String(product.sku || row.sku || '').trim();
  transfers.push({ product_id: String(product.id), sku, qty, num: row.num });

  const cellRaw = normalizeInventoryCell(String(row.cell || ''));
  if (!cellRaw) {
    badCells.push({ num: row.num, cell: row.cell, sku: row.sku });
    continue;
  }
  importRows.push({ sku, qty, cell: cellRaw, supply: `инв.СТО №${row.num}` });
  transfers[transfers.length - 1].cell = cellRaw;
}

console.log('STO warehouse:', stoCode, stoWhId);
console.log('Main warehouse:', mainCode, mainWhId);
console.log('Import lines:', importRows.length);
console.log('Stock transfers:', transfers.length);
console.log('Unmatched products:', unmatched.length);
console.log('Without cell (main WH only):', badCells.length);

if (dryRun) {
  console.log(JSON.stringify({ importRows, transfers, unmatched, badCells }, null, 2));
  process.exit(0);
}

const cellResult = importCellRows({
  warehouse_id: mainWhId,
  rows: importRows,
  source: raw.source || 'Инв. СТО Москва',
  sheet_title: raw.source || '',
  fetched_at: raw.fetched_at || '',
  replace: false,
});

let movedQty = 0;
for (const t of transfers) {
  run(
    `INSERT INTO stock_balances (warehouse_id, product_id, qty)
     VALUES (?, ?, ?)
     ON CONFLICT(warehouse_id, product_id) DO UPDATE SET qty = qty + excluded.qty`,
    [mainWhId, t.product_id, t.qty]
  );
  movedQty += t.qty;
}

run(`UPDATE stock_balances SET qty = 0 WHERE warehouse_id = ?`, [stoWhId]);

const stoLeft = get(
  `SELECT COUNT(*) AS lines, IFNULL(SUM(qty),0) AS qty
   FROM stock_balances WHERE warehouse_id = ? AND qty <> 0`,
  [stoWhId]
);

console.log(
  JSON.stringify(
    {
      ok: true,
      cellResult,
      transfers: transfers.length,
      moved_qty: movedQty,
      sto_zeroed: true,
      sto_remaining: stoLeft,
      unmatched: unmatched.slice(0, 20),
      bad_cells: badCells,
    },
    null,
    2
  )
);
