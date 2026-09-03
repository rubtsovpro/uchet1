<?php
/**
 * Сверка листа «Март. Ячейки» (адресное хранение) с WMS · Пневмоподвеска Москва.
 * G — финальный остаток (эталон для ячеек).
 * H, I — текстовые пометки (брак / СТО / пр.).
 * WMS: «Основной» (НФ-000032) + «Склад Брак (рекламация)» (НФ-000037).
 *
 * Usage:
 *   ssh bank-vps 'python3 …' > /tmp/wms-balances.json   # см. README в комментарии ниже
 *   php tools/reconcile-cells-sheet.php --gid=1042390058 --wms-json=/tmp/wms-balances.json
 *   php tools/reconcile-cells-sheet.php --gid=1042390058 --wms-json=… --csv-only
 */
declare(strict_types=1);

$credPath = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$spreadsheetId = '1QvYC0DS9JSO-NFrjmMG1NAqa1jxwbpIVUBs1ygJqyfw';
$summaryTitle = 'Сводка WMS 26.08';

$preferGid = 1042390058;
$csvOnly = false;
$wmsJson = '/tmp/wms-balances-podveska-full.json';

foreach ($argv as $arg) {
  if (str_starts_with($arg, '--gid=')) {
    $preferGid = (int) substr($arg, 6);
  }
  if (str_starts_with($arg, '--wms-json=')) {
    $wmsJson = substr($arg, 11);
  }
  if ($arg === '--csv-only') {
    $csvOnly = true;
  }
}

if (!is_file($autoload) || !is_file($credPath)) {
  fwrite(STDERR, "Нет Google credentials/vendor\n");
  exit(1);
}
if (!is_file($wmsJson)) {
  fwrite(STDERR, "Нет WMS JSON: {$wmsJson}\n");
  exit(1);
}

require $autoload;

function num($v): float
{
  $s = trim((string) $v);
  if ($s === '') {
    return 0.0;
  }
  $s = str_replace([' ', ','], ['', '.'], $s);
  return is_numeric($s) ? (float) $s : 0.0;
}

function normSku(string $sku): string
{
  return strtoupper(trim($sku));
}

/** @return array{main: array<string,float>, defect: array<string,float>, main_wh: array, defect_wh: array} */
function loadWmsFromJson(string $path): array
{
  $raw = json_decode((string) file_get_contents($path), true);
  if (!is_array($raw)) {
    throw new RuntimeException('Bad WMS JSON');
  }
  return [
    'main' => $raw['main'] ?? [],
    'defect' => $raw['defect'] ?? [],
    'main_wh' => $raw['main_wh'] ?? [],
    'defect_wh' => $raw['defect_wh'] ?? [],
  ];
}

function defectHint(string $h, string $i): string
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
  if (preg_match('/sklad/u', $t)) {
    return 'sklad';
  }
  return 'пр.';
}

$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS]);
$sheets = new Google_Service_Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'properties.title,sheets.properties']);
$title = null;
foreach ($ss->getSheets() as $sh) {
  $p = $sh->getProperties();
  if ((int) $p->getSheetId() === $preferGid) {
    $title = $p->getTitle();
    break;
  }
}
if (!$title) {
  fwrite(STDERR, "Лист gid={$preferGid} не найден\n");
  exit(1);
}
fwrite(STDERR, "Источник: {$title} (gid={$preferGid})\n");

$range = "'" . str_replace("'", "''", $title) . "'!A2:J5000";
$vals = $sheets->spreadsheets_values->get($spreadsheetId, $range);
$rowsIn = $vals->getValues() ?: [];

$wmsPack = loadWmsFromJson($wmsJson);
$wmsMain = $wmsPack['main'];
$wmsDefect = $wmsPack['defect'];
fwrite(STDERR, 'WMS основной: ' . ($wmsPack['main_wh']['name'] ?? '') . ' · ' . count($wmsMain) . " SKU\n");
fwrite(STDERR, 'WMS брак: ' . ($wmsPack['defect_wh']['name'] ?? '') . ' · ' . count($wmsDefect) . " SKU\n");

/** @var array<string,array> */
$sheetBySku = [];
$sheetCellSum = 0.0;

