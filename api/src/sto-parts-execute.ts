/**
 * Исполнение задания складу (channel=sto_parts):
 * — dest = СТО: перемещение основной→СТО + расходная со СТО;
 * — dest = склад курьера: только перемещение основной→курьер + задание курьеру.
 */
import { get, run, all } from './db.js';
import { createDocument, applyStockDelta } from './stock.js';
import {
  getStoTransferRequest,
  mainWarehouseId,
  stoWarehouseId,
  courierWarehouseId,
} from './supply-chain.js';
import { isBarcodePickToken } from './product-units.js';
import { ensureCourierHandoffRun } from './sto-parts-courier.js';
import { logStoTransferEvent } from './deal-doc-numbers.js';

export function resolveStoRequestIdFromTask(task: {
  stock_doc_id?: string;
  track_number?: string;
  comment?: string;
}): string {
  const a = String(task.stock_doc_id || '').trim();
  if (a && !a.includes('-00') && a.length > 8) {
    const byId = get(`SELECT id FROM sto_transfer_requests WHERE id = ?`, [a]);
    if (byId) return a;
  }
  const b = String(task.track_number || '').trim();
  if (b) {
    const byTrack = get(`SELECT id FROM sto_transfer_requests WHERE id = ?`, [b]);
    if (byTrack) return b;
  }
  return a || b || '';
}

function cleanSerials(raw: string[]): string[] {
  return raw
    .map((s) => String(s || '').trim())
    .filter((s) => s && !isBarcodePickToken(s));
}

