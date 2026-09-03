<?php
/**
 * Рекомендации по услугам → столбцы «Рекомендация» + «Комментарий».
 * Дубли: один код без различия лев/прав/перед/зад; копии @департамент.
 *
 *   php tools/mark_services_delete_recommendations.php [--dry-run]
 */
declare(strict_types=1);

require __DIR__ . '/service_name_case_lib.php';

$dryRun = in_array('--dry-run', $argv ?? [], true);
$spreadsheetId = getenv('SHEET_ID') ?: '1eW2wcijS59Or5YMVrmzCCVOmIbc9HgDMeEEaCgf4hMw';
$sheetGid = (int) (getenv('APPLY_GID') ?: '701459276');

[$credPath, $autoload] = servicesToolBankPaths();
if (!is_file($autoload) || !is_file($credPath)) {
    fwrite(STDERR, "Нет Google credentials\n");
    exit(1);
}

require $autoload;

function isActiveCell(string $raw): bool
{
    $v = mb_strtolower(trim($raw));

    return in_array($v, ['true', '1', 'да', 'yes'], true);
}

function hasDeptPrefixId(string $id): bool
{
    return str_contains($id, '::');
}

function hasDeptSkuSuffix(string $sku): bool
{
    return str_contains($sku, '@');
}

function rowScore(bool $active, string $avg, string $id): int
{
    return ($avg !== '' ? 10000 : 0) + ($active ? 1000 : 0) + (hasDeptPrefixId($id) ? 0 : 100);
}

/** @return array{rec:string,comment:string} */
function recommendRow(
    array $row,
    int $iActive,
    int $iId,
    int $iSku,
    int $iCode,
    int $iName,
    int $iAvg,
    int $iMin,
    int $iMax,
    array $codeGroups
): array {
    $active = isActiveCell((string) ($row[$iActive] ?? ''));
    $id = trim((string) ($row[$iId] ?? ''));
    $sku = trim((string) ($row[$iSku] ?? ''));
    $code = normCode((string) ($row[$iCode] ?? ''));
    $name = trim((string) ($row[$iName] ?? ''));
    $avg = trim((string) ($row[$iAvg] ?? ''));
    $min = trim((string) ($row[$iMin] ?? ''));
    $max = trim((string) ($row[$iMax] ?? ''));
    $posTag = servicePositionTag($name);

    if ($name === '' && $code === '') {
        return ['rec' => 'удалить', 'comment' => 'Пустое название и код'];
    }

    $comments = [];
    $isDeptCopy = hasDeptPrefixId($id) || hasDeptSkuSuffix($sku);
    $isDuplicate = false;

    if ($code !== '' && isset($codeGroups[$code])) {
        $group = $codeGroups[$code];
        if (count($group) > 1) {
            usort($group, static fn($a, $b) => $b['score'] <=> $a['score']);
            $winner = $group[0];
            if ($winner['id'] !== $id) {
                if (servicesDistinctByPosition($name, $winner['name'])) {
                    $comments[] = 'Отдельная услуга (' . ($posTag ?: 'сторона/ось') . ') — не дубль';
                } elseif ($isDeptCopy && !hasDeptPrefixId($winner['id'])) {
                    $comments[] = 'Копия @департамент → оставить ' . $winner['code'];
                    $isDuplicate = true;
                } elseif (normName($name) === normName($winner['name'])) {
                    $comments[] = 'Дубль по коду ' . $code . ' → ' . mb_substr($winner['name'], 0, 45);
                    $isDuplicate = true;
                } else {
                    $comments[] = 'Тот же код, другое имя — проверить вручную';
                }
            }
        }
    }

    if ($posTag !== '' && !$isDuplicate) {
        $comments[] = 'Уникальна по ' . str_replace('+', '/', $posTag);
    }

    if (!$active && $isDuplicate) {
        $comments[] = 'Уже выключена';
    }

    if ($avg === '' && $min === '' && $max === '') {
        $comments[] = 'Нет продаж ≥1000 ₽';
    }

    if ($isDuplicate) {
        return [
            'rec' => 'удалить',
            'comment' => implode('; ', array_unique($comments)),
        ];
    }

    if ($active && $avg !== '') {
        $note = $posTag !== '' ? 'Активна, есть продажи, ' . str_replace('+', '/', $posTag) : 'Активна, есть продажи';

        return ['rec' => 'оставить', 'comment' => $note];
    }

    if ($active && $avg === '') {
        return [
            'rec' => 'проверить',
            'comment' => implode('; ', array_unique($comments)) ?: 'Активна, нет продаж ≥1000 ₽',
        ];
    }

    if (!$active && !$isDuplicate) {
        return [
            'rec' => 'проверить',
            'comment' => implode('; ', array_unique($comments)) ?: 'Выключена — уточнить нужна ли',
        ];
    }

    return ['rec' => 'оставить', 'comment' => implode('; ', array_unique($comments))];
}

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
if (count($values) < 2) {
    exit(1);
}

