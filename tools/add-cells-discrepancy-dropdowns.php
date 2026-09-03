<?php
/**
 * Выпадающий список ячеек в колонке «Адрес в WMS» (+ чистка старых N:O).
 * Данные A:M не перезаписывает.
 *
 * Usage:
 *   php tools/add-cells-discrepancy-dropdowns.php --tab="Расхождения 26.08.2026"
 *   php tools/add-cells-discrepancy-dropdowns.php --tab="…" --wms-json=/tmp/wms-cells-full.json
 */
declare(strict_types=1);

if (!function_exists('cellsToolBankPaths')) {
function cellsToolBankPaths(): array
{
  $candidates = [
    dirname(__DIR__) . '/../bank_pnevmopodveska1_ru/public_html',
    dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html',
    '/root/bank_pnevmopodveska1_ru/public_html',
  ];
  foreach ($candidates as $base) {
    $cred = $base . '/pnevmopodveska1-677b14845bb0.json';
    $auto = $base . '/vendor/autoload.php';
    if (is_file($cred) && is_file($auto)) {
      return [$cred, $auto];
    }
  }
  return ['', ''];
}
}

if (!function_exists('normCellDropdown')) {
function normCellDropdown(string $raw): string
{
  $s = trim($raw);
  if ($s === '') {
    return '';
  }
  $low = mb_strtolower(str_replace('?', '', $s));
  if ($low === 'сто' || str_contains($low, 'полка сто')) {
    return 'A13.C0';
  }
  if (preg_match('/^п\s*(\d+)$/iu', $s, $m)) {
    return 'П.' . $m[1];
  }
  $s = preg_replace('/\s+/u', '', $s) ?? $s;
  $s = preg_replace('/^А/u', 'A', $s) ?? $s;
  if ($s !== '' && preg_match('/^[A-Za-z]/', $s)) {
    $s = strtoupper($s[0]) . substr($s, 1);
  }
  if ($s !== '' && ($s[0] === 'Б' || $s[0] === 'б')) {
    $s = 'B' . substr($s, 1);
  }
  return $s;
}
}

/** @return list<string> */
function cellsDiscrepancyCollectCellCodes(
  Google_Service_Sheets $sheets,
  string $spreadsheetId,
  string $tabTitle,
  string $wmsJson,
  string $refSheet
): array {
  $set = [];
  $add = static function (string $raw) use (&$set): void {
    $c = function_exists('normCell') ? normCell($raw) : normCellDropdown($raw);
    if ($c !== '') {
      $set[$c] = true;
    }
  };

  if (is_file($wmsJson)) {
    $wms = json_decode((string) file_get_contents($wmsJson), true);
    if (is_array($wms)) {
      foreach ($wms['cell_lines'] ?? [] as $line) {
        $add((string) ($line['cell'] ?? ''));
      }
    }
  }

  $refRange = "'" . str_replace("'", "''", $refSheet) . "'!D2:D5000";
  try {
    $refVals = $sheets->spreadsheets_values->get($spreadsheetId, $refRange)->getValues() ?: [];
    foreach ($refVals as $r) {
      $add((string) ($r[0] ?? ''));
    }
  } catch (Throwable $e) {
  }

  $tabRange = "'" . str_replace("'", "''", $tabTitle) . "'!H2:I500";
  $tabVals = $sheets->spreadsheets_values->get($spreadsheetId, $tabRange)->getValues() ?: [];
  foreach ($tabVals as $r) {
    $add((string) ($r[0] ?? ''));
    $add((string) ($r[1] ?? ''));
  }

  for ($i = 1; $i <= 20; $i++) {
    $add('П.' . $i);
  }
  for ($r = 1; $r <= 13; $r++) {
    for ($s = 1; $s <= 5; $s++) {
      $add('A' . $r . '.' . $s);
    }
    $add('A' . $r . '.C0');
  }

  $list = array_keys($set);
  sort($list, SORT_NATURAL);
  return $list;
}

