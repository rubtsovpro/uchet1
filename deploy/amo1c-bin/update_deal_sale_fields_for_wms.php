<?php
/**
 * CLI: обновить на сделке Amo CF «Канал реализации» (858983), «СТО» (853005),
 * «Способ отправки» (860492) и/или «Филиал» (855167).
 * Usage:
 *   php bin/update_deal_sale_fields_for_wms.php --deal=25434555 --json='{"amo_channel":"Самовывоз","amo_sto":"Фадеева"}'
 *   php bin/update_deal_sale_fields_for_wms.php --deal=25434555 --json='{"amo_shipment":"ТК СДЭК"}'
 *   php bin/update_deal_sale_fields_for_wms.php --deal=25434555 --json='{"amo_branch":"Краснодар, СТО Фогель"}'
 *   php bin/update_deal_sale_fields_for_wms.php --deal=25434555 --json='{"amo_sto":""}'
 *
 * Пустая строка = очистить поле. Ключи можно опускать — тогда поле не трогаем.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only\n");
    exit(1);
}

require_once dirname(__DIR__) . '/config.php';
require_once dirname(__DIR__) . '/amo/access.php';

/** @var array $headers */
/** @var string $subdomain */

const AMO_CF_CHANNEL = 858983;
const AMO_CF_STO = 853005;
const AMO_CF_SHIPMENT = 860492;
const AMO_CF_BRANCH = 855167;

$dealId = 0;
$jsonRaw = '';
foreach ($argv as $arg) {
    if (preg_match('/^--deal=(\d+)$/', $arg, $m)) {
        $dealId = (int) $m[1];
    }
    if (preg_match('/^--json=(.+)$/s', $arg, $m)) {
        $jsonRaw = $m[1];
    }
}

if ($dealId <= 0) {
    echo json_encode(['ok' => false, 'error' => 'need --deal=<id>'], JSON_UNESCAPED_UNICODE);
    exit(1);
}

$patch = [];
if ($jsonRaw !== '') {
    $decoded = json_decode($jsonRaw, true);
    if (!is_array($decoded)) {
        echo json_encode(['ok' => false, 'error' => 'invalid --json'], JSON_UNESCAPED_UNICODE);
        exit(1);
    }
    $patch = $decoded;
}

$hasChannel = array_key_exists('amo_channel', $patch);
$hasSto = array_key_exists('amo_sto', $patch);
$hasShipment = array_key_exists('amo_shipment', $patch);
$hasBranch = array_key_exists('amo_branch', $patch);
if (!$hasChannel && !$hasSto && !$hasShipment && !$hasBranch) {
    echo json_encode([
        'ok' => true,
        'deal_id' => $dealId,
        'changed' => false,
        'filled' => [],
    ], JSON_UNESCAPED_UNICODE);
    exit(0);
}

function amo_http(string $method, string $url, ?array $payload, array $headers): array
{
    $curl = curl_init();
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERAGENT => 'amoCRM-API-client/1.0',
        CURLOPT_URL => $url,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_HEADER => false,
        CURLOPT_SSL_VERIFYPEER => 0,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 45,
    ];
    if ($payload !== null) {
        $opts[CURLOPT_POSTFIELDS] = json_encode($payload, JSON_UNESCAPED_UNICODE);
        $opts[CURLOPT_HTTPHEADER] = array_merge($headers, ['Content-Type: application/json']);
    }
    curl_setopt_array($curl, $opts);
    $raw = (string) curl_exec($curl);
    $http = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $err = curl_error($curl);
    curl_close($curl);
    $body = json_decode($raw, true);
    return [
        'http' => $http,
        'ok' => $http >= 200 && $http < 300,
        'body' => is_array($body) ? $body : null,
        'raw' => $raw,
        'error' => $err,
    ];
}

function amo_norm(string $s): string
{
    $s = mb_strtolower(trim(preg_replace('/\s+/u', ' ', $s) ?? ''), 'UTF-8');
    return $s;
}

/** @return array<int, array{id:int,value:string}> */
function amo_field_enums(int $fieldId, array $headers, string $subdomain): array
{
    $url = 'https://' . $subdomain . '.amocrm.ru/api/v4/leads/custom_fields/' . $fieldId;
    $r = amo_http('GET', $url, null, $headers);
    if (!$r['ok'] || !is_array($r['body'])) {
        return [];
    }
    $enums = $r['body']['enums'] ?? [];
    if (!is_array($enums)) {
        return [];
    }
    $out = [];
    foreach ($enums as $en) {
        if (!is_array($en)) {
            continue;
        }
        $id = (int) ($en['id'] ?? 0);
        $val = trim((string) ($en['value'] ?? ''));
        if ($id > 0 && $val !== '') {
            $out[] = ['id' => $id, 'value' => $val];
        }
    }
    return $out;
}

