<?php
/**
 * Новая вкладка «Расхождения ДД.ММ.ГГГГ» в книге «Март. Ячейки».
 * Исходные недельные листы НЕ трогаем — только добавляем вкладку.
 *
 * Эталон для сравнения (только чтение): последний или --sheet=03-11.08
 * WMS: JSON с prod (см. tools/export-wms-cells-json.sh)
 *
 * Usage:
 *   bash tools/export-wms-cells-json.sh   # на VPS → /tmp/wms-cells-full.json
 *   scp bank-vps:/tmp/wms-cells-full.json /tmp/
 *   php tools/create-cells-discrepancy-sheet.php --wms-json=/tmp/wms-cells-full.json
 *   php tools/create-cells-discrepancy-sheet.php --wms-json=… --sheet=03-11.08 --dry-run
 */
declare(strict_types=1);

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

[$credPath, $autoload] = cellsToolBankPaths();
$spreadsheetId = '1QvYC0DS9JSO-NFrjmMG1NAqa1jxwbpIVUBs1ygJqyfw';

$refSheet = '03-11.08';
$refGid = 1253208747;
$wmsJson = '/tmp/wms-cells-full.json';
$dryRun = false;
$csvOnly = false;
$replaceTab = true;
$dateLabel = date('d.m.Y');

foreach ($argv as $arg) {
  if (str_starts_with($arg, '--sheet=')) {
    $refSheet = substr($arg, 8);
  }
  if (str_starts_with($arg, '--gid=')) {
    $refGid = (int) substr($arg, 6);
  }
  if (str_starts_with($arg, '--wms-json=')) {
    $wmsJson = substr($arg, 11);
  }
  if (str_starts_with($arg, '--date=')) {
    $dateLabel = substr($arg, 7);
  }
  if ($arg === '--dry-run') {
    $dryRun = true;
  }
  if ($arg === '--csv-only') {
    $csvOnly = true;
  }
  if ($arg === '--no-replace') {
    $replaceTab = false;
  }
}

$tabTitle = 'Расхождения ' . $dateLabel;

