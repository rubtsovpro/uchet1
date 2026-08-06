<?php
/**
 * CLI: подписка/отписка webhook Учёт №1 в AmoCRM (сделки, контакты).
 * Товары — из SQL БД amo1c, в этот хук не входят.
 * Usage:
 *   php bin/manage_webhooks_for_wms.php --action=on --url='https://uchetn1.ru/api/webhooks/amo?key=…'
 *   php bin/manage_webhooks_for_wms.php --action=off --url='…'
 *   php bin/manage_webhooks_for_wms.php --action=status --url='…'
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only\n");
    exit(1);
}

require_once dirname(__DIR__) . '/config.php';
require_once dirname(__DIR__) . '/amo/access.php';

$action = '';
$url = '';
foreach ($argv as $arg) {
    if (preg_match('/^--action=(on|off|status)$/', $arg, $m)) {
        $action = $m[1];
    }
    if (preg_match('/^--url=(.+)$/', $arg, $m)) {
        $url = trim($m[1]);
    }
}

if ($action === '' || $url === '') {
    echo json_encode([
        'ok' => false,
        'error' => 'need --action=on|off|status --url=<webhook_url>',
    ], JSON_UNESCAPED_UNICODE);
    exit(1);
}

/** @var array $headers */
/** @var string $subdomain */

$settings = [
    'add_lead',
    'update_lead',
    'delete_lead',
    'status_lead',
    'responsible_lead',
    'add_contact',
    'update_contact',
    'delete_contact',
    'add_company',
    'update_company',
    'delete_company',
];

function amo_wh_request(string $method, string $path, ?array $payload, string $subdomain, array $headers): array
{
    $curl = curl_init();
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_USERAGENT => 'amoCRM-API-client/1.0',
        CURLOPT_URL => 'https://' . $subdomain . '.amocrm.ru' . $path,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_HEADER => false,
        CURLOPT_SSL_VERIFYPEER => 0,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 30,
    ];
    if ($payload !== null) {
        $opts[CURLOPT_POSTFIELDS] = json_encode($payload, JSON_UNESCAPED_UNICODE);
    }
    curl_setopt_array($curl, $opts);
    $raw = (string) curl_exec($curl);
    $http = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $err = curl_error($curl);
    curl_close($curl);
    $body = json_decode($raw, true);
    return [
        'http' => $http,
        'body' => is_array($body) ? $body : null,
        'raw' => $raw,
        'curl_error' => $err,
    ];
}

$list = amo_wh_request('GET', '/api/v4/webhooks', null, $subdomain, $headers);
if ($list['http'] < 200 || $list['http'] >= 300) {
    echo json_encode([
        'ok' => false,
        'error' => $list['curl_error'] ?: ('list webhooks HTTP ' . $list['http']),
        'http' => $list['http'],
    ], JSON_UNESCAPED_UNICODE);
    exit(1);
}

$hooks = $list['body']['_embedded']['webhooks'] ?? [];
$match = null;
foreach ($hooks as $h) {
    if (!is_array($h)) {
        continue;
    }
    if (($h['destination'] ?? '') === $url) {
        $match = $h;
        break;
    }
}

if ($action === 'status') {
    echo json_encode([
        'ok' => true,
        'subscribed' => $match !== null,
        'hook' => $match,
        'total' => is_array($hooks) ? count($hooks) : 0,
    ], JSON_UNESCAPED_UNICODE);
    exit(0);
}

if ($action === 'on') {
    if ($match !== null) {
        echo json_encode([
            'ok' => true,
            'subscribed' => true,
            'already' => true,
            'hook' => $match,
        ], JSON_UNESCAPED_UNICODE);
        exit(0);
    }
    $res = amo_wh_request('POST', '/api/v4/webhooks', [
        'destination' => $url,
        'settings' => $settings,
    ], $subdomain, $headers);
    $ok = $res['http'] >= 200 && $res['http'] < 300;
    echo json_encode([
        'ok' => $ok,
        'subscribed' => $ok,
        'http' => $res['http'],
        'hook' => $ok ? ($res['body'] ?? null) : null,
        'error' => $ok
            ? null
            : ($res['curl_error'] ?: ($res['body']['detail'] ?? $res['body']['title'] ?? $res['raw'])),
    ], JSON_UNESCAPED_UNICODE);
    exit($ok ? 0 : 1);
}

// off
if ($match === null) {
    echo json_encode([
        'ok' => true,
        'subscribed' => false,
        'already' => true,
    ], JSON_UNESCAPED_UNICODE);
    exit(0);
}

$res = amo_wh_request('DELETE', '/api/v4/webhooks', [
    'destination' => $url,
], $subdomain, $headers);
$ok = $res['http'] >= 200 && $res['http'] < 300;
echo json_encode([
    'ok' => $ok,
    'subscribed' => false,
    'http' => $res['http'],
    'error' => $ok
        ? null
        : ($res['curl_error'] ?: ($res['body']['detail'] ?? $res['body']['title'] ?? $res['raw'])),
], JSON_UNESCAPED_UNICODE);
exit($ok ? 0 : 1);
