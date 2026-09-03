<?php
/** Дочистка: сокращения + дубль «Рулевая рейка Монтаж/Демонтаж». */
declare(strict_types=1);
require __DIR__ . '/service_name_case_lib.php';

$dry = in_array('--dry-run', $argv ?? [], true);
$sheetId = '1eW2wcijS59Or5YMVrmzCCVOmIbc9HgDMeEEaCgf4hMw';
$gid = 701459276;

function expandDots(string $n): string
{
    $map = [
        '/\bкомпр\./ui' => 'компрессора',
        '/\bпневмоподв\./ui' => 'пневмоподвески',
        '/\bпневмосист\./ui' => 'пневмосистемы',
        '/\bаморт\./ui' => 'амортизатора',
        '/\bтемп\./ui' => 'температуры',
        '/\bзад\./ui' => 'заднего',
        '/\bперед\./ui' => 'переднего',
        '/\bправ\./ui' => 'правого',
        '/\bлев\./ui' => 'левого',
        '/\bс\/у\b/ui' => 'снять/установить',
    ];
    foreach ($map as $re => $to) {
        $n = preg_replace($re, $to, $n) ?? $n;
    }
    return trim(preg_replace('/\s+/u', ' ', $n) ?? $n);
}

function isMountDup(string $n): bool
{
    return (bool) preg_match('/рулевая\s+рейка.*(монтаж\s*\/\s*демонтаж|монтаж\/демонтаж)/ui', $n);
}

$pdo = new PDO('sqlite:' . wmsSqlitePath());
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$updN = $pdo->prepare('UPDATE products SET name=:n WHERE id=:id');
$updOff = $pdo->prepare('UPDATE products SET is_active=0 WHERE id=:id');

$ren = 0;
$off = 0;
$samples = [];
foreach ($pdo->query("SELECT id,name,is_active FROM products WHERE IFNULL(item_kind,'product')='service'") as $r) {
    $id = (string) $r['id'];
    $old = trim((string) $r['name']);
    if (isMountDup($old)) {
        if (!$dry) {
            $updOff->execute(['id' => $id]);
        }
        $off++;
        $samples[] = "OFF: $old";
        continue;
    }
    $new = expandDots($old);
    if ($new !== $old) {
        if (!$dry) {
            $updN->execute(['n' => $new, 'id' => $id]);
        }
        $ren++;
        if (count($samples) < 15) {
            $samples[] = "$old → $new";
        }
    }
}

[$cred, $auto] = servicesToolBankPaths();
require $auto;
$client = new Google\Client();
$client->setAuthConfig($cred);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);
$ss = $sheets->spreadsheets->get($sheetId, ['fields' => 'sheets.properties']);
$title = null;
foreach ($ss->getSheets() ?? [] as $sh) {
    if ((int) $sh->getProperties()->getSheetId() === $gid) {
        $title = $sh->getProperties()->getTitle();
        break;
    }
}
$q = "'" . str_replace("'", "''", (string) $title) . "'";
$vals = $sheets->spreadsheets_values->get($sheetId, "{$q}!A:Z")->getValues() ?? [];
$h = array_map(static fn($c) => trim(preg_replace('/^\x{FEFF}/u', '', (string) $c) ?? ''), $vals[0] ?? []);
$iA = findCol($h, ['активна']);
$iN = findCol($h, ['наименование']);

$nameOut = [];
$actOut = [];
$sRen = 0;
$sOff = 0;
for ($r = 1; $r < count($vals); $r++) {
    $old = trim((string) ($vals[$r][$iN] ?? ''));
    $on = in_array(mb_strtolower(trim((string) ($vals[$r][$iA] ?? ''))), ['true', '1', 'да', 'yes'], true);
    $new = $old;
    if (isMountDup($old)) {
        $on = false;
        $sOff++;
    } else {
        $exp = expandDots($old);
        if ($exp !== $old) {
            $new = $exp;
            $sRen++;
        }
    }
    $nameOut[] = [$new];
    $actOut[] = [$on ? 'TRUE' : 'FALSE'];
}

if (!$dry) {
    $end = count($vals);
    $sheets->spreadsheets_values->update($sheetId, "{$q}!" . colLetter($iN) . "2:" . colLetter($iN) . $end, new Google\Service\Sheets\ValueRange(['values' => $nameOut]), ['valueInputOption' => 'RAW']);
    $sheets->spreadsheets_values->update($sheetId, "{$q}!A2:A{$end}", new Google\Service\Sheets\ValueRange(['values' => $actOut]), ['valueInputOption' => 'USER_ENTERED']);
}

echo json_encode([
    'dry' => $dry,
    'wms_rename' => $ren,
    'wms_off' => $off,
    'sheet_rename' => $sRen,
    'sheet_off' => $sOff,
    'samples' => $samples,
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