foreach ($rowsIn as $r) {
  $sku = normSku((string) ($r[0] ?? ''));
  if ($sku === '') {
    continue;
  }
  $supply = trim((string) ($r[1] ?? ''));
  $cell = trim((string) ($r[3] ?? ''));
  $qtyG = num($r[6] ?? ($r[2] ?? 0));
  $h = trim((string) ($r[7] ?? ''));
  $i = trim((string) ($r[8] ?? ''));
  if (str_starts_with($i, 'http')) {
    $i = '';
  }

  if (!isset($sheetBySku[$sku])) {
    $sheetBySku[$sku] = [
      'sku' => $sku,
      'supply' => $supply,
      'cells' => [],
      'qty_g' => 0.0,
      'h' => '',
      'i' => '',
      'hint' => '',
    ];
  }
  $sheetBySku[$sku]['qty_g'] += $qtyG;
  if ($cell !== '') {
    $sheetBySku[$sku]['cells'][$cell] = ($sheetBySku[$sku]['cells'][$cell] ?? 0) + $qtyG;
  }
  if ($h !== '') {
    $sheetBySku[$sku]['h'] = $sheetBySku[$sku]['h'] === '' ? $h : $sheetBySku[$sku]['h'] . '; ' . $h;
  }
  if ($i !== '') {
    $sheetBySku[$sku]['i'] = $sheetBySku[$sku]['i'] === '' ? $i : $sheetBySku[$sku]['i'] . '; ' . $i;
  }
  $sheetCellSum += $qtyG;
}
foreach ($sheetBySku as &$s) {
  $s['hint'] = defectHint($s['h'], $s['i']);
  $s['cells_str'] = implode(', ', array_map(
    static fn($c, $q) => $c . ($q > 1 ? "×{$q}" : ''),
    array_keys($s['cells']),
    array_values($s['cells'])
  ));
}
unset($s);

$outRows = [];
$outRows[] = [
  'Статус',
  'SKU',
  'Поставка',
  'Ячейки',
  'G финал',
  'H (лист)',
  'I (лист)',
  'Метка H/I',
  'WMS Основной',
  'WMS Брак',
  'Δ G−Основной',
  'Комментарий',
];

$stats = [
  'ok' => 0,
  'qty_mismatch' => 0,
  'only_sheet' => 0,
  'only_wms' => 0,
  'defect_marked' => 0,
  'defect_in_wms' => 0,
];

$sheetSkus = array_keys($sheetBySku);
sort($sheetSkus);

foreach ($sheetSkus as $sku) {
  $s = $sheetBySku[$sku];
  $g = $s['qty_g'];
  $wm = $wmsMain[$sku] ?? 0.0;
  $wd = $wmsDefect[$sku] ?? 0.0;
  $dMain = round($g - $wm, 4);
  $hint = $s['hint'];

  $status = 'OK';
  $comment = '';

  if ($hint === 'брак') {
    $stats['defect_marked']++;
    if ($wd > 0) {
      $stats['defect_in_wms']++;
    } else {
      $comment = 'Помечен брак на листе, в WMS «Склад Брак» 0';
    }
  }

  if (abs($g) < 0.0001) {
    $status = 'G=0';
  } elseif (abs($wm) < 0.0001) {
    $status = 'К загрузке';
    $stats['only_sheet']++;
    $comment = trim($comment . '; G>0, WMS Основной 0');
  } elseif (abs($dMain) > 0.0001) {
    $status = '≠ WMS';
    $stats['qty_mismatch']++;
    $comment = trim($comment . '; G≠WMS Основной');
  } else {
    $stats['ok']++;
  }

  if ($wm > 100000) {
    $comment = trim($comment . '; WMS qty подозрительно большой');
  }

  $outRows[] = [
    $status,
    $sku,
    $s['supply'],
    $s['cells_str'],
    $g ?: '',
    $s['h'],
    $s['i'],
    $hint,
    $wm ?: '',
    $wd ?: '',
    $dMain ?: '',
    trim($comment, '; '),
  ];
}

$wmsOnlyRows = [];
foreach ($wmsMain as $sku => $wm) {
  if (isset($sheetBySku[$sku]) || abs($wm) < 0.0001) {
    continue;
  }
  $stats['only_wms']++;
  $wmsOnlyRows[] = [$sku, $wm, $wmsDefect[$sku] ?? ''];
}
usort($wmsOnlyRows, static fn($a, $b) => ($b[1] <=> $a[1]));
$wmsOnlyRows = array_slice($wmsOnlyRows, 0, 100);

