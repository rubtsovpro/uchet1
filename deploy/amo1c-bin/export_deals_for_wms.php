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
        $url = 'https://' . $subdomain . '.amocrm.ru/api/v4/leads?' . implode('&', $qs) . '&with=contacts,companies&limit=50';
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
        foreach ($json['_embedded']['leads'] ?? [] as $lead) {
            if (!empty($lead['id'])) {
                $out[(int) $lead['id']] = amo1c_map_lead_v4_to_v2($lead);
            }
        }
        usleep(200000);
    }
    return $out;
}

$amoLeads = amo1c_fetch_leads_by_ids($leadIds, $headers, (string) $subdomain);


/** Канал / отправка / оплата / СТО (поля сделки Amo). */
const AMO_CF_CHANNEL = '858983';
const AMO_CF_SHIPMENT = '860492';
const AMO_CF_PAYMENT_TYPE = '860300'; // Тип оплаты: Предоплата | Постоплата
const AMO_CF_PAY_METHOD = '816975'; // Способ оплаты: Отсрочка, Карта…
const AMO_CF_STO = '853005'; // СТО
const AMO_CF_INN = '820517';
const AMO_CF_PARTNER = '862897'; // checkbox Партнёр на компании

function amo1c_cf_value_from_lead_cfs(array $customFields, string $fieldId): string
{
    foreach ($customFields as $field) {
        if (!is_array($field)) {
            continue;
        }
        if ((string) ($field['id'] ?? '') !== $fieldId) {
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

function amo1c_map_ship_channel(string $amoChannel, string $amoShipment): string
{
    $channel = mb_strtolower(trim($amoChannel));
    $shipment = mb_strtolower(trim($amoShipment));
    if ($channel !== '' && (str_contains($channel, 'самовывоз') || str_contains($channel, 'автосервис'))) {
        return 'pickup';
    }
    if ($shipment !== '' && str_contains($shipment, 'налож')) {
        return 'cdek_cod';
    }
    if ($shipment !== '' && str_contains($shipment, 'автобус')) {
        return 'bus';
    }
    if ($shipment !== '' && str_contains($shipment, 'курьер')) {
        return 'own_courier';
    }
    if ($shipment !== '' && (str_contains($shipment, 'сдэк') || str_contains($shipment, 'cdek'))) {
        return 'cdek_prepaid';
    }
    if ($channel !== '' && str_contains($channel, 'отправ')) {
        return str_contains($shipment, 'налож') ? 'cdek_cod' : 'cdek_prepaid';
    }
    return 'cdek_prepaid';
}

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
        $key = $entity === 'companies' ? 'companies' : 'contacts';
        foreach ($json['_embedded'][$key] ?? [] as $row) {
            if (!empty($row['id'])) {
                $out[(int) $row['id']] = $row;
            }
        }
        usleep(150000);
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
    if ($companyId > 0 && isset($companiesById[$companyId])) {
        $comp = $companiesById[$companyId];
        if ($companyName === '') {
            $companyName = (string) ($comp['name'] ?? '');
        }
        $buyerInn = amo1c_cf_value_by_id($comp['custom_fields_values'] ?? [], '820517');
        $buyerName = $companyName;
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
    $buyerInnDigits = preg_replace('/\D/', '', $buyerInn) ?: '';
    $partnerCf = '';
    if ($companyId > 0 && isset($companiesById[$companyId])) {
        $partnerCf = amo1c_cf_value_by_id($companiesById[$companyId]['custom_fields_values'] ?? [], AMO_CF_PARTNER);
    }
    $isPartner = ($partnerCf === '1' || strcasecmp($partnerCf, 'true') === 0 || strcasecmp($partnerCf, 'да') === 0);
    $buyerKind = 'person';
    if ($isPartner) {
        $buyerKind = 'partner';
    } elseif (strlen($buyerInnDigits) === 10 || $companyId > 0) {
        $buyerKind = 'legal';
    } elseif (strlen($buyerInnDigits) === 12) {
        $buyerKind = 'ip';
    }

    $amoChannel = amo1c_cf_value_from_lead_cfs($amo['custom_fields'] ?? [], AMO_CF_CHANNEL);
    $amoShipment = amo1c_cf_value_from_lead_cfs($amo['custom_fields'] ?? [], AMO_CF_SHIPMENT);
    $amoPaymentType = amo1c_cf_value_from_lead_cfs($amo['custom_fields'] ?? [], AMO_CF_PAYMENT_TYPE);
    $amoPayMethod = amo1c_cf_value_from_lead_cfs($amo['custom_fields'] ?? [], AMO_CF_PAY_METHOD);
    $amoSto = amo1c_cf_value_from_lead_cfs($amo['custom_fields'] ?? [], AMO_CF_STO);
    $shipChannel = amo1c_map_ship_channel($amoChannel, $amoShipment);

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
        'is_legal_entity' => in_array($buyerKind, ['legal', 'ip', 'partner'], true) ? 1 : 0,
        'is_partner' => $isPartner ? 1 : 0,
        'amo_channel' => $amoChannel,
        'amo_shipment' => $amoShipment,
        'amo_payment_type' => $amoPaymentType,
        'amo_pay_method' => $amoPayMethod,
        'amo_sto' => $amoSto,
        'ship_channel' => $shipChannel,
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
