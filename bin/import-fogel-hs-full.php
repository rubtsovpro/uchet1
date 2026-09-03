<?php

declare(strict_types=1);

/**
 * Полный импорт номенклатуры Фогеля из 1С HS → WMS (без затирания остатков Подвески).
 *
 *   php bin/import-fogel-hs-full.php
 *   php bin/import-fogel-hs-full.php --dry-run
 */
$opts = getopt('', ['dry-run', 'skip-rests']);
$dryRun = array_key_exists('dry-run', $opts);
$skipRests = array_key_exists('skip-rests', $opts);

$amoRoot = getenv('AMO1C_ROOT') ?: '/root/amo1c_pnevmopodveska1_ru/public_html';
$wmsPath = getenv('WMS_SQLITE_PATH') ?: '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
$host = getenv('FOGEL_HS_BASE')
    ?: 'https://bezmat.corp.rarus-cloud.ru/fogel_2025/hs/AmoCRM/';

require_once $amoRoot . '/sendCurlRequest.php';

const UUID_RE = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

function hs_json(string $host, string $path, array $body): array
{
    $resp = sendCurlRequest($host . ltrim($path, '/'), 'GET', $body);
    if ($resp === '' || str_contains($resp, 'Отсутствует')) {
        return [];
    }
    $data = json_decode($resp, true);
    if (!is_array($data)) {
        throw new RuntimeException("HS {$path}: bad JSON " . substr((string) $resp, 0, 200));
    }

    return $data;
}

function chunk(array $arr, int $size): array
{
    return $size > 0 ? array_chunk($arr, $size) : [];
}

function num_or_null($v): ?float
{
    if ($v === null || $v === '') {
        return null;
    }
    $n = (float) preg_replace('/[^\d.-]/', '', str_replace(',', '.', (string) $v));

    return is_finite($n) ? $n : null;
}

function product_guid(array $row): string
{
    return strtolower(trim((string) ($row['product'] ?? $row['guid'] ?? $row['id'] ?? '')));
}

if (!is_readable($wmsPath)) {
    fwrite(STDERR, "WMS sqlite not readable: {$wmsPath}\n");
    exit(1);
}

