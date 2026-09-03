#!/usr/bin/env bash
# Экспорт WMS для сверки ячеек → /tmp/wms-cells-full.json на VPS
set -euo pipefail
cd "$(dirname "$0")/.."
node <<'NODE'
import { pathToFileURL } from 'url';
import fs from 'node:fs';

const { get, all } = await import(pathToFileURL('./api/dist/db.js').href);
const wh = get('SELECT id, name, code FROM warehouses WHERE code=?', ['НФ-000032']);
if (!wh) throw new Error('warehouse НФ-000032 not found');

const mainRows = all(
  `SELECT p.sku, SUM(sb.qty) AS qty
   FROM stock_balances sb
   JOIN products p ON p.id = sb.product_id
   WHERE sb.warehouse_id = ? AND sb.qty > 0
   GROUP BY p.sku`,
  [wh.id]
);
const main_stock = {};
for (const r of mainRows) main_stock[String(r.sku).toUpperCase()] = Number(r.qty);

const cellLines = all(
  `SELECT p.sku, IFNULL(p.name,'') AS name, wc.code AS cell,
          IFNULL(scb.supply,'') AS supply, scb.qty AS qty
   FROM stock_cell_balances scb
   JOIN products p ON p.id = scb.product_id
   JOIN warehouse_cells wc ON wc.id = scb.cell_id
   WHERE scb.warehouse_id = ? AND scb.qty > 0`,
  [wh.id]
);

const meta = get('SELECT * FROM warehouse_cells_meta WHERE warehouse_id = ?', [wh.id]);

const catalogRows = all(
  `SELECT IFNULL(p.sku,'') AS sku, IFNULL(p.code,'') AS code, IFNULL(p.name,'') AS name,
          IFNULL(p.barcode,'') AS barcode, IFNULL(p.warehouse_sku,'') AS warehouse_sku,
          IFNULL(p.is_main,0) AS is_main
   FROM products p
   WHERE IFNULL(p.source_department,'') IN ('pnevmopodveska_2025','')
      OR IFNULL(p.is_main,0) = 1`
);

const out = {
  exported_at: new Date().toISOString(),
  warehouse: wh,
  meta: meta || null,
  main_stock,
  products: catalogRows.map((r) => ({
    sku: String(r.sku),
    code: String(r.code || ''),
    name: String(r.name || ''),
    barcode: String(r.barcode || ''),
    warehouse_sku: String(r.warehouse_sku || ''),
    is_main: Number(r.is_main || 0),
  })),
  cell_lines: cellLines.map((r) => ({
    sku: String(r.sku),
    name: String(r.name || ''),
    cell: String(r.cell),
    supply: String(r.supply || ''),
    qty: Number(r.qty),
  })),
};

const path = '/tmp/wms-cells-full.json';
fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log('OK', path, 'cells', cellLines.length, 'main SKU', Object.keys(main_stock).length);
NODE
