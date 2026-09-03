<?php
/**
 * Выгрузка инв. «Склад СТО Москва» → JSON для migrate-sto-moscow-to-cells.mjs
 */
declare(strict_types=1);

$credPath = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$spreadsheetId = '1_nHyQXVhqdA3wH0193QNCd1uwsJmnzz_iocu2ydXllc';
$sheetTitle = 'Инв. СТО Москва 26.08';
$outPath = dirname(__DIR__) . '/data/sto-moscow-cells-migration.json';

require $autoload;

$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS]);
$sheets = new Google_Service_Sheets($client);
$escTitle = str_replace("'", "''", $sheetTitle);

$resp = $sheets->spreadsheets_values->get($spreadsheetId, "'{$escTitle}'!A3:I89");
$rows = [];
foreach ($resp->getValues() ?? [] as $i => $row) {
  $num = $i + 1;
  $factRaw = trim((string) ($row[6] ?? ''));
  $fact = is_numeric(str_replace(',', '.', $factRaw)) ? (float) str_replace(',', '.', $factRaw) : 0;
  if ($fact <= 0) {
    continue;
  }
  $rows[] = [
    'num' => $num,
    'code' => trim((string) ($row[1] ?? '')),
    'sku' => trim((string) ($row[2] ?? '')),
    'name' => trim((string) ($row[3] ?? '')),
    'qty' => $fact,
    'cell' => trim((string) ($row[7] ?? '')),
    'note' => trim((string) ($row[8] ?? '')),
  ];
}

$payload = [
  'source' => 'Инв. СТО Москва 26.08',
  'sheet_id' => $spreadsheetId,
  'fetched_at' => gmdate('c'),
  'sto_warehouse_code' => '00-000001',
  'main_warehouse_code' => 'НФ-000032',
  'rows' => $rows,
];

file_put_contents($outPath, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
echo "OK: " . count($rows) . " строк → {$outPath}\n";
