<?php
/**
 * Починить лист после съезда колонок: только A–H, «Ячейка» в H, очистить I:Z.
 */
declare(strict_types=1);

require __DIR__ . '/push-sto-inventory-sheet.php';

$credPath = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$spreadsheetId = '1_nHyQXVhqdA3wH0193QNCd1uwsJmnzz_iocu2ydXllc';
$sheetTitle = 'Инв. СТО Москва 26.08';

require $autoload;

function isValidCell(string $s): bool
{
  $s = trim($s);
  if ($s === '') {
    return false;
  }
  static $reject = [
    'Ячейка / полка',
    'Примечание OCR',
    '#ERROR!',
    '#ERROR',
  ];
  if (in_array($s, $reject, true)) {
    return false;
  }
  if (preg_match('/^(зачёркнуто|исправлено|\\+|\\-|\\✓)/u', $s)) {
    return false;
  }
  if (mb_strlen($s) > 36) {
    return false;
  }
  return true;
}

$ocr = [];
foreach (stoInventoryRows() as $r) {
  $ocr[(int) $r[0]] = $r;
}

$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS]);
$sheets = new Google_Service_Sheets($client);

$cur = $sheets->spreadsheets_values->get(
  $spreadsheetId,
  "'" . str_replace("'", "''", $sheetTitle) . "'!A1:H120"
)->getValues() ?: [];

$data = [];
foreach ($cur as $i => $r) {
  if ($i < 2) {
    continue;
  }
  $num = (int) ($r[0] ?? 0);
  if ($num <= 0) {
    continue;
  }
  $base = $ocr[$num] ?? null;
  $cell = isValidCell($r[7] ?? '') ? trim($r[7]) : trim($base[8] ?? '');
  $data[] = [
    $num,
    $r[1] ?? ($base[1] ?? ''),
    $r[2] ?? ($base[2] ?? ''),
    $r[3] ?? ($base[3] ?? ''),
    $r[4] ?? ($base[4] ?? ''),
    $r[5] ?? ($base[5] ?? ''),
    $r[6] ?? ($base[6] ?? ''),
    $cell,
  ];
}

$last = 2 + count($data);
$values = [
  ['', '', '', '', '', "=SUM(F3:F{$last})", "=SUM(G3:G{$last})", ''],
  ['№', 'Код', 'Артикул', 'Номенклатура', 'Категория', 'Кол-во (печать)', 'Кол-во (факт)', 'Ячейка'],
  ...$data,
];

$escTitle = str_replace("'", "''", $sheetTitle);
$sheets->spreadsheets_values->clear(
  $spreadsheetId,
  "'{$escTitle}'!A1:Z500",
  new Google_Service_Sheets_ClearValuesRequest()
);

$range = "'{$escTitle}'!A1:H" . count($values);
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

$filled = 0;
foreach ($data as $r) {
  if (trim($r[7]) !== '') {
    $filled++;
  }
}

echo "OK: {$sheetTitle}\n";
echo "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$sheetId}\n";
echo 'Строк: ' . count($data) . ", ячеек заполнено: {$filled}\n";
