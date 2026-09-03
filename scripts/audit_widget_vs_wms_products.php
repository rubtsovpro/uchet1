<?php

declare(strict_types=1);

/**
 * Сверка: позиции из виджета (order_items) vs номенклатура WMS (products).
 * Запуск на tech35: php audit_widget_vs_wms_products.php [--days=90] [--deal=ID]
 */
$days = 0;
$onlyDeal = 0;
foreach ($argv as $arg) {
    if (str_starts_with($arg, '--days=')) {
        $days = max(0, (int) substr($arg, 7));
    }
    if (str_starts_with($arg, '--deal=')) {
        $onlyDeal = (int) substr($arg, 7);
    }
}

$amoConfig = '/root/amo1c_pnevmopodveska1_ru/public_html/config.php';
$wmsDb = '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
if (!is_readable($amoConfig)) {
    $amoConfig = dirname(__DIR__, 2) . '/amo1c_pnevmopodveska1_ru/public_html/config.php';
}
if (!is_readable($wmsDb)) {
    $wmsDb = dirname(__DIR__) . '/data/warehouse.sqlite';
}

require_once dirname($amoConfig) . '/config.php';
require_once dirname($amoConfig) . '/Classes/DbHelper.php';

$pdo = DbHelper::getInstance();
$wdb = new PDO('sqlite:' . $wmsDb, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

$wmsById = [];
$wmsBySku = [];
foreach ($wdb->query('SELECT id, sku, code, name, is_active FROM products') as $r) {
    $id = trim((string) ($r['id'] ?? ''));
    $sku = strtoupper(trim((string) ($r['sku'] ?? '')));
    $code = strtoupper(trim((string) ($r['code'] ?? '')));
    if ($id !== '') {
        $wmsById[$id] = $r;
    }
    if ($sku !== '') {
        $wmsBySku[$sku] = $r;
    }
    if ($code !== '' && !isset($wmsBySku[$code])) {
        $wmsBySku[$code] = $r;
    }
}

$where = ['(TRIM(IFNULL(product_guid,\'\')) != \'\' OR TRIM(IFNULL(sku,\'\')) != \'\')'];
$params = [];
if ($onlyDeal > 0) {
    $where[] = 'lead_id = :deal';
    $params[':deal'] = (string) $onlyDeal;
} elseif ($days > 0) {
    $where[] = 'created_at >= :since';
    $params[':since'] = date('Y-m-d H:i:s', time() - $days * 86400);
}

$sql = 'SELECT TRIM(IFNULL(product_guid,\'\')) AS guid,
               TRIM(IFNULL(sku,\'\')) AS sku,
               TRIM(IFNULL(code,\'\')) AS code,
               TRIM(IFNULL(name,\'\')) AS name,
               COUNT(DISTINCT lead_id) AS deals_cnt,
               MAX(created_at) AS last_used
        FROM order_items
        WHERE ' . implode(' AND ', $where) . '
        GROUP BY guid, sku, code, name
        ORDER BY last_used DESC';

$stmt = $pdo->prepare($sql);
$stmt->execute($params);

$ok = 0;
$inactive = 0;
$absent = [];
$mismatch = [];
$total = 0;

while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    $total++;
    $g = (string) ($row['guid'] ?? '');
    $sku = strtoupper(trim((string) (($row['sku'] ?? '') !== '' ? $row['sku'] : ($row['code'] ?? ''))));
    if ($g !== '' && isset($wmsById[$g])) {
        if ((int) ($wmsById[$g]['is_active'] ?? 0) === 1) {
            $ok++;
        } else {
            $inactive++;
        }
        continue;
    }
    if ($sku !== '' && isset($wmsBySku[$sku])) {
        $row['wms_id'] = (string) ($wmsBySku[$sku]['id'] ?? '');
        $mismatch[] = $row;
        continue;
    }
    $absent[] = $row;
}

usort($absent, static fn(array $a, array $b): int => ((int) $b['deals_cnt'] <=> (int) $a['deals_cnt']) ?: strcmp((string) $a['sku'], (string) $b['sku']));
usort($mismatch, static fn(array $a, array $b): int => ((int) $b['deals_cnt'] <=> (int) $a['deals_cnt']));

echo "=== СВОДКА (виджет order_items → WMS products) ===\n";
if ($onlyDeal > 0) {
    echo "Фильтр: сделка {$onlyDeal}\n";
} elseif ($days > 0) {
    echo "Фильтр: последние {$days} дн.\n";
} else {
    echo "Фильтр: все позиции в order_items\n";
}
echo 'Уникальных позиций в виджете: ' . $total . "\n";
echo 'Товаров в WMS: ' . count($wmsById) . "\n";
echo "Совпало по guid (активный): {$ok}\n";
echo "В учёте, но неактивен: {$inactive}\n";
echo 'Нет в учёте (провал): ' . count($absent) . "\n";
echo 'Guid не совпал, но артикул есть в учёте: ' . count($mismatch) . "\n\n";

if ($absent !== []) {
    echo "=== НЕТ В УЧЁТЕ (топ-50 по числу сделок) ===\n";
    echo "sku\tguid\tname\tdeals\tlast_used\n";
    foreach (array_slice($absent, 0, 50) as $r) {
        echo implode("\t", [
            $r['sku'] ?: $r['code'] ?: '—',
            $r['guid'],
            mb_substr((string) $r['name'], 0, 60),
            (string) $r['deals_cnt'],
            (string) $r['last_used'],
        ]) . "\n";
    }
    echo "\n";
}

if ($mismatch !== []) {
    echo "=== GUID РАЗНЫЙ, АРТИКУЛ ЕСТЬ (нужна перепривязка guid при импорте) ===\n";
    echo "sku\twidget_guid\twms_id\tname\tdeals\n";
    foreach (array_slice($mismatch, 0, 30) as $r) {
        echo implode("\t", [
            $r['sku'] ?: $r['code'] ?: '—',
            $r['guid'],
            $r['wms_id'] ?? '',
            mb_substr((string) $r['name'], 0, 50),
            (string) $r['deals_cnt'],
        ]) . "\n";
    }
}

// Активные сделки с провалами
$dealSql = 'SELECT DISTINCT oi.lead_id
            FROM order_items oi
            WHERE ' . implode(' AND ', $where);
$dealStmt = $pdo->prepare($dealSql);
$dealStmt->execute($params);
$badDeals = [];
foreach ($dealStmt->fetchAll(PDO::FETCH_COLUMN) as $leadId) {
    $leadId = (string) $leadId;
    $items = $pdo->prepare(
        'SELECT product_guid, sku, code, name FROM order_items WHERE lead_id = ?'
    );
    $items->execute([$leadId]);
    $missing = [];
    foreach ($items->fetchAll(PDO::FETCH_ASSOC) as $it) {
        $g = trim((string) ($it['product_guid'] ?? ''));
        $sku = strtoupper(trim((string) (($it['sku'] ?? '') !== '' ? $it['sku'] : ($it['code'] ?? ''))));
        if ($g !== '' && isset($wmsById[$g]) && (int) ($wmsById[$g]['is_active'] ?? 0) === 1) {
            continue;
        }
        if ($sku !== '' && isset($wmsBySku[$sku])) {
            continue;
        }
        $missing[] = ($it['sku'] ?: $it['code'] ?: '?') . ' ' . mb_substr((string) ($it['name'] ?? ''), 0, 40);
    }
    if ($missing !== []) {
        $badDeals[$leadId] = $missing;
    }
}

echo "\n=== СДЕЛКИ С ПРОВАЛАМИ ===\n";
echo 'Сделок с хотя бы одной позицией «нет в учёте»: ' . count($badDeals) . "\n";
$i = 0;
foreach ($badDeals as $leadId => $miss) {
    if ($i++ >= 25) {
        echo '... ещё ' . (count($badDeals) - 25) . " сделок\n";
        break;
    }
    echo "deal {$leadId}: " . implode('; ', array_slice($miss, 0, 3));
    if (count($miss) > 3) {
        echo ' (+' . (count($miss) - 3) . ')';
    }
    echo "\n";
}
