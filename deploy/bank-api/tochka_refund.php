<?php
/**
 * Возврат оплаты Точки: эквайринг (карта/ссылка) или СБП.
 * POST JSON: channel=acquiring|sbp. Auth: X-Wms-Key.
 *
 * acquiring: operation_id (+ amount?). Scope MakeAcquiringOperation.
 * sbp: qrc_id + amount + account_code (+ trx_id?). Scope EditSBPData.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/bank_tochka_client.php';
require_once dirname(__DIR__) . '/tochka_sbp_client.php';
require_once dirname(__DIR__) . '/includes/wms_bank_auth.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    wms_bank_json_exit(['ok' => false, 'error' => 'POST only'], 405);
}

$raw = (string) file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) {
    $body = $_POST;
}
$got = wms_bank_request_key();
if ($got === '' && is_array($body)) {
    $got = trim((string) ($body['key'] ?? ''));
}
$expect = wms_bank_expected_key();
if ($expect === '' || $got === '' || !hash_equals($expect, $got)) {
    wms_bank_json_exit(['ok' => false, 'error' => 'unauthorized'], 401);
}

$token = tochka_load_token_file();
$access = (string) ($token['access_token'] ?? '');
if ($access === '') {
    wms_bank_json_exit(['ok' => false, 'error' => 'Токен Точки не найден'], 400);
}

$channel = strtolower(trim((string) ($body['channel'] ?? '')));
$customerCode = trim((string) ($body['customer_code'] ?? $body['customerCode'] ?? ''));
$amount = array_key_exists('amount', $body) ? round((float) $body['amount'], 2) : null;
$purpose = trim((string) ($body['purpose'] ?? $body['paymentPurpose'] ?? 'Возврат денежных средств'));

if ($channel === 'acquiring' || $channel === 'card') {
    $operationId = trim((string) ($body['operation_id'] ?? $body['operationId'] ?? ''));
    if ($operationId === '') {
        wms_bank_json_exit(['ok' => false, 'error' => 'operation_id обязателен для возврата эквайринга'], 400);
    }
    $url = 'https://enter.tochka.com/uapi/acquiring/v1.0/payments/' . rawurlencode($operationId) . '/refund';
    $data = [];
    if ($amount !== null && $amount > 0) {
        $data['amount'] = $amount;
    }
    $headers = [
        'Authorization: Bearer ' . $access,
        'Accept: application/json',
        'Content-Type: application/json',
    ];
    if ($customerCode !== '') {
        $headers[] = 'CustomerCode: ' . $customerCode;
    }
    $payloadBody = ['Data' => $data ?: new stdClass()];
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => json_encode($payloadBody, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT => 60,
    ]);
    $rawResp = curl_exec($ch);
    $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $decoded = is_string($rawResp) ? json_decode($rawResp, true) : null;
    if ($http < 200 || $http >= 300) {
        $msg = '';
        if (is_array($decoded)) {
            $msg = (string) (
                $decoded['message']
                ?? $decoded['error']
                ?? (($decoded['Errors'][0]['message'] ?? '') ?: '')
            );
        }
        if ($msg === '') {
            $msg = 'acquiring refund HTTP ' . $http;
        }
        if ($http === 403) {
            $msg .= ' · Нужен OAuth-scope MakeAcquiringOperation (возврат эквайринга).';
        }
        wms_bank_json_exit(['ok' => false, 'error' => $msg, 'http' => $http, 'raw' => $decoded], 400);
    }
    $payload = is_array($decoded) ? ($decoded['Data'] ?? $decoded) : [];
    wms_bank_json_exit([
        'ok' => true,
        'channel' => 'acquiring',
        'operation_id' => $operationId,
        'status' => is_array($payload) ? (string) ($payload['status'] ?? '') : '',
        'raw' => $payload,
    ]);
}

if ($channel === 'sbp') {
    $qrcId = trim((string) ($body['qrc_id'] ?? $body['qrcId'] ?? ''));
    $accountCode = preg_replace('/\D+/', '', (string) ($body['account_code'] ?? $body['accountCode'] ?? ''));
    $bankCode = preg_replace('/\D+/', '', (string) ($body['bank_code'] ?? $body['bankCode'] ?? '044525104'));
    $trxId = trim((string) ($body['trx_id'] ?? $body['trxId'] ?? $body['ref_transaction_id'] ?? $body['refTransactionId'] ?? ''));
    if ($qrcId === '') {
        wms_bank_json_exit(['ok' => false, 'error' => 'qrc_id обязателен для возврата СБП'], 400);
    }
    if (strlen($accountCode) !== 20) {
        wms_bank_json_exit(['ok' => false, 'error' => 'account_code: р/с 20 цифр (счёт, с которого был QR)'], 400);
    }
    if (!($amount !== null && $amount > 0)) {
        wms_bank_json_exit(['ok' => false, 'error' => 'amount > 0 для возврата СБП'], 400);
    }
    $data = [
        'bankCode' => strlen($bankCode) === 9 ? $bankCode : '044525104',
        'accountCode' => $accountCode,
        'amount' => number_format($amount, 2, '.', ''),
        'currency' => 'RUB',
        'qrcId' => $qrcId,
        'purpose' => function_exists('mb_substr')
            ? mb_substr($purpose, 0, 140, 'UTF-8')
            : substr($purpose, 0, 140),
    ];
    if ($trxId !== '') {
        // Точка принимает trxId и/или refTransactionId
        if (preg_match('/^[0-9a-f-]{36}$/i', $trxId)) {
            $data['refTransactionId'] = $trxId;
        } else {
            $data['trxId'] = $trxId;
        }
    }
    if ($customerCode !== '') {
        $data['customerCode'] = $customerCode;
    }
    $resp = tochka_sbp_request(
        $access,
        'POST',
        '/refund',
        $customerCode !== '' ? $customerCode : null,
        ['Data' => $data]
    );
    if (empty($resp['ok'])) {
        $msg = function_exists('tochka_ob_extract_error_message')
            ? (string) tochka_ob_extract_error_message($resp)
            : ('sbp refund HTTP ' . (int) ($resp['code'] ?? 0));
        if ((int) ($resp['code'] ?? 0) === 403 || stripos($msg, 'Forbidden') !== false) {
            $msg .= ' · Нужен OAuth-scope EditSBPData (возвраты СБП).';
        }
        wms_bank_json_exit([
            'ok' => false,
            'error' => $msg !== '' ? $msg : 'sbp refund failed',
            'http' => (int) ($resp['code'] ?? 0),
            'raw' => $resp['data'] ?? null,
        ], 400);
    }
    $payload = is_array($resp['data']) ? ($resp['data']['Data'] ?? $resp['data']) : [];
    wms_bank_json_exit([
        'ok' => true,
        'channel' => 'sbp',
        'qrc_id' => $qrcId,
        'amount' => $amount,
        'raw' => $payload,
    ]);
}

wms_bank_json_exit(['ok' => false, 'error' => 'channel: acquiring|sbp'], 400);
