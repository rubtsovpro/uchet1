#!/usr/bin/env python3
import sqlite3

db = sqlite3.connect(
    "file:/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite?mode=ro", uri=True
)
db.row_factory = sqlite3.Row

print("companies:")
for r in db.execute("SELECT id, name FROM companies ORDER BY name"):
    print(" ", r["id"], "|", r["name"])

print("\nwarehouses (active) + company + qty:")
for r in db.execute(
    """
SELECT w.code, w.name, w.id, IFNULL(w.company_id,'') cid,
  IFNULL(c.name,'') cname,
  IFNULL((
    SELECT ROUND(SUM(qty),1) FROM stock_balances b
    WHERE b.warehouse_id=w.id AND b.qty>0 AND b.qty<999
  ),0) q
FROM warehouses w
LEFT JOIN companies c ON c.id=w.company_id
WHERE IFNULL(w.is_active,1)=1
ORDER BY cname, w.name
"""
):
    mark = "STOCK" if r["q"] else "empty"
    print(
        f"[{mark:5}] {r['code']:22} {r['name'][:34]:34} | {r['cname'] or '(нет company_id)'} | qty={r['q']}"
    )

print("\n1C rests warehouses only:")
for r in db.execute(
    """
SELECT DISTINCT w.code, w.name, IFNULL(c.name,'') cname
FROM product_store_rests r
JOIN warehouses w ON w.id=r.warehouse_id
LEFT JOIN companies c ON c.id=w.company_id
ORDER BY w.name
"""
):
    print(f"  {r['code']:22} {r['name'][:40]:40} | {r['cname'] or '—'}")

print("\nmeta:", dict(db.execute(
    "SELECT key, value FROM meta WHERE key IN ('rests_synced_at','rests_source_department')"
).fetchall()))
