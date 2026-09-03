<?php
/**
 * CLI: воронки + сделки + позиции заказа для Анти1С WMS.
 * Usage:
 *   php bin/export_deals_for_wms.php
 *   php bin/export_deals_for_wms.php --days=60 --limit=1500
 *   php bin/export_deals_for_wms.php --deal=25092533
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only\n");
    exit(1);
}

require_once dirname(__DIR__) . '/config.php';
require_once dirname(__DIR__) . '/Classes/DbHelper.php';
require_once __DIR__ . '/wms_inn.php';

$days = 60;
$limit = 1500;
$onlyDeal = 0;
foreach ($argv as $arg) {
    if (preg_match('/^--days=(\d+)$/', $arg, $m)) {
        $days = max(1, (int) $m[1]);
    }
    if (preg_match('/^--limit=(\d+)$/', $arg, $m)) {
        $limit = max(1, min(5000, (int) $m[1]));
    }
    if (preg_match('/^--deal=(\d+)$/', $arg, $m)) {
        $onlyDeal = (int) $m[1];
    }
}

$db = DbHelper::getInstance();

// Pipelines from cached account.json
$accountFile = dirname(__DIR__) . '/amo/account.json';
$pipelinesOut = [];
if (is_file($accountFile)) {
    $acc = json_decode((string) file_get_contents($accountFile), true);
    $raw = $acc['data']['pipelines'] ?? [];
    foreach ($raw as $pid => $pl) {
        if (!is_array($pl)) {
            continue;
        }
        $statuses = [];
        foreach ($pl['statuses'] ?? [] as $sid => $st) {
            if (!is_array($st)) {
                continue;
            }
            $statuses[] = [
                'id' => (string) ($st['id'] ?? $sid),
                'name' => (string) ($st['name'] ?? ''),
                'sort' => (int) ($st['sort'] ?? 0),
                'color' => (string) ($st['color'] ?? ''),
                'is_editable' => !empty($st['is_editable']),
            ];
        }
        usort($statuses, static fn($a, $b) => $a['sort'] <=> $b['sort']);
        $pipelinesOut[] = [
            'id' => (string) ($pl['id'] ?? $pid),
            'name' => (string) ($pl['name'] ?? ''),
            'sort' => (int) ($pl['sort'] ?? 0),
            'is_archive' => !empty($pl['is_archive']),
            'statuses' => $statuses,
        ];
    }
}

$pipelineName = [];
$statusName = [];
foreach ($pipelinesOut as $pl) {
    $pipelineName[$pl['id']] = $pl['name'];
    foreach ($pl['statuses'] as $st) {
        $statusName[$pl['id'] . ':' . $st['id']] = $st['name'];
    }
}

// Candidate lead ids: recent queue + recent order_items
$leadIds = [];
if ($onlyDeal > 0) {
    $leadIds[] = $onlyDeal;
} else {
    $since = date('Y-m-d H:i:s', time() - $days * 86400);
    $rows = $db->fetchAll(
        'SELECT deal_id AS id FROM deals WHERE date_added >= ?
         UNION
         SELECT DISTINCT lead_id AS id FROM order_items WHERE created_at >= ?
         ORDER BY id DESC
         LIMIT ' . (int) $limit,
        [$since, $since]
    );
    foreach ($rows as $r) {
        $id = (int) ($r['id'] ?? 0);
        if ($id > 0) {
            $leadIds[$id] = $id;
        }
    }
    $leadIds = array_values($leadIds);
}

// Queue map
$queueByDeal = [];
$qStmt = $db->prepare('SELECT deal_id, department, queued_by, date_added, status FROM deals WHERE deal_id = ?');
foreach ($leadIds as $lid) {
    $qStmt->execute([$lid]);
    $q = $qStmt->fetch(PDO::FETCH_ASSOC);
    if ($q) {
        $queueByDeal[$lid] = $q;
    }
}

// Order items
$itemsByLead = [];
if ($leadIds) {
    $chunkSize = 200;
    for ($i = 0; $i < count($leadIds); $i += $chunkSize) {
        $chunk = array_slice($leadIds, $i, $chunkSize);
        $in = implode(',', array_map('intval', $chunk));
        $items = $db->fetchAll(
            "SELECT id, lead_id, department, product_guid, sku, code, name, brand, price, quantity, amount,
                    measurement_unit, note, created_at
             FROM order_items WHERE lead_id IN ($in) ORDER BY id"
        );
        foreach ($items as $it) {
            $lid = (int) ($it['lead_id'] ?? 0);
            if (!$lid) {
                continue;
            }
            if (!isset($itemsByLead[$lid])) {
                $itemsByLead[$lid] = [];
            }
            $itemsByLead[$lid][] = [
                'id' => (string) ($it['id'] ?? ''),
                'product_guid' => (string) ($it['product_guid'] ?? ''),
                'sku' => (string) ($it['sku'] ?? ''),
                'code' => (string) ($it['code'] ?? ''),
                'name' => (string) ($it['name'] ?? ''),
                'brand' => (string) ($it['brand'] ?? ''),
                'price' => (float) ($it['price'] ?? 0),
                'qty' => (float) ($it['quantity'] ?? 0),
                'amount' => (float) ($it['amount'] ?? 0),
                'unit' => (string) ($it['measurement_unit'] ?? ''),
                'department' => (string) ($it['department'] ?? ''),
                'note' => (string) ($it['note'] ?? ''),
            ];
        }
    }
}

// Enrich from Amo API v4
require_once dirname(__DIR__) . '/amo/access.php';
require_once dirname(__DIR__) . '/amo/rate_limit.php';

if (!function_exists('amo1c_map_lead_v4_to_v2')) {
    function amo1c_map_lead_v4_to_v2(array $lead): array
    {
        $customFields = [];
        foreach ($lead['custom_fields_values'] ?? [] as $field) {
            if (!is_array($field)) {
                continue;
            }
            $values = [];
            foreach ($field['values'] ?? [] as $value) {
                if (!is_array($value)) {
                    continue;
                }
                $values[] = ['value' => $value['value'] ?? ''];
            }
            $customFields[] = [
                'id' => (string) ($field['field_id'] ?? ''),
                'values' => $values,
            ];
        }
        $contactIds = [];
        foreach ($lead['_embedded']['contacts'] ?? [] as $contact) {
            if (!empty($contact['id'])) {
                $contactIds[] = (int) $contact['id'];
            }
        }
        $companyId = 0;
        $companyName = '';
        foreach ($lead['_embedded']['companies'] ?? [] as $company) {
            if (!empty($company['id'])) {
                $companyId = (int) $company['id'];
                $companyName = (string) ($company['name'] ?? '');
                break;
            }
        }
        if (!$companyId && !empty($lead['company']['id'])) {
            $companyId = (int) $lead['company']['id'];
            $companyName = (string) ($lead['company']['name'] ?? '');
        }
        return [
            'id' => (int) ($lead['id'] ?? 0),
            'name' => (string) ($lead['name'] ?? ''),
            'sale' => (int) ($lead['price'] ?? 0),
            'responsible_user_id' => (int) ($lead['responsible_user_id'] ?? 0),
            'pipeline_id' => (int) ($lead['pipeline_id'] ?? 0),
            'status_id' => (int) ($lead['status_id'] ?? 0),
            'created_at' => (int) ($lead['created_at'] ?? 0),
            'custom_fields' => $customFields,
            'contacts' => ['id' => $contactIds],
            'company_id' => $companyId,
            'company_name' => $companyName,
            '_raw_contacts' => $lead['_embedded']['contacts'] ?? [],
            '_raw_companies' => $lead['_embedded']['companies'] ?? [],
        ];
    }
}

function amo1c_fetch_leads_by_ids(array $ids, array $headers, string $subdomain): array
{
    $out = [];
    $ids = array_values(array_filter(array_map('intval', $ids)));
    foreach (array_chunk($ids, 50) as $chunk) {
        $qs = [];
        foreach ($chunk as $id) {
            $qs[] = 'filter[id][]=' . $id;
        }
        $path = '/api/v4/leads?' . implode('&', $qs) . '&with=contacts,companies&limit=50';
        $res = amo_api_http_request($subdomain, $headers, 'GET', $path, null, [], 'wms_export_leads');
        if (!$res['ok'] || !is_array($res['body'])) {
            continue;
        }
        foreach ($res['body']['_embedded']['leads'] ?? [] as $lead) {
            if (!empty($lead['id'])) {
                $out[(int) $lead['id']] = amo1c_map_lead_v4_to_v2($lead);
            }
        }
    }
    return $out;
}

$amoLeads = amo1c_fetch_leads_by_ids($leadIds, $headers, (string) $subdomain);

/** ИНН покупателя: CF 820517 у компании или контакта. */
function amo1c_cf_value_by_id(array $customFieldsValues, string $fieldId): string
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

