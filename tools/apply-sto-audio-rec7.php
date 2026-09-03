<?php
/**
 * Запись 7: серые позиции №55, 56, 57, 60, 61, 68, 76, 77.
 */
declare(strict_types=1);

$credPath = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$spreadsheetId = '1_nHyQXVhqdA3wH0193QNCd1uwsJmnzz_iocu2ydXllc';
$sheetTitle = 'Инв. СТО Москва 26.08';

require $autoload;

/** @return array<int, array{fact:string, cell:string}> */
function audioRowsRec7(): array
{
  return [
    55 => ['fact' => '5', 'cell' => 'A10.3'],
    56 => ['fact' => '2', 'cell' => 'СТО'],
    57 => ['fact' => '1', 'cell' => 'полка СТО'],
    60 => ['fact' => '9', 'cell' => 'A8.1'],
    61 => ['fact' => '14', 'cell' => 'A12.3'],
    68 => ['fact' => '1', 'cell' => 'A10.1'],
    76 => ['fact' => '2', 'cell' => 'A2.2'],
    77 => ['fact' => '2', 'cell' => 'A5.1'],
  ];
}

$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS]);
$sheets = new Google_Service_Sheets($client);
$escTitle = str_replace("'", "''", $sheetTitle);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$sheetId = null;
foreach ($ss->getSheets() as $sh) {
  if ($sh->getProperties()->getTitle() === $sheetTitle) {
    $sheetId = (int) $sh->getProperties()->getSheetId();
    break;
  }
}
if ($sheetId === null) {
  fwrite(STDERR, "Лист «{$sheetTitle}» не найден\n");
  exit(1);
}

$audio = audioRowsRec7();
$data = [];
foreach ($audio as $num => $row) {
  $sheetRow = $num + 2;
  $data[] = new Google_Service_Sheets_ValueRange([
    'range' => "'{$escTitle}'!G{$sheetRow}:I{$sheetRow}",
    'values' => [[$row['fact'], $row['cell'], '']],
  ]);
}

$data[] = new Google_Service_Sheets_ValueRange([
  'range' => "'{$escTitle}'!A106:B108",
  'values' => [
    ['Сверка аудио ч.5 (запись 7)'],
    ['Занесено', '№55, 56, 57, 60, 61, 68, 76, 77'],
    ['№57', 'полка СТО · 1 шт'],
  ],
]);

$sheets->spreadsheets_values->batchUpdate(
  $spreadsheetId,
  new Google_Service_Sheets_BatchUpdateValuesRequest([
    'valueInputOption' => 'USER_ENTERED',
    'data' => $data,
  ])
);

$white = ['red' => 1.0, 'green' => 1.0, 'blue' => 1.0];
$formatReqs = [];
foreach (array_keys($audio) as $num) {
  $formatReqs[] = [
    'repeatCell' => [
      'range' => [
        'sheetId' => $sheetId,
        'startRowIndex' => $num + 1,
        'endRowIndex' => $num + 2,
        'startColumnIndex' => 0,
        'endColumnIndex' => 9,
      ],
      'cell' => ['userEnteredFormat' => ['backgroundColor' => $white]],
      'fields' => 'userEnteredFormat.backgroundColor',
    ],
  ];
}

$sheets->spreadsheets->batchUpdate(
  $spreadsheetId,
  new Google_Service_Sheets_BatchUpdateSpreadsheetRequest(['requests' => $formatReqs])
);

echo "OK: запись 7 · " . count($audio) . " поз.\n";
echo "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$sheetId}\n";