$header = array_map(
    static fn($c) => trim(preg_replace('/^\x{FEFF}/u', '', (string) $c) ?? ''),
    $values[0]
);
$iActive = findCol($header, ['активна']);
$iId = findCol($header, ['id']);
$iSku = findCol($header, ['артикул', 'sku']);
$iCode = findCol($header, ['код', 'code']);
$iName = findCol($header, ['наименование', 'name']);
$iAvg = findCol($header, ['средняя', 'avg']);
$iMin = findCol($header, ['цена мин', 'min']);
$iMax = findCol($header, ['цена макс', 'max']);

/** @var array<string,list<array{id:string,code:string,name:string,score:int}>> $codeGroups */
$codeGroups = [];
for ($r = 1, $n = count($values); $r < $n; $r++) {
    $row = $values[$r];
    $id = trim((string) ($row[$iId] ?? ''));
    $code = normCode((string) ($row[$iCode] ?? ''));
    $name = trim((string) ($row[$iName] ?? ''));
    $avg = trim((string) ($row[$iAvg] ?? ''));
    $active = isActiveCell((string) ($row[$iActive] ?? ''));
    if ($code === '') {
        continue;
    }
    $codeGroups[$code][] = [
        'id' => $id,
        'code' => $code,
        'name' => $name,
        'score' => rowScore($active, $avg, $id),
    ];
}

$out = [['Рекомендация', 'Комментарий']];
$counts = ['удалить' => 0, 'проверить' => 0, 'оставить' => 0];
$examples = [];
for ($r = 1, $n = count($values); $r < $n; $r++) {
    $rec = recommendRow(
        $values[$r],
        $iActive,
        $iId,
        $iSku,
        $iCode,
        $iName,
        $iAvg,
        $iMin,
        $iMax,
        $codeGroups
    );
    $counts[$rec['rec']] = ($counts[$rec['rec']] ?? 0) + 1;
    $out[] = [$rec['rec'], $rec['comment']];
    $nm = trim((string) ($values[$r][$iName] ?? ''));
    if (count($examples) < 6 && (
        stripos($nm, 'стойка стабилизатора') !== false
        || stripos($nm, 'Щётки стеклоочистителя') !== false
    )) {
        $examples[] = ['name' => $nm, 'rec' => $rec['rec'], 'comment' => $rec['comment']];
    }
}

$recCol = count($header);
while (isset($header[$recCol]) && trim((string) $header[$recCol]) !== '') {
    $recCol++;
}
$recLetter = colLetter($recCol);
$endRow = count($values);

fwrite(STDERR, "удалить={$counts['удалить']} проверить={$counts['проверить']} оставить={$counts['оставить']}\n");

if (!$dryRun) {
    $sheets->spreadsheets->batchUpdate(
        $spreadsheetId,
        new Google\Service\Sheets\BatchUpdateSpreadsheetRequest([
            'requests' => [
                new Google\Service\Sheets\Request([
                    'updateSheetProperties' => [
                        'properties' => [
                            'sheetId' => $sheetGid,
                            'gridProperties' => ['columnCount' => max(16, $recCol + 2)],
                        ],
                        'fields' => 'gridProperties.columnCount',
                    ],
                ]),
            ],
        ])
    );
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        "{$quoted}!{$recLetter}1",
        new Google\Service\Sheets\ValueRange(['values' => [['Рекомендация', 'Комментарий']]]),
        ['valueInputOption' => 'RAW']
    );
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        "{$quoted}!{$recLetter}2:" . colLetter($recCol + 1) . $endRow,
        new Google\Service\Sheets\ValueRange(['values' => array_slice($out, 1)]),
        ['valueInputOption' => 'RAW']
    );
}

echo json_encode([
    'dry_run' => $dryRun,
    'counts' => $counts,
    'examples' => $examples,
    'columns' => $recLetter . '-' . colLetter($recCol + 1),
    'url' => "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$sheetGid}",
], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
