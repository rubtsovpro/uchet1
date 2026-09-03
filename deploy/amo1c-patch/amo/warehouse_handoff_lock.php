<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/wms_product_catalog.php';
require_once __DIR__ . '/income_widget_lock.php';

function widget_handoff_wms_pdo(): ?PDO
{
    static $pdo = null;
    static $tried = false;
    if ($tried) {
        return $pdo;
    }
    $tried = true;
    $path = wms_sqlite_path();
    if (!is_readable($path)) {
        return null;
    }
    try {
        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    } catch (Throwable $e) {
        error_log('widget_handoff_wms_pdo: ' . $e->getMessage());
        $pdo = null;
    }

    return $pdo;
}

/** Проведённая «Передача на склад» (out) — старый путь. */
function widget_handoff_lock_row_out(int $dealId): ?array
{
    if ($dealId <= 0) {
        return null;
    }
    $pdo = widget_handoff_wms_pdo();
    if (!$pdo) {
        return null;
    }
    $stmt = $pdo->prepare(
        "SELECT id, IFNULL(number,'') AS number, IFNULL(comment,'') AS comment, IFNULL(created_at,'') AS created_at
         FROM stock_docs
         WHERE doc_type = 'out'
           AND IFNULL(posted,0) = 1
           AND TRIM(IFNULL(deal_id,'')) = :deal_id
           AND IFNULL(comment,'') LIKE '%Передача на склад%'
         ORDER BY datetime(created_at) DESC
         LIMIT 1"
    );
    $stmt->execute([':deal_id' => (string) $dealId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    return $row ?: null;
}

/**
 * После «Готово» на /pick черновик out удаляется, остаётся transfer
 * с меткой «Склад ГОТОВО» / маршрутом на резерв/курьера.
 */
function widget_handoff_lock_row_transfer(int $dealId): ?array
{
    if ($dealId <= 0) {
        return null;
    }
    $pdo = widget_handoff_wms_pdo();
    if (!$pdo) {
        return null;
    }
    $stmt = $pdo->prepare(
        "SELECT id, IFNULL(number,'') AS number, IFNULL(comment,'') AS comment, IFNULL(created_at,'') AS created_at
         FROM stock_docs
         WHERE doc_type = 'transfer'
           AND IFNULL(posted,0) = 1
           AND TRIM(IFNULL(deal_id,'')) = :deal_id
           AND (
             IFNULL(comment,'') LIKE '%Склад ГОТОВО%'
             OR IFNULL(comment,'') LIKE '%Передача на склад%'
             OR IFNULL(comment,'') LIKE '%→ резерв%'
             OR IFNULL(comment,'') LIKE '%→ курьер%'
           )
         ORDER BY datetime(created_at) DESC
         LIMIT 1"
    );
    $stmt->execute([':deal_id' => (string) $dealId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    return $row ?: null;
}

/** Снимок состава после перемещения (meta stock_flow_lines). */
function widget_handoff_has_flow_snapshot(int $dealId): bool
{
    if ($dealId <= 0) {
        return false;
    }
    $pdo = widget_handoff_wms_pdo();
    if (!$pdo) {
        return false;
    }
    $stmt = $pdo->prepare('SELECT 1 FROM meta WHERE key = ? LIMIT 1');
    $stmt->execute(['stock_flow_lines:' . $dealId]);

    return (bool) $stmt->fetchColumn();
}

/** Есть непроведённый черновик передачи — товар ещё можно менять (дозапись в задачу). */
function widget_handoff_has_open_draft(int $dealId): bool
{
    if ($dealId <= 0) {
        return false;
    }
    $pdo = widget_handoff_wms_pdo();
    if (!$pdo) {
        return false;
    }
    $stmt = $pdo->prepare(
        "SELECT 1 FROM stock_docs
         WHERE doc_type = 'out'
           AND IFNULL(posted,0) = 0
           AND TRIM(IFNULL(deal_id,'')) = :deal_id
           AND IFNULL(comment,'') LIKE '%Передача на склад%'
         LIMIT 1"
    );
    $stmt->execute([':deal_id' => (string) $dealId]);

    return (bool) $stmt->fetchColumn();
}

/** @return array{id: string, number: string, comment: string, created_at: string}|null */
function widget_handoff_lock_row(int $dealId): ?array
{
    return widget_handoff_lock_row_out($dealId) ?: widget_handoff_lock_row_transfer($dealId);
}

/**
 * Склад уже переместил / подготовил резерв — жёсткие правки номенклатуры
 * (кроме soft-return и дозаписи при открытом черновике).
 */
function widget_handoff_stock_was_moved(int $dealId): bool
{
    if ($dealId <= 0) {
        return false;
    }
    if (widget_handoff_lock_row($dealId) !== null) {
        return true;
    }

    return widget_handoff_has_flow_snapshot($dealId);
}

function widget_handoff_is_locked(int $dealId): bool
{
    // Пока черновик на /pick открыт — менеджер может менять состав (правило 2).
    if (widget_handoff_has_open_draft($dealId)) {
        return false;
    }

    return widget_handoff_stock_was_moved($dealId);
}

/** 142 Успешно реализовано, 143 Закрыто и не реализовано — во всех воронках Amo. */
function widget_amo_closed_status_ids(): array
{
    return [142, 143];
}

/**
 * Текущий status_id сделки: WMS → снимок виджета → 0.
 * Для API без повторного запроса в Amo.
 */
function widget_deal_status_id(DbHelper $db, int $dealId, ?int $knownStatusId = null): int
{
    if ($knownStatusId !== null && $knownStatusId > 0) {
        return $knownStatusId;
    }
    if ($dealId <= 0) {
        return 0;
    }
    $pdo = widget_handoff_wms_pdo();
    if ($pdo) {
        try {
            $st = $pdo->prepare(
                "SELECT CAST(IFNULL(status_id,'0') AS INTEGER) AS sid
                 FROM crm_deals WHERE TRIM(IFNULL(id,'')) = ? LIMIT 1"
            );
            $st->execute([(string) $dealId]);
            $sid = (int) ($st->fetchColumn() ?: 0);
            if ($sid > 0) {
                return $sid;
            }
        } catch (Throwable $e) {
            error_log('widget_deal_status_id wms: ' . $e->getMessage());
        }
    }
    if (function_exists('widget_lead_snapshot_load')) {
        $snap = widget_lead_snapshot_load($db, $dealId);
        if (is_array($snap) && !empty($snap['deal_info'])) {
            $sid = (int) ($snap['deal_info']['status_id'] ?? 0);
            if ($sid > 0) {
                return $sid;
            }
        }
    }

    return 0;
}

/** Сделка закрыта в Amo (успех / отказ) — состав заказа не трогаем. */
function widget_deal_is_closed(DbHelper $db, int $dealId, ?int $knownStatusId = null): bool
{
    $sid = widget_deal_status_id($db, $dealId, $knownStatusId);

    return in_array($sid, widget_amo_closed_status_ids(), true);
}

function widget_deal_closed_reject(DbHelper $db, int $dealId): void
{
    if (!widget_deal_is_closed($db, $dealId)) {
        return;
    }
    $sid = widget_deal_status_id($db, $dealId);
    $label = $sid === 143
        ? 'Закрыто и не реализовано'
        : 'Успешно реализовано';
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode([
        'status' => 'error',
        'deal_closed' => true,
        'status_id' => $sid,
        'message' => 'Сделка в статусе «' . $label . '» — добавлять и менять товары нельзя. Нужна новая сделка или возврат этапа.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * После «Готово» / сборки склада состав заказа всё ещё можно менять,
 * пока сделка не в 142/143 и не ушла в доход.
 * Складской след: удаление → soft-return; новые позиции → «Передать дозаказ».
 * (Раньше здесь блокировали цену/кол-во — мешало менеджерам на открытых сделках.)
 */
function widget_handoff_nom_edit_blocked(DbHelper $db, int $dealId): bool
{
    unset($db, $dealId);

    return false;
}

function widget_order_nom_edit_blocked(DbHelper $db, int $dealId, ?int $knownStatusId = null): bool
{
    if (widget_deal_is_closed($db, $dealId, $knownStatusId)) {
        return true;
    }

    return widget_income_nom_edit_blocked($db, $dealId);
}

/**
 * Добавление: после склада — можно (дозаказ).
 * Блокирует доход и закрытая сделка (142/143).
 */
function widget_order_add_blocked(DbHelper $db, int $dealId, ?int $knownStatusId = null): bool
{
    if (widget_deal_is_closed($db, $dealId, $knownStatusId)) {
        return true;
    }

    return widget_income_nom_edit_blocked($db, $dealId);
}

/** Для add_to_order: дозаказ ок после склада; закрытая / доход — нет. */
function widget_order_nom_reject_add(DbHelper $db, int $dealId): void
{
    widget_deal_closed_reject($db, $dealId);
    if (widget_income_nom_edit_blocked($db, $dealId)) {
        widget_income_reject_nomenclature_mutation($db, $dealId);
    }
}

function widget_order_nom_reject_mutation(DbHelper $db, int $dealId): void
{
    widget_deal_closed_reject($db, $dealId);
    if (widget_income_nom_edit_blocked($db, $dealId)) {
        widget_income_reject_nomenclature_mutation($db, $dealId);
    }
}

function widget_order_pending_return_ensure_column(DbHelper $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    try {
        $cols = $db->query("SHOW COLUMNS FROM order_items LIKE 'pending_return'")->fetchAll();
        if ($cols) {
            return;
        }
        $db->exec('ALTER TABLE order_items ADD COLUMN pending_return TINYINT(1) NOT NULL DEFAULT 0');
    } catch (Throwable $e) {
        error_log('pending_return column: ' . $e->getMessage());
    }
}

/**
 * Товар уже лежит на СТО / Резерве / Отложено — при удалении нужен возврат,
 * даже если открыт черновик дозаказа или meta lock ещё не записан.
 */
function widget_handoff_item_on_sto_buffer(string $productGuid): bool
{
    $guid = trim($productGuid);
    if ($guid === '') {
        return false;
    }
    $pdo = widget_handoff_wms_pdo();
    if (!$pdo) {
        return false;
    }
    $st = $pdo->prepare(
        "SELECT 1
         FROM stock_balances b
         JOIN warehouses w ON w.id = b.warehouse_id
         WHERE b.product_id = ?
           AND b.qty > 0
           AND (
             UPPER(IFNULL(w.code,'')) = 'STO'
             OR UPPER(IFNULL(w.code,'')) LIKE 'STO-RSV%'
             OR UPPER(IFNULL(w.code,'')) LIKE 'STO-RES%'
           )
         LIMIT 1"
    );
    $st->execute([$guid]);

    return (bool) $st->fetchColumn();
}

/** Сколько шт product_guid уже уехало на СТО/Резерв/Отложено по этой сделке (проведённые TR). */
function widget_handoff_deal_moved_product_qty(int $dealId, string $productGuid): float
{
    $dealId = (int) $dealId;
    $guid = trim($productGuid);
    if ($dealId <= 0 || $guid === '') {
        return 0.0;
    }
    $pdo = widget_handoff_wms_pdo();
    if (!$pdo) {
        return 0.0;
    }
    $st = $pdo->prepare(
        "SELECT IFNULL(SUM(l.qty), 0) AS q
         FROM stock_doc_lines l
         JOIN stock_docs d ON d.id = l.doc_id
         JOIN warehouses wt ON wt.id = d.warehouse_to_id
         WHERE d.deal_id = ?
           AND l.product_id = ?
           AND IFNULL(d.posted, 0) = 1
           AND d.doc_type = 'transfer'
           AND (
             UPPER(IFNULL(wt.code, '')) = 'STO'
             OR UPPER(IFNULL(wt.code, '')) LIKE 'STO-RSV%'
             OR UPPER(IFNULL(wt.code, '')) LIKE 'STO-RES%'
           )"
    );
    $st->execute([(string) $dealId, $guid]);

    return max(0.0, (float) ($st->fetchColumn() ?: 0));
}

/** Сумма quantity в order_items по guid (можно исключить удаляемую строку). */
function widget_handoff_order_product_qty(DbHelper $db, int $dealId, string $productGuid, ?int $excludeItemId = null): float
{
    $dealId = (int) $dealId;
    $guid = trim($productGuid);
    if ($dealId <= 0 || $guid === '') {
        return 0.0;
    }
    $sql = 'SELECT IFNULL(SUM(quantity), 0) FROM order_items WHERE lead_id = ? AND product_guid = ?';
    $params = [$dealId, $guid];
    if ($excludeItemId !== null && $excludeItemId > 0) {
        $sql .= ' AND id != ?';
        $params[] = $excludeItemId;
    }
    $st = $db->prepare($sql);
    $st->execute($params);

    return max(0.0, (float) ($st->fetchColumn() ?: 0));
}

/**
 * Сколько шт вернуть при удалении строки: только «лишнее» относительно оставшихся в заказе
 * и фактически перемещённых на СТО/резерв по этой сделке.
 */
function widget_handoff_return_qty_on_delete(
    DbHelper $db,
    int $dealId,
    string $productGuid,
    int $excludeItemId,
    int $deleteQty
): float {
    $deleteQty = max(0, $deleteQty);
    if ($deleteQty <= 0) {
        return 0.0;
    }
    $moved = widget_handoff_deal_moved_product_qty($dealId, $productGuid);
    if ($moved <= 0) {
        return 0.0;
    }
    $remaining = widget_handoff_order_product_qty($db, $dealId, $productGuid, $excludeItemId);
    $surplus = $moved - $remaining;
    if ($surplus <= 0) {
        return 0.0;
    }

    return min((float) $deleteQty, $surplus);
}

/**
 * Soft-delete после перемещения: позиция остаётся в сделке до «Готово» склада по возврату.
 * Пишем требование прямо в WMS meta (без сессии Учёта).
 *
 * @return array{ok:bool,error?:string,return?:array}
 */
/**
 * Где лежит позиция сейчас + откуда брали (для задачи возврата на /pick).
 *
 * @return array{
 *   from_warehouse_id?:string,from_warehouse_code?:string,from_warehouse_name?:string,
 *   from_cell_code?:string,origin_cell_code?:string,origin_label?:string,to_cell_code?:string
 * }
 */
function widget_handoff_return_location(PDO $pdo, string $dealId, string $productGuid): array
{
    $out = [];
    $candidates = [];
    $sto = $pdo->query("SELECT id, IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE code = 'STO' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
    if ($sto) {
        $candidates[] = ['id' => (string) $sto['id'], 'code' => (string) $sto['code'], 'name' => (string) ($sto['name'] ?: 'СТО'), 'prio' => 1];
    }
    $rsv = $pdo->query("SELECT id, IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE code = 'STO-RSV-MSK' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
    if ($rsv) {
        $candidates[] = ['id' => (string) $rsv['id'], 'code' => (string) $rsv['code'], 'name' => (string) ($rsv['name'] ?: 'Резерв СТО'), 'prio' => 2];
    }
    $res = $pdo->query("SELECT id, IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE code = 'STO-RES-MSK' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
    if ($res) {
        $candidates[] = ['id' => (string) $res['id'], 'code' => (string) $res['code'], 'name' => (string) ($res['name'] ?: 'Отложено под СТО'), 'prio' => 3];
    }
    usort($candidates, static fn ($a, $b) => $a['prio'] <=> $b['prio']);

    $from = null;
    $balSt = $pdo->prepare('SELECT IFNULL(qty,0) AS qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ? AND qty > 0 LIMIT 1');
    foreach ($candidates as $c) {
        $balSt->execute([$c['id'], $productGuid]);
        $qty = (float) ($balSt->fetchColumn() ?: 0);
        if ($qty > 0) {
            $from = $c;
            break;
        }
    }
    if ($from) {
        $out['from_warehouse_id'] = $from['id'];
        $out['from_warehouse_code'] = $from['code'];
        $out['from_warehouse_name'] = $from['name'];
    }

    // Ячейка: comment «яч:…» у последнего TR на этот склад / остаток ячеек
    $cell = '';
    if ($from) {
        $docSt = $pdo->prepare(
            "SELECT IFNULL(d.comment,'') AS comment
             FROM stock_docs d
             JOIN stock_doc_lines l ON l.doc_id = d.id
             WHERE d.deal_id = ? AND l.product_id = ? AND IFNULL(d.posted,0) = 1
               AND d.warehouse_to_id = ?
             ORDER BY datetime(d.created_at) DESC LIMIT 1"
        );
        $docSt->execute([$dealId, $productGuid, $from['id']]);
        $comment = (string) ($docSt->fetchColumn() ?: '');
        if (preg_match('/яч:\s*([A-Za-zА-ЯЁ]\d*(?:\.[\dA-Za-z]+)?)/iu', $comment, $m)) {
            $cell = str_replace('А', 'A', trim($m[1]));
        }
        if ($cell === '') {
            $cellSt = $pdo->prepare(
                "SELECT IFNULL(c.code,'') AS code
                 FROM stock_cell_balances b
                 JOIN warehouse_cells c ON c.id = b.cell_id
                 WHERE b.warehouse_id = ? AND b.product_id = ? AND b.qty > 0
                 ORDER BY b.qty DESC LIMIT 1"
            );
            $cellSt->execute([$from['id'], $productGuid]);
            $cell = trim((string) ($cellSt->fetchColumn() ?: ''));
        }
    }
    if ($cell !== '') {
        $out['from_cell_code'] = $cell;
    }

    // Откуда брали: первый приход на резерв
    $originSt = $pdo->prepare(
        "SELECT IFNULL(d.comment,'') AS comment,
                IFNULL(wf.name,'') AS fr, IFNULL(wt.name,'') AS tto
         FROM stock_docs d
         JOIN stock_doc_lines l ON l.doc_id = d.id
         LEFT JOIN warehouses wf ON wf.id = d.warehouse_id
         LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
         WHERE d.deal_id = ? AND l.product_id = ? AND IFNULL(d.posted,0) = 1
           AND d.doc_type = 'transfer'
           AND IFNULL(d.comment,'') NOT LIKE '%Спуск на СТО%'
           AND (
             UPPER(IFNULL(wt.code,'')) LIKE 'STO-RSV%'
             OR UPPER(IFNULL(wt.code,'')) LIKE 'STO-RES%'
             OR IFNULL(d.comment,'') LIKE '%Резерв%'
           )
         ORDER BY datetime(d.created_at) ASC LIMIT 1"
    );
    $originSt->execute([$dealId, $productGuid]);
    $origin = $originSt->fetch(PDO::FETCH_ASSOC) ?: null;
    $originCell = '';
    if ($origin && preg_match('/яч:\s*([A-Za-zА-ЯЁ]\d*(?:\.[\dA-Za-z]+)?)/iu', (string) $origin['comment'], $m2)) {
        $originCell = str_replace('А', 'A', trim($m2[1]));
    }
    $fr = trim((string) ($origin['fr'] ?? 'Основной'));
    $tto = trim((string) ($origin['tto'] ?? 'Резерв СТО'));
    $out['origin_label'] = $fr . ' → ' . $tto . ($originCell !== '' ? ' · яч. ' . $originCell : '');
    if ($originCell !== '') {
        $out['origin_cell_code'] = $originCell;
    }
    $out['to_cell_code'] = $originCell !== '' ? $originCell : $cell;

    return $out;
}

/**
 * @param array<string,mixed> $orderItem
 * @return array{ok:bool,return?:array,error?:string}
 */
function widget_handoff_request_return_for_item(DbHelper $db, array $orderItem): array
{
    $dealId = (int) ($orderItem['lead_id'] ?? 0);
    $guid = trim((string) ($orderItem['product_guid'] ?? ''));
    $qty = max(1, (int) ($orderItem['quantity'] ?? 1));
    $itemId = (int) ($orderItem['id'] ?? 0);
    if ($dealId <= 0 || $guid === '' || $itemId <= 0) {
        return ['ok' => false, 'error' => 'bad item'];
    }

    $pdo = widget_handoff_wms_pdo();
    if (!$pdo) {
        return ['ok' => false, 'error' => 'WMS sqlite недоступен'];
    }

    $metaKey = 'stock_return_pending:' . $dealId;
    $existing = null;
    $st = $pdo->prepare('SELECT value FROM meta WHERE key = ? LIMIT 1');
    $st->execute([$metaKey]);
    $raw = $st->fetchColumn();
    if (is_string($raw) && $raw !== '') {
        $parsed = json_decode($raw, true);
        if (is_array($parsed) && ($parsed['status'] ?? '') === 'pending') {
            $existing = $parsed;
        }
    }

    $loc = widget_handoff_return_location($pdo, (string) $dealId, $guid);
    // Артикул/имя — из карточки WMS по guid (в заказе часто чужой OEM в поле sku).
    $catalogName = (string) ($orderItem['name'] ?? '');
    $catalogSku = (string) ($orderItem['sku'] ?? '');
    try {
        $pst = $pdo->prepare('SELECT IFNULL(name,\'\') AS name, IFNULL(sku,\'\') AS sku FROM products WHERE id = ? LIMIT 1');
        $pst->execute([$guid]);
        $prow = $pst->fetch(PDO::FETCH_ASSOC);
        if (is_array($prow)) {
            $psku = trim((string) ($prow['sku'] ?? ''));
            $pname = trim((string) ($prow['name'] ?? ''));
            if ($psku !== '') {
                $catalogSku = $psku;
            }
            if ($pname !== '') {
                $catalogName = $pname;
            }
        }
    } catch (Throwable $e) {
        // оставляем поля из order_item
    }
    $line = array_merge([
        'product_id' => $guid,
        'qty' => $qty,
        'name' => $catalogName,
        'sku' => $catalogSku,
        'order_item_id' => $itemId,
    ], $loc);
    $lines = is_array($existing['lines'] ?? null) ? $existing['lines'] : [];
    $merged = false;
    foreach ($lines as &$old) {
        if (!is_array($old)) {
            continue;
        }
        if ((string) ($old['product_id'] ?? '') === $guid
            && (int) ($old['order_item_id'] ?? 0) === $itemId) {
            $old['qty'] = max(1, (int) ($old['qty'] ?? 0) + $qty);
            foreach ($loc as $k => $v) {
                if ($v !== '' && $v !== null) {
                    $old[$k] = $v;
                }
            }
            $merged = true;
            break;
        }
    }
    unset($old);
    if (!$merged) {
        $lines[] = $line;
    }
    $orderItemIds = is_array($existing['order_item_ids'] ?? null)
        ? array_map('intval', $existing['order_item_ids'])
        : [];
    if (!in_array($itemId, $orderItemIds, true)) {
        $orderItemIds[] = $itemId;
    }

    $fromName = (string) ($loc['from_warehouse_name'] ?? '');
    if ($fromName === '') {
        foreach ($lines as $l) {
            if (!empty($l['from_warehouse_name'])) {
                $fromName = (string) $l['from_warehouse_name'];
                break;
            }
        }
    }
    if ($fromName === '') {
        $fromName = 'Резерв/СТО';
    }

    $req = [
        'id' => (string) ($existing['id'] ?? bin2hex(random_bytes(16))),
        'deal_id' => (string) $dealId,
        'status' => 'pending',
        'reason' => 'Удалено из заказа после перемещения',
        'lines' => $lines,
        'order_item_ids' => $orderItemIds,
        'created_at' => (string) ($existing['created_at'] ?? date('c')),
        'from_warehouse_id' => (string) ($loc['from_warehouse_id'] ?? ($existing['from_warehouse_id'] ?? '')),
        'from_warehouse_code' => (string) ($loc['from_warehouse_code'] ?? ($existing['from_warehouse_code'] ?? '')),
        'from_warehouse_name' => $fromName,
        'route_label' => $fromName . ' → Основной',
    ];
    $ins = $pdo->prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    $ins->execute([$metaKey, json_encode($req, JSON_UNESCAPED_UNICODE)]);

    widget_order_pending_return_ensure_column($db);
    $upd = $db->prepare('UPDATE order_items SET pending_return = 1 WHERE id = ? AND lead_id = ?');
    $upd->execute([$itemId, $dealId]);

    return ['ok' => true, 'return' => $req];
}
