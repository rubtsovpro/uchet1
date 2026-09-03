<?php
/**
 * Средние цены услуг из order_items виджета → Google Sheet «Услуги», колонка «Средняя».
 *
 *   MIN_PRICE=1000       только строки сделок с price >= 1000 ₽ (по умолчанию)
 *   --prices-only        только «Средняя», не трогать «Активна» / дубли
 *
 *   php tools/sync_services_sheet_prices_and_dedupe.php --prices-only
 *   php tools/sync_services_sheet_prices_and_dedupe.php --dry-run --prices-only
 */
declare(strict_types=1);

function servicesToolBankPaths(): array
{
    $candidates = [
        dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html',
        dirname(__DIR__) . '/../bank_pnevmopodveska1_ru/public_html',
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

function amoConfigPath(): string
{
    $candidates = [
        dirname(__DIR__, 2) . '/amo1c_pnevmopodveska1_ru/public_html/config.php',
        '/root/amo1c_pnevmopodveska1_ru/public_html/config.php',
    ];
    foreach ($candidates as $p) {
        if (is_file($p)) {
            return $p;
        }
    }

    return '';
}

function wmsSqlitePath(): string
{
    $env = trim((string) (getenv('WMS_SQLITE') ?: ''));
    if ($env !== '' && is_file($env)) {
        return $env;
    }
    $candidates = [
        dirname(__DIR__) . '/data/warehouse.sqlite',
        '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite',
    ];
    foreach ($candidates as $p) {
        if (is_file($p)) {
            return $p;
        }
    }

    return '';
}

function normName(string $s): string
{
    $s = mb_strtolower($s);
    $s = str_replace('ё', 'е', $s);
    $s = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $s) ?? $s;
    $s = preg_replace('/\s+/u', ' ', $s) ?? $s;

    return trim($s);
}

function normCode(string $s): string
{
    $s = mb_strtoupper(trim($s));
    $s = preg_replace('/\s+/u', '', $s) ?? $s;

    return $s;
}

function normSkuKey(string $s): string
{
    $s = mb_strtolower(trim($s));
    if ($s === '') {
        return '';
    }
    if (str_contains($s, '@')) {
        $s = explode('@', $s, 2)[0];
    }

    return trim($s);
}

function guidTail(string $id): string
{
    $id = trim($id);
    $p = strrpos($id, '::');

    return $p !== false ? substr($id, $p + 2) : $id;
}

function findCol(array $header, array $names): int
{
    $low = array_map(static fn($c) => mb_strtolower(trim((string) $c)), $header);
    foreach ($names as $n) {
        $i = array_search(mb_strtolower($n), $low, true);
        if ($i !== false) {
            return (int) $i;
        }
    }

    return -1;
}

function colLetter(int $index): string
{
    $n = $index + 1;
    $s = '';
    while ($n > 0) {
        $n--;
        $s = chr(65 + ($n % 26)) . $s;
        $n = intdiv($n, 26);
    }

    return $s;
}

/** @return array{guids:array<string,true>,skus:array<string,true>,codes:array<string,true>} */
function loadServiceMatchKeys(PDO $sqlite): array
{
    $guids = [];
    $skus = [];
    $codes = [];
    $q = $sqlite->query(
        "SELECT id, IFNULL(sku,'') AS sku, IFNULL(code,'') AS code
         FROM products
         WHERE IFNULL(item_kind, 'product') = 'service'"
    );
    while ($row = $q->fetch(PDO::FETCH_ASSOC)) {
        $id = trim((string) ($row['id'] ?? ''));
        if ($id !== '') {
            $guids[$id] = true;
            $tail = guidTail($id);
            if ($tail !== '') {
                $guids[$tail] = true;
            }
        }
        $sku = normSkuKey((string) ($row['sku'] ?? ''));
        if ($sku !== '') {
            $skus[$sku] = true;
        }
        $code = normCode((string) ($row['code'] ?? ''));
        if ($code !== '') {
            $codes[$code] = true;
        }
    }

    return ['guids' => $guids, 'skus' => $skus, 'codes' => $codes];
}

function orderItemIsService(array $row, array $keys): bool
{
    $guid = trim((string) ($row['product_guid'] ?? ''));
    if ($guid !== '' && !empty($keys['guids'][$guid])) {
        return true;
    }
    $sku = normSkuKey((string) ($row['sku'] ?? ''));
    if ($sku !== '' && !empty($keys['skus'][$sku])) {
        return true;
    }
    $code = normCode((string) ($row['code'] ?? ''));
    if ($code !== '' && !empty($keys['codes'][$code])) {
        return true;
    }

    return false;
}

/** @return array{byGuid:array<string,array>,bySku:array<string,array>,byCode:array<string,array>} */
function loadWidgetPriceStats(float $minPrice, ?PDO $wmsSqlite = null): array
{
    $cfg = amoConfigPath();
    if ($cfg === '') {
        throw new RuntimeException('Нет amo1c config.php');
    }
    require $cfg;

    $wmsPath = wmsSqlitePath();
    if ($wmsSqlite === null && $wmsPath !== '') {
        $wmsSqlite = new PDO('sqlite:' . $wmsPath);
        $wmsSqlite->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }
    if ($wmsSqlite === null) {
        throw new RuntimeException('Нет WMS sqlite для фильтра услуг');
    }
    $serviceKeys = loadServiceMatchKeys($wmsSqlite);

    $mysql = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER,
        DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );

    $sql = 'SELECT product_guid, sku, code, price FROM order_items WHERE IFNULL(price, 0) >= :min_price';
    $st = $mysql->prepare($sql);
    $st->execute(['min_price' => $minPrice]);

    /** @var array<string, list<float>> $accGuid $accSku $accCode */
    $accGuid = [];
    $accSku = [];
    $accCode = [];

    while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
        if (!orderItemIsService($row, $serviceKeys)) {
            continue;
        }
        $price = (float) $row['price'];
        $guid = trim((string) ($row['product_guid'] ?? ''));
        if ($guid !== '') {
            $accGuid[$guid][] = $price;
        }
        $sku = normSkuKey((string) ($row['sku'] ?? ''));
        if ($sku !== '') {
            $accSku[$sku][] = $price;
        }
        $code = normCode((string) ($row['code'] ?? ''));
        if ($code !== '') {
            $accCode[$code][] = $price;
        }
    }

    $pack = static function (array $acc): array {
        $out = [];
        foreach ($acc as $k => $prices) {
            sort($prices);
            $n = count($prices);
            $out[$k] = [
                'avg' => round(array_sum($prices) / $n, 2),
                'min' => round((float) min($prices), 2),
                'max' => round((float) max($prices), 2),
                'n' => $n,
            ];
        }

        return $out;
    };

    return [
        'byGuid' => $pack($accGuid),
        'bySku' => $pack($accSku),
        'byCode' => $pack($accCode),
    ];
}

