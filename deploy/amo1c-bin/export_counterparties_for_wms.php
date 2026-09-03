<?php
/**
 * CLI: компании + контакты Amo (+ связи) для Учёт №1 / WMS.
 * Usage:
 *   php bin/export_counterparties_for_wms.php
 *   php bin/export_counterparties_for_wms.php --limit=2000
 *   php bin/export_counterparties_for_wms.php --pages=20
 *
 * ИНН: CF 820517; Партнёр: checkbox 862897.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only\n");
    exit(1);
}

require_once dirname(__DIR__) . '/config.php';
require_once dirname(__DIR__) . '/amo/access.php';
require_once __DIR__ . '/wms_inn.php';

$limit = 5000;
$pages = 40;
foreach ($argv as $arg) {
    if (preg_match('/^--limit=(\d+)$/', $arg, $m)) {
        $limit = max(1, min(20000, (int) $m[1]));
    }
    if (preg_match('/^--pages=(\d+)$/', $arg, $m)) {
        $pages = max(1, min(200, (int) $m[1]));
    }
}

/** @var array $headers */
/** @var string $subdomain */

const AMO_INN_FIELD_ID = '820517';
const AMO_PARTNER_FIELD_ID = '862897';

function amo_cp_cf_value(array $customFieldsValues, string $fieldId): string
{
    foreach ($customFieldsValues as $field) {
        if (!is_array($field)) {
            continue;
        }
        if ((string) ($field['field_id'] ?? '') !== $fieldId) {
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

function amo_cp_cf_by_code(array $customFieldsValues, string $code): array
{
    $out = [];
    foreach ($customFieldsValues as $field) {
        if (!is_array($field)) {
            continue;
        }
        if ((string) ($field['field_code'] ?? '') !== $code) {
            continue;
        }
        foreach ($field['values'] ?? [] as $value) {
            if (!is_array($value)) {
                continue;
            }
            $v = trim((string) ($value['value'] ?? ''));
            if ($v !== '') {
                $out[] = $v;
            }
        }
    }
    return $out;
}

/**
 * @return array<int, array>
 */
function amo_cp_fetch_pages(string $entity, array $headers, string $subdomain, int $maxPages, int $hardLimit): array
{
    $out = [];
    $with = $entity === 'companies' ? 'contacts' : 'companies';
    for ($page = 1; $page <= $maxPages; $page++) {
        if (count($out) >= $hardLimit) {
            break;
        }
        $url = 'https://' . $subdomain . '.amocrm.ru/api/v4/' . $entity
            . '?with=' . $with . '&limit=250&page=' . $page;
        $curl = curl_init();
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_USERAGENT => 'amoCRM-API-client/1.0',
            CURLOPT_URL => $url,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_HEADER => false,
            CURLOPT_SSL_VERIFYPEER => 1,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_TIMEOUT => 60,
        ]);
        $body = curl_exec($curl);
        $code = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);
        if ($code === 204) {
            break;
        }
        if ($code !== 200 || !is_string($body)) {
            fwrite(STDERR, "Amo {$entity} page={$page} HTTP {$code}\n");
            break;
        }
        $json = json_decode($body, true);
        $rows = $json['_embedded'][$entity] ?? [];
        if (!$rows) {
            break;
        }
        foreach ($rows as $row) {
            if (empty($row['id'])) {
                continue;
            }
            $out[(int) $row['id']] = $row;
            if (count($out) >= $hardLimit) {
                break 2;
            }
        }
        usleep(180000);
    }
    return $out;
}

function amo_cp_map_entity(array $row, string $entity, string $subdomain): array
{
    $id = (int) ($row['id'] ?? 0);
    $innRaw = amo_cp_cf_value($row['custom_fields_values'] ?? [], AMO_INN_FIELD_ID);
    $inn = wms_sanitize_buyer_inn($innRaw);
    $partnerRaw = amo_cp_cf_value($row['custom_fields_values'] ?? [], AMO_PARTNER_FIELD_ID);
    $isPartner = $entity === 'companies' && wms_cf_is_checked($partnerRaw);
    $phones = amo_cp_cf_by_code($row['custom_fields_values'] ?? [], 'PHONE');
    $emails = amo_cp_cf_by_code($row['custom_fields_values'] ?? [], 'EMAIL');
    $linked = [];
    $embedKey = $entity === 'companies' ? 'contacts' : 'companies';
    foreach ($row['_embedded'][$embedKey] ?? [] as $rel) {
        if (!empty($rel['id'])) {
            $linked[] = (string) (int) $rel['id'];
        }
    }
    $kind = wms_buyer_kind_from_inn($inn);
    $path = $entity === 'companies' ? 'companies/detail/' : 'contacts/detail/';
    return [
        'id' => (string) $id,
        'name' => trim((string) ($row['name'] ?? '')) ?: ($entity . ' #' . $id),
        'inn' => $inn,
        'phone' => $phones[0] ?? '',
        'phones' => $phones,
        'email' => $emails[0] ?? '',
        'emails' => $emails,
        'buyer_kind' => $kind,
        'is_legal_entity' => in_array($kind, ['legal', 'ip'], true) ? 1 : 0,
        'is_partner' => $isPartner ? 1 : 0,
        'responsible_user_id' => (string) ($row['responsible_user_id'] ?? ''),
        'created_at' => !empty($row['created_at']) ? date('c', (int) $row['created_at']) : null,
        'updated_at' => !empty($row['updated_at']) ? date('c', (int) $row['updated_at']) : null,
        'amo_url' => 'https://' . $subdomain . '.amocrm.ru/' . $path . $id,
        'linked_ids' => $linked,
    ];
}

