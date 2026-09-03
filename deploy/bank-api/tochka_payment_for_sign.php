<?php
/**
 * Создать платёжное поручение Точки «на подпись» (Create Payment For Sign).
 * POST JSON → Учёт №1. Auth: X-Wms-Key.
 *
 * OAuth: CreatePaymentForSign (+ CreatePaymentOrder для подписи в банке).
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/config.php';
require_once dirname(__DIR__) . '/bank_tochka_client.php';
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

$accountCode = preg_replace('/\D+/', '', (string) ($body['account_code'] ?? $body['accountCode'] ?? ''));
$bankCode = preg_replace('/\D+/', '', (string) ($body['bank_code'] ?? $body['bankCode'] ?? '044525104'));
$cpBic = preg_replace('/\D+/', '', (string) ($body['counterparty_bank_bic'] ?? $body['counterpartyBankBic'] ?? ''));
$cpAcc = preg_replace('/\D+/', '', (string) ($body['counterparty_account_number'] ?? $body['counterpartyAccountNumber'] ?? ''));
$cpName = trim((string) ($body['counterparty_name'] ?? $body['counterpartyName'] ?? ''));
$amount = round((float) ($body['payment_amount'] ?? $body['paymentAmount'] ?? $body['amount'] ?? 0), 2);
$purpose = trim((string) ($body['payment_purpose'] ?? $body['paymentPurpose'] ?? $body['purpose'] ?? ''));
$customerCode = trim((string) ($body['customer_code'] ?? $body['customerCode'] ?? ''));
$paymentDate = trim((string) ($body['payment_date'] ?? $body['paymentDate'] ?? ''));
if ($paymentDate === '') {
    $tz = new DateTimeZone('Europe/Moscow');
    $paymentDate = (new DateTime('now', $tz))->format('Y-m-d');
} elseif (preg_match('/^(\d{2})\.(\d{2})\.(\d{4})$/', $paymentDate, $m)) {
    $paymentDate = $m[3] . '-' . $m[2] . '-' . $m[1];
}

if (strlen($accountCode) !== 20) {
    wms_bank_json_exit(['ok' => false, 'error' => 'account_code: нужен р/с 20 цифр'], 400);
}
if (strlen($bankCode) !== 9) {
    wms_bank_json_exit(['ok' => false, 'error' => 'bank_code: БИК плательщика 9 цифр'], 400);
}
if (strlen($cpBic) !== 9) {
    wms_bank_json_exit(['ok' => false, 'error' => 'counterparty_bank_bic: БИК получателя 9 цифр'], 400);
}
if (strlen($cpAcc) !== 20) {
    wms_bank_json_exit(['ok' => false, 'error' => 'counterparty_account_number: счёт получателя 20 цифр'], 400);
}
if ($cpName === '') {
    wms_bank_json_exit(['ok' => false, 'error' => 'counterparty_name обязателен'], 400);
}
if (!($amount > 0)) {
    wms_bank_json_exit(['ok' => false, 'error' => 'amount > 0'], 400);
}
if ($purpose === '') {
    $purpose = 'Возврат денежных средств';
}
if (function_exists('mb_substr')) {
    $purpose = mb_substr($purpose, 0, 210, 'UTF-8');
} else {
    $purpose = substr($purpose, 0, 210);
}

$data = [
    'accountCode' => $accountCode,
    'bankCode' => $bankCode,
    'counterpartyBankBic' => $cpBic,
    'counterpartyAccountNumber' => $cpAcc,
    'counterpartyName' => $cpName,
    'paymentAmount' => number_format($amount, 2, '.', ''),
    'paymentDate' => $paymentDate,
    'paymentPurpose' => $purpose,
    'paymentPriority' => (string) ($body['payment_priority'] ?? $body['paymentPriority'] ?? '5'),
];
$cpInn = preg_replace('/\D+/', '', (string) ($body['counterparty_inn'] ?? $body['counterpartyINN'] ?? ''));
if ($cpInn !== '') {
    $data['counterpartyINN'] = $cpInn;
}
$cpKpp = preg_replace('/\D+/', '', (string) ($body['counterparty_kpp'] ?? $body['counterpartyKPP'] ?? ''));
if ($cpKpp !== '') {
    $data['counterpartyKPP'] = $cpKpp;
}
$cpCorr = preg_replace('/\D+/', '', (string) ($body['counterparty_bank_corr_account'] ?? $body['counterpartyBankCorrAccount'] ?? ''));
if (strlen($cpCorr) === 20) {
    $data['counterpartyBankCorrAccount'] = $cpCorr;
}
$codePurpose = trim((string) ($body['code_purpose'] ?? $body['codePurpose'] ?? ''));
if ($codePurpose !== '') {
    $data['codePurpose'] = $codePurpose;
}

$url = 'https://enter.tochka.com/uapi/payment/v1.0/for-sign';
$headers = [
    'Authorization: Bearer ' . $access,
    'Accept: application/json',
    'Content-Type: application/json',
];
if ($customerCode !== '') {
    $headers[] = 'CustomerCode: ' . $customerCode;
}
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_POSTFIELDS => json_encode(['Data' => $data], JSON_UNESCAPED_UNICODE),
    CURLOPT_TIMEOUT => 60,
]);
$rawResp = curl_exec($ch);
$http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$decoded = is_string($rawResp) ? json_decode($rawResp, true) : null;
if ($http < 200 || $http >= 300 || !is_array($decoded)) {
    $msg = '';
    if (is_array($decoded)) {
        $msg = (string) (
            $decoded['message']
            ?? $decoded['error']
            ?? (($decoded['Errors'][0]['message'] ?? '') ?: '')
        );
    }
    if ($msg === '') {
        $msg = 'for-sign HTTP ' . $http;
    }
    if ($http === 403 || stripos($msg, 'consent') !== false || stripos($msg, 'Forbidden') !== false) {
        $msg .= ' · Нужен OAuth-scope CreatePaymentForSign (перевыпустите токен Точки).';
    }
    wms_bank_json_exit([
        'ok' => false,
        'error' => $msg,
        'http' => $http,
        'raw' => $decoded,
    ], 400);
}

$payload = $decoded['Data'] ?? $decoded;
if (!is_array($payload)) {
    $payload = [];
}
$redirect = (string) ($payload['redirectURL'] ?? $payload['redirectUrl'] ?? '');
$requestId = (string) ($payload['requestId'] ?? $payload['paymentId'] ?? $payload['id'] ?? '');

wms_bank_json_exit([
    'ok' => true,
    'redirect_url' => $redirect,
    'request_id' => $requestId,
    'payment_date' => $paymentDate,
    'amount' => $amount,
    'purpose' => $purpose,
    'counterparty_name' => $cpName,
    'raw' => $payload,
]);
