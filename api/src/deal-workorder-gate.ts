/**
 * ЗН остаётся в пакете документов (матрица ЖЦ), но оплату (нал / ссылка)
 * больше не блокирует — физ и юр могут платить до печати заказ-наряда.
 */
import { get, run } from './db.js';
import { resolveScenarioDocs } from './deal-sale-rules.js';
import { writeAudit } from './audit.js';
import { parseStoChecklistJson } from './sto-intake-checklist.js';
import { pdnScansSummary } from './pdn-media.js';
import { dealHasPdnSmsSigned } from './pdn-sms-sign.js';

function fmtRub(n: number): string {
  return (
    new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Number(n) || 0) + ' ₽'
  );
}

export type DealWorkorderGate = {
  required: boolean;
  ok: boolean;
  workorder: Record<string, unknown> | null;
  printed: boolean;
  has_plate: boolean;
  /** На СТО у физлица: согласие на ПДн отмечено в чек-листе ЗН */
  pdn_ok: boolean;
  pdn_required: boolean;
  error: string | null;
  /** create | plate | print | pdn | null */
  need: 'create' | 'plate' | 'print' | 'pdn' | null;
};

export function dealNeedsWorkorderBeforePayment(
  _deal: Record<string, unknown> | null | undefined
): boolean {
  // Оплата ссылкой / налом не ждёт ЗН (ни самовывоз, ни СТО, ни физ/юр).
  return false;
}

export function getDealWorkorder(
  dealId: string
): Record<string, unknown> | null {
  const id = String(dealId || '').trim();
  if (!id) return null;
  return (
    (get(
      `SELECT id, number, total, amount, car_plate, printed_at, created_at, status,
              IFNULL(checklist_json,'') AS checklist_json,
              IFNULL(template_id,'') AS template_id
       FROM sales_docs
       WHERE deal_id = ? AND doc_type = 'workorder'
       ORDER BY datetime(created_at) DESC LIMIT 1`,
      [id]
    ) as Record<string, unknown> | undefined) || null
  );
}

