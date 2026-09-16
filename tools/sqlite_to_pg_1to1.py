#!/usr/bin/env python3
"""
Полный 1:1 перенос SQLite → Postgres (схема + данные).
Работает offline по копии файла — не трогает живой WMS.

  python3 tools/sqlite_to_pg_1to1.py \\
    --sqlite /tmp/wms-dump.sqlite \\
    --pg postgresql://wms:...@127.0.0.1:5432/wms
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from typing import Any

import psycopg2
from psycopg2.extras import execute_batch


SKIP_TABLES = {"sqlite_sequence", "sqlite_stat1", "sqlite_stat4"}


def map_type(sqlite_type: str) -> str:
    t = (sqlite_type or "").strip().upper()
    if not t:
        return "TEXT"
    if "INT" in t:
        return "BIGINT"
    if "BOOL" in t:
        return "BOOLEAN"
    if "REAL" in t or "FLOA" in t or "DOUB" in t:
        return "DOUBLE PRECISION"
    if "BLOB" in t:
        return "BYTEA"
    if "NUM" in t or "DEC" in t:
        return "NUMERIC"
    return "TEXT"


def qid(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [r[0] for r in rows if r[0] not in SKIP_TABLES]


def columns(conn: sqlite3.Connection, table: str) -> list[tuple[str, str, int, Any, int]]:
    # cid, name, type, notnull, dflt_value, pk
    return conn.execute(f"PRAGMA table_info({qid(table)})").fetchall()


def create_table_sql(conn: sqlite3.Connection, table: str) -> str:
    cols = columns(conn, table)
    parts: list[str] = []
    pk_cols = [c[1] for c in cols if c[5] > 0]
    pk_cols.sort(key=lambda n: next(c[5] for c in cols if c[1] == n))
    for _cid, name, ctype, notnull, dflt, pk in cols:
        line = f"  {qid(name)} {map_type(ctype)}"
        if notnull and not pk:
            line += " NOT NULL"
        if dflt is not None:
            d = str(dflt)
            if re.search(r"datetime\s*\(\s*['\"]now['\"]\s*\)", d, re.I):
                line += " DEFAULT NOW()"
            else:
                line += f" DEFAULT {d}"
        parts.append(line)
    if pk_cols:
        parts.append(f"  PRIMARY KEY ({', '.join(qid(c) for c in pk_cols)})")
    return f"CREATE TABLE IF NOT EXISTS {qid(table)} (\n" + ",\n".join(parts) + "\n);"


def adapt(v: Any) -> Any:
    if isinstance(v, memoryview):
        return bytes(v)
    return v


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", required=True)
    ap.add_argument("--pg", required=True)
    ap.add_argument("--drop", action="store_true", help="DROP SCHEMA public CASCADE before load")
    ap.add_argument("--batch", type=int, default=500)
    ap.add_argument("--only", default="", help="comma-separated table names")
    args = ap.parse_args()

    sq = sqlite3.connect(args.sqlite)
    sq.row_factory = sqlite3.Row
    pg = psycopg2.connect(args.pg)
    pg.autocommit = False

    want = {t.strip() for t in args.only.split(",") if t.strip()}
    all_tables = tables(sq)
    if want:
        all_tables = [t for t in all_tables if t in want]

    print(f"tables={len(all_tables)} sqlite={args.sqlite}", flush=True)

    with pg.cursor() as cur:
        if args.drop:
            print("DROP SCHEMA public CASCADE", flush=True)
            cur.execute("DROP SCHEMA public CASCADE")
            cur.execute("CREATE SCHEMA public")
            cur.execute("GRANT ALL ON SCHEMA public TO public")
        cur.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
        pg.commit()

        for i, table in enumerate(all_tables, 1):
            ddl = create_table_sql(sq, table)
            print(f"[{i}/{len(all_tables)}] DDL {table}", flush=True)
            cur.execute(ddl)
        pg.commit()

        for i, table in enumerate(all_tables, 1):
            cols = [c[1] for c in columns(sq, table)]
            if not cols:
                continue
            n = sq.execute(f"SELECT count(*) FROM {qid(table)}").fetchone()[0]
            print(f"[{i}/{len(all_tables)}] DATA {table} rows={n}", flush=True)
            if n == 0:
                continue
            col_sql = ", ".join(qid(c) for c in cols)
            placeholders = ", ".join(["%s"] * len(cols))
            insert = f"INSERT INTO {qid(table)} ({col_sql}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"
            cur.execute(f"TRUNCATE TABLE {qid(table)} CASCADE")
            offset = 0
            batch = max(50, args.batch)
            while offset < n:
                rows = sq.execute(
                    f"SELECT * FROM {qid(table)} LIMIT ? OFFSET ?",
                    (batch, offset),
                ).fetchall()
                if not rows:
                    break
                payload = [tuple(adapt(r[c]) for c in cols) for r in rows]
                execute_batch(cur, insert, payload, page_size=batch)
                offset += len(rows)
                if offset % (batch * 20) == 0 or offset >= n:
                    pg.commit()
                    print(f"  … {offset}/{n}", flush=True)
            pg.commit()

    # verify
    print("=== VERIFY ===", flush=True)
    with pg.cursor() as cur:
        for table in all_tables:
            sq_n = sq.execute(f"SELECT count(*) FROM {qid(table)}").fetchone()[0]
            cur.execute(f"SELECT count(*) FROM {qid(table)}")
            pg_n = cur.fetchone()[0]
            mark = "OK" if sq_n == pg_n else "DIFF"
            if sq_n or pg_n:
                print(f"{mark} {table}: sqlite={sq_n} pg={pg_n}", flush=True)
            if mark == "DIFF":
                print("FAIL count mismatch", file=sys.stderr)
                return 2

    sq.close()
    pg.close()
    print("DONE 1:1 OK", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
