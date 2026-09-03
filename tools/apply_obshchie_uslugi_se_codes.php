<?php
/**
 * Лист «Общие услуги» (gid 1904236742):
 * 1) проставить Код 1С = se-0001..
 * 2) сохранить старый код в колонку «Старый код»
 * 3) выгрузить JSON для применения в WMS
 *
 *   php tools/apply_obshchie_uslugi_se_codes.php           # sheet + dump
 *   php tools/apply_obshchie_uslugi_se_codes.php --apply-wms
 */
declare(strict_types=1);

$cred = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$auto = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
if (!is_file($cred) || !is_file($auto)) {
    fwrite(STDERR, "Нет Google SA credentials\n");
    exit(1);
}
require $auto;

$spreadsheetId = getenv('SHEET_ID') ?: '1eW2wcijS59Or5YMVrmzCCVOmIbc9HgDMeEEaCgf4hMw';
$sheetGid = (int) (getenv('SHEET_GID') ?: 1904236742);
$applyWms = in_array('--apply-wms', $argv, true);
$drySheet = in_array('--dry-run', $argv, true);

$client = new Google\Client();
$client->setApplicationName('Uchet1 obshchie uslugi se-codes');
$client->setAuthConfig($cred);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$title = null;
foreach ($ss->getSheets() as $sh) {
    $p = $sh->getProperties();
    if ((int) $p->getSheetId() === $sheetGid) {
        $title = (string) $p->getTitle();
        break;
    }
}
if ($title === null) {
    fwrite(STDERR, "Лист gid={$sheetGid} не найден\n");
    exit(1);
}
$quoted = "'" . str_replace("'", "''", $title) . "'";
$vals = $sheets->spreadsheets_values->get($spreadsheetId, "{$quoted}!A1:Z")->getValues() ?? [];
if (count($vals) < 2) {
    fwrite(STDERR, "Пустой лист\n");
    exit(1);
}

$header = $vals[0];
$headerLower = array_map(static fn ($c) => mb_strtolower(trim((string) $c), 'UTF-8'), $header);
$col = static function (array $h, array $aliases): int {
    foreach ($aliases as $a) {
        $a = mb_strtolower($a, 'UTF-8');
        foreach ($h as $i => $cell) {
            if ($cell === $a) {
                return (int) $i;
            }
        }
    }
    return -1;
};

$iCode = $col($headerLower, ['код 1с', 'код']);
$iName = $col($headerLower, ['наименование', 'название', 'name']);
$iUnit = $col($headerLower, ['ед.', 'ед', 'единица']);
$iPrice = $col($headerLower, ['цена', 'price']);
$iOld = $col($headerLower, ['старый код', 'бывший код', 'old code']);

if ($iCode < 0 || $iName < 0 || $iPrice < 0) {
    fwrite(STDERR, 'Нет колонок: ' . json_encode($header, JSON_UNESCAPED_UNICODE) . "\n");
    exit(1);
}

if ($iOld < 0) {
    $iOld = count($header);
    $header[] = 'Старый код';
    $headerLower[] = 'старый код';
}

$money = static function (mixed $v): float {
    if ($v === null || $v === '') {
        return 0.0;
    }
    if (is_numeric($v)) {
        return max(0.0, (float) $v);
    }
    $s = preg_replace('/[^\d,.\-]/u', '', str_replace("\xc2\xa0", '', (string) $v)) ?? '';
    $s = str_replace(',', '.', $s);
    return ($s !== '' && is_numeric($s)) ? max(0.0, (float) $s) : 0.0;
};

$rowsOut = [];
$sheetWrite = [$header];
$n = 0;
for ($r = 1; $r < count($vals); $r++) {
    $row = $vals[$r];
    $name = trim((string) ($row[$iName] ?? ''));
    if ($name === '') {
        continue;
    }
    $prevCode = trim((string) ($row[$iCode] ?? ''));
    $existingOld = $iOld < count($row) ? trim((string) ($row[$iOld] ?? '')) : '';
    // Если уже se-XXXX — не трогаем ключ; старый код берём из колонки «Старый код».
    $isSe = (bool) preg_match('/^se-\d+$/i', $prevCode);
    $n++;
    $se = sprintf('se-%04d', $n);
    $oldCode = $existingOld !== '' ? $existingOld : ($isSe ? '' : $prevCode);
    $unit = $iUnit >= 0 ? trim((string) ($row[$iUnit] ?? 'Услуга')) : 'Услуга';
    if ($unit === '') {
        $unit = 'Услуга';
    }
    $price = $money($row[$iPrice] ?? 0);

    $newRow = $row;
    // pad
    $maxIdx = max($iCode, $iName, $iUnit, $iPrice, $iOld);
    while (count($newRow) <= $maxIdx) {
        $newRow[] = '';
    }
    $newRow[$iCode] = $se;
    $newRow[$iName] = $name;
    if ($iUnit >= 0) {
        $newRow[$iUnit] = $unit;
    }
    $newRow[$iPrice] = $row[$iPrice] ?? $price;
    $newRow[$iOld] = $oldCode;
    $sheetWrite[] = $newRow;

    $rowsOut[] = [
        'se' => $se,
        'old_code' => $oldCode,
        'name' => $name,
        'unit' => $unit,
        'price' => $price,
    ];
}

