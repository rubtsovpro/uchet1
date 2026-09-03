<?php
/**
 * Цены услуг из сделок (медиана/средняя) → лист «Услуги» в Google Sheets.
 *
 *   php tools/push_service_prices_from_deals_to_sheet.php [tmp-svc-prices-from-deals.json]
 */
declare(strict_types=1);

$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$pricesPath = $argv[1] ?? (__DIR__ . '/../tmp-svc-prices-from-deals.json');
$spreadsheetId = getenv('SHEET_ID') ?: '1T2FEXnWBeFhfKI-Y7_8tVfWFxFDRwTdZtPHH_NeCfn4';
$sheetGid = (int) (getenv('APPLY_GID') ?: '219844074');

if (!is_file($credPath) || !is_file($autoload) || !is_file($pricesPath)) {
    fwrite(STDERR, "Нет credentials / prices JSON\n");
    exit(1);
}

$payload = json_decode((string) file_get_contents($pricesPath), true);
$services = $payload['services'] ?? null;
if (!is_array($services)) {
    fwrite(STDERR, "Битый prices JSON\n");
    exit(1);
}

$byId = [];
$bySku = [];
foreach ($services as $s) {
    if (!is_array($s)) continue;
    $id = trim((string) ($s['id'] ?? ''));
    $sku = mb_strtolower(trim((string) ($s['sku'] ?? '')));
    if ($id !== '') $byId[$id] = $s;
    if ($sku !== '') $bySku[$sku] = $s;
    $code = mb_strtolower(trim((string) ($s['code'] ?? '')));
    if ($code !== '') $bySku[$code] = $s;
}

require $autoload;

$client = new Google\Client();
$client->setApplicationName('Uchet1 service prices → Sheets');
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
    fwrite(STDERR, "Лист gid={$sheetGid} не найден\n");
    exit(1);
}

$quoted = "'" . str_replace("'", "''", $sheetTitle) . "'";
fwrite(STDERR, "Лист: {$sheetTitle}\n");

$resp = $sheets->spreadsheets_values->get($spreadsheetId, "{$quoted}!A:N");
$values = $resp->getValues() ?? [];
if (count($values) < 2) {
    fwrite(STDERR, "Пустой лист\n");
    exit(1);
}

$header = $values[0];
// find id / sku cols
$find = static function (array $header, array $names): int {
    $low = array_map(static fn ($c) => mb_strtolower(trim((string) $c)), $header);
    foreach ($names as $n) {
        $i = array_search(mb_strtolower($n), $low, true);
        if ($i !== false) return (int) $i;
    }
    return -1;
};
$iId = $find($header, ['id']);
$iSku = $find($header, ['артикул', 'sku']);
$iCode = $find($header, ['код', 'code']);

$outHeader = ['Цена (медиана из сделок)', 'Средняя', 'Мин', 'Макс', 'Строк сделок', 'Источник'];
$out = [$outHeader];
$hit = 0;
$miss = 0;
for ($r = 1; $r < count($values); $r++) {
    $row = $values[$r];
    $id = $iId >= 0 ? trim((string) ($row[$iId] ?? '')) : '';
    $sku = $iSku >= 0 ? mb_strtolower(trim((string) ($row[$iSku] ?? ''))) : '';
    $code = $iCode >= 0 ? mb_strtolower(trim((string) ($row[$iCode] ?? ''))) : '';
    $s = null;
    if ($id !== '' && isset($byId[$id])) $s = $byId[$id];
    elseif ($sku !== '' && isset($bySku[$sku])) $s = $bySku[$sku];
    elseif ($code !== '' && isset($bySku[$code])) $s = $bySku[$code];
    if ($s) {
        $hit++;
        $out[] = [
            (float) $s['median'],
            (float) $s['avg'],
            (float) $s['min'],
            (float) $s['max'],
            (int) $s['n'],
            'crm_deal_items',
        ];
    } else {
        $miss++;
        $out[] = ['', '', '', '', '', ''];
    }
}

$range = "{$quoted}!O1";
$sheets->spreadsheets_values->update(
    $spreadsheetId,
    $range,
    new Google\Service\Sheets\ValueRange(['values' => $out]),
    ['valueInputOption' => 'RAW']
);

fwrite(STDERR, "OK: цен на листе hit={$hit} miss={$miss} (колонки O–T)\n");
echo json_encode(['sheet' => $sheetTitle, 'hit' => $hit, 'miss' => $miss], JSON_UNESCAPED_UNICODE) . "\n";
