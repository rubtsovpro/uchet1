<?php
/**
 * Отметить партнёров с постоплатой (из Excel) в Учёте + галочка «Партнёр» (862897) в AmoCRM компании.
 *
 * Usage on VPS:
 *   php mark_partners_postpay.php /path/to/tmp-partners-postpay.json [--dry-run]
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only\n");
    exit(1);
}

$jsonPath = $argv[1] ?? '';
$dry = in_array('--dry-run', $argv, true);
if ($jsonPath === '' || !is_file($jsonPath)) {
    fwrite(STDERR, "Usage: php mark_partners_postpay.php partners.json [--dry-run]\n");
    exit(1);
}

require_once '/root/amo1c_pnevmopodveska1_ru/public_html/config.php';
require_once '/root/amo1c_pnevmopodveska1_ru/public_html/amo/access.php';

/** @var array $headers */
/** @var string $subdomain */

const AMO_PARTNER_FIELD_ID = 862897;
const WMS_DB = '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite';

$partners = json_decode((string) file_get_contents($jsonPath), true);
if (!is_array($partners)) {
    fwrite(STDERR, "Bad JSON\n");
    exit(1);
}

function norm(string $s): string
{
    $s = mb_strtolower($s, 'UTF-8');
    $s = str_replace(['ё', 'Ё'], ['е', 'е'], $s);
    $s = preg_replace('/[^\p{L}\p{N}\s]+/u', ' ', $s) ?? $s;
    $s = preg_replace('/\s+/u', ' ', $s) ?? $s;
    return trim($s);
}

function tokens(string $s): array
{
    $stop = [
        'сто', 'партнер', 'партнёр', 'партнера', 'ул', 'улица', 'г', 'город', 'ип', 'ооо', 'сдэк',
        'сдек', 'тк', 'от', 'на', 'и', 'в', 'по', 'для', 'личный', 'номер', 'шоссе', 'против',
        'мрэо', 'гаи', 'пвз', 'сервис', 'авто', 'центр', 'порше', 'мвм',
    ];
    $out = [];
    foreach (preg_split('/\s+/u', norm($s)) ?: [] as $t) {
        if (mb_strlen($t, 'UTF-8') < 3) {
            continue;
        }
        if (in_array($t, $stop, true)) {
            continue;
        }
        if (preg_match('/^\d+$/u', $t)) {
            continue;
        }
        $out[$t] = true;
    }
    return array_keys($out);
}

function scoreName(string $needle, string $hay): float
{
    $n = norm($needle);
    $h = norm($hay);
    if ($n === '' || $h === '') {
        return 0.0;
    }
    if ($n === $h) {
        return 100.0;
    }
    if (str_contains($h, $n) || str_contains($n, $h)) {
        return 85.0;
    }
    $nt = tokens($needle);
    $ht = array_fill_keys(tokens($hay), true);
    if (!$nt) {
        return 0.0;
    }
    $hit = 0;
    foreach ($nt as $t) {
        if (isset($ht[$t])) {
            $hit++;
        }
    }
    $ratio = $hit / count($nt);
    $score = $ratio * 70.0;
    // бонус за совпадение имени (первое слово)
    $nw = explode(' ', $n)[0] ?? '';
    $hw = explode(' ', $h)[0] ?? '';
    if ($nw !== '' && $nw === $hw) {
        $score += 15.0;
    }
    // бонус за город/улицу если оба в обеих строках
    if ($ratio >= 0.5) {
        $score += 5.0;
    }
    return $score;
}

$pdo = new PDO('sqlite:' . WMS_DB);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$rows = $pdo->query(
    "SELECT id, name, IFNULL(amo_company_id,'') AS amo_company_id, IFNULL(is_partner,0) AS is_partner
     FROM counterparties
     WHERE IFNULL(is_active,1)=1"
)->fetchAll(PDO::FETCH_ASSOC);

require_once __DIR__ . '/rate_limit.php';

function amo_patch_companies(array $payload, array $headers, string $subdomain): array
{
    if (!$payload) {
        return ['ok' => true, 'raw' => null];
    }
    $res = amo_api_http_request(
        $subdomain,
        array_merge($headers, ['Content-Type: application/json']),
        'PATCH',
        '/api/v4/companies',
        $payload,
        [],
        'uchetn1_mark_partners_patch'
    );
    return ['ok' => $res['ok'], 'code' => (int) $res['code'], 'raw' => $res['raw'] ?? null];
}

function amo_search_company(string $q, array $headers, string $subdomain): ?array
{
    $res = amo_api_http_request(
        $subdomain,
        $headers,
        'GET',
        '/api/v4/companies',
        null,
        ['limit' => 10, 'query' => $q],
        'uchetn1_mark_partners_search'
    );
    $j = is_array($res['body']) ? $res['body'] : [];
    $items = $j['_embedded']['companies'] ?? [];
    if (!is_array($items) || !$items) {
        return null;
    }
    $best = null;
    $bestScore = 0.0;
    foreach ($items as $c) {
        $name = (string) ($c['name'] ?? '');
        $sc = scoreName($q, $name);
        if ($sc > $bestScore) {
            $bestScore = $sc;
            $best = $c;
        }
    }
    if ($bestScore < 45) {
        return null;
    }
    return ['id' => (int) $best['id'], 'name' => (string) $best['name'], 'score' => $bestScore];
}