$payload = [
    'sheet' => $title,
    'gid' => $sheetGid,
    'spreadsheet_id' => $spreadsheetId,
    'count' => count($rowsOut),
    'rows' => $rowsOut,
];
$dumpPath = sys_get_temp_dir() . '/obshchie-uslugi-se.json';
file_put_contents($dumpPath, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
fwrite(STDERR, "dump {$dumpPath}: " . count($rowsOut) . " услуг\n");

if (!$drySheet) {
    $endCol = chr(ord('A') + max(count($header) - 1, 4));
    $range = "{$quoted}!A1:{$endCol}" . count($sheetWrite);
    $body = new Google\Service\Sheets\ValueRange(['values' => $sheetWrite]);
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        $range,
        $body,
        ['valueInputOption' => 'USER_ENTERED']
    );
    fwrite(STDERR, "sheet updated: {$title} ({$range})\n");
} else {
    fwrite(STDERR, "dry-run: sheet not written\n");
}

foreach ($rowsOut as $r) {
    printf("%s\t%s\t%s\t%s\n", $r['se'], $r['old_code'], $r['price'], $r['name']);
}

if (!$applyWms) {
    fwrite(STDERR, "OK. Для WMS: php tools/apply_obshchie_uslugi_se_codes.php --apply-wms\n");
    exit(0);
}

$remoteHost = getenv('WMS_DEPLOY_HOST') ?: 'bank-vps';
$remoteJson = '/tmp/obshchie-uslugi-se.json';
$remotePy = '/tmp/apply_obshchie_uslugi_se.py';

$py = <<<'PY'
#!/usr/bin/env python3
import json, sqlite3, uuid, shutil, time, sys

path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/obshchie-uslugi-se.json"
dbpath = sys.argv[2] if len(sys.argv) > 2 else "/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite"
data = json.load(open(path, encoding="utf-8"))
rows = data.get("rows") or []
if not rows:
    print(json.dumps({"ok": False, "error": "empty rows"}, ensure_ascii=False))
    sys.exit(2)

bak = dbpath + ".bak-obshchie-se-" + time.strftime("%Y%m%d-%H%M%S")
shutil.copy2(dbpath, bak)

c = sqlite3.connect(dbpath)
c.execute("PRAGMA busy_timeout=60000")
cols = {r[1] for r in c.execute("PRAGMA table_info(products)")}
for col, ddl in [
    ("price_min", "ALTER TABLE products ADD COLUMN price_min REAL NOT NULL DEFAULT 0"),
    ("price_max", "ALTER TABLE products ADD COLUMN price_max REAL NOT NULL DEFAULT 0"),
    ("install_price", "ALTER TABLE products ADD COLUMN install_price REAL NOT NULL DEFAULT 0"),
    ("source_department", "ALTER TABLE products ADD COLUMN source_department TEXT NOT NULL DEFAULT ''"),
]:
    if col not in cols:
        c.execute(ddl)

cat = c.execute("SELECT id FROM categories WHERE name='Услуги' LIMIT 1").fetchone()
cat_id = cat[0] if cat else None
if not cat_id:
    cat = c.execute("SELECT id FROM categories WHERE name LIKE '%слуг%' LIMIT 1").fetchone()
    cat_id = cat[0] if cat else None

unit = c.execute(
    "SELECT id FROM units WHERE lower(IFNULL(short_name,'')) IN ('усл','усл.','услуга') OR lower(IFNULL(name,'')) LIKE '%услуг%' LIMIT 1"
).fetchone()
if not unit:
    unit = c.execute("SELECT id FROM units WHERE short_name='шт' LIMIT 1").fetchone()
