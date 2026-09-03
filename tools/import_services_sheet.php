<?php
/**
 * Лист «Услуги» (Номенклатура для ОП) → products как услуги + price_min/price_max (Q/R).
 *
 * https://docs.google.com/spreadsheets/d/1T2FEXnWBeFhfKI-Y7_8tVfWFxFDRwTdZtPHH_NeCfn4
 * gid 219844074
 * Q = Мин, R = Макс; O = медиана (дефолт цены); P = средняя
 *
 * Usage:
 *   php tools/import_services_sheet.php --dump=/tmp/services.json
 *   php tools/import_services_sheet.php --dump=/tmp/services.json --apply-remote
 */
declare(strict_types=1);

$credPath = getenv('GOOGLE_SA_JSON')
    ?: '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = getenv('GOOGLE_PHP_AUTOLOAD')
    ?: '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$spreadsheetId = getenv('SERVICES_SHEET_ID') ?: '1T2FEXnWBeFhfKI-Y7_8tVfWFxFDRwTdZtPHH_NeCfn4';
$sheetGid = (int) (getenv('SERVICES_SHEET_GID') ?: 219844074);

$dumpPath = '';
$applyRemote = false;
foreach ($argv as $a) {
    if (str_starts_with($a, '--dump=')) {
        $dumpPath = substr($a, 7);
    }
    if ($a === '--apply-remote') {
        $applyRemote = true;
    }
}
if ($dumpPath === '') {
    $dumpPath = sys_get_temp_dir() . '/services-sheet.json';
}

if (!is_file($credPath) || !is_file($autoload)) {
    fwrite(STDERR, "Нет Google credentials/autoload\n");
    exit(1);
}

require $autoload;

function moneyVal(mixed $v): float
{
    if ($v === null || $v === '') {
        return 0.0;
    }
    if (is_numeric($v)) {
        return max(0.0, (float) $v);
    }
    $s = preg_replace('/[^\d,.\-]/u', '', str_replace("\xc2\xa0", '', (string) $v)) ?? '';
    $s = str_replace(',', '.', $s);
    if ($s === '' || !is_numeric($s)) {
        return 0.0;
    }
    return max(0.0, (float) $s);
}

$client = new Google\Client();
$client->setApplicationName('Uchet1 services import');
$client->setAuthConfig($credPath);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS_READONLY]);
$sheets = new Google\Service\Sheets($client);

$meta = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets(properties(sheetId,title))']);
$title = null;
foreach ($meta->getSheets() as $s) {
    if ((int) $s->getProperties()->getSheetId() === $sheetGid) {
        $title = $s->getProperties()->getTitle();
        break;
    }
}
if ($title === null) {
    fwrite(STDERR, "Лист gid={$sheetGid} не найден\n");
    exit(2);
}

fwrite(STDERR, "→ читаю «{$title}»…\n");
$vals = $sheets->spreadsheets_values->get($spreadsheetId, "'{$title}'!A1:S")->getValues() ?: [];
if (count($vals) < 2) {
    fwrite(STDERR, "Пустой лист\n");
    exit(3);
}

$header = array_map(static fn ($x) => mb_strtolower(trim((string) $x), 'UTF-8'), $vals[0]);
$col = static function (array $header, array $aliases): ?int {
    foreach ($aliases as $a) {
        $a = mb_strtolower($a, 'UTF-8');
        foreach ($header as $i => $h) {
            if ($h === $a || str_contains($h, $a)) {
                return (int) $i;
            }
        }
    }
    return null;
};

$iSku = $col($header, ['артикул']);
$iCode = $col($header, ['код']);
$iName = $col($header, ['название', 'наименование']);
$iActive = $col($header, ['активна']);
$iMedian = $col($header, ['медиана', 'цена (медиана']);
$iAvg = $col($header, ['средняя']);
$iMin = $col($header, ['мин']);
$iMax = $col($header, ['макс']);

if ($iSku === null || $iName === null) {
    fwrite(STDERR, 'Нет колонок Артикул/Название: ' . json_encode($header, JSON_UNESCAPED_UNICODE) . "\n");
    exit(4);
}
// Q/R must be Мин/Макс
if ($iMin === null || $iMax === null) {
    fwrite(STDERR, "Нет колонок Мин/Макс (Q/R)\n");
    exit(5);
}

$rows = [];
$seen = [];
for ($r = 1, $n = count($vals); $r < $n; $r++) {
    $line = $vals[$r];
    $sku = trim((string) ($line[$iSku] ?? ''));
    $name = trim((string) ($line[$iName] ?? ''));
    if ($sku === '' || $name === '') {
        continue;
    }
    $key = mb_strtoupper($sku, 'UTF-8');
    if (isset($seen[$key])) {
        continue;
    }
    $seen[$key] = true;
    $code = trim((string) ($iCode !== null ? ($line[$iCode] ?? '') : ''));
    $activeRaw = mb_strtolower(trim((string) ($iActive !== null ? ($line[$iActive] ?? 'да') : 'да')), 'UTF-8');
    $active = !in_array($activeRaw, ['нет', 'no', '0', 'false', 'архив'], true);
    $min = moneyVal($line[$iMin] ?? 0);
    $max = moneyVal($line[$iMax] ?? 0);
    if ($max > 0 && $min > $max) {
        [$min, $max] = [$max, $min];
    }
    $median = moneyVal($iMedian !== null ? ($line[$iMedian] ?? 0) : 0);
    $avg = moneyVal($iAvg !== null ? ($line[$iAvg] ?? 0) : 0);
    $default = $median > 0 ? $median : ($avg > 0 ? $avg : 0);
    if (!($default > 0) && $min > 0 && $max > 0) {
        $default = round(($min + $max) / 2, 2);
    }
    if (!($default > 0) && $min > 0) {
        $default = $min;
    }
    if (!($default > 0) && $max > 0) {
        $default = $max;
    }
    $rows[] = [
        'sku' => $sku,
        'code' => $code !== '' ? $code : $sku,
        'name' => $name,
        'active' => $active,
        'price_min' => $min,
        'price_max' => $max,
        'price_default' => $default,
    ];
}