if (!is_file($autoload) || !is_file($credPath)) {
  fwrite(STDERR, "Нет Google credentials/vendor\n");
  exit(1);
}
if (!is_file($wmsJson)) {
  fwrite(STDERR, "Нет WMS JSON: {$wmsJson}\n");
  fwrite(STDERR, "Сначала: bash tools/export-wms-cells-json.sh && scp bank-vps:/tmp/wms-cells-full.json /tmp/\n");
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

function stripDeptSkuSuffix(string $sku): string
{
  $s = trim($sku);
  if ($s === '') {
    return '';
  }
  $at = strpos($s, '@');
  if ($at > 0) {
    $tail = strtolower(substr($s, $at + 1));
    if (str_starts_with($tail, 'podveska') || str_starts_with($tail, 'fogel')) {
      $afterAt = substr($s, $at + 1);
      $colonIdx = strpos($afterAt, ':');
      return trim($colonIdx >= 0 ? substr($s, 0, $at) . substr($afterAt, $colonIdx) : substr($s, 0, $at));
    }
  }
  return $s;
}

function skuKey(string $sku): string
{
  return normSku(stripDeptSkuSuffix($sku));
}

function looksLikeInternalCode(string $s): bool
{
  $s = trim($s);
  return $s !== '' && preg_match('/^(00-000|00)?НФ-|УСЛ-/iu', $s);
}

function looksLikeCatalogArticle(string $s): bool
{
  $s = trim($s);
  return $s !== '' && !looksLikeInternalCode($s) && !str_contains($s, '@');
}

/** @return array{code: string, article: string, name: string} */
function catalogArticleFromParts(string $sku, string $barcode, string $code): array
{
  $barcode = trim($barcode);
  $sku = trim(stripDeptSkuSuffix($sku));
  $article = '';
  if ($barcode !== '' && looksLikeCatalogArticle($barcode)) {
    $article = normSku($barcode);
  } elseif ($sku !== '' && looksLikeCatalogArticle($sku)) {
    $article = normSku($sku);
  }
  return [
    'code' => trim($code),
    'article' => $article,
    'name' => '',
  ];
}

/**
 * @param array<int, array<string, mixed>> $items
 * @return array<string, array{code: string, article: string, name: string}>
 */
function buildProductCatalog(array $items): array
{
  usort($items, static fn($a, $b) => (int) ($b['is_main'] ?? 0) <=> (int) ($a['is_main'] ?? 0));
  /** @var array<string, array{code: string, article: string, name: string}> */
  $byKey = [];
  $remember = static function (string $alias, array $row) use (&$byKey): void {
    $k = skuKey($alias);
    if ($k === '' || isset($byKey[$k])) {
      return;
    }
    $byKey[$k] = $row;
  };

  foreach ($items as $p) {
    $parts = catalogArticleFromParts(
      (string) ($p['sku'] ?? ''),
      (string) ($p['barcode'] ?? ''),
      (string) ($p['code'] ?? '')
    );
    $row = [
      'code' => $parts['code'],
      'article' => $parts['article'],
      'name' => trim((string) ($p['name'] ?? '')),
    ];
    foreach ([
      (string) ($p['sku'] ?? ''),
      (string) ($p['barcode'] ?? ''),
      (string) ($p['code'] ?? ''),
      (string) ($p['warehouse_sku'] ?? ''),
      stripDeptSkuSuffix((string) ($p['sku'] ?? '')),
    ] as $alias) {
      if (trim($alias) !== '') {
        $remember($alias, $row);
      }
    }
  }
  return $byKey;
}

/** @param array<string, array{code: string, article: string, name: string}> $catalog */
function resolveProductInfo(string $key, array $catalog): array
{
  foreach ([skuKey($key), normSku($key)] as $try) {
    if ($try !== '' && isset($catalog[$try])) {
      return $catalog[$try];
    }
  }
  $key = trim($key);
  return [
    'code' => looksLikeInternalCode($key) ? $key : '',
    'article' => looksLikeCatalogArticle($key) ? normSku($key) : '',
    'name' => '',
  ];
}

/** @return string */
function normCell(string $raw): string
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

/** @return array{rack: string, cell: string, full: string} */
function splitRackCell(string $code): array
{
  $full = normCell($code);
  if ($full === '') {
    return ['rack' => '', 'cell' => '', 'full' => ''];
  }
  if (preg_match('/^(A13)\.(C\d+)$/u', $full, $m)) {
    return ['rack' => $m[1], 'cell' => $m[2], 'full' => $full];
  }
  if (preg_match('/^([ABП])\.(\d+)$/u', $full, $m)) {
    return ['rack' => $m[1], 'cell' => $m[2], 'full' => $full];
  }
  if (preg_match('/^([AB])(\d+)\.(\d+)$/u', $full, $m)) {
    return ['rack' => $m[1] . $m[2], 'cell' => $m[3], 'full' => $full];
  }
  return ['rack' => $full, 'cell' => '', 'full' => $full];
}

/** @param array<string,mixed> $raw */
function loadWms(string $path): array
{
  $raw = json_decode((string) file_get_contents($path), true);
  if (!is_array($raw)) {
    throw new RuntimeException('Bad WMS JSON');
  }
  return $raw;
}

$wms = loadWms($wmsJson);
$whName = (string) ($wms['warehouse']['name'] ?? 'ФИЛИАЛ МОСКВА');
$whCode = (string) ($wms['warehouse']['code'] ?? 'НФ-000032');
$productCatalog = buildProductCatalog($wms['products'] ?? []);

/** @var array<string,float> */
$mainQty = [];
foreach ($wms['main_stock'] ?? [] as $sku => $q) {
  $k = skuKey((string) $sku);
  $mainQty[$k] = ($mainQty[$k] ?? 0) + (float) $q;
}

/** @var array<string,array> */
$wmsByKey = [];
/** @var array<string,float> */
$wmsSkuSum = [];
/** @var array<string,string> */
$productNames = [];
foreach ($wms['cell_lines'] ?? [] as $line) {
  $sku = skuKey((string) ($line['sku'] ?? ''));
  $parts = splitRackCell((string) ($line['cell'] ?? ''));
  $full = $parts['full'];
  if ($sku === '' || $full === '') {
    continue;
  }
  $key = $sku . '|' . $full;
  $q = (float) ($line['qty'] ?? 0);
  if (!isset($wmsByKey[$key])) {
    $wmsByKey[$key] = [
      'sku' => $sku,
      'supply' => (string) ($line['supply'] ?? ''),
      'name' => (string) ($line['name'] ?? ''),
      'rack' => $parts['rack'],
      'cell' => $parts['cell'],
      'full' => $full,
      'qty' => 0.0,
    ];
  }
  $wmsByKey[$key]['qty'] += $q;
  $wmsSkuSum[$sku] = ($wmsSkuSum[$sku] ?? 0) + $q;
  if ($line['name'] ?? '') {
    $productNames[$sku] = (string) $line['name'];
  }
}

$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS]);
$sheets = new Google_Service_Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'properties.title,sheets.properties']);
$refTitle = $refSheet;
foreach ($ss->getSheets() as $sh) {
  $p = $sh->getProperties();
  if ((int) $p->getSheetId() === $refGid || $p->getTitle() === $refSheet) {
    $refTitle = $p->getTitle();
    break;
  }
}

