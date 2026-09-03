#!/usr/bin/env python3
"""Patch warehouse UI junk filters + HS unused stores on bank-vps paths."""
from pathlib import Path
import re
import shutil
import subprocess

WH = Path("/root/1c_pnevmopodveska1_ru/warehouse")
TMP = Path("/tmp/uchet-wh")

# UI
shutil.copy2(TMP / "legacy.js", WH / "web/public/legacy.js")
shutil.copy2(TMP / "legacy.html", WH / "web/public/legacy.html")
shutil.copy2(TMP / "pick.html", WH / "web/public/pick.html")
shutil.copy2(TMP / "legacy.js", WH / "web/dist/legacy.js")
shutil.copy2(TMP / "legacy.html", WH / "web/dist/legacy.html")

# sources
shutil.copy2(TMP / "hs.ts", WH / "api/src/hs.ts")
shutil.copy2(TMP / "docs-sync.ts", WH / "api/src/docs-sync.ts")
shutil.copy2(TMP / "supply-chain.ts", WH / "api/src/supply-chain.ts")

# --- hs.js ---
hs = WH / "api/dist/hs.js"
t = hs.read_text()
if "НФ-000035" not in t or "unusedTech" not in t:
    # Find upsertHsStore and inject unusedTech before clash lookup
    m = re.search(
        r"(function upsertHsStore\([\s\S]*?)"
        r"(const clash = get\(`SELECT id FROM warehouses WHERE code = \? AND id != \?`",
        t,
    )
    if not m:
        raise SystemExit("hs.js: upsertHsStore clash not found")
    inject = m.group(1) + """const unusedTech = code === "НФ-000033" ||
        code === "НФ-000035" ||
        code === "НФ-000036" ||
        /доукомплект/i.test(name) ||
        /недопоставк/i.test(name) ||
        /не\\s*найден/i.test(name);
    if (unusedTech) {
        const exists = get(`SELECT id FROM warehouses WHERE id = ?`, [id]);
        if (!exists)
            return;
        run(`UPDATE warehouses SET is_active = 0, name = ? WHERE id = ?`, [name, id]);
        return;
    }
    """ + m.group(2)
    t = t[: m.start()] + inject + t[m.end() :]
    # Also map NF-000032 name if missing
    if 'name = "Основной"' not in t and "НФ-000032" in t:
        t = t.replace(
            "let name = String(row.name || row.code || id).trim() || id;",
            'let name = String(row.name || row.code || id).trim() || id;\n'
            '    if (code === "НФ-000032" || /^филиал\\s*москва$/i.test(name))\n'
            '        name = "Основной";',
            1,
        )
    hs.write_text(t)
    print("hs.js patched")
else:
    print("hs.js already has unusedTech")

# Fix code order: name rename needs code first — check if broken
t = hs.read_text()
if 'if (code === "НФ-000032"' in t:
    # ensure code is declared before that if
    idx = t.find('if (code === "НФ-000032"')
    window = t[max(0, idx - 300) : idx]
    if "const code =" not in window and "let code =" not in window:
        print("WARNING: NF-000032 rename may be before code decl")

# --- docs-sync.js ---
ds = WH / "api/dist/docs-sync.js"
t = ds.read_text()
t2 = t.replace(
    "INSERT OR IGNORE INTO warehouses (id, name, code, is_active) VALUES (?, 'Склад не указан (1С)', '1C-NONE', 1)",
    "INSERT OR IGNORE INTO warehouses (id, name, code, is_active) VALUES (?, 'Склад не указан (1С)', '1C-NONE', 0)",
)
if "SET is_active = 0 WHERE id = ? AND code = '1C-NONE'" not in t2:
    old = """        if (!get(`SELECT id FROM warehouses WHERE id = ?`, [fallback])) {
            run(`INSERT OR IGNORE INTO warehouses (id, name, code, is_active) VALUES (?, 'Склад не указан (1С)', '1C-NONE', 0)`, [fallback]);
        }
        return fallback;"""
    new = """        if (!get(`SELECT id FROM warehouses WHERE id = ?`, [fallback])) {
            run(`INSERT OR IGNORE INTO warehouses (id, name, code, is_active) VALUES (?, 'Склад не указан (1С)', '1C-NONE', 0)`, [fallback]);
        }
        else {
            run(`UPDATE warehouses SET is_active = 0 WHERE id = ? AND code = '1C-NONE'`, [fallback]);
        }
        return fallback;"""
    if old in t2:
        t2 = t2.replace(old, new, 1)
        print("docs-sync deactivate branch added")
    else:
        print("docs-sync structure differs; insert flag only")
        idx = t2.find("1C-NONE")
        print(repr(t2[idx - 180 : idx + 220]) if idx >= 0 else "no 1C-NONE")
ds.write_text(t2)
print("docs-sync updated")

# --- supply-chain.js ---
sc = WH / "api/dist/supply-chain.js"
t = sc.read_text()
if "/^STO-RES-/i.test(c)" not in t:
    old = "    if (existing?.id)\n        return existing.id;"
    new = """    if (existing?.id) {
        if (/^STO-RES-/i.test(c)) {
            run(`UPDATE warehouses SET is_active = 1, name = ?, updated_at = datetime('now') WHERE id = ?`, [n, existing.id]);
        }
        return existing.id;
    }"""
    if old not in t:
        old = "    if (existing?.id) return existing.id;"
        new = (
            "    if (existing?.id) {\n"
            "        if (/^STO-RES-/i.test(c)) {\n"
            "            run(`UPDATE warehouses SET is_active = 1, name = ?, updated_at = datetime('now') WHERE id = ?`, [n, existing.id]);\n"
            "        }\n"
            "        return existing.id;\n"
            "    }"
        )
    if old not in t:
        raise SystemExit("supply-chain ensureWarehouseByCode pattern not found")
    sc.write_text(t.replace(old, new, 1))
    print("supply-chain patched")
else:
    print("supply-chain already patched")

# verify UI
leg = (WH / "web/dist/legacy.js").read_text()
assert "whIsEmptyJunk" in leg
assert "STO-RES-STRELA" in leg
assert "CHATS_UI_ENABLED = false" in leg
assert "1087" in (WH / "web/dist/legacy.html").read_text()
print("UI ok")

subprocess.check_call(["systemctl", "restart", "warehouse-wms"])
print("restarted", subprocess.check_output(["systemctl", "is-active", "warehouse-wms"], text=True).strip())
