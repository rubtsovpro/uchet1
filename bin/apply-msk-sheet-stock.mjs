#!/usr/bin/env node
/**
 * Лист «Март. Ячейки» → ячейки + stock_balances Основного (и Брак по пометке H/I).
 *
 * Не трогает: COURIER, STO, STO-RSV-MSK, STO-RES-MSK, WAIT-PAY, Б/У.
 *
 * Usage (VPS):
 *   node --experimental-sqlite bin/apply-msk-sheet-stock.mjs --dry-run
 *   node --experimental-sqlite bin/apply-msk-sheet-stock.mjs --apply --create-missing
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache =
  process.env.WMS_CELLS_CACHE || path.join(root, 'data', 'cells-sheet-cache.json');

const MAIN_ID = 'b7142cc4-2b3a-11ec-80bf-00155d3d52d2';
const DEFECT_ID = '0c01ae2e-743b-11f0-b04b-0050569b6f2b';
const PROTECTED = [
  '5be130eb-3217-46d2-a419-5a05df81e352', // COURIER
  '7b7d0487-4d7d-4891-b220-e75cc700c460', // STO
  '097d51e2-2339-4e85-8356-4bfb33ff7883', // STO-RSV-MSK
  '981cee36-d725-428e-9104-c85ae0b295c8', // STO-RES-MSK
  'eda666a1-6fe9-4c0c-9a2b-de109fe12126', // WAIT-PAY
  'c1daca43-1b63-11f0-b04b-0050569b6f2b', // Б/У
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run') || !args.has('--apply');
const createMissing = args.has('--create-missing');

if (!fs.existsSync(cache)) {
  console.error('Нет файла', cache, '— сначала: php tools/fetch_cells_sheet.php --gid=1042390058');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(cache, 'utf8'));
const rowsIn = Array.isArray(raw.rows) ? raw.rows : [];

const dbMod = await import(pathToFileURL(path.join(root, 'api', 'dist', 'db.js')).href);
const cellsMod = await import(
  pathToFileURL(path.join(root, 'api', 'dist', 'warehouse-cells.js')).href
);
const { get, run, db } = dbMod;

function snapWh(id) {
  const row = get(
    `SELECT COUNT(*) AS pos, IFNULL(SUM(qty),0) AS qty
     FROM stock_balances WHERE warehouse_id = ? AND qty > 0`,
    [id]
  );
  const cells = get(
    `SELECT COUNT(*) AS pos, IFNULL(SUM(qty),0) AS qty
     FROM stock_cell_balances WHERE warehouse_id = ? AND qty > 0`,
    [id]
  );
  return {
    stock_pos: Number(row?.pos) || 0,
    stock_qty: Number(row?.qty) || 0,
    cells_pos: Number(cells?.pos) || 0,
    cells_qty: Number(cells?.qty) || 0,
  };
}

function lookupProduct(sku) {
  return get(
    `SELECT id, name, IFNULL(is_active,1) AS is_active FROM products WHERE sku = ? OR barcode = ? LIMIT 1`,
    [sku, sku]
  );
}

function upsertBalance(warehouseId, productId, qty) {
  run(
    `INSERT INTO stock_balances (warehouse_id, product_id, qty) VALUES (?, ?, ?)
     ON CONFLICT(warehouse_id, product_id) DO UPDATE SET qty = excluded.qty`,
    [warehouseId, productId, qty]
  );
  run(
    `INSERT INTO product_store_rests (product_id, warehouse_id, qty) VALUES (?, ?, ?)
     ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty = excluded.qty`,
    [productId, warehouseId, qty]
  );
}

const dbPath =
  process.env.WMS_DATA_DIR
    ? path.join(process.env.WMS_DATA_DIR, 'warehouse.sqlite')
    : path.join(root, 'data', 'warehouse.sqlite');

const beforeProtected = Object.fromEntries(PROTECTED.map((id) => [id, snapWh(id)]));
const beforeMain = snapWh(MAIN_ID);
const beforeDefect = snapWh(DEFECT_ID);

const mainBySku = new Map();
const defectBySku = new Map();
const cellRows = [];
let skippedZero = 0;
let skippedNoCell = 0;
let defectLines = 0;
let stoNoteLines = 0;

for (const r of rowsIn) {
  const sku = String(r.sku || '')
    .trim()
    .toUpperCase();
  if (!sku) continue;
  const qty = Number(String(r.qty ?? '0').replace(',', '.').replace(/\s/g, '')) || 0;
  const cell = String(r.cell || '').trim();
  const supply = String(r.supply || '').trim();
  const hint = String(r.hint || '').trim();

  if (hint === 'СТО') stoNoteLines++;
  if (qty <= 0) {
    skippedZero++;
    continue;
  }
  if (!cell) {
    skippedNoCell++;
    continue;
  }

  cellRows.push({ sku, supply, qty, cell });

  if (hint === 'брак') {
    defectLines++;
    defectBySku.set(sku, (defectBySku.get(sku) || 0) + qty);
  } else {
    mainBySku.set(sku, (mainBySku.get(sku) || 0) + qty);
  }
}

const missing = [];
for (const sku of new Set([...mainBySku.keys(), ...defectBySku.keys()])) {
  if (!lookupProduct(sku)) missing.push(sku);
}

const plan = {
  sheet_title: raw.sheet_title,
  fetched_at: raw.fetched_at,
  dry_run: dryRun,
  cell_lines: cellRows.length,
  main_skus: mainBySku.size,
  main_qty: [...mainBySku.values()].reduce((a, b) => a + b, 0),
  defect_skus: defectBySku.size,
  defect_qty: [...defectBySku.values()].reduce((a, b) => a + b, 0),
  defect_lines: defectLines,
  sto_note_lines: stoNoteLines,
  skipped_zero: skippedZero,
  skipped_no_cell: skippedNoCell,
  missing_sku: missing,
  before: { main: beforeMain, defect: beforeDefect, protected: beforeProtected },
};

console.log(JSON.stringify(plan, null, 2));

if (dryRun) {
  console.log('\nDry-run only. Запуск с --apply для записи.');
  process.exit(0);
}

if (missing.length && !createMissing) {
  console.error(
    'Нет товаров:',
    missing.join(', '),
    '— добавьте --create-missing или заведите в каталоге'
  );
  process.exit(2);
}

const bak = `${dbPath}.bak-msk-sheet-${new Date()
  .toISOString()
  .replace(/[:.]/g, '-')
  .slice(0, 19)}`;
fs.copyFileSync(dbPath, bak);
console.log('backup', bak);

try {
  run('BEGIN');

  if (createMissing && missing.length) {
    const unit =
      get(`SELECT unit_id AS id FROM products WHERE IFNULL(unit_id,'') != '' LIMIT 1`) ||
      get(`SELECT id FROM units LIMIT 1`);
    if (!unit?.id) throw new Error('Нет units для создания товаров');
    for (const sku of missing) {
      run(
        `INSERT INTO products (id, sku, name, code, unit_id, is_active, item_kind, brand)
         VALUES (?, ?, ?, ?, ?, 1, 'product', 'MRAER')`,
        [randomUUID(), sku, sku, sku, unit.id]
      );
    }
  }

  const cellResult = cellsMod.importCellRows({
    warehouse_id: MAIN_ID,
    rows: cellRows,
    source: raw.source || 'Март. Ячейки',
    sheet_title: raw.sheet_title,
    fetched_at: raw.fetched_at,
    replace: true,
  });
  console.log('cells import', JSON.stringify(cellResult));

  run(`UPDATE stock_balances SET qty = 0 WHERE warehouse_id = ?`, [MAIN_ID]);
  run(`UPDATE product_store_rests SET qty = 0 WHERE warehouse_id = ?`, [MAIN_ID]);
  for (const [sku, qty] of mainBySku) {
    const p = lookupProduct(sku);
    if (!p?.id) continue;
    upsertBalance(MAIN_ID, p.id, qty);
  }

  // Брак: полная замена по пометкам листа (эталон H/I «Склад Брака»)
  run(`UPDATE stock_balances SET qty = 0 WHERE warehouse_id = ?`, [DEFECT_ID]);
  run(`UPDATE product_store_rests SET qty = 0 WHERE warehouse_id = ?`, [DEFECT_ID]);
  for (const [sku, qty] of defectBySku) {
    const p = lookupProduct(sku);
    if (!p?.id) continue;
    upsertBalance(DEFECT_ID, p.id, qty);
  }

  run('COMMIT');
} catch (e) {
  try {
    run('ROLLBACK');
  } catch {
    /* ignore */
  }
  throw e;
}

const afterProtected = Object.fromEntries(PROTECTED.map((id) => [id, snapWh(id)]));
const afterMain = snapWh(MAIN_ID);
const afterDefect = snapWh(DEFECT_ID);

let protectedOk = true;
for (const id of PROTECTED) {
  const b = beforeProtected[id];
  const a = afterProtected[id];
  if (b.stock_qty !== a.stock_qty || b.cells_qty !== a.cells_qty) {
    protectedOk = false;
    console.error('PROTECTED CHANGED', id, b, a);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      protected_ok: protectedOk,
      backup: bak,
      after: { main: afterMain, defect: afterDefect, protected: afterProtected },
    },
    null,
    2
  )
);

if (!protectedOk) process.exit(3);
// silence unused
void db;