$range = "'" . str_replace("'", "''", $refTitle) . "'!A2:J5000";
$vals = $sheets->spreadsheets_values->get($spreadsheetId, $range);
$rowsIn = $vals->getValues() ?: [];

/** @var array<string,array> */
$sheetByKey = [];
/** @var array<string,array> */
$sheetNoCell = [];
/** @var array<string,float> */
$sheetSkuSum = [];

foreach ($rowsIn as $r) {
  $sku = skuKey((string) ($r[0] ?? ''));
  if ($sku === '') {
    continue;
  }
  $supply = trim((string) ($r[1] ?? ''));
  $cellRaw = trim((string) ($r[3] ?? ''));
  $qtyG = num($r[6] ?? ($r[2] ?? 0));
  if ($qtyG <= 0) {
    continue;
  }
  $sheetSkuSum[$sku] = ($sheetSkuSum[$sku] ?? 0) + $qtyG;
  $parts = splitRackCell($cellRaw);
  if ($parts['full'] === '') {
    if (!isset($sheetNoCell[$sku])) {
      $sheetNoCell[$sku] = ['sku' => $sku, 'supply' => $supply, 'qty' => 0.0];
    }
    $sheetNoCell[$sku]['qty'] += $qtyG;
    continue;
  }
  $key = $sku . '|' . $parts['full'];
  if (!isset($sheetByKey[$key])) {
    $sheetByKey[$key] = [
      'sku' => $sku,
      'supply' => $supply,
      'rack' => $parts['rack'],
      'cell' => $parts['cell'],
      'full' => $parts['full'],
      'qty' => 0.0,
    ];
  }
  $sheetByKey[$key]['qty'] += $qtyG;
}

/** @var list<array<int|string>> */
$outRows = [];
$stats = [
  'no_address' => 0,
  'only_sheet' => 0,
  'only_wms' => 0,
  'qty_mismatch' => 0,
  'main_no_cell' => 0,
];

/** Человекочитаемый статус + подсказка. */
function humanStatus(string $code): string
{
  return match ($code) {
    'NO_CELL_SHEET' => 'На листе нет ячейки',
    'MISSING_WMS' => 'Нет в WMS',
    'ONLY_WMS' => 'Только в WMS',
    'QTY_DIFF' => 'Разное количество',
    'MAIN_NO_ADDR' => 'На складе есть, адрес не указан',
    default => $code,
  };
}

function formatAddr(string $rack, string $full): string
{
  $full = trim($full);
  if ($full !== '') {
    return $full;
  }
  return trim($rack);
}

