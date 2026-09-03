<?php
/**
 * READ-ONLY: сверка сегодняшних оплат БРП (ИП Р.П.) с полными чеками.
 * Ничего не бьёт и не ставит в очередь.
 *
 *   php tools/audit_brp_checks_today.php
 *   php tools/audit_brp_checks_today.php 2026-08-27
 */
declare(strict_types=1);

date_default_timezone_set('Europe/Moscow');
$today = $argv[1] ?? date('Y-m-d');
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $today)) {
    fwrite(STDERR, "bad date\n");
    exit(1);
}

$innBrp = '231215603728';
$checksLib = '/root/widget_pnevmopodveska1_ru/public_html/checks/_lib.php';
$policyLib = '/root/widget_pnevmopodveska1_ru/public_html/checks/fiscal_roman_amo_full_policy.php';
$bankConfig = '/root/bank_pnevmopodveska1_ru/public_html/config.php';
$bankDb = '/root/bank_pnevmopodveska1_ru/public_html/Classes/DbHelper.php';
$amoConfig = '/root/amo1c_pnevmopodveska1_ru/public_html/config.php';

require_once $checksLib;
if (is_readable($policyLib)) {
    require_once $policyLib;
}
require_once $bankConfig;
require_once $bankDb;

$bank = DbHelper::getInstance();

echo "=== БРП аудит чеков · только чтение · {$today} ===\n\n";

// 1) Приходы в банке за сегодня на ИНН Р.П. / с маркером БРП
$st = $bank->prepare(
    "SELECT id, payment_id, documentNumber, InnRecipient, date_today, status, forget, LEFT(text, 220) AS txt
     FROM income_payment_text
     WHERE date_today LIKE ?
     ORDER BY id ASC"
);
$st->execute([$today . '%']);
$incomes = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

$brpIncomes = [];
foreach ($incomes as $row) {
    $inn = preg_replace('/\D/', '', (string) ($row['InnRecipient'] ?? '')) ?? '';
    $txt = (string) ($row['txt'] ?? '');
    $isBrp = ($inn === $innBrp)
        || preg_match('/\[БРП\b/ui', $txt)
        || preg_match('/Безматерных\s+Р\.?\s*П/ui', $txt)
        || preg_match('/PNEVMOPODVESKA\s*1/ui', $txt);
    if ($isBrp) {
        $brpIncomes[] = $row;
    }
}

echo "Банк income_payment_text за день: " . count($incomes) . "\n";
echo "из них БРП (ИНН/маркер): " . count($brpIncomes) . "\n\n";

foreach ($brpIncomes as $row) {
    $forget = (int) ($row['forget'] ?? 0);
    $status = (string) ($row['status'] ?? '');
    echo sprintf(
        "  #%s pay=%s doc=%s forget=%s status=%s\n    %s\n",
        $row['id'],
        $row['payment_id'] ?: '—',
        $row['documentNumber'] ?: '—',
        $forget,
        $status,
        preg_replace('/\s+/', ' ', (string) $row['txt'])
    );
}

// 2) Сделки, оплаченные сегодня (full=1)
$paidLeadIds = checks_lead_ids_paid_on_date($today);
echo "\nСделки с full-оплатой за день (income_processed): " . count($paidLeadIds) . "\n";

// 3) По каждой сделке — реестр + политика Р.П. + состояние полного чека
$ok = [];
$wait = [];
$missing = [];
$error = [];
$notRp = [];
$noRegistry = [];

