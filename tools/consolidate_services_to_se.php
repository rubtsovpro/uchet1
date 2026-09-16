<?php
/**
 * Услуги: оставить se-*, дубли (то же имя) → привязки на se-*, старые выключить.
 * Плюс с дампа «Все что есть в учете» убрать архивные услуги.
 *
 *   php tools/consolidate_services_to_se.php --dry-run
 *   php tools/consolidate_services_to_se.php --apply
 *   php tools/consolidate_services_to_se.php --apply --sheet
 */
declare(strict_types=1);

$apply = in_array('--apply', $argv, true);
$doSheet = in_array('--sheet', $argv, true);
$dbPath = getenv('WMS_SQLITE') ?: '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
$spreadsheetId = getenv('MSK_NOMEN_SHEET_ID') ?: '1KRNwQIi-jYBDtKYl5rQ9is6zngbPds0ZZvBXWCApn7I';
$dumpGid = 371591170;
$cred = getenv('GOOGLE_SA_JSON')
    ?: '/root/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = getenv('GOOGLE_PHP_AUTOLOAD')
    ?: '/root/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';

function normName(string $s): string
{
    $s = mb_strtolower(trim($s), 'UTF-8');
    $s = str_replace(['ё', 'Ё'], ['е', 'е'], $s);
    $s = preg_replace('/\s+/u', ' ', $s) ?? $s;
    // мелкие отличия вроде «2оси» / «2 оси»
    $s = preg_replace('/\b(\d)\s*ос/u', '$1 ос', $s) ?? $s;
    return $s;
}

function colLetter(int $i): string
{
    $i++;
    $s = '';
    while ($i > 0) {
        $i--;
        $s = chr(65 + ($i % 26)) . $s;
        $i = intdiv($i, 26);
    }
    return $s;
}

$pdo = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec('PRAGMA busy_timeout=60000');

// Все услуги: se-* мастера + прочие
$all = $pdo->query(
    "SELECT id, sku, IFNULL(name,'') name, IFNULL(is_active,1) act, IFNULL(item_kind,'') kind,
            IFNULL(code,'') code
     FROM products
     WHERE IFNULL(item_kind,'') IN ('service','услуга')
        OR lower(IFNULL(sku,'')) LIKE 'se-%'
        OR lower(IFNULL(name,'')) LIKE 'услуг%'
     ORDER BY sku"
)->fetchAll(PDO::FETCH_ASSOC);

$seByName = []; // normName => product row (prefer active se-)
$seBySku = [];
foreach ($all as $r) {
    $sku = (string) $r['sku'];
    if (!preg_match('/^se-\d+/i', $sku)) {
        continue;
    }
    $seBySku[strtoupper($sku)] = $r;
    $n = normName((string) $r['name']);
    if ($n === '') {
        continue;
    }
    if (!isset($seByName[$n]) || (int) $r['act'] === 1) {
        $seByName[$n] = $r;
    }
}

// Ручные алиасы имён (активные se с почти одинаковым текстом)
$aliases = [
    normName('Замена Масла ДВС') => normName('Замена масла в Двс'),
];
foreach ($aliases as $from => $to) {
    if (isset($seByName[$to]) && isset($seByName[$from]) && $seByName[$from]['id'] !== $seByName[$to]['id']) {
        // оба se — оставим «Замена масла в Двс» (se-0008), se-0014 тоже склеим на se-0008
        // handled below when scanning duplicates among se
    }
}

$dupes = []; // old_id => se_row
$stats = ['se_kept' => count($seBySku), 'dupes_found' => 0, 'already_se' => 0];

foreach ($all as $r) {
    $sku = (string) $r['sku'];
    $id = (string) $r['id'];
    $n = normName((string) $r['name']);
    if ($n === '') {
        continue;
    }
    // alias fold
    if (isset($aliases[$n])) {
        $n = $aliases[$n];
    }
    if (!isset($seByName[$n])) {
        continue;
    }
    $target = $seByName[$n];
    if ($id === (string) $target['id']) {
        $stats['already_se']++;
        continue;
    }
    // если это другой se-* с тем же/алиас именем — тоже схлопнуть на канон
    $dupes[$id] = $target;
}

