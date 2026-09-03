<?php
/**
 * Прайс MRAER (Google Sheet) → products + product_prices + install_price.
 *
 * Лист: https://docs.google.com/spreadsheets/d/1UZ5B68liOZpw64Kyw6h93ye9zCjIqbhsMEAkciEh4xg
 * gid 1473256690 «Прайс MRAER»
 * Колонки: Код | Артикул | Бренд | Наименование | … | Розничная цена | … | Цена снятие/установки
 *
 * Usage:
 *   php tools/import_mraer_price_sheet.php --dump=/tmp/mraer.json
 *   php tools/import_mraer_price_sheet.php --dump=/tmp/mraer.json --apply-remote
 */
declare(strict_types=1);

$credPath = getenv('GOOGLE_SA_JSON')
    ?: '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = getenv('GOOGLE_PHP_AUTOLOAD')
    ?: '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$spreadsheetId = getenv('MRAER_SHEET_ID') ?: '1UZ5B68liOZpw64Kyw6h93ye9zCjIqbhsMEAkciEh4xg';
$sheetGid = (int) (getenv('MRAER_SHEET_GID') ?: 1473256690);

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
    $dumpPath = sys_get_temp_dir() . '/mraer-price.json';
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
$client->setApplicationName('Uchet1 MRAER price import');
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
$vals = $sheets->spreadsheets_values->get($spreadsheetId, "'{$title}'!A1:I")->getValues() ?: [];
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

$iCode = $col($header, ['код']);
$iSku = $col($header, ['артикул']);
$iBrand = $col($header, ['бренд']);
$iName = $col($header, ['наименование', 'название']);
$iRetail = $col($header, ['розничная цена', 'рознич']);
$iInstall = $col($header, ['снятие/установки', 'снятие', 'установки']);

if ($iSku === null || $iName === null) {
    fwrite(STDERR, 'Не найдены колонки Артикул/Наименование: ' . json_encode($header, JSON_UNESCAPED_UNICODE) . "\n");
    exit(4);
}

$rows = [];
$seenSku = [];
for ($r = 1, $n = count($vals); $r < $n; $r++) {
    $line = $vals[$r];
    $sku = strtoupper(preg_replace('/\s+/', '', trim((string) ($line[$iSku] ?? ''))) ?? '');
    $name = trim((string) ($line[$iName] ?? ''));
    if ($sku === '' || $name === '') {
        continue;
    }
    if (isset($seenSku[$sku])) {
        continue; // первый wins
    }
    $seenSku[$sku] = true;
    $code = trim((string) ($iCode !== null ? ($line[$iCode] ?? '') : ''));
    $brand = trim((string) ($iBrand !== null ? ($line[$iBrand] ?? '') : 'MRAER'));
    if ($brand === '') {
        $brand = 'MRAER';
    }
    $rows[] = [
        'code' => $code,
        'sku' => $sku,
        'brand' => $brand,
        'name' => $name,
        'retail' => moneyVal($iRetail !== null ? ($line[$iRetail] ?? 0) : 0),
        'install' => moneyVal($iInstall !== null ? ($line[$iInstall] ?? 0) : 0),
    ];
}