function amo1c_fetch_entities_by_ids(string $entity, array $ids, array $headers, string $subdomain): array
{
    $out = [];
    $ids = array_values(array_filter(array_map('intval', $ids)));
    if (!$ids) {
        return $out;
    }
    foreach (array_chunk($ids, 50) as $chunk) {
        $qs = [];
        foreach ($chunk as $id) {
            $qs[] = 'filter[id][]=' . $id;
        }
        $path = '/api/v4/' . $entity . '?' . implode('&', $qs) . '&limit=50';
        $res = amo_api_http_request($subdomain, $headers, 'GET', $path, null, [], 'wms_export_' . $entity);
        if (!$res['ok'] || !is_array($res['body'])) {
            continue;
        }
        $key = $entity === 'companies' ? 'companies' : 'contacts';
        foreach ($res['body']['_embedded'][$key] ?? [] as $row) {
            if (!empty($row['id'])) {
                $out[(int) $row['id']] = $row;
            }
        }
    }
    return $out;
}

$companyIds = [];
$contactIds = [];
foreach ($amoLeads as $lead) {
    $cid = (int) ($lead['company_id'] ?? 0);
    if ($cid > 0) {
        $companyIds[$cid] = $cid;
    }
    foreach ($lead['contacts']['id'] ?? [] as $ct) {
        $ct = (int) $ct;
        if ($ct > 0) {
            $contactIds[$ct] = $ct;
        }
    }
}
$companiesById = amo1c_fetch_entities_by_ids('companies', array_values($companyIds), $headers, (string) $subdomain);
$contactsById = amo1c_fetch_entities_by_ids('contacts', array_values($contactIds), $headers, (string) $subdomain);

