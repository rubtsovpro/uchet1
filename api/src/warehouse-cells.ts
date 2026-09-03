/**
 * Адресный учёт · ячейки склада.
 * MVP: справочник ячеек + остатки по адресу (снэпшот из Google «Март. Ячейки») + карта стеллажей.
 * Операции put/move /pick — следующим этапом (см. docs/PLAN-addressable-storage.md).
 */
import type { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { mainWarehouseId } from './supply-chain.js';
import {
  listOpenDealIdsOnWarehouse,
  listOpenDealStockLinesOnWarehouse,
  pendingHandoffInboundOnWarehouse,
} from './deal-stock-flow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE = path.resolve(__dirname, '..', '..', 'data', 'cells-sheet-cache.json');

/** Адресный учёт · ячейки на основном складе 1С (НФ-000032 / Основной). */
export const CELLS_DEFAULT_WAREHOUSE_CODE = 'НФ-000032';

export type CellParts = {
  code: string;
  rack: string;
  bay: number;
  level: number;
  kind: 'shelf' | 'floor';
};

export function ensureWarehouseCellsSchema(): void {
  run(`
    CREATE TABLE IF NOT EXISTS warehouse_cells (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL,
      code TEXT NOT NULL,
      rack TEXT NOT NULL DEFAULT '',
      bay INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'shelf',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (warehouse_id, code),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_wh_cells_wh ON warehouse_cells(warehouse_id)`);
  run(`CREATE INDEX IF NOT EXISTS idx_wh_cells_rack ON warehouse_cells(warehouse_id, rack, bay, level)`);
  ensureAllowInboundColumn();

  run(`
    CREATE TABLE IF NOT EXISTS stock_cell_balances (
      warehouse_id TEXT NOT NULL,
      cell_id TEXT NOT NULL,
      product_id TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      supply TEXT NOT NULL DEFAULT '',
      qty REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (warehouse_id, cell_id, sku),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (cell_id) REFERENCES warehouse_cells(id)
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_stock_cell_cell ON stock_cell_balances(cell_id)`);
  run(`CREATE INDEX IF NOT EXISTS idx_stock_cell_sku ON stock_cell_balances(sku)`);

  run(`
    CREATE TABLE IF NOT EXISTS warehouse_cells_meta (
      warehouse_id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT '',
      sheet_title TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL DEFAULT '',
      row_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS stock_doc_line_placements (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      line_id TEXT NOT NULL,
      cell_id TEXT NOT NULL,
      cell_code TEXT NOT NULL DEFAULT '',
      qty REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (doc_id) REFERENCES stock_docs(id),
      FOREIGN KEY (line_id) REFERENCES stock_doc_lines(id),
      FOREIGN KEY (cell_id) REFERENCES warehouse_cells(id)
    )
  `);
  const plCols = all<{ name: string }>('PRAGMA table_info(stock_doc_line_placements)').map(
    (c) => c.name
  );
  if (plCols.length && !plCols.includes('warehouse_id')) {
    run(`ALTER TABLE stock_doc_line_placements ADD COLUMN warehouse_id TEXT NOT NULL DEFAULT ''`);
  }
  run(`CREATE INDEX IF NOT EXISTS idx_placements_doc ON stock_doc_line_placements(doc_id)`);
  run(`CREATE INDEX IF NOT EXISTS idx_placements_line ON stock_doc_line_placements(line_id)`);
}

/** А7.1 / а7.1 → A7.1; кириллица П остаётся. */
export function normalizeCellCode(raw: string): string {
  let s = String(raw || '').trim().replace(/\s+/g, '');
  if (!s) return '';
  s = s.replace(/^А/u, 'A').replace(/^а/u, 'A');
  if (/^[A-Za-z]/.test(s)) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  return s;
}

/** Ячейка из инвентаризации / голосовой сверки → код для адресного учёта. */
export function normalizeInventoryCell(raw: string): string {
  let s = String(raw || '').trim().replace(/\?/g, '');
  if (!s) return '';
  const low = s.toLowerCase().replace(/\s+/g, ' ');
  if (low === 'сто' || low.includes('полка сто') || low === 'полка из того') return 'A13.C0';
  let m = s.match(/^п\s*(\d+)$/iu);
  if (m) return `П.${m[1]}`;
  m = s.match(/^п(\d+)$/iu);
  if (m) return `П.${m[1]}`;
  return normalizeCellCode(s);
}

export function parseCellCode(raw: string): CellParts | null {
  const code = normalizeCellCode(raw);
  if (!code) return null;
  // A13.C0 — стеллаж СТО под зоной самовывоза
  let m = code.match(/^([A-Za-zА-Яа-яЁё])(\d+)\.([A-Za-zА-Яа-яЁё])(\d+)$/u);
  if (m) {
    const rack = m[1]!.toUpperCase().replace(/^А$/u, 'A');
    const sub = m[3]!.toUpperCase().replace(/^А$/u, 'A');
    const subSlot = Number(m[4]) || 0;
    return {
      code: `${rack}${m[2]}.${sub}${subSlot}`,
      rack,
      bay: Number(m[2]) || 0,
      level: 0,
      kind: 'shelf',
    };
  }
  m = code.match(/^([A-Za-zА-Яа-яЁё])(\d+)\.(\d+)$/u);
  if (m) {
    const rack = m[1]!.toUpperCase().replace(/^А$/u, 'A');
    return {
      code: `${rack}${m[2]}.${m[3]}`,
      rack,
      bay: Number(m[2]) || 0,
      level: Number(m[3]) || 0,
      kind: 'shelf',
    };
  }
  // Пол / паллета: П.2, П 10, П.16
  m = code.match(/^([A-Za-zА-Яа-яЁё])[.\s-]?(\d+)$/u);
  if (m) {
    const rack = m[1]!.toUpperCase().replace(/^А$/u, 'A');
    const slot = Number(m[2]) || 0;
    return {
      code: `${rack}.${slot}`,
      rack,
      bay: slot,
      level: 0,
      kind: 'floor',
    };
  }
  return null;
}

function resolveWarehouseId(explicit?: string): string {
  const id = String(explicit || '').trim();
  if (id) {
    const row = get<{ id: string }>(`SELECT id FROM warehouses WHERE id = ?`, [id]);
    if (row?.id) return String(row.id);
    throw new Error('Склад не найден');
  }
  const byCode = get<{ id: string }>(
    `SELECT id FROM warehouses WHERE code = ? AND IFNULL(is_active,1) = 1 LIMIT 1`,
    [CELLS_DEFAULT_WAREHOUSE_CODE]
  );
  if (byCode?.id) return String(byCode.id);
  const byName = get<{ id: string }>(
    `SELECT id FROM warehouses WHERE name LIKE '%Москва%' AND IFNULL(is_active,1) = 1
     AND name NOT LIKE '%СТО%' ORDER BY name LIMIT 1`
  );
  if (byName?.id) return String(byName.id);
  throw new Error('Не найден основной склад (НФ-000032)');
}

function upsertCell(warehouseId: string, parts: CellParts): string {
  const existing = get<{ id: string }>(
    `SELECT id FROM warehouse_cells WHERE warehouse_id = ? AND code = ?`,
    [warehouseId, parts.code]
  );
  if (existing?.id) {
    run(
      `UPDATE warehouse_cells
       SET rack = ?, bay = ?, level = ?, kind = ?, is_active = 1, updated_at = datetime('now')
       WHERE id = ?`,
      [parts.rack, parts.bay, parts.level, parts.kind, existing.id]
    );
    return String(existing.id);
  }
  const id = newGuid();
  run(
    `INSERT INTO warehouse_cells (id, warehouse_id, code, rack, bay, level, kind, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [id, warehouseId, parts.code, parts.rack, parts.bay, parts.level, parts.kind]
  );
  return id;
}

/** Паллеты пола П.n — создать, если ещё нет (карта МСК / приход). */
export function ensureFloorPalletCells(
  warehouseId?: string,
  slots: number[] = [8, 11, 13]
): void {
  ensureWarehouseCellsSchema();
  let wid = '';
  try {
    wid = resolveWarehouseId(warehouseId);
  } catch {
    return;
  }
  for (const n of slots) {
    const parts = parseCellCode(`П.${Math.floor(Number(n) || 0)}`);
    if (parts && parts.kind === 'floor') upsertCell(wid, parts);
  }
}

function lookupProduct(sku: string): { id: string; name: string } | null {
  const s = String(sku || '').trim();
  if (!s) return null;
  const row = get<{ id: string; name: string }>(
    `SELECT id, name FROM products WHERE sku = ? OR barcode = ? LIMIT 1`,
    [s, s]
  );
  return row ? { id: String(row.id), name: String(row.name || '') } : null;
}

export type ImportCellRow = {
  sku?: string;
  supply?: string;
  qty?: number | string;
  cell?: string;
};

export function importCellRows(input: {
  warehouse_id?: string;
  rows: ImportCellRow[];
  source?: string;
  sheet_title?: string;
  fetched_at?: string;
  /** Полная замена снэпшота по складу (по умолчанию да). */
  replace?: boolean;
}): {
  warehouse_id: string;
  cells: number;
  lines: number;
  skipped: number;
  unmatched_sku: number;
  bad_cells: string[];
} {
  ensureWarehouseCellsSchema();
  const warehouseId = resolveWarehouseId(input.warehouse_id);
  const replace = input.replace !== false;
  const badCells: string[] = [];
  let skipped = 0;
  let unmatched = 0;
  let lines = 0;
  const cellIds = new Set<string>();

  if (replace) {
    run(`DELETE FROM stock_cell_balances WHERE warehouse_id = ?`, [warehouseId]);
  }

  for (const raw of input.rows || []) {
    const sku = String(raw.sku || '').trim();
    const cellRaw = String(raw.cell || '').trim();
    const qty = Number(String(raw.qty ?? '0').replace(',', '.').replace(/\s/g, '')) || 0;
    if (!sku) {
      skipped++;
      continue;
    }
    if (!cellRaw) {
      skipped++;
      continue;
    }
    const parts = parseCellCode(cellRaw);
    if (!parts) {
      badCells.push(cellRaw);
      skipped++;
      continue;
    }
    const cellId = upsertCell(warehouseId, parts);
    cellIds.add(cellId);
    const product = lookupProduct(sku);
    if (!product) unmatched++;
    const productId = product?.id || '';
    const productName = product?.name || '';
    const supply = String(raw.supply || '').trim();

    const existing = get<{ qty: number }>(
      `SELECT qty FROM stock_cell_balances
       WHERE warehouse_id = ? AND cell_id = ? AND sku = ?`,
      [warehouseId, cellId, sku]
    );
    if (existing) {
      run(
        `UPDATE stock_cell_balances
         SET qty = qty + ?, supply = CASE WHEN ? != '' THEN ? ELSE supply END,
             product_id = CASE WHEN ? != '' THEN ? ELSE product_id END,
             product_name = CASE WHEN ? != '' THEN ? ELSE product_name END,
             updated_at = datetime('now')
         WHERE warehouse_id = ? AND cell_id = ? AND sku = ?`,
        [
          qty,
          supply,
          supply,
          productId,
          productId,
          productName,
          productName,
          warehouseId,
          cellId,
          sku,
        ]
      );
    } else {
      run(
        `INSERT INTO stock_cell_balances
         (warehouse_id, cell_id, product_id, sku, product_name, supply, qty)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [warehouseId, cellId, productId, sku, productName, supply, qty]
      );
    }
    lines++;
  }

  run(
    `INSERT INTO warehouse_cells_meta (warehouse_id, source, sheet_title, fetched_at, imported_at, row_count)
     VALUES (?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(warehouse_id) DO UPDATE SET
       source = excluded.source,
       sheet_title = excluded.sheet_title,
       fetched_at = excluded.fetched_at,
       imported_at = excluded.imported_at,
       row_count = excluded.row_count`,
    [
      warehouseId,
      String(input.source || 'Март. Ячейки'),
      String(input.sheet_title || ''),
      String(input.fetched_at || ''),
      lines,
    ]
  );

  return {
    warehouse_id: warehouseId,
    cells: cellIds.size,
    lines,
    skipped,
    unmatched_sku: unmatched,
    bad_cells: [...new Set(badCells)].slice(0, 50),
  };
}

