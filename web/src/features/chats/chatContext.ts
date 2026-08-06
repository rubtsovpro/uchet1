export type ChatEntityRefType =
  | 'deal'
  | 'sales_doc'
  | 'stock_doc'
  | 'warehouse_task'
  | 'product'
  | 'thin_doc'
  | 'supply_order';

export type ChatEntityRef = {
  type: ChatEntityRefType;
  id: string;
  label: string;
  href: string;
};

export const UCHET1_ENTITY_DRAG_MIME = 'application/x-uchet1-entity';
const PENDING_REF_KEY = 'uchet1-chat-pending-ref';

export type OpenChatWithEntityDetail = {
  ref?: ChatEntityRef | null;
  peerId?: string;
  open?: boolean;
};

export function entityTypeLabel(type: string): string {
  switch (type) {
    case 'deal':
      return 'Заказ покупателя';
    case 'sales_doc':
      return 'Документ';
    case 'stock_doc':
      return 'Склад';
    case 'warehouse_task':
      return 'Задание';
    case 'product':
      return 'Товар';
    case 'thin_doc':
      return 'Заказ';
    case 'supply_order':
      return 'Поставка';
    default:
      return 'Учёт';
  }
}

export function productEntityRef(p: {
  id: string;
  name?: string;
  sku?: string;
  code?: string;
}): ChatEntityRef {
  const sku = String(p.sku || p.code || '').trim();
  const name = String(p.name || '').trim() || sku || `Товар ${String(p.id).slice(0, 8)}`;
  return {
    type: 'product',
    id: String(p.id),
    label: sku ? `${sku} · ${name}` : name,
    href: `/products/${p.id}`,
  };
}

export function setEntityDragData(dt: DataTransfer, ref: ChatEntityRef): void {
  const json = JSON.stringify(ref);
  dt.setData(UCHET1_ENTITY_DRAG_MIME, json);
  dt.setData('text/plain', ref.label || `${entityTypeLabel(ref.type)} ${ref.id}`);
  dt.effectAllowed = 'copy';
}

export function parseEntityDragData(dt: DataTransfer): ChatEntityRef | null {
  const raw = dt.getData(UCHET1_ENTITY_DRAG_MIME) || '';
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<ChatEntityRef>;
    if (!o?.type || !o?.id) return null;
    return {
      type: o.type as ChatEntityRefType,
      id: String(o.id),
      label: String(o.label || ''),
      href: String(o.href || ''),
    };
  } catch {
    return null;
  }
}

export function dealEntityRef(d: {
  id: string;
  name?: string;
  price?: number;
}): ChatEntityRef {
  const name = String(d.name || '').trim() || `Сделка ${d.id.slice(0, 8)}`;
  const label =
    d.price != null && Number(d.price) > 0
      ? `${name} · ${Math.round(Number(d.price)).toLocaleString('ru-RU')} ₽`
      : name;
  return {
    type: 'deal',
    id: String(d.id),
    label,
    href: `/crm/deals/${d.id}`,
  };
}

export function stashPendingChatEntity(ref: ChatEntityRef): void {
  try {
    sessionStorage.setItem(PENDING_REF_KEY, JSON.stringify(ref));
  } catch {
    /* ignore */
  }
}

export function takePendingChatEntity(): ChatEntityRef | null {
  try {
    const raw = sessionStorage.getItem(PENDING_REF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_REF_KEY);
    const o = JSON.parse(raw) as Partial<ChatEntityRef>;
    if (!o?.type || !o?.id) return null;
    return {
      type: o.type as ChatEntityRefType,
      id: String(o.id),
      label: String(o.label || ''),
      href: String(o.href || ''),
    };
  } catch {
    return null;
  }
}

/** Открыть виджет чата с плашкой сущности (или полный экран подхватит тот же event). */
export function openChatWithEntity(
  ref: ChatEntityRef,
  extra?: { peerId?: string; open?: boolean }
): void {
  window.dispatchEvent(
    new CustomEvent<OpenChatWithEntityDetail>('uchet1-chat-open', {
      detail: {
        ref,
        peerId: extra?.peerId,
        open: extra?.open !== false,
      },
    })
  );
}