$dealsOut = [];
foreach ($leadIds as $lid) {
    $amo = $amoLeads[$lid] ?? null;
    $q = $queueByDeal[$lid] ?? null;
    $items = $itemsByLead[$lid] ?? [];
    $pipeId = (string) ($amo['pipeline_id'] ?? '');
    $stId = (string) ($amo['status_id'] ?? '');
    $price = (float) ($amo['sale'] ?? 0);
    if ($price <= 0 && $items) {
        $price = array_sum(array_map(static fn($x) => (float) $x['amount'], $items));
    }

    $companyId = (int) ($amo['company_id'] ?? 0);
    $companyName = (string) ($amo['company_name'] ?? '');
    $buyerInn = '';
    $buyerPhone = '';
    $buyerName = '';
    $isPartner = 0;
    if ($companyId > 0 && isset($companiesById[$companyId])) {
        $comp = $companiesById[$companyId];
        if ($companyName === '') {
            $companyName = (string) ($comp['name'] ?? '');
        }
        $buyerInn = amo1c_cf_value_by_id($comp['custom_fields_values'] ?? [], '820517');
        $buyerName = $companyName;
        $partnerRaw = amo1c_cf_value_by_id($comp['custom_fields_values'] ?? [], '862897');
        if (wms_cf_is_checked($partnerRaw)) {
            $isPartner = 1;
        }
    }
    $mainContactId = (int) (($amo['contacts']['id'][0] ?? 0));
    if ($mainContactId > 0 && isset($contactsById[$mainContactId])) {
        $ct = $contactsById[$mainContactId];
        if ($buyerInn === '') {
            $buyerInn = amo1c_cf_value_by_id($ct['custom_fields_values'] ?? [], '820517');
        }
        if ($buyerName === '') {
            $buyerName = trim((string) ($ct['name'] ?? ''));
        }
        foreach ($ct['custom_fields_values'] ?? [] as $field) {
            $code = (string) ($field['field_code'] ?? '');
            if ($code !== 'PHONE') {
                continue;
            }
            foreach ($field['values'] ?? [] as $value) {
                $v = trim((string) ($value['value'] ?? ''));
                if ($v !== '') {
                    $buyerPhone = $v;
                    break 2;
                }
            }
        }
    }
    $buyerInnDigits = wms_sanitize_buyer_inn($buyerInn);
    $buyerKind = wms_buyer_kind_from_inn($buyerInnDigits);

    // CF 816977 «Жалоба клиента» → ЗН п. 3.3
    $clientComplaint = '';
    foreach ($amo['custom_fields'] ?? [] as $field) {
        if (!is_array($field)) {
            continue;
        }
        if ((string) ($field['id'] ?? '') !== '816977') {
            continue;
        }
        $parts = [];
        foreach ($field['values'] ?? [] as $value) {
            $v = trim((string) ($value['value'] ?? ''));
            if ($v !== '') {
                $parts[] = $v;
            }
        }
        $clientComplaint = implode(', ', $parts);
        break;
    }

    $dealsOut[] = [
        'id' => (string) $lid,
        'name' => (string) ($amo['name'] ?? ('Сделка #' . $lid)),
        'price' => $price,
        'pipeline_id' => $pipeId,
        'pipeline_name' => $pipelineName[$pipeId] ?? '',
        'status_id' => $stId,
        'status_name' => $statusName[$pipeId . ':' . $stId] ?? '',
        'responsible_user_id' => (string) ($amo['responsible_user_id'] ?? ''),
        'created_at' => !empty($amo['created_at'])
            ? date('c', (int) $amo['created_at'])
            : ($q['date_added'] ?? null),
        'updated_at' => date('c'),
        'department' => (string) ($q['department'] ?? ($items[0]['department'] ?? '')),
        'queued_to_1c' => $q ? 1 : 0,
        'queue_status' => $q ? (string) $q['status'] : '',
        'queued_by' => (string) ($q['queued_by'] ?? ''),
        'queued_at' => $q['date_added'] ?? null,
        'amo_url' => 'https://' . $subdomain . '.amocrm.ru/leads/detail/' . $lid,
        'print_url' => 'https://amo1c.pnevmopodveska1.ru/amo/print.php?lead=' . $lid,
        'items' => $items,
        'items_count' => count($items),
        'company_id' => $companyId ? (string) $companyId : '',
        'company_name' => $companyName,
        'buyer_name' => $buyerName,
        'buyer_inn' => $buyerInnDigits,
        'buyer_phone' => $buyerPhone,
        'buyer_kind' => $buyerKind,
        'is_legal_entity' => ($buyerKind === 'legal' || $buyerKind === 'ip') ? 1 : 0,
        'is_partner' => $isPartner,
        'amo_client_complaint' => $clientComplaint,
    ];
}

echo json_encode(
    [
        'ok' => true,
        'exported_at' => date('c'),
        'days' => $days,
        'pipelines' => $pipelinesOut,
        'deals' => $dealsOut,
        'counts' => [
            'pipelines' => count($pipelinesOut),
            'deals' => count($dealsOut),
            'with_amo' => count($amoLeads),
            'with_items' => count(array_filter($dealsOut, static fn($d) => $d['items_count'] > 0)),
            'legal' => count(array_filter($dealsOut, static fn($d) => !empty($d['is_legal_entity']))),
        ],
    ],
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
);
echo "\n";