function amo_resolve_enum_id(string $want, array $enums): ?int
{
    $want = trim($want);
    if ($want === '') {
        return null;
    }
    $n = amo_norm($want);
    foreach ($enums as $en) {
        if (amo_norm($en['value']) === $n) {
            return (int) $en['id'];
        }
    }
    foreach ($enums as $en) {
        $ev = amo_norm($en['value']);
        if ($ev !== '' && (str_contains($ev, $n) || str_contains($n, $ev))) {
            return (int) $en['id'];
        }
    }
    return null;
}

$cfValues = [];
$filled = [];
$errors = [];

if ($hasChannel) {
    $channel = trim((string) $patch['amo_channel']);
    if ($channel === '') {
        $cfValues[] = ['field_id' => AMO_CF_CHANNEL, 'values' => null];
        $filled[] = 'amo_channel:cleared';
    } else {
        $enums = amo_field_enums(AMO_CF_CHANNEL, $headers, $subdomain);
        $enumId = amo_resolve_enum_id($channel, $enums);
        if ($enumId === null) {
            $errors[] = 'unknown amo_channel: ' . $channel;
        } else {
            $cfValues[] = [
                'field_id' => AMO_CF_CHANNEL,
                'values' => [['enum_id' => $enumId]],
            ];
            $filled[] = 'amo_channel:' . $channel;
        }
    }
}

if ($hasSto) {
    $sto = trim((string) $patch['amo_sto']);
    if ($sto === '') {
        $cfValues[] = ['field_id' => AMO_CF_STO, 'values' => null];
        $filled[] = 'amo_sto:cleared';
    } else {
        $enums = amo_field_enums(AMO_CF_STO, $headers, $subdomain);
        $enumId = amo_resolve_enum_id($sto, $enums);
        if ($enumId === null) {
            $errors[] = 'unknown amo_sto: ' . $sto;
        } else {
            $cfValues[] = [
                'field_id' => AMO_CF_STO,
                'values' => [['enum_id' => $enumId]],
            ];
            $filled[] = 'amo_sto:' . $sto;
        }
    }
}

if ($hasShipment) {
    $shipment = trim((string) $patch['amo_shipment']);
    if ($shipment === '') {
        $cfValues[] = ['field_id' => AMO_CF_SHIPMENT, 'values' => null];
        $filled[] = 'amo_shipment:cleared';
    } else {
        $enums = amo_field_enums(AMO_CF_SHIPMENT, $headers, $subdomain);
        $enumId = amo_resolve_enum_id($shipment, $enums);
        if ($enumId === null) {
            $errors[] = 'unknown amo_shipment: ' . $shipment;
        } else {
            $cfValues[] = [
                'field_id' => AMO_CF_SHIPMENT,
                'values' => [['enum_id' => $enumId]],
            ];
            $filled[] = 'amo_shipment:' . $shipment;
        }
    }
}

if ($hasBranch) {
    $branch = trim((string) $patch['amo_branch']);
    if ($branch === '') {
        $cfValues[] = ['field_id' => AMO_CF_BRANCH, 'values' => null];
        $filled[] = 'amo_branch:cleared';
    } else {
        $enums = amo_field_enums(AMO_CF_BRANCH, $headers, $subdomain);
        $enumId = amo_resolve_enum_id($branch, $enums);
        if ($enumId === null) {
            $errors[] = 'unknown amo_branch: ' . $branch;
        } else {
            $cfValues[] = [
                'field_id' => AMO_CF_BRANCH,
                'values' => [['enum_id' => $enumId]],
            ];
            $filled[] = 'amo_branch:' . $branch;
        }
    }
}

if ($errors && !$cfValues) {
    echo json_encode([
        'ok' => false,
        'error' => implode('; ', $errors),
        'deal_id' => $dealId,
    ], JSON_UNESCAPED_UNICODE);
    exit(1);
}

if (!$cfValues) {
    echo json_encode([
        'ok' => true,
        'deal_id' => $dealId,
        'changed' => false,
        'filled' => [],
        'warnings' => $errors,
    ], JSON_UNESCAPED_UNICODE);
    exit(0);
}

$payload = [[
    'id' => $dealId,
    'custom_fields_values' => $cfValues,
]];

$r = amo_http(
    'PATCH',
    'https://' . $subdomain . '.amocrm.ru/api/v4/leads',
    $payload,
    $headers
);

$lead = null;
if (is_array($r['body'])) {
    $lead = $r['body']['_embedded']['leads'][0] ?? null;
}

echo json_encode([
    'ok' => $r['ok'],
    'http' => $r['http'],
    'deal_id' => $dealId,
    'changed' => $r['ok'],
    'filled' => $filled,
    'warnings' => $errors ?: null,
    'lead' => is_array($lead) ? [
        'id' => $lead['id'] ?? null,
    ] : null,
    'error' => $r['ok']
        ? null
        : ($r['error'] ?: (is_array($r['body'])
            ? ($r['body']['detail'] ?? $r['body']['title'] ?? $r['raw'])
            : $r['raw'])),
], JSON_UNESCAPED_UNICODE);

exit($r['ok'] ? 0 : 1);
