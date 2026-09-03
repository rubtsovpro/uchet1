<?php
/**
 * Выгрузка товаров Пневмоподвеска · Москва (pnevmopodveska_2025) на Лист3.
 *
 *   php tools/push_pnevmo_msk_products_sheet.php /path/to/pnevmo_msk_products.json
 */
declare(strict_types=1);

$jsonPath = $argv[1] ?? '';
if ($jsonPath === '' || !is_file($jsonPath)) {
    fwrite(STDERR, "Usage: php tools/push_pnevmo_msk_products_sheet.php /path/to.json\n");
    exit(1);
}

$spreadsheetId = getenv('SHEET_ID') ?: '1eW2wcijS59Or5YMVrmzCCVOmIbc9HgDMeEEaCgf4hMw';
$gid = (int) (getenv('SHEET_GID') ?: 1470186116);

$bankCandidates = [
    dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html',
    '/root/bank_pnevmopodveska1_ru/public_html',
];
$cred = '';
$auto = '';
foreach ($bankCandidates as $base) {
    $c = $base . '/pnevmopodveska1-677b14845bb0.json';
    $a = $base . '/vendor/autoload.php';
    if (is_file($c) && is_file($a)) {
        $cred = $c;
        $auto = $a;
        break;
    }
}
if ($cred === '') {
    fwrite(STDERR, "Нет Google SA credentials\n");
    exit(1);
}
require $auto;

$payload = json_decode((string) file_get_contents($jsonPath), true);
if (!is_array($payload) || empty($payload['items']) || !is_array($payload['items'])) {
    fwrite(STDERR, "Пустой JSON\n");
    exit(1);
}

/** @var list<string> $priceTypes */
$priceTypes = array_values(array_filter(array_map('strval', $payload['price_types'] ?? [])));
sort($priceTypes, SORT_NATURAL | SORT_FLAG_CASE);

$client = new Google\Client();
$client->setAuthConfig($cred);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$sheetId = null;
$title = null;
foreach ($ss->getSheets() ?? [] as $sh) {
    $p = $sh->getProperties();
    if ((int) $p->getSheetId() === $gid) {
        $sheetId = $gid;
        $title = (string) $p->getTitle();
        break;
    }
}
if ($sheetId === null || $title === null) {
    fwrite(STDERR, "Лист gid={$gid} не найден\n");
    exit(1);
}

$header = [
    'Основное/побочное', // для ручной разметки
    'Артикул',
    'OEM',
    'Код',
    'Складской артикул',
    'Наименование',
    'Тип товара',
    'Бренд',
    'Категория',
    'Уже основное (WMS)',
    'Роль дедупа',
];
foreach ($priceTypes as $pt) {
    $header[] = $pt;
}

$rows = [$header];
foreach ($payload['items'] as $it) {
    if (!is_array($it)) {
        continue;
    }
    $prices = is_array($it['prices'] ?? null) ? $it['prices'] : [];
    $line = [
        '', // разметка пользователем
        (string) ($it['sku'] ?? ''),
        (string) ($it['oem'] ?? ''),
        (string) ($it['code'] ?? ''),
        (string) ($it['warehouse_sku'] ?? ''),
        (string) ($it['name'] ?? ''),
        (string) ($it['item_kind'] ?? 'товар'),
        (string) ($it['brand'] ?? ''),
        (string) ($it['category'] ?? ''),
        (string) ($it['is_main'] ?? ''),
        (string) ($it['dedup_role'] ?? ''),
    ];
    foreach ($priceTypes as $pt) {
        $v = $prices[$pt] ?? '';
        $line[] = $v === '' || $v === null ? '' : (is_numeric($v) ? (0 + $v) : $v);
    }
    $rows[] = $line;
}

$needCols = count($header);
$needRows = count($rows) + 5;
$sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google\Service\Sheets\BatchUpdateSpreadsheetRequest([
        'requests' => [[
            'updateSheetProperties' => [
                'properties' => [
                    'sheetId' => $sheetId,
                    'gridProperties' => [
                        'rowCount' => max(1000, $needRows),
                        'columnCount' => max(26, $needCols + 2),
                    ],
                ],
                'fields' => 'gridProperties.rowCount,gridProperties.columnCount',
            ],
        ]],
    ])
);

$quoted = "'" . str_replace("'", "''", $title) . "'";
// clear old
$pad = [];
for ($i = 0; $i < 50; $i++) {
    $pad[] = array_fill(0, max(26, $needCols), '');
}
$sheets->spreadsheets_values->update(
    $spreadsheetId,
    "{$quoted}!A1",
    new Google\Service\Sheets\ValueRange([
        'range' => "{$quoted}!A1",
        'majorDimension' => 'ROWS',
        'values' => $pad,
    ]),
    ['valueInputOption' => 'RAW']
);

// write in chunks
$chunkSize = 2000;
for ($offset = 0; $offset < count($rows); $offset += $chunkSize) {
    $chunk = array_slice($rows, $offset, $chunkSize);
    $startRow = $offset + 1;
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        "{$quoted}!A{$startRow}",
        new Google\Service\Sheets\ValueRange([
            'range' => "{$quoted}!A{$startRow}",
            'majorDimension' => 'ROWS',
            'values' => $chunk,
        ]),
        ['valueInputOption' => 'USER_ENTERED']
    );
    fwrite(STDOUT, "wrote rows {$startRow}.." . ($startRow + count($chunk) - 1) . "\n");
}

// freeze header + bold + dropdown for col A
$sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google\Service\Sheets\BatchUpdateSpreadsheetRequest([
        'requests' => [
            [
                'updateSheetProperties' => [
                    'properties' => [
                        'sheetId' => $sheetId,
                        'gridProperties' => ['frozenRowCount' => 1],
                    ],
                    'fields' => 'gridProperties.frozenRowCount',
                ],
            ],
            [
                'repeatCell' => [
                    'range' => [
                        'sheetId' => $sheetId,
                        'startRowIndex' => 0,
                        'endRowIndex' => 1,
                        'startColumnIndex' => 0,
                        'endColumnIndex' => $needCols,
                    ],
                    'cell' => [
                        'userEnteredFormat' => [
                            'textFormat' => ['bold' => true],
                            'backgroundColor' => ['red' => 0.93, 'green' => 0.93, 'blue' => 0.93],
                        ],
                    ],
                    'fields' => 'userEnteredFormat(textFormat,backgroundColor)',
                ],
            ],
            [
                'setDataValidation' => [
                    'range' => [
                        'sheetId' => $sheetId,
                        'startRowIndex' => 1,
                        'endRowIndex' => count($rows),
                        'startColumnIndex' => 0,
                        'endColumnIndex' => 1,
                    ],
                    'rule' => [
                        'condition' => [
                            'type' => 'ONE_OF_LIST',
                            'values' => [
                                ['userEnteredValue' => 'основное'],
                                ['userEnteredValue' => 'побочное'],
                            ],
                        ],
                        'showCustomUi' => true,
                        'strict' => false,
                        'inputMessage' => 'основное / побочное',
                    ],
                ],
            ],
        ],
    ])
);

fwrite(STDOUT, 'OK products=' . (count($rows) - 1) . " price_cols=" . count($priceTypes) . "\n");
fwrite(STDOUT, "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$gid}\n");
