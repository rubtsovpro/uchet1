#!/usr/bin/env python3
"""Dump product service-prices + company-scoped stock for Google Sheet export."""
import json
import re
import sqlite3
import sys

dbpath = sys.argv[1] if len(sys.argv) > 1 else "/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite"
c = sqlite3.connect(dbpath)
c.row_factory = sqlite3.Row

SERVICE_PRICE_RE = re.compile(
    r"(снят|установ|монтаж|ремонт|замен|работ|услуг|калибр|диагност)",
    re.I,
)
SKIP_AS_SERVICE = {
    "розничная цена",
    "розничная партнерская",
    "опт1",
    "опт2",
    "цена маркетплейс",
    "цена без акции",
    "цена закупки",
    "стоимость деталей",
    "стоимость расходников",
    "мин",
    "макс",
    "rub",
}

# Остатки только своего юрлица.
COMPANY_BY_DEPT = {
    "pnevmopodveska_2025": "00000000-0000-4000-8000-000000000001",  # PNEVMO
    "fogel_2025": "54291ec9-dbf9-465d-a025-ad0c6274e6dd",  # ФОГЕЛЬ
}
WH_COLS_BY_DEPT = {
    "pnevmopodveska_2025": [
        ("НФ-000032", "Остаток · Основной"),
        ("STO-RES-MSK", "Остаток · Отложено под СТО"),
    ],
    "fogel_2025": [
        ("НФ-000041", "Остаток · Фадеева Склад"),
        ("НФ-000042", "Остаток · Фадеева Отправки"),
        ("НФ-000045", "Остаток · Стрела Склад"),
    ],
}


def clean_sku(sku: str) -> str:
    s = (sku or "").strip()
    s = re.sub(r"@(podveska|fogel|strela)$", "", s, flags=re.I)
    s = re.sub(r":[0-9a-f]{8}$", "", s, flags=re.I)
    return s


def is_service_price_type(name: str) -> bool:
    n = (name or "").strip()
    if not n:
        return False
    low = n.lower()
    if low in SKIP_AS_SERVICE:
        return False
    if SERVICE_PRICE_RE.search(n):
        return True
    if low.startswith("цена снятие") or "снятие/установ" in low:
        return True
    return False


def type_key(t: str):
    low = t.lower()
    if "снят" in low or "установ" in low:
        return (0, t)
    if "монтаж" in low:
        return (1, t)
    if "ремонт" in low:
        return (2, t)
    return (9, t)


