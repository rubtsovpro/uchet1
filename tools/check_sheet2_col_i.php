<?php
declare(strict_types=1);

require dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';

$cred = dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$id = '1eW2wcijS59Or5YMVrmzCCVOmIbc9HgDMeEEaCgf4hMw';
$gid = 245905383;

$client = new Google\Client();
$client->setAuthConfig($cred);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS_READONLY]);
$sheets = new Google\Service\Sheets($client);

$ss = $sheets->spreadsheets->get($id, ['fields' => 'sheets.properties']);
$title = null;
foreach ($ss->getSheets() as $sh) {
    $p = $sh->getProperties();
    if ((int) $p->getSheetId() === $gid) {
        $title = (string) $p->getTitle();
        break;
    }
}
if ($title === null) {
    fwrite(STDERR, "sheet gid not found\n");
    exit(1);
}

echo "sheet title: {$title}\n";
$quoted = "'" . str_replace("'", "''", $title) . "'";

$i = $sheets->spreadsheets_values->get($id, "{$quoted}!I1:I80")->getValues() ?? [];
echo "=== Column I (filled / header) ===\n";
$uniq = [];
foreach ($i as $idx => $row) {
    $v = trim((string) ($row[0] ?? ''));
    if ($v === '') {
        continue;
    }
    echo ($idx + 1) . "\t{$v}\n";
    if ($idx > 0) {
        $uniq[$v] = ($uniq[$v] ?? 0) + 1;
    }
}

echo "\n=== Unique values in I (data rows) ===\n";
ksort($uniq, SORT_NATURAL | SORT_FLAG_CASE);
foreach ($uniq as $v => $c) {
    echo "{$c}x\t{$v}\n";
}

echo "\n=== Dropdown source _warehouses_dropdown ===\n";
try {
    $dd = $sheets->spreadsheets_values->get($id, "'_warehouses_dropdown'!A1:A50")->getValues() ?? [];
    foreach ($dd as $idx => $row) {
        echo ($idx + 1) . "\t" . ($row[0] ?? '') . "\n";
    }
} catch (Throwable $e) {
    echo 'ERR: ' . $e->getMessage() . "\n";
}

// Expected Moscow UI set from conversation / whDisplayName
$expected = [
    'Основной',
    'Б/У запчасти',
    'Брак/Рекламация',
    'Курьер',
    'Ожидание оплаты',
    'Отложено под СТО',
    'СТО',
];
echo "\n=== Compare to UI Moscow cards ===\n";
$ddLabels = [];
try {
    $dd = $sheets->spreadsheets_values->get($id, "'_warehouses_dropdown'!A2:A50")->getValues() ?? [];
    foreach ($dd as $row) {
        $v = trim((string) ($row[0] ?? ''));
        if ($v !== '') {
            $ddLabels[] = $v;
        }
    }
} catch (Throwable $e) {
    $ddLabels = [];
}
foreach ($expected as $e) {
    $ok = in_array($e, $ddLabels, true) ? 'OK' : 'MISSING';
    echo "{$ok}\t{$e}\n";
}
$extra = array_values(array_diff($ddLabels, $expected));
if ($extra) {
    echo "EXTRA in dropdown:\n";
    foreach ($extra as $x) {
        echo " -\t{$x}\n";
    }
}
