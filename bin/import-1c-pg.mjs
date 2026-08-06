#!/usr/bin/env node
/**
 * Импорт справочников и остатков из восстановленного PG дампа 1С (Pnevmopodveska_2025)
 * в SQLite Учёта №1. GUID = тот же формат, что OData/HS.
 *
 * Запуск на VPS:
 *   cd /root/1c_pnevmopodveska1_ru/warehouse && node bin/import-1c-pg.mjs
 */
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.WMS_DATA_DIR
  ? path.join(process.env.WMS_DATA_DIR, 'warehouse.sqlite')
  : path.join(ROOT, 'data', 'warehouse.sqlite');
const PG_DB = process.env.PG_1C_DB || 'Pnevmopodveska_2025';
const TMP = '/root/1c-rarus-s3/import-tmp';

/** bytea Ref_Key 1С → UUID как в OData/HS */
function refToUuid(hexOrBuf) {
  const b = typeof hexOrBuf === 'string' ? Buffer.from(hexOrBuf, 'hex') : Buffer.from(hexOrBuf);
  if (b.length !== 16) return null;
  return (
    `${b.subarray(12, 16).toString('hex')}-` +
    `${b.subarray(10, 12).toString('hex')}-` +
    `${b.subarray(8, 10).toString('hex')}-` +
    `${b.subarray(0, 2).toString('hex')}-` +
    `${b.subarray(2, 8).toString('hex')}`
  ).toLowerCase();
}

function psqlCopy(sql, outFile) {
  fs.mkdirSync(TMP, { recursive: true });
  const r = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-d', PG_DB, '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    throw new Error(`psql failed: ${r.stderr || r.stdout}`);
  }
  // sql should be COPY (...) TO 'outFile' WITH (FORMAT csv, HEADER true)
  void outFile;
}

