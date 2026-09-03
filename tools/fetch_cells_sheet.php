<?php
/**
 * Снэпшот Google «Март. Ячейки» → data/cells-sheet-cache.json
 * Затем на VPS: node bin/apply-msk-sheet-stock.mjs
 *
 * Колонки листа: A SKU, B Поставка, C начальный, D Ячейка, E расход, G конечный остаток,
 * H/I пометки (брак / СТО).
 * Эталон qty = G (конечный остаток).
 *
 * Usage:
 *   php tools/fetch_cells_sheet.php
 *   php tools/fetch_cells_sheet.php --sheet=24-29.08
 *   php tools/fetch_cells_sheet.php --gid=1042390058
 */
declare(strict_types=1);

function cellsFetchBankPaths(): array
{
  $candidates = [
    dirname(__DIR__) . '/../bank_pnevmopodveska1_ru/public_html',
    dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html',
    '/root/bank_pnevmopodveska1_ru/public_html',
    '/Users/a_/Downloads/php/Pnevmo1/bank_pnevmopodveska1_ru/public_html',
    '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html',
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

[$credPath, $autoload] = cellsFetchBankPaths();
$spreadsheetId = '1QvYC0DS9JSO-NFrjmMG1NAqa1jxwbpIVUBs1ygJqyfw';
$outPath = dirname(__DIR__) . '/data/cells-sheet-cache.json';
/** Основной · Москва (НФ-000032). */
$mainWarehouseId = 'b7142cc4-2b3a-11ec-80bf-00155d3d52d2';

$preferTitle = null;
$preferGid = 1042390058;
foreach ($argv as $arg) {
  if (str_starts_with($arg, '--sheet=')) {
    $preferTitle = substr($arg, 8);
  }
  if (str_starts_with($arg, '--gid=')) {
    $preferGid = (int) substr($arg, 6);
  }
}

if ($credPath === '' || $autoload === '') {
  fwrite(STDERR, "Нет Google credentials/vendor\n");
  exit(1);
}

require $autoload;
$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS_READONLY]);
$sheets = new Google_Service_Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'properties.title,sheets.properties']);
$title = $preferTitle;
if ($title === null) {
  foreach ($ss->getSheets() as $sh) {
    if ((int) $sh->getProperties()->getSheetId() === $preferGid) {
      $title = $sh->getProperties()->getTitle();
      break;
    }
  }
}
if ($title === null || $title === '') {
  $all = $ss->getSheets();
  $last = $all[count($all) - 1] ?? null;
  $title = $last ? $last->getProperties()->getTitle() : null;
}
if (!$title) {
  fwrite(STDERR, "Не найден лист\n");
  exit(1);
}

function numCell($v): float
{
  $s = trim((string) $v);
  if ($s === '') {
    return 0.0;
  }
  $s = str_replace([' ', ','], ['', '.'], $s);
  return is_numeric($s) ? (float) $s : 0.0;
}

function sheetHint(string $h, string $i): string
{
  $t = mb_strtolower(trim($h . ' ' . $i));
  if ($t === '') {
    return '';
  }
  if (preg_match('/склад\s*брака|на\s*складе\s*брака|\bбрак/u', $t)) {
    return 'брак';
  }
  if (preg_match('/\bсто\b|склад\s*сто/u', $t)) {
    return 'СТО';
  }
  return 'пр.';
}

$vals = $sheets->spreadsheets_values->get($spreadsheetId, "'" . str_replace("'", "''", $title) . "'!A2:J10000");
$rowsIn = $vals->getValues() ?: [];
$out = [];
$stats = ['rows' => 0, 'qty_sum' => 0.0, 'defect' => 0, 'sto_note' => 0, 'g_zero' => 0];

foreach ($rowsIn as $r) {
  $sku = strtoupper(trim((string) ($r[0] ?? '')));
  if ($sku === '') {
    continue;
  }
  $supply = trim((string) ($r[1] ?? ''));
  $cell = trim((string) ($r[3] ?? ''));
  // G = конечный остаток; fallback на C если G пуст и лист старого формата
  $qtyG = isset($r[6]) && trim((string) $r[6]) !== '' ? numCell($r[6]) : numCell($r[2] ?? 0);
  $h = trim((string) ($r[7] ?? ''));
  $i = trim((string) ($r[8] ?? ''));
  if (str_starts_with($i, 'http')) {
    $i = '';
  }
  $hint = sheetHint($h, $i);
  if ($qtyG <= 0) {
    $stats['g_zero']++;
  }
  if ($hint === 'брак') {
    $stats['defect']++;
  }
  if ($hint === 'СТО') {
    $stats['sto_note']++;
  }
  $stats['rows']++;
  $stats['qty_sum'] += max(0, $qtyG);
  $out[] = [
    'sku' => $sku,
    'supply' => $supply,
    'qty' => $qtyG,
    'cell' => $cell,
    'hint' => $hint,
    'h' => $h,
    'i' => $i,
  ];
}

@mkdir(dirname($outPath), 0775, true);
$payload = [
  'sheet_id' => $spreadsheetId,
  'sheet_title' => $title,
  'gid' => $preferGid,
  'fetched_at' => date('c'),
  'source' => 'Март. Ячейки',
  'warehouse_id' => $mainWarehouseId,
  'warehouse_code' => 'НФ-000032',
  'qty_column' => 'G',
  'stats' => $stats,
  'rows' => $out,
];
file_put_contents($outPath, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
fwrite(STDOUT, "OK {$title}: " . count($out) . " rows, qty_sum={$stats['qty_sum']} → {$outPath}\n");
fwrite(STDOUT, json_encode($stats, JSON_UNESCAPED_UNICODE) . "\n");
