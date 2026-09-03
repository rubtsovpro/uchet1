<?php
/**
 * Нормальный регистр названий услуг (ЛЕВЫЙ → левый, КАПС → Замена…, ГУР/W221 сохраняются).
 *
 *   php tools/fix_services_name_case.php [--dry-run]
 */
declare(strict_types=1);

require __DIR__ . '/service_name_case_lib.php';

$dryRun = in_array('--dry-run', $argv ?? [], true);
$spreadsheetId = getenv('SHEET_ID') ?: '1eW2wcijS59Or5YMVrmzCCVOmIbc9HgDMeEEaCgf4hMw';
$sheetGid = (int) (getenv('APPLY_GID') ?: '701459276');

$dbPath = wmsSqlitePath();
if ($dbPath === '') {
    fwrite(STDERR, "Нет WMS sqlite\n");
    exit(1);
}

$pdo = new PDO('sqlite:' . $dbPath);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$wmsUpdates = [];
foreach ($pdo->query("SELECT id, name FROM products WHERE IFNULL(item_kind, 'product') = 'service'") as $row) {
    $old = trim((string) $row['name']);
    $new = normalizeServiceName($old);
    if ($new !== $old) {
        $wmsUpdates[] = ['id' => (string) $row['id'], 'old' => $old, 'new' => $new];
    }
}

fwrite(STDERR, 'WMS: ' . count($wmsUpdates) . " переименований\n");

if (!$dryRun && $wmsUpdates) {
    $st = $pdo->prepare('UPDATE products SET name = :name WHERE id = :id');
    foreach ($wmsUpdates as $u) {
        $st->execute(['name' => $u['new'], 'id' => $u['id']]);
    }
}

[$credPath, $autoload] = servicesToolBankPaths();
if (!is_file($autoload) || !is_file($credPath)) {
    echo json_encode(['wms' => count($wmsUpdates), 'sheet' => 0], JSON_UNESCAPED_UNICODE) . "\n";
    exit(0);
}

require $autoload;

$client = new Google\Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$sheetTitle = null;
foreach ($ss->getSheets() ?? [] as $sh) {
    $props = $sh->getProperties();
    if ($props && (int) $props->getSheetId() === $sheetGid) {
        $sheetTitle = (string) $props->getTitle();
        break;
    }
}
if ($sheetTitle === null) {
    exit(1);
}

$quoted = "'" . str_replace("'", "''", $sheetTitle) . "'";
$values = $sheets->spreadsheets_values->get($spreadsheetId, "{$quoted}!A:Z")->getValues() ?? [];
$header = array_map(
    static fn($c) => trim(preg_replace('/^\x{FEFF}/u', '', (string) $c) ?? ''),
    $values[0] ?? []
);
$iName = findCol($header, ['наименование', 'name']);
if ($iName < 0) {
    exit(1);
}

$nameColLetter = colLetter($iName);
$out = [];
$sheetCount = 0;
for ($r = 1, $n = count($values); $r < $n; $r++) {
    $old = trim((string) ($values[$r][$iName] ?? ''));
    $new = normalizeServiceName($old);
    if ($new !== $old) {
        $sheetCount++;
    }
    $out[] = [$new];
}

if (!$dryRun && $sheetCount > 0) {
    $endRow = count($values);
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        "{$quoted}!{$nameColLetter}2:{$nameColLetter}{$endRow}",
        new Google\Service\Sheets\ValueRange(['values' => $out]),
        ['valueInputOption' => 'RAW']
    );
}

$samples = array_values(array_filter($wmsUpdates, static fn($u) => str_contains($u['old'], 'ЛЕВЫЙ') || str_contains($u['old'], 'ПРАВЫЙ')));
if (!$samples) {
    $samples = array_slice($wmsUpdates, 0, 8);
}

echo json_encode([
    'dry_run' => $dryRun,
    'wms' => count($wmsUpdates),
    'sheet' => $sheetCount,
    'samples' => array_map(static fn($u) => $u['old'] . ' → ' . $u['new'], $samples),
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