export function importCellsFromCacheFile(filePath?: string): ReturnType<typeof importCellRows> {
  const p = filePath || process.env.WMS_CELLS_CACHE || DEFAULT_CACHE;
  if (!fs.existsSync(p)) {
    throw new Error(`Нет файла снэпшота: ${p}. Сначала tools/fetch_cells_sheet.php`);
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as {
    sheet_title?: string;
    fetched_at?: string;
    source?: string;
    warehouse_id?: string;
    rows?: ImportCellRow[];
  };
  return importCellRows({
    warehouse_id: raw.warehouse_id,
    rows: Array.isArray(raw.rows) ? raw.rows : [],
    source: raw.source || 'Март. Ячейки',
    sheet_title: raw.sheet_title,
    fetched_at: raw.fetched_at,
    replace: true,
  });
}

export function getCellsMeta(warehouseId?: string) {
  ensureWarehouseCellsSchema();
  const wid = resolveWarehouseId(warehouseId);
  const meta = get<Record<string, unknown>>(
    `SELECT * FROM warehouse_cells_meta WHERE warehouse_id = ?`,
    [wid]
  );
  const wh = get<{ id: string; name: string; code: string }>(
    `SELECT id, name, code FROM warehouses WHERE id = ?`,
    [wid]
  );
  const cellCount = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM warehouse_cells WHERE warehouse_id = ? AND is_active = 1`,
    [wid]
  );
  const lineCount = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM stock_cell_balances WHERE warehouse_id = ? AND qty > 0`,
    [wid]
  );
  return {
    warehouse: wh,
    meta: meta || null,
    cell_count: Number(cellCount?.c) || 0,
    line_count: Number(lineCount?.c) || 0,
  };
}

