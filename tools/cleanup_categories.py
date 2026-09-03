#!/usr/bin/env python3
"""One-shot: fix services, assign uncategorized products, prune empty categories."""
from __future__ import annotations

import re
import sqlite3
import sys
import uuid
from collections import defaultdict
from pathlib import Path

DB = Path(sys.argv[1] if len(sys.argv) > 1 else "data/warehouse.sqlite")


def new_id() -> str:
    return uuid.uuid4().hex[:22] if False else str(uuid.uuid4())


def main() -> None:
    c = sqlite3.connect(str(DB))
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = OFF")

    def cat_id(name: str, create: bool = False, parent_id: str | None = None) -> str | None:
        rows = c.execute(
            """
            SELECT c.id,
                   (SELECT COUNT(*) FROM products p
                    WHERE p.category_id = c.id AND IFNULL(p.is_active,1)=1) AS n
            FROM categories c WHERE c.name = ?
            ORDER BY n DESC
            """,
            (name,),
        ).fetchall()
        if rows:
            return rows[0]["id"]
        if not create:
            return None
        cid = new_id()
        c.execute(
            "INSERT INTO categories (id, name, parent_id) VALUES (?, ?, ?)",
            (cid, name, parent_id),
        )
        print(f"  created category {name!r} -> {cid}")
        return cid

    uslugi = cat_id("Услуги")
    assert uslugi, "Услуги category missing"

    # --- Step 1: s/u style services still as products ---
    print("=== Step 1: services ===")
    svc_re = re.compile(
        r"(с/у|снять\s*/\s*поставить|снять\s*//\s*установить|снять/установить)",
        re.I,
    )
    svc_rows = c.execute(
        """
        SELECT id, sku, name FROM products
        WHERE IFNULL(is_active,1)=1 AND IFNULL(item_kind,'product')='product'
        """
    ).fetchall()
    n_svc = 0
    for r in svc_rows:
        if svc_re.search(r["name"] or ""):
            c.execute(
                "UPDATE products SET item_kind='service', category_id=? WHERE id=?",
                (uslugi, r["id"]),
            )
            print(f"  service: {r['sku']} | {r['name']}")
            n_svc += 1
    c.execute(
        "UPDATE products SET category_id=? WHERE IFNULL(item_kind,'product')='service' AND IFNULL(category_id,'')!=?",
        (uslugi, uslugi),
    )
    print(f"  converted {n_svc}")

    # --- Step 2: ensure target categories ---
    print("=== Step 2: ensure categories ===")
    targets = {
        "Амортизаторы": cat_id("Амортизаторы"),
        "Пневмобаллоны": cat_id("Пневмобаллоны"),
        "Пневмостойки": cat_id("Пневмостойки"),
        "Компрессоры пневмоподвески": cat_id("Компрессоры пневмоподвески"),
        "Блоки клапанов": cat_id("Блоки клапанов"),
        "Рулевые рейки": cat_id("Рулевые рейки"),
        "Кольца резиновые": cat_id("Кольца резиновые"),
        "Датчики положения кузова": cat_id("Датчики положения кузова", create=True),
        "Комплектующие к рулевым рейкам": cat_id("Комплектующие к рулевым рейкам", create=True),
        "Комплектующие к амортизаторам": cat_id("Комплектующие к амортизаторам"),
        "Комплектующие к пневмобаллонам": cat_id("Комплектующие к пневмобаллонам"),
        "Пыльники пневмобаллона": cat_id("Пыльники пневмобаллона"),
        "Сайлентблоки пневмобаллона": cat_id("Сайлентблоки пневмобаллона"),
        "Ремкомплекты пневмобаллона": cat_id("Ремкомплекты пневмобаллона"),
        "Клапана пневмобаллона": cat_id("Клапана пневмобаллона"),
        "Масла и смазки": cat_id("Масла и смазки"),
        "Хомуты пластиковые": cat_id("Хомуты пластиковые"),
        "Инструмент": cat_id("Инструмент", create=True),
        "Офисная техника": cat_id("Офисная техника"),
        "Электронные Компоненты (Реле,Проводка)": cat_id(
            "Электронные Компоненты (Реле,Проводка)"
        ),
        "СТО": cat_id("СТО"),
        "Крепёж": cat_id("Крепёж", create=True),
        "Тормозная система": cat_id("Тормозная система", create=True),
        "Прочее": cat_id("Прочее", create=True),
        "Услуги": uslugi,
    }
    for k, v in targets.items():
        if not v:
            print(f"  WARN missing {k}")

    # --- Step 3: assign uncategorized ---
    print("=== Step 3: assign uncategorized ===")
    uncat = c.execute(
        """
        SELECT id, sku, name, IFNULL(brand,'') brand, IFNULL(item_kind,'product') kind
        FROM products
        WHERE IFNULL(is_active,1)=1
          AND (category_id IS NULL OR TRIM(IFNULL(category_id,''))='')
        """
    ).fetchall()
    print(f"  uncategorized before: {len(uncat)}")

    def pick(name: str, brand: str, kind: str) -> str:
        if kind == "service":
            return targets["Услуги"]
        n = f"{name} {brand}".lower().replace("ё", "е")

        # steering rack assembly
        if re.search(r"рулев\w*\s+рейк", n) or re.search(r"^рулевая рейка", n):
            if re.search(r"пыльник|наконечник|тяг[аи]|сальник|втулк", n) and not re.search(
                r"^рулевая рейка", n
            ):
                return targets["Комплектующие к рулевым рейкам"]
            return targets["Рулевые рейки"]
        if re.search(r"пыльник\s+рулев|наконечник\s+рулев|тяг[аи].*рулев|рулев\w*\s+тяг", n):
            return targets["Комплектующие к рулевым рейкам"]
        if "наконечник рулевой" in n or "наконечник рулев" in n:
            return targets["Комплектующие к рулевым рейкам"]

        # amort parts vs amort
        if re.search(r"пыльник|опора|сайлент|шаров", n) and "амортиз" in n:
            return targets["Комплектующие к амортизаторам"] or targets["Прочее"]
        if "амортиз" in n:
            return targets["Амортизаторы"]

        if "пневмостойк" in n or "пневмостойк" in n:
            return targets["Пневмостойки"]
        if "пневмобаллон" in n or "пневмобалон" in n:
            if re.search(r"пыльник", n):
                return targets["Пыльники пневмобаллона"] or targets["Комплектующие к пневмобаллонам"]
            if re.search(r"сайлент", n):
                return targets["Сайлентблоки пневмобаллона"] or targets[
                    "Комплектующие к пневмобаллонам"
                ]
            if re.search(r"ремкомплект", n):
                return targets["Ремкомплекты пневмобаллона"] or targets[
                    "Комплектующие к пневмобаллонам"
                ]
            if re.search(r"клапан", n):
                return targets["Клапана пневмобаллона"] or targets["Комплектующие к пневмобаллонам"]
            return targets["Пневмобаллоны"]

        if "компрессор" in n:
            return targets["Компрессоры пневмоподвески"]
        if "блок клапан" in n or "блоки клапан" in n:
            return targets["Блоки клапанов"]
        if re.search(r"кольц", n) and re.search(r"резин|уплотн|o-ring|oring", n):
            return targets["Кольца резиновые"]
        if re.search(r"\bкольц", n) and "рулев" not in n:
            return targets["Кольца резиновые"]

        if "датчик" in n:
            return targets["Датчики положения кузова"]

        if re.search(
            r"масло|жидкость гур|жидкость гидравл|антифриз|смазк|жидкий ключ|гур\b|psf|atf|dexron",
            n,
        ):
            return targets["Масла и смазки"] or targets["Прочее"]

        if "хомут" in n:
            return targets["Хомуты пластиковые"] or targets["Прочее"]

        if "ремкомплект" in n:
            return targets["Ремкомплекты пневмобаллона"] or targets["Прочее"]
        if re.search(r"пыльник", n) and "рулев" not in n:
            return targets["Пыльники пневмобаллона"] or targets["Прочее"]
        if "сайлент" in n:
            return targets["Сайлентблоки пневмобаллона"] or targets["Прочее"]

        if re.search(r"\bболт|\bгайк|втулка стабилизатор|втулки.*стабилизатор|экцентрик", n):
            return targets["Крепёж"]
        if re.search(r"тормозн|колодк", n):
            return targets["Тормозная система"]

        if re.search(r"\bключ\b|головка|трещот|инструмент", n):
            return targets["Инструмент"] or targets["Прочее"]

        if re.search(r"лент|упаков|полиграф|гарантий", n):
            return targets["Офисная техника"] or targets["Прочее"]

        if re.search(r"реле|проводк|электрон", n):
            return (
                targets["Электронные Компоненты (Реле,Проводка)"] or targets["Прочее"]
            )

        return targets["Прочее"]

    by_cat: dict[str, int] = defaultdict(int)
    for r in uncat:
        cid = pick(r["name"] or "", r["brand"] or "", r["kind"] or "product")
        c.execute("UPDATE products SET category_id=? WHERE id=?", (cid, r["id"]))
        # resolve name for stats
        nm = next((k for k, v in targets.items() if v == cid), cid)
        by_cat[nm] += 1

    print("  assigned:")
    for k, v in sorted(by_cat.items(), key=lambda x: -x[1]):
        print(f"    {v:4d} -> {k}")

    left = c.execute(
        """
        SELECT COUNT(*) AS n FROM products
        WHERE IFNULL(is_active,1)=1
          AND (category_id IS NULL OR TRIM(IFNULL(category_id,''))='')
        """
    ).fetchone()["n"]
    print(f"  uncategorized after: {left}")

    # merge products on empty duplicate category GUIDs onto canonical (same name, most products)
    print("=== Step 3b: merge dup category GUIDs ===")
    names = c.execute("SELECT name, COUNT(*) AS n FROM categories GROUP BY name HAVING n>1").fetchall()
    merged = 0
    for row in names:
        name = row["name"]
        variants = c.execute(
            """
            SELECT c.id,
                   (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id) AS n
            FROM categories c WHERE c.name=?
            ORDER BY n DESC
            """,
            (name,),
        ).fetchall()
        canon = variants[0]["id"]
        for v in variants[1:]:
            if v["n"] > 0:
                c.execute(
                    "UPDATE products SET category_id=? WHERE category_id=?",
                    (canon, v["id"]),
                )
                merged += v["n"]
            # reparent children
            c.execute(
                "UPDATE categories SET parent_id=? WHERE parent_id=?",
                (canon, v["id"]),
            )
    print(f"  products remapped from dup GUIDs: {merged}")

    # --- Step 4: delete empty categories (no products, no children) ---
    print("=== Step 4: delete empty categories ===")
    deleted = 0
    # iterate until stable (children may become deletable)
    while True:
        empties = c.execute(
            """
            SELECT c.id, c.name FROM categories c
            WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id=c.id)
              AND NOT EXISTS (SELECT 1 FROM categories ch WHERE ch.parent_id=c.id)
            """
        ).fetchall()
        if not empties:
            break
        for e in empties:
            c.execute("DELETE FROM categories WHERE id=?", (e["id"],))
            deleted += 1
        if deleted > 5000:
            break
    print(f"  deleted {deleted} empty categories")

    c.commit()

    # --- verify ---
    print("=== Verify ===")
    uncat_n = c.execute(
        """
        SELECT COUNT(*) AS n FROM products
        WHERE IFNULL(is_active,1)=1
          AND (category_id IS NULL OR TRIM(IFNULL(category_id,''))='')
        """
    ).fetchone()["n"]
    svc_n = c.execute(
        "SELECT COUNT(*) AS n FROM products WHERE item_kind='service' AND IFNULL(is_active,1)=1"
    ).fetchone()["n"]
    svc_ok = c.execute(
        """
        SELECT COUNT(*) AS n FROM products p
        JOIN categories c ON c.id=p.category_id
        WHERE p.item_kind='service' AND IFNULL(p.is_active,1)=1 AND c.name='Услуги'
        """
    ).fetchone()["n"]
    cats_n = c.execute("SELECT COUNT(*) AS n FROM categories").fetchone()["n"]
    print(f"  uncategorized active: {uncat_n}")
    print(f"  services: {svc_n}, in Услуги: {svc_ok}")
    print(f"  categories left: {cats_n}")
    print("  remaining categories:")
    for r in c.execute(
        """
        SELECT c.name,
               COUNT(p.id) AS n,
               (SELECT name FROM categories x WHERE x.id=c.parent_id) AS parent
        FROM categories c
        LEFT JOIN products p ON p.category_id=c.id AND IFNULL(p.is_active,1)=1
        GROUP BY c.id
        ORDER BY n DESC, c.name
        """
    ):
        print(f"    {r['n']:4d} | {r['parent'] or 'ROOT'} > {r['name']}")

    c.close()
    if uncat_n != 0 or svc_n != svc_ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
