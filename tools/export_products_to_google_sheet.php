<?php
/**
 * Выгрузка номенклатуры с категориями в Google Таблицу (Sheets API, SA).
 *
 * SA не может создавать новые файлы (квота Drive = 0) — добавляем лист
 * в уже расшаренную таблицу «Номенклатура для ОП» (или SHEET_ID).
 *
 * Usage:
 *   php tools/export_products_to_google_sheet.php [path/to/products.json]
 *   SHEET_ID=... php tools/export_products_to_google_sheet.php
 *   # только селекты на уже существующий лист:
 *   APPLY_GID=2015505500 php tools/export_products_to_google_sheet.php --dropdowns-only
 *
 * JSON: массив {sku,code,name,kind,brand,unit,barcode,category,category_path,...}
 */
declare(strict_types=1);

$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$dropdownsOnly = in_array('--dropdowns-only', $argv, true);
$dataPath = null;
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--dropdowns-only' || str_starts_with($arg, '-')) {
        continue;
    }
    $dataPath = $arg;
    break;
}
$dataPath = $dataPath ?: (__DIR__ . '/../tmp-products-cats.json');
/** Хост-таблица, куда SA уже имеет доступ редактора */
$spreadsheetId = getenv('SHEET_ID') ?: '1T2FEXnWBeFhfKI-Y7_8tVfWFxFDRwTdZtPHH_NeCfn4';
$tabTitle = 'Учёт№1 категории ' . date('Y-m-d H:i');
$applyGid = getenv('APPLY_GID') !== false && getenv('APPLY_GID') !== ''
    ? (int) getenv('APPLY_GID')
    : 0;

if (!is_file($credPath) || !is_file($autoload)) {
    fwrite(STDERR, "Нет credentials/autoload Google API\n");
    exit(1);
}
if (!is_file($dataPath)) {
    fwrite(STDERR, "Нет файла данных: {$dataPath}\n");
    exit(1);
}

$raw = file_get_contents($dataPath);
$rows = json_decode((string) $raw, true);
if (!is_array($rows) || !$rows) {
    fwrite(STDERR, "Пустой или битый JSON\n");
    exit(1);
}

require $autoload;

$client = new Google\Client();
$client->setApplicationName('Uchet1 products → Sheets');
$client->setAuthConfig($credPath);
$client->setScopes([
    Google\Service\Sheets::SPREADSHEETS,
    Google\Service\Drive::DRIVE,
]);

$sheets = new Google\Service\Sheets($client);

/**
 * Уникальные значения колонок для выпадающих списков (без пустых, сортировка).
 *
 * @param list<array<string,mixed>> $rows
 * @return array<string, list<string>>
 */
function uchet1_unique_lists(array $rows): array
{
    $keys = ['kind', 'brand', 'unit', 'category', 'category_path', 'category_root', 'category_sub', 'active'];
    $acc = array_fill_keys($keys, []);
    foreach ($rows as $r) {
        if (!is_array($r)) {
            continue;
        }
        foreach ($keys as $k) {
            $v = trim((string) ($r[$k] ?? ''));
            if ($v !== '') {
                $acc[$k][$v] = true;
            }
        }
    }
    $out = [];
    foreach ($acc as $k => $map) {
        $list = array_keys($map);
        sort($list, SORT_STRING);
        $out[$k] = $list;
    }
    return $out;
}

/**
 * Служебный лист со списками + data validation на колонках данных.
 *
 * @param array<string, list<string>> $lists
 */
