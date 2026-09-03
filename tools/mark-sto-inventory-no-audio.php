<?php
/**
 * Серый фон для позиций без аудиосверки (№53–83).
 * Аудио: запись 4 → №1–52, запись 5 → №84–87.
 */
declare(strict_types=1);

$credPath = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$spreadsheetId = '1_nHyQXVhqdA3wH0193QNCd1uwsJmnzz_iocu2ydXllc';
$sheetTitle = 'Инв. СТО Москва 26.08';

/** @var int $firstNum первая позиция без аудио (включительно) */
$firstNum = 53;
/** @var int $lastNum последняя позиция без аудио (включительно) */
$lastNum = 83;

require $autoload;

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

// Строка листа = № + 2 (строки 1–2 — итоги и шапка).
$startRowIndex = $firstNum + 2 - 1; // 0-based
$endRowIndex = $lastNum + 2; // exclusive

$gray = ['red' => 0.88, 'green' => 0.88, 'blue' => 0.88];

$sheets->spreadsheets->batchUpdate(
  $spreadsheetId,
  new Google_Service_Sheets_BatchUpdateSpreadsheetRequest([
    'requests' => [
      [
        'repeatCell' => [
          'range' => [
            'sheetId' => $sheetId,
            'startRowIndex' => $startRowIndex,
            'endRowIndex' => $endRowIndex,
            'startColumnIndex' => 0,
            'endColumnIndex' => 9,
          ],
          'cell' => [
            'userEnteredFormat' => [
              'backgroundColor' => $gray,
            ],
          ],
          'fields' => 'userEnteredFormat.backgroundColor',
        ],
      ],
    ],
  ])
);

$sheets->spreadsheets_values->batchUpdate(
  $spreadsheetId,
  new Google_Service_Sheets_BatchUpdateValuesRequest([
    'valueInputOption' => 'USER_ENTERED',
    'data' => [
      new Google_Service_Sheets_ValueRange([
        'range' => "'{$escTitle}'!A101:B101",
        'values' => [['Без аудио (серый фон)', "№{$firstNum}–{$lastNum} · данные из OCR/ручного ввода"]],
      ]),
    ],
  ])
);

echo "OK: серый фон №{$firstNum}–{$lastNum}\n";
echo "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$sheetId}\n";
