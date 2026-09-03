<?php
/** Отключить услугу «Наложенный платёж СДЭК» в WMS и Google Sheet. */
declare(strict_types=1);

require __DIR__ . '/service_name_case_lib.php';

$needle = 'Наложенный платёж СДЭК';
$spreadsheetId = '1eW2wcijS59Or5YMVrmzCCVOmIbc9HgDMeEEaCgf4hMw';
$sheetGid = 701459276;

$dbPath = wmsSqlitePath();
$pdo = new PDO('sqlite:' . $dbPath);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$st = $pdo->prepare(
    "UPDATE products SET is_active = 0
     WHERE IFNULL(item_kind,'product') = 'service'
       AND (name = :n OR name LIKE :like OR code = 'НФ-00028478')"
);
$st->execute(['n' => $needle, 'like' => '%' . $needle . '%']);
echo "WMS deactivated: " . $st->rowCount() . "\n";

[$credPath, $autoload] = servicesToolBankPaths();
require $autoload;

$client = new Google\Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$title = null;
foreach ($ss->getSheets() ?? [] as $sh) {
    if ((int) $sh->getProperties()->getSheetId() === $sheetGid) {
        $title = (string) $sh->getProperties()->getTitle();
        break;
    }
}
$quoted = "'" . str_replace("'", "''", $title) . "'";
$values = $sheets->spreadsheets_values->get($spreadsheetId, "{$quoted}!A:F")->getValues() ?? [];
$iName = findCol(array_map(fn($c) => trim((string) $c), $values[0] ?? []), ['наименование', 'name']);

$rows = [];
$hit = 0;
for ($r = 1, $n = count($values); $r < $n; $r++) {
    $name = trim((string) ($values[$r][$iName] ?? ''));
    if ($name === $needle || str_contains($name, 'Наложенный платёж СДЭК')) {
        $rows[] = [$r + 1];
        $hit++;
    }
}
echo "Sheet rows: {$hit}\n";

if ($hit > 0) {
    $activeCol = [];
    for ($r = 1, $n = count($values); $r < $n; $r++) {
        $name = trim((string) ($values[$r][$iName] ?? ''));
        if ($name === $needle || str_contains($name, 'Наложенный платёж СДЭК')) {
            $activeCol[] = ['FALSE'];
        }
    }
    $end = count($values);
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        "{$quoted}!A2:A{$end}",
        new Google\Service\Sheets\ValueRange(['values' => array_merge(
            array_slice(array_fill(0, $r = 0, ['']), 0, 0),
            $activeCol
        )]),
        ['valueInputOption' => 'USER_ENTERED']
    );
}

// точечно: только нужные строки
$batch = [];
foreach ($rows as [$rowNum]) {
    $batch[] = ['range' => "{$quoted}!A{$rowNum}", 'values' => [['FALSE']]];
}
// проще — перечитаем весь лист A и обновим только matching
$all = $sheets->spreadsheets_values->get($spreadsheetId, "{$quoted}!A:A")->getValues() ?? [];
$out = [];
for ($r = 1, $n = count($all); $r < $n; $r++) {
    $full = $sheets->spreadsheets_values->get($spreadsheetId, "{$quoted}!F" . ($r + 1))->getValues()[0][0] ?? '';
}
// redo cleanly
$fullRows = $sheets->spreadsheets_values->get($spreadsheetId, "{$quoted}!A:F")->getValues() ?? [];
$activeOut = [];
$sheetHit = 0;
for ($r = 1, $n = count($fullRows); $r < $n; $r++) {
    $name = trim((string) ($fullRows[$r][$iName] ?? ''));
    $cur = mb_strtolower(trim((string) ($fullRows[$r][0] ?? '')));
    if ($name === $needle || str_contains($name, 'Наложенный платёж СДЭК')) {
        $activeOut[] = ['FALSE'];
        $sheetHit++;
    } else {
        $activeOut[] = [($cur === 'true' || $cur === '1') ? 'TRUE' : 'FALSE'];
    }
}
$endRow = count($fullRows);
$sheets->spreadsheets_values->update(
    $spreadsheetId,
    "{$quoted}!A2:A{$endRow}",
    new Google\Service\Sheets\ValueRange(['values' => $activeOut]),
    ['valueInputOption' => 'USER_ENTERED']
);
echo "Sheet deactivated: {$sheetHit}\n";
