<?php
declare(strict_types=1);

$credPath = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$spreadsheetId = '1_nHyQXVhqdA3wH0193QNCd1uwsJmnzz_iocu2ydXllc';
$sheetTitle = 'Инв. СТО Москва 26.08';

require $autoload;

/** @return array<int, array{fact:string, cell:string, note?:string}> */
function audioRows27to52(): array
{
  return [
    27 => ['fact' => '0', 'cell' => ''],
    28 => ['fact' => '0', 'cell' => ''],
    29 => ['fact' => '1', 'cell' => 'полка СТО'],
    30 => ['fact' => '3', 'cell' => 'A7.3'],
    31 => ['fact' => '1', 'cell' => 'полка СТО'],
    32 => ['fact' => '1', 'cell' => 'полка СТО ?'],
    33 => ['fact' => '1', 'cell' => 'полка СТО ?'],
    34 => ['fact' => '1', 'cell' => ''],
    35 => ['fact' => '0', 'cell' => ''],
    36 => ['fact' => '0', 'cell' => ''],
    37 => ['fact' => '1', 'cell' => 'полка СТО'],
    38 => ['fact' => '1', 'cell' => 'A11.3'],
    39 => ['fact' => '5', 'cell' => 'A11.3'],
    40 => ['fact' => '1', 'cell' => ''],
    41 => ['fact' => '0', 'cell' => ''],
    42 => ['fact' => '0', 'cell' => ''],
    43 => ['fact' => '0', 'cell' => ''],
    44 => ['fact' => '9', 'cell' => 'П5'],
    45 => ['fact' => '1', 'cell' => 'полка СТО'],
    46 => ['fact' => '5', 'cell' => 'A6.3'],
    47 => ['fact' => '2', 'cell' => 'полка СТО'],
    48 => ['fact' => '4', 'cell' => 'A3.4'],
    49 => ['fact' => '0', 'cell' => ''],
    50 => ['fact' => '0', 'cell' => ''],
    51 => ['fact' => '0', 'cell' => ''],
    52 => ['fact' => '2', 'cell' => 'полка СТО', 'note' => '−1 расход сегодня'],
  ];
}

$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS]);
$sheets = new Google_Service_Sheets($client);
$escTitle = str_replace("'", "''", $sheetTitle);

$audio = audioRows27to52();
$data = [];
foreach ($audio as $num => $row) {
  $sheetRow = $num + 2;
  $data[] = new Google_Service_Sheets_ValueRange([
    'range' => "'{$escTitle}'!G{$sheetRow}:I{$sheetRow}",
    'values' => [[$row['fact'], $row['cell'], $row['note'] ?? '']],
  ]);
}

$data[] = new Google_Service_Sheets_ValueRange([
  'range' => "'{$escTitle}'!I2",
  'values' => [['Примечание']],
]);

$data[] = new Google_Service_Sheets_ValueRange([
  'range' => "'{$escTitle}'!A92:B96",
  'values' => [
    ['Сверка аудио ч.2 (26.08)'],
    ['Занесено из записи', '№27–52'],
    ['Остановился', 'перед №53'],
    ['№52', '2 шт · полка СТО · −1 расход сегодня'],
  ],
]);

$sheets->spreadsheets_values->batchUpdate(
  $spreadsheetId,
  new Google_Service_Sheets_BatchUpdateValuesRequest([
    'valueInputOption' => 'USER_ENTERED',
    'data' => $data,
  ])
);

echo "OK: №27–52 занесены\n";