/** @param array{byGuid:array,bySku:array,byCode:array} $stats */
function resolvePriceStat(array $stats, string $id, string $sku, string $code): ?array
{
    $tail = guidTail($id);
    if ($tail !== '' && isset($stats['byGuid'][$tail])) {
        return $stats['byGuid'][$tail];
    }
    if ($id !== '' && isset($stats['byGuid'][$id])) {
        return $stats['byGuid'][$id];
    }
    $skuKey = normSkuKey($sku);
    if ($skuKey !== '' && isset($stats['bySku'][$skuKey])) {
        return $stats['bySku'][$skuKey];
    }
    $codeKey = normCode($code);
    if ($codeKey !== '' && isset($stats['byCode'][$codeKey])) {
        return $stats['byCode'][$codeKey];
    }
    if ($codeKey !== '' && isset($stats['bySku'][$codeKey])) {
        return $stats['bySku'][$codeKey];
    }

    return null;
}

/** Разброс min→max > 50% (max/min > 1.5). */
function priceSpreadOverThreshold(?array $stat, float $ratio = 0.5): bool
{
    if ($stat === null) {
        return false;
    }
    $min = (float) ($stat['min'] ?? 0);
    $max = (float) ($stat['max'] ?? 0);
    if ($min <= 0 || $max <= $min) {
        return false;
    }

    return ($max - $min) / $min > $ratio;
}