/** Карта стеллажей: racks → bays → levels → summary. */
export function getCellsMap(warehouseId?: string) {
  ensureWarehouseCellsSchema();
  const wid = resolveWarehouseId(warehouseId);
  ensureFloorPalletCells(wid, [8, 11, 13]);
  const cells = all<{
    id: string;
    code: string;
    rack: string;
    bay: number;
    level: number;
    kind: string;
  }>(
    `SELECT id, code, rack, bay, level, kind
     FROM warehouse_cells
     WHERE warehouse_id = ? AND is_active = 1
     ORDER BY rack, bay, level`,
    [wid]
  );
  const sums = all<{
    cell_id: string;
    sku_count: number;
    qty_sum: number;
  }>(
    `SELECT cell_id,
            COUNT(*) AS sku_count,
            SUM(qty) AS qty_sum
     FROM stock_cell_balances
     WHERE warehouse_id = ? AND qty > 0
     GROUP BY cell_id`,
    [wid]
  );
  const byCell = new Map(sums.map((s) => [String(s.cell_id), s]));

  type CellNode = {
    id: string;
    code: string;
    bay: number;
    level: number;
    kind: string;
    sku_count: number;
    qty_sum: number;
  };
  const racks = new Map<
    string,
    { rack: string; kind: string; bay_max: number; level_max: number; cells: CellNode[] }
  >();

  for (const c of cells) {
    const sum = byCell.get(String(c.id));
    const node: CellNode = {
      id: String(c.id),
      code: String(c.code),
      bay: Number(c.bay) || 0,
      level: Number(c.level) || 0,
      kind: String(c.kind || 'shelf'),
      sku_count: Number(sum?.sku_count) || 0,
      qty_sum: Number(sum?.qty_sum) || 0,
    };
    const rack = String(c.rack || '?');
    let bucket = racks.get(rack);
    if (!bucket) {
      bucket = {
        rack,
        kind: node.kind,
        bay_max: 0,
        level_max: 0,
        cells: [],
      };
      racks.set(rack, bucket);
    }
    bucket.cells.push(node);
    bucket.bay_max = Math.max(bucket.bay_max, node.bay);
    bucket.level_max = Math.max(bucket.level_max, node.level);
    if (node.kind === 'floor') bucket.kind = 'floor';
  }

  const rackList = [...racks.values()].sort((a, b) => a.rack.localeCompare(b.rack, 'ru'));
  return {
    ...getCellsMeta(wid),
    racks: rackList,
  };
}

export function getCellContents(input: { warehouse_id?: string; code?: string; cell_id?: string }) {
  ensureWarehouseCellsSchema();
  const wid = resolveWarehouseId(input.warehouse_id);
  let cell = null as Record<string, unknown> | null;
  const cellId = String(input.cell_id || '').trim();
  const code = normalizeCellCode(String(input.code || ''));
  if (cellId) {
    cell =
      get<Record<string, unknown>>(
        `SELECT * FROM warehouse_cells WHERE id = ? AND warehouse_id = ?`,
        [cellId, wid]
      ) || null;
  } else if (code) {
    const parts = parseCellCode(code);
    const look = parts?.code || code;
    cell =
      get<Record<string, unknown>>(
        `SELECT * FROM warehouse_cells WHERE warehouse_id = ? AND code = ?`,
        [wid, look]
      ) || null;
    if (!cell && parts) {
      const cellId = upsertCell(wid, parts);
      cell =
        get<Record<string, unknown>>(`SELECT * FROM warehouse_cells WHERE id = ? AND warehouse_id = ?`, [
          cellId,
          wid,
        ]) || null;
    }
  }
  if (!cell) throw new Error('Ячейка не найдена');
  const lines = all(
    `SELECT b.sku, b.product_id, b.product_name, b.supply, b.qty, b.updated_at,
            p.name AS catalog_name
     FROM stock_cell_balances b
     LEFT JOIN products p ON p.id = b.product_id
     WHERE b.warehouse_id = ? AND b.cell_id = ?
     ORDER BY b.sku`,
    [wid, String(cell.id)]
  );
  return { cell, lines };
}

