<?php
/**
 * CLI: дозаполнить контакт/компанию Amo реквизитами из Учёт №1 (договор / карточка контрагента).
 *
 * Правила:
 *  - не перезаписываем уже заполненные поля в Amo;
 *  - имя не меняем, если в Amo уже есть (кроме --force-name);
 *  - пустые поля в Amo заполняем из Учёта.
 *
 * Usage:
 *   php bin/update_contact_buyer_for_wms.php --deal=25434555 --json='{"name":"..."}'
 *   php bin/update_contact_buyer_for_wms.php --deal=25434555 --force-name --json='{"name":"..."}'
 *   php bin/update_contact_buyer_for_wms.php --contact=26316561 --json='{...}'
 *   php bin/update_contact_buyer_for_wms.php --company=123 --json='{...}'
 *   php bin/update_contact_buyer_for_wms.php --entity=companies --company=123 --json='{...}'
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

$dealId = 0;
$contactId = 0;
$companyId = 0;
$entity = ''; // contacts | companies
$jsonRaw = '';
$forceName = false;
foreach ($argv as $arg) {
    if (preg_match('/^--deal=(\d+)$/', $arg, $m)) {
        $dealId = (int) $m[1];
    }
    if (preg_match('/^--contact=(\d+)$/', $arg, $m)) {
        $contactId = (int) $m[1];
        if ($entity === '') {
            $entity = 'contacts';
        }
    }
    if (preg_match('/^--company=(\d+)$/', $arg, $m)) {
        $companyId = (int) $m[1];
        if ($entity === '') {
            $entity = 'companies';
        }
    }
    if (preg_match('/^--entity=(contacts|companies)$/', $arg, $m)) {
        $entity = $m[1];
    }
    if ($arg === '--force-name') {
        $forceName = true;
    }
    if (preg_match('/^--json=(.+)$/s', $arg, $m)) {
        $jsonRaw = $m[1];
    }
}

$buyer = [];
if ($jsonRaw !== '') {
    $decoded = json_decode($jsonRaw, true);
    if (!is_array($decoded)) {
        echo json_encode(['ok' => false, 'error' => 'invalid --json'], JSON_UNESCAPED_UNICODE);
        exit(1);
    }
    $buyer = $decoded;
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

function norm_name(string $s): string
{
    $s = mb_strtolower(trim(preg_replace('/\s+/u', ' ', $s) ?? ''), 'UTF-8');
    return $s;
}

function cf_first_value(array $customFields, $fieldId = null, ?string $code = null): string
{
    foreach ($customFields as $field) {
        if (!is_array($field)) {
            continue;
        }
        if ($fieldId !== null && (string) ($field['field_id'] ?? '') !== (string) $fieldId) {
            continue;
        }
        if ($code !== null && (string) ($field['field_code'] ?? '') !== $code) {
            continue;
        }
        if ($fieldId === null && $code === null) {
            continue;
        }
        foreach ($field['values'] ?? [] as $value) {
            if (!is_array($value)) {
                continue;
            }
            $v = trim((string) ($value['value'] ?? ''));
            if ($v !== '') {
                return $v;
            }
        }
    }
    return '';
}

/** @var array<string, array<string,int>> */
$cfCache = [];

function ensure_entity_cf(
    string $entity,
    string $subdomain,
    array $headers,
    string $name,
    string $type = 'text'
): ?int {
    global $cfCache;
    if (!isset($cfCache[$entity])) {
        $cfCache[$entity] = [];
        $res = amo_http(
            'GET',
            'https://' . $subdomain . '.amocrm.ru/api/v4/' . $entity . '/custom_fields?limit=250',
            null,
            $headers
        );
        foreach ($res['body']['_embedded']['custom_fields'] ?? [] as $f) {
            if (!is_array($f)) {
                continue;
            }
            $n = trim((string) ($f['name'] ?? ''));
            $code = trim((string) ($f['code'] ?? ''));
            $id = (int) ($f['id'] ?? 0);
            if ($n !== '' && $id > 0) {
                $cfCache[$entity][mb_strtolower($n, 'UTF-8')] = $id;
            }
            if ($code !== '' && $id > 0) {
                $cfCache[$entity]['code:' . $code] = $id;
            }
        }
    }
    $key = mb_strtolower($name, 'UTF-8');
    if (!empty($cfCache[$entity][$key])) {
        return $cfCache[$entity][$key];
    }
    $created = amo_http(
        'POST',
        'https://' . $subdomain . '.amocrm.ru/api/v4/' . $entity . '/custom_fields',
        [['name' => $name, 'type' => $type]],
        $headers
    );
    $id = (int) ($created['body']['_embedded']['custom_fields'][0]['id'] ?? 0);
    if ($id > 0) {
        $cfCache[$entity][$key] = $id;
        return $id;
    }
    return null;
}

