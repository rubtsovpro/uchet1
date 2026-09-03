<?php
/**
 * Лист «Без габаритов упаковки»: только товары, остатки по складам.
 *
 *   php tools/export_missing_package_dims_to_google_sheet.php /tmp/missing-package-dims.json
 */
declare(strict_types=1);

$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$dataPath = $argv[1] ?? (__DIR__ . '/../tmp-missing-package-dims.json');
$spreadsheetId = getenv('SHEET_ID') ?: '1T2FEXnWBeFhfKI-Y7_8tVfWFxFDRwTdZtPHH_NeCfn4';
$tabTitle = 'Без габаритов упаковки';

if (!is_file($credPath) || !is_file($autoload)) {
    fwrite(STDERR, "Нет credentials/autoload Google API\n");
    exit(1);
}
if (!is_file($dataPath)) {
    fwrite(STDERR, "Нет файла: {$dataPath}\n");
    exit(1);
}

$payload = json_decode((string) file_get_contents($dataPath), true);
if (!is_array($payload)) {
    fwrite(STDERR, "Пустой или битый JSON\n");
    exit(1);
}

/** Совместимость: старый формат — массив строк; новый — {warehouses, items} */
$warehouses = [];
$rows = [];
if (isset($payload['items']) && is_array($payload['items'])) {
    $rows = $payload['items'];
    $warehouses = is_array($payload['warehouses'] ?? null) ? $payload['warehouses'] : [];
} else {
    $rows = $payload;
}

require $autoload;

$client = new Google\Client();
$client->setApplicationName('Uchet1 missing package dims → Sheets');
$client->setAuthConfig($credPath);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$reuseId = null;
foreach ($ss->getSheets() as $sh) {
    $p = $sh->getProperties();
    if ((string) $p->getTitle() === $tabTitle) {
        $reuseId = (int) $p->getSheetId();
        break;
    }
}

$whCols = [];
foreach ($warehouses as $w) {
    if (!is_array($w)) {
        continue;
    }
    $id = (string) ($w['id'] ?? '');
    if ($id === '') {
        continue;
    }
    $whCols[] = [
        'id' => $id,
        'title' => trim((string) ($w['name'] ?? $w['code'] ?? $id)) ?: $id,
    ];
}

$fixedHeader = [
    '№',
    'Артикул',
    'Код',
    'Название',
    'Категория',
    'Бренд',
    'Ед.',
    'Остаток всего',
    'Где остаток',
    'Ширина см',
    'Высота см',
    'Длина см',
    'Вес г',
    'Чего нет',
    'id',
];
$header = $fixedHeader;
foreach ($whCols as $wc) {
    $header[] = 'Склад: ' . $wc['title'];
}

$colCount = count($header);
$rowCount = max(200, count($rows) + 20);
$reqs = [];
if ($reuseId === null) {
    $reqs[] = new Google\Service\Sheets\Request([
        'addSheet' => [
            'properties' => [
                'title' => $tabTitle,
                'gridProperties' => [
                    'rowCount' => $rowCount,
                    'columnCount' => max(20, $colCount),
                ],
            ],
        ],
    ]);
} else {
    $reqs[] = new Google\Service\Sheets\Request([
        'updateSheetProperties' => [
            'properties' => [
                'sheetId' => $reuseId,
                'gridProperties' => [
                    'rowCount' => $rowCount,
                    'columnCount' => max(20, $colCount),
                ],
            ],
            'fields' => 'gridProperties.rowCount,gridProperties.columnCount',
        ],
    ]);
}

if ($reqs) {
    $resp = $sheets->spreadsheets->batchUpdate(
        $spreadsheetId,
        new Google\Service\Sheets\BatchUpdateSpreadsheetRequest(['requests' => $reqs])
    );
    if ($reuseId === null) {
        foreach ($resp->getReplies() as $reply) {
            $add = $reply->getAddSheet();
            if ($add) {
                $reuseId = (int) $add->getProperties()->getSheetId();
                break;
            }
        }
    }
}
if ($reuseId === null) {
    fwrite(STDERR, "Не удалось создать/найти вкладку «{$tabTitle}»\n");
    exit(1);
}

$quoted = "'" . str_replace("'", "''", $tabTitle) . "'";
$sheets->spreadsheets_values->clear(
    $spreadsheetId,
    "{$quoted}!A:AZ",
    new Google\Service\Sheets\ClearValuesRequest()
);

