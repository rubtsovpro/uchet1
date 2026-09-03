<?php
/**
 * Дописать «Код 1С» / «Артикул» / «Название» на вкладке расхождений из каталога WMS.
 * Строки расхождений и правки пользователя в ▶ не трогаем — только пустые B:C:D.
 *
 * Usage:
 *   bash tools/export-wms-cells-json.sh   # на VPS
 *   scp bank-vps:/tmp/wms-cells-full.json /tmp/
 *   php tools/enrich-cells-discrepancy-names.php --tab="Расхождения 26.08.2026" --wms-json=/tmp/wms-cells-full.json
 *   php tools/enrich-cells-discrepancy-names.php --tab="…" --dry-run
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
  if ($at !== false && $at > 0) {
    $tail = strtolower(substr($s, $at + 1));
    if (str_starts_with($tail, 'podveska') || str_starts_with($tail, 'fogel')) {
      $afterAt = substr($s, $at + 1);
      $colonIdx = strpos($afterAt, ':');
      return trim($colonIdx !== false ? substr($s, 0, $at) . substr($afterAt, $colonIdx) : substr($s, 0, $at));
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

/** @param array<int, array<string, mixed>> $items */
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
  foreach ([skuKey($key), normSku($key), normSku(stripDeptSkuSuffix($key))] as $try) {
    if ($try !== '' && isset($catalog[$try])) {
      return $catalog[$try];
    }
  }
  $key = trim($key);
  return [
    'code' => looksLikeInternalCode($key) ? stripDeptSkuSuffix($key) : '',
    'article' => looksLikeCatalogArticle($key) ? normSku(stripDeptSkuSuffix($key)) : '',
    'name' => '',
  ];
}

$spreadsheetId = '1QvYC0DS9JSO-NFrjmMG1NAqa1jxwbpIVUBs1ygJqyfw';
$tabTitle = 'Расхождения 26.08.2026';
$wmsJson = '/tmp/wms-cells-full.json';
$dryRun = false;

foreach ($argv as $arg) {
  if (str_starts_with($arg, '--tab=')) {
    $tabTitle = substr($arg, 6);
  }
  if (str_starts_with($arg, '--wms-json=')) {
    $wmsJson = substr($arg, 11);
  }
  if ($arg === '--dry-run') {
    $dryRun = true;
  }
}

[$credPath, $autoload] = cellsToolBankPaths();
if (!is_file($autoload) || !is_file($credPath)) {
  fwrite(STDERR, "Нет Google credentials/vendor\n");
  exit(1);
}
if (!is_file($wmsJson)) {
  fwrite(STDERR, "Нет WMS JSON: {$wmsJson}\n");
  exit(1);
}

require $autoload;

$wms = json_decode((string) file_get_contents($wmsJson), true);
if (!is_array($wms)) {
  fwrite(STDERR, "Bad WMS JSON\n");
  exit(1);
}
$catalog = buildProductCatalog($wms['products'] ?? []);

$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS]);
$sheets = new Google_Service_Sheets($client);

$range = "'" . str_replace("'", "''", $tabTitle) . "'!A1:N2000";
$resp = $sheets->spreadsheets_values->get($spreadsheetId, $range);
$values = $resp->getValues() ?? [];

$headerRow = -1;
$colCode = -1;
$colArticle = -1;
$colName = -1;
$legacySkuInArticleCol = false;
for ($i = 0; $i < min(20, count($values)); $i++) {
  $row = $values[$i] ?? [];
  foreach ($row as $j => $cell) {
    $t = trim((string) $cell);
    if ($t === 'Код 1С') {
      $colCode = (int) $j;
    }
    if ($t === 'Артикул') {
      $colArticle = (int) $j;
    }
    if ($t === 'Название') {
      $colName = (int) $j;
    }
  }
  if ($colName >= 0 && ($colCode >= 0 || $colArticle >= 0)) {
    $headerRow = $i;
    $legacySkuInArticleCol = $colCode < 0 && $colArticle >= 0;
    break;
  }
}

if ($headerRow < 0 || $colName < 0) {
  fwrite(STDERR, "Не найден заголовок «Название» (+ «Код 1С» или «Артикул») на вкладке {$tabTitle}\n");
  exit(1);
}
if ($colArticle < 0) {
  $colArticle = $colCode >= 0 ? $colCode + 1 : 1;
}