if ($contactId <= 0 && $companyId <= 0 && $dealId > 0) {
    $lead = amo_http(
        'GET',
        'https://' . $subdomain . '.amocrm.ru/api/v4/leads/' . $dealId . '?with=contacts,companies',
        null,
        $headers
    );
    if (!$lead['ok']) {
        echo json_encode([
            'ok' => false,
            'error' => 'lead fetch failed: ' . ($lead['error'] ?: $lead['raw']),
            'http' => $lead['http'],
        ], JSON_UNESCAPED_UNICODE);
        exit(1);
    }
    $contacts = $lead['body']['_embedded']['contacts'] ?? [];
    $main = null;
    foreach ($contacts as $c) {
        if (!empty($c['is_main'])) {
            $main = $c;
            break;
        }
    }
    if (!$main && $contacts) {
        $main = $contacts[0];
    }
    $contactId = (int) ($main['id'] ?? 0);
    $companies = $lead['body']['_embedded']['companies'] ?? [];
    if ($companies) {
        $companyId = (int) ($companies[0]['id'] ?? 0);
    }
    if ($entity === '') {
        $entity = $contactId > 0 ? 'contacts' : 'companies';
    }
}

if ($entity === '') {
    $entity = $companyId > 0 && $contactId <= 0 ? 'companies' : 'contacts';
}

$targetId = $entity === 'companies' ? $companyId : $contactId;
if ($targetId <= 0) {
    echo json_encode([
        'ok' => false,
        'error' => 'need --deal / --contact / --company',
        'entity' => $entity,
    ], JSON_UNESCAPED_UNICODE);
    exit(1);
}

$cur = amo_http(
    'GET',
    'https://' . $subdomain . '.amocrm.ru/api/v4/' . $entity . '/' . $targetId,
    null,
    $headers
);
if (!$cur['ok'] || !is_array($cur['body'])) {
    echo json_encode([
        'ok' => false,
        'error' => $entity . ' fetch failed: ' . ($cur['error'] ?: $cur['raw']),
        'http' => $cur['http'],
        'entity' => $entity,
        'id' => $targetId,
    ], JSON_UNESCAPED_UNICODE);
    exit(1);
}

$row = $cur['body'];
$cfs = is_array($row['custom_fields_values'] ?? null) ? $row['custom_fields_values'] : [];
$amoName = trim((string) ($row['name'] ?? ''));
$formName = trim((string) ($buyer['name'] ?? ''));
$nameDiffers = $formName !== '' && $amoName !== '' && norm_name($formName) !== norm_name($amoName);

$filled = [];
$skipped = [];
$patch = ['id' => $targetId];
$cfPatch = [];

if ($formName !== '') {
    if ($amoName === '' || ($forceName && norm_name($formName) !== norm_name($amoName))) {
        $patch['name'] = $formName;
        $filled[] = 'name';
    } else {
        $skipped[] = 'name';
    }
}

$formPhone = trim((string) ($buyer['phone'] ?? ''));
if ($formPhone !== '') {
    $amoPhone = cf_first_value($cfs, null, 'PHONE');
    if ($amoPhone === '') {
        $cfPatch[] = [
            'field_code' => 'PHONE',
            'values' => [['value' => $formPhone, 'enum_code' => 'WORK']],
        ];
        $filled[] = 'phone';
    } else {
        $skipped[] = 'phone';
    }
}

$formEmail = trim((string) ($buyer['email'] ?? ''));
if ($formEmail !== '') {
    $amoEmail = cf_first_value($cfs, null, 'EMAIL');
    if ($amoEmail === '') {
        $cfPatch[] = [
            'field_code' => 'EMAIL',
            'values' => [['value' => $formEmail, 'enum_code' => 'WORK']],
        ];
        $filled[] = 'email';
    } else {
        $skipped[] = 'email';
    }
}

$formDirector = trim((string) ($buyer['director'] ?? ''));
if ($formDirector !== '' && $entity === 'contacts') {
    $amoPos = cf_first_value($cfs, null, 'POSITION');
    if ($amoPos === '') {
        $cfPatch[] = [
            'field_code' => 'POSITION',
            'values' => [['value' => $formDirector]],
        ];
        $filled[] = 'director';
    } else {
        $skipped[] = 'director';
    }
}