$values = [$header];
$n = 0;
foreach ($rows as $r) {
    if (!is_array($r)) {
        continue;
    }
    $n++;
    $byWh = is_array($r['stock_by_wh'] ?? null) ? $r['stock_by_wh'] : [];
    $row = [
        $n,
        (string) ($r['article'] ?? ''),
        (string) ($r['code'] ?? ''),
        (string) ($r['name'] ?? ''),
        (string) ($r['category'] ?? ''),
        (string) ($r['brand'] ?? ''),
        (string) ($r['unit'] ?? ''),
        $r['stock'] ?? 0,
        (string) ($r['stock_where'] ?? ''),
        $r['package_width_cm'] === '' || $r['package_width_cm'] === null ? '' : $r['package_width_cm'],
        $r['package_height_cm'] === '' || $r['package_height_cm'] === null ? '' : $r['package_height_cm'],
        $r['package_length_cm'] === '' || $r['package_length_cm'] === null ? '' : $r['package_length_cm'],
        $r['package_weight_g'] === '' || $r['package_weight_g'] === null ? '' : $r['package_weight_g'],
        (string) ($r['missing_dims'] ?? ''),
        (string) ($r['id'] ?? ''),
    ];
    foreach ($whCols as $wc) {
        $q = $byWh[$wc['id']] ?? $byWh[(string) $wc['id']] ?? '';
        $row[] = $q === '' || $q === null || (float) $q == 0.0 ? '' : $q;
    }
    $values[] = $row;
}

$chunk = 3000;
for ($i = 0; $i < count($values); $i += $chunk) {
    $part = array_slice($values, $i, $chunk);
    $range = $i === 0
        ? "{$quoted}!A1"
        : sprintf('%s!A%d', $quoted, $i + 1);
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        $range,
        new Google\Service\Sheets\ValueRange(['values' => $part]),
        ['valueInputOption' => 'USER_ENTERED']
    );
}

$formatReqs = [
    new Google\Service\Sheets\Request([
        'repeatCell' => [
            'range' => [
                'sheetId' => $reuseId,
                'startRowIndex' => 0,
                'endRowIndex' => 1,
            ],
            'cell' => [
                'userEnteredFormat' => [
                    'textFormat' => ['bold' => true],
                    'backgroundColor' => [
                        'red' => 0.93,
                        'green' => 0.95,
                        'blue' => 0.96,
                    ],
                ],
            ],
            'fields' => 'userEnteredFormat(textFormat,backgroundColor)',
        ],
    ]),
    new Google\Service\Sheets\Request([
        'updateSheetProperties' => [
            'properties' => [
                'sheetId' => $reuseId,
                'gridProperties' => ['frozenRowCount' => 1],
            ],
            'fields' => 'gridProperties.frozenRowCount',
        ],
    ]),
];

// Подсветка колонок складов (жёлтый заголовок)
$fixedCols = count($fixedHeader);
if ($whCols) {
    $formatReqs[] = new Google\Service\Sheets\Request([
        'repeatCell' => [
            'range' => [
                'sheetId' => $reuseId,
                'startRowIndex' => 0,
                'endRowIndex' => 1,
                'startColumnIndex' => $fixedCols,
                'endColumnIndex' => $fixedCols + count($whCols),
            ],
            'cell' => [
                'userEnteredFormat' => [
                    'textFormat' => ['bold' => true],
                    'backgroundColor' => [
                        'red' => 1.0,
                        'green' => 0.95,
                        'blue' => 0.8,
                    ],
                ],
            ],
            'fields' => 'userEnteredFormat(textFormat,backgroundColor)',
        ],
    ]);
}

$formatReqs[] = new Google\Service\Sheets\Request([
    'autoResizeDimensions' => [
        'dimensions' => [
            'sheetId' => $reuseId,
            'dimension' => 'COLUMNS',
            'startIndex' => 0,
            'endIndex' => min($colCount, 20),
        ],
    ],
]);

$sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google\Service\Sheets\BatchUpdateSpreadsheetRequest(['requests' => $formatReqs])
);

$url = "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$reuseId}";
fwrite(STDOUT, "OK {$n} товаров → «{$tabTitle}» (складов: " . count($whCols) . ")\n{$url}\n");