/** @var list<array{range:string,values:list<list<string>>}> $updates */
$updates = [];
$filled = 0;
$skipped = 0;
$missing = 0;

for ($r = $headerRow + 1; $r < count($values); $r++) {
  $row = $values[$r] ?? [];
  $status = trim((string) ($row[0] ?? ''));
  if ($status === '' || str_starts_with($status, 'Сверка ') || $status === 'Склад' || $status === 'Эталон (только чтение)') {
    continue;
  }

  $code = $colCode >= 0 ? trim((string) ($row[$colCode] ?? '')) : '';
  $article = trim((string) ($row[$colArticle] ?? ''));
  $name = trim((string) ($row[$colName] ?? ''));

  $lookupKeys = array_filter([$code, $article]);
  if ($legacySkuInArticleCol && $article !== '') {
    $lookupKeys = [$article, ...$lookupKeys];
  }
  if (!$lookupKeys) {
    foreach ($row as $cell) {
      $c = trim((string) $cell);
      if ($c !== '' && (str_contains($c, '@') || looksLikeInternalCode($c) || looksLikeCatalogArticle($c))) {
        $lookupKeys[] = $c;
        break;
      }
    }
  }
  if (!$lookupKeys) {
    $skipped++;
    continue;
  }

  $info = resolveProductInfo($lookupKeys[0], $catalog);
  if ($info['name'] === '' && count($lookupKeys) > 1) {
    foreach (array_slice($lookupKeys, 1) as $k) {
      $try = resolveProductInfo($k, $catalog);
      if ($try['name'] !== '') {
        $info = $try;
        break;
      }
    }
  }

  if ($info['name'] === '') {
    $missing++;
    continue;
  }

  $newCode = $code;
  $newArticle = $article;
  $newName = $name !== '' ? $name : $info['name'];

  // Старый лист: в «Артикул» лежит sku/код 1С — не затираем, только дописываем название.
  if (!$legacySkuInArticleCol) {
    if ($newCode === '' && $info['code'] !== '') {
      $newCode = $info['code'];
    }
    if ($newArticle === '' && $info['article'] !== '') {
      $newArticle = $info['article'];
    }
  }

  if ($newName === $name && $newCode === $code && $newArticle === $article) {
    $skipped++;
    continue;
  }

  $sheetRow = $r + 1;
  $colLetter = static function (int $idx): string {
    $idx++;
    $s = '';
    while ($idx > 0) {
      $idx--;
      $s = chr(65 + ($idx % 26)) . $s;
      $idx = intdiv($idx, 26);
    }
    return $s;
  };

  if ($colCode >= 0 && $newCode !== $code && $code === '') {
    $updates[] = [
      'range' => "'" . str_replace("'", "''", $tabTitle) . "'!" . $colLetter($colCode) . $sheetRow,
      'values' => [[$newCode]],
    ];
  }
  if (!$legacySkuInArticleCol && $newArticle !== $article && $article === '') {
    $updates[] = [
      'range' => "'" . str_replace("'", "''", $tabTitle) . "'!" . $colLetter($colArticle) . $sheetRow,
      'values' => [[$newArticle]],
    ];
  }
  if ($newName !== $name) {
    $updates[] = [
      'range' => "'" . str_replace("'", "''", $tabTitle) . "'!" . $colLetter($colName) . $sheetRow,
      'values' => [[$newName]],
    ];
  }
  $filled++;
}

fwrite(STDERR, json_encode([
  'tab' => $tabTitle,
  'header_row' => $headerRow + 1,
  'filled_rows' => $filled,
  'skipped' => $skipped,
  'missing_in_catalog' => $missing,
  'cell_updates' => count($updates),
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n");

if ($dryRun || !$updates) {
  fwrite(STDOUT, ($dryRun ? 'dry-run ' : '') . "OK · updates=" . count($updates) . "\n");
  exit(0);
}

$body = new Google_Service_Sheets_BatchUpdateValuesRequest([
  'valueInputOption' => 'RAW',
  'data' => $updates,
]);
$sheets->spreadsheets_values->batchUpdate($spreadsheetId, $body);
fwrite(STDOUT, "OK · {$tabTitle} · names filled: {$filled} · cells updated: " . count($updates) . "\n");
