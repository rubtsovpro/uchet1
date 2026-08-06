<?php
/**
 * Вкладка «Товары»: вся номенклатура (не услуги) + оставить/удалить (дубли и мусор).
 *
 *   scp bank-vps:/tmp/products-export.json /tmp/
 *   php tools/export_products_dedupe_to_google_sheet.php /tmp/products-export.json
 */
declare(strict_types=1);

$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$dataPath = $argv[1] ?? (__DIR__ . '/../tmp-products-export.json');
$spreadsheetId = getenv('SHEET_ID') ?: '1T2FEXnWBeFhfKI-Y7_8tVfWFxFDRwTdZtPHH_NeCfn4';
$tabTitle = 'Товары';

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
$client->setApplicationName('Uchet1 products dedupe → Sheets');
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

$reqs = [];
if ($reuseId === null) {
    $reqs[] = new Google\Service\Sheets\Request([
        'addSheet' => [
            'properties' => [
                'title' => $tabTitle,
                'gridProperties' => [
                    'rowCount' => max(200, count($rows) + 20),
                    'columnCount' => 14,
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
                    'rowCount' => max(200, count($rows) + 20),
                    'columnCount' => 14,
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
    "{$quoted}!A:N",
    new Google\Service\Sheets\ClearValuesRequest()
);

$header = [
    '№',
    '№ дубля',
    'Артикул',
    'Код',
    'Название',
    'Категория',
    'Рекомендация',
    'Почему',
    'Тип дубля',
    'Заказов',
    'Строк',
    'Остаток',
    'Активен',
    'id',
];
$values = [$header];
$keepN = 0;
$delN = 0;
$dupN = 0;
$n = 0;
foreach ($rows as $r) {
    if (!is_array($r)) {
        continue;
    }
    $n++;
    $rec = trim((string) ($r['recommendation'] ?? ''));
    if ($rec !== 'удалить' && $rec !== 'оставить') {
        $rec = 'проверить';
    }
    if ($rec === 'оставить') {
        $keepN++;
    } elseif ($rec === 'удалить') {
        $delN++;
    }
    $dupNo = $r['dup_no'] ?? '';
    if ($dupNo !== '' && $dupNo !== null && (int) $dupNo > 0) {
        $dupN++;
        $dupNo = (int) $dupNo;
    } else {
        $dupNo = '';
    }
    $values[] = [
        $n,
        $dupNo,
        (string) ($r['article'] ?? $r['barcode'] ?? ''),
        (string) ($r['code'] ?? $r['sku'] ?? ''),
        (string) ($r['name'] ?? ''),
        (string) ($r['category'] ?? ''),
        $rec,
        (string) ($r['reason'] ?? ''),
        (string) ($r['dup_kind'] ?? ''),
        (int) ($r['deals'] ?? 0),
        (int) ($r['lines'] ?? 0),
        (float) ($r['stock'] ?? 0),
        !empty($r['is_active']) ? 'да' : 'нет',
        (string) ($r['id'] ?? ''),
    ];
}

fwrite(STDERR, "Пишем {$n} строк (оставить {$keepN}, удалить {$delN}, дублей {$dupN})…\n");

// Пакетная запись (лимит размера запроса)
$chunk = 4000;
for ($offset = 0; $offset < count($values); $offset += $chunk) {
    $part = array_slice($values, $offset, $chunk);
    $startRow = $offset + 1;
    $endRow = $offset + count($part);
    $range = "{$quoted}!A{$startRow}:N{$endRow}";
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        $range,
        new Google\Service\Sheets\ValueRange([
            'range' => $range,
            'majorDimension' => 'ROWS',
            'values' => $part,
        ]),
        ['valueInputOption' => 'RAW']
    );
    fwrite(STDERR, "  …строки {$startRow}–{$endRow}\n");
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
                    'backgroundColor' => ['red' => 0.9, 'green' => 0.95, 'blue' => 0.93],
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
    new Google\Service\Sheets\Request([
        'setBasicFilter' => [
            'filter' => [
                'range' => [
                    'sheetId' => $reuseId,
                    'startRowIndex' => 0,
                    'endRowIndex' => count($values),
                    'startColumnIndex' => 0,
                    'endColumnIndex' => 14,
                ],
            ],
        ],
    ]),
    // Условное форматирование: Рекомендация (колонка G = index 6)
    new Google\Service\Sheets\Request([
        'addConditionalFormatRule' => [
            'rule' => [
                'ranges' => [[
                    'sheetId' => $reuseId,
                    'startRowIndex' => 1,
                    'endRowIndex' => count($values),
                    'startColumnIndex' => 6,
                    'endColumnIndex' => 7,
                ]],
                'booleanRule' => [
                    'condition' => [
                        'type' => 'TEXT_EQ',
                        'values' => [['userEnteredValue' => 'удалить']],
                    ],
                    'format' => [
                        'backgroundColor' => ['red' => 1.0, 'green' => 0.88, 'blue' => 0.88],
                        'textFormat' => [
                            'bold' => true,
                            'foregroundColor' => ['red' => 0.55, 'green' => 0.05, 'blue' => 0.05],
                        ],
                    ],
                ],
            ],
            'index' => 0,
        ],
    ]),
    new Google\Service\Sheets\Request([
        'addConditionalFormatRule' => [
            'rule' => [
                'ranges' => [[
                    'sheetId' => $reuseId,
                    'startRowIndex' => 1,
                    'endRowIndex' => count($values),
                    'startColumnIndex' => 6,
                    'endColumnIndex' => 7,
                ]],
                'booleanRule' => [
                    'condition' => [
                        'type' => 'TEXT_EQ',
                        'values' => [['userEnteredValue' => 'оставить']],
                    ],
                    'format' => [
                        'backgroundColor' => ['red' => 0.88, 'green' => 0.96, 'blue' => 0.9],
                        'textFormat' => [
                            'bold' => true,
                            'foregroundColor' => ['red' => 0.05, 'green' => 0.4, 'blue' => 0.2],
                        ],
                    ],
                ],
            ],
            'index' => 0,
        ],
    ]),
    // № дубля (колонка B) — подсветка если не пусто
    new Google\Service\Sheets\Request([
        'addConditionalFormatRule' => [
            'rule' => [
                'ranges' => [[
                    'sheetId' => $reuseId,
                    'startRowIndex' => 1,
                    'endRowIndex' => count($values),
                    'startColumnIndex' => 1,
                    'endColumnIndex' => 2,
                ]],
                'booleanRule' => [
                    'condition' => [
                        'type' => 'NUMBER_GREATER',
                        'values' => [['userEnteredValue' => '0']],
                    ],
                    'format' => [
                        'backgroundColor' => ['red' => 1.0, 'green' => 0.95, 'blue' => 0.8],
                        'textFormat' => ['bold' => true],
                    ],
                ],
            ],
            'index' => 0,
        ],
    ]),
    new Google\Service\Sheets\Request([
        'autoResizeDimensions' => [
            'dimensions' => [
                'sheetId' => $reuseId,
                'dimension' => 'COLUMNS',
                'startIndex' => 0,
                'endIndex' => 9,
            ],
        ],
    ]),
];

$sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google\Service\Sheets\BatchUpdateSpreadsheetRequest(['requests' => $formatReqs])
);

$url = "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$reuseId}";
echo "OK tab=«{$tabTitle}» rows={$n} keep={$keepN} del={$delN} dups={$dupN}\n{$url}\n";
