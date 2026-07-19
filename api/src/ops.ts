/**
 * Операционный дашборд Э1 + зеркало «Доход» (локально) + хук СДЭК-виджет.
 */
import { all, get } from './db.js';

function statusLabel(st: string): string {
  const map: Record<string, string> = {
    new: 'Новое',
    picking: 'Сборка',
    packed: 'Упаковано',
    ready: 'К выдаче',
    handed: 'Передано',
    cancelled: 'Отменено',
  };
  return map[st] || st;
}

function channelLabel(ch: string): string {
  const map: Record<string, string> = {
    cdek_prepaid: 'СДЭК предоплата',
    cdek_cod: 'СДЭК наложка',
    dellin: 'Деловые Линии',
    pek: 'ПЭК',
    bus: 'Автобус',
    pickup: 'Самовывоз',
    own_courier: 'Свой курьер',
    ozon: 'Ozon',
    other: 'Прочее',
  };
  return map[ch] || ch || '—';
}

function dealLooksPaid(dealId: string): boolean {
  const paid = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM deal_payments
     WHERE deal_id = ? AND status IN ('paid','confirmed','success','active')`,
    [dealId]
  )?.c;
  if (paid && paid > 0) return true;
  const d = get<{ payment_status?: string; paid?: number }>(
    `SELECT payment_status, paid FROM crm_deals WHERE id = ?`,
    [dealId]
  ) as { payment_status?: string; paid?: number } | undefined;
  if (!d) return false;
  if (Number(d.paid) === 1) return true;
  const ps = String(d.payment_status || '').toLowerCase();
  return ps === 'paid' || ps === 'оплачен' || ps.includes('оплач');
}

export function opsDashboard() {
  const byStatus = all<{ status: string; c: number }>(
    `SELECT status, COUNT(*) AS c FROM warehouse_tasks
     WHERE status != 'cancelled' GROUP BY status`
  );
  const map: Record<string, number> = {};
  for (const r of byStatus) map[r.status] = Number(r.c) || 0;

  const todayHanded =
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM warehouse_tasks
       WHERE status = 'handed' AND date(handed_at) = date('now','localtime')`
    )?.c ?? 0;

  const blocked = all(
    `SELECT id, number, deal_id, city, amount_locked, channel, status
     FROM warehouse_tasks
     WHERE status IN ('new','picking','packed','ready')
       AND payment_required = 1
     ORDER BY datetime(created_at) ASC LIMIT 50`
  ).filter((t) => !dealLooksPaid(String((t as { deal_id: string }).deal_id)));

  const queue = all(
    `SELECT id, number, deal_id, city, buyer_name, channel, status, amount_locked, created_at
     FROM warehouse_tasks
     WHERE status IN ('new','picking','packed','ready')
     ORDER BY
       CASE status WHEN 'ready' THEN 0 WHEN 'packed' THEN 1 WHEN 'picking' THEN 2 ELSE 3 END,
       datetime(created_at) ASC
     LIMIT 30`
  );

  const incomeToday =
    get<{ c: number; s: number }>(
      `SELECT COUNT(*) AS c, IFNULL(SUM(amount),0) AS s FROM income_mirror
       WHERE date(created_at) = date('now','localtime')`
    ) || { c: 0, s: 0 };

  return {
    warehouse: {
      new: map.new || 0,
      picking: map.picking || 0,
      packed: map.packed || 0,
      ready: map.ready || 0,
      handed_today: todayHanded,
      blocked_unpaid: blocked.length,
    },
    blocked,
    queue: queue.map((t) => ({
      ...t,
      status_label: statusLabel(String((t as { status: string }).status)),
      channel_label: channelLabel(String((t as { channel: string }).channel)),
    })),
    income_today: { count: incomeToday.c, sum: incomeToday.s },
    cdek_widget_template:
      process.env.CDEK_WIDGET_URL ||
      'https://widget.pnevmopodveska1.ru/cdek/widget.php?l={lead_id}',
  };
}

export function cdekWidgetUrl(dealId: string): string {
  const tpl =
    process.env.CDEK_WIDGET_URL ||
    'https://widget.pnevmopodveska1.ru/cdek/widget.php?l={lead_id}';
  return tpl
    .replace('{lead_id}', encodeURIComponent(dealId))
    .replace('{deal_id}', encodeURIComponent(dealId));
}

/** Запись в «Доход» отключена: таблицы ведёт 1С, Учёт ничего не льёт. */
export function writeIncomeMirrorFromTask(_taskId: string, _actorId?: string) {
  return null;
}

export function listIncomeMirror(opts: { limit?: number; q?: string }) {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim()}%`;
    where.push(
      `(deal_id LIKE ? OR IFNULL(buyer_name,'') LIKE ? OR IFNULL(track_number,'') LIKE ? OR IFNULL(note,'') LIKE ?)`
    );
    params.push(like, like, like, like);
  }
  const limit = Math.min(200, Math.max(1, opts.limit || 50));
  params.push(limit);
  return all(
    `SELECT * FROM income_mirror
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY datetime(created_at) DESC
     LIMIT ?`,
    params
  );
}