function uchet1_apply_dropdowns(
    Google\Service\Sheets $sheets,
    string $spreadsheetId,
    int $dataSheetId,
    int $dataRowCount,
    array $lists
): void {
    // Колонки данных (0-based): D Вид, E Бренд, F Ед., H Категория, I Путь, J Корень, K Подкатегория, L Активен
    $colMap = [
        'kind' => 3,
        'brand' => 4,
        'unit' => 5,
        'category' => 7,
        'category_path' => 8,
        'category_root' => 9,
        'category_sub' => 10,
        'active' => 11,
    ];
    $listCols = [
        'kind' => 0,
        'brand' => 1,
        'unit' => 2,
        'category' => 3,
        'category_path' => 4,
        'category_root' => 5,
        'category_sub' => 6,
        'active' => 7,
    ];
    $listHeaders = [
        'Вид', 'Бренд', 'Ед.', 'Категория', 'Путь категории', 'Корень', 'Подкатегория', 'Активен',
    ];
    $listTitle = '_uchet1_lists';

    $ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
    $listSheetId = null;
    foreach ($ss->getSheets() ?? [] as $sh) {
        $props = $sh->getProperties();
        if ($props && (string) $props->getTitle() === $listTitle) {
            $listSheetId = (int) $props->getSheetId();
            break;
        }
    }

    $requests = [];
    if ($listSheetId === null) {
        $add = $sheets->spreadsheets->batchUpdate(
            $spreadsheetId,
            new Google\Service\Sheets\BatchUpdateSpreadsheetRequest([
                'requests' => [
                    new Google\Service\Sheets\Request([
                        'addSheet' => [
                            'properties' => [
                                'title' => $listTitle,
                                'hidden' => true,
                                'gridProperties' => [
                                    'rowCount' => 500,
                                    'columnCount' => 8,
                                ],
                            ],
                        ],
                    ]),
                ],
            ])
        );
        $listSheetId = (int) ($add->getReplies()[0]->getAddSheet()->getProperties()->getSheetId());
    } else {
        $requests[] = new Google\Service\Sheets\Request([
            'updateSheetProperties' => [
                'properties' => [
                    'sheetId' => $listSheetId,
                    'hidden' => true,
                ],
                'fields' => 'hidden',
            ],
        ]);
        // очистим старые значения
        $sheets->spreadsheets_values->clear(
            $spreadsheetId,
            "'{$listTitle}'!A:H",
            new Google\Service\Sheets\ClearValuesRequest()
        );
    }

    $maxLen = 1;
    foreach ($lists as $list) {
        $maxLen = max($maxLen, count($list));
    }
    $listValues = [$listHeaders];
    for ($i = 0; $i < $maxLen; $i++) {
        $row = [];
        foreach (array_keys($listCols) as $key) {
            $row[] = $lists[$key][$i] ?? '';
        }
        $listValues[] = $row;
    }

    $quotedList = "'" . str_replace("'", "''", $listTitle) . "'";
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        "{$quotedList}!A1:H" . count($listValues),
        new Google\Service\Sheets\ValueRange([
            'range' => "{$quotedList}!A1:H" . count($listValues),
            'majorDimension' => 'ROWS',
            'values' => $listValues,
        ]),
        ['valueInputOption' => 'RAW']
    );

    $endRow = max(2, $dataRowCount); // включая заголовок: данные до endRow (exclusive в API = dataRowCount если header+data)
    // dataRowCount = число строк values (header + data) → endRowIndex = dataRowCount
    foreach ($colMap as $key => $dataCol) {
        $listCol = $listCols[$key];
        $n = count($lists[$key]);
        if ($n < 1) {
            continue;
        }
        $colLetter = chr(ord('A') + $listCol);
        // Sheets API: ONE_OF_RANGE требует формулу вида =Sheet!$A$2:$A$10
        $rangeA1 = "={$quotedList}!\${$colLetter}\$2:\${$colLetter}\$" . ($n + 1);
        $requests[] = new Google\Service\Sheets\Request([
            'setDataValidation' => [
                'range' => [
                    'sheetId' => $dataSheetId,
                    'startRowIndex' => 1,
                    'endRowIndex' => $endRow,
                    'startColumnIndex' => $dataCol,
                    'endColumnIndex' => $dataCol + 1,
                ],
                'rule' => [
                    'condition' => [
                        'type' => 'ONE_OF_RANGE',
                        'values' => [
                            ['userEnteredValue' => $rangeA1],
                        ],
                    ],
                    'showCustomUi' => true,
                    'strict' => false,
                    'inputMessage' => 'Выберите из списка',
                ],
            ],
        ]);
    }

    if ($requests) {
        $sheets->spreadsheets->batchUpdate(
            $spreadsheetId,
            new Google\Service\Sheets\BatchUpdateSpreadsheetRequest(['requests' => $requests])
        );
    }
    fwrite(STDERR, "Селекты: вид/бренд/ед./категории/корень/подкатегория/активен\n");
}

$lists = uchet1_unique_lists($rows);