export function listCellBalances(input: {
  warehouse_id?: string;
  q?: string;
  rack?: string;
  limit?: number;
  offset?: number;
}) {
  ensureWarehouseCellsSchema();
  const wid = resolveWarehouseId(input.warehouse_id);
  const q = String(input.q || '').trim();
  const rack = String(input.rack || '').trim();
  const limit = Math.min(500, Math.max(1, Number(input.limit) || 100));
  const offset = Math.max(0, Number(input.offset) || 0);
  const params: Array<string | number> = [wid];
  let where = 'b.warehouse_id = ? AND b.qty > 0';
  if (rack) {
    where += ' AND c.rack = ?';
    params.push(rack);
  }
  if (q) {
    where += ' AND (b.sku LIKE ? OR b.product_name LIKE ? OR c.code LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const total = get<{ c: number }>(
    `SELECT COUNT(*) AS c
     FROM stock_cell_balances b
     JOIN warehouse_cells c ON c.id = b.cell_id
     WHERE ${where}`,
    params
  );
  const rows = all(
    `SELECT b.sku, b.product_id, b.product_name, b.supply, b.qty,
            c.code AS cell_code, c.rack, c.bay, c.level, c.kind
     FROM stock_cell_balances b
     JOIN warehouse_cells c ON c.id = b.cell_id
     WHERE ${where}
     ORDER BY c.rack, c.bay, c.level, b.sku
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { total: Number(total?.c) || 0, rows, limit, offset };
}

/** Где уже лежит товар: ячейки + склады (для подсказки при приходе). */
export function listProductInboundHints(productId: string, preferWarehouseId?: string) {
  ensureWarehouseCellsSchema();
  const pid = String(productId || '').trim();
  if (!pid) return { cells: [], warehouses: [], suggest_cell: '' };
  const prefer = String(preferWarehouseId || '').trim() || resolveMainInboundWarehouseId();
  const sku = String(
    get<{ sku: string }>(`SELECT IFNULL(sku,'') AS sku FROM products WHERE id = ?`, [pid])?.sku || ''
  ).trim();
  const cells = all<{
    cell_code: string;
    qty: number;
    supply: string;
    warehouse_id: string;
    warehouse_name: string;
    warehouse_code: string;
  }>(
    `SELECT IFNULL(c.code,'') AS cell_code,
            IFNULL(b.qty,0) AS qty,
            IFNULL(b.supply,'') AS supply,
            b.warehouse_id AS warehouse_id,
            IFNULL(w.name,'') AS warehouse_name,
            IFNULL(w.code,'') AS warehouse_code
     FROM stock_cell_balances b
     JOIN warehouse_cells c ON c.id = b.cell_id
     JOIN warehouses w ON w.id = b.warehouse_id
     WHERE b.qty > 0
       AND (
         IFNULL(b.product_id,'') = ?
         OR (? != '' AND IFNULL(b.sku,'') = ?)
       )
     ORDER BY CASE WHEN b.warehouse_id = ? THEN 0 ELSE 1 END,
              b.qty DESC,
              c.code COLLATE NOCASE
     LIMIT 30`,
    [pid, sku, sku, prefer]
  ).map((r) => ({
    cell_code: String(r.cell_code || '').trim(),
    qty: Number(r.qty) || 0,
    supply: String(r.supply || '').trim(),
    warehouse_id: String(r.warehouse_id || ''),
    warehouse_name: String(r.warehouse_name || ''),
    warehouse_code: String(r.warehouse_code || ''),
    on_inbound_wh: String(r.warehouse_id || '') === prefer,
  }));
  const warehouses = all<{
    warehouse_id: string;
    warehouse_name: string;
    warehouse_code: string;
    qty: number;
  }>(
    `SELECT b.warehouse_id AS warehouse_id,
            IFNULL(w.name,'') AS warehouse_name,
            IFNULL(w.code,'') AS warehouse_code,
            IFNULL(SUM(b.qty),0) AS qty
     FROM stock_balances b
     JOIN warehouses w ON w.id = b.warehouse_id
     WHERE b.product_id = ? AND b.qty > 0
     GROUP BY b.warehouse_id
     ORDER BY CASE WHEN b.warehouse_id = ? THEN 0 ELSE 1 END, qty DESC
     LIMIT 20`,
    [pid, prefer]
  ).map((r) => ({
    warehouse_id: String(r.warehouse_id || ''),
    warehouse_name: String(r.warehouse_name || ''),
    warehouse_code: String(r.warehouse_code || ''),
    qty: Number(r.qty) || 0,
    on_inbound_wh: String(r.warehouse_id || '') === prefer,
  }));
  const suggest =
    cells.find((c) => c.on_inbound_wh && c.cell_code)?.cell_code ||
    cells.find((c) => c.cell_code)?.cell_code ||
    '';
  return { cells, warehouses, suggest_cell: suggest, warehouse_id: prefer };
}

type PalletLine = { sku: string; name: string; qty: number; product_id: string };
type PalletGroup = {
  deal_id: string;
  doc_number: string;
  title: string;
  subtitle: string;
  status_label: string;
  lines: PalletLine[];
};

function docLines(docId: string): PalletLine[] {
  const id = String(docId || '').trim();
  if (!id) return [];
  return all<{ sku: string; name: string; qty: number; product_id: string }>(
    `SELECT IFNULL(p.sku,'') AS sku, IFNULL(p.name,'') AS name,
            IFNULL(l.qty,0) AS qty, IFNULL(l.product_id,'') AS product_id
     FROM stock_doc_lines l
     LEFT JOIN products p ON p.id = l.product_id
     WHERE l.doc_id = ? AND IFNULL(l.qty,0) != 0
     ORDER BY p.sku COLLATE NOCASE`,
    [id]
  ).map((r) => ({
    sku: String(r.sku || ''),
    name: String(r.name || ''),
    qty: Number(r.qty) || 0,
    product_id: String(r.product_id || ''),
  }));
}

function sumPallet(groups: PalletGroup[]) {
  let lines_count = 0;
  let qty_sum = 0;
  for (const g of groups) {
    lines_count += g.lines.length;
    qty_sum += g.lines.reduce((s, l) => s + l.qty, 0);
  }
  return { deals_count: groups.length, lines_count, qty_sum };
}

/** Паллет на схеме склада: актуальные сделки + товары (курьер / резерв СТО / СТО). */
export function getWarehousePallet(input: { kind?: string; warehouse_id?: string }) {
  ensureWarehouseCellsSchema();
  const kind = String(input.kind || '').trim().toLowerCase();
  if (kind !== 'courier' && kind !== 'reserve' && kind !== 'sto') {
    throw new Error('kind: courier|reserve|sto');
  }
  const defaultCode = kind === 'courier' ? 'COURIER' : kind === 'reserve' ? 'STO-RSV-MSK' : 'STO';
  let wid = String(input.warehouse_id || '').trim();
  if (!wid) {
    wid =
      get<{ id: string }>(`SELECT id FROM warehouses WHERE upper(code) = ? LIMIT 1`, [defaultCode])?.id ||
      '';
  }
  // Старый вызов без id мог уйти на Отложено (STO-RES) — для паллета «резерв» канон STO-RSV
  if (kind === 'reserve' && wid) {
    const code = String(
      get<{ code: string }>(`SELECT IFNULL(code,'') AS code FROM warehouses WHERE id = ?`, [wid])?.code ||
        ''
    )
      .trim()
      .toUpperCase();
    if (/^STO-RES-/.test(code)) {
      wid =
        get<{ id: string }>(
          `SELECT id FROM warehouses WHERE upper(code) = 'STO-RSV-MSK' LIMIT 1`
        )?.id || wid;
    }
  }
  if (!wid) throw new Error('Склад не найден');
  const wh = get<{ id: string; name: string; code: string }>(
    `SELECT id, name, code FROM warehouses WHERE id = ?`,
    [wid]
  );
  if (!wh) throw new Error('Склад не найден');

  const groups: PalletGroup[] = [];

  if (kind === 'courier') {
    const runs = all<{
      deal_id: string;
      status: string;
      stock_doc_id: string;
      doc_number: string;
      buyer_name: string;
      amo_shipment: string;
    }>(
      `SELECT IFNULL(cr.deal_id,'') AS deal_id,
              IFNULL(cr.status,'') AS status,
              IFNULL(cr.stock_doc_id,'') AS stock_doc_id,
              IFNULL(sd.number,'') AS doc_number,
              IFNULL(d.buyer_name,'') AS buyer_name,
              IFNULL(d.amo_shipment,'') AS amo_shipment
       FROM courier_runs cr
       LEFT JOIN stock_docs sd ON sd.id = cr.stock_doc_id
       LEFT JOIN crm_deals d ON d.id = cr.deal_id
       WHERE cr.status IN ('new','accepted','picked_up')
       ORDER BY datetime(cr.created_at) ASC`
    );
    const statusLabels: Record<string, string> = {
      new: 'К выполнению',
      accepted: 'Принято',
      picked_up: 'Забрал',
    };
    for (const r of runs) {
      const lines = docLines(String(r.stock_doc_id || ''));
      const dealId = String(r.deal_id || '').trim();
      const docNum = String(r.doc_number || '').trim();
      const ship = String(r.amo_shipment || '').trim();
      const buyer = String(r.buyer_name || '').trim();
      groups.push({
        deal_id: dealId,
        doc_number: docNum,
        title: dealId ? `С${dealId}` : docNum || 'Передача',
        subtitle: [docNum, ship, buyer].filter(Boolean).join(' · '),
        status_label: statusLabels[String(r.status || '')] || String(r.status || ''),
        lines,
      });
    }
  } else if (kind === 'reserve') {
    // Только актуальный остаток (+ черновики передачи), не вся история TR на резерв.
    const dealIds = new Set(listOpenDealIdsOnWarehouse(wid));
    const pendingByDeal = new Map<string, ReturnType<typeof pendingHandoffInboundOnWarehouse>>();
    for (const row of pendingHandoffInboundOnWarehouse(wid)) {
      const dealId = String(row.deal_id || '').trim();
      if (!dealId) continue;
      dealIds.add(dealId);
      const list = pendingByDeal.get(dealId) || [];
      list.push(row);
      pendingByDeal.set(dealId, list);
    }
    for (const dealId of [...dealIds].sort((a, b) => a.localeCompare(b, 'ru'))) {
      const stockLines = listOpenDealStockLinesOnWarehouse(wid, dealId);
      const pendingLines = (pendingByDeal.get(dealId) || []).map((r) => ({
        sku: r.sku,
        name: r.name,
        qty: r.qty,
        product_id: r.product_id,
      }));
      const lines = stockLines.length ? stockLines : pendingLines;
      if (!lines.length) continue;
      const deal = get<{ buyer_name: string; amo_shipment: string }>(
        `SELECT IFNULL(buyer_name,'') AS buyer_name, IFNULL(amo_shipment,'') AS amo_shipment
         FROM crm_deals WHERE id = ?`,
        [dealId]
      );
      const doc = get<{ number: string }>(
        `SELECT IFNULL(number,'') AS number
         FROM stock_docs
         WHERE warehouse_to_id = ? AND deal_id = ? AND posted = 1
         ORDER BY datetime(doc_date) DESC, datetime(created_at) DESC
         LIMIT 1`,
        [wid, dealId]
      );
      const docNum = String(doc?.number || '').trim();
      const buyer = String(deal?.buyer_name || '').trim();
      const ship = String(deal?.amo_shipment || '').trim();
      const outLabel = `Р${dealId}`;
      const pendingOnly = !stockLines.length && pendingLines.length > 0;
      groups.push({
        deal_id: dealId,
        doc_number: outLabel,
        title: `${dealId} · ${outLabel}`,
        subtitle: [docNum && docNum !== outLabel ? docNum : '', ship, buyer].filter(Boolean).join(' · '),
        status_label: pendingOnly ? 'Ждёт сборку' : 'На резерве',
        lines,
      });
    }
  } else {
    // СТО: только сделки с остатком на полу; после списания по продаже — не показываем.
    const dealIds = listOpenDealIdsOnWarehouse(wid);
    for (const dealId of dealIds) {
      const lines = listOpenDealStockLinesOnWarehouse(wid, dealId);
      if (!lines.length) continue;
      const deal = get<{ buyer_name: string; amo_shipment: string }>(
        `SELECT IFNULL(buyer_name,'') AS buyer_name, IFNULL(amo_shipment,'') AS amo_shipment
         FROM crm_deals WHERE id = ?`,
        [dealId]
      );
      const doc = get<{ number: string }>(
        `SELECT IFNULL(number,'') AS number
         FROM stock_docs
         WHERE warehouse_to_id = ? AND deal_id = ? AND posted = 1
         ORDER BY datetime(doc_date) DESC, datetime(created_at) DESC
         LIMIT 1`,
        [wid, dealId]
      );
      const docNum = String(doc?.number || '').trim();
      const buyer = String(deal?.buyer_name || '').trim();
      const ship = String(deal?.amo_shipment || '').trim();
      const outLabel = `Р${dealId}`;
      groups.push({
        deal_id: dealId,
        doc_number: outLabel,
        title: `${dealId} · ${outLabel}`,
        subtitle: [docNum && docNum !== outLabel ? docNum : '', ship, buyer].filter(Boolean).join(' · '),
        status_label: 'На СТО',
        lines,
      });
    }
  }

  const stats = sumPallet(groups);
  return {
    kind,
    warehouse: wh,
    ...stats,
    groups,
  };
}

/** Основной склад для ручного прихода с ячейками (МСК). */
export function resolveMainInboundWarehouseId(): string {
  try {
    return mainWarehouseId();
  } catch {
    return resolveWarehouseId();
  }
}

export function isMainInboundWarehouseId(warehouseId: string): boolean {
  const id = String(warehouseId || '').trim();
  if (!id) return false;
  try {
    if (id === mainWarehouseId()) return true;
  } catch {
    /* ignore */
  }
  try {
    if (id === resolveWarehouseId()) return true;
  } catch {
    /* ignore */
  }
  const wh = get<{ code: string; name: string }>(
    `SELECT IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
    [id]
  );
  if (!wh) return false;
  const code = String(wh.code || '').trim().toUpperCase();
  const name = String(wh.name || '').trim().toLowerCase();
  if (code === 'MAIN' || code === CELLS_DEFAULT_WAREHOUSE_CODE) return true;
  return /основн/i.test(name) && !/сто|резерв|курьер|сдэк|автобус/i.test(name);
}

