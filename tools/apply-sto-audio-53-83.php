<?php
/**
 * Запись 6: «нету» по перечисленным позициям №53–83.
 * Не озвучены в записи → серый фон, значения не трогаем.
 */
declare(strict_types=1);

$credPath = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$spreadsheetId = '1_nHyQXVhqdA3wH0193QNCd1uwsJmnzz_iocu2ydXllc';
$sheetTitle = 'Инв. СТО Москва 26.08';

require $autoload;

/** @return array<int, array{fact:string, cell:string, note?:string}> */
function audioRows53to83(): array
{
  $note = 'нет в наличии';
  $zero = static fn (): array => ['fact' => '0', 'cell' => '', 'note' => $note];

  return [
    53 => $zero(),
    54 => $zero(),
    58 => $zero(),
    59 => $zero(),
    62 => $zero(),
    63 => $zero(),
    64 => $zero(),
    65 => $zero(),
    66 => $zero(),
    67 => $zero(),
    69 => $zero(),
    70 => $zero(),
    71 => $zero(),
    72 => $zero(),
    73 => $zero(),
    74 => $zero(),
    75 => $zero(),
    78 => $zero(),
    79 => $zero(),
    80 => $zero(),
    81 => $zero(),
    82 => $zero(),
    83 => $zero(),
  ];
}

/** Позиции №53–83, не попавшие в запись 6. */
function noAudioRows53to83(): array
{
  return [55, 56, 57, 60, 61, 68, 76, 77];
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

$audio = audioRows53to83();
$noAudio = noAudioRows53to83();
$data = [];
foreach ($audio as $num => $row) {
  $sheetRow = $num + 2;
  $data[] = new Google_Service_Sheets_ValueRange([
    'range' => "'{$escTitle}'!G{$sheetRow}:I{$sheetRow}",
    'values' => [[$row['fact'], $row['cell'], $row['note'] ?? '']],
  ]);
}

$data[] = new Google_Service_Sheets_ValueRange([
  'range' => "'{$escTitle}'!A102:B105",
  'values' => [
    ['Сверка аудио ч.4 (запись 6)'],
    ['Занесено', '№53–83 · «нету» → факт 0'],
    ['Без записи (серый)', '№55, 56, 57, 60, 61, 68, 76, 77'],
    ['Остановился', 'перед №84 (запись 5)'],
  ],
]);

$sheets->spreadsheets_values->batchUpdate(
  $spreadsheetId,
  new Google_Service_Sheets_BatchUpdateValuesRequest([
    'valueInputOption' => 'USER_ENTERED',
    'data' => $data,
  ])
);

$gray = ['red' => 0.88, 'green' => 0.88, 'blue' => 0.88];
$white = ['red' => 1.0, 'green' => 1.0, 'blue' => 1.0];
$formatReqs = [];

foreach ($audio as $num => $_row) {
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

foreach ($noAudio as $num) {
  $formatReqs[] = [
    'repeatCell' => [
      'range' => [
        'sheetId' => $sheetId,
        'startRowIndex' => $num + 1,
        'endRowIndex' => $num + 2,
        'startColumnIndex' => 0,
        'endColumnIndex' => 9,
      ],
      'cell' => ['userEnteredFormat' => ['backgroundColor' => $gray]],
      'fields' => 'userEnteredFormat.backgroundColor',
    ],
  ];
}

$sheets->spreadsheets->batchUpdate(
  $spreadsheetId,
  new Google_Service_Sheets_BatchUpdateSpreadsheetRequest(['requests' => $formatReqs])
);

echo 'OK: запись 6 · занесено ' . count($audio) . ' поз., серый ' . count($noAudio) . "\n";
echo "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$sheetId}\n";