$push = static function (
  string $statusCode,
  array $row,
  string $comment = ''
) use (&$outRows, $productCatalog): void {
  $info = resolveProductInfo((string) ($row['sku'] ?? ''), $productCatalog);
  $name = trim((string) ($row['name'] ?? ''));
  if ($name === '') {
    $name = $info['name'];
  }
  $article = $info['article'];
  if ($article === '' && looksLikeCatalogArticle((string) ($row['sku'] ?? ''))) {
    $article = skuKey((string) $row['sku']);
  }
  $outRows[] = [
    humanStatus($statusCode),
    $info['code'],
    $article,
    $name,
    $row['supply'] ?? '',
    $row['wms_cell_qty'] ?? '',
    $row['sheet_qty'] ?? '',
    $row['main_qty'] ?? '',
    formatAddr($row['wms_rack'] ?? '', $row['wms_cell'] ?? ''),
    formatAddr($row['sheet_rack'] ?? '', $row['sheet_cell'] ?? ''),
    '', // ▶ Склад
    '', // ▶ Стеллаж
    '', // ▶ Полка
    $comment,
  ];
};

foreach ($sheetNoCell as $s) {
  $stats['no_address']++;
  $push('NO_CELL_SHEET', [
    'sku' => $s['sku'],
    'name' => $productNames[$s['sku']] ?? '',
    'supply' => $s['supply'],
    'wms_cell_qty' => $wmsSkuSum[$s['sku']] ?? '',
    'sheet_qty' => $s['qty'],
    'main_qty' => $mainQty[$s['sku']] ?? '',
    'wms_rack' => '',
    'wms_cell' => '',
    'sheet_rack' => '',
    'sheet_cell' => '',
  ], 'В инвентаризации есть qty, но адрес пустой — укажите где лежит');
}

$allKeys = array_unique(array_merge(array_keys($sheetByKey), array_keys($wmsByKey)));
sort($allKeys);

foreach ($allKeys as $key) {
  $s = $sheetByKey[$key] ?? null;
  $w = $wmsByKey[$key] ?? null;
  $sku = $s['sku'] ?? $w['sku'];
  $base = [
    'sku' => $sku,
    'name' => $productNames[$sku] ?? '',
    'supply' => $s['supply'] ?? ($w['supply'] ?? ''),
    'main_qty' => $mainQty[$sku] ?? '',
    'wms_rack' => $w['rack'] ?? '',
    'wms_cell' => $w['full'] ?? '',
    'sheet_rack' => $s['rack'] ?? '',
    'sheet_cell' => $s['full'] ?? '',
  ];
  if ($s && !$w) {
    $stats['only_sheet']++;
    $push('MISSING_WMS', array_merge($base, [
      'wms_cell_qty' => '',
      'sheet_qty' => $s['qty'],
    ]), 'На листе указан адрес — в WMS не найдено; впишите фактический адрес');
  } elseif ($w && !$s) {
    $stats['only_wms']++;
    $push('ONLY_WMS', array_merge($base, [
      'wms_cell_qty' => $w['qty'],
      'sheet_qty' => '',
    ]), 'В WMS адрес есть, на листе инвентаризации нет — подтвердите или исправьте');
  } elseif ($s && $w && abs($s['qty'] - $w['qty']) > 0.001) {
    $stats['qty_mismatch']++;
    $push('QTY_DIFF', array_merge($base, [
      'wms_cell_qty' => $w['qty'],
      'sheet_qty' => $s['qty'],
    ]), 'Количество не сходится — укажите верный адрес и qty');
  }
}

foreach ($mainQty as $sku => $mq) {
  if ($mq <= 0) {
    continue;
  }
  $inCells = $wmsSkuSum[$sku] ?? 0;
  if ($inCells + 0.001 >= $mq) {
    continue;
  }
  // уже есть строка «нет адреса» / «нет в wms» по этому SKU
  $already = false;
  foreach ($outRows as $row) {
    if (skuKey((string) ($row[2] ?? '')) === $sku || skuKey((string) ($row[1] ?? '')) === $sku) {
      $already = true;
      break;
    }
  }
  if ($already) {
    continue;
  }
  $stats['main_no_cell']++;
  if ($stats['main_no_cell'] > 200) {
    break;
  }
  $push('MAIN_NO_ADDR', [
    'sku' => $sku,
    'name' => $productNames[$sku] ?? '',
    'supply' => '',
    'wms_cell_qty' => $inCells ?: '',
    'sheet_qty' => $sheetSkuSum[$sku] ?? '',
    'main_qty' => $mq,
    'wms_rack' => '',
    'wms_cell' => '',
    'sheet_rack' => '',
    'sheet_cell' => '',
  ], 'Товар числится на складе MAIN, но не разложен по ячейкам');
}

