<?php
/**
 * Выгрузка товаров с «ценами-услугами» в Google Sheet.
 *
 * Лист gid=897586562 → «УСЛУГИ ТОВАРЫ · Подвеска»
 * + вкладка «УСЛУГИ ТОВАРЫ · Фогель»
 *
 * Остатки — только склады своего юрлица (Фогелю не подмешиваем PNEVMO).
 *
 *   php tools/export_product_service_prices_sheet.php
 */
declare(strict_types=1);

$cred = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$auto = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$dumpPy = __DIR__ . '/export_product_service_prices_dump.py';
if (!is_file($cred) || !is_file($auto) || !is_file($dumpPy)) {
    fwrite(STDERR, "Нет credentials / dump script\n");
    exit(1);
}
require $auto;

$spreadsheetId = getenv('SHEET_ID') ?: '1eW2wcijS59Or5YMVrmzCCVOmIbc9HgDMeEEaCgf4hMw';
$podveskaGid = (int) (getenv('PODVESKA_GID') ?: 897586562);
$remoteHost = getenv('WMS_DEPLOY_HOST') ?: 'bank-vps';
$dbPath = '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
$tmpJson = sys_get_temp_dir() . '/product-service-prices.json';

fwrite(STDERR, "→ читаю WMS…\n");
passthru('scp -q ' . escapeshellarg($dumpPy) . ' ' . escapeshellarg("{$remoteHost}:/tmp/export_product_service_prices_dump.py"), $sc1);
if ($sc1 !== 0) {
    fwrite(STDERR, "scp py failed\n");
    exit(2);
}
passthru(
    'ssh -o BatchMode=yes ' . escapeshellarg($remoteHost) . ' ' .
    escapeshellarg("python3 /tmp/export_product_service_prices_dump.py {$dbPath}") .
    ' > ' . escapeshellarg($tmpJson),
    $sc2
);
if ($sc2 !== 0 || !is_file($tmpJson) || filesize($tmpJson) < 50) {
    fwrite(STDERR, "remote export failed\n");
    exit(3);
}

$data = json_decode((string) file_get_contents($tmpJson), true);
if (!is_array($data) || empty($data['departments'])) {
    fwrite(STDERR, "Пустой JSON экспорта\n");
    exit(4);
}

$client = new Google\Client();
$client->setApplicationName('Uchet1 product service prices');
$client->setAuthConfig($cred);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$byGid = [];
$byTitle = [];
foreach ($ss->getSheets() as $sh) {
    $p = $sh->getProperties();
    $byGid[(int) $p->getSheetId()] = (string) $p->getTitle();
    $byTitle[(string) $p->getTitle()] = (int) $p->getSheetId();
}

$targets = [
    'pnevmopodveska_2025' => [
        'title' => 'УСЛУГИ ТОВАРЫ · Подвеска',
        'prefer_gid' => $podveskaGid,
    ],
    'fogel_2025' => [
        'title' => 'УСЛУГИ ТОВАРЫ · Фогель',
        'prefer_gid' => 0,
    ],
];

$requests = [];
$sheetIds = [];
foreach ($targets as $dept => $cfg) {
    $title = $cfg['title'];
    $gid = 0;
    if ($cfg['prefer_gid'] > 0 && isset($byGid[$cfg['prefer_gid']])) {
        $gid = $cfg['prefer_gid'];
        if ($byGid[$gid] !== $title) {
            $requests[] = new Google\Service\Sheets\Request([
                'updateSheetProperties' => [
                    'properties' => ['sheetId' => $gid, 'title' => $title],
                    'fields' => 'title',
                ],
            ]);
        }
    } elseif (isset($byTitle[$title])) {
        $gid = $byTitle[$title];
    } else {
        $requests[] = new Google\Service\Sheets\Request([
            'addSheet' => ['properties' => ['title' => $title]],
        ]);
        $gid = -1;
    }
    $sheetIds[$dept] = ['title' => $title, 'gid' => $gid];
}

if ($requests) {
    $sheets->spreadsheets->batchUpdate(
        $spreadsheetId,
        new Google\Service\Sheets\BatchUpdateSpreadsheetRequest(['requests' => $requests])
    );
    $ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
    $byTitle = [];
    foreach ($ss->getSheets() as $sh) {
        $p = $sh->getProperties();
        $byTitle[(string) $p->getTitle()] = (int) $p->getSheetId();
    }
    foreach ($sheetIds as $dept => &$info) {
        $info['gid'] = $byTitle[$info['title']] ?? 0;
    }
    unset($info);
}

$fmtQty = static function ($v): string|int {
    $n = (float) $v;
    if (abs($n) < 0.0001) {
        return '';
    }
    if (abs($n - round($n)) < 0.0001) {
        return (int) round($n);
    }

    return round($n, 2);
};

foreach ($targets as $dept => $cfg) {
    $block = $data['departments'][$dept] ?? null;
    if (!$block) {
        fwrite(STDERR, "нет данных для {$dept}\n");
        continue;
    }
    $title = $sheetIds[$dept]['title'];
    $serviceTypes = $block['service_types'] ?? [];
    $whCols = $block['wh_cols'] ?? [];

    $header = ['Артикул', 'Код 1С', 'Наименование', 'Бренд', 'Категория', 'Остаток'];
    foreach ($whCols as $wh) {
        $header[] = (string) ($wh['label'] ?? $wh['code'] ?? '');
    }
    $header[] = 'Розничная цена';
    $header[] = 'Монтаж (карточка)';
    foreach ($serviceTypes as $t) {
        $header[] = $t;
    }

    $values = [$header];
    foreach ($block['rows'] as $r) {
        $line = [
            (string) ($r['sku'] ?? ''),
            (string) ($r['code'] ?? ''),
            (string) ($r['name'] ?? ''),
            (string) ($r['brand'] ?? ''),
            (string) ($r['category'] ?? ''),
            $fmtQty($r['qty_total'] ?? 0),
        ];
        $qtyByWh = $r['qty_by_wh'] ?? [];
        foreach ($whCols as $wh) {
            $code = (string) ($wh['code'] ?? '');
            $line[] = $fmtQty($qtyByWh[$code] ?? 0);
        }
        $line[] = ($r['retail'] ?? 0) > 0 ? round((float) $r['retail']) : '';
        $line[] = ($r['install_price'] ?? 0) > 0 ? round((float) $r['install_price']) : '';
        $svc = $r['service_prices'] ?? [];
        foreach ($serviceTypes as $t) {
            $v = (float) ($svc[$t] ?? 0);
            $line[] = $v > 0 ? round($v) : '';
        }
        $values[] = $line;
    }

    $quoted = "'" . str_replace("'", "''", $title) . "'";
    $sheets->spreadsheets_values->clear(
        $spreadsheetId,
        "{$quoted}!A:ZZ",
        new Google\Service\Sheets\ClearValuesRequest()
    );
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        "{$quoted}!A1",
        new Google\Service\Sheets\ValueRange(['values' => $values]),
        ['valueInputOption' => 'USER_ENTERED']
    );

    $gid = $sheetIds[$dept]['gid'];
    fwrite(STDERR, "OK {$title}: " . (count($values) - 1) . " строк gid={$gid}\n");
    echo "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$gid}\n";
}

fwrite(STDERR, "done\n");
