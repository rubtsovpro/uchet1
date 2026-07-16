#!/usr/bin/env python3
"""Список номенклатуры, у которой в 1С пустое Description (раньше в name был GUID)."""
import re
import sqlite3
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else "data/warehouse.sqlite"
uuid_re = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I
)

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

still = [
    dict(r)
    for r in db.execute(
        "SELECT sku, name, id AS guid, barcode, is_active FROM products "
        "WHERE length(name)=36 AND name GLOB '*-*-*-*-*'"
    )
]

# После фикса name := sku для GUID-имён
fixed_like = [
    dict(r)
    for r in db.execute(
        "SELECT sku, name, id AS guid, barcode, is_active FROM products "
        "WHERE name = sku AND (sku LIKE 'НФ-%' OR sku LIKE '00-%') "
        "ORDER BY sku"
    )
]

# Оставим только те, где name выглядит как код УНФ (короткий), не длинное название
rows = []
seen = set()
for r in still + fixed_like:
    g = r["guid"]
    if g in seen:
        continue
    seen.add(g)
    # отсечь случайные name=sku если название длинное осмысленное — у УНФ обычно НФ-########
    sku = str(r["sku"] or "")
    if uuid_re.match(str(r["name"] or "")) or re.match(r"^(НФ|00)-\d+", sku, re.I):
        rows.append(r)

rows.sort(key=lambda x: str(x["sku"] or ""))

print(f"Всего позиций с пустым названием в 1С (подставлен код УНФ / был GUID): {len(rows)}\n")
print(f"{'№':>3}  {'Код УНФ':<16}  {'Артикул':<32}  GUID")
print("-" * 110)
for i, r in enumerate(rows, 1):
    art = (r["barcode"] or "—")[:32]
    print(f"{i:>3}  {str(r['sku']):<16}  {art:<32}  {r['guid']}")

csv_path = DB.replace("warehouse.sqlite", "empty_name_nf_list.csv")
if csv_path == DB:
    csv_path = "empty_name_nf_list.csv"
with open(csv_path, "w", encoding="utf-8") as f:
    f.write("n;sku;name_now;guid;article_or_barcode;is_active\n")
    for i, r in enumerate(rows, 1):
        f.write(
            f"{i};{r['sku']};{r['name']};{r['guid']};{(r['barcode'] or '').replace(';', ',')};{r['is_active']}\n"
        )
print(f"\nCSV: {csv_path}")
