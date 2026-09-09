<?php
/**
 * Восстановить product_applicability мастеров Москвы из архивного WMS (1С),
 * а не из колонок листа «Марки / Модель / Кузова».
 *
 * Источник по умолчанию: bak-before-1c-restore (структура mark + only_model + generation).
 * Сопоставление: SKU мастера.
 *
 * Usage (tech35):
 *   php tools/restore_msk_applicability_from_1c_archive.php --dry-run
 *   php tools/restore_msk_applicability_from_1c_archive.php --apply
 */
declare(strict_types=1);

require_once __DIR__ . '/lib_msk_applicability_parse.php';

$wmsDb = getenv('WMS_SQLITE') ?: '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
$archiveDb = getenv('WMS_ARCHIVE_SQLITE')
    ?: '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite.bak-before-1c-restore-20260824-170426';
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
if (!is_readable($archiveDb)) {
    fwrite(STDERR, "Нет архива: {$archiveDb}\n");
    exit(1);
}

$db = new SQLite3($wmsDb);
$arch = new SQLite3($archiveDb, SQLITE3_OPEN_READONLY);
$db->exec('PRAGMA busy_timeout = 60000');
$arch->exec('PRAGMA busy_timeout = 60000');

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

$archApps = $arch->prepare(
    "SELECT a.mark, a.model, a.only_model, a.generation, a.years
     FROM product_applicability a
     INNER JOIN products p ON p.id = a.product_id
     WHERE p.sku = :sku
     ORDER BY a.mark, a.only_model, a.generation, a.years"
);
$delApp = $db->prepare('DELETE FROM product_applicability WHERE product_id = :pid');
$insApp = $db->prepare(
    "INSERT INTO product_applicability (id, product_id, mark, model, only_model, generation, years)
     VALUES (:id, :pid, :mark, :model, :only_model, :gen, :years)"
);

$stats = [
    'masters' => count($masters),
    'from_archive' => 0,
    'archive_rows' => 0,
    'derive_only_model' => 0,
    'unchanged_no_archive' => 0,
];

if (!$dryRun) {
    $db->exec('BEGIN IMMEDIATE');
}

foreach ($masters as $m) {
    $pid = (string) $m['id'];
    $sku = (string) $m['sku'];

    $archApps->bindValue(':sku', $sku, SQLITE3_TEXT);
    $ars = $archApps->execute();
    $rows = [];
    while ($ar = $ars->fetchArray(SQLITE3_ASSOC)) {
        $mark = trim((string) ($ar['mark'] ?? ''));
        $model = trim((string) ($ar['model'] ?? ''));
        $only = trim((string) ($ar['only_model'] ?? ''));
        $gen = trim((string) ($ar['generation'] ?? ''));
        $years = trim((string) ($ar['years'] ?? ''));
        if ($mark === '' && $model === '' && $only === '') {
            continue;
        }
            if ($only === '') {
            $only = deriveApplicabilityOnlyModel($model !== '' ? $model : $only, $gen);
        }
        $rows[] = [
            'mark' => $mark,
            'model' => $model !== '' ? $model : ($only !== '' ? trim($only . ($gen !== '' ? ' ' . $gen : '')) : ''),
            'only_model' => $only,
            'generation' => $gen,
            'years' => $years,
        ];
    }
    $ars->finalize();

    if ($rows === []) {
        // Нет в архиве — добить only_model у текущих строк (из листа), не трогая mark/model.
        $getCur = $db->prepare(
            'SELECT mark, model, only_model, generation, years FROM product_applicability WHERE product_id = :pid'
        );
        $getCur->bindValue(':pid', $pid, SQLITE3_TEXT);
        $crs = $getCur->execute();
        $needFix = [];
        while ($cr = $crs->fetchArray(SQLITE3_ASSOC)) {
            $only = trim((string) ($cr['only_model'] ?? ''));
            $model = trim((string) ($cr['model'] ?? ''));
            $gen = trim((string) ($cr['generation'] ?? ''));
            if ($only !== '' || $model === '') {
                continue;
            }
            $derived = deriveApplicabilityOnlyModel($model, $gen);
            if ($derived === '') {
                continue;
            }
            if ($gen === '' && preg_match('/\(([^)]+)\)/u', $model, $gm)) {
                $gen = trim($gm[1]);
            }
            $needFix[] = [
                'mark' => trim((string) ($cr['mark'] ?? '')),
                'model' => $model,
                'only_model' => $derived,
                'generation' => $gen,
                'years' => trim((string) ($cr['years'] ?? '')),
            ];
        }
        $crs->finalize();
        if ($needFix === []) {
            $stats['unchanged_no_archive']++;
            continue;
        }
        $stats['derive_only_model']++;
        $rows = $needFix;
        $stats['archive_rows'] += count($rows);
        if ($dryRun) {
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
        }
        continue;
    }

    $stats['from_archive']++;
    $stats['archive_rows'] += count($rows);

    if ($dryRun) {
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
    }
}

if (!$dryRun) {
    $db->exec('COMMIT');
}

$arch->close();
$db->close();

echo json_encode(
    [
        'ok' => true,
        'dry_run' => $dryRun,
        'archive' => $archiveDb,
        'stats' => $stats,
    ],
    JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
) . "\n";