export function listCellCodes(warehouseId?: string): string[] {
  ensureWarehouseCellsSchema();
  const wid = resolveWarehouseId(warehouseId || resolveMainInboundWarehouseId());
  ensureFloorPalletCells(wid, [8, 11, 13]);
  return all<{ code: string }>(
    `SELECT code FROM warehouse_cells WHERE warehouse_id = ? AND is_active = 1 ORDER BY rack, bay, level, code`,
    [wid]
  ).map((r) => String(r.code || ''));
}

/** Склады, куда разрешён приход с размещением (флаг allow_inbound + сетка ячеек). */
export function listWarehousesWithCells(): Array<{
  id: string;
  name: string;
  code: string;
  allow_inbound: number;
}> {
  ensureWarehouseCellsSchema();
  return all<{ id: string; name: string; code: string; allow_inbound: number }>(
    `SELECT DISTINCT w.id, IFNULL(w.name,'') AS name, IFNULL(w.code,'') AS code,
            IFNULL(w.allow_inbound, 0) AS allow_inbound
     FROM warehouses w
     INNER JOIN warehouse_cells c ON c.warehouse_id = w.id AND IFNULL(c.is_active, 1) = 1
     WHERE IFNULL(w.is_active, 1) = 1
       AND IFNULL(w.allow_inbound, 0) = 1
     ORDER BY
       CASE
         WHEN IFNULL(w.code,'') = 'НФ-000032' THEN 0
         WHEN IFNULL(w.code,'') LIKE 'STO-RES-%' THEN 1
         ELSE 2
       END,
       w.name COLLATE NOCASE`
  ).map((r) => ({
    id: String(r.id),
    name: String(r.name || ''),
    code: String(r.code || ''),
    allow_inbound: Number(r.allow_inbound) ? 1 : 0,
  }));
}