$payload = ['sheet' => $title, 'gid' => $sheetGid, 'count' => count($rows), 'rows' => $rows];
file_put_contents($dumpPath, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
$withRange = count(array_filter($rows, static fn ($x) => $x['price_min'] > 0 || $x['price_max'] > 0));
fwrite(STDERR, "OK dump {$dumpPath}: " . count($rows) . " rows, with min/max: {$withRange}\n");

if (!$applyRemote) {
    exit(0);
}

$remoteHost = getenv('WMS_DEPLOY_HOST') ?: 'bank-vps';
$remoteDb = '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
$remoteJson = '/tmp/services-sheet.json';
$remotePy = '/tmp/import_services_sheet.py';

$py = <<<'PY'
#!/usr/bin/env python3
import json, sqlite3, uuid, sys
path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/services-sheet.json"
dbpath = sys.argv[2] if len(sys.argv) > 2 else "/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite"
data = json.load(open(path, encoding="utf-8"))
rows = data.get("rows") or []
c = sqlite3.connect(dbpath)
c.execute("PRAGMA busy_timeout=60000")
cols = {r[1] for r in c.execute("PRAGMA table_info(products)")}
for col, ddl in [
    ("price_min", "ALTER TABLE products ADD COLUMN price_min REAL NOT NULL DEFAULT 0"),
    ("price_max", "ALTER TABLE products ADD COLUMN price_max REAL NOT NULL DEFAULT 0"),
    ("install_price", "ALTER TABLE products ADD COLUMN install_price REAL NOT NULL DEFAULT 0"),
]:
    if col not in cols:
        c.execute(ddl)
unit = c.execute("SELECT id FROM units WHERE short_name='шт' LIMIT 1").fetchone()
unit_id = unit[0] if unit else (c.execute("SELECT id FROM units LIMIT 1").fetchone() or [""])[0]

def upsert_price(pid, ptype, price):
    price = float(price or 0)
    row = c.execute("SELECT id FROM product_prices WHERE product_id=? AND price_type=? LIMIT 1", (pid, ptype)).fetchone()
    if row:
        c.execute("UPDATE product_prices SET price=? WHERE id=?", (price, row[0]))
    else:
        c.execute(
            "INSERT INTO product_prices (id, product_id, price_type, price) VALUES (?,?,?,?)",
            (f"{pid}|{ptype}", pid, ptype, price),
        )

stats = {"matched": 0, "created": 0, "with_range": 0}
for r in rows:
    sku = (r.get("sku") or "").strip()
    code = (r.get("code") or sku).strip()
    name = (r.get("name") or "").strip()
    active = 1 if r.get("active", True) else 0
    pmin = float(r.get("price_min") or 0)
    pmax = float(r.get("price_max") or 0)
    pdef = float(r.get("price_default") or 0)
    row = c.execute(
        "SELECT id FROM products WHERE sku=? OR code=? OR sku=? OR code=? LIMIT 1",
        (sku, sku, code, code),
    ).fetchone()
    if row:
        pid = row[0]
        c.execute(
            """UPDATE products SET name=?, sku=?, code=?, item_kind='service', is_active=?,
               price_min=?, price_max=? WHERE id=?""",
            (name, sku, code, active, pmin, pmax, pid),
        )
        stats["matched"] += 1
    else:
        pid = str(uuid.uuid4())
        c.execute(
            """INSERT INTO products (id, sku, code, name, category_id, unit_id, barcode, item_kind, brand, is_active, price_min, price_max)
               VALUES (?,?,?,?,NULL,?,'','service','',?,?,?)""",
            (pid, sku, code, name, unit_id, active, pmin, pmax),
        )
        stats["created"] += 1
    if pdef > 0:
        upsert_price(pid, "Розничная цена", pdef)
    if pmin > 0:
        upsert_price(pid, "Мин", pmin)
    if pmax > 0:
        upsert_price(pid, "Макс", pmax)
    if pmin > 0 or pmax > 0:
        stats["with_range"] += 1

c.commit()
print(json.dumps({"ok": True, "rows": len(rows), **stats}, ensure_ascii=False))
PY;

file_put_contents(sys_get_temp_dir() . '/import_services_sheet.py', $py);
passthru('scp -q ' . escapeshellarg($dumpPath) . ' ' . escapeshellarg("{$remoteHost}:{$remoteJson}"), $scode);
if ($scode !== 0) {
    fwrite(STDERR, "scp json failed\n");
    exit(5);
}
passthru('scp -q ' . escapeshellarg(sys_get_temp_dir() . '/import_services_sheet.py') . ' ' . escapeshellarg("{$remoteHost}:{$remotePy}"), $scode);
if ($scode !== 0) {
    fwrite(STDERR, "scp py failed\n");
    exit(6);
}
passthru('ssh ' . escapeshellarg($remoteHost) . ' python3 ' . escapeshellarg($remotePy) . ' ' . escapeshellarg($remoteJson) . ' ' . escapeshellarg($remoteDb), $rcode);
exit($rcode === 0 ? 0 : 7);