$rawCompanies = amo_cp_fetch_pages('companies', $headers, (string) $subdomain, $pages, $limit);
$rawContacts = amo_cp_fetch_pages('contacts', $headers, (string) $subdomain, $pages, $limit);

/** Добрать сущности, на которые есть связи, но которых нет в пагинации. */
function amo_cp_fetch_by_ids(string $entity, array $ids, array $headers, string $subdomain): array
{
    $out = [];
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
    if (!$ids) {
        return $out;
    }
    foreach (array_chunk($ids, 50) as $chunk) {
        $qs = [];
        foreach ($chunk as $id) {
            $qs[] = 'filter[id][]=' . $id;
        }
        $url = 'https://' . $subdomain . '.amocrm.ru/api/v4/' . $entity . '?' . implode('&', $qs) . '&limit=50';
        $curl = curl_init();
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_USERAGENT => 'amoCRM-API-client/1.0',
            CURLOPT_URL => $url,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_HEADER => false,
            CURLOPT_SSL_VERIFYPEER => 1,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_TIMEOUT => 40,
        ]);
        $body = curl_exec($curl);
        $code = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);
        if ($code !== 200 || !is_string($body)) {
            continue;
        }
        $json = json_decode($body, true);
        foreach ($json['_embedded'][$entity] ?? [] as $row) {
            if (!empty($row['id'])) {
                $out[(int) $row['id']] = $row;
            }
        }
        usleep(150000);
    }
    return $out;
}

$missingContactIds = [];
$missingCompanyIds = [];
foreach ($rawCompanies as $row) {
    foreach ($row['_embedded']['contacts'] ?? [] as $rel) {
        $cid = (int) ($rel['id'] ?? 0);
        if ($cid > 0 && !isset($rawContacts[$cid])) {
            $missingContactIds[$cid] = $cid;
        }
    }
}
foreach ($rawContacts as $row) {
    foreach ($row['_embedded']['companies'] ?? [] as $rel) {
        $cid = (int) ($rel['id'] ?? 0);
        if ($cid > 0 && !isset($rawCompanies[$cid])) {
            $missingCompanyIds[$cid] = $cid;
        }
    }
}
foreach (amo_cp_fetch_by_ids('contacts', array_values($missingContactIds), $headers, (string) $subdomain) as $id => $row) {
    $rawContacts[$id] = $row;
}
foreach (amo_cp_fetch_by_ids('companies', array_values($missingCompanyIds), $headers, (string) $subdomain) as $id => $row) {
    $rawCompanies[$id] = $row;
}

$companies = [];
foreach ($rawCompanies as $row) {
    $companies[] = amo_cp_map_entity($row, 'companies', (string) $subdomain);
}

$contacts = [];
foreach ($rawContacts as $row) {
    $contacts[] = amo_cp_map_entity($row, 'contacts', (string) $subdomain);
}

/** Связи company↔contact (двусторонне, уникальные пары). */
$links = [];
$seen = [];
foreach ($companies as $co) {
    foreach ($co['linked_ids'] as $ctId) {
        $key = $co['id'] . ':' . $ctId;
        if (isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $links[] = [
            'company_id' => $co['id'],
            'contact_id' => $ctId,
        ];
    }
}
foreach ($contacts as $ct) {
    foreach ($ct['linked_ids'] as $coId) {
        $key = $coId . ':' . $ct['id'];
        if (isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $links[] = [
            'company_id' => $coId,
            'contact_id' => $ct['id'],
        ];
    }
}

echo json_encode(
    [
        'ok' => true,
        'exported_at' => date('c'),
        'limit' => $limit,
        'pages' => $pages,
        'companies' => $companies,
        'contacts' => $contacts,
        'links' => $links,
        'counts' => [
            'companies' => count($companies),
            'contacts' => count($contacts),
            'links' => count($links),
        ],
    ],
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
);
echo "\n";