export function warehouseAllowsInbound(warehouseId: string): boolean {
  const wid = String(warehouseId || '').trim();
  if (!wid) return false;
  ensureWarehouseCellsSchema();
  const row = get<{ allow_inbound: number }>(
    `SELECT IFNULL(allow_inbound, 0) AS allow_inbound FROM warehouses WHERE id = ?`,
    [wid]
  );
  return Number(row?.allow_inbound) === 1;
}

function ensureAllowInboundColumn(): void {
  const cols = all<{ name: string }>(`PRAGMA table_info(warehouses)`).map((c) => c.name);
  if (!cols.length || cols.includes('allow_inbound')) return;
  run(`ALTER TABLE warehouses ADD COLUMN allow_inbound INTEGER NOT NULL DEFAULT 0`);
  run(
    `UPDATE warehouses SET allow_inbound = 1
     WHERE IFNULL(code,'') = 'НФ-000032'
        OR IFNULL(code,'') LIKE 'STO-RES-%'
        OR lower(IFNULL(name,'')) LIKE 'филиал%москва%'
        OR lower(IFNULL(name,'')) LIKE 'отложено%под%сто%'`
  );
}

export function warehouseHasActiveCells(warehouseId: string): boolean {
  const wid = String(warehouseId || '').trim();
  if (!wid) return false;
  return listCellCodes(wid).length > 0;
}

export function applyCellReceiveDelta(input: {
  warehouse_id: string;
  cell_code: string;
  product_id: string;
  sku?: string;
  product_name?: string;
  qty: number;
  supply?: string;
}): void {
  ensureWarehouseCellsSchema();
  const warehouseId = String(input.warehouse_id || '').trim();
  const qty = Number(input.qty);
  if (!(qty > 0)) throw new Error('Количество размещения должно быть > 0');
  const parts = parseCellCode(String(input.cell_code || ''));
  if (!parts) throw new Error(`Неверный код ячейки: ${input.cell_code}`);
  const cellId = upsertCell(warehouseId, parts);
  let sku = String(input.sku || '').trim();
  let productId = String(input.product_id || '').trim();
  let productName = String(input.product_name || '').trim();
  if (productId && !sku) {
    const p = get<{ sku: string; name: string }>(
      `SELECT IFNULL(sku,'') AS sku, IFNULL(name,'') AS name FROM products WHERE id = ?`,
      [productId]
    );
    sku = String(p?.sku || '').trim();
    if (!productName) productName = String(p?.name || '').trim();
  }
  if (!sku) throw new Error('Не удалось определить SKU для размещения');
  const supply = String(input.supply || '').trim();
  const existing = get<{ qty: number }>(
    `SELECT qty FROM stock_cell_balances WHERE warehouse_id = ? AND cell_id = ? AND sku = ?`,
    [warehouseId, cellId, sku]
  );
  if (existing) {
    run(
      `UPDATE stock_cell_balances
       SET qty = qty + ?, supply = CASE WHEN ? != '' THEN ? ELSE supply END,
           product_id = CASE WHEN ? != '' THEN ? ELSE product_id END,
           product_name = CASE WHEN ? != '' THEN ? ELSE product_name END,
           updated_at = datetime('now')
       WHERE warehouse_id = ? AND cell_id = ? AND sku = ?`,
      [
        qty,
        supply,
        supply,
        productId,
        productId,
        productName,
        productName,
        warehouseId,
        cellId,
        sku,
      ]
    );
  } else {
    run(
      `INSERT INTO stock_cell_balances
       (warehouse_id, cell_id, product_id, sku, product_name, supply, qty)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [warehouseId, cellId, productId, sku, productName, supply, qty]
    );
  }
}

/** Списание с ячейки (возврат / перемещение). Не уходит в минус. */
export function applyCellIssueDelta(input: {
  warehouse_id: string;
  cell_code: string;
  product_id: string;
  sku?: string;
  qty: number;
}): void {
  ensureWarehouseCellsSchema();
  const warehouseId = String(input.warehouse_id || '').trim();
  const qty = Number(input.qty);
  if (!(qty > 0)) return;
  const parts = parseCellCode(String(input.cell_code || ''));
  if (!parts) return;
  let sku = String(input.sku || '').trim();
  const productId = String(input.product_id || '').trim();
  if (productId && !sku) {
    sku = String(
      get<{ sku: string }>(`SELECT IFNULL(sku,'') AS sku FROM products WHERE id = ?`, [productId])
        ?.sku || ''
    ).trim();
  }
  if (!sku) return;
  const cellId = upsertCell(warehouseId, parts);
  const existing =
    get<{ qty: number }>(
      `SELECT qty FROM stock_cell_balances WHERE warehouse_id = ? AND cell_id = ? AND sku = ?`,
      [warehouseId, cellId, sku]
    ) ||
    (productId
      ? get<{ qty: number }>(
          `SELECT qty FROM stock_cell_balances WHERE warehouse_id = ? AND cell_id = ? AND product_id = ?`,
          [warehouseId, cellId, productId]
        )
      : null);
  if (!existing) return;
  const next = Math.max(0, (Number(existing.qty) || 0) - qty);
  if (next <= 0) {
    run(
      `DELETE FROM stock_cell_balances WHERE warehouse_id = ? AND cell_id = ? AND (sku = ? OR (? != '' AND product_id = ?))`,
      [warehouseId, cellId, sku, productId, productId]
    );
  } else {
    run(
      `UPDATE stock_cell_balances SET qty = ?, updated_at = datetime('now')
       WHERE warehouse_id = ? AND cell_id = ? AND (sku = ? OR (? != '' AND product_id = ?))`,
      [next, warehouseId, cellId, sku, productId, productId]
    );
  }
}

export function insertLinePlacements(input: {
  doc_id: string;
  line_id: string;
  warehouse_id: string;
  product_id: string;
  placements: Array<{ cell_code: string; qty: number; warehouse_id?: string }>;
}): void {
  ensureWarehouseCellsSchema();
  const docId = String(input.doc_id || '').trim();
  const lineId = String(input.line_id || '').trim();
  const defaultWh = String(input.warehouse_id || '').trim();
  const productId = String(input.product_id || '').trim();
  if (!docId || !lineId || !defaultWh) throw new Error('Не указан документ или строка');
  const product = get<{ sku: string; name: string }>(
    `SELECT IFNULL(sku,'') AS sku, IFNULL(name,'') AS name FROM products WHERE id = ?`,
    [productId]
  );
  for (const p of input.placements || []) {
    const qty = Number(p.qty);
    const cellCode = String(p.cell_code || '').trim();
    const wh = String(p.warehouse_id || '').trim() || defaultWh;
    if (!(qty > 0)) throw new Error('Количество размещения должно быть > 0');
    if (!wh) throw new Error('Не указан склад размещения');
    // Адрес необязателен («—»): остаток на склад без ячейки
    if (!cellCode || cellCode === '—' || cellCode === '-' || cellCode === '–') {
      run(
        `INSERT INTO stock_doc_line_placements (id, doc_id, line_id, cell_id, cell_code, qty, warehouse_id)
         VALUES (?, ?, ?, '', '', ?, ?)`,
        [newGuid(), docId, lineId, qty, wh]
      );
      continue;
    }
    const parts = parseCellCode(cellCode);
    if (!parts) throw new Error(`Неверный код ячейки: ${cellCode}`);
    const cellId = upsertCell(wh, parts);
    run(
      `INSERT INTO stock_doc_line_placements (id, doc_id, line_id, cell_id, cell_code, qty, warehouse_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newGuid(), docId, lineId, cellId, parts.code, qty, wh]
    );
    void product;
  }
}

