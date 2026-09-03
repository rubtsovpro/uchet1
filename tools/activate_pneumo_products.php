<?php
declare(strict_types=1);

$dbPath = '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
$pdo = new PDO('sqlite:' . $dbPath);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

echo "=== brand MRAER ===\n";
foreach ($pdo->query(
    "SELECT IFNULL(is_active,1) a, COUNT(*) c
     FROM products WHERE UPPER(TRIM(IFNULL(brand,''))) = 'MRAER' GROUP BY 1"
) as $r) {
    echo "active={$r['a']} n={$r['c']}\n";
}

echo "=== sku MRAA/MRAE/MRAC/MRAN ===\n";
foreach ($pdo->query(
    "SELECT IFNULL(is_active,1) a, COUNT(*) c FROM products
     WHERE UPPER(IFNULL(sku,'')) LIKE 'MRAA%'
        OR UPPER(IFNULL(sku,'')) LIKE 'MRAE%'
        OR UPPER(IFNULL(sku,'')) LIKE 'MRAC%'
        OR UPPER(IFNULL(sku,'')) LIKE 'MRAN%'
     GROUP BY 1"
) as $r) {
    echo "active={$r['a']} n={$r['c']}\n";
}

echo "=== categories пневмо/подвес ===\n";
foreach ($pdo->query(
    "SELECT id, name FROM categories
     WHERE lower(name) LIKE '%пневмо%' OR lower(name) LIKE '%подвес%'
     LIMIT 40"
) as $r) {
    echo "{$r['id']}\t{$r['name']}\n";
}

echo "=== brands with inactive ===\n";
foreach ($pdo->query(
    "SELECT IFNULL(NULLIF(TRIM(brand),''),'(empty)') b, COUNT(*) c,
            SUM(CASE WHEN IFNULL(is_active,1)=0 THEN 1 ELSE 0 END) inactive
     FROM products
     WHERE UPPER(IFNULL(brand,'')) LIKE '%MRA%'
        OR UPPER(IFNULL(brand,'')) LIKE '%ПНЕВМО%'
        OR UPPER(IFNULL(name,'')) LIKE '%ПНЕВМОПОДВЕС%'
     GROUP BY 1
     ORDER BY c DESC
     LIMIT 25"
) as $r) {
    echo "{$r['c']}\tinact={$r['inactive']}\t{$r['b']}\n";
}

$do = in_array('--apply', $argv ?? [], true);
if (!$do) {
    echo "dry-run only (pass --apply to update)\n";
    exit(0);
}

// Backup
$bak = $dbPath . '.bak-is-active-' . date('Ymd-His');
if (!copy($dbPath, $bak)) {
    fwrite(STDERR, "backup failed\n");
    exit(1);
}
echo "backup={$bak}\n";

$where = "
  (
    UPPER(TRIM(IFNULL(brand,''))) = 'MRAER'
    OR UPPER(IFNULL(sku,'')) LIKE 'MRAA%'
    OR UPPER(IFNULL(sku,'')) LIKE 'MRAE%'
    OR UPPER(IFNULL(sku,'')) LIKE 'MRAC%'
    OR UPPER(IFNULL(sku,'')) LIKE 'MRAN%'
    OR UPPER(IFNULL(sku,'')) LIKE 'MRAR%'
    OR UPPER(IFNULL(name,'')) LIKE '%ПНЕВМОПОДВЕС%'
    OR UPPER(IFNULL(name,'')) LIKE '%ПНЕВМОБАЛЛОН%'
    OR UPPER(IFNULL(name,'')) LIKE '%ПНЕВМОСТОЙК%'
    OR category_id IN (
      SELECT id FROM categories
      WHERE lower(name) LIKE '%пневмо%'
    )
  )
  AND IFNULL(is_active,1) = 0
  AND IFNULL(item_kind,'product') != 'service'
";

$before = (int) $pdo->query("SELECT COUNT(*) FROM products WHERE {$where}")->fetchColumn();
echo "to_activate={$before}\n";

$pdo->exec('BEGIN');
$n = $pdo->exec("UPDATE products SET is_active = 1 WHERE {$where}");
$pdo->exec('COMMIT');
echo "updated={$n}\n";

$left = (int) $pdo->query(
    "SELECT COUNT(*) FROM products
     WHERE IFNULL(is_active,1)=0
       AND (
         UPPER(TRIM(IFNULL(brand,''))) = 'MRAER'
         OR UPPER(IFNULL(sku,'')) LIKE 'MRAA%'
         OR UPPER(IFNULL(sku,'')) LIKE 'MRAE%'
         OR UPPER(IFNULL(sku,'')) LIKE 'MRAC%'
         OR UPPER(IFNULL(sku,'')) LIKE 'MRAN%'
       )"
)->fetchColumn();
echo "still_inactive_mra*={$left}\n";
