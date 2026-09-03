/**
 * Резерв WAIT-PAY отключён: товар при ожидании оплаты / счёте не бронируем.
 * СТО и наложка — перемещения (основной→СТО / основной→доставка).
 */
import { writeAudit } from './audit.js';
import { all, run } from './db.js';
import { resolveIsSto, resolvePaymentScheme } from './deal-sale-rules.js';
import { createDocument } from './stock.js';

/** @deprecated Наложка не держит WAIT-PAY — только перемещение на склад доставки. */
export function dealNeedsCodStockReserve(
  _deal: Record<string, unknown> | null | undefined,
  _channelHint?: string
): boolean {
  return false;
}

/** @deprecated СТО не держит WAIT-PAY — только перемещение на склад СТО. */
export function dealNeedsStoStockReserve(
  _deal: Record<string, unknown> | null | undefined
): boolean {
  return false;
}

/** WAIT-PAY авторезерв по заказу больше не нужен (СТО/наложка → перемещения). */
export function dealNeedsClientStockReserve(
  _deal: Record<string, unknown> | null | undefined,
  _channelHint?: string
): boolean {
  return false;
}

/** Схема оплаты COD — для UI/заданий, не для WAIT-PAY. */
export function dealIsCodScheme(
  deal: Record<string, unknown> | null | undefined,
  channelHint?: string
): boolean {
  if (!deal) return false;
  const ch = String(channelHint || deal.ship_channel || '').trim();
  if (ch === 'cdek_cod' || ch === 'avito_cod') return true;
  return resolvePaymentScheme(deal) === 'cod';
}

export function dealIsStoChannel(deal: Record<string, unknown> | null | undefined): boolean {
  return resolveIsSto(deal);
}

/**
 * Резерв по заказу на «Ожидание оплаты» отключён.
 * Склад не двигаем — ссылка / счёт не бронируют товар.
 */
export function reserveStockForDeal(input: {
  dealId: string;
  salesDocId?: string;
  organizationId?: string;
  preferredWarehouseId?: string;
  missingErrorPrefix?: string;
  comment?: string;
  auditAction?: string;
  auditEntity?: string;
  auditEntityId?: string;
  auditSummary?: string;
}): {
  reserves: Array<Record<string, unknown>>;
  already: boolean;
  skipped?: boolean;
  reason?: string;
} {
  void input;
  throw new Error(
    'Резерв на «Ожидание оплаты» отключён — товар при ссылке / счёте не бронируем'
  );
}

/** Резерв под счёт юрлица. */
export function reserveStockForInvoice(input: {
  dealId: string;
  salesDocId: string;
  organizationId?: string;
  preferredWarehouseId?: string;
}): {
  reserves: Array<Record<string, unknown>>;
  already: boolean;
} {
  const salesDocId = String(input.salesDocId || '').trim();
  if (!salesDocId) throw new Error('sales_doc_id required');
  return reserveStockForDeal({
    ...input,
    salesDocId,
    missingErrorPrefix: 'Нет на складе — счёт выставить нельзя (счёт резервирует товар)',
    comment: `Резерв по счёту · сделка ${input.dealId} · документ ${salesDocId}`,
    auditAction: 'sales_doc.reserve',
    auditEntity: 'sales_doc',
    auditEntityId: salesDocId,
  });
}

/** @deprecated Наложка → перемещение на доставку, не WAIT-PAY. */
export function reserveStockForCodDeal(input: {
  dealId: string;
  organizationId?: string;
  preferredWarehouseId?: string;
  channelHint?: string;
}): {
  reserves: Array<Record<string, unknown>>;
  already: boolean;
  skipped?: boolean;
  reason?: string;
} {
  void input;
  return {
    already: false,
    reserves: [],
    skipped: true,
    reason: 'cod_uses_transfer_not_wait_pay',
  };
}

