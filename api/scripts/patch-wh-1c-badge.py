#!/usr/bin/env python3
"""Patch dist/api.js warehouses list + save hs_podveska_store_ids + patch syncRestsOnly meta key."""
from pathlib import Path
import re
import sqlite3
import json

# 1) Save store ids from known Get/Stores list
STORE_IDS = [
    "4b11f9c5-1c34-11f0-b04b-0050569b6f2b",  # Недопоставка
    "02ae955b-5014-11f0-b04b-0050569b6f2b",  # Не найден
    "1ac1e210-0e29-11f0-b04b-0050569b6f2b",  # Ждёт доукомплектации
    "0c01ae2e-743b-11f0-b04b-0050569b6f2b",  # Брак
    "ad7fbd0a-0390-11e9-1a87-fa163e521143",  # СТО Москва
    "c1daca43-1b63-11f0-b04b-0050569b6f2b",  # б/у ЗПЧ
    "b7142cc4-2b3a-11ec-80bf-00155d3d52d2",  # ФИЛИАЛ МОСКВА
]
db = sqlite3.connect("/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite")
db.execute(
    "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
    ("hs_podveska_store_ids", json.dumps(STORE_IDS, ensure_ascii=False)),
)
db.commit()
print("meta saved", len(STORE_IDS))
for r in db.execute(
    f"SELECT code, name FROM warehouses WHERE id IN ({','.join('?'*len(STORE_IDS))}) ORDER BY name",
    STORE_IDS,
):
    print(" ", r[0], r[1])
db.close()

# 2) Patch api.js warehouses handler
api = Path("/root/1c_pnevmopodveska1_ru/warehouse/api/dist/api.js")
text = api.read_text()
old = """    let rows = all(`SELECT * FROM warehouses WHERE ${where} ORDER BY is_active DESC, name`, params);
    rows = rows.map((w) => {
        const id = String(w.id);
        const links = warehouseLinkInfo(id);
        return {
            ...w,
            has_links: links.linked,
            can_delete: !links.linked,
            link_counts: links.counts,
        };
    });
    if (!withTotals)
        return c.json(rows);"""
new = """    let rows = all(`SELECT * FROM warehouses WHERE ${where} ORDER BY is_active DESC, name`, params);
    let hsPodveskaIds = new Set();
    try {
        const raw = get(`SELECT value FROM meta WHERE key = 'hs_podveska_store_ids'`)?.value;
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
            hsPodveskaIds = new Set(parsed.map((x) => String(x || '').trim()).filter(Boolean));
        }
    }
    catch {
        hsPodveskaIds = new Set();
    }
    rows = rows.map((w) => {
        const id = String(w.id);
        const links = warehouseLinkInfo(id);
        const from1c = hsPodveskaIds.has(id);
        return {
            ...w,
            has_links: links.linked,
            can_delete: !links.linked,
            link_counts: links.counts,
            from_1c_podveska: from1c,
            hs_source: from1c ? 'pnevmopodveska_2025' : '',
        };
    });
    rows.sort((a, b) => {
        const aa = a.from_1c_podveska ? 0 : 1;
        const bb = b.from_1c_podveska ? 0 : 1;
        if (aa !== bb)
            return aa - bb;
        return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
    });
    if (!withTotals)
        return c.json(rows);"""
if old not in text:
    raise SystemExit("api.js warehouses block not found")
api.write_text(text.replace(old, new, 1))
print("api.js patched")

# 3) Ensure syncRestsOnly writes hs_podveska_store_ids
hs = Path("/root/1c_pnevmopodveska1_ru/warehouse/api/dist/hs.js")
hst = hs.read_text()
if "hs_podveska_store_ids" not in hst:
    hst = hst.replace(
        'run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [\n        "rests_source_department",\n        profile.sourceDepartment,\n    ]);',
        'run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [\n        "rests_source_department",\n        profile.sourceDepartment,\n    ]);\n    run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [\n        "hs_podveska_store_ids",\n        JSON.stringify(storeIds),\n    ]);',
        1,
    )
    hs.write_text(hst)
    print("hs.js meta key added")
else:
    print("hs.js already has meta key")