$pdo = new PDO('sqlite:' . $wmsPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('PRAGMA busy_timeout = 60000');

$unitId = $pdo->query("SELECT id FROM units WHERE short_name='шт' LIMIT 1")->fetchColumn();
if (!$unitId) {
    $unitId = '00000000-0000-5000-8000-000000000001';
    if (!$dryRun) {
        $pdo->exec("INSERT OR IGNORE INTO units (id, name, short_name) VALUES ('{$unitId}', 'Штука', 'шт')");
    }
}

$stats = [
    'categories' => 0,
    'warehouses' => 0,
    'products' => 0,
    'applicability' => 0,
    'properties' => 0,
    'prices' => 0,
    'rest_rows' => 0,
];

echo "Fogel HS import from {$host}\n";
echo $dryRun ? "DRY RUN\n" : "APPLY\n";

$cats = hs_json($host, 'Get/Categories', []);
$catIds = [];
foreach ($cats as $row) {
    $id = strtolower(trim((string) ($row['guid'] ?? '')));
    if (!preg_match(UUID_RE, $id)) {
        continue;
    }
    $name = trim((string) ($row['name'] ?? $row['code'] ?? $id));
    $catIds[] = $id;
    if (!$dryRun) {
        $st = $pdo->prepare(
            'INSERT INTO categories (id, name, parent_id) VALUES (?, ?, NULL)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name'
        );
        $st->execute([$id, $name]);
    }
    $stats['categories']++;
}

$stores = hs_json($host, 'Get/Stores', []);
$fogelWhIds = [];
foreach ($stores as $row) {
    $id = strtolower(trim((string) ($row['guid'] ?? '')));
    if (!preg_match(UUID_RE, $id)) {
        continue;
    }
    $name = trim((string) ($row['name'] ?? $row['code'] ?? $id));
    $code = trim((string) ($row['code'] ?? substr($id, 0, 8))) ?: substr($id, 0, 8);
    $fogelWhIds[] = $id;
    if (!$dryRun) {
        $clash = $pdo->prepare('SELECT id FROM warehouses WHERE code = ? AND id != ? LIMIT 1');
        $clash->execute([$code, $id]);
        $clashId = $clash->fetchColumn();
        $safeCode = $clashId ? ($code . ':' . substr($id, 0, 6)) : $code;
        $st = $pdo->prepare(
            'INSERT INTO warehouses (id, name, code, is_active) VALUES (?, ?, ?, 1)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_active = 1'
        );
        $st->execute([$id, $name, $safeCode]);
    }
    $stats['warehouses']++;
}

$batches = chunk($catIds, 12);
$upsertProduct = $pdo->prepare(
    'INSERT INTO products (
       id, sku, name, category_id, unit_id, barcode, brand, is_active,
       code, array_sku, notupload, package_width_cm, package_height_cm,
       package_length_cm, package_weight_g, hs_category_id, measurement_unit
     ) VALUES (?, ?, ?, ?, ?, \'\', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       sku = excluded.sku,
       name = CASE WHEN excluded.name != \'\' THEN excluded.name ELSE products.name END,
       category_id = COALESCE(NULLIF(excluded.category_id,\'\'), products.category_id),
       brand = CASE WHEN excluded.brand != \'\' THEN excluded.brand ELSE products.brand END,
       code = excluded.code,
       array_sku = excluded.array_sku,
       notupload = excluded.notupload,
       package_width_cm = COALESCE(excluded.package_width_cm, products.package_width_cm),
       package_height_cm = COALESCE(excluded.package_height_cm, products.package_height_cm),
       package_length_cm = COALESCE(excluded.package_length_cm, products.package_length_cm),
       package_weight_g = COALESCE(excluded.package_weight_g, products.package_weight_g),
       hs_category_id = excluded.hs_category_id,
       measurement_unit = CASE WHEN excluded.measurement_unit != \'\' THEN excluded.measurement_unit ELSE products.measurement_unit END,
       is_active = 1'
);

foreach ($batches as $i => $batch) {
    echo 'Products batch ' . ($i + 1) . '/' . count($batches) . "\n";
    $body = array_map(static fn ($g) => ['guid' => $g], $batch);
    $products = hs_json($host, 'Get/products', $body);
    $props = hs_json($host, 'Get/property_products', $body);
    $prices = hs_json($host, 'Get/prices', $body);

    if ($dryRun) {
        $stats['products'] += count($products);
        continue;
    }

    $pdo->beginTransaction();
    try {
        foreach ($products as $row) {
            if (!is_array($row)) {
                continue;
            }
            $id = product_guid($row);
            if (!preg_match(UUID_RE, $id)) {
                continue;
            }
            $code = trim((string) ($row['code'] ?? ''));
            $sku = trim((string) ($row['sku'] ?? $row['code'] ?? $id)) ?: $id;
            $clash = $pdo->prepare('SELECT id FROM products WHERE sku = ? AND id != ? LIMIT 1');
            $clash->execute([$sku, $id]);
            if ($clash->fetchColumn()) {
                $sku = $sku . ':' . substr($id, 0, 8);
            }
            $name = trim((string) ($row['name'] ?? ''));
            if ($name === '' || preg_match(UUID_RE, $name)) {
                $name = $code ?: $sku;
            }
            $brand = trim((string) ($row['brand'] ?? $row['Бренд'] ?? ''));
            $arraySku = is_array($row['array_sku'] ?? null)
                ? implode(',', array_filter($row['array_sku']))
                : '';
            $catId = trim((string) ($row['category'] ?? ''));
            if ($catId !== '' && preg_match(UUID_RE, $catId)) {
                $pdo->prepare('INSERT OR IGNORE INTO categories (id, name, parent_id) VALUES (?, ?, NULL)')
                    ->execute([$catId, $catId]);
            } else {
                $catId = null;
            }
            $notupload = ($row['notupload'] ?? 0) === true || (string) ($row['notupload'] ?? '') === '1' ? 1 : 0;
            $mUnit = trim((string) ($row['measurementUnit'] ?? ''));
            $pkg = is_array($row['package'] ?? null) ? $row['package'] : [];
            $upsertProduct->execute([
                $id,
                $sku,
                $name,
                $catId,
                $unitId,
                $brand,
                $code,
                $arraySku,
                $notupload,
                num_or_null($pkg['width_cm'] ?? null),
                num_or_null($pkg['height_cm'] ?? null),
                num_or_null($pkg['length_cm'] ?? null),
                num_or_null($pkg['weight_g'] ?? null),
                $catId,
                $mUnit,
            ]);
            $stats['products']++;

            $fits = is_array($row['array'] ?? null) ? $row['array'] : [];
            foreach ($fits as $fit) {
                $mark = trim((string) ($fit['mark'] ?? ''));
                $model = trim((string) ($fit['model'] ?? ''));
                $onlyModel = trim((string) ($fit['only_model'] ?? ''));
                $generation = trim((string) ($fit['generation'] ?? ''));
                $years = trim((string) ($fit['years'] ?? ''));
                if ($mark === '' && $model === '' && $onlyModel === '' && $generation === '' && $years === '') {
                    continue;
                }
                $appId = "{$id}|{$mark}|{$model}|{$onlyModel}|{$generation}|{$years}";
                $ins = $pdo->prepare(
                    'INSERT OR IGNORE INTO product_applicability
                     (id, product_id, mark, model, only_model, generation, years)
                     VALUES (?, ?, ?, ?, ?, ?, ?)'
                );
                $ins->execute([$appId, $id, $mark, $model, $onlyModel, $generation, $years]);
                if ($ins->rowCount() > 0) {
                    $stats['applicability']++;
                }
            }
        }

        foreach ($props as $row) {
            if (!is_array($row)) {
                continue;
            }
            $pid = product_guid($row);
            if (!preg_match(UUID_RE, $pid)) {
                continue;
            }
            $chk = $pdo->prepare('SELECT 1 FROM products WHERE id = ? LIMIT 1');
            $chk->execute([$pid]);
            if (!$chk->fetchColumn()) {
                continue;
            }
            $list = is_array($row['array_property'] ?? null) ? $row['array_property'] : [];
            $brandFromProp = '';
            foreach ($list as $p) {
                $property = trim((string) ($p['property'] ?? ''));
                $value = trim((string) ($p['value'] ?? ''));
                if ($property === '') {
                    continue;
                }
                $propId = "{$pid}|{$property}|{$value}";
                $ins = $pdo->prepare(
                    'INSERT OR IGNORE INTO product_properties (id, product_id, property, value) VALUES (?, ?, ?, ?)'
                );
                $ins->execute([$propId, $pid, $property, $value]);
                if ($ins->rowCount() > 0) {
                    $stats['properties']++;
                }
                $pl = mb_strtolower($property);
                if ($pl === 'бренд' || str_starts_with($pl, 'бренд ')) {
                    $brandFromProp = $value;
                }
            }
            if ($brandFromProp !== '') {
                $pdo->prepare('UPDATE products SET brand = ? WHERE id = ?')->execute([$brandFromProp, $pid]);
            }
        }

        foreach ($prices as $row) {
            if (!is_array($row)) {
                continue;
            }
            $pid = product_guid($row);
            if (!preg_match(UUID_RE, $pid)) {
                continue;
            }
            $chk = $pdo->prepare('SELECT 1 FROM products WHERE id = ? LIMIT 1');
            $chk->execute([$pid]);
            if (!$chk->fetchColumn()) {
                continue;
            }
            $list = is_array($row['array'] ?? null) ? $row['array'] : [];
            foreach ($list as $p) {
                $priceType = trim((string) ($p['typeprice'] ?? ''));
                $price = (float) ($p['price'] ?? 0);
                if ($priceType === '' || !is_finite($price)) {
                    continue;
                }
                $priceId = "{$pid}|{$priceType}";
                $pdo->prepare(
                    'INSERT OR REPLACE INTO product_prices (id, product_id, price_type, price) VALUES (?, ?, ?, ?)'
                )->execute([$priceId, $pid, $priceType, $price]);
                $stats['prices']++;
            }
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

if (!$skipRests && $fogelWhIds !== [] && $catIds !== [] && !$dryRun) {
    $delBal = $pdo->prepare('DELETE FROM stock_balances WHERE warehouse_id = ?');
    $delRest = $pdo->prepare('DELETE FROM product_store_rests WHERE warehouse_id = ?');
    $insRest = $pdo->prepare(
        'INSERT INTO product_store_rests (product_id, warehouse_id, qty) VALUES (?, ?, ?)
         ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty = excluded.qty'
    );
    $insBal = $pdo->prepare(
        'INSERT INTO stock_balances (warehouse_id, product_id, qty) VALUES (?, ?, ?)
         ON CONFLICT(warehouse_id, product_id) DO UPDATE SET qty = excluded.qty'
    );
    $productExists = $pdo->prepare('SELECT 1 FROM products WHERE id = ?');

    foreach ($fogelWhIds as $whId) {
        echo "Rests warehouse {$whId}\n";
        $delBal->execute([$whId]);
        $delRest->execute([$whId]);
        $rests = hs_json($host, 'Get/Rests', ['stores' => [$whId], 'categories' => $catIds]);
        $pdo->beginTransaction();
        try {
            foreach ($rests as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $pid = strtolower(trim((string) ($row['product'] ?? '')));
                if (!preg_match(UUID_RE, $pid)) {
                    continue;
                }
                $productExists->execute([$pid]);
                if (!$productExists->fetchColumn()) {
                    continue;
                }
                $qty = (float) ($row['quantity'] ?? 0);
                if (!is_finite($qty)) {
                    continue;
                }
                $warehouseId = strtolower(trim((string) ($row['warehouse'] ?? $whId))) ?: $whId;
                $insRest->execute([$pid, $warehouseId, $qty]);
                $insBal->execute([$warehouseId, $pid, $qty]);
                $stats['rest_rows']++;
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }
}

if (!$dryRun) {
    $pdo->prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )->execute(['fogel_hs_synced_at', gmdate('c')]);
}

echo json_encode(['ok' => true, 'dry_run' => $dryRun, 'host' => $host, 'stats' => $stats], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