function psqlCopyTo(sqlSelect, outFile) {
  fs.mkdirSync(TMP, { recursive: true });
  const copy = `COPY (${sqlSelect}) TO STDOUT WITH (FORMAT csv, HEADER true)`;
  const r = spawnSync(
    'sudo',
    ['-u', 'postgres', 'psql', '-d', PG_DB, '-v', 'ON_ERROR_STOP=1', '-c', copy],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    throw new Error(`psql COPY failed: ${r.stderr || r.stdout}`);
  }
  fs.writeFileSync(outFile, r.stdout);
  return outFile;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return { header: [], rows: [] };
  const header = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length === 1 && cols[0] === '') continue;
    const obj = {};
    header.forEach((h, j) => {
      obj[h] = cols[j] ?? '';
    });
    rows.push(obj);
  }
  return { header, rows };
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function titleCaseRu(s) {
  const t = String(s || '').trim();
  if (!t) return t;
  if (t !== t.toUpperCase()) return t;
  return t
    .toLowerCase()
    .replace(/(^|[\s\-«"])(\S)/g, (_, a, b) => a + b.toUpperCase());
}

function main() {
  console.log('DB', DB_PATH);
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=OFF; PRAGMA busy_timeout=60000;');

  const unit =
    db.prepare(`SELECT id FROM units WHERE short_name='шт' LIMIT 1`).get()?.id ||
    (() => {
      db.prepare(`INSERT OR IGNORE INTO units (id,name,short_name) VALUES ('unit-pcs','Штука','шт')`).run();
      return 'unit-pcs';
    })();

  // ——— warehouses ———
  console.log('export warehouses…');
  const whFile = path.join(TMP, 'warehouses.csv');
  psqlCopyTo(
    `SELECT encode(_idrref,'hex') AS id_hex, coalesce(_code,'') AS code,
            coalesce(_description,'') AS name, CASE WHEN _marked THEN 1 ELSE 0 END AS marked
     FROM _reference382`,
    whFile
  );
  let { rows: whRows } = parseCsv(fs.readFileSync(whFile, 'utf8'));
  const upsertWh = db.prepare(
    `INSERT INTO warehouses (id, name, code, is_active)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code, is_active=excluded.is_active`
  );
  let whN = 0;
  db.exec('BEGIN');
  for (const r of whRows) {
    const id = refToUuid(r.id_hex);
    if (!id) continue;
    let code = (r.code || id).trim() || id;
    const clash = db.prepare(`SELECT id FROM warehouses WHERE code=? AND id!=?`).get(code, id);
    if (clash) code = `${code}:${id.slice(0, 8)}`;
    upsertWh.run(id, (r.name || code).trim() || id, code, r.marked === '1' ? 0 : 1);
    whN++;
  }
  db.exec('COMMIT');
  console.log('warehouses', whN);

  // ——— counterparties ———
  console.log('export counterparties…');
  const cpFile = path.join(TMP, 'counterparties.csv');
  psqlCopyTo(
    `SELECT encode(_idrref,'hex') AS id_hex,
            coalesce(_code,'') AS code,
            coalesce(_description,'') AS name,
            coalesce(_fld4006,'') AS inn,
            coalesce(_fld4010,'') AS phone,
            CASE WHEN _marked THEN 1 ELSE 0 END AS marked,
            CASE WHEN _folder THEN 1 ELSE 0 END AS is_item,
            CASE WHEN coalesce(_fld3987,false) THEN 1 ELSE 0 END AS buyer,
            CASE WHEN coalesce(_fld3988,false) THEN 1 ELSE 0 END AS supplier,
            CASE
              WHEN _fld3996 IS NULL OR _fld3996 < TIMESTAMP '1900-01-01' THEN ''
              ELSE to_char(_fld3996, 'YYYY-MM-DD HH24:MI:SS')
            END AS created_at
     FROM _reference205x1
     WHERE _folder = true`,
    cpFile
  );
  let { rows: cpRows } = parseCsv(fs.readFileSync(cpFile, 'utf8'));
  const upsertCp = db.prepare(
    `INSERT INTO counterparties (id, name, inn, phone, kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=CASE WHEN excluded.name!='' THEN excluded.name ELSE counterparties.name END,
       inn=CASE WHEN excluded.inn!='' THEN excluded.inn ELSE counterparties.inn END,
       phone=CASE WHEN excluded.phone!='' THEN excluded.phone ELSE counterparties.phone END,
       kind=excluded.kind,
       created_at=CASE
         WHEN IFNULL(TRIM(counterparties.created_at),'') = '' AND IFNULL(TRIM(excluded.created_at),'') != ''
           THEN excluded.created_at
         ELSE counterparties.created_at
       END`
  );
  let cpN = 0;
  db.exec('BEGIN');
  for (const r of cpRows) {
    const id = refToUuid(r.id_hex);
    if (!id) continue;
    let kind = 'both';
    if (r.buyer === '1' && r.supplier !== '1') kind = 'buyer';
    else if (r.supplier === '1' && r.buyer !== '1') kind = 'supplier';
    else if (r.buyer !== '1' && r.supplier !== '1') kind = 'buyer';
    const name = titleCaseRu(r.name) || r.code || id;
    upsertCp.run(
      id,
      name,
      String(r.inn || '').replace(/\D/g, ''),
      String(r.phone || '').trim(),
      kind,
      String(r.created_at || '').trim()
    );
    cpN++;
  }
  db.exec('COMMIT');
  console.log('counterparties', cpN);

  // ——— categories (groups) ———
  console.log('export categories…');
  const catFile = path.join(TMP, 'categories.csv');
  psqlCopyTo(
    `SELECT encode(_idrref,'hex') AS id_hex,
            encode(_parentidrref,'hex') AS parent_hex,
            coalesce(_description,'') AS name,
            CASE WHEN _folder THEN 1 ELSE 0 END AS is_item
     FROM _reference239x1
     WHERE _folder = false AND NOT _marked`,
    catFile
  );
  let { rows: catRows } = parseCsv(fs.readFileSync(catFile, 'utf8'));
  const upsertCat = db.prepare(
    `INSERT INTO categories (id, name, parent_id)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, parent_id=excluded.parent_id`
  );
  let catN = 0;
  db.exec('BEGIN');
  for (const r of catRows) {
    const id = refToUuid(r.id_hex);
    if (!id) continue;
    let parentId = r.parent_hex ? refToUuid(r.parent_hex) : null;
    if (parentId === '00000000-0000-0000-0000-000000000000') parentId = null;
    upsertCat.run(id, (r.name || id).trim(), parentId);
    catN++;
  }
  db.exec('COMMIT');
  console.log('categories', catN);

  // ——— products ———
  console.log('export products…');
  const prFile = path.join(TMP, 'products.csv');
  psqlCopyTo(
    `SELECT encode(_idrref,'hex') AS id_hex,
            encode(_parentidrref,'hex') AS parent_hex,
            coalesce(_code,'') AS code,
            coalesce(_description,'') AS name,
            coalesce(_fld4926,'') AS article,
            CASE WHEN _marked THEN 1 ELSE 0 END AS marked
     FROM _reference239x1
     WHERE _folder = true`,
    prFile
  );
  let { rows: prRows } = parseCsv(fs.readFileSync(prFile, 'utf8'));
  const upsertPr = db.prepare(
    `INSERT INTO products (id, sku, name, category_id, unit_id, barcode, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       sku=excluded.sku,
       name=excluded.name,
       category_id=excluded.category_id,
       unit_id=excluded.unit_id,
       barcode=CASE WHEN excluded.barcode!='' THEN excluded.barcode ELSE products.barcode END,
       is_active=excluded.is_active`
  );
  let prN = 0;
  let prSkip = 0;
  db.exec('BEGIN');
  for (const r of prRows) {
    const id = refToUuid(r.id_hex);
    if (!id) continue;
    const article = String(r.article || '').trim();
    const code = String(r.code || '').trim();
    let name = String(r.name || '').trim();
    if (!name) name = code || article || id;
    let sku = code || article || id;
    const clash = db.prepare(`SELECT id FROM products WHERE sku=? AND id!=?`).get(sku, id);
    if (clash) sku = `${sku}:${id.slice(0, 8)}`;
    let categoryId = r.parent_hex ? refToUuid(r.parent_hex) : null;
    if (categoryId === '00000000-0000-0000-0000-000000000000') categoryId = null;
    if (categoryId && !db.prepare(`SELECT id FROM categories WHERE id=?`).get(categoryId)) {
      categoryId = null;
    }
    try {
      upsertPr.run(id, sku, name, categoryId, unit, article, r.marked === '1' ? 0 : 1);
      prN++;
    } catch (e) {
      prSkip++;
      if (prSkip < 5) console.warn('product skip', sku, e.message);
    }
  }
  db.exec('COMMIT');
  console.log('products', prN, 'skipped', prSkip);

  // ——— stock current ———
  console.log('export stock…');
  const stFile = path.join(TMP, 'stock.csv');
  psqlCopyTo(
    `SELECT encode(a._fld27312rref,'hex') AS product_hex,
            encode(a._fld27311_rrref,'hex') AS wh_hex,
            a._fld27318::text AS qty
     FROM _accumrgt27344x1 a
     WHERE a._period = TIMESTAMP '3999-11-01'
       AND a._fld27318 IS NOT NULL
       AND a._fld27318 <> 0`,
    stFile
  );
  let { rows: stRows } = parseCsv(fs.readFileSync(stFile, 'utf8'));
  db.prepare(`DELETE FROM product_store_rests`).run();
  db.prepare(`DELETE FROM stock_balances`).run();
  const insRest = db.prepare(
    `INSERT INTO product_store_rests (product_id, warehouse_id, qty) VALUES (?, ?, ?)
     ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty=excluded.qty`
  );
  const insBal = db.prepare(
    `INSERT INTO stock_balances (warehouse_id, product_id, qty) VALUES (?, ?, ?)
     ON CONFLICT(warehouse_id, product_id) DO UPDATE SET qty=excluded.qty`
  );
  let stN = 0;
  let stSkip = 0;
  db.exec('BEGIN');
  for (const r of stRows) {
    const productId = refToUuid(r.product_hex);
    const warehouseId = refToUuid(r.wh_hex);
    const qty = Number(r.qty) || 0;
    if (!productId || !warehouseId || !qty) continue;
    if (!db.prepare(`SELECT id FROM products WHERE id=?`).get(productId)) {
      stSkip++;
      continue;
    }
    if (!db.prepare(`SELECT id FROM warehouses WHERE id=?`).get(warehouseId)) {
      stSkip++;
      continue;
    }
    insRest.run(productId, warehouseId, qty);
    insBal.run(warehouseId, productId, qty);
    stN++;
  }
  db.exec('COMMIT');
  console.log('stock rows', stN, 'skipped', stSkip);

  const counts = {
    warehouses: db.prepare(`SELECT count(*) c FROM warehouses`).get().c,
    counterparties: db.prepare(`SELECT count(*) c FROM counterparties`).get().c,
    categories: db.prepare(`SELECT count(*) c FROM categories`).get().c,
    products: db.prepare(`SELECT count(*) c FROM products`).get().c,
    rests: db.prepare(`SELECT count(*) c FROM product_store_rests`).get().c,
    balances: db.prepare(`SELECT count(*) c FROM stock_balances`).get().c,
  };
  console.log('DONE', counts);
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('1c_pg_import_at', ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).run(new Date().toISOString());
}

main();