foreach ($paidLeadIds as $leadId) {
    $res = checks_fetch_registry($leadId, 20, false);
    if (empty($res['ok'])) {
        $noRegistry[] = $leadId;
        continue;
    }
    $items = checks_enrich_items(is_array($res['items'] ?? null) ? $res['items'] : []);
    $best = null;
    foreach ($items as $row) {
        if (!is_array($row) || (string) ($row['status'] ?? '') === 'refunded') {
            continue;
        }
        if (checks_row_paid_date_key($row) === $today) {
            $best = $row;
            break;
        }
        if ($best === null) {
            $best = $row;
        }
    }
    if ($best === null) {
        $noRegistry[] = $leadId;
        continue;
    }

    $applies = true;
    if (function_exists('fiscal_roman_amo_full_policy_from_registry_row')) {
        $policy = fiscal_roman_amo_full_policy_from_registry_row($best, (string) ($best['deal_branch'] ?? ''));
        $applies = !empty($policy['applies']);
    } else {
        // fallback: legal_entity / branch
        $legal = mb_strtolower((string) ($best['legal_entity'] ?? $best['deal_branch'] ?? ''));
        $applies = str_contains($legal, 'rp')
            || str_contains($legal, 'р.п')
            || str_contains($legal, 'роман')
            || str_contains((string) ($best['org_inn'] ?? ''), $innBrp);
    }
    if (!$applies) {
        $notRp[] = [
            'lead' => $leadId,
            'amount' => (float) ($best['amount'] ?? 0),
            'channel' => (string) ($best['channel'] ?? ''),
            'branch' => (string) ($best['deal_branch'] ?? ''),
        ];
        continue;
    }

    $amount = (float) ($best['amount'] ?? 0);
    $channel = (string) ($best['channel'] ?? $best['source'] ?? '');
    $paidAt = (string) ($best['paid_at'] ?? $best['paid_at_display'] ?? '');
    $paymentId = (string) ($best['payment_id'] ?? '');

    $full = ['has' => false, 'status' => '', 'uuid' => ''];
    if (function_exists('checks_fiscal_receipts_for_leads')) {
        $map = checks_fiscal_receipts_for_leads([$leadId]);
        $recs = $map[$leadId] ?? [];
        foreach ($recs as $fr) {
            if (!is_array($fr)) {
                continue;
            }
            $kind = mb_strtolower((string) ($fr['kind'] ?? $fr['receipt_type'] ?? $fr['type'] ?? ''));
            $st = mb_strtolower((string) ($fr['status'] ?? ''));
            // полный чек / sell
            if ($kind !== '' && !str_contains($kind, 'full') && !str_contains($kind, 'sell') && $kind !== 'income') {
                // keep scanning
            }
            if (in_array($st, ['done', 'ready', 'ok', 'success', 'wait', 'sent', 'error'], true) || $st !== '') {
                $isFull = $kind === '' || str_contains($kind, 'full') || str_contains($kind, 'sell')
                    || (string) ($fr['is_full'] ?? '') === '1'
                    || (int) ($fr['full'] ?? 0) === 1;
                if (!$isFull && isset($fr['payload'])) {
                    $isFull = true; // better than skip
                }
                if ($isFull || $full['status'] === '') {
                    $full = [
                        'has' => true,
                        'status' => $st,
                        'uuid' => (string) ($fr['uuid'] ?? $fr['atol_uuid'] ?? $fr['id'] ?? ''),
                        'kind' => $kind,
                        'created' => (string) ($fr['created_at'] ?? $fr['updated_at'] ?? ''),
                    ];
                    if (in_array($st, ['done', 'ready', 'ok', 'success'], true)) {
                        break;
                    }
                }
            }
        }
    }

    // queue state (read only)
    $qState = '';
    try {
        $qs = $bank->prepare(
            'SELECT id, status, error, amount, payment_id, created_at, updated_at
             FROM fiscal_tg_punch_queue WHERE lead_id = ? ORDER BY id DESC LIMIT 3'
        );
        $qs->execute([$leadId]);
        $qRows = $qs->fetchAll(PDO::FETCH_ASSOC) ?: [];
        if ($qRows) {
            $qState = implode('; ', array_map(static function ($q) {
                return '#' . $q['id'] . '=' . $q['status'] . ($q['error'] ? ('/' . mb_substr((string) $q['error'], 0, 40)) : '');
            }, $qRows));
        }
    } catch (Throwable $e) {
        $qState = 'queue_n/a';
    }

    $entry = [
        'lead' => $leadId,
        'amount' => $amount,
        'channel' => $channel,
        'paid_at' => $paidAt,
        'payment_id' => $paymentId,
        'full' => $full,
        'queue' => $qState,
    ];

    $st = $full['status'] ?? '';
    if (!$full['has']) {
        $missing[] = $entry;
    } elseif (in_array($st, ['done', 'ready', 'ok', 'success'], true)) {
        $ok[] = $entry;
    } elseif (in_array($st, ['wait', 'sent'], true)) {
        $wait[] = $entry;
    } else {
        $error[] = $entry;
    }
}

