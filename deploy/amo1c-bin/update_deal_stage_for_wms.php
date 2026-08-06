<?php
/**
 * CLI: смена этапа сделки в AmoCRM (обратная синхронизация из Учёт №1).
 * Usage:
 *   php bin/update_deal_stage_for_wms.php --deal=25198533 --status=86404662
 *   php bin/update_deal_stage_for_wms.php --deal=25198533 --status=86404662 --pipeline=12345
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only\n");
    exit(1);
}

require_once dirname(__DIR__) . '/config.php';
require_once dirname(__DIR__) . '/amo/access.php';

$dealId = 0;
$statusId = 0;
$pipelineId = 0;
foreach ($argv as $arg) {
    if (preg_match('/^--deal=(\d+)$/', $arg, $m)) {
        $dealId = (int) $m[1];
    }
    if (preg_match('/^--status=(\d+)$/', $arg, $m)) {
        $statusId = (int) $m[1];
    }
    if (preg_match('/^--pipeline=(\d+)$/', $arg, $m)) {
        $pipelineId = (int) $m[1];
    }
}

if ($dealId <= 0 || $statusId <= 0) {
    echo json_encode([
        'ok' => false,
        'error' => 'need --deal=<id> --status=<status_id>',
    ], JSON_UNESCAPED_UNICODE);
    exit(1);
}

/** @var array $headers */
/** @var string $subdomain */

$payload = [
    [
        'id' => $dealId,
        'status_id' => $statusId,
    ],
];
if ($pipelineId > 0) {
    $payload[0]['pipeline_id'] = $pipelineId;
}

$curl = curl_init();
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_USERAGENT => 'amoCRM-API-client/1.0',
    CURLOPT_URL => 'https://' . $subdomain . '.amocrm.ru/api/v4/leads',
    CURLOPT_CUSTOMREQUEST => 'PATCH',
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_HEADER => false,
    CURLOPT_SSL_VERIFYPEER => 0,
    CURLOPT_SSL_VERIFYHOST => 0,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 30,
]);
$raw = (string) curl_exec($curl);
$httpCode = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
$curlErr = curl_error($curl);
curl_close($curl);

$body = json_decode($raw, true);
$ok = $httpCode >= 200 && $httpCode < 300;
$lead = null;
if (is_array($body)) {
    $lead = $body['_embedded']['leads'][0] ?? null;
}

echo json_encode([
    'ok' => $ok,
    'http' => $httpCode,
    'deal_id' => $dealId,
    'status_id' => $statusId,
    'pipeline_id' => $pipelineId ?: null,
    'lead' => is_array($lead) ? [
        'id' => $lead['id'] ?? null,
        'status_id' => $lead['status_id'] ?? null,
        'pipeline_id' => $lead['pipeline_id'] ?? null,
    ] : null,
    'error' => $ok
        ? null
        : ($curlErr ?: (is_array($body) ? ($body['detail'] ?? $body['title'] ?? $raw) : $raw)),
], JSON_UNESCAPED_UNICODE);

exit($ok ? 0 : 1);
