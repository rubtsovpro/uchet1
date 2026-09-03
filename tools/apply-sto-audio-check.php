<?php
/**
 * Сверка аудио «Новая запись 4.m4a» с листом инвентаризации.
 * Обновляет только расхождения по поз. 1–26 + служебная строка прогресса.
 */
declare(strict_types=1);

$credPath = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$spreadsheetId = '1_nHyQXVhqdA3wH0193QNCd1uwsJmnzz_iocu2ydXllc';
$sheetTitle = 'Инв. СТО Москва 26.08';

require $autoload;

/** @return array<int, array{fact:string, cell:string}> */
function audioInventoryThrough26(): array
{
  return [
    1 => ['fact' => '0', 'cell' => ''],
    2 => ['fact' => '1', 'cell' => 'A5.3'],
    3 => ['fact' => '0', 'cell' => ''],
    4 => ['fact' => '0', 'cell' => ''],
    5 => ['fact' => '0', 'cell' => ''],
    6 => ['fact' => '0', 'cell' => ''],
    7 => ['fact' => '0', 'cell' => ''],
    8 => ['fact' => '0', 'cell' => ''],
    9 => ['fact' => '0', 'cell' => ''],
    10 => ['fact' => '0', 'cell' => ''],
    11 => ['fact' => '0', 'cell' => ''],
    12 => ['fact' => '0', 'cell' => ''],
    13 => ['fact' => '1', 'cell' => 'полка СТО'],
    14 => ['fact' => '1', 'cell' => 'полка СТО'],
    15 => ['fact' => '0', 'cell' => ''],
    16 => ['fact' => '0', 'cell' => ''],
    17 => ['fact' => '0', 'cell' => ''],
    18 => ['fact' => '0', 'cell' => ''],
    19 => ['fact' => '1', 'cell' => 'A1.3'],
    20 => ['fact' => '1', 'cell' => 'A1.3'],
    21 => ['fact' => '1', 'cell' => 'Б1.2'],
    22 => ['fact' => '1', 'cell' => 'полка СТО'],
    23 => ['fact' => '0', 'cell' => ''],
    24 => ['fact' => '1', 'cell' => ''],
    25 => ['fact' => '10', 'cell' => 'П15'],
    26 => ['fact' => '10', 'cell' => 'П16'],
  ];
}

$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS]);
$sheets = new Google_Service_Sheets($client);
$escTitle = str_replace("'", "''", $sheetTitle);

$vals = $sheets->spreadsheets_values->get($spreadsheetId, "'{$escTitle}'!A1:H120")->getValues() ?: [];
$audio = audioInventoryThrough26();
$updates = [];
$mismatch = [];

foreach ($vals as $i => $r) {
  if ($i < 2) {
    continue;
  }
  $num = (int) ($r[0] ?? 0);
  if ($num <= 0 || $num > 87) {
    continue;
  }
  $row = $i + 1;
  if ($num === 77) {
    $cell = trim($r[7] ?? '');
    if ($cell === 'А5.1') {
      $updates[] = ['range' => "'{$escTitle}'!H{$row}", 'values' => [['A5.1']]];
    }
  }
  if (!isset($audio[$num])) {
    continue;
  }
  $want = $audio[$num];
  $curFact = trim((string) ($r[6] ?? ''));
  $curCell = trim((string) ($r[7] ?? ''));
  if ($curFact !== $want['fact'] || $curCell !== $want['cell']) {
    $mismatch[] = "#{$num}: лист {$curFact}/{$curCell} → аудио {$want['fact']}/{$want['cell']}";
    $updates[] = ['range' => "'{$escTitle}'!G{$row}", 'values' => [[$want['fact']]]];
    $updates[] = ['range' => "'{$escTitle}'!H{$row}", 'values' => [[$want['cell']]]];
  }
}

$progress = [
  [],
  ['Сверка с аудио 26.08.2026 (Новая запись 4.m4a)'],
  ['Проговорено в записи', '№1–26'],
  ['Остановился перед', '№27'],
  ['В конце записи (обрывок)', '№61 · A12.3 · 14 шт — уже в таблице'],
  ['Дальше в записи', 'шум / неразборчиво'],
  ['Сверка №1–26', count($mismatch) ? implode('; ', $mismatch) : 'совпадает с листом'],
];

$updates[] = [
  'range' => "'{$escTitle}'!A91:H" . (90 + count($progress)),
  'values' => $progress,
];

$updates[] = [
  'range' => "'{$escTitle}'!F1:G1",
  'values' => [['=SUM(F3:F89)', '=SUM(G3:G89)']],
];

$body = new Google_Service_Sheets_BatchUpdateValuesRequest([
  'valueInputOption' => 'USER_ENTERED',
  'data' => array_map(static fn(array $u) => new Google_Service_Sheets_ValueRange($u), $updates),
]);
$sheets->spreadsheets_values->batchUpdate($spreadsheetId, $body);

echo "OK\n";
echo 'Обновлений: ' . count($updates) . "\n";
echo 'Расхождений 1–26: ' . count($mismatch) . "\n";
foreach ($mismatch as $m) {
  echo "  {$m}\n";
}
