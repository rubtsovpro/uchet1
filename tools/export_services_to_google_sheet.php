<?php
/**
 * Выгрузка услуг (item_kind=service) в Google Таблицу.
 * Колонка K — рекомендация: оставить / удалить.
 *
 *   php tools/export_services_to_google_sheet.php [services-export.json]
 */
declare(strict_types=1);

$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$dataPath = $argv[1] ?? (__DIR__ . '/../services-export.json');
$spreadsheetId = getenv('SHEET_ID') ?: '1T2FEXnWBeFhfKI-Y7_8tVfWFxFDRwTdZtPHH_NeCfn4';
$tabTitle = 'Услуги Учёт№1 ' . date('Y-m-d H:i');

if (!is_file($credPath) || !is_file($autoload)) {
    fwrite(STDERR, "Нет credentials/autoload Google API\n");
    exit(1);
}
if (!is_file($dataPath)) {
    fwrite(STDERR, "Нет файла: {$dataPath}\n");
    exit(1);
}

$rows = json_decode((string) file_get_contents($dataPath), true);
if (!is_array($rows) || !$rows) {
    fwrite(STDERR, "Пустой или битый JSON\n");
    exit(1);
}

require $autoload;

$client = new Google\Client();
$client->setApplicationName('Uchet1 services → Sheets');
$client->setAuthConfig($credPath);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);

$add = new Google\Service\Sheets\Request([
    'addSheet' => [
        'properties' => [
            'title' => $tabTitle,
            'gridProperties' => [
                'rowCount' => max(100, count($rows) + 10),
                'columnCount' => 14,
            ],
        ],
    ],
]);
$batch = new Google\Service\Sheets\BatchUpdateSpreadsheetRequest(['requests' => [$add]]);
$resp = $sheets->spreadsheets->batchUpdate($spreadsheetId, $batch);
$sheetId = (int) $resp->getReplies()[0]->getAddSheet()->getProperties()->getSheetId();
$title = $resp->getReplies()[0]->getAddSheet()->getProperties()->getTitle();

$header = [
    '№',
    'Артикул',
    'Код',
    'Название',
    'Бренд',
    'Категория',
    'Ед.',
    'Активна',
    'Тип',
    'id',
    'Рекомендация',
    'Почему',
    'Заказов',
    'Строк',
];
$values = [$header];
$n = 0;
$delRows = []; // 0-based sheet row indexes (data rows start at 1)
$keepRows = [];
foreach ($rows as $r) {
    if (!is_array($r)) {
        continue;
    }
    $n++;
    $rec = trim((string) ($r['recommendation'] ?? ''));
    if ($rec !== 'удалить' && $rec !== 'оставить') {
        $rec = ((int) ($r['deals'] ?? 0) > 0 || (int) ($r['lines'] ?? 0) > 0) ? 'оставить' : 'удалить';
    }
    $values[] = [
        $n,
        (string) ($r['sku'] ?? ''),
        (string) ($r['code'] ?? ''),
        (string) ($r['name'] ?? ''),
        (string) ($r['brand'] ?? ''),
        (string) ($r['category'] ?? ''),
        (string) ($r['unit'] ?? ''),
        ((string) ($r['is_active'] ?? '') === '1' || ($r['is_active'] ?? false) === true) ? 'да' : 'нет',
        (string) ($r['item_kind'] ?? 'service'),
        (string) ($r['id'] ?? ''),
        $rec,
        (string) ($r['reason'] ?? ''),
        (int) ($r['deals'] ?? 0),
        (int) ($r['lines'] ?? 0),
    ];
    if ($rec === 'удалить') {
        $delRows[] = $n; // sheet row index (header=0 → data row n)
    } else {
        $keepRows[] = $n;
    }
}

$range = "'" . str_replace("'", "''", $title) . "'!A1";
$sheets->spreadsheets_values->update(
    $spreadsheetId,
    $range,
    new Google\Service\Sheets\ValueRange(['values' => $values]),
    ['valueInputOption' => 'RAW']
);

$requests = [
    new Google\Service\Sheets\Request([
        'repeatCell' => [
            'range' => [
                'sheetId' => $sheetId,
                'startRowIndex' => 0,
                'endRowIndex' => 1,
            ],
            'cell' => [
                'userEnteredFormat' => [
                    'textFormat' => ['bold' => true],
                    'backgroundColor' => ['red' => 0.93, 'green' => 0.96, 'blue' => 0.95],
                ],
            ],
            'fields' => 'userEnteredFormat(textFormat,backgroundColor)',
        ],
    ]),
    new Google\Service\Sheets\Request([
        'updateSheetProperties' => [
            'properties' => [
                'sheetId' => $sheetId,
                'gridProperties' => ['frozenRowCount' => 1],
            ],
            'fields' => 'gridProperties.frozenRowCount',
        ],
    ]),
];

// Подсветка колонки K (index 10)
foreach ($delRows as $rowIdx) {
    $requests[] = new Google\Service\Sheets\Request([
        'repeatCell' => [
            'range' => [
                'sheetId' => $sheetId,
                'startRowIndex' => $rowIdx,
                'endRowIndex' => $rowIdx + 1,
                'startColumnIndex' => 10,
                'endColumnIndex' => 11,
            ],
            'cell' => [
                'userEnteredFormat' => [
                    'backgroundColor' => ['red' => 1.0, 'green' => 0.9, 'blue' => 0.9],
                    'textFormat' => ['bold' => true, 'foregroundColor' => ['red' => 0.6, 'green' => 0.1, 'blue' => 0.1]],
                ],
            ],
            'fields' => 'userEnteredFormat(backgroundColor,textFormat)',
        ],
    ]);
}
foreach ($keepRows as $rowIdx) {
    $requests[] = new Google\Service\Sheets\Request([
        'repeatCell' => [
            'range' => [
                'sheetId' => $sheetId,
                'startRowIndex' => $rowIdx,
                'endRowIndex' => $rowIdx + 1,
                'startColumnIndex' => 10,
                'endColumnIndex' => 11,
            ],
            'cell' => [
                'userEnteredFormat' => [
                    'backgroundColor' => ['red' => 0.9, 'green' => 0.97, 'blue' => 0.92],
                    'textFormat' => ['bold' => true, 'foregroundColor' => ['red' => 0.1, 'green' => 0.45, 'blue' => 0.25]],
                ],
            ],
            'fields' => 'userEnteredFormat(backgroundColor,textFormat)',
        ],
    ]);
}

// batch in chunks — Sheets limit
$chunkSize = 80;
for ($i = 0; $i < count($requests); $i += $chunkSize) {
    $chunk = array_slice($requests, $i, $chunkSize);
    $sheets->spreadsheets->batchUpdate(
        $spreadsheetId,
        new Google\Service\Sheets\BatchUpdateSpreadsheetRequest(['requests' => $chunk])
    );
}

$url = "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$sheetId}";
$delN = count($delRows);
$keepN = count($keepRows);
echo "OK rows={$n} keep={$keepN} del={$delN} tab={$title}\n{$url}\n";
