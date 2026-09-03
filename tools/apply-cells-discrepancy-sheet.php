<?php
/**
 * Импорт заполненных строк с вкладки «Расхождения …» → WMS (по мозаике).
 * Читает только вкладку расхождений; недельные листы не трогаем.
 *
 * Usage:
 *   php tools/apply-cells-discrepancy-sheet.php --tab="Расхождения 26.08.2026"
 *   php tools/apply-cells-discrepancy-sheet.php --tab="…" --dry-run
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
[$credPath, $autoload] = cellsToolBankPaths();
$spreadsheetId = '1QvYC0DS9JSO-NFrjmMG1NAqa1jxwbpIVUBs1ygJqyfw';
$apiBase = getenv('WMS_API_BASE') ?: 'http://127.0.0.1:3101/api';
$token = getenv('WMS_ADMIN_TOKEN') ?: '';
$tabTitle = '';
$dryRun = false;

foreach ($argv as $arg) {
  if (str_starts_with($arg, '--tab=')) {
    $tabTitle = substr($arg, 6);
  }
  if ($arg === '--dry-run') {
    $dryRun = true;
  }
}

if ($tabTitle === '') {
  fwrite(STDERR, "Укажите --tab=\"Расхождения ДД.ММ.ГГГГ\"\n");
  exit(1);
}

require $autoload;

function normSku(string $sku): string
{
  return strtoupper(trim($sku));
}

function normCell(string $raw): string
{
  $s = trim($raw);
  if ($s === '') {
    return '';
  }
  $s = preg_replace('/\s+/u', '', $s) ?? $s;
  $s = preg_replace('/^А/u', 'A', $s) ?? $s;
  if ($s !== '' && preg_match('/^[A-Za-z]/', $s)) {
    $s = strtoupper($s[0]) . substr($s, 1);
  }
  if ($s !== '' && ($s[0] === 'Б' || $s[0] === 'б')) {
    $s = 'B' . substr($s, 1);
  }
  if (preg_match('/^п(\d+)$/iu', $s, $m)) {
    return 'П.' . $m[1];
  }
  return $s;
}

function composeCell(string $rack, string $cellPart): string
{
  $rack = trim($rack);
  $cellPart = trim($cellPart);
  if ($cellPart !== '' && (str_contains($cellPart, '.') || preg_match('/^C\d+$/i', $cellPart))) {
    return normCell($cellPart);
  }
  if ($rack === '' && $cellPart === '') {
    return '';
  }
  if ($rack !== '' && $cellPart !== '') {
    if (preg_match('/^[AB]\d+$/i', $rack)) {
      return normCell($rack . '.' . $cellPart);
    }
    if (preg_match('/^[ПP]$/iu', $rack)) {
      return normCell('П.' . $cellPart);
    }
  }
  return normCell($rack . $cellPart);
}

$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS_READONLY]);
$sheets = new Google_Service_Sheets($client);

$range = "'" . str_replace("'", "''", $tabTitle) . "'!A:O";
$vals = $sheets->spreadsheets_values->get($spreadsheetId, $range);
$rows = $vals->getValues() ?: [];

$headerIdx = null;
$colMap = [];
foreach ($rows as $i => $r) {
  if (($r[0] ?? '') === 'Что не так' && ($r[1] ?? '') === 'Артикул') {
    $headerIdx = $i;
    foreach ($r as $ci => $label) {
      $l = trim((string) $label);
      if ($l === '▶ Склад') {
        $colMap['wh'] = $ci;
      } elseif ($l === '▶ Стеллаж') {
        $colMap['rack'] = $ci;
      } elseif ($l === '▶ Полка') {
        $colMap['cell'] = $ci;
      } elseif ($l === 'Партия') {
        $colMap['supply'] = $ci;
      } elseif ($l === 'Кол-во в WMS') {
        $colMap['wms_qty'] = $ci;
      } elseif ($l === 'Кол-во на листе') {
        $colMap['sheet_qty'] = $ci;
      } elseif ($l === 'Кол-во на складе') {
        $colMap['main_qty'] = $ci;
      } elseif ($l === 'Адрес в WMS') {
        $colMap['wms_addr'] = $ci;
      }
    }
    break;
  }
  // старый формат заголовков
  if (($r[0] ?? '') === 'Статус' && ($r[1] ?? '') === 'SKU') {
    $headerIdx = $i;
    $colMap = ['supply' => 3, 'wms_qty' => 4, 'sheet_qty' => 5, 'main_qty' => 6, 'wh' => 11, 'rack' => 12, 'cell' => 13];
    break;
  }
}
if ($headerIdx === null || !isset($colMap['rack'], $colMap['cell'])) {
  fwrite(STDERR, "Не найден заголовок на вкладке {$tabTitle}\n");
  exit(1);
}

$importRows = [];
$skipped = 0;

for ($i = $headerIdx + 1; $i < count($rows); $i++) {
  $r = $rows[$i];
  $sku = normSku((string) ($r[1] ?? ''));
  if ($sku === '') {
    continue;
  }
  $fillWh = trim((string) ($r[$colMap['wh'] ?? 9] ?? ''));
  $fillRack = trim((string) ($r[$colMap['rack']] ?? ''));
  $fillCell = trim((string) ($r[$colMap['cell']] ?? ''));
  $fullCell = composeCell($fillRack, $fillCell);
  if ($fullCell === '' && isset($colMap['wms_addr'])) {
    $status = trim((string) ($r[0] ?? ''));
    $wmsAddr = normCell((string) ($r[$colMap['wms_addr']] ?? ''));
    $useWmsCol = in_array(
      $status,
      ['На листе нет ячейки', 'Нет в WMS', 'На складе есть, адрес не указан', 'Разное количество'],
      true
    );
    if ($useWmsCol && $wmsAddr !== '') {
      $fullCell = $wmsAddr;
    }
  }
  if ($fullCell === '') {
    $skipped++;
    continue;
  }
  $qty = num($r[$colMap['sheet_qty'] ?? 5] ?? 0);
  if ($qty <= 0) {
    $qty = num($r[$colMap['wms_qty'] ?? 4] ?? 0);
  }
  if ($qty <= 0) {
    $qty = num($r[$colMap['main_qty'] ?? 6] ?? 0);
  }
  if ($qty <= 0) {
    $skipped++;
    continue;
  }
  $importRows[] = [
    'sku' => $sku,
    'supply' => trim((string) ($r[$colMap['supply'] ?? 3] ?? '')),
    'qty' => $qty,
    'cell' => $fullCell,
    'warehouse_hint' => $fillWh,
  ];
}

function num($v): float
{
  $s = trim((string) $v);
  if ($s === '') {
    return 0.0;
  }
  $s = str_replace([' ', ','], ['', '.'], $s);
  return is_numeric($s) ? (float) $s : 0.0;
}

fwrite(STDERR, json_encode(['to_import' => count($importRows), 'skipped' => $skipped], JSON_UNESCAPED_UNICODE) . "\n");

if ($dryRun || count($importRows) === 0) {
  fwrite(STDOUT, $dryRun ? "dry-run OK\n" : "nothing to import\n");
  exit(0);
}

$payload = json_encode([
  'source' => 'Расхождения Google',
  'sheet_title' => $tabTitle,
  'fetched_at' => date('c'),
  'replace' => false,
  'rows' => $importRows,
], JSON_UNESCAPED_UNICODE);

$ch = curl_init(rtrim($apiBase, '/') . '/warehouse/cells/import');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => array_filter([
    'Content-Type: application/json',
    $token !== '' ? 'Authorization: Bearer ' . $token : null,
  ]),
  CURLOPT_POSTFIELDS => $payload,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 120,
]);
$resp = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($code < 200 || $code >= 300) {
  fwrite(STDERR, "API HTTP {$code}: {$resp}\n");
  fwrite(STDERR, "На VPS: node bin/import-cells-from-json.mjs < payload.json\n");
  exit(2);
}

fwrite(STDOUT, $resp . "\n");