usort($outRows, static function ($a, $b) {
  $order = [
    'На листе нет ячейки' => 0,
    'Нет в WMS' => 1,
    'Разное количество' => 2,
    'На складе есть, адрес не указан' => 3,
    'Только в WMS' => 4,
  ];
  $oa = $order[$a[0]] ?? 9;
  $ob = $order[$b[0]] ?? 9;
  if ($oa !== $ob) {
    return $oa <=> $ob;
  }
  return strcmp((string) ($a[2] ?? ''), (string) ($b[2] ?? ''));
});

$header = [
  'Что не так',
  'Код 1С',
  'Артикул',
  'Название',
  'Партия',
  'Кол-во в WMS',
  'Кол-во на листе',
  'Кол-во на складе',
  'Адрес в WMS',
  'Адрес на листе',
  '▶ Склад',
  '▶ Стеллаж',
  '▶ Полка',
  'Что сделать',
];

$colCount = count($header);

/** @param list<string|int|float> $row */
function padSheetRow(array $row, int $cols): array
{
  $row = array_values($row);
  while (count($row) < $cols) {
    $row[] = '';
  }
  return array_slice($row, 0, $cols);
}

$intro = [
  ['Сверка WMS и инвентаризации · ' . $dateLabel],
  ['Склад', $whName . ' (' . $whCode . ')'],
  ['Эталон (только чтение)', $refTitle],
  [
    'Строк',
    count($outRows) .
      ' · без адреса ' . $stats['no_address'] .
      ' · нет в WMS ' . $stats['only_sheet'] .
      ' · qty≠ ' . $stats['qty_mismatch'] .
      ' · MAIN без адреса ' . $stats['main_no_cell'] .
      ' · только WMS ' . $stats['only_wms'],
  ],
  ['Заполните адрес', 'Колонка «Адрес в WMS» — выпадающий список · или жёлтые ▶ Склад/Стеллаж/Полка'],
  ['Примеры', 'A7 + 1 → A7.1 · A13 + C0 → A13.C0 · П + 5 → П.5 · или сразу в ▶ Полка: A7.1'],
  ['Не трогаем', 'Вкладки «03-…» «24-29.08» — правки только в ▶ здесь'],
  padSheetRow([], $colCount),
];
$intro = array_map(static fn($r) => padSheetRow($r, $colCount), $intro);
$header = padSheetRow($header, $colCount);
$outRows = array_map(static fn($r) => padSheetRow($r, $colCount), $outRows);

