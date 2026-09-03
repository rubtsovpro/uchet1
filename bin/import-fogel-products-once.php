<?php

declare(strict_types=1);

/**
 * Одноразовый импорт номенклатуры Фогеля из 1С → WMS → amo1c (виджет).
 *
 *   php bin/import-fogel-products-once.php MW11008 C23307 9952
 */
$terms = array_slice($argv, 1);
if ($terms === []) {
    $terms = ['MW11008', 'C23307', '9952'];
}

$amoRoot = getenv('AMO1C_ROOT') ?: '/root/amo1c_pnevmopodveska1_ru/public_html';
$wmsPath = getenv('WMS_SQLITE_PATH') ?: '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';

require_once $amoRoot . '/sendCurlRequest.php';

$host = 'https://bezmat.corp.rarus-cloud.ru/fogel_2025/hs/AmoCRM/';
$department = 'fogel_2025';

function norm(string $s): string
{
    return mb_strtoupper(trim($s));
}

function product_matches(array $p, string $term): bool
{
    $termU = norm($term);
    if ($termU === '') {
        return false;
    }
    $parts = [
        (string) ($p['sku'] ?? ''),
        (string) ($p['code'] ?? ''),
        (string) ($p['name'] ?? ''),
    ];
    $array = $p['array_sku'] ?? [];
    if (is_array($array)) {
        foreach ($array as $a) {
            $parts[] = (string) $a;
        }
    }
    foreach ($parts as $part) {
        if ($part !== '' && (norm($part) === $termU || str_contains(norm($part), $termU))) {
            return true;
        }
    }

    return str_contains(norm((string) ($p['name'] ?? '')), $termU);
}

function fetch_from_1c(string $host, array $terms): array
{
    $catResp = sendCurlRequest($host . 'Get/categories', 'GET', []);
    $cats = json_decode($catResp, true);
    if (!is_array($cats)) {
        throw new RuntimeException('Get/categories failed: ' . substr((string) $catResp, 0, 300));
    }

    $found = [];
    $pending = $terms;
    foreach ($cats as $cat) {
        if ($pending === []) {
            break;
        }
        $guid = trim((string) ($cat['guid'] ?? ''));
        if ($guid === '') {
            continue;
        }
        $resp = sendCurlRequest($host . 'Get/products', 'GET', [['guid' => $guid]]);
        $data = json_decode($resp, true);
        if (!is_array($data)) {
            continue;
        }
        foreach ($data as $p) {
            if (!is_array($p)) {
                continue;
            }
            foreach ($pending as $i => $term) {
                if (isset($found[$term])) {
                    unset($pending[$i]);
                    continue;
                }
                if (product_matches($p, $term)) {
                    $found[$term] = $p;
                    unset($pending[$i]);
                }
            }
        }
        $pending = array_values($pending);
    }

    return $found;
}

function upsert_wms(string $wmsPath, array $products): array
{
    if (!is_readable($wmsPath)) {
        throw new RuntimeException('WMS sqlite not readable: ' . $wmsPath);
    }
    $pdo = new PDO('sqlite:' . $wmsPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $unitId = $pdo->query("SELECT id FROM units WHERE short_name='шт' LIMIT 1")->fetchColumn();
    if (!$unitId) {
        throw new RuntimeException('units.шт not found in WMS');
    }

    $upsertCat = $pdo->prepare(
        'INSERT INTO categories (id, name, parent_id) VALUES (?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name'
    );
    $upsertPr = $pdo->prepare(
        'INSERT INTO products (id, sku, name, category_id, unit_id, barcode, brand, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET
           sku=excluded.sku,
           name=excluded.name,
           category_id=excluded.category_id,
           unit_id=excluded.unit_id,
           barcode=CASE WHEN excluded.barcode!=\'\' THEN excluded.barcode ELSE products.barcode END,
           brand=CASE WHEN excluded.brand!=\'\' THEN excluded.brand ELSE products.brand END,
           is_active=1'
    );

    $out = [];
    $pdo->beginTransaction();
    foreach ($products as $term => $p) {
        $id = strtolower(trim((string) ($p['guid'] ?? $p['product'] ?? '')));
        if ($id === '') {
            $out[] = ['term' => $term, 'ok' => false, 'error' => 'no guid'];
            continue;
        }
        $sku = trim((string) ($p['sku'] ?? ''));
        if ($sku === '') {
            $sku = trim((string) ($p['code'] ?? ''));
        }
        if ($sku === '') {
            $sku = $term;
        }
        $name = trim((string) ($p['name'] ?? $sku));
        $brand = trim((string) ($p['brand'] ?? $p['Бренд'] ?? ''));
        $categoryId = trim((string) ($p['category'] ?? ''));
        if ($categoryId !== '' && $categoryId !== '00000000-0000-0000-0000-000000000000') {
            $upsertCat->execute([$categoryId, '1C ' . substr($categoryId, 0, 8)]);
        } else {
            $categoryId = null;
        }
        $barcode = trim((string) ($p['barcode'] ?? ''));
        $upsertPr->execute([$id, $sku, $name, $categoryId, $unitId, $barcode, $brand]);
        $out[] = ['term' => $term, 'ok' => true, 'guid' => $id, 'sku' => $sku, 'name' => $name];
    }
    $pdo->commit();

    return $out;
}

$found = fetch_from_1c($host, $terms);
$missing = array_values(array_diff($terms, array_keys($found)));
if ($missing !== []) {
    fwrite(STDERR, 'Not found in 1C: ' . implode(', ', $missing) . "\n");
}

if ($found === []) {
    echo json_encode(['ok' => false, 'error' => 'nothing found'], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
    exit(1);
}

$wmsResult = upsert_wms($wmsPath, $found);

$syncCmd = 'php ' . escapeshellarg($amoRoot . '/bin/sync_amo1c_products_from_wms.php')
    . ' --department=' . escapeshellarg($department);
$syncOut = shell_exec($syncCmd . ' 2>&1');

echo json_encode([
    'ok' => $missing === [],
    'terms' => $terms,
    'found_in_1c' => count($found),
    'missing' => $missing,
    'wms' => $wmsResult,
    'sync' => trim((string) $syncOut),
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";

exit($missing === [] ? 0 : 2);
