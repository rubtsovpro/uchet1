<?php
/**
 * Пересобрать product_applicability у мастеров Москвы из колонки
 * «ПРИМЕНИМОСТЬ (все машины)» (свойство applicability) + запасной разбор marks/model/body/years.
 *
 * Usage (tech35):
 *   php tools/rebuild_msk_applicability_from_props.php --dry-run
 *   php tools/rebuild_msk_applicability_from_props.php --apply
 */
declare(strict_types=1);

require_once __DIR__ . '/lib_msk_applicability_parse.php';

$wmsDb = getenv('WMS_SQLITE') ?: '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
$dryRun = !in_array('--apply', $argv ?? [], true);

function guid(): string
{
    $d = random_bytes(16);
    $d[6] = chr((ord($d[6]) & 0x0f) | 0x40);
    $d[8] = chr((ord($d[8]) & 0x3f) | 0x80);

    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
}

if (!is_readable($wmsDb)) {
    fwrite(STDERR, "Нет SQLite: {$wmsDb}\n");
    exit(1);
}

$db = new SQLite3($wmsDb);
$db->exec('PRAGMA busy_timeout = 60000');
$db->exec('BEGIN IMMEDIATE');

$masters = [];
$rs = $db->query(
    "SELECT DISTINCT p.id, p.sku
     FROM products p
     WHERE p.is_active = 1
       AND EXISTS (SELECT 1 FROM product_supplier_lots l WHERE l.product_id = p.id)"
);
while ($row = $rs->fetchArray(SQLITE3_ASSOC)) {
    $masters[] = $row;
}
$rs->finalize();

$getProp = $db->prepare(
    "SELECT property, value FROM product_properties
     WHERE product_id = :pid AND property IN ('applicability','marks','model','body','years')"
);
$delApp = $db->prepare('DELETE FROM product_applicability WHERE product_id = :pid');
$insApp = $db->prepare(
    "INSERT INTO product_applicability (id, product_id, mark, model, only_model, generation, years)
     VALUES (:id, :pid, :mark, :model, :only_model, :gen, :years)"
);

$stats = [
    'masters' => count($masters),
    'from_app_col' => 0,
    'from_fallback' => 0,
    'rows_written' => 0,
    'empty' => 0,
];

foreach ($masters as $m) {
    $pid = (string) $m['id'];
    $getProp->bindValue(':pid', $pid, SQLITE3_TEXT);
    $prs = $getProp->execute();
    $props = [
        'applicability' => '',
        'marks' => '',
        'model' => '',
        'body' => '',
        'years' => '',
    ];
    while ($pr = $prs->fetchArray(SQLITE3_ASSOC)) {
        $k = (string) ($pr['property'] ?? '');
        if (isset($props[$k])) {
            $props[$k] = trim((string) ($pr['value'] ?? ''));
        }
    }
    $prs->finalize();

    $rows = parseApplicabilityAllCars($props['applicability']);
    if ($rows !== []) {
        $stats['from_app_col']++;
    } else {
        $rows = parseMarksModelBodyYears(
            $props['marks'],
            $props['model'],
            $props['body'],
            $props['years']
        );
        if ($rows !== []) {
            $stats['from_fallback']++;
        } else {
            $stats['empty']++;
        }
    }

    $rows = enrichApplicabilityOnlyModel($rows);

    if ($dryRun) {
        $stats['rows_written'] += count($rows);
        continue;
    }

    $delApp->bindValue(':pid', $pid, SQLITE3_TEXT);
    $delApp->execute();
    foreach ($rows as $row) {
        $insApp->bindValue(':id', guid(), SQLITE3_TEXT);
        $insApp->bindValue(':pid', $pid, SQLITE3_TEXT);
        $insApp->bindValue(':mark', $row['mark'], SQLITE3_TEXT);
        $insApp->bindValue(':model', $row['model'], SQLITE3_TEXT);
        $insApp->bindValue(':only_model', $row['only_model'], SQLITE3_TEXT);
        $insApp->bindValue(':gen', $row['generation'], SQLITE3_TEXT);
        $insApp->bindValue(':years', $row['years'], SQLITE3_TEXT);
        $insApp->execute();
        $stats['rows_written']++;
    }
}

if ($dryRun) {
    $db->exec('ROLLBACK');
    fwrite(STDERR, 'DRY-RUN ' . json_encode($stats, JSON_UNESCAPED_UNICODE) . "\n");
} else {
    $db->exec('COMMIT');
    fwrite(STDERR, 'APPLY ' . json_encode($stats, JSON_UNESCAPED_UNICODE) . "\n");
}

$sample = [];
$q = $db->query(
    "SELECT DISTINCT a.model
     FROM product_applicability a
     JOIN products p ON p.id = a.product_id
     JOIN product_supplier_lots l ON l.product_id = p.id
     WHERE p.category_id = '11763173-b45e-11e9-b7f2-8837e8c39bf6'
       AND a.mark IN ('Mercedes','Mercedes-Benz')
       AND IFNULL(TRIM(a.model),'') <> ''
     ORDER BY a.model
     LIMIT 30"
);
while ($r = $q->fetchArray(SQLITE3_ASSOC)) {
    $sample[] = $r['model'];
}
fwrite(STDERR, 'sample Mercedes compressor models: ' . implode(' | ', $sample) . "\n");

$bad = [];
$q2 = $db->query(
    "SELECT DISTINCT a.mark
     FROM product_applicability a
     WHERE EXISTS (SELECT 1 FROM product_supplier_lots l WHERE l.product_id = a.product_id)
       AND (a.mark LIKE '%:' OR a.mark IN ('S-Class','E-Class','C-Class','X5','X6'))
     LIMIT 20"
);
while ($r = $q2->fetchArray(SQLITE3_ASSOC)) {
    $bad[] = $r['mark'];
}
fwrite(STDERR, 'bad marks remaining: ' . ($bad === [] ? 'none' : implode(', ', $bad)) . "\n");
$db->close();
