<?php
/**
 * Выгрузка цен мастеров Москвы в Google Sheet (колонки C/D/E).
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1KRNwQIi-jYBDtKYl5rQ9is6zngbPds0ZZvBXWCApn7I
 *   C = Цена (розничная)
 *   D = Партнерская
 *   E = Снятие/Установка
 *
 * Источник: WMS product_prices + products.install_price, fallback amo1c products.price / price_install.
 *
 * Usage (tech35):
 *   php tools/export_msk_prices_to_sheet.php --dry-run
 *   php tools/export_msk_prices_to_sheet.php --apply
 */
declare(strict_types=1);

$credPath = getenv('GOOGLE_SA_JSON')
    ?: '/root/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = getenv('GOOGLE_PHP_AUTOLOAD')
    ?: '/root/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$wmsDb = getenv('WMS_SQLITE')
    ?: '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
$spreadsheetId = getenv('MSK_NOMEN_SHEET_ID') ?: '1KRNwQIi-jYBDtKYl5rQ9is6zngbPds0ZZvBXWCApn7I';
$sheetGid = (int) (getenv('MSK_NOMEN_SHEET_GID') ?: 0);

$dryRun = true;
foreach ($argv as $a) {
    if ($a === '--apply') {
        $dryRun = false;
    }
    if ($a === '--dry-run') {
        $dryRun = true;
    }
}

if (!is_readable($credPath) || !is_readable($autoload)) {
    fwrite(STDERR, "Нет Google credentials/autoload\n");
    exit(1);
}
if (!is_readable($wmsDb)) {
    fwrite(STDERR, "Нет WMS sqlite: {$wmsDb}\n");
    exit(1);
}

require $autoload;

function moneyVal($v): float
{
    if ($v === null || $v === '') {
        return 0.0;
    }
    if (is_numeric($v)) {
        return max(0.0, (float) $v);
    }
    $s = preg_replace('/[^\d,.\-]/u', '', str_replace("\xc2\xa0", '', (string) $v)) ?? '';
    $s = str_replace(',', '.', $s);
    return is_numeric($s) ? max(0.0, (float) $s) : 0.0;
}

function moneyCell(float $v): string|int|float
{
    if ($v <= 0) {
        return '';
    }
    // целые без копеек — числом, чтобы в таблице считалось
    if (abs($v - round($v)) < 0.001) {
        return (int) round($v);
    }
    return round($v, 2);
}

function colIndex(array $header, array $aliases, bool $allowContains = true): ?int
{
    $norm = static function (string $h): string {
        $h = mb_strtolower(trim($h));
        $h = preg_replace('/\s+/u', ' ', $h) ?? $h;
        return $h;
    };
    $aliases = array_map($norm, $aliases);
    foreach ($header as $i => $h) {
        $hn = $norm((string) $h);
        foreach ($aliases as $a) {
            if ($hn === $a) {
                return (int) $i;
            }
        }
    }
    if ($allowContains) {
        foreach ($header as $i => $h) {
            $hn = $norm((string) $h);
            foreach ($aliases as $a) {
                if ($a !== '' && str_contains($hn, $a)) {
                    return (int) $i;
                }
            }
        }
    }
    return null;
}

$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS]);
$sheets = new Google_Service_Sheets($client);

$meta = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets(properties(sheetId,title))']);
$title = null;
foreach ($meta->getSheets() as $s) {
    $p = $s->getProperties();
    if ((int) $p->getSheetId() === $sheetGid) {
        $title = $p->getTitle();
        break;
    }
}
if ($title === null) {
    fwrite(STDERR, "Лист gid={$sheetGid} не найден\n");
    exit(2);
}

$vals = $sheets->spreadsheets_values->get($spreadsheetId, "'{$title}'!A1:AZ")->getValues() ?: [];
if (count($vals) < 2) {
    fwrite(STDERR, "Пустой лист\n");
    exit(2);
}

$header = $vals[0];
$iMaster = colIndex($header, ['mraer мастер', 'мастер']);
$iRetail = null;
$iPartner = null;
$iInstall = null;
foreach ($header as $i => $h) {
    $hn = mb_strtolower(trim((string) $h));
    if ($hn === 'цена' || $hn === 'розничная' || $hn === 'розничная цена') {
        $iRetail = (int) $i;
    }
    if ($hn === 'партнерская' || $hn === 'партнёрская' || $hn === 'розничная партнерская') {
        $iPartner = (int) $i;
    }
    if (str_contains($hn, 'снятие') || str_contains($hn, 'установк')) {
        $iInstall = (int) $i;
    }
}
$iRetail ??= colIndex($header, ['цена'], false);
$iPartner ??= colIndex($header, ['партнерская', 'партнёрская']);
$iInstall ??= colIndex($header, ['снятие/установка', 'снятие']);

if ($iMaster === null || $iRetail === null || $iPartner === null || $iInstall === null) {
    fwrite(STDERR, 'Колонки: master=' . json_encode($iMaster)
        . ' retail=' . json_encode($iRetail)
        . ' partner=' . json_encode($iPartner)
        . ' install=' . json_encode($iInstall) . "\n");
    exit(3);
}

if (!($iRetail === 2 && $iPartner === 3 && $iInstall === 4)) {
    fwrite(STDERR, "Ожидались колонки C/D/E (2/3/4), сейчас {$iRetail}/{$iPartner}/{$iInstall}\n");
    exit(3);
}

fwrite(STDERR, "лист={$title} C/D/E indexes: retail={$iRetail} partner={$iPartner} install={$iInstall}\n");

