<?php

declare(strict_types=1);

require_once __DIR__ . '/session_bootstrap.php';
require_once '../config.php';
require_once '../Classes/DbHelper.php';
require_once __DIR__ . '/income_widget_lock.php';
require_once __DIR__ . '/warehouse_handoff_lock.php';
require_once __DIR__ . '/queue_1c_log_helper.php';
require_once __DIR__ . '/widget_order_sync.php';

header('Content-Type: application/json; charset=utf-8');

$productId = (int) ($_POST['id'] ?? 0);
if ($productId <= 0) {
    echo json_encode(['status' => 'error', 'message' => 'Некорректный идентификатор товара'], JSON_UNESCAPED_UNICODE);
    exit;
}

$dbHelper = DbHelper::getInstance();
widget_order_pending_return_ensure_column($dbHelper);
$row = widget_income_order_item_row($dbHelper, $productId);
if ($row === null) {
    echo json_encode(['status' => 'error', 'message' => 'Позиция не найдена'], JSON_UNESCAPED_UNICODE);
    exit;
}

$dealId = (int) ($row['lead_id'] ?? 0);
$department = (string) ($row['department'] ?? '');
$guid = trim((string) ($row['product_guid'] ?? ''));

if (function_exists('widget_deal_closed_reject')) {
    widget_deal_closed_reject($dbHelper, $dealId);
}
if (widget_income_nom_edit_blocked($dbHelper, $dealId)) {
    widget_income_reject_nomenclature_mutation($dbHelper, $dealId);
}

if (!empty($row['pending_return'])) {
    echo json_encode([
        'status' => 'error',
        'message' => 'Позиция уже ожидает возврат на склад — дождитесь «Готово» кладовщика',
        'pending_return' => true,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$wmsOk = widget_handoff_wms_pdo() !== null;
$returnQty = $wmsOk
    ? widget_handoff_return_qty_on_delete($dbHelper, $dealId, $guid, $productId, (int) ($row['quantity'] ?? 1))
    : 0.0;
$needReturn = $returnQty > 0;

// Нельзя silently hard-delete, если WMS недоступен — иначе товар «зависнет» на Отложено/Резерве.
if (!$wmsOk) {
    echo json_encode([
        'status' => 'error',
        'message' => 'Склад временно недоступен — удаление заблокировано. Повторите через минуту.',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// Возврат: только если по сделке перемещено больше, чем останется в заказе после удаления.
if ($needReturn) {
    $row['quantity'] = (int) max(1, (int) round($returnQty));
    $ret = widget_handoff_request_return_for_item($dbHelper, $row);
    if (empty($ret['ok'])) {
        echo json_encode([
            'status' => 'error',
            'message' => (string) ($ret['error'] ?? 'Не удалось создать возврат на склад'),
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
    // Задание складу уже в Учёте — позицию из сделки убираем сразу (не ждём «Готово»).
    try {
        $del = $dbHelper->prepare('DELETE FROM order_items WHERE id = :id AND lead_id = :lead');
        $del->bindValue(':id', $productId, PDO::PARAM_INT);
        $del->bindValue(':lead', $dealId, PDO::PARAM_INT);
        $del->execute();
    } catch (Throwable $e) {
        error_log('delete_order_item after return: ' . $e->getMessage());
    }
    queue_1c_mark_items_dirty($dbHelper, $dealId);
    widget_sync_after_order_change($dbHelper, $dealId, $department);
    echo json_encode([
        'status' => 'success',
        'message' => 'Позиция убрана из сделки. Задача складу: вернуть на основной.',
        'pending_return' => true,
        'deal_id' => $dealId,
        'return' => $ret['return'] ?? null,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    $stmt = $dbHelper->prepare('DELETE FROM order_items WHERE id = :id');
    $stmt->bindValue(':id', $productId, PDO::PARAM_INT);
    $stmt->execute();
    if ($stmt->rowCount() <= 0) {
        echo json_encode(['status' => 'error', 'message' => 'Позиция уже удалена'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    queue_1c_mark_items_dirty($dbHelper, $dealId);
    widget_sync_after_order_change($dbHelper, $dealId, $department);
    echo json_encode(['status' => 'success'], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    error_log('delete_order_item: ' . $e->getMessage());
    echo json_encode(['status' => 'error', 'message' => 'Ошибка при удалении товара'], JSON_UNESCAPED_UNICODE);
}
