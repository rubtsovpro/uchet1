<?php
/**
 * Столбец «№ дубля»: одинаковый номер у всех услуг одной группы дублей.
 *
 *   APPLY_GID=2015505500 php tools/mark_services_dup_numbers_sheet.php
 */
declare(strict_types=1);

$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$groupsPath = __DIR__ . '/../tmp-services-dup-groups.json';
$spreadsheetId = getenv('SHEET_ID') ?: '1T2FEXnWBeFhfKI-Y7_8tVfWFxFDRwTdZtPHH_NeCfn4';
$sheetGid = (int) (getenv('APPLY_GID') ?: '2015505500');

if (!is_file($credPath) || !is_file($autoload) || !is_file($groupsPath)) {
    fwrite(STDERR, "Нет credentials / dup-groups\n");
    exit(1);
}

$payload = json_decode((string) file_get_contents($groupsPath), true);
/** @var array<string, int> $byId */
$byId = $payload['by_id'] ?? [];
if (!$byId) {
    fwrite(STDERR, "Пустые группы\n");
    exit(1);
}

require $autoload;

$client = new Google\Client();
$client->setApplicationName('Uchet1 dup numbers');
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
    fwrite(STDERR, "Лист не найден\n");
    exit(1);
}

$quoted = "'" . str_replace("'", "''", $sheetTitle) . "'";
$resp = $sheets->spreadsheets_values->get($spreadsheetId, "{$quoted}!A:M");
$values = $resp->getValues() ?? [];
if (count($values) < 2) {
    fwrite(STDERR, "Пустой лист\n");
    exit(1);
}

$out = [['№ дубля']];
$filled = 0;
for ($i = 1; $i < count($values); $i++) {
    $row = $values[$i];
    $kind = trim((string) ($row[3] ?? ''));
    $id = trim((string) ($row[12] ?? ''));
    if ($kind === 'Услуга' && isset($byId[$id])) {
        $out[] = [(string) $byId[$id]];
        $filled++;
    } else {
        $out[] = [''];
    }
}

$end = count($out);
$range = "{$quoted}!P1:P{$end}";
$sheets->spreadsheets_values->update(
    $spreadsheetId,
    $range,
    new Google\Service\Sheets\ValueRange([
        'range' => $range,
        'majorDimension' => 'ROWS',
        'values' => $out,
    ]),
    ['valueInputOption' => 'RAW']
);

$sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google\Service\Sheets\BatchUpdateSpreadsheetRequest([
        'requests' => [
            new Google\Service\Sheets\Request([
                'repeatCell' => [
                    'range' => [
                        'sheetId' => $sheetGid,
                        'startRowIndex' => 0,
                        'endRowIndex' => 1,
                        'startColumnIndex' => 15,
                        'endColumnIndex' => 16,
                    ],
                    'cell' => [
                        'userEnteredFormat' => [
                            'textFormat' => ['bold' => true],
                            'backgroundColor' => ['red' => 0.93, 'green' => 0.95, 'blue' => 0.97],
                        ],
                        'userEnteredValue' => ['stringValue' => '№ дубля'],
                    ],
                    'fields' => 'userEnteredFormat(textFormat,backgroundColor)',
                ],
            ]),
            new Google\Service\Sheets\Request([
                'updateSheetProperties' => [
                    'properties' => [
                        'sheetId' => $sheetGid,
                        'gridProperties' => ['columnCount' => 17],
                    ],
                    'fields' => 'gridProperties.columnCount',
                ],
            ]),
            new Google\Service\Sheets\Request([
                'addConditionalFormatRule' => [
                    'rule' => [
                        'ranges' => [[
                            'sheetId' => $sheetGid,
                            'startRowIndex' => 1,
                            'endRowIndex' => $end,
                            'startColumnIndex' => 15,
                            'endColumnIndex' => 16,
                        ]],
                        'booleanRule' => [
                            'condition' => [
                                'type' => 'NOT_BLANK',
                            ],
                            'format' => [
                                'backgroundColor' => ['red' => 1.0, 'green' => 0.95, 'blue' => 0.8],
                            ],
                        ],
                    ],
                    'index' => 0,
                ],
            ]),
        ],
    ])
);

fwrite(STDERR, "Проставлено номеров: {$filled}, групп: " . count($payload['groups'] ?? []) . "\n");
echo "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$sheetGid}\n";