// --- load prices from WMS ---
$db = new PDO('sqlite:' . $wmsDb);
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$bySku = []; // sku => [retail, partner, install]
$st = $db->query(
    "SELECT p.sku, IFNULL(p.install_price,0) AS install_price, pp.price_type, pp.price
     FROM products p
     LEFT JOIN product_prices pp ON pp.product_id = p.id
     WHERE p.sku LIKE 'MRA%' OR p.sku IN (SELECT DISTINCT master_sku FROM product_supplier_lots)"
);
while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
    $sku = strtoupper(trim((string) $r['sku']));
    if ($sku === '') {
        continue;
    }
    if (!isset($bySku[$sku])) {
        $bySku[$sku] = ['retail' => 0.0, 'partner' => 0.0, 'install' => 0.0];
    }
    $ip = moneyVal($r['install_price'] ?? 0);
    if ($ip > 0) {
        $bySku[$sku]['install'] = $ip;
    }
    $ptype = trim((string) ($r['price_type'] ?? ''));
    $price = moneyVal($r['price'] ?? 0);
    if ($price <= 0 || $ptype === '') {
        continue;
    }
    $pl = mb_strtolower($ptype);
    if ($ptype === 'retail' || $pl === 'розничная цена' || $pl === 'розничная') {
        $bySku[$sku]['retail'] = $price;
    } elseif ($pl === 'розничная партнерская' || $pl === 'розничная партнёрская' || $ptype === 'partner') {
        $bySku[$sku]['partner'] = $price;
    } elseif (str_contains($pl, 'снятие') || str_contains($pl, 'установк')) {
        $bySku[$sku]['install'] = $price;
    }
}

// amo fallback
try {
    $amo = new PDO(
        'mysql:host=localhost;dbname=brooklynba_amo1c;charset=utf8mb4',
        'brooklynba_amo1c',
        'Qq112211',
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $st = $amo->query(
        "SELECT sku, price, IFNULL(price_install,0) AS price_install
         FROM products
         WHERE department = 'pnevmopodveska_2025' AND sku LIKE 'MRA%'"
    );
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
        $sku = strtoupper(trim((string) $r['sku']));
        if ($sku === '') {
            continue;
        }
        if (!isset($bySku[$sku])) {
            $bySku[$sku] = ['retail' => 0.0, 'partner' => 0.0, 'install' => 0.0];
        }
        $retail = moneyVal($r['price'] ?? 0);
        $install = moneyVal($r['price_install'] ?? 0);
        if ($retail > 0 && $bySku[$sku]['retail'] <= 0) {
            $bySku[$sku]['retail'] = $retail;
        }
        if ($install > 0 && $bySku[$sku]['install'] <= 0) {
            $bySku[$sku]['install'] = $install;
        }
    }
} catch (Throwable $e) {
    fwrite(STDERR, 'warn amo: ' . $e->getMessage() . "\n");
}

$out = [];
$stats = [
    'rows' => 0,
    'retail_filled' => 0,
    'partner_filled' => 0,
    'install_filled' => 0,
    'retail_empty' => 0,
    'partner_empty' => 0,
    'install_empty' => 0,
];
$emptyRetailSkus = [];

for ($r = 1, $n = count($vals); $r < $n; $r++) {
    $row = $vals[$r];
    $master = strtoupper(trim((string) ($row[$iMaster] ?? '')));
    if ($master === '') {
        $out[] = ['', '', ''];
        continue;
    }
    $stats['rows']++;
    $p = $bySku[$master] ?? ['retail' => 0.0, 'partner' => 0.0, 'install' => 0.0];
    $retail = (float) $p['retail'];
    $partner = (float) $p['partner'];
    $install = (float) $p['install'];
    if ($retail > 0) {
        $stats['retail_filled']++;
    } else {
        $stats['retail_empty']++;
        $emptyRetailSkus[$master] = true;
    }
    if ($partner > 0) {
        $stats['partner_filled']++;
    } else {
        $stats['partner_empty']++;
    }
    if ($install > 0) {
        $stats['install_filled']++;
    } else {
        $stats['install_empty']++;
    }
    $out[] = [moneyCell($retail), moneyCell($partner), moneyCell($install)];
}

$uniqueEmpty = count($emptyRetailSkus);
fwrite(STDERR, json_encode([
    'stats' => $stats,
    'unique_masters_no_retail' => $uniqueEmpty,
    'sample_no_retail' => array_slice(array_keys($emptyRetailSkus), 0, 25),
    'sample_out' => array_slice($out, 0, 5),
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n");

if ($dryRun) {
    fwrite(STDERR, "dry-run ok — для записи: --apply\n");
    exit(0);
}

// Ensure headers
$headerUpdates = [];
$want = [
    $iRetail => 'Цена',
    $iPartner => 'Партнерская',
    $iInstall => 'Снятие/Установка',
];
foreach ($want as $idx => $label) {
    $cur = trim((string) ($header[$idx] ?? ''));
    if ($cur === '') {
        $headerUpdates[] = new Google_Service_Sheets_ValueRange([
            'range' => "'{$title}'!" . chr(ord('A') + $idx) . '1',
            'values' => [[$label]],
        ]);
    }
}

$endRow = 1 + count($out);
$dataRange = "'{$title}'!C2:E{$endRow}";
$body = new Google_Service_Sheets_ValueRange([
    'range' => $dataRange,
    'values' => $out,
]);

$sheets->spreadsheets_values->update(
    $spreadsheetId,
    $dataRange,
    $body,
    ['valueInputOption' => 'USER_ENTERED']
);

foreach ($headerUpdates as $vr) {
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        $vr->getRange(),
        $vr,
        ['valueInputOption' => 'USER_ENTERED']
    );
}

echo json_encode(['ok' => true, 'updated' => $dataRange, 'stats' => $stats], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
