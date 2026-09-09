<?php
/**
 * Импорт «Номенклатура с остатками» (Москва · подвеска) → WMS.
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1KRNwQIi-jYBDtKYl5rQ9is6zngbPds0ZZvBXWCApn7I
 *
 * - Карточка = MRAER мастер (A)
 * - Лоты = факт B + поставщик + qty + ячейка + склад + поставка + ОЕ
 * - Цены с листа: C «Цена» (розница), D «Партнерская», E «Снятие/Установка»
 *   (fallback: amo1c products.price / price_install)
 * - Остатки затираются по затронутым master/fact
 * - Старые коды из таблицы (факт≠мастер, колонки старых MRAER) → is_active=0
 * - Фогель не трогаем
 *
 * Usage (на tech35):
 *   php tools/import_msk_nomen_master_sheet.php --dry-run
 *   php tools/import_msk_nomen_master_sheet.php --apply
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

$dryRun = true;
/** Не трогать product_applicability (оставить 1С / ручную). */
$skipApplicability = false;
foreach ($argv as $a) {
    if ($a === '--apply') {
        $dryRun = false;
    }
    if ($a === '--dry-run') {
        $dryRun = true;
    }
    if ($a === '--skip-applicability') {
        $skipApplicability = true;
    }
}

if (!is_readable($credPath) || !is_readable($autoload)) {
    fwrite(STDERR, "Нет Google credentials/autoload\n");
    exit(1);
}
if (!is_readable($wmsDb)) {
    fwrite(STDERR, "Нет WMS sqlite: {$wmsDb}\n");
    exit(1);
}

require $autoload;

function guid(): string
{
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    $h = bin2hex($b);
    return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4)
        . '-' . substr($h, 16, 4) . '-' . substr($h, 20, 12);
}

function normCell(string $raw): string
{
    $s = trim(preg_replace('/\s+/u', '', $raw) ?? '');
    if ($s === '') {
        return '';
    }
    $s = preg_replace('/^А/u', 'A', $s) ?? $s;
    $s = preg_replace('/^а/u', 'A', $s) ?? $s;
    if (preg_match('/^[A-Za-z]/', $s)) {
        $s = strtoupper($s[0]) . substr($s, 1);
    }
    return $s;
}

function moneyFromAmo(?string $v): float
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

/**
 * Разнести «Audi, Porsche» + «Q7 / Cayenne» в отдельные строки применимости.
 *
 * @return list<array{mark:string,model:string,gen:string,years:string}>
 */
function expandApplicabilityRows(string $marks, string $model, string $gen, string $years): array
{
    $markParts = [];
    foreach (preg_split('/[,;]/u', $marks) ?: [] as $p) {
        $p = trim((string) $p);
        if ($p !== '') {
            $markParts[] = $p;
        }
    }
    $modelParts = [];
    foreach (preg_split('/\s*\/\s*/u', $model) ?: [] as $p) {
        $p = trim((string) $p);
        if ($p !== '') {
            $modelParts[] = $p;
        }
    }
    if ($markParts === [] && $modelParts === []) {
        return [];
    }
    if ($markParts === []) {
        $markParts = [''];
    }
    if ($modelParts === []) {
        $modelParts = [''];
    }

    $out = [];
    if (count($markParts) === count($modelParts) && count($markParts) > 1) {
        foreach ($markParts as $i => $mark) {
            $out[] = [
                'mark' => $mark,
                'model' => $modelParts[$i],
                'gen' => $gen,
                'years' => $years,
            ];
        }

        return $out;
    }
    if (count($markParts) > 1) {
        foreach ($markParts as $mark) {
            foreach ($modelParts as $mod) {
                $out[] = [
                    'mark' => $mark,
                    'model' => $mod,
                    'gen' => $gen,
                    'years' => $years,
                ];
            }
        }

        return $out;
    }
    // одна марка — каждая модель отдельной строкой
    foreach ($modelParts as $mod) {
        $out[] = [
            'mark' => $markParts[0],
            'model' => $mod,
            'gen' => $gen,
            'years' => $years,
        ];
    }

    return $out;
}

