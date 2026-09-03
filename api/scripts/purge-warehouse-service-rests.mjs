#!/usr/bin/env node
/**
 * Убрать услуги и чужой контур из stock_balances / product_store_rests.
 * Usage on VPS:
 *   cd /root/1c_pnevmopodveska1_ru/warehouse/api && node scripts/purge-warehouse-service-rests.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distKind = path.join(root, 'dist', 'product-kind.js');
const srcKind = path.join(root, 'src', 'product-kind.ts');

async function loadKind() {
  if (fs.existsSync(distKind)) return import(pathToFileURL(distKind).href);
  try {
    await import('tsx/esm');
  } catch {
    /* ignore */
  }
  return import(pathToFileURL(srcKind).href);
}

const { sqlExcludeServices, sqlExcludeCrossContourProducts } = await loadKind();
const { get, run } = await import(pathToFileURL(path.join(root, 'dist', 'db.js')).href);

const serviceSql = sqlExcludeServices('p', 'u');
const contourSql = sqlExcludeCrossContourProducts('p', 'co');
const badWhere = `(NOT (${serviceSql}) OR NOT (${contourSql}))`;

function purge(table) {
  const before =
    get(
      `SELECT COUNT(*) AS c, COALESCE(SUM(x.qty),0) AS q
       FROM ${table} x
       JOIN products p ON p.id = x.product_id
       JOIN warehouses w ON w.id = x.warehouse_id
       LEFT JOIN companies co ON co.id = w.company_id
       LEFT JOIN units u ON u.id = p.unit_id
       WHERE x.qty != 0 AND ${badWhere}`
    ) || {};
  run(
    `DELETE FROM ${table}
     WHERE rowid IN (
       SELECT x.rowid FROM ${table} x
       JOIN products p ON p.id = x.product_id
       JOIN warehouses w ON w.id = x.warehouse_id
       LEFT JOIN companies co ON co.id = w.company_id
       LEFT JOIN units u ON u.id = p.unit_id
       WHERE x.qty != 0 AND ${badWhere}
     )`
  );
  return { deleted: Number(before.c) || 0, qty: Number(before.q) || 0 };
}

const result = {
  ok: true,
  stock_balances: purge('stock_balances'),
  product_store_rests: purge('product_store_rests'),
};
console.log(JSON.stringify(result, null, 2));
