<?php
/**
 * Часовой sync метаданных номенклатуры МСК (только подвеска) из Google Sheet.
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1KRNwQIi-jYBDtKYl5rQ9is6zngbPds0ZZvBXWCApn7I
 *
 * Ключ: MRAER мастер → карточка подвески (pnevmopodveska_2025).
 * Нет карточки подвески → создаём. Фогель не трогаем: при занятом sku
 * (как в HS) пишем sku@podveska — у каждого контура своя номенклатура.
 *
 * Берём / обновляем:
 *   A MRAER мастер, B Номер на складе, C Цена, D Партнерская, E Снятие/Установка,
 *   F Поставщик, G Применимость программная, K № поставки,
 *   N Категория, O Номенклатура 1С, P Ось, Q Сторона, R Привод, S Тип/исполнение,
 *   BA КРОССЫ → array_sku
 *
 * НИКОГДА не трогаем: Кол-во/остаток, Ячейка, Склад, ОЕ/номера поставщиков T/X/G…
 * и любые строки fogel_2025.
 *
 * Usage:
 *   php tools/sync_msk_nomen_meta_hourly.php --dry-run
 *   php tools/sync_msk_nomen_meta_hourly.php --apply
 */
declare(strict_types=1);

require_once __DIR__ . '/lib_msk_applicability_parse.php';

$credPath = getenv('GOOGLE_SA_JSON')
    ?: '/root/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = getenv('GOOGLE_PHP_AUTOLOAD')
    ?: '/root/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$wmsDb = getenv('WMS_SQLITE')
    ?: '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
$spreadsheetId = getenv('MSK_NOMEN_SHEET_ID') ?: '1KRNwQIi-jYBDtKYl5rQ9is6zngbPds0ZZvBXWCApn7I';
$sheetGid = (int) (getenv('MSK_NOMEN_SHEET_GID') ?: 0);
$logDir = getenv('MSK_NOMEN_SYNC_LOG_DIR')
    ?: '/root/1c_pnevmopodveska1_ru/warehouse/logs';

$dryRun = !in_array('--apply', $argv, true);
if (in_array('--dry-run', $argv, true)) {
    $dryRun = true;
}

function sync_log(string $msg): void
{
    fwrite(STDERR, $msg . (str_ends_with($msg, "\n") ? '' : "\n"));
}

function guid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    $h = bin2hex($b);

    return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4)
        . '-' . substr($h, 16, 4) . '-' . substr($h, 20, 12);
}

function moneyCell(?string $v): float
{
    if ($v === null || $v === '') {
        return 0.0;
    }
    if (is_numeric($v)) {
        return max(0.0, (float) $v);
    }
    $s = preg_replace('/[^\d,.\-]/u', '', str_replace("\xc2\xa0", '', $v)) ?? '';
    $s = str_replace(',', '.', $s);

    return is_numeric($s) ? max(0.0, (float) $s) : 0.0;
}

function colIndex(array $header, array $aliases, bool $allowContains = true): ?int
{
    $norm = [];
    foreach ($header as $i => $h) {
        $norm[(int) $i] = mb_strtolower(trim(preg_replace('/\s+/u', ' ', (string) $h) ?? (string) $h), 'UTF-8');
    }
    foreach ($aliases as $a) {
        $a = mb_strtolower(trim($a), 'UTF-8');
        foreach ($norm as $i => $h) {
            if ($h === $a) {
                return $i;
            }
        }
    }
    if (!$allowContains) {
        return null;
    }
    foreach ($aliases as $a) {
        $a = mb_strtolower(trim($a), 'UTF-8');
        if (mb_strlen($a, 'UTF-8') <= 4) {
            continue;
        }
        foreach ($norm as $i => $h) {
            if (str_contains($h, $a)) {
                return $i;
            }
        }
    }

    return null;
}

function cell(array $row, ?int $i): string
{
    if ($i === null) {
        return '';
    }

    return trim((string) ($row[$i] ?? ''));
}

function normalizeCrosses(string $raw): string
{
    $parts = [];
    $seen = [];
    foreach (preg_split('/[;,\n]+/u', $raw) ?: [] as $p) {
        $p = strtoupper(trim((string) $p));
        if ($p === '' || isset($seen[$p])) {
            continue;
        }
        $seen[$p] = true;
        $parts[] = $p;
    }

    return implode('; ', $parts);
}