$stats['dupes_found'] = count($dupes);
fwrite(STDERR, json_encode([
    'se_masters' => array_keys($seBySku),
    'dupes' => $stats['dupes_found'],
    'sample' => array_slice(array_map(
        static function ($oldId) use ($dupes, $all) {
            $old = null;
            foreach ($all as $r) {
                if ($r['id'] === $oldId) {
                    $old = $r;
                    break;
                }
            }
            $t = $dupes[$oldId];
            return [
                'from' => ($old['sku'] ?? '?') . ' | ' . mb_substr((string) ($old['name'] ?? ''), 0, 50),
                'to' => $t['sku'] . ' | ' . mb_substr((string) $t['name'], 0, 50),
            ];
        },
        array_keys($dupes)
    ), 0, 25),
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n");

// Таблицы привязок product_id / product_guid
$linkUpdates = [
    ['stock_doc_lines', 'product_id'],
    ['stock_balances', 'product_id'],
    ['product_store_rests', 'product_id'],
    ['sales_doc_lines', 'product_guid'],
    ['crm_deal_items', 'product_guid'],
    ['warehouse_task_lines', 'product_id'],
    ['sto_wo_materials', 'product_id'],
    ['product_prices', 'product_id'],
    ['product_properties', 'product_id'],
    ['product_applicability', 'product_id'],
    ['product_alt_codes', 'product_id'],
    ['product_supplier_lots', 'product_id'],
    ['stock_cell_balances', 'product_id'],
];

$linkStats = [];
if ($apply) {
    $pdo->beginTransaction();
    try {
        foreach ($dupes as $oldId => $target) {
            $newId = (string) $target['id'];
            foreach ($linkUpdates as [$table, $col]) {
                try {
                    // merge-safe: для уникальных (warehouse_id, product_id) — delete conflict rows first
                    if ($table === 'stock_balances' || $table === 'product_store_rests') {
                        // перенос qty: суммируем если оба есть
                        $rows = $pdo->prepare("SELECT * FROM {$table} WHERE {$col}=?");
                        $rows->execute([$oldId]);
                        foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $br) {
                            $wh = (string) ($br['warehouse_id'] ?? '');
                            $qty = (float) ($br['qty'] ?? 0);
                            $chk = $pdo->prepare("SELECT qty FROM {$table} WHERE warehouse_id=? AND {$col}=?");
                            $chk->execute([$wh, $newId]);
                            $ex = $chk->fetch(PDO::FETCH_ASSOC);
                            if ($ex) {
                                $pdo->prepare("UPDATE {$table} SET qty = qty + ? WHERE warehouse_id=? AND {$col}=?")
                                    ->execute([$qty, $wh, $newId]);
                                $pdo->prepare("DELETE FROM {$table} WHERE warehouse_id=? AND {$col}=?")
                                    ->execute([$wh, $oldId]);
                            } else {
                                $pdo->prepare("UPDATE {$table} SET {$col}=? WHERE warehouse_id=? AND {$col}=?")
                                    ->execute([$newId, $wh, $oldId]);
                            }
                            $linkStats[$table] = ($linkStats[$table] ?? 0) + 1;
                        }
                        continue;
                    }
                    if ($table === 'product_prices') {
                        // удалить цены дубля если у se уже есть тот же price_type
                        $pdo->exec(
                            "DELETE FROM product_prices WHERE product_id=" . $pdo->quote($oldId)
                            . " AND price_type IN (SELECT price_type FROM product_prices WHERE product_id="
                            . $pdo->quote($newId) . ")"
                        );
                    }
                    $st = $pdo->prepare("UPDATE {$table} SET {$col}=? WHERE {$col}=?");
                    $st->execute([$newId, $oldId]);
                    $n = $st->rowCount();
                    if ($n > 0) {
                        $linkStats[$table] = ($linkStats[$table] ?? 0) + $n;
                    }
                } catch (Throwable $e) {
                    fwrite(STDERR, "warn {$table}: " . $e->getMessage() . "\n");
                }
            }
            // sales_doc_lines / crm: подтянуть sku канона
            try {
                $sku = (string) $target['sku'];
                $name = (string) $target['name'];
                $st = $pdo->prepare('UPDATE sales_doc_lines SET sku=?, name=? WHERE product_guid=?');
                $st->execute([$sku, $name, $newId]);
                if ($st->rowCount() > 0) {
                    $linkStats['sales_doc_lines_sku'] = ($linkStats['sales_doc_lines_sku'] ?? 0) + $st->rowCount();
                }
            } catch (Throwable $e) {
                fwrite(STDERR, 'warn sales_doc_lines sku: ' . $e->getMessage() . "\n");
            }
            // выключить дубль
            $pdo->prepare('UPDATE products SET is_active=0 WHERE id=?')->execute([$oldId]);
        }
        // se-0014 → se-0008 если оба активны (алиас)
        if (isset($seBySku['SE-0014'], $seBySku['SE-0008'])
            && (string) $seBySku['SE-0014']['id'] !== (string) $seBySku['SE-0008']['id']
        ) {
            // already in dupes via alias if names folded; ensure
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fwrite(STDERR, 'FAIL: ' . $e->getMessage() . "\n");
        exit(1);
    }
}

fwrite(STDERR, 'link_updates=' . json_encode($linkStats, JSON_UNESCAPED_UNICODE) . "\n");
fwrite(STDERR, $apply ? "WMS apply ok\n" : "dry-run WMS — --apply\n");

if (!$doSheet) {
    exit(0);
}

require $autoload;
$client = new Google\Client();
$client->setAuthConfig($cred);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);
$meta = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets(properties(sheetId,title))']);
$dumpTitle = null;
foreach ($meta->getSheets() as $s) {
    if ((int) $s->getProperties()->getSheetId() === $dumpGid) {
        $dumpTitle = $s->getProperties()->getTitle();
        break;
    }
}
$vals = $sheets->spreadsheets_values->get($spreadsheetId, "'{$dumpTitle}'!A:Z")->getValues() ?: [];
$head = $vals[0] ?? [];
$iSku = array_search('sku', $head, true);
$iKind = array_search('item_kind', $head, true);
$iAct = array_search('is_active', $head, true);
$iArch = false;
foreach ($head as $i => $h) {
    if (preg_match('/архив/iu', (string) $h)) {
        $iArch = $i;
        break;
    }
}
$iName = array_search('name', $head, true);

$keep = [];
$drop = 0;
$seKeep = 0;
foreach (array_slice($vals, 1) as $row) {
    $kind = mb_strtolower(trim((string) ($row[$iKind] ?? '')), 'UTF-8');
    $sku = (string) ($row[$iSku] ?? '');
    $name = (string) ($row[$iName] ?? '');
    $isService = in_array($kind, ['service', 'услуга'], true)
        || preg_match('/^se-\d+/i', $sku)
        || preg_match('/^(услуга|работа|монтаж|диагност|снятие|установка|доставка)/iu', $name);
    if (!$isService) {
        $keep[] = $row;
        continue;
    }
    if (preg_match('/^se-\d+/i', $sku)) {
        // не держать se-0014 если схлопнули на se-0008
        if (strtoupper($sku) === 'SE-0014' && isset($seByName[normName('Замена масла в Двс')])) {
            $canon = $seByName[normName('Замена масла в Двс')];
            if (strtoupper((string) $canon['sku']) !== 'SE-0014') {
                $drop++;
                continue;
            }
        }
        $keep[] = $row;
        $seKeep++;
        continue;
    }
    // любая другая услуга с дампа — убрать (дубль/архив)
    $drop++;
}
fwrite(STDERR, "sheet keep_non_svc+se=" . count($keep) . " drop_svc_dupes={$drop} se_rows={$seKeep}\n");

if (!$apply) {
    fwrite(STDERR, "dry-run sheet — --apply --sheet\n");
    exit(0);
}

$out = array_merge([$head], $keep);
$lastCol = colLetter(max(count($head) - 1, 0));
$sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google\Service\Sheets\BatchUpdateSpreadsheetRequest([
        'requests' => [[
            'updateSheetProperties' => [
                'properties' => [
                    'sheetId' => $dumpGid,
                    'gridProperties' => [
                        'rowCount' => max(count($out) + 100, 500),
                        'columnCount' => max(count($head) + 2, 28),
                    ],
                ],
                'fields' => 'gridProperties(rowCount,columnCount)',
            ],
        ]],
    ])
);
$sheets->spreadsheets_values->clear(
    $spreadsheetId,
    "'{$dumpTitle}'!A1:AZ",
    new Google\Service\Sheets\ClearValuesRequest()
);
$chunks = array_chunk($out, 3000);
$start = 1;
foreach ($chunks as $chunk) {
    $end = $start + count($chunk) - 1;
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        "'{$dumpTitle}'!A{$start}:{$lastCol}{$end}",
        new Google\Service\Sheets\ValueRange(['values' => $chunk]),
        ['valueInputOption' => 'USER_ENTERED']
    );
    $start = $end + 1;
}
fwrite(STDERR, "sheet written rows=" . count($keep) . "\n");

// amo1c: notupload=1 на дубли, se активны
try {
    $my = new PDO(
        'mysql:host=localhost;dbname=brooklynba_amo1c;charset=utf8mb4',
        'brooklynba_amo1c',
        'Qq112211',
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $amoOff = 0;
    foreach ($dupes as $oldId => $target) {
        $old = null;
        foreach ($all as $r) {
            if ($r['id'] === $oldId) {
                $old = $r;
                break;
            }
        }
        if (!$old) {
            continue;
        }
        $sku = (string) $old['sku'];
        $st = $my->prepare(
            "UPDATE products SET notupload=1 WHERE department='pnevmopodveska_2025' AND sku=? AND sku NOT LIKE 'se-%'"
        );
        $st->execute([$sku]);
        $amoOff += $st->rowCount();
    }
    // ensure se visible
    $my->exec(
        "UPDATE products SET notupload=0 WHERE department='pnevmopodveska_2025' AND sku LIKE 'se-%'"
    );
    fwrite(STDERR, "amo notupload_off_dupes={$amoOff}\n");
} catch (Throwable $e) {
    fwrite(STDERR, 'amo warn: ' . $e->getMessage() . "\n");
}
