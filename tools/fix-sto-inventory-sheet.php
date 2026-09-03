<?php
/**
 * Привести лист «Инв. СТО Москва 26.08» к компактному виду + столбец «Ячейка».
 * Не пересоздаёт лист — только перезаписывает диапазон.
 */
declare(strict_types=1);

require __DIR__ . '/push-sto-inventory-sheet.php';

$credPath = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$spreadsheetId = '1_nHyQXVhqdA3wH0193QNCd1uwsJmnzz_iocu2ydXllc';
$sheetTitle = 'Инв. СТО Москва 26.08';

require $autoload;

$rows = stoInventoryRows();
$data = [];
foreach ($rows as $r) {
  $data[] = [
    $r[0],
    $r[1],
    $r[2],
    $r[3],
    $r[4],
    $r[5],
    $r[6],
    $r[8],
  ];
}

$values = [
  ['', '', '', '', '', '=SUM(F3:F' . (2 + count($data)) . ')', '=SUM(G3:G' . (2 + count($data)) . ')', ''],
  ['№', 'Код', 'Артикул', 'Номенклатура', 'Категория', 'Кол-во (печать)', 'Кол-во (факт)', 'Ячейка'],
  ...$data,
];

$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS]);
$sheets = new Google_Service_Sheets($client);

$range = "'" . str_replace("'", "''", $sheetTitle) . "'!A1:H" . count($values);
$body = new Google_Service_Sheets_ValueRange([
  'range' => $range,
  'majorDimension' => 'ROWS',
  'values' => $values,
]);
$sheets->spreadsheets_values->update(
  $spreadsheetId,
  $range,
  $body,
  ['valueInputOption' => 'USER_ENTERED']
);

// Очистить хвост старых колонок/строк
$clearFrom = count($values) + 1;
$sheets->spreadsheets_values->clear(
  $spreadsheetId,
  "'" . str_replace("'", "''", $sheetTitle) . "'!A{$clearFrom}:Z500",
  new Google_Service_Sheets_ClearValuesRequest()
);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$sheetId = null;
foreach ($ss->getSheets() as $sh) {
  if ($sh->getProperties()->getTitle() === $sheetTitle) {
    $sheetId = (int) $sh->getProperties()->getSheetId();
    break;
  }
}
if ($sheetId !== null) {
  $sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google_Service_Sheets_BatchUpdateSpreadsheetRequest([
      'requests' => [
        [
          'updateSheetProperties' => [
            'properties' => [
              'sheetId' => $sheetId,
              'gridProperties' => ['frozenRowCount' => 2],
            ],
            'fields' => 'gridProperties.frozenRowCount',
          ],
        ],
        [
          'repeatCell' => [
            'range' => [
              'sheetId' => $sheetId,
              'startRowIndex' => 1,
              'endRowIndex' => 2,
              'startColumnIndex' => 0,
              'endColumnIndex' => 8,
            ],
            'cell' => [
              'userEnteredFormat' => [
                'textFormat' => ['bold' => true],
                'backgroundColor' => ['red' => 0.9, 'green' => 0.93, 'blue' => 0.98],
              ],
            ],
            'fields' => 'userEnteredFormat(textFormat,backgroundColor)',
          ],
        ],
      ],
    ])
  );
}

$gid = $sheetId ?? '';
echo "OK: {$sheetTitle}\n";
echo "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$gid}\n";
echo 'Строк: ' . count($data) . "\n";