if (!is_readable($credPath) || !is_readable($autoload)) {
    sync_log('ERR: нет Google credentials/autoload');
    exit(1);
}
if (!is_readable($wmsDb)) {
    sync_log('ERR: нет WMS sqlite: ' . $wmsDb);
    exit(1);
}

require $autoload;

$started = microtime(true);
sync_log('MSK nomen meta sync ' . ($dryRun ? 'DRY-RUN' : 'APPLY') . ' @ ' . date('c'));

$client = new Google\Client();
$client->setApplicationName('Uchet1 MSK nomen meta hourly');
$client->setAuthConfig($credPath);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS_READONLY]);
$sheets = new Google\Service\Sheets($client);

$meta = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets(properties(sheetId,title))']);
$title = null;
foreach ($meta->getSheets() as $s) {
    if ((int) $s->getProperties()->getSheetId() === $sheetGid) {
        $title = $s->getProperties()->getTitle();
        break;
    }
}
if ($title === null) {
    $title = $meta->getSheets()[0]->getProperties()->getTitle();
}
sync_log('→ лист «' . $title . '»');

$vals = $sheets->spreadsheets_values->get($spreadsheetId, "'" . str_replace("'", "''", $title) . "'!A1:BZ")->getValues() ?: [];
if (count($vals) < 2) {
    sync_log('ERR: пустой лист');
    exit(2);
}

$header = $vals[0];
$iMaster = colIndex($header, ['mraer мастер', 'мастер']);
$iFact = colIndex($header, ['номер на складе (факт)', 'номер на складе', 'факт']);
$iRetail = null;
$iPartner = null;
$iInstall = null;
foreach ($header as $i => $h) {
    $hn = mb_strtolower(trim((string) $h), 'UTF-8');
    if ($hn === 'цена') {
        $iRetail = (int) $i;
    }
    if ($hn === 'партнерская' || $hn === 'партнёрская' || str_contains($hn, 'партнерск') || str_contains($hn, 'партнёрск')) {
        $iPartner = (int) $i;
    }
    if (str_contains($hn, 'снятие') || str_contains($hn, 'установк')) {
        $iInstall = (int) $i;
    }
}
$iRetail ??= colIndex($header, ['цена'], false);
$iPartner ??= colIndex($header, ['партнерская', 'партнёрская']);
$iInstall ??= colIndex($header, ['снятие/установка', 'снятие']);
$iSup = colIndex($header, ['поставщик (по коду)', 'поставщик']);
$iAppProg = colIndex($header, ['применимость программная']);
$iSupply = colIndex($header, ['№ поставки (склад)', '№ поставки', 'поставки']);
$iCat = colIndex($header, ['категория'], false);
$iName = colIndex($header, ['номенклатура 1с']);
$iAxis = colIndex($header, ['ось'], false);
$iSide = colIndex($header, ['сторона'], false);
// не путать со «Сторона: значима?»
if ($iSide !== null) {
    $hn = mb_strtolower(trim((string) ($header[$iSide] ?? '')), 'UTF-8');
    if (str_contains($hn, 'значим')) {
        $iSide = null;
        foreach ($header as $i => $h) {
            if (mb_strtolower(trim((string) $h), 'UTF-8') === 'сторона') {
                $iSide = (int) $i;
                break;
            }
        }
    }
}
$iDrive = colIndex($header, ['привод'], false);
$iType = colIndex($header, ['тип / исполнение', 'тип/исполнение']);
$iCross = colIndex($header, ['кроссы — все номера для поиска', 'кроссы']);

if ($iMaster === null) {
    sync_log('ERR: нет колонки MRAER мастер');
    exit(3);
}

sync_log('cols: master=' . json_encode($iMaster)
    . ' fact=' . json_encode($iFact)
    . ' retail=' . json_encode($iRetail)
    . ' partner=' . json_encode($iPartner)
    . ' install=' . json_encode($iInstall)
    . ' appProg=' . json_encode($iAppProg)
    . ' cross=' . json_encode($iCross));

