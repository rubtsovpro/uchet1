#!/usr/bin/env node
/**
 * Частичный импорт строк ячеек (replace: false) — «по мозаике».
 * Usage: node bin/import-cells-rows.mjs path/to/rows.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage: node bin/import-cells-rows.mjs rows.json');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const dist = path.join(root, 'api', 'dist', 'warehouse-cells.js');
const mod = await import(pathToFileURL(dist).href);
const result = mod.importCellRows({
  warehouse_id: raw.warehouse_id,
  rows: raw.rows || [],
  source: raw.source || 'Расхождения',
  sheet_title: raw.sheet_title || '',
  fetched_at: raw.fetched_at || new Date().toISOString(),
  replace: raw.replace === true,
});
console.log(JSON.stringify({ ok: true, ...result }, null, 2));
