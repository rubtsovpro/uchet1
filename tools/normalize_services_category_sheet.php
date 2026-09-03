<?php
/**
 * Категория «Услуги» для всех услуг; подразделение очищаем (общий каталог).
 *
 *   php tools/normalize_services_category_sheet.php
 *   php tools/normalize_services_category_sheet.php --dry-run
 */
declare(strict_types=1);

require __DIR__ . '/service_name_case_lib.php';

$dryRun = in_array('--dry-run', $argv ?? [], true);
$spreadsheetId = getenv('SHEET_ID') ?: '1eW2wcijS59Or5YMVrmzCCVOmIbc9HgDMeEEaCgf4hMw';
$sheetGid = (int) (getenv('APPLY_GID') ?: '701459276');
$categoryName = trim((string) (getenv('SERVICE_CATEGORY') ?: 'Услуги'));

$dbPath = wmsSqlitePath();
if ($dbPath === '') {
    fwrite(STDERR, "Нет WMS sqlite\n");
    exit(1);
}

$pdo = new PDO('sqlite:' . $dbPath);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$catId = $pdo->query(
    "SELECT id FROM categories WHERE name = " . $pdo->quote($categoryName) . " ORDER BY id LIMIT 1"
)->fetchColumn();
if (!$catId) {
    $catId = bin2hex(random_bytes(8));
    if (!$dryRun) {
        $pdo->prepare('INSERT INTO categories (id, name) VALUES (?, ?)')->execute([$catId, $categoryName]);
    }
    fwrite(STDERR, "Создана категория «{$categoryName}»\n");
}

$needCat = (int) $pdo->query(
    "SELECT COUNT(*) FROM products WHERE IFNULL(item_kind,'product')='service'
     AND IFNULL(category_id,'') != " . $pdo->quote((string) $catId)
)->fetchColumn();
$needDept = (int) $pdo->query(
    "SELECT COUNT(*) FROM products WHERE IFNULL(item_kind,'product')='service'
     AND IFNULL(TRIM(source_department),'') != ''"
)->fetchColumn();

fwrite(STDERR, "WMS: сменить категорию у {$needCat}, очистить подразделение у {$needDept}\n");

if (!$dryRun) {
    $pdo->prepare(
        "UPDATE products SET category_id = :cat
         WHERE IFNULL(item_kind,'product') = 'service'"
    )->execute(['cat' => $catId]);
    $pdo->exec(
        "UPDATE products SET source_department = ''
         WHERE IFNULL(item_kind,'product') = 'service'"
    );
}

[$credPath, $autoload] = servicesToolBankPaths();
if (!is_file($autoload) || !is_file($credPath)) {
    echo json_encode(['wms_category' => $needCat, 'wms_dept' => $needDept, 'sheet' => 0], JSON_UNESCAPED_UNICODE) . "\n";
    exit(0);
}

require $autoload;

$client = new Google\Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$sheetTitle = null;
$sheetId = null;
foreach ($ss->getSheets() ?? [] as $sh) {
    $props = $sh->getProperties();
    if ($props && (int) $props->getSheetId() === $sheetGid) {
        $sheetTitle = (string) $props->getTitle();
        $sheetId = (int) $props->getSheetId();
        break;
    }
}
if ($sheetTitle === null || $sheetId === null) {
    fwrite(STDERR, "Лист не найден\n");
    exit(1);
}

$quoted = "'" . str_replace("'", "''", $sheetTitle) . "'";
$values = $sheets->spreadsheets_values->get($spreadsheetId, "{$quoted}!A:Z")->getValues() ?? [];
$rowCount = count($values);
if ($rowCount < 2) {
    fwrite(STDERR, "Пустой лист\n");
    exit(1);
}

$header = array_map(
    static fn($c) => trim(preg_replace('/^\x{FEFF}/u', '', (string) $c) ?? ''),
    $values[0]
);
$iCat = findCol($header, ['категория', 'category']);
$iDept = findCol($header, ['подразделение', 'department']);

if ($iCat < 0) {
    fwrite(STDERR, "Нет колонки Категория\n");
    exit(1);
}

$dataRows = $rowCount - 1;
$catCol = [];
$deptCol = [];
for ($r = 1; $r < $rowCount; $r++) {
    $catCol[] = [$categoryName];
    $deptCol[] = [''];
}

fwrite(STDERR, "Sheet: {$dataRows} строк → категория «{$categoryName}», подразделение пусто\n");

if (!$dryRun) {
    $catLetter = colLetter($iCat);
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        "{$quoted}!{$catLetter}2:{$catLetter}{$rowCount}",
        new Google\Service\Sheets\ValueRange(['values' => $catCol]),
        ['valueInputOption' => 'RAW']
    );
    if ($iDept >= 0) {
        $deptLetter = colLetter($iDept);
        $sheets->spreadsheets_values->update(
            $spreadsheetId,
            "{$quoted}!{$deptLetter}2:{$deptLetter}{$rowCount}",
            new Google\Service\Sheets\ValueRange(['values' => $deptCol]),
            ['valueInputOption' => 'RAW']
        );
    }
}

echo json_encode([
    'dry_run' => $dryRun,
    'category' => $categoryName,
    'wms_category_updated' => $needCat,
    'wms_dept_cleared' => $needDept,
    'sheet_rows' => $dataRows,
    'url' => "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$sheetGid}",
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