/** @var array<string,array<string,mixed>> $masters */
$masters = [];
for ($r = 1, $n = count($vals); $r < $n; $r++) {
    $row = $vals[$r];
    $master = strtoupper(cell($row, $iMaster));
    if ($master === '') {
        continue;
    }
    $fact = strtoupper(cell($row, $iFact));
    if ($fact === '') {
        $fact = $master;
    }
    $cur = $masters[$master] ?? [
        'sku' => $master,
        'fact' => $fact,
        'retail' => 0.0,
        'partner' => 0.0,
        'install' => 0.0,
        'supplier' => '',
        'app_prog' => '',
        'supply' => '',
        'category' => '',
        'name' => '',
        'axis' => '',
        'side' => '',
        'drive' => '',
        'type' => '',
        'crosses' => '',
        'rows' => 0,
    ];
    $cur['rows']++;
    $cur['fact'] = $fact;
    $retail = moneyCell($iRetail !== null ? cell($row, $iRetail) : '');
    $partner = moneyCell($iPartner !== null ? cell($row, $iPartner) : '');
    $install = moneyCell($iInstall !== null ? cell($row, $iInstall) : '');
    if ($retail > 0) {
        $cur['retail'] = $retail;
    }
    if ($partner > 0) {
        $cur['partner'] = $partner;
    }
    if ($install > 0) {
        $cur['install'] = $install;
    }
    $sup = cell($row, $iSup);
    if ($sup !== '') {
        $cur['supplier'] = $sup;
    }
    $app = cell($row, $iAppProg);
    if ($app !== '') {
        $cur['app_prog'] = $app;
    }
    $supply = cell($row, $iSupply);
    if ($supply !== '') {
        $cur['supply'] = $supply;
    }
    $cat = cell($row, $iCat);
    if ($cat !== '') {
        $cur['category'] = $cat;
    }
    $name = cell($row, $iName);
    if ($name !== '') {
        $cur['name'] = $name;
    }
    $axis = cell($row, $iAxis);
    if ($axis !== '') {
        $cur['axis'] = $axis;
    }
    $side = cell($row, $iSide);
    if ($side !== '') {
        $cur['side'] = $side;
    }
    $drive = cell($row, $iDrive);
    if ($drive !== '') {
        $cur['drive'] = $drive;
    }
    $type = cell($row, $iType);
    if ($type !== '') {
        $cur['type'] = $type;
    }
    $cross = normalizeCrosses(cell($row, $iCross));
    if ($cross !== '') {
        $cur['crosses'] = $cross;
    }
    $masters[$master] = $cur;
}

sync_log('мастеров на листе: ' . count($masters));

$db = new SQLite3($wmsDb);
$db->busyTimeout(120000);
$db->exec('PRAGMA foreign_keys = ON');
$db->exec('PRAGMA busy_timeout = 120000');
// меньше конфликтов с Node WMS
@$db->exec('PRAGMA journal_mode = WAL');
@$db->exec('PRAGMA synchronous = NORMAL');

$prodCols = [];
$qCols = $db->query('PRAGMA table_info(products)');
while ($qCols && ($c = $qCols->fetchArray(SQLITE3_ASSOC))) {
    $prodCols[(string) $c['name']] = true;
}
foreach (['warehouse_sku', 'array_sku', 'install_price', 'source_department'] as $need) {
    if (!isset($prodCols[$need])) {
        sync_log('ERR: products.' . $need . ' отсутствует — это не прод-база WMS');
        exit(5);
    }
}

