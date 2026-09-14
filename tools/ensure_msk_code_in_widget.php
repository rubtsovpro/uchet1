<?php
/**
 * Срочно: код 1С → виден в виджете Amo · Москва (WMS sqlite).
 *
 * Usage (tech35):
 *   php tools/ensure_msk_code_in_widget.php НФ-00026159
 *   php tools/ensure_msk_code_in_widget.php НФ-00026159 --apply
 */
declare(strict_types=1);

$codeArg = '';
$apply = false;
foreach (array_slice($argv, 1) as $a) {
    if ($a === '--apply') {
        $apply = true;
        continue;
    }
    if ($a !== '' && !str_starts_with($a, '-')) {
        $codeArg = trim($a);
    }
}
if ($codeArg === '') {
    fwrite(STDERR, "Укажите код, напр. НФ-00026159\n");
    exit(1);
}

$wmsDb = getenv('WMS_SQLITE')
    ?: '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
if (!is_readable($wmsDb)) {
    fwrite(STDERR, "Нет WMS sqlite: {$wmsDb}\n");
    exit(1);
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

$db = new SQLite3($wmsDb);
$db->busyTimeout(15000);
$db->exec('PRAGMA foreign_keys = ON');

$code = $codeArg;
$norm = static function (string $s): string {
    return mb_strtoupper(trim($s), 'UTF-8');
};
$codeU = $norm($code);

$row = $db->querySingle(
    "SELECT id, sku, code, name, IFNULL(is_active,1) AS is_active, IFNULL(notupload,0) AS notupload,
            IFNULL(source_department,'') AS source_department, IFNULL(is_main,0) AS is_main
     FROM products
     WHERE UPPER(IFNULL(code,'')) = '{$db->escapeString($codeU)}'
        OR UPPER(IFNULL(sku,'')) = '{$db->escapeString($codeU)}'
        OR UPPER(IFNULL(warehouse_sku,'')) = '{$db->escapeString($codeU)}'
     ORDER BY CASE WHEN IFNULL(is_main,0)=1 THEN 0 ELSE 1 END, is_active DESC
     LIMIT 1",
    true
);

if (!$row) {
    // Подтянуть имя/цену/применимость с листа Миши
    $credPath = getenv('GOOGLE_SA_JSON')
        ?: '/root/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
    $autoload = getenv('GOOGLE_PHP_AUTOLOAD')
        ?: '/root/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
    $spreadsheetId = getenv('MSK_NOMEN_SHEET_ID') ?: '1KRNwQIi-jYBDtKYl5rQ9is6zngbPds0ZZvBXWCApn7I';
    if (!is_readable($credPath) || !is_readable($autoload)) {
        fwrite(STDERR, "Карточки нет в WMS и нет доступа к Google Sheet\n");
        exit(2);
    }
    require $autoload;
    $client = new Google\Client();
    $client->setAuthConfig($credPath);
    $client->setScopes([Google\Service\Sheets::SPREADSHEETS_READONLY]);
    $sheets = new Google\Service\Sheets($client);
    $meta = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets(properties(sheetId,title))']);
    $title = $meta->getSheets()[0]->getProperties()->getTitle();
    $vals = $sheets->spreadsheets_values->get($spreadsheetId, "'{$title}'!A1:AZ")->getValues() ?: [];
    $hdr = array_map(static fn ($h) => mb_strtolower(trim((string) $h), 'UTF-8'), $vals[0] ?? []);
    $col = static function (array $names) use ($hdr): ?int {
        foreach ($names as $n) {
            $n = mb_strtolower($n, 'UTF-8');
            foreach ($hdr as $i => $h) {
                if ($h === $n || str_contains($h, $n)) {
                    return (int) $i;
                }
            }
        }

        return null;
    };
    $iMaster = $col(['mraer мастер', 'мастер']);
    $iFact = $col(['номер на складе', 'факт']);
    $iPrice = $col(['цена']);
    $iName = $col(['номенклатура 1с']);
    $iApp = $col(['применимость (все машины)']);
    $iCat = $col(['категория']);
    $iMarks = $col(['марки']);
    $iModel = $col(['модель']);
    $iBody = $col(['кузова']);
    $iYears = $col(['годы']);
    $sheet = null;
    foreach ($vals as $ri => $r) {
        if ($ri === 0) {
            continue;
        }
        $m = $iMaster !== null ? trim((string) ($r[$iMaster] ?? '')) : '';
        $f = $iFact !== null ? trim((string) ($r[$iFact] ?? '')) : '';
        if ($norm($m) === $codeU || $norm($f) === $codeU) {
            $sheet = $r;
            break;
        }
    }
    if (!$sheet) {
        fwrite(STDERR, "Код {$code} не найден ни в WMS, ни на листе\n");
        exit(2);
    }
    $name = $iName !== null ? trim((string) ($sheet[$iName] ?? '')) : $code;
    $price = $iPrice !== null ? (float) str_replace([',', ' '], ['.', ''], (string) ($sheet[$iPrice] ?? '0')) : 0.0;
    $fact = $iFact !== null ? trim((string) ($sheet[$iFact] ?? '')) : $code;
    $catName = $iCat !== null ? trim((string) ($sheet[$iCat] ?? '')) : '';
    $app = $iApp !== null ? trim((string) ($sheet[$iApp] ?? '')) : '';
    $mark = $iMarks !== null ? trim((string) ($sheet[$iMarks] ?? '')) : '';
    $model = $iModel !== null ? trim((string) ($sheet[$iModel] ?? '')) : '';
    $body = $iBody !== null ? trim((string) ($sheet[$iBody] ?? '')) : '';
    $years = $iYears !== null ? trim((string) ($sheet[$iYears] ?? '')) : '';

    $pid = guid();
    $catId = '';
    if ($catName !== '') {
        $catId = (string) ($db->querySingle(
            "SELECT id FROM categories WHERE name = '" . $db->escapeString($catName) . "' LIMIT 1"
        ) ?: '');
        if ($catId === '') {
            $catId = guid();
            if ($apply) {
                $db->exec(
                    "INSERT INTO categories (id, name) VALUES ('{$catId}', '" . $db->escapeString($catName) . "')"
                );
            }
        }
    }
    echo "CREATE product {$code} · {$name}\n";
    if ($apply) {
        $db->exec(
            "INSERT INTO products (
                id, sku, name, category_id, is_active, is_main, notupload, code, warehouse_sku,
                source_department, item_kind, created_at
             ) VALUES (
                '{$pid}',
                '" . $db->escapeString($code) . "',
                '" . $db->escapeString($name !== '' ? $name : $code) . "',
                '" . $db->escapeString($catId) . "',
                1, 1, 0,
                '" . $db->escapeString($code) . "',
                '" . $db->escapeString($fact !== '' ? $fact : $code) . "',
                'pnevmopodveska_2025', 'product', datetime('now')
             )"
        );
        if ($price > 0) {
            $db->exec(
                "INSERT INTO product_prices (id, product_id, price_type, price)
                 VALUES ('" . guid() . "', '{$pid}', 'retail', {$price})"
            );
        }
        $db->exec(
            "INSERT INTO product_supplier_lots (
                id, product_id, master_sku, fact_sku, supplier, warehouse_id, warehouse_name,
                cell_code, supply, qty, oe, price, how_found, sheet_row, updated_at
             ) VALUES (
                '" . guid() . "', '{$pid}',
                '" . $db->escapeString($code) . "',
                '" . $db->escapeString($fact !== '' ? $fact : $code) . "',
                '', '', '', '', '', 0, '', " . ($price > 0 ? $price : 0) . ",
                'ensure_widget', 0, datetime('now')
             )"
        );
    }
    $row = [
        'id' => $pid,
        'sku' => $code,
        'code' => $code,
        'name' => $name,
        'is_active' => 1,
        'notupload' => 0,
        'source_department' => 'pnevmopodveska_2025',
        'is_main' => 1,
        '_new' => 1,
        '_mark' => $mark,
        '_model' => $model,
        '_body' => $body,
        '_years' => $years,
        '_app' => $app,
        '_price' => $price,
    ];
} else {
    echo "FOUND {$row['id']} · {$row['sku']} · {$row['name']}\n";
    echo "  active={$row['is_active']} notupload={$row['notupload']} dept={$row['source_department']} main={$row['is_main']}\n";
}

