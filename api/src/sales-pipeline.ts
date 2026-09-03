/**
 * Этап 1: склейка оплата → задание склада → «Сделал» → этап Amo «Успешно реализовано».
 */
import { all, get } from './db.js';
import { getDeal, pushDealStageToAmo, updateDealStage, rawStatusId, mapAmoShipChannel } from './deals.js';
import { createTaskFromDeal, dealIsPaid } from './warehouse-tasks.js';
import { mappedSuccessStatus } from './amo-settings.js';
import { ensureOrderDocChain } from './order-doc-tree.js';
import { buildDealSaleRules } from './deal-sale-rules.js';
import { getDealPaymentSplit } from './deal-payment-split.js';
import {
  dealNeedsWorkorderBeforePayment,
  getDealWorkorderGate,
} from './deal-workorder-gate.js';
import { getDealStoPartsStatus } from './sto-parts-flow.js';
import { ensureHandoffPickAfterPaid, getDealStockFlowBlockers } from './deal-stock-flow.js';
import { isReserveChannelDeal, isShipChannelDeal } from './handoff-reserve.js';

const SUCCESS_NAME_RE = /успешн|реализован/i;
const FAIL_NAME_RE = /не реализован|закрыто и не/i;

/** Найти этап «Успешно реализовано» в воронке сделки (маппинг → эвристика по имени). */
export function findSuccessStatusForDeal(dealId: string): {
  statusId: string;
  statusName: string;
  pipelineId: string;
} | null {
  const deal = get<{ pipeline_id?: string; status_id?: string }>(
    `SELECT pipeline_id, status_id FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  if (!deal) return null;
  const pipelineId = String(deal.pipeline_id || '').trim();
  if (!pipelineId) return null;

  const mapped = mappedSuccessStatus(pipelineId);
  if (mapped) return mapped;

  const statuses = all<{ id: string; name: string }>(
    `SELECT id, name FROM crm_pipeline_statuses WHERE pipeline_id = ? ORDER BY sort, name`,
    [pipelineId]
  );
  const hit = statuses.find((s) => {
    const n = String(s.name || '');
    if (FAIL_NAME_RE.test(n)) return false;
    return SUCCESS_NAME_RE.test(n);
  });
  if (!hit) return null;
  return {
    statusId: rawStatusId(String(hit.id)),
    statusName: String(hit.name),
    pipelineId,
  };
}

/**
 * После оплаты — создать задание складу, если ещё нет активного.
 * Канал: из аргумента, иначе из сделки (если есть), иначе СДЭК предоплата.
 */
export function ensureWarehouseTaskAfterPaid(input: {
  dealId: string;
  channel?: string;
  actorId?: string;
}): { created: boolean; task: Record<string, unknown> | null; reason?: string; handoff?: Record<string, unknown> | null } {
  const dealId = String(input.dealId || '').trim();
  if (!dealId) return { created: false, task: null, reason: 'no deal' };

  const existing = get(
    `SELECT id, number, status FROM warehouse_tasks
     WHERE deal_id = ? AND status NOT IN ('cancelled') LIMIT 1`,
    [dealId]
  ) as { id: string; number: string; status: string } | undefined;
  if (existing) {
    return {
      created: false,
      task: existing as unknown as Record<string, unknown>,
      reason: 'already_exists',
    };
  }

  const deal = get<{
    department?: string;
    name?: string;
    ship_channel?: string;
    amo_channel?: string;
    amo_shipment?: string;
  }>(`SELECT department, name, ship_channel, amo_channel, amo_shipment FROM crm_deals WHERE id = ?`, [
    dealId,
  ]);
  let channel = String(input.channel || '').trim();
  if (!channel) {
    channel = mapAmoShipChannel({
      ship_channel: deal?.ship_channel,
      amo_channel: deal?.amo_channel,
      amo_shipment: deal?.amo_shipment,
      name: deal?.name,
      department: deal?.department,
    });
  }

  try {
    const dealRow = get<{ amo_channel: string; amo_shipment: string; ship_channel: string }>(
      `SELECT IFNULL(amo_channel,'') AS amo_channel,
              IFNULL(amo_shipment,'') AS amo_shipment,
              IFNULL(ship_channel,'') AS ship_channel
       FROM crm_deals WHERE id = ?`,
      [dealId]
    );
    const useHandoff = isReserveChannelDeal(dealRow) || isShipChannelDeal(dealRow);
    if (useHandoff) {
      const handoff = ensureHandoffPickAfterPaid(dealId);
      if (handoff.created || handoff.doc) {
        return {
          created: !!handoff.created,
          task: null,
          reason: handoff.reason || (handoff.created ? 'handoff_created' : 'handoff_exists'),
          handoff: handoff.doc,
        };
      }
    }
    const task = createTaskFromDeal({
      deal_id: dealId,
      channel,
      actor_id: input.actorId,
      comment: 'Авто после оплаты',
    }) as Record<string, unknown>;
    try {
      ensureOrderDocChain(dealId);
    } catch {
      /* дерево не блокирует задание */
    }
    return { created: true, task };
  } catch (e) {
    return {
      created: false,
      task: null,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Готовность закрыть заказ в «Успешно реализовано» (документы, оплата, перемещение, чеки).
 */
export function getDealCloseReadiness(
  dealIdRaw: string,
  opts?: { sto_writeoff_on_close?: boolean }
): {
  deal_id: string;
  ready: boolean;
  already_won: boolean;
  missing: string[];
  success: { status_id: string; status_name: string; pipeline_id: string } | null;
  checks: Record<string, boolean | string>;
} {
  const dealId = String(dealIdRaw || '').trim();
  if (!dealId) {
    return {
      deal_id: '',
      ready: false,
      already_won: false,
      missing: ['Нет заказа'],
      success: null,
      checks: {},
    };
  }

  const deal = getDeal(dealId) as Record<string, unknown> | null;
  if (!deal) {
    return {
      deal_id: dealId,
      ready: false,
      already_won: false,
      missing: ['Заказ не найден'],
      success: null,
      checks: {},
    };
  }

  const success = findSuccessStatusForDeal(dealId);
  const alreadyWon = !!(
    success &&
    rawStatusId(String(deal.status_id || '')) === rawStatusId(success.statusId)
  );

  const missing: string[] = [];
  const checks: Record<string, boolean | string> = {};

  const rules = buildDealSaleRules({ ...deal, id: dealId });
  const sc = (rules.scenario_docs || {}) as Record<string, unknown>;
  const scheme = String(rules.payment_scheme || '');
  const allowUnpaidClose = scheme === 'cod' || scheme === 'credit';
  const split = getDealPaymentSplit(dealId);
  const paid = dealIsPaid(dealId) || !!rules.cash_received;
  checks.paid = paid;
  checks.payment_scheme = scheme;
  if (
    !allowUnpaidClose &&
    (Number(split.due_total) > 0.009 || (Number(split.total) > 0.009 && !paid))
  ) {
    missing.push('Оплата от клиента');
  }

  if (dealNeedsWorkorderBeforePayment(deal)) {
    const gate = getDealWorkorderGate({ ...deal, id: dealId });
    checks.workorder = !!gate.ok;
    if (!gate.ok) {
      missing.push(
        String(gate.error || 'Заказ-наряд')
          .replace(/^Нельзя[^:]*:\s*/i, '')
          .trim() || 'Заказ-наряд'
      );
    }
  } else {
    checks.workorder = true;
  }

  const salesDocs = all<{ doc_type: string; number: string }>(
    `SELECT IFNULL(doc_type,'') AS doc_type, IFNULL(number,'') AS number
     FROM sales_docs WHERE deal_id = ?`,
    [dealId]
  );
  const hasDoc = (t: string) => salesDocs.some((x) => String(x.doc_type) === t);
  if (sc.contract) {
    checks.contract = hasDoc('contract');
    if (!hasDoc('contract')) missing.push('Договор');
  }
  if (sc.workorder) {
    checks.workorder_doc = hasDoc('workorder');
    if (!hasDoc('workorder')) missing.push('Заказ-наряд');
  }
  if (sc.invoice) {
    checks.invoice = hasDoc('invoice');
    if (!hasDoc('invoice')) missing.push('Счёт');
  }
  if (sc.upd) {
    checks.upd = hasDoc('upd');
    if (!hasDoc('upd')) missing.push('УПД');
  }
  if (sc.pdn) {
    const gate = getDealWorkorderGate({ ...deal, id: dealId });
    checks.pdn = !!gate.pdn_ok;
    if (!gate.pdn_ok) missing.push('Согласие ПДн');
  }

  const channel = String(deal.amo_channel || '').toLowerCase();
  const isShip = /отправк/i.test(channel);
  if (isShip && !String(deal.amo_shipment || '').trim()) {
    missing.push('Способ отправки');
    checks.shipment = false;
  } else {
    checks.shipment = true;
  }

  if (sc.transfer) {
    try {
      const st = getDealStoPartsStatus(dealId) as {
        summary?: { all_moved?: boolean; has_task?: boolean; latest_task_status?: string };
        flow?: {
          warehouse?: { done?: boolean };
          courier?: { needed?: boolean; done?: boolean };
        };
      };
      const allMoved = !!st.summary?.all_moved;
      const whDone =
        allMoved ||
        !!st.flow?.warehouse?.done ||
        String(st.summary?.latest_task_status || '') === 'handed';
      checks.transfer = whDone;
      if (!whDone) {
        missing.push(
          st.summary?.has_task
            ? 'Перемещение складом (ещё не сделано)'
            : 'Перемещение (задание складу)'
        );
      }
      if (st.flow?.courier?.needed) {
        checks.courier = !!st.flow.courier.done;
        if (!st.flow.courier.done) missing.push('Курьер (выполнить задание)');
      }
    } catch {
      missing.push('Перемещение');
      checks.transfer = false;
    }
  }

  const checksNeed = String(sc.checks ?? '0');
  const fiscal = all<{ kind: string; status: string }>(
    `SELECT IFNULL(kind,'') AS kind, IFNULL(status,'') AS status
     FROM fiscal_receipts WHERE deal_id = ?`,
    [dealId]
  );
  const fiscalBad = new Set(['error', 'cancelled', 'canceled']);
  const hasKind = (k: string) =>
    fiscal.some(
      (f) => String(f.kind) === k && !fiscalBad.has(String(f.status || '').toLowerCase())
    );
  const hasAdvance = hasKind('advance');
  const hasFull = hasKind('full');
  checks.fiscal_need = checksNeed;
  checks.fiscal_advance = hasAdvance;
  checks.fiscal_full = hasFull;
  if (checksNeed === '2') {
    if (!hasFull) {
      missing.push(hasAdvance ? 'Чек полный (после аванса)' : 'Чеки (аванс → полный)');
    }
  } else if (checksNeed === '1') {
    if (paid && !hasFull && !allowUnpaidClose) missing.push('Чек полный');
  }

  for (const b of getDealStockFlowBlockers(dealId, {
    ignore_on_sto: !!opts?.sto_writeoff_on_close,
  })) {
    if (!missing.includes(b)) missing.push(b);
  }
  checks.stock_flow =
    getDealStockFlowBlockers(dealId, { ignore_on_sto: !!opts?.sto_writeoff_on_close }).length === 0;

  const ready = !alreadyWon && missing.length === 0;

  return {
    deal_id: dealId,
    ready,
    already_won: alreadyWon,
    missing,
    success: success
      ? {
          status_id: success.statusId,
          status_name: success.statusName,
          pipeline_id: success.pipelineId,
        }
      : null,
    checks,
  };
}

/**
 * После статуса handed у задания отправки (курьер / СДЭК) — авто «Успешно» в Amo.
 * Автосервис / самовывоз (резерв → СТО): закрывает сотрудник СТО, не кладовщик на /pick.
 */
export async function promoteDealToSuccessAfterHanded(input: {
  dealId: string;
  taskId?: string;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  amo_synced?: boolean;
  status_id?: string;
  status_name?: string;
}> {
  const dealId = String(input.dealId || '').trim();
  if (!dealId) return { ok: false, reason: 'no deal' };

  const dealChannel = get<{ amo_channel: string; amo_shipment: string; ship_channel: string }>(
    `SELECT IFNULL(amo_channel,'') AS amo_channel,
            IFNULL(amo_shipment,'') AS amo_shipment,
            IFNULL(ship_channel,'') AS ship_channel
     FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  if (isReserveChannelDeal(dealChannel)) {
    return { ok: true, skipped: true, reason: 'reserve_channel_manual_close' };
  }

  if (!dealIsPaid(dealId)) {
    return { ok: false, skipped: true, reason: 'not_paid' };
  }

  const target = findSuccessStatusForDeal(dealId);
  if (!target) {
    return { ok: false, skipped: true, reason: 'no_success_status_in_pipeline' };
  }

  const deal = get<{ status_id?: string; status_name?: string }>(
    `SELECT status_id, status_name FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  const cur = rawStatusId(String(deal?.status_id || ''));
  if (cur && cur === target.statusId) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_success',
      status_id: target.statusId,
      status_name: target.statusName,
    };
  }

  const amo = await pushDealStageToAmo({
    dealId,
    statusId: target.statusId,
    pipelineId: target.pipelineId,
  });
  if (!amo.ok) {
    return { ok: false, reason: `Amo: ${amo.error}`, amo_synced: false };
  }

  updateDealStage(dealId, {
    statusId: target.statusId,
    statusName: target.statusName,
    pipelineId: target.pipelineId,
  });

  return {
    ok: true,
    amo_synced: true,
    status_id: target.statusId,
    status_name: target.statusName,
  };
}
