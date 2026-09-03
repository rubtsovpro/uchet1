<?php
/**
 * Точечные правки услуг:
 * - выключить «Ремонт Заказчику», «Наложенный платёж СДЭК»
 * - «Рулевая рейка Монтаж/Демонтаж» = дубль → выкл (оставить «снять/установить»)
 * - раскрыть сокращения: компр. → компрессора, с/у → снять/установить, ЛЕВЫЙ → левый
 */
declare(strict_types=1);

require __DIR__ . '/service_name_case_lib.php';

$spreadsheetId = getenv('SHEET_ID') ?: '1eW2wcijS59Or5YMVrmzCCVOmIbc9HgDMeEEaCgf4hMw';
$sheetGid = (int) (getenv('APPLY_GID') ?: '701459276');
$dryRun = in_array('--dry-run', $argv ?? [], true);

function shouldDeactivateService(string $name): ?string
{
    if (preg_match('/^ремонт\s+заказчик/ui', $name)) {
        return 'Ремонт Заказчику';
    }
    if (preg_match('/наложенн(ый|ого)\s+плат[её]ж.*сд[еэ]к/ui', $name)
        || $name === 'Наложенный платёж СДЭК') {
        return 'Наложенный платёж СДЭК';
    }
    if (preg_match('/рулевая\s+рейка.*(монтаж\s*\/\s*демонтаж|монтаж\/демонтаж)/ui', $name)) {
        return 'дубль → оставить «Рулевая рейка снять/установить»';
    }

    return null;
}

function expandServiceAbbrevsSafe(string $name): string
{
    $out = $name;
    $map = [
        '/\bкомпр\./ui' => 'компрессора',
        '/\bпневмоподв\./ui' => 'пневмоподвески',
        '/\bпневмосист\./ui' => 'пневмосистемы',
        '/\bаморт\./ui' => 'амортизатора',
        '/\bс\/у\b/ui' => 'снять/установить',
        '/\bс\\\\у\b/ui' => 'снять/установить',
        '/\bЛЕВЫЙ\b/u' => 'левый',
        '/\bЛЕВАЯ\b/u' => 'левая',
        '/\bПРАВЫЙ\b/u' => 'правый',
        '/\bПРАВАЯ\b/u' => 'правая',
        '/\bПЕРЕДНИЙ\b/u' => 'передний',
        '/\bПЕРЕДНЯЯ\b/u' => 'передняя',
        '/\bЗАДНИЙ\b/u' => 'задний',
        '/\bЗАДНЯЯ\b/u' => 'задняя',
    ];
    foreach ($map as $re => $repl) {
        $out = preg_replace($re, $repl, $out) ?? $out;
    }
    $out = preg_replace('/\s+/u', ' ', $out) ?? $out;

    return trim($out);
}

$dbPath = wmsSqlitePath();
$pdo = new PDO('sqlite:' . $dbPath);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$updName = $pdo->prepare('UPDATE products SET name = :name WHERE id = :id');
$updOff = $pdo->prepare('UPDATE products SET is_active = 0 WHERE id = :id');

$wmsRename = 0;
$wmsOff = 0;
$samples = [];

foreach ($pdo->query("SELECT id, name FROM products WHERE IFNULL(item_kind,'product')='service'") as $row) {
    $id = (string) $row['id'];
    $old = trim((string) $row['name']);
    $why = shouldDeactivateService($old);
    if ($why !== null) {
        if (!$dryRun) {
            $updOff->execute(['id' => $id]);
        }
        $wmsOff++;
        $samples[] = "OFF ({$why}): {$old}";
        continue;
    }
    $new = expandServiceAbbrevsSafe($old);
    if ($new !== $old) {
        if (!$dryRun) {
            $updName->execute(['name' => $new, 'id' => $id]);
        }
        $wmsRename++;
        if (count($samples) < 20) {
            $samples[] = "{$old} → {$new}";
        }
    }
}

fwrite(STDERR, "WMS rename={$wmsRename} off={$wmsOff}\n");

[$credPath, $autoload] = servicesToolBankPaths();
require $autoload;
$client = new Google\Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$sheetTitle = null;
foreach ($ss->getSheets() ?? [] as $sh) {
    $p = $sh->getProperties();
    if ($p && (int) $p->getSheetId() === $sheetGid) {
        $sheetTitle = (string) $p->getTitle();
        break;
    }
}
$quoted = "'" . str_replace("'", "''", (string) $sheetTitle) . "'";
$values = $sheets->spreadsheets_values->get($spreadsheetId, "{$quoted}!A:Z")->getValues() ?? [];
$header = array_map(static fn($c) => trim(preg_replace('/^\x{FEFF}/u', '', (string) $c) ?? ''), $values[0] ?? []);
$iActive = findCol($header, ['активна']);
$iName = findCol($header, ['наименование', 'name']);

$nameOut = [];
$activeOut = [];
$sheetRename = 0;
$sheetOff = 0;

for ($r = 1, $n = count($values); $r < $n; $r++) {
    $old = trim((string) ($values[$r][$iName] ?? ''));
    $active = mb_strtolower(trim((string) ($values[$r][$iActive] ?? '')));
    $on = in_array($active, ['true', '1', 'да', 'yes'], true);
    $new = $old;

    if (shouldDeactivateService($old) !== null) {
        $on = false;
        $sheetOff++;
    } else {
        $exp = expandServiceAbbrevsSafe($old);
        if ($exp !== $old) {
            $new = $exp;
            $sheetRename++;
        }
    }
    $nameOut[] = [$new];
    $activeOut[] = [$on ? 'TRUE' : 'FALSE'];
}

fwrite(STDERR, "Sheet rename={$sheetRename} off={$sheetOff}\n");

if (!$dryRun) {
    $end = count($values);
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        "{$quoted}!" . colLetter($iName) . "2:" . colLetter($iName) . $end,
        new Google\Service\Sheets\ValueRange(['values' => $nameOut]),
        ['valueInputOption' => 'RAW']
    );
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        "{$quoted}!A2:A{$end}",
        new Google\Service\Sheets\ValueRange(['values' => $activeOut]),
        ['valueInputOption' => 'USER_ENTERED']
    );
}

echo json_encode([
    'dry_run' => $dryRun,
    'wms_rename' => $wmsRename,
    'wms_off' => $wmsOff,
    'sheet_rename' => $sheetRename,
    'sheet_off' => $sheetOff,
    'samples' => $samples,
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