/** @deprecated СТО → перемещение на склад СТО, не WAIT-PAY. */
export function reserveStockForStoDeal(input: {
  dealId: string;
  organizationId?: string;
  preferredWarehouseId?: string;
}): {
  reserves: Array<Record<string, unknown>>;
  already: boolean;
  skipped?: boolean;
  reason?: string;
} {
  void input;
  return {
    already: false,
    reserves: [],
    skipped: true,
    reason: 'sto_uses_transfer_not_wait_pay',
  };
}

/**
 * Авторезерв WAIT-PAY для СТО/наложки отключён — там перемещения.
 * soft=true — не бросает (совместимость синка Amo).
 */
export function ensureDealClientStockReserve(
  dealId: string,
  opts?: { soft?: boolean; channelHint?: string }
): {
  ok: boolean;
  already?: boolean;
  skipped?: boolean;
  reason?: string;
  missing?: string[];
  reserves?: Array<Record<string, unknown>>;
  kind?: 'sto' | 'cod' | null;
} {
  void opts;
  const id = String(dealId || '').trim();
  if (!id) return { ok: false, skipped: true, reason: 'no_deal', kind: null };
  return {
    ok: true,
    skipped: true,
    reason: 'use_transfer_not_wait_pay',
    reserves: [],
    kind: null,
  };
}

/** Пометить активные резервы сделки как sold (товар ушёл в отправку). */
export function markDealStockReservesSold(dealId: string): number {
  const id = String(dealId || '').trim();
  if (!id) return 0;
  const before = all(`SELECT id FROM stock_reserves WHERE deal_id = ? AND status = 'active'`, [id]);
  if (!before.length) return 0;
  run(
    `UPDATE stock_reserves SET status = 'sold', released_at = datetime('now')
     WHERE deal_id = ? AND status = 'active'`,
    [id]
  );
  return before.length;
}

/** Вернуть товар с WAIT-PAY на исходный склад и снять резерв (отмена наложки / задания). */
export function releaseDealStockReserves(
  dealId: string,
  reason = 'cancelled'
): { released: number; docs: string[] } {
  const id = String(dealId || '').trim();
  if (!id) return { released: 0, docs: [] };
  const reserves = all(
    `SELECT * FROM stock_reserves WHERE deal_id = ? AND status = 'active'`,
    [id]
  ) as Array<{
    id: string;
    product_id: string;
    qty: number;
    source_warehouse_id: string;
    reserve_warehouse_id: string;
  }>;
  if (!reserves.length) return { released: 0, docs: [] };

  const bySource = new Map<string, Array<{ product_id: string; qty: number; id: string }>>();
  for (const r of reserves) {
    const key = r.source_warehouse_id;
    const list = bySource.get(key) || [];
    list.push({ product_id: r.product_id, qty: Number(r.qty), id: r.id });
    bySource.set(key, list);
  }

  const docs: string[] = [];
  const waitId = reserves[0]?.reserve_warehouse_id;
  for (const [sourceWh, lines] of bySource) {
    if (!waitId) continue;
    const merged = new Map<string, number>();
    for (const l of lines) {
      merged.set(l.product_id, (merged.get(l.product_id) || 0) + l.qty);
    }
    let docId = '';
    try {
      docId = createDocument({
        doc_type: 'transfer',
        warehouse_id: waitId,
        warehouse_to_id: sourceWh,
        comment: `Снятие резерва · сделка ${id} · ${reason}`,
        lines: [...merged.entries()].map(([product_id, qty]) => ({ product_id, qty })),
        post: true,
      });
      docs.push(docId);
    } catch (e) {
      console.warn('[stock-reserve] releaseDealStockReserves failed', e);
    }
    for (const l of lines) {
      run(
        `UPDATE stock_reserves SET status = 'released', return_doc_id = ?, released_at = datetime('now')
         WHERE id = ?`,
        [docId || '', l.id]
      );
    }
  }
  writeAudit({
    action: 'deal.release_reserve',
    entity: 'crm_deal',
    entityId: id,
    summary: `Снят резерв по заказу ${id} · ${reason} · позиций ${reserves.length}`,
    actor: null,
    meta: { reason, count: reserves.length },
  });
  return { released: reserves.length, docs };
}