out = {"departments": {}}
for dept, label in [("pnevmopodveska_2025", "Подвеска"), ("fogel_2025", "Фогель")]:
    company_id = COMPANY_BY_DEPT[dept]
    wh_cols = WH_COLS_BY_DEPT[dept]
    wh_codes = [code for code, _ in wh_cols]
    # bare GUID остатки принадлежат Подвеске — Фогелю не подмешивать
    allow_bare_stock = dept != "fogel_2025"

    type_rows = c.execute(
        """
        SELECT pp.price_type AS t, COUNT(*) AS n
        FROM product_prices pp
        JOIN products p ON p.id = pp.product_id
        WHERE IFNULL(p.item_kind,'product') != 'service'
          AND IFNULL(p.is_active,1)=1
          AND IFNULL(p.source_department,'') = ?
          AND IFNULL(pp.price,0) > 0
        GROUP BY pp.price_type
        ORDER BY n DESC
        """,
        (dept,),
    ).fetchall()
    service_types = sorted(
        {r["t"] for r in type_rows if is_service_price_type(r["t"])},
        key=type_key,
    )

    placeholders = ",".join("?" for _ in service_types) if service_types else "''"
    sql = f"""
        SELECT p.id, p.sku, p.code, p.name, IFNULL(p.brand,'') AS brand,
               IFNULL(cat.name,'') AS category,
               IFNULL(p.install_price,0) AS install_price
        FROM products p
        LEFT JOIN categories cat ON cat.id = p.category_id
        WHERE IFNULL(p.item_kind,'product') != 'service'
          AND IFNULL(p.is_active,1)=1
          AND IFNULL(p.source_department,'') = ?
          AND (
            IFNULL(p.install_price,0) > 0
            {"OR EXISTS (SELECT 1 FROM product_prices pp WHERE pp.product_id=p.id AND pp.price>0 AND pp.price_type IN (" + placeholders + "))" if service_types else ""}
          )
        ORDER BY p.sku COLLATE NOCASE
    """
    products = c.execute(sql, [dept] + service_types).fetchall()
    ids = [r["id"] for r in products]
    bare_of = {}
    for pid in ids:
        bare_of[pid] = pid.split("::", 1)[-1] if "::" in pid else pid

    price_map = {}
    price_ids = list(dict.fromkeys([*ids, *[bare_of[i] for i in ids], *[f"{dept}::{bare_of[i]}" for i in ids]]))
    for i in range(0, len(price_ids), 800):
        chunk = price_ids[i : i + 800]
        ph = ",".join("?" for _ in chunk)
        for pr in c.execute(
            f"SELECT product_id, price_type, price FROM product_prices WHERE product_id IN ({ph}) AND price>0",
            chunk,
        ):
            price_map.setdefault(pr["product_id"], {})[pr["price_type"]] = float(pr["price"])

    stock_ids = list(ids)
    if allow_bare_stock:
        stock_ids.extend(bare_of[i] for i in ids)
    stock_ids = list(dict.fromkeys(stock_ids))
    bal_by_pid = {}
    for i in range(0, len(stock_ids), 800):
        chunk = stock_ids[i : i + 800]
        ph = ",".join("?" for _ in chunk)
        for br in c.execute(
            f"""
            SELECT sb.product_id, w.code AS wh_code, sb.qty
            FROM stock_balances sb
            JOIN warehouses w ON w.id = sb.warehouse_id
            WHERE sb.product_id IN ({ph})
              AND abs(IFNULL(sb.qty,0)) > 0.0001
              AND IFNULL(w.company_id,'') = ?
            """,
            [*chunk, company_id],
        ):
            bal_by_pid.setdefault(br["product_id"], {})
            code = br["wh_code"] or ""
            bal_by_pid[br["product_id"]][code] = bal_by_pid[br["product_id"]].get(code, 0.0) + float(
                br["qty"] or 0
            )

    rows_by_bare = {}
    for p in products:
        pid = p["id"]
        bare = bare_of[pid]
        price_keys = {pid, bare, f"{dept}::{bare}"}
        prices = {}
        for key in price_keys:
            for pt, prc in (price_map.get(key) or {}).items():
                if float(prc or 0) > 0:
                    prices[pt] = float(prc)
        stock_keys = {pid, f"{dept}::{bare}"}
        if allow_bare_stock:
            stock_keys.add(bare)
        merged_wh = {}
        for key in stock_keys:
            for wh, q in (bal_by_pid.get(key) or {}).items():
                merged_wh[wh] = max(float(merged_wh.get(wh) or 0), float(q))
        qty_by_wh = {code: float(merged_wh.get(code) or 0) for code in wh_codes}
        qty_total = sum(merged_wh.values())
        cand = {
            "prefer_alias": 1 if "::" in pid else 0,
            "sku": clean_sku(p["sku"]),
            "code": (p["code"] or "").strip(),
            "name": (p["name"] or "").strip(),
            "brand": (p["brand"] or "").strip(),
            "category": (p["category"] or "").strip(),
            "qty_total": qty_total,
            "qty_by_wh": qty_by_wh,
            "retail": float(prices.get("Розничная цена") or 0),
            "install_price": float(p["install_price"] or 0),
            "service_prices": {t: float(prices.get(t) or 0) for t in service_types},
        }
        prev = rows_by_bare.get(bare)
        if prev is None:
            rows_by_bare[bare] = cand
            continue
        keep, other = (cand, prev) if cand["prefer_alias"] >= prev["prefer_alias"] else (prev, cand)
        merged_svc = dict(other["service_prices"])
        for t, v in keep["service_prices"].items():
            if float(v or 0) > 0:
                merged_svc[t] = float(v)
        merged_wh_qty = dict(other["qty_by_wh"])
        for code, v in keep["qty_by_wh"].items():
            merged_wh_qty[code] = max(float(merged_wh_qty.get(code) or 0), float(v or 0))
        rows_by_bare[bare] = {
            "prefer_alias": max(keep["prefer_alias"], other["prefer_alias"]),
            "sku": keep["sku"] or other["sku"],
            "code": keep["code"] or other["code"],
            "name": keep["name"] or other["name"],
            "brand": keep["brand"] or other["brand"],
            "category": keep["category"] or other["category"],
            "qty_total": max(float(keep["qty_total"]), float(other["qty_total"])),
            "qty_by_wh": merged_wh_qty,
            "retail": max(float(keep["retail"]), float(other["retail"])),
            "install_price": max(float(keep["install_price"]), float(other["install_price"])),
            "service_prices": merged_svc,
        }

    rows = []
    for r in rows_by_bare.values():
        if float(r["install_price"] or 0) <= 0 and not any(
            float(v or 0) > 0 for v in r["service_prices"].values()
        ):
            continue
        rows.append(r)
    rows.sort(key=lambda x: (x["sku"] or "").lower())

    out["departments"][dept] = {
        "label": label,
        "service_types": service_types,
        "wh_cols": [{"code": code, "label": lab} for code, lab in wh_cols],
        "count": len(rows),
        "rows": rows,
    }

print(json.dumps(out, ensure_ascii=False))