$report = [];
$amoPatch = [];
$wmsUpdated = 0;
$amoQueued = 0;
$unmatched = [];

foreach ($partners as $p) {
    $name = trim((string) ($p['name'] ?? ''));
    if ($name === '') {
        continue;
    }
    if (preg_match('/^(итого|всего)\b/ui', $name)) {
        continue;
    }
    $best = null;
    $bestScore = 0.0;
    foreach ($rows as $r) {
        $sc = scoreName($name, (string) $r['name']);
        if ($sc > $bestScore) {
            $bestScore = $sc;
            $best = $r;
        }
    }

    $amoId = $best && $bestScore >= 48 ? (string) $best['amo_company_id'] : '';
    $wmsId = $best && $bestScore >= 48 ? (string) $best['id'] : '';
    $matchedName = $best && $bestScore >= 48 ? (string) $best['name'] : '';

    // id вида amo:company:123 → поле amo_company_id
    if ($amoId === '' && $wmsId !== '' && preg_match('/^amo:company:(\d+)$/', $wmsId, $m)) {
        $amoId = $m[1];
    }

    // fallback: search Amo by name
    if ($amoId === '') {
        $qTokens = tokens($name);
        $queries = [];
        if ($qTokens) {
            $queries[] = implode(' ', array_slice($qTokens, 0, 4));
            $queries[] = implode(' ', array_slice($qTokens, 0, 2));
            $queries[] = $qTokens[0];
        }
        $queries[] = mb_substr(norm($name), 0, 40, 'UTF-8');
        $queries = array_values(array_unique(array_filter($queries)));
        foreach ($queries as $q) {
            $found = amo_search_company($q, $headers, $subdomain);
            usleep(120000);
            if ($found) {
                $amoId = (string) $found['id'];
                if ($matchedName === '') {
                    $matchedName = $found['name'];
                    $bestScore = max($bestScore, (float) $found['score']);
                }
                break;
            }
        }
    }

    if ($wmsId === '' && $amoId === '') {
        $unmatched[] = $name;
        $report[] = [
            'src' => $name,
            'status' => 'unmatched',
            'score' => round($bestScore, 1),
            'candidate' => $best['name'] ?? null,
        ];
        continue;
    }

    if ($wmsId !== '') {
        if (!$dry) {
            $st = $pdo->prepare('UPDATE counterparties SET is_partner = 1 WHERE id = ?');
            $st->execute([$wmsId]);
            // если нашли amo id позже — привяжем
            if ($amoId !== '' && ($best['amo_company_id'] ?? '') === '') {
                $st2 = $pdo->prepare(
                    "UPDATE counterparties SET amo_company_id = ? WHERE id = ? AND IFNULL(amo_company_id,'')=''"
                );
                $st2->execute([$amoId, $wmsId]);
            }
        }
        $wmsUpdated++;
    }

    if ($amoId !== '') {
        $amoPatch[] = [
            'id' => (int) $amoId,
            'custom_fields_values' => [[
                'field_id' => AMO_PARTNER_FIELD_ID,
                'values' => [['value' => true]],
            ]],
        ];
        $amoQueued++;
    }

    $report[] = [
        'src' => $name,
        'status' => 'ok',
        'score' => round($bestScore, 1),
        'wms_id' => $wmsId ?: null,
        'wms_name' => $matchedName ?: null,
        'amo_company_id' => $amoId !== '' ? (int) $amoId : null,
        'was_partner' => $best ? (int) $best['is_partner'] : null,
    ];
}

$amoOk = 0;
$amoErr = [];
if (!$dry && $amoPatch) {
    // Amo accepts batches; chunk by 50
    foreach (array_chunk($amoPatch, 40) as $chunk) {
        // unique by id
        $byId = [];
        foreach ($chunk as $row) {
            $byId[$row['id']] = $row;
        }
        $res = amo_patch_companies(array_values($byId), $headers, $subdomain);
        if ($res['ok']) {
            $amoOk += count($byId);
        } else {
            $amoErr[] = ['code' => $res['code'] ?? 0, 'raw' => substr((string) ($res['raw'] ?? ''), 0, 400)];
        }
        usleep(200000);
    }
}

$out = [
    'dry_run' => $dry,
    'source_count' => count($partners),
    'wms_updated' => $wmsUpdated,
    'amo_queued' => $amoQueued,
    'amo_patched_ok' => $amoOk,
    'unmatched_count' => count($unmatched),
    'unmatched' => $unmatched,
    'amo_errors' => $amoErr,
    'items' => $report,
];

echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