if ($dropdownsOnly) {
    if ($applyGid <= 0) {
        fwrite(STDERR, "Для --dropdowns-only укажите APPLY_GID=...\n");
        exit(1);
    }
    $dataRowCount = count($rows) + 1; // header + products
    fwrite(STDERR, "Ставим селекты на лист gid={$applyGid}…\n");
    uchet1_apply_dropdowns($sheets, $spreadsheetId, $applyGid, $dataRowCount, $lists);
    $url = 'https://docs.google.com/spreadsheets/d/' . $spreadsheetId . '/edit#gid=' . $applyGid;
    echo $url . "\n";
    fwrite(STDERR, "Готово.\n");
    exit(0);
}

fwrite(STDERR, 'Пишем ' . count($rows) . " строк в таблицу {$spreadsheetId}…\n");

// Новый лист (не трогаем существующие вкладки)
$add = $sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google\Service\Sheets\BatchUpdateSpreadsheetRequest([
        'requests' => [
            new Google\Service\Sheets\Request([
                'addSheet' => [
                    'properties' => [
                        'title' => $tabTitle,
                        'gridProperties' => [
                            'rowCount' => count($rows) + 10,
                            'columnCount' => 16,
                        ],
                    ],
                ],
            ]),
        ],
    ])
);
$sheetId = (int) ($add->getReplies()[0]->getAddSheet()->getProperties()->getSheetId());
$sheetTitle = (string) $add->getReplies()[0]->getAddSheet()->getProperties()->getTitle();
fwrite(STDERR, "Лист: {$sheetTitle} (id={$sheetId})\n");

$header = [
    'Артикул',
    'Код',
    'Название',
    'Вид',
    'Бренд',
    'Ед.',
    'Штрихкод',
    'Категория',
    'Путь категории',
    'Корень',
    'Подкатегория',
    'Активен',
    'ID',
];

$values = [$header];
foreach ($rows as $r) {
    if (!is_array($r)) {
        continue;
    }
    $values[] = [
        (string) ($r['sku'] ?? ''),
        (string) ($r['code'] ?? ''),
        (string) ($r['name'] ?? ''),
        (string) ($r['kind'] ?? ''),
        (string) ($r['brand'] ?? ''),
        (string) ($r['unit'] ?? ''),
        (string) ($r['barcode'] ?? ''),
        (string) ($r['category'] ?? ''),
        (string) ($r['category_path'] ?? ''),
        (string) ($r['category_root'] ?? ''),
        (string) ($r['category_sub'] ?? ''),
        (string) ($r['active'] ?? ''),
        (string) ($r['id'] ?? ''),
    ];
}

$chunkSize = 4000;
$total = count($values);
$quotedTitle = "'" . str_replace("'", "''", $sheetTitle) . "'";
for ($offset = 0; $offset < $total; $offset += $chunkSize) {
    $chunk = array_slice($values, $offset, $chunkSize);
    $startRow = $offset + 1;
    $endRow = $offset + count($chunk);
    $range = "{$quotedTitle}!A{$startRow}:M{$endRow}";
    $body = new Google\Service\Sheets\ValueRange([
        'range' => $range,
        'majorDimension' => 'ROWS',
        'values' => $chunk,
    ]);
    $sheets->spreadsheets_values->update($spreadsheetId, $range, $body, [
        'valueInputOption' => 'RAW',
    ]);
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
                            'endColumnIndex' => 13,
                        ],
                    ],
                ],
            ]),
            new Google\Service\Sheets\Request([
                'autoResizeDimensions' => [
                    'dimensions' => [
                        'sheetId' => $sheetId,
                        'dimension' => 'COLUMNS',
                        'startIndex' => 0,
                        'endIndex' => 9,
                    ],
                ],
            ]),
        ],
    ])
);

uchet1_apply_dropdowns($sheets, $spreadsheetId, $sheetId, $total, $lists);

$url = 'https://docs.google.com/spreadsheets/d/' . $spreadsheetId . '/edit#gid=' . $sheetId;
echo $url . "\n";
file_put_contents(
    __DIR__ . '/../tmp-products-sheet-url.txt',
    $url . "\n" . $tabTitle . "\n" . count($rows) . " products\n"
);
fwrite(STDERR, "Готово.\n");