$formAddress = trim((string) ($buyer['address'] ?? ''));
if ($formAddress !== '') {
    if ($entity === 'companies') {
        $amoAddr = cf_first_value($cfs, null, 'ADDRESS');
        if ($amoAddr === '') {
            $cfPatch[] = [
                'field_code' => 'ADDRESS',
                'values' => [['value' => $formAddress]],
            ];
            $filled[] = 'address';
        } else {
            $skipped[] = 'address';
        }
    } else {
        $fieldId = ensure_entity_cf($entity, $subdomain, $headers, 'Адрес', 'textarea');
        if ($fieldId) {
            $amoVal = cf_first_value($cfs, $fieldId);
            if ($amoVal === '') {
                $cfPatch[] = ['field_id' => $fieldId, 'values' => [['value' => $formAddress]]];
                $filled[] = 'address';
            } else {
                $skipped[] = 'address';
            }
        } else {
            $skipped[] = 'address:no_cf';
        }
    }
}

$formInn = trim((string) ($buyer['inn'] ?? ''));
if ($formInn !== '') {
    if ($entity === 'companies') {
        // известный CF ИНН на компаниях
        $innId = 820517;
        $amoInn = cf_first_value($cfs, $innId);
        if ($amoInn === '') {
            $cfPatch[] = ['field_id' => $innId, 'values' => [['value' => $formInn]]];
            $filled[] = 'inn';
        } else {
            $skipped[] = 'inn';
        }
    } else {
        $fieldId = ensure_entity_cf($entity, $subdomain, $headers, 'ИНН', 'text');
        if ($fieldId) {
            $amoVal = cf_first_value($cfs, $fieldId);
            if ($amoVal === '') {
                $cfPatch[] = ['field_id' => $fieldId, 'values' => [['value' => $formInn]]];
                $filled[] = 'inn';
            } else {
                $skipped[] = 'inn';
            }
        } else {
            $skipped[] = 'inn:no_cf';
        }
    }
}

$textMap = [
    'bank' => 'Банк',
    'bik' => 'БИК',
    'rs' => 'Р/с',
    'ks' => 'К/с',
    'kpp' => 'КПП',
    'ogrn' => 'ОГРН',
];
if ($entity === 'companies' && $formDirector !== '') {
    $textMap['director'] = 'В лице';
}

foreach ($textMap as $key => $cfName) {
    $val = trim((string) ($buyer[$key] ?? ''));
    if ($val === '') {
        continue;
    }
    $fieldId = ensure_entity_cf($entity, $subdomain, $headers, $cfName, 'text');
    if (!$fieldId) {
        $skipped[] = $key . ':no_cf';
        continue;
    }
    $amoVal = cf_first_value($cfs, $fieldId);
    if ($amoVal !== '') {
        $skipped[] = $key;
        continue;
    }
    $cfPatch[] = [
        'field_id' => $fieldId,
        'values' => [['value' => $val]],
    ];
    $filled[] = $key;
}

if ($cfPatch) {
    $patch['custom_fields_values'] = $cfPatch;
}

$changed = count($filled) > 0;
$http = 200;
if ($changed) {
    $upd = amo_http(
        'PATCH',
        'https://' . $subdomain . '.amocrm.ru/api/v4/' . $entity,
        [$patch],
        $headers
    );
    $http = $upd['http'];
    if (!$upd['ok']) {
        echo json_encode([
            'ok' => false,
            'http' => $http,
            'entity' => $entity,
            'contact_id' => $entity === 'contacts' ? $targetId : null,
            'company_id' => $entity === 'companies' ? $targetId : null,
            'deal_id' => $dealId ?: null,
            'name_differs' => $nameDiffers,
            'filled' => $filled,
            'skipped' => $skipped,
            'error' => $upd['error'] ?: (is_array($upd['body'])
                ? (string) ($upd['body']['detail'] ?? $upd['body']['title'] ?? $upd['raw'])
                : $upd['raw']),
        ], JSON_UNESCAPED_UNICODE);
        exit(1);
    }
}

echo json_encode([
    'ok' => true,
    'http' => $http,
    'entity' => $entity,
    'contact_id' => $entity === 'contacts' ? $targetId : null,
    'company_id' => $entity === 'companies' ? $targetId : null,
    'deal_id' => $dealId ?: null,
    'amo_name' => $amoName,
    'form_name' => $formName,
    'name_differs' => $nameDiffers,
    'filled' => $filled,
    'skipped' => $skipped,
    'changed' => $changed,
], JSON_UNESCAPED_UNICODE);

exit(0);
