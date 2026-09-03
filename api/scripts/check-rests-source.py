#!/usr/bin/env python3
import sqlite3

db = sqlite3.connect(
    "file:/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite?mode=ro", uri=True
)
db.row_factory = sqlite3.Row

print("meta:")
for k in ("rests_synced_at", "rests_source_department"):
    row = db.execute("SELECT value FROM meta WHERE key=?", [k]).fetchone()
    print(" ", k, "=", row["value"] if row else None)

print("\nproduct_store_rests (заливка 1С):")
for r in db.execute(
    """
SELECT IFNULL(w.code,'') code, IFNULL(w.name,'') name,
  COUNT(*) n, ROUND(SUM(r.qty),1) q
FROM product_store_rests r
JOIN warehouses w ON w.id=r.warehouse_id
GROUP BY w.id ORDER BY q DESC
"""
):
    print(f"  {r['name']} ({r['code']}): {r['q']} шт / {r['n']} строк")

print("\nstock_balances с остатком:")
for r in db.execute(
    """
SELECT IFNULL(w.code,'') code, IFNULL(w.name,'') name,
  ROUND(SUM(CASE WHEN b.qty>0 AND b.qty<999 THEN b.qty ELSE 0 END),1) q
FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id
GROUP BY w.id HAVING q>0 ORDER BY q DESC
"""
):
    print(f"  {r['name']} ({r['code']}): {r['q']}")

print("\nпо source_department:")
for r in db.execute(
    """
SELECT IFNULL(p.source_department,'?') sd, COUNT(*) n
FROM stock_balances b LEFT JOIN products p ON p.id=b.product_id
WHERE abs(b.qty)>0.001 GROUP BY 1
"""
):
    print(f"  {r['sd']}: {r['n']} строк")
