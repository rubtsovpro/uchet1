#!/usr/bin/env node
/**
 * Сохранить учётки WMS при полной подмене warehouse.sqlite.
 *
 *   node preserve-wms-auth.js export /path/warehouse.sqlite /path/auth-snapshot.sqlite
 *   node preserve-wms-auth.js import /path/warehouse.sqlite /path/auth-snapshot.sqlite
 *
 * Таблицы: staff, sessions, integration_api_keys, staff_departments.
 */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const TABLES = ['staff', 'sessions', 'integration_api_keys', 'staff_departments'];

function usage() {
  console.error('Usage: preserve-wms-auth.js export|import <warehouse.sqlite> <auth-snapshot.sqlite>');
  process.exit(1);
}

function tableExists(db, name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  );
}

function tableColumns(db, name) {
  return db.prepare(`PRAGMA table_info(${name})`).all().map((c) => String(c.name));
}

function copyTable(src, dest, name) {
  if (!tableExists(src, name)) return { table: name, rows: 0, skipped: true };
  if (!tableExists(dest, name)) {
    const ddl = src.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.sql;
    if (!ddl) return { table: name, rows: 0, skipped: true };
    dest.exec(String(ddl));
  }

  const srcCols = tableColumns(src, name);
  const destCols = new Set(tableColumns(dest, name));
  const cols = srcCols.filter((c) => destCols.has(c));
  if (!cols.length) return { table: name, rows: 0, skipped: true };

  dest.exec(`DELETE FROM ${name}`);
  const rows = src.prepare(`SELECT ${cols.join(', ')} FROM ${name}`).all();
  if (!rows.length) return { table: name, rows: 0, skipped: false };

  const placeholders = cols.map(() => '?').join(', ');
  const ins = dest.prepare(`INSERT INTO ${name} (${cols.join(', ')}) VALUES (${placeholders})`);
  for (const row of rows) {
    ins.run(...cols.map((c) => row[c] ?? null));
  }
  return { table: name, rows: rows.length, skipped: false };
}

function exportAuth(srcPath, outPath) {
  if (!fs.existsSync(srcPath)) throw new Error(`source not found: ${srcPath}`);
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  const src = new DatabaseSync(srcPath, { readonly: true });
  const out = new DatabaseSync(outPath);
  out.exec('PRAGMA journal_mode = DELETE');

  const stats = [];
  for (const table of TABLES) {
    if (!tableExists(src, table)) continue;
    const ddl = src.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)?.sql;
    if (!ddl) continue;
    out.exec(String(ddl));
    const cols = tableColumns(src, table);
    const rows = src.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all();
    if (!rows.length) {
      stats.push({ table, rows: 0 });
      continue;
    }
    const placeholders = cols.map(() => '?').join(', ');
    const ins = out.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);
    for (const row of rows) ins.run(...cols.map((c) => row[c] ?? null));
    stats.push({ table, rows: rows.length });
  }

  return stats;
}

function importAuth(destPath, snapPath) {
  if (!fs.existsSync(destPath)) throw new Error(`warehouse not found: ${destPath}`);
  if (!fs.existsSync(snapPath)) throw new Error(`auth snapshot not found: ${snapPath}`);

  const snap = new DatabaseSync(snapPath, { readonly: true });
  const dest = new DatabaseSync(destPath);
  dest.exec('BEGIN IMMEDIATE');
  const stats = [];
  try {
    for (const table of TABLES) {
      if (!tableExists(snap, table)) continue;
      stats.push(copyTable(snap, dest, table));
    }
    dest.exec('COMMIT');
  } catch (e) {
    dest.exec('ROLLBACK');
    throw e;
  }
  return stats;
}

const [cmd, dbPath, snapPath] = process.argv.slice(2);
if (!cmd || !dbPath || !snapPath) usage();

try {
  const stats = cmd === 'export' ? exportAuth(dbPath, snapPath) : cmd === 'import' ? importAuth(dbPath, snapPath) : null;
  if (!stats) usage();
  console.log(JSON.stringify({ ok: true, cmd, db: dbPath, snapshot: snapPath, tables: stats }, null, 2));
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
}