// 4) Чеки fiscal_receipts созданные сегодня (amo1c / widget DB)
$fiscalToday = [];
try {
    // fiscal_receipts обычно в brooklynba_amo1c
    require_once $amoConfig;
    $amo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER,
        DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $fr = $amo->query(
        "SELECT lead_id, status, kind, receipt_type, uuid, amount, created_at, updated_at
         FROM fiscal_receipts
         WHERE DATE(created_at) = " . $amo->quote($today) . "
            OR DATE(updated_at) = " . $amo->quote($today) . "
         ORDER BY id DESC
         LIMIT 200"
    );
    // soft if columns differ
} catch (Throwable $e) {
    try {
        $amo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
            DB_USER,
            DB_PASS,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        $cols = [];
        foreach ($amo->query('DESCRIBE fiscal_receipts') as $c) {
            $cols[] = $c['Field'];
        }
        $sel = array_intersect(
            ['lead_id', 'deal_id', 'status', 'kind', 'receipt_type', 'type', 'uuid', 'atol_uuid', 'amount', 'sum', 'created_at', 'updated_at', 'payload'],
            $cols
        );
        $sql = 'SELECT ' . implode(',', $sel) . ' FROM fiscal_receipts WHERE 1=1';
        if (in_array('created_at', $cols, true)) {
            $sql .= ' AND (DATE(created_at)=' . $amo->quote($today);
            if (in_array('updated_at', $cols, true)) {
                $sql .= ' OR DATE(updated_at)=' . $amo->quote($today);
            }
            $sql .= ')';
        }
        $sql .= ' ORDER BY id DESC LIMIT 200';
        $fiscalToday = $amo->query($sql)->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $e2) {
        echo "\nfiscal_receipts: " . $e2->getMessage() . "\n";
    }
}

$fmt = static function (array $e): string {
    $f = $e['full'];
    return sprintf(
        "  #%d · %s ₽ · %s · pay=%s · чек=%s/%s · q=%s",
        $e['lead'],
        number_format((float) $e['amount'], 0, '.', ' '),
        $e['channel'] ?: '—',
        $e['payment_id'] !== '' ? mb_substr($e['payment_id'], 0, 24) : '—',
        $f['has'] ? ($f['status'] ?: '?') : 'нет',
        $f['kind'] ?? '',
        $e['queue'] !== '' ? $e['queue'] : '—'
    );
};

echo "\n--- БРП / Р.П. по оплатам за день ---\n";
echo "OK ОФД: " . count($ok) . "\n";
foreach ($ok as $e) {
    echo $fmt($e) . "\n";
}
echo "\nВ ОФД wait/sent: " . count($wait) . "\n";
foreach ($wait as $e) {
    echo $fmt($e) . "\n";
}
echo "\nОшибка чека: " . count($error) . "\n";
foreach ($error as $e) {
    echo $fmt($e) . "\n";
}
echo "\nНЕТ полного чека: " . count($missing) . "\n";
foreach ($missing as $e) {
    echo $fmt($e) . "\n";
}
echo "\nНе Р.П. (пропуск политики): " . count($notRp) . "\n";
foreach ($notRp as $e) {
    echo "  #{$e['lead']} · " . number_format($e['amount'], 0, '.', ' ') . " ₽ · {$e['channel']} · {$e['branch']}\n";
}
if ($noRegistry) {
    echo "\nНет реестра: " . implode(', ', array_map(static fn($id) => '#' . $id, $noRegistry)) . "\n";
}

$sumOk = array_sum(array_column($ok, 'amount'));
$sumMiss = array_sum(array_column($missing, 'amount'));
$sumWait = array_sum(array_column($wait, 'amount'));
$sumErr = array_sum(array_column($error, 'amount'));

echo "\n=== ИТОГО БРП сегодня ===\n";
echo "Пробито OK:     " . count($ok) . " / " . number_format($sumOk, 0, '.', ' ') . " ₽\n";
echo "В процессе:     " . count($wait) . " / " . number_format($sumWait, 0, '.', ' ') . " ₽\n";
echo "Ошибка:         " . count($error) . " / " . number_format($sumErr, 0, '.', ' ') . " ₽\n";
echo "Без чека:       " . count($missing) . " / " . number_format($sumMiss, 0, '.', ' ') . " ₽\n";
echo "Приходов БРП в банке: " . count($brpIncomes) . "\n";
echo "\nНичего не пробивал (read-only).\n";
