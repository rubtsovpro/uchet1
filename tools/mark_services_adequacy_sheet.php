<?php
/**
 * Проверка услуг в листе выгрузки: дубли / неадекватные → столбцы N–O.
 *
 *   APPLY_GID=2015505500 php tools/mark_services_adequacy_sheet.php
 */
declare(strict_types=1);

$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$marksPath = __DIR__ . '/../tmp-services-marks.json';
$spreadsheetId = getenv('SHEET_ID') ?: '1T2FEXnWBeFhfKI-Y7_8tVfWFxFDRwTdZtPHH_NeCfn4';
$sheetGid = (int) (getenv('APPLY_GID') ?: '2015505500');

if (!is_file($credPath) || !is_file($autoload) || !is_file($marksPath)) {
    fwrite(STDERR, "Нет credentials / marks\n");
    exit(1);
}

/** @var array<string, array{ok:bool,comment:string,sku:string,name:string}> $marks */
$marks = json_decode((string) file_get_contents($marksPath), true);
if (!is_array($marks)) {
    fwrite(STDERR, "Битый marks JSON\n");
    exit(1);
}

require $autoload;

$client = new Google\Client();
$client->setApplicationName('Uchet1 services adequacy');
$client->setAuthConfig($credPath);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$sheetTitle = null;
foreach ($ss->getSheets() ?? [] as $sh) {
    $props = $sh->getProperties();
    if ($props && (int) $props->getSheetId() === $sheetGid) {
        $sheetTitle = (string) $props->getTitle();
        break;
    }
}
if ($sheetTitle === null) {
    fwrite(STDERR, "Лист gid={$sheetGid} не найден\n");
    exit(1);
}

$quoted = "'" . str_replace("'", "''", $sheetTitle) . "'";
fwrite(STDERR, "Читаем {$sheetTitle}…\n");

$resp = $sheets->spreadsheets_values->get($spreadsheetId, "{$quoted}!A:M");
$values = $resp->getValues() ?? [];
if (count($values) < 2) {
    fwrite(STDERR, "Пустой лист\n");
    exit(1);
}

$header = $values[0];
// ID в колонке M (index 12), Вид в D (3)
$out = [['Адекватность', 'Комментарий проверки']];
$bad = 0;
$svc = 0;
for ($i = 1; $i < count($values); $i++) {
    $row = $values[$i];
    $kind = trim((string) ($row[3] ?? ''));
    $id = trim((string) ($row[12] ?? ''));
    if ($kind !== 'Услуга') {
        $out[] = ['', ''];
        continue;
    }
    $svc++;
    $m = $marks[$id] ?? null;
    if ($m === null) {
        $out[] = ['да', ''];
        continue;
    }
    if (!empty($m['ok'])) {
        $out[] = ['да', ''];
    } else {
        $out[] = ['нет', (string) ($m['comment'] ?? '')];
        $bad++;
    }
}

$end = count($out);
$range = "{$quoted}!N1:O{$end}";
$sheets->spreadsheets_values->update(
    $spreadsheetId,
    $range,
    new Google\Service\Sheets\ValueRange([
        'range' => $range,
        'majorDimension' => 'ROWS',
        'values' => $out,
    ]),
    ['valueInputOption' => 'RAW']
);

$requests = [
    new Google\Service\Sheets\Request([
        'repeatCell' => [
            'range' => [
                'sheetId' => $sheetGid,
                'startRowIndex' => 0,
                'endRowIndex' => 1,
                'startColumnIndex' => 13,
                'endColumnIndex' => 15,
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
        'setDataValidation' => [
            'range' => [
                'sheetId' => $sheetGid,
                'startRowIndex' => 1,
                'endRowIndex' => $end,
                'startColumnIndex' => 13,
                'endColumnIndex' => 14,
            ],
            'rule' => [
                'condition' => [
                    'type' => 'ONE_OF_LIST',
                    'values' => [
                        ['userEnteredValue' => 'да'],
                        ['userEnteredValue' => 'нет'],
                    ],
                ],
                'showCustomUi' => true,
                'strict' => false,
            ],
        ],
    ]),
    // подсветка «нет»
    new Google\Service\Sheets\Request([
        'addConditionalFormatRule' => [
            'rule' => [
                'ranges' => [[
                    'sheetId' => $sheetGid,
                    'startRowIndex' => 1,
                    'endRowIndex' => $end,
                    'startColumnIndex' => 13,
                    'endColumnIndex' => 15,
                ]],
                'booleanRule' => [
                    'condition' => [
                        'type' => 'TEXT_EQ',
                        'values' => [['userEnteredValue' => 'нет']],
                    ],
                    'format' => [
                        'backgroundColor' => ['red' => 1.0, 'green' => 0.9, 'blue' => 0.9],
                    ],
                ],
            ],
            'index' => 0,
        ],
    ]),
    new Google\Service\Sheets\Request([
        'autoResizeDimensions' => [
            'dimensions' => [
                'sheetId' => $sheetGid,
                'dimension' => 'COLUMNS',
                'startIndex' => 13,
                'endIndex' => 15,
            ],
        ],
    ]),
    new Google\Service\Sheets\Request([
        'updateSheetProperties' => [
            'properties' => [
                'sheetId' => $sheetGid,
                'gridProperties' => [
                    'columnCount' => 16,
                ],
            ],
            'fields' => 'gridProperties.columnCount',
        ],
    ]),
];

$sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google\Service\Sheets\BatchUpdateSpreadsheetRequest(['requests' => $requests])
);

$url = "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$sheetGid}";
fwrite(STDERR, "Услуг: {$svc}, неадекватных: {$bad}\n");
echo $url . "\n";
