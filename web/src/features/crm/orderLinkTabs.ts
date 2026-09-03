import type { SalesDocRow } from '@/shared/api/types';

export const SALES_TYPE_TAB: Record<string, string> = {
  contract: 'Договоры',
  invoice: 'Счета',
  workorder: 'Заказ-наряд',
  upd: 'УПД',
  sf: 'Счёт-фактура',
};

export const SALES_TYPE_TAB_ORDER = ['contract', 'invoice', 'workorder', 'upd', 'sf'] as const;

export type OrderLinkTab = {
  id: string;
  label: string;
  create?: boolean;
  count?: number;
  tip?: string;
  /** React route if supported */
  to?: string;
  /** Pathname for legacy screens */
  href?: string;
  active?: boolean;
};

export type DealLike = {
  id?: string;
  is_legal_entity?: boolean | number;
  buyer_kind?: string;
  company_id?: string;
  company_name?: string;
  buyer_inn?: string;
  inn?: string;
};

export type StockDocRef = { id: string; number?: string };
export type TransferRef = { id: string; number?: string };

export function dealNeedsContract(d: DealLike | null | undefined): boolean {
  if (!d || typeof d !== 'object') return true;
  if (Number(d.is_legal_entity) === 1 || d.is_legal_entity === true) return true;
  const kind = String(d.buyer_kind || '').toLowerCase();
  if (kind === 'legal' || kind === 'ip') return true;
  if (kind === 'person' || kind === 'individual' || kind === 'физлицо') return false;
  const hasCompany = !!(
    String(d.company_id || '').trim() || String(d.company_name || '').trim()
  );
  if (hasCompany) return true;
  const inn = String(d.buyer_inn || d.inn || '').replace(/\D/g, '');
  if (inn.length === 10) return true;
  return false;
}

/**
 * Вкладки цепочки заказа (как в классическом UI):
 * Заказ · Договоры · Счета · … · Перемещение · Списания · Структура · История
 */
export function buildDealOrderTabs(opts: {
  dealId: string;
  salesDocs?: SalesDocRow[];
  stockOuts?: StockDocRef[];
  transferOrders?: TransferRef[];
  needContract?: boolean;
  allowCreate?: boolean;
  /** Типы из sale_rules.doc_pack — что можно создавать */
  docPack?: string[];
  active?:
    | { kind: 'deal' }
    | { kind: 'sales'; docType: string; id: string };
}): OrderLinkTab[] {
  const dealId = String(opts.dealId || '').trim();
  if (!dealId) return [];

  const byType: Record<string, SalesDocRow[]> = {};
  for (const d of opts.salesDocs || []) {
    if (!d?.id) continue;
    const t = String(d.doc_type || '');
    if (!t) continue;
    if (!byType[t]) byType[t] = [];
    byType[t].push(d);
  }
  for (const t of Object.keys(byType)) {
    byType[t].sort((a, b) => String(b.doc_date || '').localeCompare(String(a.doc_date || '')));
  }

  const outs = (opts.stockOuts || []).filter((d) => d?.id);
  const xfers = (opts.transferOrders || []).filter((d) => d?.id);
  const active = opts.active;

  const tabs: OrderLinkTab[] = [
    {
      id: `deal:${dealId}`,
      label: 'Заказ',
      to: `/crm/deals/${encodeURIComponent(dealId)}`,
      active: !active || active.kind === 'deal',
    },
  ];

  const needContract = opts.needContract !== false;
  const docPack = Array.isArray(opts.docPack)
    ? new Set(opts.docPack.map((x) => String(x || '').trim()).filter(Boolean))
    : null;
  const canCreateType = (t: string) => {
    if (opts.allowCreate === false) return false;
    if (t === 'sf') return false;
    // Договоры / УПД всегда в шапке; сервер откажет, если нельзя
    return true;
  };
  for (const t of SALES_TYPE_TAB_ORDER) {
    const list = byType[t] || [];
    if (t === 'sf' && !list.length) continue;
    if (list.length) {
      const prefer =
        active?.kind === 'sales' && active.docType === t ? active.id : '';
      const pick = (prefer && list.find((x) => String(x.id) === prefer)) || list[0];
      const reactOk = t !== 'contract';
      tabs.push({
        id: `sales:${pick.id}`,
        label: SALES_TYPE_TAB[t] || t,
        count: list.length > 1 ? list.length : undefined,
        to: reactOk ? `/sales/doc/${encodeURIComponent(pick.id)}` : undefined,
        href: reactOk ? undefined : `/sales-docs/${encodeURIComponent(pick.id)}`,
        active: active?.kind === 'sales' && String(active.id) === String(pick.id),
      });
    } else if (canCreateType(t)) {
      const inPack = !docPack || docPack.has(t);
      let tip = `Создать: ${SALES_TYPE_TAB[t] || t}`;
      if (t === 'contract' && !needContract) {
        tip += ' · обычно не нужен физлицу';
      } else if (!inPack) {
        tip += ' · вне основного пакета сценария';
      }
      tabs.push({
        id: `create:${t}`,
        label: SALES_TYPE_TAB[t] || t,
        create: true,
        tip,
      });
    }
  }

  if (xfers.length) {
    const pick = xfers[0];
    tabs.push({
      id: `xfer:${pick.id}`,
      label: 'Заказ на перемещение',
      count: xfers.length > 1 ? xfers.length : undefined,
      tip: 'Внутренний документ · откуда / куда · кладовщик',
      href: `/transfer-orders/${encodeURIComponent(pick.id)}`,
    });
  } else if (opts.allowCreate !== false) {
    tabs.push({
      id: 'create:transfer',
      label: 'Заказ на перемещение',
      create: true,
      tip: 'Внутренний документ · откуда / куда · кладовщик',
    });
  }

  if (outs.length) {
    const pick = outs[0];
    tabs.push({
      id: `doc:${pick.id}`,
      label: 'Списание',
      count: outs.length > 1 ? outs.length : undefined,
      tip: 'Списание остатков со склада',
      href: `/docs/${encodeURIComponent(pick.id)}`,
    });
  }

  tabs.push({
    id: `structure:${dealId}`,
    label: 'Структура',
    tip: 'Структура документов по заказу',
    href: `/deals/${encodeURIComponent(dealId)}/structure`,
  });
  tabs.push({
    id: `history:${dealId}`,
    label: 'История',
    tip: 'История по заказу',
    href: `/deals/${encodeURIComponent(dealId)}/history`,
  });

  return tabs;
}