/** Целые рубли для листа (983,04 → 983). */
function sheetPrice(mixed $value): int|string
{
    if ($value === '' || $value === null) {
        return '';
    }

    return (int) round((float) $value);
}

function applyAvgPriceSpreadHighlight(
    Google\Service\Sheets $sheets,
    string $spreadsheetId,
    int $sheetGid,
    int $iMin,
    int $iMax,
    int $iAvg,
    int $endRow,
    float $spreadRatio = 0.5
): void {
    $minLetter = colLetter($iMin);
    $maxLetter = colLetter($iMax);
    $threshold = 1 + $spreadRatio;
    // API Sheets: запятые в формуле, не локаль RU
    $formula = "=AND(\${$minLetter}2>0,\${$maxLetter}2/\${$minLetter}2>{$threshold})";

    $ss = $sheets->spreadsheets->get($spreadsheetId, [
        'fields' => 'sheets(properties.sheetId,conditionalFormats)',
    ]);
    $deleteRequests = [];
    foreach ($ss->getSheets() ?? [] as $sh) {
        if ((int) $sh->getProperties()->getSheetId() !== $sheetGid) {
            continue;
        }
        $rules = $sh->getConditionalFormats() ?? [];
        for ($i = count($rules) - 1; $i >= 0; $i--) {
            $rule = $rules[$i];
            $ranges = $rule->getRanges() ?? [];
            foreach ($ranges as $range) {
                $startCol = (int) ($range->getStartColumnIndex() ?? 0);
                $endCol = (int) ($range->getEndColumnIndex() ?? 0);
                if ($startCol <= $iAvg && $endCol > $iAvg) {
                    $deleteRequests[] = new Google\Service\Sheets\Request([
                        'deleteConditionalFormatRule' => [
                            'sheetId' => $sheetGid,
                            'index' => $i,
                        ],
                    ]);
                    break;
                }
            }
        }
        break;
    }

    $addRequest = new Google\Service\Sheets\Request([
        'addConditionalFormatRule' => [
            'rule' => [
                'ranges' => [[
                    'sheetId' => $sheetGid,
                    'startRowIndex' => 1,
                    'endRowIndex' => $endRow,
                    'startColumnIndex' => $iAvg,
                    'endColumnIndex' => $iAvg + 1,
                ]],
                'booleanRule' => [
                    'condition' => [
                        'type' => 'CUSTOM_FORMULA',
                        'values' => [
                            ['userEnteredValue' => $formula],
                        ],
                    ],
                    'format' => [
                        'backgroundColor' => ['red' => 1.0, 'green' => 0.85, 'blue' => 0.85],
                        'textFormat' => [
                            'foregroundColor' => ['red' => 0.75, 'green' => 0.0, 'blue' => 0.0],
                            'bold' => true,
                        ],
                    ],
                ],
            ],
            'index' => 0,
        ],
    ]);

    $requests = $deleteRequests;
    $requests[] = $addRequest;
    $sheets->spreadsheets->batchUpdate(
        $spreadsheetId,
        new Google\Service\Sheets\BatchUpdateSpreadsheetRequest(['requests' => $requests])
    );
}

class UnionFind
{
    /** @var array<int,int> */
    private array $parent = [];

    public function find(int $x): int
    {
        if (!isset($this->parent[$x])) {
            $this->parent[$x] = $x;
        }
        if ($this->parent[$x] !== $x) {
            $this->parent[$x] = $this->find($this->parent[$x]);
        }

        return $this->parent[$x];
    }

    public function union(int $a, int $b): void
    {
        $ra = $this->find($a);
        $rb = $this->find($b);
        if ($ra !== $rb) {
            $this->parent[$rb] = $ra;
        }
    }

