<?php
/**
 * Нормализация product_applicability мастеров Москвы к формату 1С:
 *   only_model = Touareg
 *   model      = Touareg II (NF)
 *   generation = II (NF)
 *
 * Убирает смесь листа «Touareg II» + «NF» с архивом «Touareg» + «II (NF)».
 *
 * Usage (tech35):
 *   php tools/normalize_msk_applicability_1c_style.php --dry-run
 *   php tools/normalize_msk_applicability_1c_style.php --apply
 */
declare(strict_types=1);

require_once __DIR__ . '/lib_msk_applicability_parse.php';

$wmsDb = getenv('WMS_SQLITE') ?: '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';
$dryRun = !in_array('--apply', $argv ?? [], true);

/**
 * @return array{mark:string,model:string,only_model:string,generation:string,years:string,changed:bool}
 */
function normalizeAppRow1c(string $mark, string $model, string $onlyModel, string $generation, string $years): array
{
    $mark = trim(preg_replace('/\s+/u', ' ', $mark) ?? $mark);
    $model = trim(preg_replace('/\s+/u', ' ', $model) ?? $model);
    $onlyModel = trim(preg_replace('/\s+/u', ' ', $onlyModel) ?? $onlyModel);
    $generation = trim(preg_replace('/\s+/u', ' ', $generation) ?? $generation);
    $years = trim($years);

    $orig = [$mark, $model, $onlyModel, $generation, $years];

    // Уже 1С: only_model + gen вида «II (NF)» / «I (C5)»
    $genIs1c = (bool) preg_match(
        '/^(?:I{1,3}|IV|V|VI{0,3}|IX|X)\s*\([^)]+\)\s*$/u',
        $generation
    );

    if ($onlyModel !== '' && $genIs1c) {
        // model = only_model + generation, если пусто/криво
        $wantModel = trim($onlyModel . ' ' . $generation);
        if ($model === '' || $model === $onlyModel) {
            $model = $wantModel;
        }

        return [
            'mark' => $mark,
            'model' => $model,
            'only_model' => $onlyModel,
            'generation' => $generation,
            'years' => $years,
            'changed' => [$mark, $model, $onlyModel, $generation, $years] !== $orig,
        ];
    }

    // model уже «Touareg II (NF)»
    if (preg_match(
        '/^(.+?)\s+((?:I{1,3}|IV|V|VI{0,3}|IX|X))\s*\(([^)]+)\)\s*$/u',
        $model,
        $m
    )) {
        $onlyModel = trim($m[1]);
        $generation = trim($m[2] . ' (' . trim($m[3]) . ')');
        $model = trim($onlyModel . ' ' . $generation);

        return [
            'mark' => $mark,
            'model' => $model,
            'only_model' => $onlyModel,
            'generation' => $generation,
            'years' => $years,
            'changed' => true,
        ];
    }

    // Лист: model «Touareg II», generation «NF» / «C7» / «958»
    if (preg_match('/^(.+?)\s+((?:I{1,3}|IV|V|VI{0,3}|IX|X))\s*$/u', $model, $m)
        && $generation !== ''
        && !preg_match('/[()]/u', $generation)
    ) {
        $onlyModel = trim($m[1]);
        $roman = trim($m[2]);
        $code = trim($generation);
        $generation = $roman . ' (' . $code . ')';
        $model = trim($onlyModel . ' ' . $generation);

        return [
            'mark' => $mark,
            'model' => $model,
            'only_model' => $onlyModel,
            'generation' => $generation,
            'years' => $years,
            'changed' => true,
        ];
    }

    // generation короткий код, model без римского: «Touareg» + «NF» — оставить gen как есть, only=model
    if ($onlyModel === '' && $model !== '') {
        $derived = deriveApplicabilityOnlyModel($model, $generation);
        if ($derived !== '') {
            $onlyModel = $derived;
        } else {
            $onlyModel = $model;
        }
        if ($generation !== '' && !preg_match('/[()]/u', $generation)
            && preg_match('/^(.+?)\s+((?:I{1,3}|IV|V|VI{0,3}|IX|X))$/u', $model, $rm)
        ) {
            $onlyModel = trim($rm[1]);
            $generation = trim($rm[2] . ' (' . $generation . ')');
            $model = trim($onlyModel . ' ' . $generation);
        } elseif ($generation !== '' && preg_match('/[()]/u', $generation)) {
            $model = trim($onlyModel . ' ' . $generation);
        }
    }

    return [
        'mark' => $mark,
        'model' => $model,
        'only_model' => $onlyModel,
        'generation' => $generation,
        'years' => $years,
        'changed' => [$mark, $model, $onlyModel, $generation, $years] !== $orig,
    ];
}

if (!is_readable($wmsDb)) {
    fwrite(STDERR, "Нет SQLite: {$wmsDb}\n");
    exit(1);
}

$db = new SQLite3($wmsDb);
$db->exec('PRAGMA busy_timeout = 60000');

$rs = $db->query(
    "SELECT a.id, a.product_id, a.mark, a.model, a.only_model, a.generation, a.years, p.sku
     FROM product_applicability a
     INNER JOIN products p ON p.id = a.product_id
     WHERE p.is_active = 1
       AND EXISTS (SELECT 1 FROM product_supplier_lots l WHERE l.product_id = p.id)"
);

$upd = $db->prepare(
    "UPDATE product_applicability
     SET mark = :mark, model = :model, only_model = :only_model, generation = :gen, years = :years
     WHERE id = :id"
);

$stats = [
    'rows' => 0,
    'changed' => 0,
    'unchanged' => 0,
    'samples' => [],
];

if (!$dryRun) {
    $db->exec('BEGIN IMMEDIATE');
}

while ($row = $rs->fetchArray(SQLITE3_ASSOC)) {
    $stats['rows']++;
    $n = normalizeAppRow1c(
        (string) ($row['mark'] ?? ''),
        (string) ($row['model'] ?? ''),
        (string) ($row['only_model'] ?? ''),
        (string) ($row['generation'] ?? ''),
        (string) ($row['years'] ?? '')
    );
    if (!$n['changed']) {
        $stats['unchanged']++;
        continue;
    }
    $stats['changed']++;
    if (count($stats['samples']) < 12) {
        $stats['samples'][] = [
            'sku' => (string) ($row['sku'] ?? ''),
            'before' => [
                'only' => (string) ($row['only_model'] ?? ''),
                'model' => (string) ($row['model'] ?? ''),
                'gen' => (string) ($row['generation'] ?? ''),
            ],
            'after' => [
                'only' => $n['only_model'],
                'model' => $n['model'],
                'gen' => $n['generation'],
            ],
        ];
    }
    if ($dryRun) {
        continue;
    }
    $upd->bindValue(':mark', $n['mark'], SQLITE3_TEXT);
    $upd->bindValue(':model', $n['model'], SQLITE3_TEXT);
    $upd->bindValue(':only_model', $n['only_model'], SQLITE3_TEXT);
    $upd->bindValue(':gen', $n['generation'], SQLITE3_TEXT);
    $upd->bindValue(':years', $n['years'], SQLITE3_TEXT);
    $upd->bindValue(':id', (string) $row['id'], SQLITE3_TEXT);
    $upd->execute();
}

if (!$dryRun) {
    $db->exec('COMMIT');
}

$db->close();

echo json_encode(
    [
        'ok' => true,
        'dry_run' => $dryRun,
        'stats' => $stats,
    ],
    JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT
) . "\n";