$payload = [
    'sheet' => $title,
    'gid' => $sheetGid,
    'count' => count($rows),
    'rows' => $rows,
];
file_put_contents($dumpPath, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
fwrite(STDERR, "OK dump {$dumpPath}: " . count($rows) . " rows\n");
fwrite(STDERR, 'with install>0: ' . count(array_filter($rows, static fn ($x) => $x['install'] > 0)) . "\n");

if (!$applyRemote) {
    exit(0);
}

$remoteHost = getenv('WMS_DEPLOY_HOST') ?: 'bank-vps';
$remoteDb = '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
$remoteJson = '/tmp/mraer-price.json';
$remotePy = '/tmp/import_mraer_price.py';

$py = <<<'PY'
#!/usr/bin/env python3
import json, sqlite3, uuid, sys
path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/mraer-price.json"
dbpath = sys.argv[2] if len(sys.argv) > 2 else "/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite"
data = json.load(open(path, encoding="utf-8"))
rows = data.get("rows") or []
c = sqlite3.connect(dbpath)
c.execute("PRAGMA busy_timeout=60000")
cols = {r[1] for r in c.execute("PRAGMA table_info(products)")}
if "install_price" not in cols:
    c.execute("ALTER TABLE products ADD COLUMN install_price REAL NOT NULL DEFAULT 0")
c.execute("""
CREATE TABLE IF NOT EXISTS product_service_links (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  service_product_id TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'install',
  price_override REAL,
  qty_mode TEXT NOT NULL DEFAULT 'same',
  auto_add INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, service_product_id, role)
)""")
unit = c.execute("SELECT id FROM units WHERE short_name='шт' LIMIT 1").fetchone()
unit_id = unit[0] if unit else (c.execute("SELECT id FROM units LIMIT 1").fetchone() or [""])[0]
svc = c.execute("SELECT id FROM products WHERE sku='SVC-INSTALL' OR (IFNULL(item_kind,'')='service' AND lower(name)=lower('Снятие / установка')) LIMIT 1").fetchone()
if not svc:
    sid = str(uuid.uuid4())
    c.execute(
        "INSERT INTO products (id, sku, code, name, category_id, unit_id, barcode, item_kind, brand, is_active) VALUES (?,?,?,?,NULL,?,'','service','',1)",
        (sid, "SVC-INSTALL", "SVC-INSTALL", "Снятие / установка", unit_id),
    )
    svc_id = sid
else:
    svc_id = svc[0]
    c.execute("UPDATE products SET is_active=1, item_kind='service' WHERE id=?", (svc_id,))

def upsert_price(pid, ptype, price):
    if price is None:
        return
    price = float(price or 0)
    row = c.execute("SELECT id FROM product_prices WHERE product_id=? AND price_type=? LIMIT 1", (pid, ptype)).fetchone()
    if row:
        c.execute("UPDATE product_prices SET price=? WHERE id=?", (price, row[0]))
    else:
        c.execute(
            "INSERT INTO product_prices (id, product_id, price_type, price) VALUES (?,?,?,?)",
            (f"{pid}|{ptype}", pid, ptype, price),
        )

def link_install(pid, price):
    price = float(price or 0)
    ex = c.execute("SELECT id FROM product_service_links WHERE product_id=? AND role='install' LIMIT 1", (pid,)).fetchone()
    if ex:
        c.execute(
            "UPDATE product_service_links SET service_product_id=?, price_override=?, auto_add=1, qty_mode='same' WHERE id=?",
            (svc_id, price if price > 0 else None, ex[0]),
        )
    else:
        c.execute(
            "INSERT INTO product_service_links (id, product_id, service_product_id, role, price_override, qty_mode, auto_add, sort_order) VALUES (?,?,?,?,?,'same',1,0)",
            (str(uuid.uuid4()), pid, svc_id, "install", price if price > 0 else None),
        )

stats = {"matched_code":0,"matched_sku":0,"created":0,"updated":0,"with_install":0,"sku_clash":0}

for r in rows:
    code = (r.get("code") or "").strip()
    sku = (r.get("sku") or "").strip().upper()
    name = (r.get("name") or "").strip()
    brand = (r.get("brand") or "MRAER").strip() or "MRAER"
    retail = float(r.get("retail") or 0)
    install = float(r.get("install") or 0)
    row = None
    how = None
    if code:
        row = c.execute("SELECT id, sku FROM products WHERE code=? OR sku=? LIMIT 1", (code, code)).fetchone()
        if row:
            how = "code"
    if not row and sku:
        row = c.execute("SELECT id, sku FROM products WHERE sku=? OR code=? LIMIT 1", (sku, sku)).fetchone()
        if row:
            how = "sku"
    if row:
        pid = row[0]
        if how == "code":
            stats["matched_code"] += 1
        else:
            stats["matched_sku"] += 1
        # sku → артикул MRA, если свободен
        clash = c.execute("SELECT id FROM products WHERE sku=? AND id!=? LIMIT 1", (sku, pid)).fetchone()
        if clash:
            stats["sku_clash"] += 1
            c.execute(
                "UPDATE products SET name=?, brand=?, code=COALESCE(NULLIF(code,''), ?), is_active=1, item_kind='product', install_price=? WHERE id=?",
                (name, brand, code or sku, install, pid),
            )
        else:
            c.execute(
                "UPDATE products SET sku=?, name=?, brand=?, code=COALESCE(NULLIF(code,''), ?), is_active=1, item_kind='product', install_price=? WHERE id=?",
                (sku, name, brand, code or sku, install, pid),
            )
        stats["updated"] += 1
    else:
        pid = str(uuid.uuid4())
        c.execute(
            "INSERT INTO products (id, sku, code, name, category_id, unit_id, barcode, item_kind, brand, is_active, install_price) VALUES (?,?,?,?,NULL,?,'','product',?,1,?)",
            (pid, sku, code or sku, name, unit_id, brand, install),
        )
        stats["created"] += 1
    upsert_price(pid, "Розничная цена", retail)
    upsert_price(pid, "Цена снятие/установки", install)
    if install > 0:
        link_install(pid, install)
        stats["with_install"] += 1

c.commit()
print(json.dumps({"ok": True, "rows": len(rows), **stats}, ensure_ascii=False))
PY;

file_put_contents(sys_get_temp_dir() . '/import_mraer_price.py', $py);
passthru('scp -q ' . escapeshellarg($dumpPath) . ' ' . escapeshellarg("{$remoteHost}:{$remoteJson}"), $scode);
if ($scode !== 0) {
    fwrite(STDERR, "scp json failed\n");
    exit(5);
}
passthru('scp -q ' . escapeshellarg(sys_get_temp_dir() . '/import_mraer_price.py') . ' ' . escapeshellarg("{$remoteHost}:{$remotePy}"), $scode);
if ($scode !== 0) {
    fwrite(STDERR, "scp py failed\n");
    exit(6);
}
passthru('ssh ' . escapeshellarg($remoteHost) . ' python3 ' . escapeshellarg($remotePy) . ' ' . escapeshellarg($remoteJson) . ' ' . escapeshellarg($remoteDb), $rcode);
exit($rcode === 0 ? 0 : 7);
