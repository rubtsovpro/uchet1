#!/usr/bin/env python3
from pathlib import Path
import re

p = Path("/root/1c_pnevmopodveska1_ru/warehouse/api/dist/hs.js")
text = p.read_text()
pat = re.compile(r"export async function syncRestsOnly\(\) \{.*?\n\}", re.S)
m = pat.search(text)
if not m:
    raise SystemExit("fn not found")

new = """export async function syncRestsOnly() {
    assertHsConfigured();
    const t0 = Date.now();
    const profile = HS_SYNC_PODVESKA;
    const base = profile.baseUrl || defaultHsBase();
    // Только склады Get/Stores базы pnevmopodveska_2025
    const { storeIds } = await syncCategoriesAndStores(base);
    const catIds = await fetchHsCategoryIds(base);
    if (!storeIds.length) {
        throw new Error("HS Get/Stores пусто для pnevmopodveska_2025 — остатки не загружены");
    }
    const r = await syncRestsInternal(catIds, profile, storeIds);
    // Чужие остатки (Фогель и т.п.) — убрать: в Учёте сейчас только Подвеска
    run(`DELETE FROM product_store_rests
         WHERE product_id IN (
           SELECT id FROM products
           WHERE IFNULL(source_department,'') != ?
             AND IFNULL(source_department,'') != ''
         )`, [profile.sourceDepartment]);
    run(`DELETE FROM stock_balances
         WHERE product_id IN (
           SELECT id FROM products
           WHERE IFNULL(source_department,'') != ?
             AND IFNULL(source_department,'') != ''
         )`, [profile.sourceDepartment]);
    run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [
        "rests_synced_at",
        new Date().toISOString(),
    ]);
    run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [
        "rests_source_department",
        profile.sourceDepartment,
    ]);
    return {
        warehouses: r.warehouses,
        restRows: r.rows,
        categories: catIds.length,
        seconds: Math.round((Date.now() - t0) / 1000),
        source: profile.sourceDepartment,
        baseUrl: base,
        storeIds: storeIds.length,
    };
}"""

p.write_text(text[: m.start()] + new + text[m.end() :])
print("patched ok")