    /** @return array<int, list<int>> */
    public function components(): array
    {
        $groups = [];
        foreach (array_keys($this->parent) as $x) {
            $r = $this->find($x);
            $groups[$r][] = $x;
        }

        return $groups;
    }
}

$dryRun = in_array('--dry-run', $argv ?? [], true);
$pricesOnly = in_array('--prices-only', $argv ?? [], true);
$minPrice = (float) (getenv('MIN_PRICE') ?: '1000');
$spreadsheetId = getenv('SHEET_ID') ?: '1eW2wcijS59Or5YMVrmzCCVOmIbc9HgDMeEEaCgf4hMw';
$sheetGid = (int) (getenv('APPLY_GID') ?: '701459276');

[$credPath, $autoload] = servicesToolBankPaths();
if (!is_file($autoload) || !is_file($credPath)) {
    fwrite(STDERR, "Нет Google credentials/vendor\n");
    exit(1);
}

try {
    $stats = loadWidgetPriceStats($minPrice);
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}

fwrite(STDERR, 'Widget stats: guid=' . count($stats['byGuid'])
    . ' sku=' . count($stats['bySku'])
    . ' code=' . count($stats['byCode']) . "\n");

require $autoload;

$client = new Google\Client();
$client->setApplicationName('Uchet1 services avg + dedupe');
$client->setAuthConfig($credPath);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$sheetTitle = null;
foreach ($ss->getSheets() ?? [] as $sh) {
    $props = $sh->getProperties();
    if ($props && (int) $props->getSheetId() === $sheetGid) {
        $sheetTitle = (string) $props->getTitle();
        break;
    }
}
if ($sheetTitle === null) {
    fwrite(STDERR, "Лист gid={$sheetGid} не найден\n");
    exit(1);
}

$quoted = "'" . str_replace("'", "''", $sheetTitle) . "'";
fwrite(STDERR, "Лист: {$sheetTitle}\n");

$resp = $sheets->spreadsheets_values->get($spreadsheetId, "{$quoted}!A:Z");
$values = $resp->getValues() ?? [];
if (count($values) < 2) {
    fwrite(STDERR, "Пустой лист\n");
    exit(1);
}

$header = array_map(
    static fn($c) => trim(preg_replace('/^\x{FEFF}/u', '', (string) $c) ?? ''),
    $values[0]
);
$iActive = findCol($header, ['активна']);
$iId = findCol($header, ['id']);
$iSku = findCol($header, ['артикул', 'sku']);
$iCode = findCol($header, ['код', 'code']);
$iName = findCol($header, ['наименование', 'name']);
$iCat = findCol($header, ['категория', 'category']);
$iMin = findCol($header, ['цена мин', 'price min', 'min']);
$iMax = findCol($header, ['цена макс', 'price max', 'max']);
$iAvg = findCol($header, ['средняя', 'avg']);

if ($iActive < 0 || $iId < 0) {
    fwrite(STDERR, "Нет колонок Активна/ID\n");
    exit(1);
}
if ($iMin < 0 || $iMax < 0) {
    fwrite(STDERR, "Нет колонок Цена мин / Цена макс\n");
    exit(1);
}

$avgCol = $iAvg >= 0 ? $iAvg : count($header);
if ($iAvg < 0) {
    $header[$avgCol] = 'Средняя';
    $values[0] = $header;
}

/** @var list<array{row:int,id:string,code:string,sku:string,name:string,cat:string,score:int,n:int}> $rowsMeta */
$rowsMeta = [];
$priceHit = 0;
$priceMiss = 0;
$spreadHot = 0;
$avgColValues = [];
$minColValues = [];
$maxColValues = [];

$uf = new UnionFind();

