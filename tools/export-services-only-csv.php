<?php
/**
 * CSV только услуг (item_kind=service) из WMS sqlite.
 *
 * Usage:
 *   php tools/export-services-only-csv.php [warehouse.sqlite] > services-only.csv
 */
declare(strict_types=1);

$dbPath = $argv[1] ?? (dirname(__DIR__) . '/data/warehouse.sqlite');
if (!is_file($dbPath)) {
    $dbPath = '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
}
if (!is_file($dbPath)) {
    fwrite(STDERR, "Нет БД: {$dbPath}\n");
    exit(1);
}

$pdo = new PDO('sqlite:' . $dbPath);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$categoryName = 'Услуги';

$stmt = $pdo->query(
    "SELECT p.id, IFNULL(p.sku,'') AS sku, IFNULL(p.code,'') AS code, IFNULL(p.name,'') AS name,
            IFNULL(c.name,'') AS category, IFNULL(u.name,'') AS unit, IFNULL(p.brand,'') AS brand,
            IFNULL(p.price_min,0) AS price_min, IFNULL(p.price_max,0) AS price_max,
            IFNULL(p.is_active,1) AS is_active,
            IFNULL(p.source_department,'') AS source_department,
            IFNULL(p.created_at,'') AS created_at
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE IFNULL(p.item_kind,'product') = 'service'
     ORDER BY c.name, p.name, p.sku"
);

$out = fopen('php://output', 'wb');
if (!$out) {
    exit(1);
}
// BOM для Excel
fwrite($out, "\xEF\xBB\xBF");
fputcsv($out, [
    'Активна', '№', 'ID', 'Артикул', 'Код', 'Наименование', 'Категория', 'Ед.', 'Бренд',
    'Цена мин', 'Цена макс', 'Подразделение', 'Создана',
]);
$n = 0;
while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    $n++;
    fputcsv($out, [
        ((int) $row['is_active']) ? 'TRUE' : 'FALSE',
        $n,
        $row['id'],
        $row['sku'],
        $row['code'],
        $row['name'],
        $categoryName,
        $row['unit'],
        $row['brand'],
        $row['price_min'],
        $row['price_max'],
        '',
        $row['created_at'],
    ]);
}
fwrite(STDERR, "exported {$n} services\n");
