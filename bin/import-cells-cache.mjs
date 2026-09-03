#!/usr/bin/env node
/**
 * Импорт data/cells-sheet-cache.json в SQLite (warehouse_cells + stock_cell_balances).
 * Usage (из корня репо или на VPS):
 *   node --experimental-sqlite bin/import-cells-cache.mjs
 *   WMS_CELLS_CACHE=/path/to.json node --experimental-sqlite bin/import-cells-cache.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache =
  process.env.WMS_CELLS_CACHE || path.join(root, 'data', 'cells-sheet-cache.json');

if (!fs.existsSync(cache)) {
  console.error('Нет файла', cache, '— сначала: php tools/fetch_cells_sheet.php');
  process.exit(1);
}

// Подключаем скомпилированный dist или tsx-исходник
async function loadImporter() {
  const dist = path.join(root, 'api', 'dist', 'warehouse-cells.js');
  const src = path.join(root, 'api', 'src', 'warehouse-cells.ts');
  if (fs.existsSync(dist)) {
    return import(pathToFileURL(dist).href);
  }
  // tsx register
  try {
    await import('tsx/esm');
  } catch {
    /* ignore */
  }
  return import(pathToFileURL(src).href);
}

const mod = await loadImporter();
const result = mod.importCellsFromCacheFile(cache);
console.log(JSON.stringify({ ok: true, ...result }, null, 2));