$getProduct = $db->prepare(
    "SELECT id, sku, name, warehouse_sku, array_sku, install_price, category_id, source_department
     FROM products
     WHERE IFNULL(source_department,'') IN ('', 'pnevmopodveska_2025')
       AND (
         sku = :sku COLLATE NOCASE
         OR sku = :sku_ns COLLATE NOCASE
         OR warehouse_sku = :sku COLLATE NOCASE
       )
     ORDER BY
       CASE
         WHEN sku = :sku2 COLLATE NOCASE THEN 0
         WHEN sku = :sku_ns2 COLLATE NOCASE THEN 1
         ELSE 2
       END
     LIMIT 1"
);
$insProduct = $db->prepare(
    "INSERT INTO products (
        id, sku, name, category_id, unit_id, barcode, is_active, created_at, brand, code, array_sku,
        measurement_unit, item_kind, is_main, source_department, warehouse_sku, install_price
     ) VALUES (
        :id, :sku, :name, :category_id, :unit_id, '', 1, datetime('now'), 'MRAER', :code, :array_sku,
        'шт', 'product', 1, 'pnevmopodveska_2025', :warehouse_sku, :install
     )"
);
$findCat = $db->prepare(
    "SELECT id FROM categories WHERE name = :name COLLATE NOCASE LIMIT 1"
);
$insCat = $db->prepare(
    "INSERT INTO categories (id, name, parent_id) VALUES (:id, :name, NULL)"
);

$unitId = (string) $db->querySingle(
    "SELECT id FROM units WHERE short_name = 'шт' OR name = 'Штука' ORDER BY CASE WHEN short_name = 'шт' THEN 0 ELSE 1 END LIMIT 1"
);
if ($unitId === '') {
    $unitId = (string) $db->querySingle(
        "SELECT unit_id FROM products WHERE IFNULL(source_department,'') = 'pnevmopodveska_2025' AND IFNULL(unit_id,'') <> '' GROUP BY unit_id ORDER BY COUNT(*) DESC LIMIT 1"
    );
}
if ($unitId === '') {
    sync_log('ERR: нет units.id для «шт»');
    exit(6);
}
sync_log('unit_id=' . $unitId);

$skuTaken = static function (SQLite3 $db, string $candidate, string $exceptId = '') : bool {
    $sql = "SELECT id FROM products WHERE sku = '" . SQLite3::escapeString($candidate) . "' COLLATE NOCASE";
    if ($exceptId !== '') {
        $sql .= " AND id <> '" . SQLite3::escapeString($exceptId) . "'";
    }
    $sql .= ' LIMIT 1';

    return (string) $db->querySingle($sql) !== '';
};

$pickStoreSku = static function (SQLite3 $db, string $master) use ($skuTaken): string {
    if (!$skuTaken($db, $master)) {
        return $master;
    }
    $ns = $master . '@podveska';
    if (!$skuTaken($db, $ns)) {
        return $ns;
    }
    // крайний случай — уникальный хвост
    for ($i = 0; $i < 8; $i++) {
        $cand = $master . ':' . substr(bin2hex(random_bytes(4)), 0, 8);
        if (!$skuTaken($db, $cand)) {
            return $cand;
        }
    }

    return $master . ':' . guid();
};

$stats = [
    'matched' => 0,
    'created' => 0,
    'created_namespaced' => 0,
    'updated' => 0,
    'name' => 0,
    'warehouse_sku' => 0,
    'array_sku' => 0,
    'install' => 0,
    'prices' => 0,
    'props' => 0,
    'app' => 0,
    'category' => 0,
];

$createdSample = [];
$changedSample = [];

/** @return bool */
$execOk = static function (SQLite3 $db, string $sql): bool {
    for ($i = 0; $i < 8; $i++) {
        $ok = @$db->exec($sql);
        if ($ok) {
            return true;
        }
        $err = $db->lastErrorMsg();
        if (!str_contains($err, 'locked') && !str_contains($err, 'busy')) {
            sync_log('ERR sql: ' . $err . ' :: ' . $sql);
            return false;
        }
        usleep(200000 * ($i + 1));
    }
    sync_log('ERR sql locked: ' . $sql);

    return false;
};

/** @return bool */
$stmtOk = static function (SQLite3Stmt $st): bool {
    for ($i = 0; $i < 8; $i++) {
        $res = @$st->execute();
        if ($res instanceof SQLite3Result) {
            $res->finalize();
            return true;
        }
        // execute may return false
        usleep(200000 * ($i + 1));
    }

    return false;
};