export function applyInboundPlacementsForDoc(docId: string): boolean {
  ensureWarehouseCellsSchema();
  const id = String(docId || '').trim();
  if (!id) return false;
  const doc = get<{ warehouse_id: string; posted: number }>(
    `SELECT warehouse_id, posted FROM stock_docs WHERE id = ?`,
    [id]
  );
  if (!doc?.warehouse_id) return false;
  const rows = all<{
    line_id: string;
    cell_code: string;
    qty: number;
    product_id: string;
    sku: string;
    product_name: string;
    line_warehouse_id: string;
    placement_warehouse_id: string;
  }>(
    `SELECT p.line_id, p.cell_code, p.qty,
            IFNULL(l.product_id,'') AS product_id,
            IFNULL(pr.sku,'') AS sku,
            IFNULL(pr.name,'') AS product_name,
            IFNULL(l.warehouse_id,'') AS line_warehouse_id,
            IFNULL(p.warehouse_id,'') AS placement_warehouse_id
     FROM stock_doc_line_placements p
     JOIN stock_doc_lines l ON l.id = p.line_id
     LEFT JOIN products pr ON pr.id = l.product_id
     WHERE p.doc_id = ?
     ORDER BY p.line_id, p.cell_code`,
    [id]
  );
  if (!rows.length) return false;
  if (!doc.posted) throw new Error('Размещение применяется только к проведённому документу');
  const headerWh = String(doc.warehouse_id || '').trim();
  for (const row of rows) {
    const cellCode = String(row.cell_code || '').trim();
    if (!cellCode || cellCode === '—' || cellCode === '-' || cellCode === '–') continue;
    const wh =
      String(row.placement_warehouse_id || '').trim() ||
      String(row.line_warehouse_id || '').trim() ||
      headerWh;
    if (!wh) throw new Error('Не указан склад размещения');
    applyCellReceiveDelta({
      warehouse_id: wh,
      cell_code: cellCode,
      product_id: String(row.product_id),
      sku: String(row.sku),
      product_name: String(row.product_name),
      qty: Number(row.qty),
    });
  }
  return true;
}

/**
 * Задать размещение строки прихода (одна или несколько частей: склад + ячейка + qty).
 * Сумма qty частей должна равняться количеству строки.
 */
export function replaceLinePlacements(input: {
  doc_id: string;
  line_id: string;
  placements: Array<{ warehouse_id: string; cell_code: string; qty: number }>;
}): { ok: true; placements: Array<{ warehouse_id: string; cell_code: string; qty: number }> } {
  ensureWarehouseCellsSchema();
  const docId = String(input.doc_id || '').trim();
  const lineId = String(input.line_id || '').trim();
  if (!docId || !lineId) throw new Error('Не указан документ или строка');

  const doc = get<{ id: string; posted: number; warehouse_id: string; doc_type: string }>(
    `SELECT id, posted, IFNULL(warehouse_id,'') AS warehouse_id, IFNULL(doc_type,'') AS doc_type
     FROM stock_docs WHERE id = ?`,
    [docId]
  );
  if (!doc) throw new Error('Документ не найден');
  if (String(doc.doc_type) !== 'in') throw new Error('Размещение только для приходных');

  const line = get<{ id: string; product_id: string; qty: number; warehouse_id: string }>(
    `SELECT id, IFNULL(product_id,'') AS product_id, qty, IFNULL(warehouse_id,'') AS warehouse_id
     FROM stock_doc_lines WHERE id = ? AND doc_id = ?`,
    [lineId, docId]
  );
  if (!line) throw new Error('Строка не найдена');
  const lineQty = Number(line.qty) || 0;
  if (!(lineQty > 0)) throw new Error('В строке нет количества');
  const productId = String(line.product_id || '').trim();
  if (!productId) throw new Error('В строке нет товара');

  const parts = (input.placements || [])
    .map((p) => ({
      warehouse_id: String(p.warehouse_id || '').trim(),
      cell_code: String(p.cell_code || '').trim(),
      qty: Math.max(0, Math.round(Number(p.qty) || 0)),
    }))
    .filter((p) => p.qty > 0);
  if (!parts.length) throw new Error('Укажите хотя бы одну часть размещения');
  const sum = parts.reduce((s, p) => s + p.qty, 0);
  if (Math.abs(sum - lineQty) >= 0.0001) {
    throw new Error(`Сумма частей (${sum}) должна быть равна количеству строки (${lineQty})`);
  }
  for (const p of parts) {
    if (!p.warehouse_id) throw new Error('Выберите склад для каждой части');
    const cell = String(p.cell_code || '').trim();
    if (cell && cell !== '—' && cell !== '-' && cell !== '–') {
      if (!parseCellCode(cell)) throw new Error(`Неверный код ячейки: ${cell}`);
    } else {
      p.cell_code = '';
    }
    if (!warehouseAllowsInbound(p.warehouse_id)) {
      throw new Error('На этот склад приход запрещён — включите «Приходуем сюда» в карточке склада');
    }
  }

  const oldPlacements = all<{ cell_code: string; qty: number; warehouse_id: string }>(
    `SELECT cell_code, qty, IFNULL(warehouse_id,'') AS warehouse_id
     FROM stock_doc_line_placements WHERE doc_id = ? AND line_id = ?`,
    [docId, lineId]
  );
  const fallbackWh =
    String(line.warehouse_id || '').trim() || String(doc.warehouse_id || '').trim();

  if (Number(doc.posted) === 1) {
    for (const p of oldPlacements) {
      const oldCell = String(p.cell_code || '').trim();
      if (!oldCell) continue;
      applyCellIssueDelta({
        warehouse_id: String(p.warehouse_id || '').trim() || fallbackWh,
        cell_code: oldCell,
        product_id: productId,
        qty: Number(p.qty) || 0,
      });
    }
  }

  run(`DELETE FROM stock_doc_line_placements WHERE doc_id = ? AND line_id = ?`, [docId, lineId]);
  const primaryWh = parts.reduce((best, p) => (p.qty > best.qty ? p : best), parts[0]).warehouse_id;
  insertLinePlacements({
    doc_id: docId,
    line_id: lineId,
    warehouse_id: primaryWh,
    product_id: productId,
    placements: parts,
  });
  run(`UPDATE stock_doc_lines SET warehouse_id = ? WHERE id = ? AND doc_id = ?`, [
    primaryWh,
    lineId,
    docId,
  ]);
  run(
    `UPDATE stock_docs SET warehouse_id = ?
     WHERE id = ? AND (IFNULL(warehouse_id,'') = '' OR warehouse_id = ?)`,
    [primaryWh, docId, fallbackWh]
  );

  if (Number(doc.posted) === 1) {
    for (const p of parts) {
      if (!p.cell_code) continue;
      applyCellReceiveDelta({
        warehouse_id: p.warehouse_id,
        cell_code: p.cell_code,
        product_id: productId,
        qty: p.qty,
      });
    }
  }

  return { ok: true, placements: parts };
}

