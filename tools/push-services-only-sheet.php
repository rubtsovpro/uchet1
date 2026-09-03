<?php
/**
 * Выгрузка ТОЛЬКО услуг (item_kind=service) в Google Таблицу через SA.
 *
 * Usage:
 *   php tools/push-services-only-sheet.php [path/to/services.csv]
 *   SHEET_ID=... php tools/push-services-only-sheet.php
 */
declare(strict_types=1);

function servicesToolBankPaths(): array
{
    $candidates = [
        dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html',
        dirname(__DIR__) . '/../bank_pnevmopodveska1_ru/public_html',
        '/root/bank_pnevmopodveska1_ru/public_html',
    ];
    foreach ($candidates as $base) {
        $cred = $base . '/pnevmopodveska1-677b14845bb0.json';
        $auto = $base . '/vendor/autoload.php';
        if (is_file($cred) && is_file($auto)) {
            return [$cred, $auto];
        }
    }
    return ['', ''];
}

[$credPath, $autoload] = servicesToolBankPaths();
$folderId = getenv('FOLDER_ID') ?: '1PukJzT4zkQlWQWG6n3t_UmZOZ8VmTJ0j';
$spreadsheetId = trim((string) (getenv('SHEET_ID') ?: ''));
$csvPath = null;
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '' || str_starts_with($arg, '-')) {
        continue;
    }
    $csvPath = $arg;
    break;
}
$csvPath = $csvPath ?: (dirname(__DIR__) . '/../.tmp-services-only.csv');

if (!is_file($autoload) || !is_file($credPath)) {
    fwrite(STDERR, "Нет Google credentials/vendor\n");
    exit(1);
}
if (!is_file($csvPath)) {
    fwrite(STDERR, "Нет CSV: {$csvPath}\n");
    exit(1);
}

require $autoload;

/** @return list<list<string>> */
function readServicesCsv(string $path): array
{
    $fh = fopen($path, 'rb');
    if (!$fh) {
        throw new RuntimeException('Не открыть CSV');
    }
    $values = [];
    while (($row = fgetcsv($fh)) !== false) {
        $values[] = array_map(static fn($v) => (string) $v, $row);
    }
    fclose($fh);
    if (!$values) {
        throw new RuntimeException('Пустой CSV');
    }
    $header = $values[0];
    $dropIdx = null;
    foreach ($header as $i => $col) {
        if (trim((string) $col) === 'Цена монтажа') {
            $dropIdx = $i;
            break;
        }
    }
    if ($dropIdx !== null) {
        $values = array_map(static function (array $row) use ($dropIdx) {
            unset($row[$dropIdx]);
            return array_values($row);
        }, $values);
    }
    return normalizeServicesSheetValues($values);
}

/** @param list<list<string>> $values */
function normalizeServicesSheetValues(array $values): array
{
    if (count($values) < 2) {
        return $values;
    }
    $header = array_map(static fn($v) => trim((string) $v), $values[0]);
    $activeIdx = null;
    foreach ($header as $i => $col) {
        if ($col === 'Активна') {
            $activeIdx = $i;
            break;
        }
    }
    if ($activeIdx === null) {
        return $values;
    }

    $toBool = static function (string $raw): string {
        $v = mb_strtolower(trim($raw));
        if ($v === 'true' || $v === '1' || $v === 'да' || $v === 'yes') {
            return 'TRUE';
        }
        if ($v === 'false' || $v === '0' || $v === 'нет' || $v === 'no' || $v === '') {
            return 'FALSE';
        }
        return $v === 'TRUE' ? 'TRUE' : 'FALSE';
    };

    if ($activeIdx === 0) {
        for ($r = 1, $n = count($values); $r < $n; $r++) {
            $values[$r][0] = $toBool((string) ($values[$r][0] ?? ''));
        }
        return $values;
    }

    $newHeader = ['Активна'];
    foreach ($header as $i => $col) {
        if ($i !== $activeIdx) {
            $newHeader[] = $col;
        }
    }
    $out = [$newHeader];
    for ($r = 1, $n = count($values); $r < $n; $r++) {
        $row = $values[$r];
        $active = $toBool((string) ($row[$activeIdx] ?? ''));
        $next = [$active];
        foreach ($row as $i => $cell) {
            if ($i !== $activeIdx) {
                $next[] = (string) $cell;
            }
        }
        $out[] = $next;
    }
    return $out;
}

$values = readServicesCsv($csvPath);
$dataRows = max(0, count($values) - 1);
$title = 'Услуги · Учёт №1 · ' . date('Y-m-d');

$client = new Google\Client();
$client->setApplicationName('Uchet1 services export');
$client->setAuthConfig($credPath);
$client->setScopes([
    Google\Service\Sheets::SPREADSHEETS,
    Google\Service\Drive::DRIVE,
]);

$drive = new Google\Service\Drive($client);
$sheets = new Google\Service\Sheets($client);