$pid = (string) $row['id'];

$fixes = [];
if ((int) $row['is_active'] !== 1) {
    $fixes[] = 'is_active=1';
}
if ((int) $row['notupload'] !== 0) {
    $fixes[] = 'notupload=0';
}
$dept = trim((string) ($row['source_department'] ?? ''));
if ($dept !== '' && $dept !== 'pnevmopodveska_2025') {
    // не перетираем чужой контур молча — только если пусто
} elseif ($dept === '') {
    $fixes[] = "source_department='pnevmopodveska_2025'";
}
if ((int) ($row['is_main'] ?? 0) !== 1) {
    $fixes[] = 'is_main=1';
}

if ($fixes && $apply) {
    $db->exec('UPDATE products SET ' . implode(', ', $fixes) . " WHERE id = '" . $db->escapeString($pid) . "'");
    echo 'UPDATED ' . implode(', ', $fixes) . "\n";
} elseif ($fixes) {
    echo 'WOULD update ' . implode(', ', $fixes) . "\n";
}

// Применимость: для поиска по машине в виджете
$appCount = (int) $db->querySingle(
    "SELECT COUNT(*) FROM product_applicability WHERE product_id = '" . $db->escapeString($pid) . "'"
);
echo "applicability rows: {$appCount}\n";

