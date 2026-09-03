<?php
/**
 * Применить лист «Услуги» (оставить/удалить) к prod SQLite Учёта №1.
 * - удалить → is_active=0
 * - оставить → item_kind=service, категория «Услуги», цены не трогаем
 *
 *   php tools/apply_services_sheet_to_wms.php [--dry-run]
 */
declare(strict_types=1);

$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$spreadsheetId = getenv('SHEET_ID') ?: '1T2FEXnWBeFhfKI-Y7_8tVfWFxFDRwTdZtPHH_NeCfn4';
$sheetGid = (int) (getenv('APPLY_GID') ?: '219844074');
$dry = in_array('--dry-run', $argv, true);

if (!is_file($credPath) || !is_file($autoload)) {
    fwrite(STDERR, "Нет Google credentials\n");
    exit(1);
}

require $autoload;

$client = new Google\Client();
$client->setApplicationName('Uchet1 apply services sheet');
$client->setAuthConfig($credPath);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS_READONLY]);
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
    fwrite(STDERR, "Лист gid={$sheetGid} не найден\n");
    exit(1);
}
fwrite(STDERR, "Лист: {$sheetTitle}\n");

$quoted = "'" . str_replace("'", "''", $sheetTitle) . "'";
$resp = $sheets->spreadsheets_values->get($spreadsheetId, "{$quoted}!A:N");
$values = $resp->getValues() ?? [];
if (count($values) < 2) {
    fwrite(STDERR, "Пустой лист\n");
    exit(1);
}

$header = array_map(static fn ($c) => mb_strtolower(trim((string) $c)), $values[0]);
$col = static function (array $header, array $aliases): int {
    foreach ($aliases as $a) {
        $i = array_search(mb_strtolower($a), $header, true);
        if ($i !== false) {
            return (int) $i;
        }
    }
    return -1;
};

$iSku = $col($header, ['артикул', 'sku']);
$iCode = $col($header, ['код', 'code']);
$iName = $col($header, ['название', 'наименование', 'name']);
$iId = $col($header, ['id']);
$iRec = $col($header, ['рекомендация', 'recommendation']);
$iCat = $col($header, ['категория', 'category']);
$iKind = $col($header, ['тип', 'вид', 'item_kind']);

fwrite(STDERR, "cols sku={$iSku} code={$iCode} name={$iName} id={$iId} rec={$iRec} cat={$iCat} kind={$iKind}\n");
fwrite(STDERR, "header: " . json_encode($values[0], JSON_UNESCAPED_UNICODE) . "\n");

$keep = [];
$drop = [];
$unknown = [];
for ($r = 1; $r < count($values); $r++) {
    $row = $values[$r];
    $sku = $iSku >= 0 ? trim((string) ($row[$iSku] ?? '')) : '';
    $code = $iCode >= 0 ? trim((string) ($row[$iCode] ?? '')) : '';
    $name = $iName >= 0 ? trim((string) ($row[$iName] ?? '')) : '';
    $id = $iId >= 0 ? trim((string) ($row[$iId] ?? '')) : '';
    $rec = $iRec >= 0 ? mb_strtolower(trim((string) ($row[$iRec] ?? ''))) : '';
    if ($rec === '') {
        // fallback: колонка K (index 10) как в выгрузке
        $rec = mb_strtolower(trim((string) ($row[10] ?? '')));
    }
    // иногда колонки съехали (как SVC-01 в превью)
    if ($rec !== 'удалить' && $rec !== 'оставить') {
        foreach ($row as $cell) {
            $c = mb_strtolower(trim((string) $cell));
            if ($c === 'удалить' || $c === 'оставить') {
                $rec = $c;
                break;
            }
        }
    }
    if ($sku === '' && $code === '' && $name === '' && $id === '') {
        continue;
    }
    $item = compact('sku', 'code', 'name', 'id', 'rec');
    if ($rec === 'удалить') {
        $drop[] = $item;
    } elseif ($rec === 'оставить') {
        $keep[] = $item;
    } else {
        $unknown[] = $item;
    }
}

fwrite(STDERR, "оставить=" . count($keep) . " удалить=" . count($drop) . " без метки=" . count($unknown) . "\n");
if ($unknown) {
    fwrite(STDERR, "пример без метки: " . json_encode($unknown[0], JSON_UNESCAPED_UNICODE) . "\n");
}

$out = [
    'sheet' => $sheetTitle,
    'gid' => $sheetGid,
    'keep' => $keep,
    'drop' => $drop,
    'unknown' => $unknown,
    'dry' => $dry,
];
file_put_contents(__DIR__ . '/../tmp-services-apply.json', json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
fwrite(STDERR, "Wrote tmp-services-apply.json\n");
echo json_encode([
    'sheet' => $sheetTitle,
    'keep' => count($keep),
    'drop' => count($drop),
    'unknown' => count($unknown),
], JSON_UNESCAPED_UNICODE) . "\n";