/** Если есть экземпляры, а qty-остаток пуст — подтянуть баланс под единицы. */
function ensureBalanceForMove(warehouseId: string, productId: string, qty: number, serials: string[]) {
  const need = Math.max(1, Math.ceil(Number(qty) || 1));
  const have =
    Number(
      get<{ qty: number }>(
        `SELECT IFNULL(qty,0) AS qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`,
        [warehouseId, productId]
      )?.qty || 0
    ) || 0;
  if (have + 0.0001 >= need) return;
  let units = 0;
  if (serials.length) {
    for (const serial of serials) {
      const u = get(
        `SELECT id FROM product_units
         WHERE product_id = ? AND lower(serial) = lower(?) AND status = 'in_stock'
           AND warehouse_id = ?
         LIMIT 1`,
        [productId, serial, warehouseId]
      );
      if (u) units += 1;
    }
  } else {
    units = Number(
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM product_units
         WHERE product_id = ? AND warehouse_id = ? AND status = 'in_stock'`,
        [productId, warehouseId]
      )?.c || 0
    );
  }
  if (units + 0.0001 >= need) {
    applyStockDelta(warehouseId, productId, need - have);
  }
}

/** Закрытие задания складу: перемещение (и при dest=СТО — списание). */
export function executeStoPartsFromTask(input: {
  task_id: string;
  actor_id?: string;
}): {
  skipped?: string;
  transfer_doc_id?: string;
  out_doc_id?: string;
  sto_request_id?: string;
  dest_code?: string;
  courier_run_id?: string;
} {
  const taskId = String(input.task_id || '').trim();
  if (!taskId) throw new Error('Нет задания');
  const task = get<{
    id: string;
    channel: string;
    deal_id: string;
    stock_doc_id: string;
    track_number: string;
    comment: string;
    number: string;
  }>(`SELECT * FROM warehouse_tasks WHERE id = ?`, [taskId]);
  if (!task) throw new Error('Задание не найдено');
  if (String(task.channel) !== 'sto_parts') return { skipped: 'not_sto_parts' };

  const reqId = resolveStoRequestIdFromTask(task);
  if (!reqId) throw new Error('Не найдено связанное «Задание на СТО»');
  const req = getStoTransferRequest(reqId) as Record<string, unknown> | null;
  if (!req) throw new Error('Задание на СТО не найдено');

  const source = String(req.source || 'warehouse');
  if (source === 'nonpneumo') {
    return { skipped: 'nonpneumo_stay', sto_request_id: reqId };
  }

  const existingXfer = String(req.transfer_doc_id || '').trim();
  const existingOut = String(req.out_doc_id || '').trim();
  const courierWh = courierWarehouseId();
  const stoWh = stoWarehouseId();
  const destWh = String(req.dest_warehouse_id || '').trim() || stoWh;
  const toCourier = destWh === courierWh;
  const destCode = toCourier ? 'COURIER' : 'STO';

  if (existingXfer && (toCourier || existingOut)) {
    let courier_run_id = '';
    if (toCourier) {
      courier_run_id = ensureCourierHandoffRun({
        sto_request_id: reqId,
        warehouse_task_id: taskId,
        actor_id: input.actor_id,
      }).id;
    }
    return {
      transfer_doc_id: existingXfer,
      out_doc_id: existingOut || undefined,
      sto_request_id: reqId,
      dest_code: destCode,
      courier_run_id: courier_run_id || undefined,
    };
  }

  if (Number(req.needs_rebrand) === 1 && !Number(req.rebrand_done)) {
    throw new Error('Сначала отметьте ребрендинг пневмы (до спуска на СТО)');
  }

  const linesRaw = (Array.isArray(req.lines) ? req.lines : []) as Array<Record<string, unknown>>;
  let lines = linesRaw
    .map((l) => ({
      product_id: String(l.product_id || '').trim(),
      qty: Number(l.qty) || 1,
      serials: [] as string[],
    }))
    .filter((l) => l.product_id && l.qty > 0);

  const taskLines = all<{ product_id: string; qty: number; dims_json: string }>(
    `SELECT product_id, qty, IFNULL(dims_json,'{}') AS dims_json
     FROM warehouse_task_lines WHERE task_id = ? AND IFNULL(product_id,'') != ''`,
    [taskId]
  );
  const serialsByProduct = new Map<string, string[]>();
  for (const tl of taskLines) {
    let serials: string[] = [];
    try {
      const dims = JSON.parse(String(tl.dims_json || '{}') || '{}') as { serials?: unknown };
      if (Array.isArray(dims.serials)) {
        serials = cleanSerials(dims.serials.map((s) => String(s || '')));
      }
    } catch {
      /* ignore */
    }
    if (serials.length) serialsByProduct.set(String(tl.product_id), serials);
  }

  if (!lines.length) {
    lines = taskLines
      .map((l) => ({
        product_id: String(l.product_id),
        qty: Number(l.qty) || 1,
        serials: serialsByProduct.get(String(l.product_id)) || [],
      }))
      .filter((l) => l.product_id && l.qty > 0);
  } else {
    lines = lines.map((l) => {
      const serials = serialsByProduct.get(l.product_id) || [];
      return {
        ...l,
        serials,
        qty: serials.length || l.qty,
      };
    });
  }
  if (!lines.length) throw new Error('Нет позиций для перемещения / списания');

  const mainWh = mainWarehouseId();
  const dealId = String(req.deal_id || task.deal_id || '').trim();
  const num = String(req.number || task.number || '');

  for (const l of lines) {
    ensureBalanceForMove(mainWh, l.product_id, l.qty, l.serials);
  }

  let transferId = existingXfer;
  if (!transferId) {
    transferId = createDocument({
      doc_type: 'transfer',
      warehouse_id: mainWh,
      warehouse_to_id: destWh,
      deal_id: dealId,
      comment: toCourier
        ? `Перемещение ${num} · на склад курьера`
        : `Задание на СТО ${num} · перемещение`,
      lines,
      post: true,
      serials_optional: true,
    });
  }

  let outId = existingOut;
  if (!toCourier && !outId) {
    outId = createDocument({
      doc_type: 'out',
      warehouse_id: stoWh,
      deal_id: dealId,
      comment: `Задание на СТО ${num} · списание (исполнение)`,
      lines,
      post: true,
      serials_optional: true,
    });
  }

  run(
    `UPDATE sto_transfer_requests
     SET transfer_doc_id = ?,
         out_doc_id = ?,
         status = 'done',
         updated_at = datetime('now')
     WHERE id = ?`,
    [transferId, outId || '', reqId]
  );
  run(
    `UPDATE sto_transfer_request_lines
     SET status = 'done'
     WHERE request_id = ? AND status = 'new'`,
    [reqId]
  );

  const destName = toCourier ? 'Склад курьера' : 'СТО';
  logStoTransferEvent({
    request_id: reqId,
    event: toCourier ? 'transferred_courier' : 'executed_sto',
    summary: `${num} · Основной → ${destName}`,
    actor_id: input.actor_id,
    payload: {
      transfer_doc_id: transferId,
      out_doc_id: outId || '',
      dest_code: destCode,
      task_id: taskId,
    },
  });

  let courier_run_id = '';
  if (toCourier) {
    courier_run_id = ensureCourierHandoffRun({
      sto_request_id: reqId,
      warehouse_task_id: taskId,
      actor_id: input.actor_id,
    }).id;
  }

  return {
    transfer_doc_id: transferId,
    out_doc_id: outId || undefined,
    sto_request_id: reqId,
    dest_code: destCode,
    courier_run_id: courier_run_id || undefined,
  };
}