$mark = trim((string) ($row['_mark'] ?? 'Toyota'));
$model = trim((string) ($row['_model'] ?? 'Camry'));
$body = trim((string) ($row['_body'] ?? 'XV50'));
$years = trim((string) ($row['_years'] ?? '2011-2018'));
if ($appCount === 0) {
    // если создавали с листа — уже есть; иначе дефолт под эту рейку / общие поля
    if ($mark === '') {
        $mark = 'Toyota';
    }
    if ($model === '') {
        $model = 'Camry';
    }
    // only_model часто = кузов/поколение в пикере
    $only = $body !== '' ? $body : $model;
    $gen = $body !== '' ? $body : '';
    echo "ADD applicability {$mark} / {$model} / {$gen} / {$only} / {$years}\n";
    if ($apply) {
        $db->exec(
            "INSERT INTO product_applicability (id, product_id, mark, model, generation, only_model, years)
             VALUES (
                '" . guid() . "',
                '" . $db->escapeString($pid) . "',
                '" . $db->escapeString($mark) . "',
                '" . $db->escapeString($model) . "',
                '" . $db->escapeString($gen) . "',
                '" . $db->escapeString($only) . "',
                '" . $db->escapeString($years) . "'
             )"
        );
    }
}

// Цена retail, если нет
$priceN = (int) $db->querySingle(
    "SELECT COUNT(*) FROM product_prices WHERE product_id = '" . $db->escapeString($pid) . "'"
);
if ($priceN === 0 && !empty($row['_price']) && (float) $row['_price'] > 0 && $apply) {
    $p = (float) $row['_price'];
    $db->exec(
        "INSERT INTO product_prices (id, product_id, price_type, price)
         VALUES ('" . guid() . "', '" . $db->escapeString($pid) . "', 'retail', {$p})"
    );
    echo "ADD price retail={$p}\n";
}

// Лот факта, если нет
$lotN = (int) $db->querySingle(
    "SELECT COUNT(*) FROM product_supplier_lots WHERE product_id = '" . $db->escapeString($pid) . "'"
);
if ($lotN === 0 && $apply) {
    $db->exec(
        "INSERT INTO product_supplier_lots (
            id, product_id, master_sku, fact_sku, supplier, warehouse_id, warehouse_name,
            cell_code, supply, qty, oe, price, how_found, sheet_row, updated_at
         ) VALUES (
            '" . guid() . "',
            '" . $db->escapeString($pid) . "',
            '" . $db->escapeString((string) $row['sku']) . "',
            '" . $db->escapeString($code) . "',
            '', '', '', '', '', 0, '', 0, 'ensure_widget', 0, datetime('now')
         )"
    );
    echo "ADD lot fact={$code}\n";
}

echo $apply ? "DONE apply {$code}\n" : "DRY-RUN {$code} (передай --apply)\n";