for ($r = 1; $r < count($values); $r++) {
    $row = $values[$r];
    $id = $iId >= 0 ? trim((string) ($row[$iId] ?? '')) : '';
    $sku = $iSku >= 0 ? trim((string) ($row[$iSku] ?? '')) : '';
    $code = $iCode >= 0 ? trim((string) ($row[$iCode] ?? '')) : '';
    $name = $iName >= 0 ? trim((string) ($row[$iName] ?? '')) : '';
    $cat = $iCat >= 0 ? trim((string) ($row[$iCat] ?? '')) : '';
    $catNorm = normName($cat) ?: '—без категории—';

    $stat = resolvePriceStat($stats, $id, $sku, $code);
    if ($stat) {
        $priceHit++;
        $avgColValues[] = [sheetPrice($stat['avg'])];
        $minColValues[] = [sheetPrice($stat['min'])];
        $maxColValues[] = [sheetPrice($stat['max'])];
        if (priceSpreadOverThreshold($stat)) {
            $spreadHot++;
        }
    } else {
        $priceMiss++;
        $avgColValues[] = [''];
        $minColValues[] = [''];
        $maxColValues[] = [''];
    }

    $dealN = (int) ($stat['n'] ?? 0);
    $activeRaw = mb_strtolower(trim((string) ($row[$iActive] ?? '')));
    $isActive = in_array($activeRaw, ['true', '1', 'да', 'yes'], true);
    $score = $dealN * 1000 + ($isActive ? 100 : 0) + ($code !== '' ? 10 : 0) + ($name !== '' ? 1 : 0);

    $metaIdx = count($rowsMeta);
    $rowsMeta[] = [
        'row' => $r,
        'id' => $id,
        'code' => normCode($code),
        'sku' => normSkuKey($sku),
        'name' => $name,
        'cat' => $catNorm,
        'score' => $score,
        'n' => $dealN,
    ];
    $uf->find($metaIdx);
}

/** @var array<string, list<int>> $keyToIdxs */
$keyToIdxs = [];
$link = static function (string $key, int $idx) use (&$keyToIdxs): void {
    if ($key === '') {
        return;
    }
    $keyToIdxs[$key][] = $idx;
};

foreach ($rowsMeta as $idx => $m) {
    if ($m['code'] !== '') {
        $link('code||' . $m['cat'] . '||' . $m['code'], $idx);
    }
    $nameNorm = normName($m['name']);
    if (mb_strlen($nameNorm) >= 4) {
        $link('name||' . $m['cat'] . '||' . $nameNorm, $idx);
    }
}

foreach ($keyToIdxs as $idxs) {
    $idxs = array_values(array_unique($idxs));
    if (count($idxs) < 2) {
        continue;
    }
    $first = $idxs[0];
    for ($i = 1, $c = count($idxs); $i < $c; $i++) {
        $uf->union($first, $idxs[$i]);
    }
}

/** @var array<int, bool> $keepActive */
$keepActive = [];
foreach ($rowsMeta as $m) {
    $raw = mb_strtolower(trim((string) ($values[$m['row']][$iActive] ?? '')));
    $keepActive[$m['row']] = !in_array($raw, ['false', '0', 'нет', 'no'], true);
}

$dupGroups = 0;
$dupDisabled = 0;
foreach ($uf->components() as $idxs) {
    if (count($idxs) < 2) {
        continue;
    }
    $dupGroups++;
    usort($idxs, static function (int $a, int $b) use ($rowsMeta): int {
        return $rowsMeta[$b]['score'] <=> $rowsMeta[$a]['score'];
    });
    $winnerRow = $rowsMeta[$idxs[0]]['row'];
    $keepActive[$winnerRow] = true;
    for ($i = 1, $c = count($idxs); $i < $c; $i++) {
        $loseRow = $rowsMeta[$idxs[$i]]['row'];
        if ($loseRow !== $winnerRow) {
            $keepActive[$loseRow] = false;
            $dupDisabled++;
        }
    }
}

$activeColValues = [];
$activeTrue = 0;
$activeFalse = 0;
for ($r = 1; $r < count($values); $r++) {
    $on = !empty($keepActive[$r]);
    $activeColValues[] = [$on ? 'TRUE' : 'FALSE'];
    if ($on) {
        $activeTrue++;
    } else {
        $activeFalse++;
    }
}