fwrite(STDERR, json_encode(['tab' => $tabTitle, 'stats' => $stats, 'rows' => count($outRows)], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n");

$csvPath = dirname(__DIR__) . '/data/cells-discrepancies-' . str_replace('.', '-', $dateLabel) . '.csv';
@mkdir(dirname($csvPath), 0775, true);
$fp = fopen($csvPath, 'w');
if ($fp) {
  foreach (array_merge($intro, [$header], $outRows) as $row) {
    fputcsv($fp, $row, ',', '"', '\\');
  }
  fclose($fp);
  fwrite(STDERR, "CSV → {$csvPath}\n");
}

if ($dryRun || $csvOnly) {
  fwrite(STDOUT, ($csvOnly ? 'csv-only' : 'dry-run') . " OK · {$tabTitle} · " . count($outRows) . " rows\n{$csvPath}\n");
  exit(0);
}

// Вкладка: обновить существующую или создать новую
$existingByTitle = [];
foreach ($ss->getSheets() as $sh) {
  $p = $sh->getProperties();
  $existingByTitle[$p->getTitle()] = (int) $p->getSheetId();
}

$finalTitle = $tabTitle;
$newSheetId = null;

if ($replaceTab && isset($existingByTitle[$tabTitle])) {
  $newSheetId = $existingByTitle[$tabTitle];
  $finalTitle = $tabTitle;
} else {
  $n = 2;
  while (isset($existingByTitle[$finalTitle])) {
    $finalTitle = $tabTitle . ' (' . $n . ')';
    $n++;
  }
  try {
    $resp = $sheets->spreadsheets->batchUpdate(
      $spreadsheetId,
      new Google_Service_Sheets_BatchUpdateSpreadsheetRequest([
        'requests' => [[
          'addSheet' => [
            'properties' => [
              'title' => $finalTitle,
              'gridProperties' => [
                'rowCount' => max(500, count($outRows) + 40),
                'columnCount' => 14,
              ],
            ],
          ],
        ]],
      ])
    );
  } catch (Google\Service\Exception $e) {
    fwrite(STDERR, "Нет прав на запись в таблицу. Дайте Editor для:\n");
    fwrite(STDERR, "  pnevmopodveska1-bank@pnevmopodveska1.iam.gserviceaccount.com\n");
    fwrite(STDERR, "CSV готов — импортируйте как новую вкладку вручную: {$csvPath}\n");
    exit(2);
  }
  foreach ($resp->getReplies() as $reply) {
    if ($reply->getAddSheet()) {
      $newSheetId = (int) $reply->getAddSheet()->getProperties()->getSheetId();
    }
  }
}

if ($newSheetId === null) {
  fwrite(STDERR, "Не удалось получить sheetId\n");
  exit(2);
}

$clearRange = "'" . str_replace("'", "''", $finalTitle) . "'!A1:P500";
$sheets->spreadsheets_values->clear(
  $spreadsheetId,
  $clearRange,
  new Google_Service_Sheets_ClearValuesRequest()
);

$allValues = array_merge($intro, [$header], $outRows);
$body = new Google_Service_Sheets_ValueRange([
  'range' => "'" . str_replace("'", "''", $finalTitle) . "'!A1",
  'majorDimension' => 'ROWS',
  'values' => $allValues,
]);
$sheets->spreadsheets_values->update(
  $spreadsheetId,
  $body->getRange(),
  $body,
  ['valueInputOption' => 'USER_ENTERED']
);

if ($newSheetId !== null) {
  $headerRowIdx = count($intro);
  $sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google_Service_Sheets_BatchUpdateSpreadsheetRequest([
      'requests' => [
        [
          'updateSheetProperties' => [
            'properties' => [
              'sheetId' => $newSheetId,
              'gridProperties' => ['frozenRowCount' => $headerRowIdx + 1],
            ],
            'fields' => 'gridProperties.frozenRowCount',
          ],
        ],
        [
          'repeatCell' => [
            'range' => [
              'sheetId' => $newSheetId,
              'startRowIndex' => $headerRowIdx,
              'endRowIndex' => $headerRowIdx + 1 + count($outRows),
              'startColumnIndex' => 10,
              'endColumnIndex' => 13,
            ],
            'cell' => [
              'userEnteredFormat' => [
                'backgroundColor' => ['red' => 1.0, 'green' => 0.95, 'blue' => 0.75],
              ],
            ],
            'fields' => 'userEnteredFormat.backgroundColor',
          ],
        ],
        [
          'repeatCell' => [
            'range' => [
              'sheetId' => $newSheetId,
              'startRowIndex' => 0,
              'endRowIndex' => $headerRowIdx,
              'startColumnIndex' => 0,
              'endColumnIndex' => 14,
            ],
            'cell' => [
              'userEnteredFormat' => [
                'textFormat' => ['bold' => true],
                'wrapStrategy' => 'WRAP',
              ],
            ],
            'fields' => 'userEnteredFormat(textFormat,wrapStrategy)',
          ],
        ],
      ],
    ])
  );
}

require_once __DIR__ . '/add-cells-discrepancy-dropdowns.php';
$cellCodes = cellsDiscrepancyCollectCellCodes($sheets, $spreadsheetId, $finalTitle, $wmsJson, $refTitle);
cellsDiscrepancyApplyDropdowns(
  $sheets,
  $spreadsheetId,
  $finalTitle,
  $newSheetId,
  $headerRowIdx,
  count($outRows),
  $cellCodes,
  8
);

$url = 'https://docs.google.com/spreadsheets/d/' . $spreadsheetId . '/edit#gid=' . $newSheetId;
fwrite(STDOUT, "OK → {$finalTitle}\n{$url}\n");