function colIndex(array $header, array $aliases, bool $allowContains = true): ?int
{
    $norm = [];
    foreach ($header as $i => $h) {
        $norm[(int) $i] = mb_strtolower(trim((string) $h), 'UTF-8');
    }
    // 1) точное совпадение
    foreach ($aliases as $a) {
        $a = mb_strtolower($a, 'UTF-8');
        foreach ($norm as $i => $h) {
            if ($h === $a) {
                return $i;
            }
        }
    }
    if (!$allowContains) {
        return null;
    }
    // 2) contains — только для алиасов длиннее 4 символов (чтобы «склад» ≠ «номер на складе»)
    foreach ($aliases as $a) {
        $a = mb_strtolower($a, 'UTF-8');
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

// --- Google Sheet ---
$client = new Google\Client();
$client->setApplicationName('Uchet1 MSK nomen import');
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
fwrite(STDERR, "→ лист «{$title}»…\n");
$vals = $sheets->spreadsheets_values->get($spreadsheetId, "'{$title}'!A1:AZ")->getValues() ?: [];
if (count($vals) < 2) {
    fwrite(STDERR, "Пустой лист\n");
    exit(2);
}

$header = $vals[0];
$iMaster = colIndex($header, ['mraer мастер', 'мастер']);
$iFact = colIndex($header, ['номер на складе', 'факт']);
$iRetail = null;
$iPartner = null;
$iInstall = null;
foreach ($header as $i => $h) {
    $hn = mb_strtolower(trim((string) $h));
    if ($hn === 'цена' || $hn === 'розничная' || $hn === 'розничная цена') {
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
$iSup = colIndex($header, ['поставщик']);
$iQty = colIndex($header, ['кол-во', 'остаток']);
$iCell = colIndex($header, ['ячейка']);
$iWh = colIndex($header, ['склад'], false);
$iSupply = colIndex($header, ['№ поставки (склад)', '№ поставки', 'поставки']);
$iHow = colIndex($header, ['как найден']);
$iCat = colIndex($header, ['категория']);
$iName = colIndex($header, ['номенклатура 1с']);
$iAxis = colIndex($header, ['ось'], false);
$iSide = colIndex($header, ['сторона']);
$iDrive = colIndex($header, ['привод']);
$iType = colIndex($header, ['тип / исполнение']);
$iMarks = colIndex($header, ['марки'], false);
$iModel = colIndex($header, ['модель'], false);
$iBody = colIndex($header, ['кузова']);
$iYears = colIndex($header, ['годы'], false);
$iApp = colIndex($header, ['применимость (все машины)', 'применимость']);
$iOe = colIndex($header, ['ое — один проверенный номер', 'ое —']);
$iOld = colIndex($header, ['старые mraer (склад/история)', 'старые mraer']);
$iT = colIndex($header, ['mraer t'], false);
$iTnk = colIndex($header, ['mraer тнк']);
$iX = colIndex($header, ['mraer x'], false);
$iWenny = colIndex($header, ['mraer wenny']);
fwrite(STDERR, 'cols price: retail=' . json_encode($iRetail)
    . ' partner=' . json_encode($iPartner)
    . ' install=' . json_encode($iInstall) . "\n");

foreach (['master' => $iMaster, 'fact' => $iFact, 'qty' => $iQty] as $label => $idx) {
    if ($idx === null) {
        fwrite(STDERR, "Не найдена колонка {$label}\n");
        exit(3);
    }
}

$rows = [];
$masters = [];
$factSkus = [];
$aliasSkus = [];
for ($r = 1, $n = count($vals); $r < $n; $r++) {
    $row = $vals[$r];
    $master = strtoupper(cell($row, $iMaster));
    $fact = strtoupper(cell($row, $iFact));
    if ($master === '' && $fact === '') {
        continue;
    }
    if ($master === '') {
        continue;
    }
    if ($fact === '') {
        $fact = $master;
    }
    $qty = (float) str_replace([',', ' '], ['.', ''], cell($row, $iQty));
    if ($qty < 0) {
        $qty = 0;
    }
    $oldRaw = cell($row, $iOld);
    $aliases = [];
    foreach ([$oldRaw, cell($row, $iT), cell($row, $iTnk), cell($row, $iX), cell($row, $iWenny)] as $chunk) {
        foreach (preg_split('/[;,\s]+/u', $chunk) ?: [] as $a) {
            $a = strtoupper(trim($a));
            if ($a !== '' && $a !== $master) {
                $aliases[$a] = true;
            }
        }
    }
    if ($fact !== $master) {
        $aliases[$fact] = true;
    }
    $sheetRetail = moneyFromAmo($iRetail !== null ? cell($row, $iRetail) : '');
    $sheetPartner = moneyFromAmo($iPartner !== null ? cell($row, $iPartner) : '');
    $sheetInstall = moneyFromAmo($iInstall !== null ? cell($row, $iInstall) : '');
    $item = [
        'row' => $r + 1,
        'master' => $master,
        'fact' => $fact,
        'supplier' => cell($row, $iSup),
        'qty' => $qty,
        'cell' => normCell(cell($row, $iCell)),
        'warehouse' => cell($row, $iWh),
        'supply' => cell($row, $iSupply),
        'how' => cell($row, $iHow),
        'category' => cell($row, $iCat),
        'name' => cell($row, $iName),
        'axis' => cell($row, $iAxis),
        'side' => cell($row, $iSide),
        'drive' => cell($row, $iDrive),
        'type' => cell($row, $iType),
        'marks' => cell($row, $iMarks),
        'model' => cell($row, $iModel),
        'body' => cell($row, $iBody),
        'years' => cell($row, $iYears),
        'applicability' => cell($row, $iApp),
        'oe' => cell($row, $iOe),
        'retail' => $sheetRetail,
        'partner' => $sheetPartner,
        'install' => $sheetInstall,
        'aliases' => array_keys($aliases),
    ];
    $rows[] = $item;
    $masters[$master] = $masters[$master] ?? [
        'sku' => $master,
        'name' => $item['name'],
        'category' => $item['category'],
        'axis' => $item['axis'],
        'side' => $item['side'],
        'drive' => $item['drive'],
        'type' => $item['type'],
        'marks' => $item['marks'],
        'model' => $item['model'],
        'body' => $item['body'],
        'years' => $item['years'],
        'applicability' => $item['applicability'],
        'oe' => $item['oe'],
        'retail' => 0.0,
        'partner' => 0.0,
        'install' => 0.0,
        'aliases' => [],
    ];
    if ($item['name'] !== '') {
        $masters[$master]['name'] = $item['name'];
    }
    if ($sheetRetail > 0) {
        $masters[$master]['retail'] = $sheetRetail;
    }
    if ($sheetPartner > 0) {
        $masters[$master]['partner'] = $sheetPartner;
    }
    if ($sheetInstall > 0) {
        $masters[$master]['install'] = $sheetInstall;
    }
    foreach ($item['aliases'] as $a) {
        $masters[$master]['aliases'][$a] = true;
        $aliasSkus[$a] = true;
    }
    $factSkus[$fact] = true;
}

foreach ($masters as $sku => &$m) {
    $m['aliases'] = array_keys($m['aliases'] ?? []);
}
unset($m);

fwrite(STDERR, 'строк=' . count($rows) . ' мастеров=' . count($masters) . "\n");

$sheetRetailN = 0;
$sheetPartnerN = 0;
$sheetInstallN = 0;
foreach ($masters as $m) {
    if ((float) ($m['retail'] ?? 0) > 0) {
        $sheetRetailN++;
    }
    if ((float) ($m['partner'] ?? 0) > 0) {
        $sheetPartnerN++;
    }
    if ((float) ($m['install'] ?? 0) > 0) {
        $sheetInstallN++;
    }
}
fwrite(STDERR, "sheet prices: retail={$sheetRetailN} partner={$sheetPartnerN} install={$sheetInstallN}\n");

// --- prices fallback from amo1c (факт B) — только если на листе пусто ---
$prices = [];
$installAmo = [];
try {
    $pdo = new PDO(
        'mysql:host=localhost;dbname=brooklynba_amo1c;charset=utf8mb4',
        'brooklynba_amo1c',
        'Qq112211',
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $skus = array_values(array_unique(array_merge(array_keys($factSkus), array_keys($masters))));
    $chunk = array_chunk($skus, 400);
    foreach ($chunk as $part) {
        $in = implode(',', array_fill(0, count($part), '?'));
        $st = $pdo->prepare(
            "SELECT sku, price, IFNULL(price_install,0) AS price_install, department
             FROM products WHERE sku IN ($in) AND sku <> ''"
        );
        $st->execute($part);
        while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
            $sku = strtoupper((string) $r['sku']);
            $p = moneyFromAmo(isset($r['price']) ? (string) $r['price'] : null);
            $ip = moneyFromAmo(isset($r['price_install']) ? (string) $r['price_install'] : null);
            $dep = (string) ($r['department'] ?? '');
            if ($p > 0 && (!isset($prices[$sku]) || $dep === 'pnevmopodveska_2025')) {
                $prices[$sku] = $p;
            }
            if ($ip > 0 && (!isset($installAmo[$sku]) || $dep === 'pnevmopodveska_2025')) {
                $installAmo[$sku] = $ip;
            }
        }
    }
} catch (Throwable $e) {
    fwrite(STDERR, 'warn prices: ' . $e->getMessage() . "\n");
}
fwrite(STDERR, 'amo fallback retail=' . count($prices) . ' install=' . count($installAmo) . "\n");

// merge sheet → master prices (sheet wins)
foreach ($masters as $sku => &$m) {
    if ((float) ($m['retail'] ?? 0) <= 0) {
        $m['retail'] = (float) ($prices[$sku] ?? 0);
    }
    if ((float) ($m['install'] ?? 0) <= 0) {
        $m['install'] = (float) ($installAmo[$sku] ?? 0);
    }
}
unset($m);

if ($dryRun) {
    $sample = array_slice($rows, 0, 5);
    echo json_encode([
        'dry_run' => true,
        'rows' => count($rows),
        'masters' => count($masters),
        'sheet_retail' => $sheetRetailN,
        'sheet_partner' => $sheetPartnerN,
        'sheet_install' => $sheetInstallN,
        'amo_fallback' => count($prices),
        'sample' => $sample,
        'master_sample' => array_slice(array_values($masters), 0, 2),
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
    fwrite(STDERR, "dry-run ok — для записи: --apply\n");
    exit(0);
}

// --- apply to WMS ---
$db = new SQLite3($wmsDb);
$db->exec('PRAGMA busy_timeout = 60000');
$db->exec('PRAGMA foreign_keys = ON');
$db->exec('BEGIN IMMEDIATE');

try {
    $db->exec(
        "CREATE TABLE IF NOT EXISTS product_supplier_lots (
            id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            master_sku TEXT NOT NULL,
            fact_sku TEXT NOT NULL,
            supplier TEXT NOT NULL DEFAULT '',
            warehouse_id TEXT NOT NULL DEFAULT '',
            warehouse_name TEXT NOT NULL DEFAULT '',
            cell_code TEXT NOT NULL DEFAULT '',
            supply TEXT NOT NULL DEFAULT '',
            qty REAL NOT NULL DEFAULT 0,
            oe TEXT NOT NULL DEFAULT '',
            price REAL NOT NULL DEFAULT 0,
            how_found TEXT NOT NULL DEFAULT '',
            sheet_row INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    );
    $db->exec('CREATE INDEX IF NOT EXISTS idx_psl_product ON product_supplier_lots(product_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_psl_master ON product_supplier_lots(master_sku)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_psl_fact ON product_supplier_lots(fact_sku)');

    $db->exec(
        "CREATE TABLE IF NOT EXISTS warehouse_cells (
            id TEXT PRIMARY KEY,
            warehouse_id TEXT NOT NULL,
            code TEXT NOT NULL,
            rack TEXT NOT NULL DEFAULT '',
            bay INTEGER NOT NULL DEFAULT 0,
            level INTEGER NOT NULL DEFAULT 0,
            kind TEXT NOT NULL DEFAULT 'shelf',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (warehouse_id, code)
        )"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS stock_cell_balances (
            warehouse_id TEXT NOT NULL,
            cell_id TEXT NOT NULL,
            product_id TEXT NOT NULL DEFAULT '',
            sku TEXT NOT NULL DEFAULT '',
            product_name TEXT NOT NULL DEFAULT '',
            supply TEXT NOT NULL DEFAULT '',
            qty REAL NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (warehouse_id, cell_id, sku)
        )"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS product_alt_codes (
            id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            code_type TEXT NOT NULL DEFAULT 'sku',
            value TEXT NOT NULL DEFAULT '',
            supplier TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            source_product_id TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    );

    $whByName = [];
    $res = $db->query('SELECT id, name, code FROM warehouses WHERE IFNULL(is_active,1)=1');
    while ($w = $res->fetchArray(SQLITE3_ASSOC)) {
        $whByName[mb_strtolower(trim((string) $w['name']), 'UTF-8')] = $w;
        $whByName[mb_strtolower(trim((string) $w['code']), 'UTF-8')] = $w;
    }
    $mapWh = static function (string $name) use ($whByName): ?array {
        $k = mb_strtolower(trim($name), 'UTF-8');
        if ($k === '') {
            $k = 'основной';
        }
        if (isset($whByName[$k])) {
            return $whByName[$k];
        }
        if (str_contains($k, 'брак')) {
            return $whByName['брак/рекламация'] ?? null;
        }
        if ($k === 'сто' || str_contains($k, 'сто ')) {
            return $whByName['сто'] ?? $whByName['склад сто москва'] ?? null;
        }
        if (str_contains($k, 'основн')) {
            return $whByName['основной'] ?? null;
        }
        return null;
    };

    $getProduct = $db->prepare('SELECT * FROM products WHERE sku = :sku COLLATE NOCASE LIMIT 1');
    $insProduct = $db->prepare(
        "INSERT INTO products (
            id, sku, name, category_id, unit_id, barcode, is_active, created_at, brand, code, array_sku,
            measurement_unit, item_kind, is_main, source_department, warehouse_sku
         ) VALUES (
            :id, :sku, :name, '', '', '', 1, datetime('now'), 'MRAER', :code, :array_sku,
            'шт', 'product', 1, 'pnevmopodveska_2025', :warehouse_sku
         )"
    );
    $updProduct = $db->prepare(
        "UPDATE products SET
            name = CASE WHEN :name <> '' THEN :name ELSE name END,
            is_active = 1,
            is_main = 1,
            brand = COALESCE(NULLIF(brand,''), 'MRAER'),
            array_sku = :array_sku,
            warehouse_sku = :warehouse_sku,
            install_price = CASE WHEN :install > 0 THEN :install ELSE install_price END,
            source_department = CASE
                WHEN IFNULL(source_department,'') IN ('', 'pnevmopodveska_2025') THEN 'pnevmopodveska_2025'
                ELSE source_department
            END
         WHERE id = :id"
    );
    $setInstallNew = $db->prepare(
        'UPDATE products SET install_price = :install WHERE id = :id AND :install > 0'
    );

    $delProps = $db->prepare('DELETE FROM product_properties WHERE product_id = :pid');
    $insProp = $db->prepare(
        "INSERT INTO product_properties (id, product_id, property, value) VALUES (:id, :pid, :prop, :val)"
    );
    $delApp = $db->prepare('DELETE FROM product_applicability WHERE product_id = :pid');
    $insApp = $db->prepare(
        "INSERT INTO product_applicability (id, product_id, mark, model, only_model, generation, years)
         VALUES (:id, :pid, :mark, :model, :only_model, :gen, :years)"
    );
    $delAlt = $db->prepare('DELETE FROM product_alt_codes WHERE product_id = :pid');
    $insAlt = $db->prepare(
        "INSERT INTO product_alt_codes (id, product_id, code_type, value, supplier, note, source_product_id)
         VALUES (:id, :pid, :ctype, :val, :sup, :note, :src)"
    );
    $delLots = $db->prepare("DELETE FROM product_supplier_lots WHERE master_sku = :sku");
    $insLot = $db->prepare(
        "INSERT INTO product_supplier_lots (
            id, product_id, master_sku, fact_sku, supplier, warehouse_id, warehouse_name,
            cell_code, supply, qty, oe, price, how_found, sheet_row, updated_at
         ) VALUES (
            :id, :pid, :master, :fact, :sup, :wh, :whn, :cell, :supply, :qty, :oe, :price, :how, :row, datetime('now')
         )"
    );

    $findCell = $db->prepare(
        'SELECT id FROM warehouse_cells WHERE warehouse_id = :wh AND code = :code COLLATE NOCASE LIMIT 1'
    );
    $insCell = $db->prepare(
        "INSERT INTO warehouse_cells (id, warehouse_id, code, rack, bay, level, kind, is_active)
         VALUES (:id, :wh, :code, :rack, :bay, :level, 'shelf', 1)"
    );
    $upsertCellBal = $db->prepare(
        "INSERT INTO stock_cell_balances (warehouse_id, cell_id, product_id, sku, product_name, supply, qty, updated_at)
         VALUES (:wh, :cell, :pid, :sku, :name, :supply, :qty, datetime('now'))
         ON CONFLICT(warehouse_id, cell_id, sku) DO UPDATE SET
           product_id = excluded.product_id,
           product_name = excluded.product_name,
           supply = excluded.supply,
           qty = excluded.qty,
           updated_at = datetime('now')"
    );
    $upsertBal = $db->prepare(
        "INSERT INTO stock_balances (warehouse_id, product_id, qty) VALUES (:wh, :pid, :qty)
         ON CONFLICT(warehouse_id, product_id) DO UPDATE SET qty = excluded.qty"
    );
    $upsertRest = $db->prepare(
        "INSERT INTO product_store_rests (product_id, warehouse_id, qty) VALUES (:pid, :wh, :qty)
         ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty = excluded.qty"
    );
    $arch = $db->prepare(
        "UPDATE products SET is_active = 0 WHERE sku = :sku COLLATE NOCASE
         AND IFNULL(source_department,'') IN ('', 'pnevmopodveska_2025')
         AND IFNULL(source_department,'') <> 'fogel_2025'"
    );
    $setPrice = $db->prepare(
        "INSERT INTO product_prices (id, product_id, price_type, price) VALUES (:id, :pid, :ptype, :price)"
    );
    $delPriceTypes = $db->prepare(
        "DELETE FROM product_prices
         WHERE product_id = :pid
           AND price_type IN ('retail', 'Розничная цена', 'partner', 'Розничная партнерская', 'Цена снятие/установки')"
    );

    $stats = [
        'masters_upserted' => 0,
        'lots' => 0,
        'cells' => 0,
        'archived' => 0,
        'missing_wh' => 0,
        'created_products' => 0,
        'prices_retail' => 0,
        'prices_partner' => 0,
        'prices_install' => 0,
    ];

    $masterIds = [];
    $touchedProductIds = [];
    $touchedFactSkus = [];

    foreach ($masters as $sku => $m) {
        $getProduct->bindValue(':sku', $sku, SQLITE3_TEXT);
        $res = $getProduct->execute();
        $prod = $res->fetchArray(SQLITE3_ASSOC);
        $res->finalize();
        $aliasList = $m['aliases'];
        sort($aliasList);
        $arraySku = implode(', ', $aliasList);
        $whSku = $aliasList[0] ?? $sku;
        if (!$prod) {
            $id = guid();
            $insProduct->bindValue(':id', $id, SQLITE3_TEXT);
            $insProduct->bindValue(':sku', $sku, SQLITE3_TEXT);
            $insProduct->bindValue(':name', $m['name'] !== '' ? $m['name'] : $sku, SQLITE3_TEXT);
            $insProduct->bindValue(':code', $sku, SQLITE3_TEXT);
            $insProduct->bindValue(':array_sku', $arraySku, SQLITE3_TEXT);
            $insProduct->bindValue(':warehouse_sku', $whSku, SQLITE3_TEXT);
            $insProduct->execute();
            $installNew = (float) ($m['install'] ?? 0);
            if ($installNew > 0) {
                $setInstallNew->bindValue(':id', $id, SQLITE3_TEXT);
                $setInstallNew->bindValue(':install', $installNew);
                $setInstallNew->execute();
            }
            $stats['created_products']++;
        } else {
            $id = (string) $prod['id'];
            $updProduct->bindValue(':id', $id, SQLITE3_TEXT);
            $updProduct->bindValue(':name', $m['name'], SQLITE3_TEXT);
            $updProduct->bindValue(':array_sku', $arraySku, SQLITE3_TEXT);
            $updProduct->bindValue(':warehouse_sku', $whSku, SQLITE3_TEXT);
            $updProduct->bindValue(':install', (float) ($m['install'] ?? 0));
            $updProduct->execute();
        }
        $masterIds[$sku] = $id;
        $touchedProductIds[$id] = true;
        $stats['masters_upserted']++;

        $delProps->bindValue(':pid', $id, SQLITE3_TEXT);
        $delProps->execute();
        $props = [
            'category' => $m['category'],
            'axis' => $m['axis'],
            'side' => $m['side'],
            'drive' => $m['drive'],
            'type' => $m['type'],
            'marks' => $m['marks'],
            'model' => $m['model'],
            'body' => $m['body'],
            'years' => $m['years'],
            'applicability' => $m['applicability'],
            'oe' => $m['oe'],
            'nomen_source' => 'sheet:nomen-ost-20260905',
        ];
        foreach ($props as $pk => $pv) {
            if (trim((string) $pv) === '') {
                continue;
            }
            $insProp->bindValue(':id', guid(), SQLITE3_TEXT);
            $insProp->bindValue(':pid', $id, SQLITE3_TEXT);
            $insProp->bindValue(':prop', $pk, SQLITE3_TEXT);
            $insProp->bindValue(':val', (string) $pv, SQLITE3_TEXT);
            $insProp->execute();
        }

        if (!$skipApplicability) {
            $delApp->bindValue(':pid', $id, SQLITE3_TEXT);
            $delApp->execute();
            $appRows = [];
            if (trim((string) $m['applicability']) !== '') {
                foreach (parseApplicabilityAllCars((string) $m['applicability']) as $row) {
                    $appRows[] = [
                        'mark' => $row['mark'],
                        'model' => $row['model'],
                        'gen' => $row['generation'],
                        'years' => $row['years'],
                    ];
                }
            }
            if ($appRows === []) {
                $appRows = expandApplicabilityRows($m['marks'], $m['model'], $m['body'], $m['years']);
            }
            foreach (enrichApplicabilityOnlyModel($appRows) as $appRow) {
                $insApp->bindValue(':id', guid(), SQLITE3_TEXT);
                $insApp->bindValue(':pid', $id, SQLITE3_TEXT);
                $insApp->bindValue(':mark', $appRow['mark'], SQLITE3_TEXT);
                $insApp->bindValue(':model', $appRow['model'], SQLITE3_TEXT);
                $insApp->bindValue(':only_model', $appRow['only_model'], SQLITE3_TEXT);
                $insApp->bindValue(':gen', $appRow['generation'], SQLITE3_TEXT);
                $insApp->bindValue(':years', $appRow['years'], SQLITE3_TEXT);
                $insApp->execute();
            }
        }

        $delAlt->bindValue(':pid', $id, SQLITE3_TEXT);
        $delAlt->execute();
        foreach ($aliasList as $a) {
            $insAlt->bindValue(':id', guid(), SQLITE3_TEXT);
            $insAlt->bindValue(':pid', $id, SQLITE3_TEXT);
            $insAlt->bindValue(':ctype', 'sku', SQLITE3_TEXT);
            $insAlt->bindValue(':val', $a, SQLITE3_TEXT);
            $insAlt->bindValue(':sup', '', SQLITE3_TEXT);
            $insAlt->bindValue(':note', 'sheet alias', SQLITE3_TEXT);
            $getProduct->bindValue(':sku', $a, SQLITE3_TEXT);
            $rs = $getProduct->execute();
            $src = $rs->fetchArray(SQLITE3_ASSOC);
            $rs->finalize();
            $insAlt->bindValue(':src', $src ? (string) $src['id'] : '', SQLITE3_TEXT);
            $insAlt->execute();
        }
        if ($m['oe'] !== '') {
            $insAlt->bindValue(':id', guid(), SQLITE3_TEXT);
            $insAlt->bindValue(':pid', $id, SQLITE3_TEXT);
            $insAlt->bindValue(':ctype', 'oe', SQLITE3_TEXT);
            $insAlt->bindValue(':val', $m['oe'], SQLITE3_TEXT);
            $insAlt->bindValue(':sup', '', SQLITE3_TEXT);
            $insAlt->bindValue(':note', 'sheet OE', SQLITE3_TEXT);
            $insAlt->bindValue(':src', '', SQLITE3_TEXT);
            $insAlt->execute();
        }

        $delLots->bindValue(':sku', $sku, SQLITE3_TEXT);
        $delLots->execute();
    }

    // clear stock for touched masters
    $delBal = $db->prepare('DELETE FROM stock_balances WHERE product_id = :pid');
    $delRest = $db->prepare('DELETE FROM product_store_rests WHERE product_id = :pid');
    $delCellByPid = $db->prepare('DELETE FROM stock_cell_balances WHERE product_id = :pid');
    foreach (array_keys($touchedProductIds) as $pid) {
        $delBal->bindValue(':pid', $pid, SQLITE3_TEXT);
        $delBal->execute();
        $delRest->bindValue(':pid', $pid, SQLITE3_TEXT);
        $delRest->execute();
        $delCellByPid->bindValue(':pid', $pid, SQLITE3_TEXT);
        $delCellByPid->execute();
    }
    // also clear cell balances by fact sku
    $delCellBySku = $db->prepare('DELETE FROM stock_cell_balances WHERE sku = :sku COLLATE NOCASE');
    foreach (array_keys($factSkus) as $fs) {
        $delCellBySku->bindValue(':sku', $fs, SQLITE3_TEXT);
        $delCellBySku->execute();
        $touchedFactSkus[$fs] = true;
    }

    $balAgg = []; // pid|wh => qty

    foreach ($rows as $item) {
        $master = $item['master'];
        $pid = $masterIds[$master] ?? null;
        if (!$pid) {
            continue;
        }
        $wh = $mapWh($item['warehouse']);
        if (!$wh) {
            $stats['missing_wh']++;
            $wh = $mapWh('Основной');
        }
        if (!$wh) {
            continue;
        }
        $whId = (string) $wh['id'];
        $whName = (string) $wh['name'];
        $fact = $item['fact'];
        // цена лота = розница с листа (мастер), иначе amo fallback
        $price = (float) ($item['retail'] ?? 0);
        if ($price <= 0) {
            $price = (float) ($masters[$master]['retail'] ?? 0);
        }
        if ($price <= 0) {
            $price = (float) ($prices[$fact] ?? $prices[$master] ?? 0);
        }

        $cellCode = $item['cell'];
        $cellId = '';
        if ($cellCode !== '') {
            $findCell->bindValue(':wh', $whId, SQLITE3_TEXT);
            $findCell->bindValue(':code', $cellCode, SQLITE3_TEXT);
            $cr = $findCell->execute();
            $crow = $cr->fetchArray(SQLITE3_ASSOC);
            $cr->finalize();
            if ($crow) {
                $cellId = (string) $crow['id'];
            } else {
                $cellId = guid();
                $rack = preg_match('/^([A-Za-zА-Яа-я]+)/u', $cellCode, $mm) ? $mm[1] : '';
                $bay = 0;
                $level = 0;
                if (preg_match('/^[A-Za-zА-Яа-я]+(\d+)\.(\d+)/u', $cellCode, $mm)) {
                    $bay = (int) $mm[1];
                    $level = (int) $mm[2];
                }
                $insCell->bindValue(':id', $cellId, SQLITE3_TEXT);
                $insCell->bindValue(':wh', $whId, SQLITE3_TEXT);
                $insCell->bindValue(':code', $cellCode, SQLITE3_TEXT);
                $insCell->bindValue(':rack', $rack, SQLITE3_TEXT);
                $insCell->bindValue(':bay', $bay, SQLITE3_INTEGER);
                $insCell->bindValue(':level', $level, SQLITE3_INTEGER);
                $insCell->execute();
                $stats['cells']++;
            }
            $upsertCellBal->bindValue(':wh', $whId, SQLITE3_TEXT);
            $upsertCellBal->bindValue(':cell', $cellId, SQLITE3_TEXT);
            $upsertCellBal->bindValue(':pid', $pid, SQLITE3_TEXT);
            $upsertCellBal->bindValue(':sku', $fact, SQLITE3_TEXT);
            $upsertCellBal->bindValue(':name', $item['name'] !== '' ? $item['name'] : $master, SQLITE3_TEXT);
            $upsertCellBal->bindValue(':supply', $item['supply'], SQLITE3_TEXT);
            $upsertCellBal->bindValue(':qty', $item['qty']);
            $upsertCellBal->execute();
        }

        $insLot->bindValue(':id', guid(), SQLITE3_TEXT);
        $insLot->bindValue(':pid', $pid, SQLITE3_TEXT);
        $insLot->bindValue(':master', $master, SQLITE3_TEXT);
        $insLot->bindValue(':fact', $fact, SQLITE3_TEXT);
        $insLot->bindValue(':sup', $item['supplier'], SQLITE3_TEXT);
        $insLot->bindValue(':wh', $whId, SQLITE3_TEXT);
        $insLot->bindValue(':whn', $whName, SQLITE3_TEXT);
        $insLot->bindValue(':cell', $cellCode, SQLITE3_TEXT);
        $insLot->bindValue(':supply', $item['supply'], SQLITE3_TEXT);
        $insLot->bindValue(':qty', $item['qty']);
        $insLot->bindValue(':oe', $item['oe'], SQLITE3_TEXT);
        $insLot->bindValue(':price', $price);
        $insLot->bindValue(':how', $item['how'], SQLITE3_TEXT);
        $insLot->bindValue(':row', $item['row'], SQLITE3_INTEGER);
        $insLot->execute();
        $stats['lots']++;

        $k = $pid . '|' . $whId;
        $balAgg[$k] = ($balAgg[$k] ?? 0) + $item['qty'];
    }

    foreach ($balAgg as $k => $qty) {
        [$pid, $whId] = explode('|', $k, 2);
        $upsertBal->bindValue(':wh', $whId, SQLITE3_TEXT);
        $upsertBal->bindValue(':pid', $pid, SQLITE3_TEXT);
        $upsertBal->bindValue(':qty', $qty);
        $upsertBal->execute();
        $upsertRest->bindValue(':pid', $pid, SQLITE3_TEXT);
        $upsertRest->bindValue(':wh', $whId, SQLITE3_TEXT);
        $upsertRest->bindValue(':qty', $qty);
        $upsertRest->execute();
    }

    foreach ($masters as $sku => $m) {
        $pid = $masterIds[$sku] ?? null;
        if (!$pid) {
            continue;
        }
        $retail = (float) ($m['retail'] ?? 0);
        $partner = (float) ($m['partner'] ?? 0);
        $install = (float) ($m['install'] ?? 0);
        if ($retail <= 0 && $partner <= 0 && $install <= 0) {
            continue;
        }
        $delPriceTypes->bindValue(':pid', $pid, SQLITE3_TEXT);
        $delPriceTypes->execute();
        $writePrice = static function (string $ptype, float $price) use ($setPrice, $pid): void {
            if ($price <= 0) {
                return;
            }
            $setPrice->bindValue(':id', guid(), SQLITE3_TEXT);
            $setPrice->bindValue(':pid', $pid, SQLITE3_TEXT);
            $setPrice->bindValue(':ptype', $ptype, SQLITE3_TEXT);
            $setPrice->bindValue(':price', $price);
            $setPrice->execute();
        };
        if ($retail > 0) {
            $writePrice('Розничная цена', $retail);
            $writePrice('retail', $retail);
            $stats['prices_retail']++;
        }
        if ($partner > 0) {
            $writePrice('Розничная партнерская', $partner);
            $stats['prices_partner']++;
        }
        if ($install > 0) {
            $writePrice('Цена снятие/установки', $install);
            $stats['prices_install']++;
        }
    }

    // archive fact/alias SKUs that are not masters
    $toArchive = [];
    foreach (array_keys($aliasSkus) as $a) {
        if (!isset($masters[$a])) {
            $toArchive[$a] = true;
        }
    }
    foreach (array_keys($factSkus) as $f) {
        if (!isset($masters[$f])) {
            $toArchive[$f] = true;
        }
    }
    foreach (array_keys($toArchive) as $sku) {
        $arch->bindValue(':sku', $sku, SQLITE3_TEXT);
        $arch->execute();
        if ($db->changes() > 0) {
            $stats['archived'] += $db->changes();
        }
    }

    $db->exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('msk_nomen_sheet_imported_at', datetime('now'))");
    $db->exec(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('msk_nomen_sheet_stats', "
        . "'" . $db->escapeString(json_encode($stats, JSON_UNESCAPED_UNICODE)) . "')"
    );

    $db->exec('COMMIT');
    echo json_encode(['ok' => true, 'stats' => $stats], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
} catch (Throwable $e) {
    $db->exec('ROLLBACK');
    fwrite(STDERR, 'FAIL: ' . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n");
    exit(10);
}
