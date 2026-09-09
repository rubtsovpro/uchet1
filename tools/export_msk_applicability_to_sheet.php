<?php
/**
 * Выгрузка применимости из WMS → столбец G «Применимость программная».
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1KRNwQIi-jYBDtKYl5rQ9is6zngbPds0ZZvBXWCApn7I
 *
 * Формат ячейки (понятные разделители):
 *   марка | модель | поколение | годы ‖ марка | модель | поколение | годы
 *   `|`  — поля одной применимости (столбцы)
 *   `‖`  — следующая применимость (строка)
 *
 * Usage (tech35):
 *   php tools/export_msk_applicability_to_sheet.php --dry-run
 *   php tools/export_msk_applicability_to_sheet.php --apply
 */
declare(strict_types=1);

$credPath = getenv('GOOGLE_SA_JSON')
    ?: '/root/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = getenv('GOOGLE_PHP_AUTOLOAD')
    ?: '/root/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$wmsDb = getenv('WMS_SQLITE')
    ?: '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
$spreadsheetId = getenv('MSK_NOMEN_SHEET_ID') ?: '1KRNwQIi-jYBDtKYl5rQ9is6zngbPds0ZZvBXWCApn7I';
$sheetGid = (int) (getenv('MSK_NOMEN_SHEET_GID') ?: 0);

$dryRun = true;
foreach ($argv as $a) {
    if ($a === '--apply') {
        $dryRun = false;
    }
    if ($a === '--dry-run') {
        $dryRun = true;
    }
}

if (!is_readable($credPath) || !is_readable($autoload)) {
    fwrite(STDERR, "Нет Google credentials/autoload\n");
    exit(1);
}
if (!is_readable($wmsDb)) {
    fwrite(STDERR, "Нет WMS sqlite: {$wmsDb}\n");
    exit(1);
}

require $autoload;

/** Разделитель полей внутри одной применимости (марка / модель / поколение / годы). */
const APP_FIELD_SEP = ' | ';
/** Разделитель между применимостями (следующая «строка»). */
const APP_ROW_SEP = ' ‖ ';

const HEADER_G = 'Применимость программная (марка | модель | поколение | годы ‖ …)';

function colIndex(array $header, array $aliases, bool $allowContains = true): ?int
{
    $norm = static function (string $h): string {
        $h = mb_strtolower(trim($h));
        $h = preg_replace('/\s+/u', ' ', $h) ?? $h;

        return $h;
    };
    $aliases = array_map($norm, $aliases);
    foreach ($header as $i => $h) {
        $hn = $norm((string) $h);
        foreach ($aliases as $a) {
            if ($hn === $a) {
                return (int) $i;
            }
        }
    }
    if ($allowContains) {
        foreach ($header as $i => $h) {
            $hn = $norm((string) $h);
            foreach ($aliases as $a) {
                if ($a !== '' && str_contains($hn, $a)) {
                    return (int) $i;
                }
            }
        }
    }

    return null;
}

function colLetter(int $index0): string
{
    $n = $index0 + 1;
    $s = '';
    while ($n > 0) {
        $n--;
        $s = chr(65 + ($n % 26)) . $s;
        $n = intdiv($n, 26);
    }

    return $s;
}

/**
 * @param list<array{mark:string,model:string,only_model:string,generation:string,years:string}> $rows
 */