function workorderPdnOk(
  workorder: Record<string, unknown> | null,
  dealId?: string
): boolean {
  if (workorder) {
    const state = parseStoChecklistJson(workorder.checklist_json);
    if (state.checks.pdn) return true;
  }
  const id = String(dealId || '').trim();
  if (id) {
    try {
      if (pdnScansSummary(id).scans_ok) return true;
    } catch {
      /* ignore */
    }
    try {
      if (dealHasPdnSmsSigned(id)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export function getDealWorkorderGate(
  deal: Record<string, unknown> | null | undefined
): DealWorkorderGate {
  const required = dealNeedsWorkorderBeforePayment(deal);
  const dealId = String(deal?.id || '').trim();
  const workorder = dealId ? getDealWorkorder(dealId) : null;
  const docs = resolveScenarioDocs(deal);
  const stsRequired = !!docs.sts;
  const has_plate = Boolean(String(workorder?.car_plate || deal?.car_plate || '').trim());
  const printed = Boolean(String(workorder?.printed_at || '').trim());
  const pdn_required = !!docs.pdn;
  const pdn_ok = !pdn_required || workorderPdnOk(workorder, dealId);
  if (!required) {
    return {
      required: false,
      ok: true,
      workorder,
      printed,
      has_plate,
      pdn_ok,
      pdn_required,
      error: null,
      need: null,
    };
  }
  if (!workorder) {
    return {
      required: true,
      ok: false,
      workorder: null,
      printed: false,
      has_plate: false,
      pdn_ok: false,
      pdn_required,
      error: 'Сначала создайте и распечатайте заказ-наряд — потом оплата (нал / ссылка)',
      need: 'create',
    };
  }
  // Госномер / СТС — только колонка СТС матрицы (автосервис). Самовывоз: ЗН без СТС.
  if (stsRequired && !has_plate) {
    return {
      required: true,
      ok: false,
      workorder,
      printed: false,
      has_plate: false,
      pdn_ok,
      pdn_required,
      error:
        'В заказ-наряде укажите гос. номер (авто / СТС), распечатайте ЗН — затем оплата',
      need: 'plate',
    };
  }
  if (!printed) {
    return {
      required: true,
      ok: false,
      workorder,
      printed: false,
      has_plate: has_plate || !stsRequired,
      pdn_ok,
      pdn_required,
      error: 'Распечатайте заказ-наряд — без печати оплату (нал / ссылку) не открываем',
      need: 'print',
    };
  }
  if (pdn_required && !pdn_ok) {
    return {
      required: true,
      ok: false,
      workorder,
      printed: true,
      has_plate: has_plate || !stsRequired,
      pdn_ok: false,
      pdn_required: true,
      error:
        'Для физлица на СТО нужно согласие на ПДн: SMS-подпись (иконка SMS у «Согласие ПДн»), скан бланка или отметка в чек-листе ЗН',
      need: 'pdn',
    };
  }
  return {
    required: true,
    ok: true,
    workorder,
    printed: true,
    has_plate: has_plate || !stsRequired,
    pdn_ok: true,
    pdn_required,
    error: null,
    need: null,
  };
}

export function assertDealWorkorderReadyForPayment(
  deal: Record<string, unknown> | null | undefined
): void {
  const gate = getDealWorkorderGate(deal);
  if (!gate.ok && gate.error) throw new Error(gate.error);
}

/** Отметить печать ЗН / PDF и записать в историю заказа. */
export function markSalesDocPrinted(
  docId: string,
  opts?: {
    actor?: import('./auth.js').Actor | null;
    /** @deprecated передавайте actor */
    actorName?: string;
    via?: string;
  }
): { first: boolean; doc: Record<string, unknown> | null } {
  const id = String(docId || '').trim();
  if (!id) return { first: false, doc: null };
  const doc = get(
    `SELECT id, doc_type, number, total, amount, deal_id, printed_at FROM sales_docs WHERE id = ?`,
    [id]
  ) as Record<string, unknown> | undefined;
  if (!doc) return { first: false, doc: null };
  const wasPrinted = Boolean(String(doc.printed_at || '').trim());
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  run(`UPDATE sales_docs SET printed_at = ? WHERE id = ?`, [now, id]);
  if (!wasPrinted && String(doc.doc_type || '') === 'workorder') {
    const total = Number(doc.total) || Number(doc.amount) || 0;
    const num = String(doc.number || '').trim() || id.slice(0, 8);
    const dealId = String(doc.deal_id || '').trim();
    const via = String(opts?.via || 'pdf').trim();
    const viaLabel =
      via === 'pdf'
        ? 'PDF'
        : via === 'print'
          ? 'печать'
          : via === 'html'
            ? 'просмотр'
            : via === 'sto-pack.pdf'
              ? 'пакет СТО'
              : via;
    const actor =
      opts?.actor ||
      (opts?.actorName
        ? ({
            id: '',
            name: opts.actorName,
            login: '',
            email: '',
            role: 'none',
            department: '',
            rights: {} as import('./auth.js').Actor['rights'],
            isSystemAdmin: false,
          } satisfies import('./auth.js').Actor)
        : null);
    writeAudit({
      action: 'sales_doc.print',
      entity: 'sales_doc',
      entityId: id,
      actor,
      summary: `Заказ-наряд № ${num} распечатан · сумма ${fmtRub(total)}${
        dealId ? ` · сделка ${dealId}` : ''
      }${viaLabel ? ` · ${viaLabel}` : ''}`,
      after: {
        number: num,
        total,
        deal_id: dealId,
        printed_at: now,
        via,
      },
    });
  }
  return {
    first: !wasPrinted,
    doc: { ...doc, printed_at: now },
  };
}

export function workorderFormedSummary(doc: {
  number?: unknown;
  total?: unknown;
  amount?: unknown;
  deal_id?: unknown;
}): string {
  const num = String(doc.number || '').trim() || '—';
  const total = Number(doc.total) || Number(doc.amount) || 0;
  const dealId = String(doc.deal_id || '').trim();
  return `Заказ-наряд № ${num} сформирован на сумму ${fmtRub(total)}${
    dealId ? ` · сделка ${dealId}` : ''
  }`;
}
