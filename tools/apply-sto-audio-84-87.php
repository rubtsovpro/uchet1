<?php
declare(strict_types=1);

$credPath = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$spreadsheetId = '1_nHyQXVhqdA3wH0193QNCd1uwsJmnzz_iocu2ydXllc';
$sheetTitle = 'Инв. СТО Москва 26.08';

require $autoload;

$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS]);
$sheets = new Google_Service_Sheets($client);
$escTitle = str_replace("'", "''", $sheetTitle);

$note = 'нет в наличии';
$data = [];
foreach ([84, 85, 86, 87] as $num) {
  $row = $num + 2;
  $data[] = new Google_Service_Sheets_ValueRange([
    'range' => "'{$escTitle}'!G{$row}:I{$row}",
    'values' => [['0', '', $note]],
  ]);
}

$data[] = new Google_Service_Sheets_ValueRange([
  'range' => "'{$escTitle}'!A97:B100",
  'values' => [
    ['Сверка аудио ч.3 (запись 5)'],
    ['Занесено', '№84–87 · факт 0 · нет в наличии'],
    ['Остановился', 'конец ведомости (87)'],
  ],
]);

$sheets->spreadsheets_values->batchUpdate(
  $spreadsheetId,
  new Google_Service_Sheets_BatchUpdateValuesRequest([
    'valueInputOption' => 'USER_ENTERED',
    'data' => $data,
  ])
);

echo "OK: №84–87 дописаны\n";
