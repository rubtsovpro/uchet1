/**
 * Этап 1: склейка оплата → задание склада → «Сделал» → этап Amo «Успешно реализовано».
 */
import { all, get } from './db.js';
import { pushDealStageToAmo, updateDealStage, rawStatusId, mapAmoShipChannel } from './deals.js';
import { createTaskFromDeal, dealIsPaid } from './warehouse-tasks.js';
import { mappedSuccessStatus } from './amo-settings.js';
import { ensureOrderDocChain } from './order-doc-tree.js';

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
}): { created: boolean; task: Record<string, unknown> | null; reason?: string } {
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
 * После статуса handed (и оплаты) — перевести сделку в «Успешно реализовано» в Учёте и Amo.
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