if ($spreadsheetId === '') {
    $meta = new Google\Service\Drive\DriveFile([
        'name' => $title,
        'mimeType' => 'application/vnd.google-apps.spreadsheet',
        'parents' => [$folderId],
    ]);
    try {
        $file = $drive->files->create($meta, [
            'fields' => 'id,name,webViewLink',
            'supportsAllDrives' => true,
        ]);
    } catch (Google\Service\Exception $e) {
        fwrite(STDERR, "Drive create: " . $e->getMessage() . "\n");
        fwrite(STDERR, "Создайте пустую Google Таблицу в папке и передайте SHEET_ID=...\n");
        fwrite(STDERR, "Расшарьте на pnevmopodveska1-bank@pnevmopodveska1.iam.gserviceaccount.com (Редактор)\n");
        exit(2);
    }
    $spreadsheetId = (string) $file->getId();
    fwrite(STDERR, "Создана таблица {$spreadsheetId}\n");
} else {
    fwrite(STDERR, "Обновляем таблицу {$spreadsheetId}\n");
}

$sheetTitle = 'Услуги';
$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$sheetId = (int) ($ss->getSheets()[0]->getProperties()->getSheetId() ?? 0);
$oldTitle = (string) ($ss->getSheets()[0]->getProperties()->getTitle() ?? 'Sheet1');

$sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google\Service\Sheets\BatchUpdateSpreadsheetRequest([
        'requests' => [
            new Google\Service\Sheets\Request([
                'updateSheetProperties' => [
                    'properties' => [
                        'sheetId' => $sheetId,
                        'title' => $sheetTitle,
                        'gridProperties' => [
                            'rowCount' => max(2000, count($values) + 20),
                            'columnCount' => max(14, count($values[0] ?? [])),
                        ],
                    ],
                    'fields' => 'title,gridProperties(rowCount,columnCount)',
                ],
            ]),
        ],
    ])
);

$quotedTitle = "'" . str_replace("'", "''", $sheetTitle) . "'";
if ($oldTitle !== $sheetTitle) {
    $quotedOld = "'" . str_replace("'", "''", $oldTitle) . "'";
    try {
        $sheets->spreadsheets_values->clear(
            $spreadsheetId,
            $quotedOld,
            new Google\Service\Sheets\ClearValuesRequest()
        );
    } catch (Google\Service\Exception) {
        /* ignore */
    }
}
$sheets->spreadsheets_values->clear(
    $spreadsheetId,
    $quotedTitle,
    new Google\Service\Sheets\ClearValuesRequest()
);

$chunkSize = 4000;
$total = count($values);
for ($offset = 0; $offset < $total; $offset += $chunkSize) {
    $chunk = array_slice($values, $offset, $chunkSize);
    $startRow = $offset + 1;
    $endRow = $offset + count($chunk);
    $colCount = count($chunk[0] ?? []);
    $endCol = chr(ord('A') + max(0, $colCount - 1));
    $range = "{$quotedTitle}!A{$startRow}:{$endCol}{$endRow}";
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        $range,
        new Google\Service\Sheets\ValueRange([
            'range' => $range,
            'majorDimension' => 'ROWS',
            'values' => $chunk,
        ]),
        ['valueInputOption' => 'RAW']
    );
    fwrite(STDERR, "Записано {$endRow} / {$total}\n");
}

$sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google\Service\Sheets\BatchUpdateSpreadsheetRequest([
        'requests' => [
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
                            'backgroundColor' => ['red' => 0.93, 'green' => 0.95, 'blue' => 0.97],
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
            new Google\Service\Sheets\Request([
                'setBasicFilter' => [
                    'filter' => [
                        'range' => [
                            'sheetId' => $sheetId,
                            'startRowIndex' => 0,
                            'endRowIndex' => $total,
                            'startColumnIndex' => 0,
                            'endColumnIndex' => count($values[0] ?? []),
                        ],
                    ],
                ],
            ]),
            new Google\Service\Sheets\Request([
                'setDataValidation' => [
                    'range' => [
                        'sheetId' => $sheetId,
                        'startRowIndex' => 1,
                        'endRowIndex' => $total,
                        'startColumnIndex' => 0,
                        'endColumnIndex' => 1,
                    ],
                    'rule' => [
                        'condition' => ['type' => 'BOOLEAN'],
                        'showCustomUi' => true,
                        'strict' => true,
                    ],
                ],
            ]),
            new Google\Service\Sheets\Request([
                'updateDimensionProperties' => [
                    'range' => [
                        'sheetId' => $sheetId,
                        'dimension' => 'COLUMNS',
                        'startIndex' => 0,
                        'endIndex' => 1,
                    ],
                    'properties' => ['pixelSize' => 72],
                    'fields' => 'pixelSize',
                ],
            ]),
            new Google\Service\Sheets\Request([
                'autoResizeDimensions' => [
                    'dimensions' => [
                        'sheetId' => $sheetId,
                        'dimension' => 'COLUMNS',
                        'startIndex' => 0,
                        'endIndex' => min(14, count($values[0] ?? [])),
                    ],
                ],
            ]),
        ],
    ])
);

$url = 'https://docs.google.com/spreadsheets/d/' . $spreadsheetId . '/edit#gid=' . $sheetId;
echo $url . "\n";
fwrite(STDERR, "Таблица: {$title}\n");
fwrite(STDERR, "Услуг: {$dataRows}\n");
fwrite(STDERR, "Папка: https://drive.google.com/drive/folders/{$folderId}\n");
fwrite(STDERR, "Готово.\n");