/** @deprecated use replaceLinePlacements */
export function replaceLinePlacement(input: {
  doc_id: string;
  line_id: string;
  warehouse_id: string;
  cell_code: string;
}): { ok: true; cell_code: string; warehouse_id: string } {
  const line = get<{ qty: number }>(
    `SELECT qty FROM stock_doc_lines WHERE id = ? AND doc_id = ?`,
    [String(input.line_id || ''), String(input.doc_id || '')]
  );
  const qty = Number(line?.qty) || 0;
  const r = replaceLinePlacements({
    doc_id: input.doc_id,
    line_id: input.line_id,
    placements: [
      {
        warehouse_id: input.warehouse_id,
        cell_code: input.cell_code,
        qty,
      },
    ],
  });
  const first = r.placements[0];
  return { ok: true, cell_code: first.cell_code, warehouse_id: first.warehouse_id };
}

export function getPlacementsForDoc(docId: string) {
  ensureWarehouseCellsSchema();
  const id = String(docId || '').trim();
  if (!id) return { lines: [] };
  const rows = all<{
    line_id: string;
    cell_code: string;
    qty: number;
    sku: string;
    product_name: string;
    product_id: string;
    warehouse_id: string;
  }>(
    `SELECT p.line_id, p.cell_code, p.qty,
            IFNULL(pr.sku,'') AS sku,
            IFNULL(pr.name,'') AS product_name,
            IFNULL(l.product_id,'') AS product_id,
            COALESCE(
              NULLIF(TRIM(IFNULL(p.warehouse_id,'')), ''),
              NULLIF(TRIM(IFNULL(l.warehouse_id,'')), ''),
              ''
            ) AS warehouse_id
     FROM stock_doc_line_placements p
     JOIN stock_doc_lines l ON l.id = p.line_id
     LEFT JOIN products pr ON pr.id = l.product_id
     WHERE p.doc_id = ?
     ORDER BY l.rowid, p.rowid, p.cell_code`,
    [id]
  );
  return { lines: rows };
}

export function getPlacementSummariesForDocs(docIds: string[]): Record<string, string> {
  ensureWarehouseCellsSchema();
  const ids = (docIds || []).map((x) => String(x || '').trim()).filter(Boolean);
  if (!ids.length) return {};
  const ph = ids.map(() => '?').join(',');
  const rows = all<{ doc_id: string; cell_code: string; qty: number }>(
    `SELECT doc_id, cell_code, SUM(qty) AS qty
     FROM stock_doc_line_placements
     WHERE doc_id IN (${ph})
     GROUP BY doc_id, cell_code
     ORDER BY doc_id, cell_code`,
    ids
  );
  const out: Record<string, string[]> = {};
  for (const row of rows) {
    const docId = String(row.doc_id);
    if (!out[docId]) out[docId] = [];
    const qty = Number(row.qty);
    const qLabel = Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 100) / 100);
    out[docId].push(`${row.cell_code}×${qLabel}`);
  }
  const result: Record<string, string> = {};
  for (const [docId, parts] of Object.entries(out)) {
    result[docId] = parts.join(', ');
  }
  return result;
}

export function mountWarehouseCellsRoutes(api: Hono): void {
  api.get('/warehouse/cells/meta', (c) => {
    try {
      ensureWarehouseCellsSchema();
      return c.json(getCellsMeta(c.req.query('warehouse_id') || undefined));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/warehouse/cells/map', (c) => {
    try {
      return c.json(getCellsMap(c.req.query('warehouse_id') || undefined));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/warehouse/cells/balances', (c) => {
    try {
      return c.json(
        listCellBalances({
          warehouse_id: c.req.query('warehouse_id') || undefined,
          q: c.req.query('q') || undefined,
          rack: c.req.query('rack') || undefined,
          limit: Number(c.req.query('limit') || 100),
          offset: Number(c.req.query('offset') || 0),
        })
      );
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/warehouse/cells/pallet', (c) => {
    try {
      return c.json(
        getWarehousePallet({
          kind: c.req.query('kind') || undefined,
          warehouse_id: c.req.query('warehouse_id') || undefined,
        })
      );
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/warehouse/cells/:code', (c) => {
    try {
      const code = decodeURIComponent(c.req.param('code') || '');
      return c.json(
        getCellContents({
          warehouse_id: c.req.query('warehouse_id') || undefined,
          code,
        })
      );
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 404);
    }
  });

  api.post('/warehouse/cells/import', async (c) => {
    try {
      const body = await c.req.json<{
        warehouse_id?: string;
        rows?: ImportCellRow[];
        source?: string;
        sheet_title?: string;
        fetched_at?: string;
        replace?: boolean;
        from_cache?: boolean;
      }>();
      const result = body.from_cache
        ? importCellsFromCacheFile()
        : importCellRows({
            warehouse_id: body.warehouse_id,
            rows: body.rows || [],
            source: body.source,
            sheet_title: body.sheet_title,
            fetched_at: body.fetched_at,
            replace: body.replace,
          });
      return c.json({ ok: true, ...result });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/warehouse/cells/import-cache', (c) => {
    try {
      const result = importCellsFromCacheFile();
      return c.json({ ok: true, ...result });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });
}