$summaryBlock = [
  ['Сводка адресного хранения · Пневмоподвеска Москва', date('Y-m-d H:i'), 'Лист: ' . $title],
  ['SKU на листе (уник.)', count($sheetBySku)],
  ['Σ G (финал по ячейкам)', round($sheetCellSum, 2)],
  ['WMS Основной SKU', count($wmsMain)],
  ['WMS Брак SKU', count($wmsDefect)],
  ['Сходится (G=WMS Основной)', $stats['ok']],
  ['Расхождение G≠WMS', $stats['qty_mismatch']],
  ['К загрузке (G>0, WMS=0)', $stats['only_sheet']],
  ['WMS Основной без ячейки (всего SKU)', $stats['only_wms']],
  ['Помечено «брак» в H/I', $stats['defect_marked']],
  ['Из них есть в WMS Брак', $stats['defect_in_wms']],
  ['Сервисный аккаунт (для записи вкладки)', 'pnevmopodveska1-bank@pnevmopodveska1.iam.gserviceaccount.com'],
];

$csvPath = dirname(__DIR__) . '/data/cells-reconcile-summary.csv';
@mkdir(dirname($csvPath), 0775, true);
$fp = fopen($csvPath, 'w');
if ($fp) {
  foreach (array_merge($summaryBlock, [[]], $outRows, [[]], [['WMS без строки на листе (топ-100 по qty)'], ['SKU', 'WMS Основной', 'WMS Брак']], $wmsOnlyRows) as $row) {
    fputcsv($fp, $row);
  }
  fclose($fp);
  fwrite(STDERR, "CSV → {$csvPath}\n");
}

fwrite(STDERR, json_encode(['stats' => $stats], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n");

if ($csvOnly) {
  fwrite(STDOUT, "csv-only OK\n");
  exit(0);
}

$existingSummaryId = null;
foreach ($ss->getSheets() as $sh) {
  if ($sh->getProperties()->getTitle() === $summaryTitle) {
    $existingSummaryId = (int) $sh->getProperties()->getSheetId();
    break;
  }
}

$requests = [];
if ($existingSummaryId !== null) {
  $requests[] = ['deleteSheet' => ['sheetId' => $existingSummaryId]];
}
$requests[] = [
  'addSheet' => [
    'properties' => [
      'title' => $summaryTitle,
      'gridProperties' => [
        'rowCount' => max(500, count($outRows) + 20),
        'columnCount' => 12,
      ],
    ],
  ],
];

try {
  $resp = $sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google_Service_Sheets_BatchUpdateSpreadsheetRequest(['requests' => $requests])
  );
} catch (Google\Service\Exception $e) {
  fwrite(STDERR, "Нет прав на запись в таблицу. Дайте Editor для pnevmopodveska1-bank@pnevmopodveska1.iam.gserviceaccount.com\n");
  fwrite(STDERR, "CSV сохранён локально: {$csvPath}\n");
  exit(2);
}

$newSheetId = null;
foreach ($resp->getReplies() as $reply) {
  if ($reply->getAddSheet()) {
    $newSheetId = (int) $reply->getAddSheet()->getProperties()->getSheetId();
  }
}

$body = new Google_Service_Sheets_ValueRange([
  'range' => "'" . str_replace("'", "''", $summaryTitle) . "'!A1",
  'majorDimension' => 'ROWS',
  'values' => array_merge(
    $summaryBlock,
    [[]],
    $outRows,
    [[]],
    [['WMS без строки на листе (топ-100 по qty)'], ['SKU', 'WMS Основной', 'WMS Брак']],
    $wmsOnlyRows
  ),
]);
$sheets->spreadsheets_values->update(
  $spreadsheetId,
  $body->getRange(),
  $body,
  ['valueInputOption' => 'USER_ENTERED']
);

$sheets->spreadsheets->batchUpdate(
  $spreadsheetId,
  new Google_Service_Sheets_BatchUpdateSpreadsheetRequest([
    'requests' => [
      [
        'updateSheetProperties' => [
          'properties' => [
            'sheetId' => $newSheetId,
            'gridProperties' => ['frozenRowCount' => count($summaryBlock) + 2],
          ],
          'fields' => 'gridProperties.frozenRowCount',
        ],
      ],
    ],
  ])
);

$url = 'https://docs.google.com/spreadsheets/d/' . $spreadsheetId . '/edit#gid=' . $newSheetId;
fwrite(STDOUT, "OK → {$summaryTitle}\n{$url}\n");