fwrite(STDERR, "Цены (price >= {$minPrice}): hit={$priceHit} miss={$priceMiss}, разброс >50%: {$spreadHot}\n");
if (!$pricesOnly) {
    fwrite(STDERR, "Дубли: групп={$dupGroups}, выключено={$dupDisabled}, активных={$activeTrue}, неактивных={$activeFalse}\n");
}

if ($dryRun) {
    echo json_encode([
        'dry_run' => true,
        'prices_only' => $pricesOnly,
        'min_price' => $minPrice,
        'price_hit' => $priceHit,
        'price_miss' => $priceMiss,
        'spread_hot' => $spreadHot,
        'dup_groups' => $pricesOnly ? null : $dupGroups,
        'dup_disabled' => $pricesOnly ? null : $dupDisabled,
        'active_true' => $pricesOnly ? null : $activeTrue,
        'active_false' => $pricesOnly ? null : $activeFalse,
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
    exit(0);
}

$avgLetter = colLetter($avgCol);
$minLetter = colLetter($iMin);
$maxLetter = colLetter($iMax);
$endRow = count($values);

if ($iAvg < 0) {
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        "{$quoted}!{$avgLetter}1",
        new Google\Service\Sheets\ValueRange(['values' => [['Средняя']]]),
        ['valueInputOption' => 'RAW']
    );
}

$sheets->spreadsheets_values->update(
    $spreadsheetId,
    "{$quoted}!{$minLetter}2:{$minLetter}{$endRow}",
    new Google\Service\Sheets\ValueRange(['values' => $minColValues]),
    ['valueInputOption' => 'RAW']
);
$sheets->spreadsheets_values->update(
    $spreadsheetId,
    "{$quoted}!{$maxLetter}2:{$maxLetter}{$endRow}",
    new Google\Service\Sheets\ValueRange(['values' => $maxColValues]),
    ['valueInputOption' => 'RAW']
);
$sheets->spreadsheets_values->update(
    $spreadsheetId,
    "{$quoted}!{$avgLetter}2:{$avgLetter}{$endRow}",
    new Google\Service\Sheets\ValueRange(['values' => $avgColValues]),
    ['valueInputOption' => 'RAW']
);

try {
    applyAvgPriceSpreadHighlight($sheets, $spreadsheetId, $sheetGid, $iMin, $iMax, $avgCol, $endRow);
} catch (Throwable $e) {
    fwrite(STDERR, 'Подсветка разброса: ' . $e->getMessage() . "\n");
}

if (!$pricesOnly) {
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        "{$quoted}!A2:A{$endRow}",
        new Google\Service\Sheets\ValueRange(['values' => $activeColValues]),
        ['valueInputOption' => 'USER_ENTERED']
    );

    $sheets->spreadsheets->batchUpdate(
        $spreadsheetId,
        new Google\Service\Sheets\BatchUpdateSpreadsheetRequest([
            'requests' => [
                new Google\Service\Sheets\Request([
                    'repeatCell' => [
                        'range' => [
                            'sheetId' => $sheetGid,
                            'startRowIndex' => 1,
                            'endRowIndex' => $endRow,
                            'startColumnIndex' => 0,
                            'endColumnIndex' => 1,
                        ],
                        'cell' => [
                            'dataValidation' => [
                                'condition' => ['type' => 'BOOLEAN'],
                                'showCustomUi' => true,
                                'strict' => true,
                            ],
                        ],
                        'fields' => 'dataValidation',
                    ],
                ]),
            ],
        ])
    );
}

echo json_encode([
    'sheet' => $sheetTitle,
    'prices_only' => $pricesOnly,
    'min_price' => $minPrice,
    'price_hit' => $priceHit,
    'price_miss' => $priceMiss,
    'dup_groups' => $pricesOnly ? null : $dupGroups,
    'dup_disabled' => $pricesOnly ? null : $dupDisabled,
    'active_true' => $pricesOnly ? null : $activeTrue,
    'active_false' => $pricesOnly ? null : $activeFalse,
    'url' => "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$sheetGid}",
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
