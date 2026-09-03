<?php

declare(strict_types=1);

/**
 * Восстановить одну сделку и её документы из бэкапа sqlite.
 * Usage: php bin/restore-deal-from-backup.php <deal_id> [backup_path]
 */
$dealId = trim((string) ($argv[1] ?? ''));
if ($dealId === '') {
    fwrite(STDERR, "deal_id required\n");
    exit(1);
}

$bak = $argv[2] ?? '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite.bak-before-1c-restore-20260824-170426';
$cur = getenv('WMS_SQLITE_PATH') ?: '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';

if (!is_readable($bak)) {
    fwrite(STDERR, "backup not readable: {$bak}\n");
    exit(1);
}

/** @return list<string> */
function tableCols(PDO $db, string $table): array
{
    return $db->query("PRAGMA table_info({$table})")->fetchAll(PDO::FETCH_COLUMN, 1);
}

function copyRows(PDO $dst, PDO $src, string $table, string $where, array $params): int
{
    $cols = array_values(array_intersect(tableCols($dst, $table), tableCols($src, $table)));
    if ($cols === []) {
        return 0;
    }
    $colList = implode(',', array_map(static fn(string $c): string => "[{$c}]", $cols));
    $sel = $src->prepare("SELECT {$colList} FROM [{$table}] WHERE {$where}");
    $sel->execute($params);
    $rows = $sel->fetchAll(PDO::FETCH_ASSOC);
    if ($rows === []) {
        return 0;
    }
    $ph = implode(',', array_fill(0, count($cols), '?'));
    $ins = $dst->prepare("INSERT OR REPLACE INTO [{$table}] ({$colList}) VALUES ({$ph})");
    $n = 0;
    foreach ($rows as $row) {
        $ins->execute(array_values($row));
        $n++;
    }

    return $n;
}

$src = new PDO('sqlite:' . $bak);
$dst = new PDO('sqlite:' . $cur);
$dst->exec('PRAGMA foreign_keys=OFF');
$dst->beginTransaction();

$docIds = $src->query("SELECT id FROM sales_docs WHERE deal_id = " . $src->quote($dealId))
    ->fetchAll(PDO::FETCH_COLUMN);
$stockIds = $src->query("SELECT id FROM stock_docs WHERE deal_id = " . $src->quote($dealId))
    ->fetchAll(PDO::FETCH_COLUMN);

$result = [
    'deal_id' => $dealId,
    'backup' => $bak,
    'deal' => copyRows($dst, $src, 'crm_deals', 'id = ?', [$dealId]),
    'sales_docs' => copyRows($dst, $src, 'sales_docs', 'deal_id = ?', [$dealId]),
    'sales_lines' => 0,
    'stock_docs' => copyRows($dst, $src, 'stock_docs', 'deal_id = ?', [$dealId]),
    'stock_lines' => 0,
];

foreach ($docIds as $id) {
    $result['sales_lines'] += copyRows($dst, $src, 'sales_doc_lines', 'doc_id = ?', [$id]);
}
foreach ($stockIds as $id) {
    $result['stock_lines'] += copyRows($dst, $src, 'stock_doc_lines', 'doc_id = ?', [$id]);
}

$dst->commit();

$q = $dst->prepare(
    'SELECT doc_type, number, counterparty_name, counterparty_inn FROM sales_docs WHERE deal_id = ? ORDER BY doc_type'
);
$q->execute([$dealId]);
$result['restored_sales'] = $q->fetchAll(PDO::FETCH_ASSOC);

echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), PHP_EOL;