function formatProgrammaticApplicability(array $rows): string
{
    $chunks = [];
    $seen = [];
    foreach ($rows as $row) {
        $mark = trim((string) ($row['mark'] ?? ''));
        $only = trim((string) ($row['only_model'] ?? ''));
        $model = trim((string) ($row['model'] ?? ''));
        $gen = trim((string) ($row['generation'] ?? ''));
        $years = trim((string) ($row['years'] ?? ''));
        $modelOut = $only !== '' ? $only : $model;
        if ($mark === '' && $modelOut === '' && $gen === '') {
            continue;
        }
        $parts = [$mark, $modelOut, $gen, $years];
        $key = mb_strtolower(implode("\0", $parts), 'UTF-8');
        if (isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $chunks[] = implode(APP_FIELD_SEP, $parts);
    }

    return implode(APP_ROW_SEP, $chunks);
}

$client = new Google_Client();
$client->setAuthConfig($credPath);
$client->setScopes([Google_Service_Sheets::SPREADSHEETS]);
$sheets = new Google_Service_Sheets($client);

$meta = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets(properties(sheetId,title))']);
$title = null;
foreach ($meta->getSheets() as $s) {
    $p = $s->getProperties();
    if ((int) $p->getSheetId() === $sheetGid) {
        $title = $p->getTitle();
        break;
    }
}
if ($title === null) {
    fwrite(STDERR, "Лист gid={$sheetGid} не найден\n");
    exit(2);
}

$vals = $sheets->spreadsheets_values->get($spreadsheetId, "'{$title}'!A1:AZ")->getValues() ?: [];
if (count($vals) < 2) {
    fwrite(STDERR, "Пустой лист\n");
    exit(2);
}

$header = $vals[0];
$iMaster = colIndex($header, ['mraer мастер', 'мастер']);
$iProg = colIndex($header, ['применимость программная'], true);
if ($iMaster === null) {
    fwrite(STDERR, "Нет колонки MRAER мастер\n");
    exit(3);
}
if ($iProg === null) {
    // G = index 6
    $iProg = 6;
    fwrite(STDERR, "Колонка G по индексу 6 (заголовок не найден точно)\n");
}
if ($iProg !== 6) {
    fwrite(STDERR, "Ожидался столбец G (6), сейчас {$iProg} — пишем в найденный\n");
}

$colG = colLetter($iProg);
fwrite(STDERR, "лист={$title} master={$iMaster} prog={$iProg} ({$colG})\n");

$db = new PDO('sqlite:' . $wmsDb);
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

/** @var array<string, list<array{mark:string,model:string,only_model:string,generation:string,years:string}>> $bySku */
$bySku = [];
$st = $db->query(
    "SELECT p.sku, a.mark, a.model, a.only_model, a.generation, a.years
     FROM products p
     INNER JOIN product_applicability a ON a.product_id = p.id
     WHERE p.is_active = 1
     ORDER BY p.sku, a.mark, a.only_model, a.model, a.generation, a.years"
);
while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
    $sku = strtoupper(trim((string) ($r['sku'] ?? '')));
    if ($sku === '') {
        continue;
    }
    $bySku[$sku][] = [
        'mark' => trim((string) ($r['mark'] ?? '')),
        'model' => trim((string) ($r['model'] ?? '')),
        'only_model' => trim((string) ($r['only_model'] ?? '')),
        'generation' => trim((string) ($r['generation'] ?? '')),
        'years' => trim((string) ($r['years'] ?? '')),
    ];
}

$out = [];
$stats = [
    'rows' => 0,
    'filled' => 0,
    'empty' => 0,
    'no_master' => 0,
    'apps_total' => 0,
];
$samples = [];

for ($r = 1, $n = count($vals); $r < $n; $r++) {
    $row = $vals[$r];
    $master = strtoupper(trim((string) ($row[$iMaster] ?? '')));
    if ($master === '') {
        $out[] = [''];
        $stats['no_master']++;
        continue;
    }
    $stats['rows']++;
    $apps = $bySku[$master] ?? [];
    $text = formatProgrammaticApplicability($apps);
    if ($text === '') {
        $stats['empty']++;
        $out[] = [''];
        continue;
    }
    $stats['filled']++;
    $stats['apps_total'] += count($apps);
    $out[] = [$text];
    if (count($samples) < 5) {
        $samples[$master] = mb_substr($text, 0, 160);
    }
}

fwrite(STDERR, json_encode([
    'dry_run' => $dryRun,
    'stats' => $stats,
    'samples' => $samples,
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n");

if ($dryRun) {
    fwrite(STDERR, "dry-run — лист не трогаем\n");
    exit(0);
}

$endRow = count($vals);
$data = new Google_Service_Sheets_ValueRange([
    'values' => array_merge([[HEADER_G]], $out),
]);
$sheets->spreadsheets_values->update(
    $spreadsheetId,
    "'{$title}'!{$colG}1:{$colG}{$endRow}",
    $data,
    ['valueInputOption' => 'RAW']
);

fwrite(STDERR, "OK: записано в {$colG}1:{$colG}{$endRow}\n");
