#!/usr/bin/env node
/**
 * Перенос адресных остатков СТО с основного склада (НФ-000032) на склад STO.
 * Строки с supply «инв.СТО…» — результат прошлой миграции со «Склад СТО Москва».
 *
 *   node bin/migrate-sto-cells-to-sto-warehouse.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

async function loadMod(rel) {
  const dist = path.join(root, 'api', 'dist', rel);
  const src = path.join(root, 'api', 'src', rel.replace('.js', '.ts'));
  const p = fs.existsSync(dist) ? dist : src;
  try {
    await import('tsx/esm');
  } catch {
    /* ignore */
  }
  return import(pathToFileURL(p).href);
}

const cellsMod = await loadMod('warehouse-cells.js');
const { importCellRows, CELLS_DEFAULT_WAREHOUSE_CODE } = cellsMod;
const { get, run, all } = await loadMod('db.js');

function whId(code) {
  const row = get('SELECT id, name, code FROM warehouses WHERE code = ? LIMIT 1', [code]);
  if (!row?.id) throw new Error(`Склад не найден: ${code}`);
  return String(row.id);
}

const mainId = whId(CELLS_DEFAULT_WAREHOUSE_CODE);
const stoId = whId('STO');

const rows = all(
  `SELECT scb.warehouse_id, scb.cell_id, scb.product_id, scb.sku, scb.product_name, scb.supply, scb.qty,
          c.code AS cell_code
   FROM stock_cell_balances scb
   JOIN warehouse_cells c ON c.id = scb.cell_id
   WHERE scb.warehouse_id = ? AND scb.supply LIKE 'инв.СТО%'
   ORDER BY c.code, scb.sku`,
  [mainId]
);

console.log('Main:', mainId, 'STO:', stoId);
console.log('Lines to move:', rows.length);
console.log('Qty sum:', rows.reduce((s, r) => s + (Number(r.qty) || 0), 0));

const importRows = rows.map((r) => ({
  sku: String(r.sku || '').trim(),
  qty: Number(r.qty) || 0,
  cell: String(r.cell_code || '').trim(),
  supply: String(r.supply || '').trim(),
}));

if (dryRun) {
  const byCell = new Map();
  for (const r of importRows) {
    byCell.set(r.cell, (byCell.get(r.cell) || 0) + 1);
  }
  console.log(
    JSON.stringify(
      {
        dry_run: true,
        cells: [...byCell.entries()].map(([code, cnt]) => ({ code, cnt })),
        sample: importRows.slice(0, 5),
      },
      null,
      2
    )
  );
  process.exit(0);
}

const cellResult = importCellRows({
  warehouse_id: stoId,
  rows: importRows,
  source: 'Перенос инв.СТО с основного на склад STO',
  sheet_title: 'migrate-sto-cells-to-sto-warehouse',
  fetched_at: new Date().toISOString(),
  replace: false,
});

let movedQty = 0;
for (const r of rows) {
  const qty = Number(r.qty) || 0;
  const productId = String(r.product_id || '').trim();
  const sku = String(r.sku || '').trim();
  const cellId = String(r.cell_id || '').trim();

  run(
    `DELETE FROM stock_cell_balances WHERE warehouse_id = ? AND cell_id = ? AND sku = ?`,
    [mainId, cellId, sku]
  );

  if (productId && qty > 0) {
    run(
      `UPDATE stock_balances SET qty = CASE WHEN qty - ? < 0 THEN 0 ELSE qty - ? END
       WHERE warehouse_id = ? AND product_id = ?`,
      [qty, qty, mainId, productId]
    );
    run(
      `INSERT INTO stock_balances (warehouse_id, product_id, qty)
       VALUES (?, ?, ?)
       ON CONFLICT(warehouse_id, product_id) DO UPDATE SET qty = qty + excluded.qty`,
      [stoId, productId, qty]
    );
    movedQty += qty;
  }
}

run(
  `UPDATE warehouse_cells SET is_active = 0, updated_at = datetime('now')
   WHERE warehouse_id = ? AND code = 'A13.C0'`,
  [mainId]
);

run(
  `UPDATE warehouses SET name = 'Склад СТО', updated_at = datetime('now') WHERE id = ?`,
  [stoId]
);

const leftMain = get(
  `SELECT COUNT(*) AS cnt, IFNULL(SUM(qty),0) AS qty
   FROM stock_cell_balances scb
   WHERE scb.warehouse_id = ? AND scb.supply LIKE 'инв.СТО%'`,
  [mainId]
);
const stoCell = get(
  `SELECT COUNT(*) AS cnt, IFNULL(SUM(qty),0) AS qty
   FROM stock_cell_balances WHERE warehouse_id = ?`,
  [stoId]
);
const stoStock = get(
  `SELECT COUNT(*) AS cnt, IFNULL(SUM(qty),0) AS qty
   FROM stock_balances WHERE warehouse_id = ? AND qty <> 0`,
  [stoId]
);

console.log(
  JSON.stringify(
    {
      ok: true,
      cellResult,
      moved_lines: rows.length,
      moved_qty: movedQty,
      main_sto_left: leftMain,
      sto_cell_balances: stoCell,
      sto_stock_balances: stoStock,
    },
    null,
    2
  )
);