/** @param list<string> $cells */
function cellsDiscrepancyApplyDropdowns(
  Google_Service_Sheets $sheets,
  string $spreadsheetId,
  string $tabTitle,
  int $sheetId,
  int $headerRowIdx,
  int $dataRows,
  array $cells
): void {
  $listTitle = '_ячейки';
  $quotedList = "'" . str_replace("'", "''", $listTitle) . "'";

  $ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
  $listSheetId = null;
  foreach ($ss->getSheets() as $sh) {
    if ($sh->getProperties()->getTitle() === $listTitle) {
      $listSheetId = (int) $sh->getProperties()->getSheetId();
      break;
    }
  }

  $requests = [];
  if ($listSheetId === null) {
    $requests[] = [
      'addSheet' => [
        'properties' => [
          'title' => $listTitle,
          'hidden' => true,
          'gridProperties' => ['rowCount' => max(200, count($cells) + 5), 'columnCount' => 2],
        ],
      ],
    ];
  }

  if ($requests) {
    $resp = $sheets->spreadsheets->batchUpdate(
      $spreadsheetId,
      new Google_Service_Sheets_BatchUpdateSpreadsheetRequest(['requests' => $requests])
    );
    foreach ($resp->getReplies() as $reply) {
      if ($reply->getAddSheet()) {
        $listSheetId = (int) $reply->getAddSheet()->getProperties()->getSheetId();
      }
    }
  }

  if ($listSheetId === null) {
    throw new RuntimeException('Не удалось получить лист _ячейки');
  }

  $listValues = [['Код ячейки']];
  foreach ($cells as $c) {
    $listValues[] = [$c];
  }
  $sheets->spreadsheets_values->update(
    $spreadsheetId,
    $quotedList . '!A1',
    new Google_Service_Sheets_ValueRange([
      'range' => $quotedList . '!A1',
      'majorDimension' => 'ROWS',
      'values' => $listValues,
    ]),
    ['valueInputOption' => 'RAW']
  );

  $sheets->spreadsheets_values->clear(
    $spreadsheetId,
    "'" . str_replace("'", "''", $tabTitle) . "'!N:P",
    new Google_Service_Sheets_ClearValuesRequest()
  );

  $endRow = $headerRowIdx + 1 + $dataRows;
  $listEnd = count($cells) + 1;
  $rangeA1 = "={$quotedList}!\$A\$2:\$A\${$listEnd}";

  $sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google_Service_Sheets_BatchUpdateSpreadsheetRequest([
      'requests' => [
        [
          'updateSheetProperties' => [
            'properties' => ['sheetId' => $listSheetId, 'hidden' => true],
            'fields' => 'hidden',
          ],
        ],
        [
          'setDataValidation' => [
            'range' => [
              'sheetId' => $sheetId,
              'startRowIndex' => $headerRowIdx + 1,
              'endRowIndex' => $endRow,
              'startColumnIndex' => 7,
              'endColumnIndex' => 8,
            ],
            'rule' => [
              'condition' => [
                'type' => 'ONE_OF_RANGE',
                'values' => [['userEnteredValue' => $rangeA1]],
              ],
              'showCustomUi' => true,
              'strict' => false,
              'inputMessage' => 'Выберите ячейку склада',
            ],
          ],
        ],
        [
          'repeatCell' => [
            'range' => [
              'sheetId' => $sheetId,
              'startRowIndex' => $headerRowIdx + 1,
              'endRowIndex' => $endRow,
              'startColumnIndex' => 7,
              'endColumnIndex' => 8,
            ],
            'cell' => [
              'userEnteredFormat' => [
                'backgroundColor' => ['red' => 0.91, 'green' => 0.95, 'blue' => 1.0],
              ],
            ],
            'fields' => 'userEnteredFormat.backgroundColor',
          ],
        ],
      ],
    ])
  );
}

if (PHP_SAPI === 'cli' && realpath($argv[0] ?? '') === __FILE__) {

$spreadsheetId = '1QvYC0DS9JSO-NFrjmMG1NAqa1jxwbpIVUBs1ygJqyfw';
$tabTitle = '';
$wmsJson = '/tmp/wms-cells-full.json';
$refSheet = '03-11.08';

foreach ($argv as $arg) {
  if (str_starts_with($arg, '--tab=')) {
    $tabTitle = substr($arg, 6);
  }
  if (str_starts_with($arg, '--wms-json=')) {
    $wmsJson = substr($arg, 11);
  }
  if (str_starts_with($arg, '--sheet=')) {
    $refSheet = substr($arg, 8);
  }
}

if ($tabTitle === '') {
  fwrite(STDERR, "Укажите --tab=\"Расхождения ДД.ММ.ГГГГ\"\n");
  exit(1);
}

[$credPath, $autoload] = cellsToolBankPaths();
if (!is_file($autoload) || !is_file($credPath)) {
  fwrite(STDERR, "Нет Google credentials\n");
  exit(1);
}
require $autoload;

$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS]);
$sheets = new Google_Service_Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$sheetId = null;
foreach ($ss->getSheets() as $sh) {
  if ($sh->getProperties()->getTitle() === $tabTitle) {
    $sheetId = (int) $sh->getProperties()->getSheetId();
    break;
  }
}
if ($sheetId === null) {
  fwrite(STDERR, "Вкладка не найдена: {$tabTitle}\n");
  exit(1);
}

$range = "'" . str_replace("'", "''", $tabTitle) . "'!A1:M499";
$rows = $sheets->spreadsheets_values->get($spreadsheetId, $range)->getValues() ?: [];
$headerIdx = null;
foreach ($rows as $i => $r) {
  if (($r[0] ?? '') === 'Что не так' && ($r[1] ?? '') === 'Артикул') {
    $headerIdx = $i;
    break;
  }
}
if ($headerIdx === null) {
  fwrite(STDERR, "Не найден заголовок таблицы\n");
  exit(1);
}

$dataRows = max(0, count($rows) - $headerIdx - 1);
$cells = cellsDiscrepancyCollectCellCodes($sheets, $spreadsheetId, $tabTitle, $wmsJson, $refSheet);

cellsDiscrepancyApplyDropdowns(
  $sheets,
  $spreadsheetId,
  $tabTitle,
  $sheetId,
  $headerIdx,
  $dataRows,
  $cells
);

fwrite(STDOUT, "OK · dropdown H · ячеек в списке: " . count($cells) . " · строк: {$dataRows}\n");
fwrite(STDOUT, "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$sheetId}\n");

}
