<?php
/**
 * Паки товар→услуги → лист в Google таблице.
 *
 *   php tools/export_packs_to_google_sheet.php [tmp-product-service-packs.json]
 */
declare(strict_types=1);

$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$dataPath = $argv[1] ?? (__DIR__ . '/../tmp-product-service-packs.json');
$spreadsheetId = getenv('SHEET_ID') ?: '1T2FEXnWBeFhfKI-Y7_8tVfWFxFDRwTdZtPHH_NeCfn4';
$tabTitle = 'Паки товар→услуги ' . date('Y-m-d H:i');

if (!is_file($credPath) || !is_file($autoload) || !is_file($dataPath)) {
    fwrite(STDERR, "Нет credentials/data\n");
    exit(1);
}

$data = json_decode((string) file_get_contents($dataPath), true);
if (!is_array($data)) {
    fwrite(STDERR, "Битый JSON\n");
    exit(1);
}

require $autoload;

$client = new Google\Client();
$client->setApplicationName('Uchet1 packs');
$client->setAuthConfig($credPath);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);

function writeSheet(
    Google\Service\Sheets $sheets,
    string $spreadsheetId,
    string $title,
    array $header,
    array $rows
): int {
    $n = count($rows) + 5;
    $cols = max(count($header), 8);
    $add = $sheets->spreadsheets->batchUpdate(
        $spreadsheetId,
        new Google\Service\Sheets\BatchUpdateSpreadsheetRequest([
            'requests' => [
                new Google\Service\Sheets\Request([
                    'addSheet' => [
                        'properties' => [
                            'title' => $title,
                            'gridProperties' => [
                                'rowCount' => max($n, 50),
                                'columnCount' => $cols,
                            ],
                        ],
                    ],
                ]),
            ],
        ])
    );
    $sheetId = (int) $add->getReplies()[0]->getAddSheet()->getProperties()->getSheetId();
    $sheetTitle = (string) $add->getReplies()[0]->getAddSheet()->getProperties()->getTitle();
    $quoted = "'" . str_replace("'", "''", $sheetTitle) . "'";

    $values = [$header];
    foreach ($rows as $r) {
        $values[] = $r;
    }
    $endCol = chr(ord('A') + count($header) - 1);
    $total = count($values);
    $chunk = 3000;
    for ($off = 0; $off < $total; $off += $chunk) {
        $part = array_slice($values, $off, $chunk);
        $a = $off + 1;
        $b = $off + count($part);
        $range = "{$quoted}!A{$a}:{$endCol}{$b}";
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
                                'endColumnIndex' => count($header),
                            ],
                        ],
                    ],
                ]),
            ],
        ])
    );
    return $sheetId;
}

$packRows = [];
foreach ($data['pack_rows'] ?? [] as $r) {
    $packRows[] = [
        (string) ($r['pack_no'] ?? ''),
        (string) ($r['pack_title'] ?? ''),
        (string) ($r['support_deals'] ?? ''),
        (string) ($r['if_products_examples'] ?? ''),
        (string) ($r['role'] ?? ''),
        (string) ($r['then_service_sku'] ?? ''),
        (string) ($r['then_service_name'] ?? ''),
        (string) ($r['confidence_pct'] ?? ''),
        (string) ($r['docs'] ?? ''),
    ];
}

$prodRows = [];
foreach ($data['packs_product_to_services'] ?? [] as $r) {
    $prodRows[] = [
        (string) ($r['product_sku'] ?? ''),
        (string) ($r['product_name'] ?? ''),
        (string) ($r['family'] ?? ''),
        (string) ($r['consumable'] ?? ''),
        (string) ($r['category'] ?? ''),
        (string) ($r['deals'] ?? ''),
        (string) ($r['top_service_sku'] ?? ''),
        (string) ($r['top_service_name'] ?? ''),
        (string) ($r['confidence'] ?? ''),
        (string) ($r['services_text'] ?? ''),
    ];
}

$pairRows = [];
foreach ($data['top_pairs'] ?? [] as $r) {
    $pairRows[] = [
        (string) ($r['docs_together'] ?? ''),
        (string) ($r['product_sku'] ?? ''),
        (string) ($r['product_name'] ?? ''),
        (string) ($r['consumable'] ?? ''),
        (string) ($r['product_family'] ?? ''),
        (string) ($r['service_sku'] ?? ''),
        (string) ($r['service_name'] ?? ''),
        (string) ($r['category'] ?? ''),
    ];
}

$consRows = [];
foreach ($data['consumable_pairs'] ?? [] as $r) {
    $consRows[] = [
        (string) ($r['docs_together'] ?? ''),
        (string) ($r['product_sku'] ?? ''),
        (string) ($r['product_name'] ?? ''),
        (string) ($r['service_sku'] ?? ''),
        (string) ($r['service_name'] ?? ''),
        (string) ($r['category'] ?? ''),
    ];
}

fwrite(STDERR, 'mixed_deals=' . ($data['mixed_deals'] ?? '?') . "\n");

$id1 = writeSheet(
    $sheets,
    $spreadsheetId,
    $tabTitle,
    [
        '№ пака',
        'Пак (если такие товары)',
        'Сделок с семейством',
        'Примеры товаров',
        'Роль услуги',
        'Артикул услуги',
        'Тогда услуга',
        '% вместе',
        'Раз совместно',
    ],
    $packRows
);

$id2 = writeSheet(
    $sheets,
    $spreadsheetId,
    'Паки по SKU ' . date('Y-m-d H:i'),
    [
        'Артикул товара',
        'Товар',
        'Семейство',
        'Расходник',
        'Категория',
        'Сделок',
        'Топ услуга SKU',
        'Топ услуга',
        '%',
        'Все услуги в паке',
    ],
    $prodRows
);

$id3 = writeSheet(
    $sheets,
    $spreadsheetId,
    'Пары товар+услуга ' . date('Y-m-d H:i'),
    [
        'Раз вместе',
        'Артикул товара',
        'Товар',
        'Расходник',
        'Семейство',
        'Артикул услуги',
        'Услуга',
        'Категория товара',
    ],
    $pairRows
);

$id4 = writeSheet(
    $sheets,
    $spreadsheetId,
    'Расходники→услуги ' . date('Y-m-d H:i'),
    [
        'Раз вместе',
        'Артикул',
        'Расходник/сопутств.',
        'Артикул услуги',
        'Услуга',
        'Категория',
    ],
    $consRows
);

$url = "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$id1}";
echo $url . "\n";
file_put_contents(
    __DIR__ . '/../tmp-packs-sheet-url.txt',
    $url . "\npacks={$id1}\nsku={$id2}\npairs={$id3}\ncons={$id4}\n"
);
fwrite(STDERR, "Готово.\n");