try {
    foreach ($masters as $sku => $m) {
        if (!$dryRun) {
            if (!$execOk($db, 'BEGIN IMMEDIATE')) {
                throw new RuntimeException('BEGIN IMMEDIATE failed for ' . $sku);
            }
        }

        $skuNs = $sku . '@podveska';
        $getProduct->bindValue(':sku', $sku, SQLITE3_TEXT);
        $getProduct->bindValue(':sku_ns', $skuNs, SQLITE3_TEXT);
        $getProduct->bindValue(':sku2', $sku, SQLITE3_TEXT);
        $getProduct->bindValue(':sku_ns2', $skuNs, SQLITE3_TEXT);
        $res = $getProduct->execute();
        $prod = $res ? $res->fetchArray(SQLITE3_ASSOC) : false;
        if ($res) {
            $res->finalize();
        }

        $createdNow = false;
        if (!$prod) {
            $storeSku = $pickStoreSku($db, $sku);
            $pid = guid();
            $nameNew = trim((string) $m['name']);
            if ($nameNew === '') {
                $nameNew = $sku;
            }
            $factNew = trim((string) $m['fact']);
            if ($factNew === '') {
                $factNew = $sku;
            }
            $crossNew = trim((string) $m['crosses']);
            $installNew = (float) $m['install'];
            if (!$dryRun) {
                $insProduct->bindValue(':id', $pid, SQLITE3_TEXT);
                $insProduct->bindValue(':sku', $storeSku, SQLITE3_TEXT);
                $insProduct->bindValue(':name', $nameNew, SQLITE3_TEXT);
                $insProduct->bindValue(':category_id', null, SQLITE3_NULL);
                $insProduct->bindValue(':unit_id', $unitId, SQLITE3_TEXT);
                $insProduct->bindValue(':code', $sku, SQLITE3_TEXT);
                $insProduct->bindValue(':array_sku', $crossNew, SQLITE3_TEXT);
                $insProduct->bindValue(':warehouse_sku', $factNew, SQLITE3_TEXT);
                $insProduct->bindValue(':install', $installNew);
                if (!$stmtOk($insProduct)) {
                    $execOk($db, 'ROLLBACK');
                    throw new RuntimeException('INSERT product failed: ' . $sku . ' / ' . $db->lastErrorMsg());
                }
            }
            $prod = [
                'id' => $pid,
                'sku' => $storeSku,
                'name' => $nameNew,
                'warehouse_sku' => $factNew,
                'array_sku' => $crossNew,
                'install_price' => $installNew,
                'category_id' => '',
                'source_department' => 'pnevmopodveska_2025',
            ];
            $stats['created']++;
            $createdNow = true;
            if ($storeSku !== $sku) {
                $stats['created_namespaced']++;
            }
            if (count($createdSample) < 20) {
                $createdSample[] = $storeSku === $sku ? $sku : ($sku . '→' . $storeSku);
            }
        }

        $stats['matched']++;
        $pid = (string) $prod['id'];
        $changed = $createdNow;

        $name = trim((string) $m['name']);
        if ($name !== '' && $name !== (string) ($prod['name'] ?? '')) {
            if (!$dryRun) {
                $st = $db->prepare('UPDATE products SET name = :n WHERE id = :id');
                $st->bindValue(':n', $name, SQLITE3_TEXT);
                $st->bindValue(':id', $pid, SQLITE3_TEXT);
                $st->execute();
            }
            $stats['name']++;
            $changed = true;
        }

        $fact = trim((string) $m['fact']);
        if ($fact !== '' && $fact !== (string) ($prod['warehouse_sku'] ?? '')) {
            if (!$dryRun) {
                $st = $db->prepare('UPDATE products SET warehouse_sku = :w WHERE id = :id');
                $st->bindValue(':w', $fact, SQLITE3_TEXT);
                $st->bindValue(':id', $pid, SQLITE3_TEXT);
                $st->execute();
            }
            $stats['warehouse_sku']++;
            $changed = true;
        }

        $crosses = trim((string) $m['crosses']);
        if ($crosses !== '' && $crosses !== (string) ($prod['array_sku'] ?? '')) {
            if (!$dryRun) {
                $st = $db->prepare('UPDATE products SET array_sku = :a WHERE id = :id');
                $st->bindValue(':a', $crosses, SQLITE3_TEXT);
                $st->bindValue(':id', $pid, SQLITE3_TEXT);
                $st->execute();
            }
            $stats['array_sku']++;
            $changed = true;
        }

        $install = (float) $m['install'];
        if ($install > 0 && abs($install - (float) ($prod['install_price'] ?? 0)) > 0.009) {
            if (!$dryRun) {
                $st = $db->prepare('UPDATE products SET install_price = :p WHERE id = :id');
                $st->bindValue(':p', $install);
                $st->bindValue(':id', $pid, SQLITE3_TEXT);
                $st->execute();
            }
            $stats['install']++;
            $changed = true;
        }

        $catName = trim((string) $m['category']);
        if ($catName !== '') {
            $findCat->bindValue(':name', $catName, SQLITE3_TEXT);
            $cr = $findCat->execute();
            $cat = $cr->fetchArray(SQLITE3_ASSOC);
            $cr->finalize();
            $catId = $cat ? (string) $cat['id'] : '';
            if ($catId === '' && !$dryRun) {
                $catId = guid();
                $insCat->bindValue(':id', $catId, SQLITE3_TEXT);
                $insCat->bindValue(':name', $catName, SQLITE3_TEXT);
                $insCat->execute();
            }
            if ($catId !== '' && $catId !== (string) ($prod['category_id'] ?? '')) {
                if (!$dryRun) {
                    $st = $db->prepare('UPDATE products SET category_id = :c WHERE id = :id');
                    $st->bindValue(':c', $catId, SQLITE3_TEXT);
                    $st->bindValue(':id', $pid, SQLITE3_TEXT);
                    $st->execute();
                }
                $stats['category']++;
                $changed = true;
            }
        }

        // prices
        $priceMap = [
            'Розничная цена' => (float) $m['retail'],
            'Розничная партнерская' => (float) $m['partner'],
            'Цена снятие/установки' => (float) $m['install'],
        ];
        foreach ($priceMap as $ptype => $price) {
            if ($price <= 0) {
                continue;
            }
            $curP = (float) $db->querySingle(
                "SELECT price FROM product_prices WHERE product_id = '" . SQLite3::escapeString($pid)
                . "' AND price_type = '" . SQLite3::escapeString($ptype) . "' LIMIT 1"
            );
            if (abs($curP - $price) < 0.009) {
                continue;
            }
            if (!$dryRun) {
                $db->exec(
                    "DELETE FROM product_prices WHERE product_id = '" . SQLite3::escapeString($pid)
                    . "' AND price_type = '" . SQLite3::escapeString($ptype) . "'"
                );
                $st = $db->prepare(
                    'INSERT INTO product_prices (id, product_id, price_type, price) VALUES (:id, :pid, :t, :p)'
                );
                $st->bindValue(':id', guid(), SQLITE3_TEXT);
                $st->bindValue(':pid', $pid, SQLITE3_TEXT);
                $st->bindValue(':t', $ptype, SQLITE3_TEXT);
                $st->bindValue(':p', $price);
                $st->execute();
            }
            $stats['prices']++;
            $changed = true;
        }

        // properties (replace known keys only)
        $props = [
            'category' => (string) $m['category'],
            'axis' => (string) $m['axis'],
            'side' => (string) $m['side'],
            'drive' => (string) $m['drive'],
            'type' => (string) $m['type'],
            'supplier_code' => (string) $m['supplier'],
            'supply' => (string) $m['supply'],
            'applicability_program' => (string) $m['app_prog'],
            'nomen_source' => 'sheet:nomen-meta-hourly',
        ];
        foreach ($props as $pk => $pv) {
            $pv = trim($pv);
            if ($pv === '') {
                continue;
            }
            $curV = (string) $db->querySingle(
                "SELECT value FROM product_properties WHERE product_id = '" . SQLite3::escapeString($pid)
                . "' AND property = '" . SQLite3::escapeString($pk) . "' LIMIT 1"
            );
            if ($curV === $pv) {
                continue;
            }
            if (!$dryRun) {
                $db->exec(
                    "DELETE FROM product_properties WHERE product_id = '" . SQLite3::escapeString($pid)
                    . "' AND property = '" . SQLite3::escapeString($pk) . "'"
                );
                $st = $db->prepare(
                    'INSERT INTO product_properties (id, product_id, property, value) VALUES (:id, :pid, :p, :v)'
                );
                $st->bindValue(':id', guid(), SQLITE3_TEXT);
                $st->bindValue(':pid', $pid, SQLITE3_TEXT);
                $st->bindValue(':p', $pk, SQLITE3_TEXT);
                $st->bindValue(':v', $pv, SQLITE3_TEXT);
                $st->execute();
            }
            $stats['props']++;
            $changed = true;
        }

        // applicability from programmatic column only
        $appText = trim((string) $m['app_prog']);
        if ($appText !== '') {
            $appRows = enrichApplicabilityOnlyModel(parseProgrammaticApplicability($appText));
            $want = [];
            foreach ($appRows as $ar) {
                $want[] = mb_strtolower(
                    $ar['mark'] . '|' . $ar['model'] . '|' . $ar['generation'] . '|' . $ar['years'],
                    'UTF-8'
                );
            }
            sort($want);
            $have = [];
            $qr = $db->query(
                "SELECT mark, model, generation, years FROM product_applicability WHERE product_id = '"
                . SQLite3::escapeString($pid) . "'"
            );
            while ($qr && ($rowA = $qr->fetchArray(SQLITE3_ASSOC))) {
                $have[] = mb_strtolower(
                    trim((string) $rowA['mark']) . '|' . trim((string) $rowA['model']) . '|'
                    . trim((string) $rowA['generation']) . '|' . trim((string) $rowA['years']),
                    'UTF-8'
                );
            }
            if ($qr) {
                $qr->finalize();
            }
            sort($have);
            if ($want !== $have) {
                if (!$dryRun) {
                    $db->exec(
                        "DELETE FROM product_applicability WHERE product_id = '" . SQLite3::escapeString($pid) . "'"
                    );
                    $st = $db->prepare(
                        'INSERT INTO product_applicability (id, product_id, mark, model, only_model, generation, years)
                         VALUES (:id, :pid, :mark, :model, :only, :gen, :years)'
                    );
                    foreach ($appRows as $ar) {
                        $st->bindValue(':id', guid(), SQLITE3_TEXT);
                        $st->bindValue(':pid', $pid, SQLITE3_TEXT);
                        $st->bindValue(':mark', $ar['mark'], SQLITE3_TEXT);
                        $st->bindValue(':model', $ar['model'], SQLITE3_TEXT);
                        $st->bindValue(':only', $ar['only_model'], SQLITE3_TEXT);
                        $st->bindValue(':gen', $ar['generation'], SQLITE3_TEXT);
                        $st->bindValue(':years', $ar['years'], SQLITE3_TEXT);
                        $st->execute();
                        // ensure no open result
                    }
                }
                $stats['app']++;
                $changed = true;
            }
        }

        if ($changed) {
            $stats['updated']++;
            if (count($changedSample) < 15) {
                $changedSample[] = $sku;
            }
        }

        if (!$dryRun) {
            if (!$execOk($db, 'COMMIT')) {
                $execOk($db, 'ROLLBACK');
                throw new RuntimeException('COMMIT failed for ' . $sku . ': ' . $db->lastErrorMsg());
            }
        }
    }
} catch (Throwable $e) {
    if (!$dryRun) {
        @$db->exec('ROLLBACK');
    }
    sync_log('ERR: ' . $e->getMessage());
    exit(4);
}

$sec = round(microtime(true) - $started, 1);
sync_log('done in ' . $sec . 's stats=' . json_encode($stats, JSON_UNESCAPED_UNICODE));
if ($createdSample !== []) {
    sync_log('created sample: ' . implode(', ', $createdSample));
}
if ($changedSample !== []) {
    sync_log('changed sample: ' . implode(', ', $changedSample));
}

if (!is_dir($logDir)) {
    @mkdir($logDir, 0755, true);
}
$logFile = rtrim($logDir, '/') . '/msk_nomen_meta_hourly.log';
@file_put_contents(
    $logFile,
    date('c') . ' ' . ($dryRun ? 'dry' : 'apply') . ' ' . json_encode($stats, JSON_UNESCAPED_UNICODE) . "\n",
    FILE_APPEND | LOCK_EX
);

if ($dryRun) {
    sync_log('dry-run ok — запись: php tools/sync_msk_nomen_meta_hourly.php --apply');
}