unit_id = unit[0] if unit else (c.execute("SELECT id FROM units LIMIT 1").fetchone() or [""])[0]

def upsert_price(pid, ptype, price):
    price = float(price or 0)
    row = c.execute(
        "SELECT id FROM product_prices WHERE product_id=? AND price_type=? LIMIT 1",
        (pid, ptype),
    ).fetchone()
    if row:
        c.execute("UPDATE product_prices SET price=? WHERE id=?", (price, row[0]))
    else:
        c.execute(
            "INSERT INTO product_prices (id, product_id, price_type, price) VALUES (?,?,?,?)",
            (f"{pid}|{ptype}", pid, ptype, price),
        )

keep_ids = set()
created = matched = 0
for r in rows:
    se = (r.get("se") or "").strip()
    old = (r.get("old_code") or "").strip()
    name = (r.get("name") or "").strip()
    price = float(r.get("price") or 0)
    if not se or not name:
        continue

    # Ключ синка — только se-XXXX (общие для Фогеля и Подвески, без department::).
    row = c.execute(
        """SELECT id FROM products
           WHERE (sku=? OR code=?) AND instr(id, '::') = 0
           LIMIT 1""",
        (se, se),
    ).fetchone()
    if not row:
        row = c.execute(
            "SELECT id FROM products WHERE sku=? OR code=? LIMIT 1",
            (se, se),
        ).fetchone()

    if row:
        pid = row[0]
        c.execute(
            """UPDATE products SET
                 name=?, sku=?, code=?, item_kind='service', is_active=1,
                 category_id=COALESCE(?, category_id), unit_id=COALESCE(?, unit_id),
                 price_min=?, price_max=?, source_department='',
                 warehouse_sku=CASE
                   WHEN IFNULL(warehouse_sku,'')='' AND ?!='' THEN ?
                   ELSE warehouse_sku
                 END
               WHERE id=?""",
            (name, se, se, cat_id, unit_id, price, price, old, old, pid),
        )
        matched += 1
    else:
        pid = str(uuid.uuid4())
        c.execute(
            """INSERT INTO products
               (id, sku, code, name, category_id, unit_id, barcode, item_kind, brand, is_active,
                price_min, price_max, source_department, warehouse_sku)
               VALUES (?,?,?,?,?,?,'','service','',1,?,?,?,?)""",
            (pid, se, se, name, cat_id, unit_id, price, price, "", old),
        )
        created += 1

    keep_ids.add(pid)
    if price > 0:
        upsert_price(pid, "Розничная цена", price)
        upsert_price(pid, "Мин", price)
        upsert_price(pid, "Макс", price)

# спрятать все остальные услуги
cur = c.execute(
    "SELECT id FROM products WHERE IFNULL(item_kind,'product')='service' AND IFNULL(is_active,1)=1"
)
hide = 0
for (pid,) in cur.fetchall():
    if pid in keep_ids:
        continue
    c.execute("UPDATE products SET is_active=0 WHERE id=?", (pid,))
    hide += 1

c.commit()
active = c.execute(
    "SELECT COUNT(*) FROM products WHERE IFNULL(item_kind,'product')='service' AND IFNULL(is_active,1)=1"
).fetchone()[0]
print(json.dumps({
    "ok": True,
    "backup": bak,
    "rows": len(rows),
    "created": created,
    "matched": matched,
    "hidden": hide,
    "active_services": active,
    "keep_ids": sorted(keep_ids),
}, ensure_ascii=False, indent=2))
PY;

file_put_contents(sys_get_temp_dir() . '/apply_obshchie_uslugi_se.py', $py);
passthru('scp -q ' . escapeshellarg($dumpPath) . ' ' . escapeshellarg("{$remoteHost}:{$remoteJson}"), $sc1);
if ($sc1 !== 0) {
    fwrite(STDERR, "scp json failed\n");
    exit(5);
}
passthru('scp -q ' . escapeshellarg(sys_get_temp_dir() . '/apply_obshchie_uslugi_se.py') . ' ' . escapeshellarg("{$remoteHost}:{$remotePy}"), $sc2);
if ($sc2 !== 0) {
    fwrite(STDERR, "scp py failed\n");
    exit(6);
}
passthru(
    'ssh -o BatchMode=yes ' . escapeshellarg($remoteHost) . ' ' .
    escapeshellarg("python3 {$remotePy} {$remoteJson}"),
    $sc3
);
exit($sc3 === 0 ? 0 : 7);
