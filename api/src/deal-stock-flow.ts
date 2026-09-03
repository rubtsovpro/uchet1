/**
 * Поток склада по сделке: резерв СТО/самовывоз, отправка → курьер,
 * возвраты, история, блокировка «Успешно».
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { createDocument, postDocument } from './stock.js';
import {
  buildHandoffReserveMeta,
  buildHandoffShipMeta,
  ensureReserveHandoffComment,
  ensureStoReserveWarehouses,
  isReserveChannelDeal,
  isShipChannelDeal,
  resolvePickSiteForDeal,
  reserveWarehouseForPickSite,
  type PickSiteId,
} from './handoff-reserve.js';
import { notifyAmoCourierDeliveredOnce, notifyAmoWarehousePacked } from './amo-pick-handoff.js';
import { mainWarehouseId, stoWarehouseId, courierWarehouseId } from './supply-chain.js';
import { mappedSuccessStatus } from './amo-settings.js';
import { rawStatusId } from './deals.js';
import { abortOpenProductionForDeal } from './production-jobs.js';

const SUCCESS_NAME_RE = /успешн|реализован/i;
const FAIL_NAME_RE = /не реализован|закрыто и не/i;

const RETURN_META = (dealId: string) => `stock_return_pending:${String(dealId || '').trim()}`;
const FLOW_SNAPSHOT = (dealId: string) => `stock_flow_lines:${String(dealId || '').trim()}`;
const HANDOFF_RETURN_META = (dealId: string) => `handoff_return:${String(dealId || '').trim()}`;

/** Кэш тяжёлых запросов по сделке в рамках одного ответа /pick (список handoffs). */
type DealFlowCache = {
  movedLines: Map<string, DealAlreadyMovedLine[]>;
  transferSums: Map<string, { reserveIn: Map<string, number>; stoOut: Map<string, number> }>;
  goodsLines: Map<string, DealFlowQtyLine[]>;
};
let dealFlowCache: DealFlowCache | null = null;

export function runWithDealFlowCache<T>(fn: () => T): T {
  dealFlowCache = {
    movedLines: new Map(),
    transferSums: new Map(),
    goodsLines: new Map(),
  };
  try {
    return fn();
  } finally {
    dealFlowCache = null;
  }
}

function clearHandoffReturnState(dealId: string): void {
  run(`DELETE FROM meta WHERE key = ?`, [HANDOFF_RETURN_META(dealId)]);
}

export type StockReturnLine = {
  product_id: string;
  qty: number;
  name?: string;
  sku?: string;
  order_item_id?: number;
  /** Где лежит сейчас (СТО / Резерв СТО / Отложено). */
  from_warehouse_id?: string;
  from_warehouse_code?: string;
  from_warehouse_name?: string;
  /** Ячейка, откуда забирать (можно сменить на /pick). */
  from_cell_code?: string;
  /** Откуда брали с основного (подсказка). */
  origin_cell_code?: string;
  origin_label?: string;
  /** Куда класть на Основной (по умолчанию = origin). */
  to_cell_code?: string;
};
export type StockReturnRequest = {
  id: string;
  deal_id: string;
  status: 'pending' | 'done' | 'cancelled';
  reason: string;
  lines: StockReturnLine[];
  order_item_ids?: number[];
  created_at: string;
  completed_at?: string;
  /** Сводка для карточки /pick. */
  from_warehouse_id?: string;
  from_warehouse_code?: string;
  from_warehouse_name?: string;
  route_label?: string;
};

function moscowLabel(): string {
  return new Date().toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}

function readMetaJson<T>(key: string): T | null {
  const row = get<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [key]);
  if (!row?.value) return null;
  try {
    return JSON.parse(String(row.value)) as T;
  } catch {
    return null;
  }
}

function writeMetaJson(key: string, value: unknown): void {
  run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [key, JSON.stringify(value)]);
}

/** Снимок состава заказа после проведённого перемещения на резерв/курьер. */
export function snapshotDealFlowLines(dealId: string): void {
  const id = String(dealId || '').trim();
  if (!id) return;
  const lines = all<{ product_id: string; qty: number; name: string; sku: string }>(
    `SELECT IFNULL(i.product_guid,'') AS product_id, IFNULL(i.qty,0) AS qty,
            IFNULL(NULLIF(TRIM(i.name),''), IFNULL(p.name,'')) AS name,
            IFNULL(NULLIF(TRIM(i.sku),''), IFNULL(p.sku,'')) AS sku
     FROM crm_deal_items i
     LEFT JOIN products p ON p.id = i.product_guid
     WHERE i.deal_id = ? AND IFNULL(p.item_kind,'product') != 'service'
     ORDER BY i.line_no ASC`,
    [id]
  ).filter((l) => String(l.product_id || '').trim() && Number(l.qty) > 0);
  writeMetaJson(FLOW_SNAPSHOT(id), { at: new Date().toISOString(), lines });
}

/**
 * Сколько уже ушло на резерв/курьера по сделке (снимок + проведённые TR/OUT «Передача»).
 * Нужен fallback, если meta-снимок не записался — иначе виджет снова шлёт ту же номенклатуру.
 */
export function movedQtyMapForDeal(dealId: string): Map<string, number> {
  const id = String(dealId || '').trim();
  const map = new Map<string, number>();
  if (!id) return map;

  const snap = readMetaJson<{ lines: StockReturnLine[] }>(FLOW_SNAPSHOT(id));
  for (const prev of snap?.lines || []) {
    const pid = String(prev.product_id || '').trim();
    if (!pid) continue;
    map.set(pid, Math.max(map.get(pid) || 0, Math.max(0, Number(prev.qty) || 0)));
  }

  const posted = all<{ product_id: string; qty: number }>(
    `SELECT IFNULL(l.product_id,'') AS product_id, IFNULL(SUM(l.qty),0) AS qty
     FROM stock_doc_lines l
     INNER JOIN stock_docs d ON d.id = l.doc_id
     WHERE d.deal_id = ?
       AND IFNULL(d.posted,0) = 1
       AND (
         (d.doc_type = 'transfer' AND (
            IFNULL(d.comment,'') LIKE '%Передача на склад%'
            OR IFNULL(d.comment,'') LIKE '%Склад ГОТОВО%'
            OR IFNULL(d.comment,'') LIKE '%на курьера%'
            OR IFNULL(d.comment,'') LIKE '%зарезервир%'
            OR IFNULL(d.comment,'') LIKE '%СРОЧНО на СТО%'
         ))
         OR (d.doc_type = 'out' AND IFNULL(d.comment,'') LIKE '%Передача на склад%'
             AND IFNULL(d.comment,'') LIKE '%ГОТОВО%')
       )
       -- только «Основной → резерв/курьер/СТО», не спуск Резерв→СТО и не возврат
       AND IFNULL(d.comment,'') NOT LIKE '%Спуск на СТО%'
       AND IFNULL(d.comment,'') NOT LIKE '%Возврат на основной%'
       AND IFNULL(d.comment,'') NOT LIKE '%Списание по продаже%'
     GROUP BY l.product_id`,
    [id]
  );
  for (const row of posted) {
    const pid = String(row.product_id || '').trim();
    if (!pid) continue;
    map.set(pid, Math.max(map.get(pid) || 0, Math.max(0, Number(row.qty) || 0)));
  }

  // Открытые задания /pick (в т.ч. СРОЧНО) — тоже «уже занято», иначе второй клик
  // «→ Резерв» списывает с Основного ту же qty параллельно.
  const pending = all<{ product_id: string; qty: number }>(
    `SELECT IFNULL(l.product_id,'') AS product_id, IFNULL(SUM(l.qty),0) AS qty
     FROM stock_doc_lines l
     INNER JOIN stock_docs d ON d.id = l.doc_id
     WHERE d.deal_id = ?
       AND IFNULL(d.posted,0) = 0
       AND d.doc_type = 'out'
       AND IFNULL(d.comment,'') LIKE '%Передача на склад%'
       AND IFNULL(d.comment,'') NOT LIKE '%Спуск на СТО%'
       AND IFNULL(d.comment,'') NOT LIKE '%Возврат на основной%'
       AND IFNULL(d.comment,'') NOT LIKE '%Списание по продаже%'
     GROUP BY l.product_id`,
    [id]
  );
  for (const row of pending) {
    const pid = String(row.product_id || '').trim();
    if (!pid) continue;
    map.set(pid, (map.get(pid) || 0) + Math.max(0, Number(row.qty) || 0));
  }

  return map;
}

export type DealMovedLineStage = {
  label: string;
  qty: number;
  doc_id: string;
  doc_number: string;
  route: string;
  cell_code: string;
  moved_at: string;
};

function formatDealMovedAt(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return s.slice(0, 16);
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow',
    });
  } catch {
    return s.slice(0, 16);
  }
}

export type DealAlreadyMovedLine = {
  product_id: string;
  sku: string;
  name: string;
  qty_total: number;
  stages: DealMovedLineStage[];
};

export type DealAlreadyMovedBriefRow = {
  product_id: string;
  sku: string;
  name: string;
  qty: number;
  current_label: string;
  doc_number: string;
  moved_at: string;
  route: string;
  cell_code: string;
};

/** Одна строка на SKU: последнее перемещение и текущий статус (без всей истории). */
export function compactDealAlreadyMovedSummary(
  lines: DealAlreadyMovedLine[],
  opts?: { excludeDocId?: string }
): DealAlreadyMovedBriefRow[] {
  const excludeId = String(opts?.excludeDocId || '').trim();
  const rows: DealAlreadyMovedBriefRow[] = [];
  for (const l of lines) {
    const stages = (l.stages || []).filter(
      (s) => !(excludeId && String(s.doc_id || '') === excludeId)
    );
    if (!stages.length) continue;
    const last = stages[stages.length - 1]!;
    rows.push({
      product_id: String(l.product_id || ''),
      sku: String(l.sku || ''),
      name: String(l.name || ''),
      qty: Number(last.qty) || 0,
      current_label: String(last.label || ''),
      doc_number: String(last.doc_number || ''),
      moved_at: String(last.moved_at || ''),
      route: String(last.route || ''),
      cell_code: String(last.cell_code || ''),
    });
  }
  return rows;
}

/** Короткие строки для UI/печати — группирует одинаковый статус. */
export function buildAlreadyMovedBriefLines(
  lines: DealAlreadyMovedLine[],
  opts?: { excludeDocId?: string }
): string[] {
  const rows = compactDealAlreadyMovedSummary(lines, opts);
  if (!rows.length) return [];
  const groups = new Map<string, DealAlreadyMovedBriefRow[]>();
  for (const r of rows) {
    const key = [r.current_label, r.doc_number, r.moved_at, r.cell_code, r.route].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const out: string[] = [];
  for (const items of groups.values()) {
    const r = items[0]!;
    const cell = r.cell_code ? ` · яч. ${r.cell_code}` : '';
    const when = r.moved_at ? ` · ${r.moved_at}` : '';
    const doc = r.doc_number ? ` · ${r.doc_number}` : '';
    if (items.length === 1) {
      const sku = r.sku ? `${r.sku} — ` : '';
      out.push(`${sku}сейчас: ${r.current_label}${doc}${when}${cell}`);
    } else {
      out.push(`${items.length} поз. — сейчас: ${r.current_label}${doc}${when}${cell}`);
    }
  }
  return out;
}

export type HandoffRouteKind = 'main_to_reserve' | 'reserve_to_sto';

/** Код буфера сделки: «Резерв СТО» (STO-RSV) или «Отложено» (STO-RES). */
function isDealReserveWhCode(code: string): boolean {
  const c = String(code || '').trim().toUpperCase();
  return /^STO-RSV/.test(c) || /^STO-RES/.test(c);
}

export function handoffRouteKindFromDoc(input: {
  comment?: string;
  from_code?: string;
  to_code?: string;
  is_to_sto?: boolean;
}): HandoffRouteKind | null {
  const comment = String(input.comment || '');
  const fromCode = String(input.from_code || '').trim().toUpperCase();
  const toCode = String(input.to_code || '').trim().toUpperCase();
  if (/Спуск на СТО/i.test(comment) || input.is_to_sto) return 'reserve_to_sto';
  if (isDealReserveWhCode(fromCode) && toCode === 'STO') return 'reserve_to_sto';
  if (isDealReserveWhCode(toCode) && !/Спуск на СТО/i.test(comment)) return 'main_to_reserve';
  return null;
}

function isHandoffDocBefore(docId: string, beforeDocId: string): boolean {
  const did = String(docId || '').trim();
  const beforeId = String(beforeDocId || '').trim();
  if (!did || !beforeId || did === beforeId) return false;
  const doc = get<{ created_at: string; number: string }>(
    `SELECT IFNULL(created_at,'') AS created_at, IFNULL(number,'') AS number FROM stock_docs WHERE id = ?`,
    [did]
  );
  const anchor = get<{ created_at: string; number: string }>(
    `SELECT IFNULL(created_at,'') AS created_at, IFNULL(number,'') AS number FROM stock_docs WHERE id = ?`,
    [beforeId]
  );
  if (!doc?.created_at || !anchor?.created_at) return false;
  const ta = String(doc.created_at);
  const tb = String(anchor.created_at);
  if (ta < tb) return true;
  if (ta > tb) return false;
  return String(doc.number) < String(anchor.number);
}

/** Позиции заказа, которые на этом маршруте уже прошли — переносить не нужно. */
export function dealSkipLinesOnRoute(
  dealId: string,
  route: HandoffRouteKind,
  opts?: { excludeProductIds?: Set<string> | string[]; beforeDocId?: string }
): DealAlreadyMovedBriefRow[] {
  const id = String(dealId || '').trim();
  if (!id) return [];
  const exclude = new Set(
    (opts?.excludeProductIds instanceof Set
      ? [...opts.excludeProductIds]
      : opts?.excludeProductIds || []
    ).map((x) => String(x || '').trim()).filter(Boolean)
  );
  const { reserveIn, stoOut } = dealHandoffTransferSums(id, { beforeDocId: opts?.beforeDocId });
  const allLines = getDealAlreadyMovedLines(id);
  const out: DealAlreadyMovedBriefRow[] = [];

  // Сумма по SKU: заказ 2×1 и TR на 1 → «уже отгружено» только 1, не две галочки.
  for (const item of dealGoodsQtyAggregated(id)) {
    const pid = String(item.product_id || '').trim();
    const need = Math.max(0, Number(item.qty) || 0);
    if (!pid || !need) continue;
    if (exclude.has(pid)) continue;

    const covered =
      route === 'main_to_reserve'
        ? Math.min(need, Math.max(0, reserveIn.get(pid) || 0))
        : Math.min(need, Math.max(0, stoOut.get(pid) || 0));
    if (!(covered > 0)) continue;

    const line = allLines.find((l) => l.product_id === pid);
    if (!line) continue;
    const beforeId = String(opts?.beforeDocId || '').trim();
    const routeStages = line.stages.filter((s) => {
      const okLabel = route === 'main_to_reserve' ? s.label === 'На резерве' : s.label === 'На СТО';
      if (!okLabel) return false;
      if (beforeId && !isHandoffDocBefore(String(s.doc_id || ''), beforeId)) return false;
      return true;
    });
    const last = routeStages[routeStages.length - 1];
    if (!last) continue;

    let cellCode = String(last.cell_code || '');
    if (route === 'reserve_to_sto' && !cellCode) {
      const reserveStage = line.stages.filter((s) => s.label === 'На резерве').pop();
      if (reserveStage?.cell_code) cellCode = String(reserveStage.cell_code);
    }

    out.push({
      product_id: pid,
      sku: String(item.sku || ''),
      name: String(item.name || ''),
      qty: covered,
      current_label: String(last.label || ''),
      doc_number: String(last.doc_number || ''),
      moved_at: String(last.moved_at || ''),
      route: String(last.route || ''),
      cell_code: cellCode,
    });
  }
  return out;
}

/** Коротко: сделка + маршрут + что не переносить повторно. */
export function buildHandoffRouteBrief(
  dealId: string,
  route: HandoffRouteKind,
  opts?: {
    routeLabel?: string;
    docNumber?: string;
    excludeProductIds?: Set<string> | string[];
    beforeDocId?: string;
  }
): string[] {
  const id = String(dealId || '').trim();
  const skip = dealSkipLinesOnRoute(id, route, {
    excludeProductIds: opts?.excludeProductIds,
    beforeDocId: opts?.beforeDocId,
  });
  if (!skip.length) return [];

  const routeName =
    String(opts?.routeLabel || '').trim() ||
    (route === 'main_to_reserve'
      ? 'Основной → Резерв СТО'
      : 'Резерв СТО → СТО');
  const docHint = String(opts?.docNumber || '').trim();
  const lines: string[] = [
    `Сделка ${id} · ${routeName}${docHint ? ` · ниже ${docHint}` : ''}`,
  ];

  const groups = new Map<string, DealAlreadyMovedBriefRow[]>();
  for (const r of skip) {
    const key = [r.doc_number, r.moved_at, r.current_label, r.cell_code].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  for (const items of groups.values()) {
    const r = items[0]!;
    const cell = r.cell_code ? ` · яч. ${r.cell_code}` : '';
    const when = r.moved_at ? ` · ${r.moved_at}` : '';
    const doc = r.doc_number ? ` · ${r.doc_number}` : '';
    if (items.length === 1) {
      lines.push(`${r.sku} — не переносить · уже ${r.current_label}${doc}${when}${cell}`);
    } else {
      const skus = items.map((i) => i.sku).filter(Boolean).join(', ');
      lines.push(
        `${items.length} поз. — не переносить · уже ${r.current_label}${doc}${when}${cell}${
          skus ? ` (${skus})` : ''
        }`
      );
    }
  }
  return lines;
}

/** Ячейка, с которой собрали/спустили в этом документе. */
export function handoffLineDoneCell(
  dealId: string,
  docId: string,
  productId: string,
  route: HandoffRouteKind,
  docComment?: string,
  movedLines?: DealAlreadyMovedLine[]
): string {
  const pid = String(productId || '').trim();
  const did = String(docId || '').trim();
  if (!pid || !did) return '';
  const line = (movedLines || getDealAlreadyMovedLines(dealId)).find((l) => l.product_id === pid);
  const stage = line?.stages.find((s) => s.doc_id === did);
  if (stage?.cell_code) return String(stage.cell_code);
  const docCell = parseCellFromDocComment(String(docComment || ''));
  if (docCell) return docCell;
  if (route === 'reserve_to_sto') {
    const reserveStage = line?.stages.filter((s) => s.label === 'На резерве').pop();
    return String(reserveStage?.cell_code || '');
  }
  return '';
}

export function parseCellFromDocComment(comment: string): string {
  const m = String(comment || '').match(
    /яч[.:]\s*([A-Za-zА-ЯЁ]\d*(?:\.[\dA-Za-z]+)?)/iu
  );
  if (!m?.[1]) return '';
  return String(m[1]).trim().replace(/^А/u, 'A').replace(/^а/u, 'A');
}

function classifyPostedHandoffDoc(row: {
  doc_type: string;
  comment: string;
  from_name: string;
  from_code: string;
  to_name: string;
  to_code: string;
}): { label: string; route: string } {
  const comment = String(row.comment || '');
  const from = String(row.from_name || row.from_code || '').trim() || '—';
  const to = String(row.to_name || row.to_code || '').trim() || '—';
  const toCode = String(row.to_code || '').trim().toUpperCase();
  if (/Возврат на основной/i.test(comment) || (/^НФ-|^MAIN$/i.test(toCode) && isDealReserveWhCode(String(row.from_code || '')))) {
    return { label: 'На основной', route: `${from} → ${to}` };
  }
  if (/Спуск на СТО/i.test(comment) || toCode === 'STO') {
    return { label: 'На СТО', route: `${from} → ${to}` };
  }
  if (isDealReserveWhCode(toCode) || /резерв|отложено/i.test(to)) {
    return { label: 'На резерве', route: `${from} → ${to}` };
  }
  if (row.doc_type === 'out' && /продаж|реализован/i.test(comment)) {
    return { label: 'Реализовано', route: from };
  }
  return { label: 'Перемещено', route: `${from} → ${to}` };
}

/** Уже проведённые перемещения по сделке — для дозаказа и подсказок на /pick. */
export function getDealAlreadyMovedLines(dealId: string): DealAlreadyMovedLine[] {
  const id = String(dealId || '').trim();
  if (!id) return [];
  const cached = dealFlowCache?.movedLines.get(id);
  if (cached) return cached;
  const rows = all<{
    product_id: string;
    qty: number;
    sku: string;
    name: string;
    doc_id: string;
    number: string;
    comment: string;
    doc_type: string;
    from_name: string;
    from_code: string;
    to_name: string;
    to_code: string;
    created_at: string;
  }>(
    `SELECT l.product_id, SUM(l.qty) AS qty,
            IFNULL(p.sku,'') AS sku, IFNULL(p.name,'') AS name,
            d.id AS doc_id, d.number, IFNULL(d.comment,'') AS comment, d.doc_type,
            IFNULL(wf.name,'') AS from_name, IFNULL(wf.code,'') AS from_code,
            IFNULL(wt.name,'') AS to_name, IFNULL(wt.code,'') AS to_code,
            IFNULL(d.created_at,'') AS created_at
     FROM stock_doc_lines l
     INNER JOIN stock_docs d ON d.id = l.doc_id
     LEFT JOIN products p ON p.id = l.product_id
     LEFT JOIN warehouses wf ON wf.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     WHERE d.deal_id = ?
       AND IFNULL(d.posted,0) = 1
       AND (
         (d.doc_type = 'transfer' AND (
            IFNULL(d.comment,'') LIKE '%Передача на склад%'
            OR IFNULL(d.comment,'') LIKE '%Склад ГОТОВО%'
            OR IFNULL(d.comment,'') LIKE '%Спуск на СТО%'
            OR IFNULL(d.comment,'') LIKE '%Возврат на основной%'
         ))
         OR (d.doc_type = 'out' AND IFNULL(d.comment,'') LIKE '%Передача на склад%'
             AND IFNULL(d.comment,'') LIKE '%ГОТОВО%')
       )
     GROUP BY l.product_id, d.id
     ORDER BY datetime(d.created_at) ASC, d.number ASC`,
    [id]
  );
  const byProduct = new Map<string, DealAlreadyMovedLine>();
  for (const row of rows) {
    const pid = String(row.product_id || '').trim();
    const qty = Number(row.qty) || 0;
    if (!pid || !(qty > 0)) continue;
    const { label, route } = classifyPostedHandoffDoc(row);
    const cell = parseCellFromDocComment(row.comment);
    if (!byProduct.has(pid)) {
      byProduct.set(pid, {
        product_id: pid,
        sku: String(row.sku || ''),
        name: String(row.name || ''),
        qty_total: 0,
        stages: [],
      });
    }
    const entry = byProduct.get(pid)!;
    entry.qty_total += qty;
    entry.stages.push({
      label,
      qty,
      doc_id: String(row.doc_id || ''),
      doc_number: String(row.number || ''),
      route,
      cell_code: cell,
      moved_at: formatDealMovedAt(String(row.created_at || '')),
    });
  }
  const result = [...byProduct.values()].filter((l) => l.qty_total > 0);
  dealFlowCache?.movedLines.set(id, result);
  return result;
}

type DealFlowQtyLine = { product_id: string; qty: number; name: string; sku: string };

/** Суммы перемещений по сделке (не общий остаток склада — резерв общий на все заказы). */
function dealHandoffTransferSums(
  dealId: string,
  opts?: { beforeDocId?: string }
): {
  reserveIn: Map<string, number>;
  stoOut: Map<string, number>;
} {
  const id = String(dealId || '').trim();
  const reserveIn = new Map<string, number>();
  const stoOut = new Map<string, number>();
  if (!id) return { reserveIn, stoOut };

  const beforeId = String(opts?.beforeDocId || '').trim();
  const cacheKey = `${id}\0${beforeId}`;
  const cached = dealFlowCache?.transferSums.get(cacheKey);
  if (cached) return cached;
  let beforeSql = '';
  const beforeParams: string[] = [];
  if (beforeId) {
    const anchor = get<{ created_at: string; number: string }>(
      `SELECT IFNULL(created_at,'') AS created_at, IFNULL(number,'') AS number FROM stock_docs WHERE id = ?`,
      [beforeId]
    );
    if (anchor?.created_at) {
      beforeSql = ` AND (
        datetime(d.created_at) < datetime(?)
        OR (datetime(d.created_at) = datetime(?) AND d.number < ?)
      )`;
      beforeParams.push(String(anchor.created_at), String(anchor.created_at), String(anchor.number));
    }
  }

  const rows = all<{
    product_id: string;
    qty: number;
    comment: string;
    from_code: string;
    to_code: string;
  }>(
    `SELECT IFNULL(l.product_id,'') AS product_id, IFNULL(l.qty,0) AS qty,
            IFNULL(d.comment,'') AS comment,
            IFNULL(wf.code,'') AS from_code, IFNULL(wt.code,'') AS to_code
     FROM stock_doc_lines l
     INNER JOIN stock_docs d ON d.id = l.doc_id
     LEFT JOIN warehouses wf ON wf.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     WHERE d.deal_id = ?
       AND IFNULL(d.posted,0) = 1
       AND d.doc_type = 'transfer'
       AND IFNULL(d.comment,'') LIKE '%Передача на склад%'${beforeSql}`,
    [id, ...beforeParams]
  );

  for (const row of rows) {
    const pid = String(row.product_id || '').trim();
    const qty = Number(row.qty) || 0;
    if (!pid || !(qty > 0)) continue;
    const comment = String(row.comment || '');
    const fromCode = String(row.from_code || '').trim().toUpperCase();
    const toCode = String(row.to_code || '').trim().toUpperCase();
    const isStoDescent =
      /Спуск на СТО|СРОЧНО на СТО/i.test(comment) ||
      (isDealReserveWhCode(fromCode) && toCode === 'STO') ||
      (toCode === 'STO' && /СРОЧНО/i.test(comment));
    const isReserveIn =
      isDealReserveWhCode(toCode) &&
      !/Спуск на СТО|СРОЧНО на СТО/i.test(comment);
    if (isStoDescent) {
      stoOut.set(pid, (stoOut.get(pid) || 0) + qty);
    } else if (isReserveIn) {
      reserveIn.set(pid, (reserveIn.get(pid) || 0) + qty);
    }
  }
  const result = { reserveIn, stoOut };
  dealFlowCache?.transferSums.set(cacheKey, result);
  return result;
}

function dealGoodsLines(dealId: string): DealFlowQtyLine[] {
  const id = String(dealId || '').trim();
  if (!id) return [];
  const cached = dealFlowCache?.goodsLines.get(id);
  if (cached) return cached;
  const rows = all<DealFlowQtyLine>(
    `SELECT IFNULL(i.product_guid,'') AS product_id, IFNULL(i.qty,0) AS qty,
            IFNULL(i.name,'') AS name, IFNULL(i.sku,'') AS sku
     FROM crm_deal_items i
     LEFT JOIN products p ON p.id = i.product_guid
     WHERE i.deal_id = ? AND IFNULL(p.item_kind,'product') != 'service'
       AND IFNULL(i.product_guid,'') != '' AND IFNULL(i.qty,0) > 0
     ORDER BY i.line_no ASC`,
    [id]
  );
  dealFlowCache?.goodsLines.set(id, rows);
  return rows;
}

/**
 * Несколько строк заказа с одним product_id (две «левые» по 1 шт) → одна сумма.
 * Иначе дозаказ/«уже отгружено» сравнивают каждую строку с общим TR и дублируют ✓.
 */
function dealGoodsQtyAggregated(dealId: string): DealFlowQtyLine[] {
  const map = new Map<string, DealFlowQtyLine>();
  for (const item of dealGoodsLines(dealId)) {
    const pid = String(item.product_id || '').trim();
    if (!pid) continue;
    const qty = Math.max(0, Number(item.qty) || 0);
    if (!(qty > 0)) continue;
    const prev = map.get(pid);
    if (prev) {
      prev.qty += qty;
    } else {
      map.set(pid, {
        product_id: pid,
        qty,
        name: String(item.name || ''),
        sku: String(item.sku || ''),
      });
    }
  }
  return [...map.values()];
}

/** Сумма qty по product_id из сырых строк заказа (crm / handoff). */
function aggregateProductQtyLines<
  T extends { product_id?: string; product_guid?: string; qty?: number; name?: string; sku?: string; price?: number }
>(
  rows: T[]
): Array<{ product_id: string; qty: number; name: string; sku: string; price: number }> {
  const map = new Map<
    string,
    { product_id: string; qty: number; name: string; sku: string; price: number }
  >();
  for (const r of rows) {
    const pid = String(r.product_id || r.product_guid || '').trim();
    if (!pid) continue;
    const qty = Math.max(0, Number(r.qty) || 0);
    if (!(qty > 0)) continue;
    const prev = map.get(pid);
    if (prev) {
      prev.qty += qty;
      if (!prev.name && r.name) prev.name = String(r.name);
      if (!prev.sku && r.sku) prev.sku = String(r.sku);
      if (!(prev.price > 0) && Number(r.price) > 0) prev.price = Number(r.price);
    } else {
      map.set(pid, {
        product_id: pid,
        qty,
        name: String(r.name || ''),
        sku: String(r.sku || ''),
        price: Math.max(0, Number(r.price) || 0),
      });
    }
  }
  return [...map.values()];
}

/** Сколько по сделке ещё ждёт спуска Резерв → СТО (по проведённым TR, не stock_balances). */
export function dealReservePendingToStoLines(dealId: string): DealFlowQtyLine[] {
  const id = String(dealId || '').trim();
  if (!id) return [];
  const { reserveIn, stoOut } = dealHandoffTransferSums(id);
  const pending: DealFlowQtyLine[] = [];
  for (const item of dealGoodsQtyAggregated(id)) {
    const pid = String(item.product_id || '').trim();
    const need = Math.max(0, Number(item.qty) || 0);
    const onReserve = Math.max(0, (reserveIn.get(pid) || 0) - (stoOut.get(pid) || 0));
    const qty = Math.min(need, onReserve);
    if (qty > 0) {
      pending.push({
        product_id: pid,
        qty,
        name: String(item.name || ''),
        sku: String(item.sku || ''),
      });
    }
  }
  return pending;
}

/** Сколько по сделке уже спущено на СТО (по проведённым TR). */
export function dealOnStoLines(dealId: string): DealFlowQtyLine[] {
  const id = String(dealId || '').trim();
  if (!id) return [];
  const { stoOut } = dealHandoffTransferSums(id);
  const onSto: DealFlowQtyLine[] = [];
  for (const item of dealGoodsQtyAggregated(id)) {
    const pid = String(item.product_id || '').trim();
    const need = Math.max(0, Number(item.qty) || 0);
    const qty = Math.min(need, Math.max(0, stoOut.get(pid) || 0));
    if (qty > 0) {
      onSto.push({
        product_id: pid,
        qty,
        name: String(item.name || ''),
        sku: String(item.sku || ''),
      });
    }
  }
  return onSto;
}

/** Позиции, которых не было в снимке после прошлого «Готово» (дозаказ). */
export function detectAddedFlowLines(dealId: string): StockReturnLine[] {
  const id = String(dealId || '').trim();
  const snapQty = movedQtyMapForDeal(id);
  // Без прошлого перемещения это первый заказ, не дозаказ.
  if (snapQty.size === 0) return [];
  const added: StockReturnLine[] = [];
  for (const item of dealGoodsQtyAggregated(id)) {
    const pid = String(item.product_id || '').trim();
    if (!pid) continue;
    const now = Math.max(0, Number(item.qty) || 0);
    const was = snapQty.get(pid) ?? 0;
    if (now > was) {
      added.push({
        product_id: pid,
        qty: now - was,
        name: item.name,
        sku: item.sku,
      });
    }
  }
  return added;
}

function cellBalanceForProduct(warehouseId: string, productId: string): string {
  const wh = String(warehouseId || '').trim();
  const pid = String(productId || '').trim();
  if (!wh || !pid) return '';
  const row = get<{ cell_code: string }>(
    `SELECT IFNULL(c.code,'') AS cell_code
     FROM stock_cell_balances b
     JOIN warehouse_cells c ON c.id = b.cell_id
     WHERE b.warehouse_id = ? AND b.product_id = ? AND b.qty > 0
     ORDER BY b.qty DESC, c.code ASC
     LIMIT 1`,
    [wh, pid]
  );
  return String(row?.cell_code || '').trim();
}

/** Где лежит позиция сделки сейчас + откуда брали (для возврата на основной). */
export function enrichStockReturnLineLocation(
  dealId: string,
  line: StockReturnLine
): StockReturnLine {
  const id = String(dealId || '').trim();
  const pid = String(line.product_id || '').trim();
  if (!id || !pid) return line;

  const stoWh = stoWarehouseId();
  const site = resolvePickSiteForDeal(id);
  const rsvWh = reserveWarehouseForPickSite(site);
  const holdWh =
    get<{ id: string; code: string; name: string }>(
      `SELECT id, IFNULL(code,'') AS code, IFNULL(name,'') AS name
       FROM warehouses WHERE code = 'STO-RES-MSK' AND IFNULL(is_active,1)=1 LIMIT 1`
    ) || null;

  const candidates: Array<{ id: string; code: string; name: string; priority: number }> = [];
  if (stoWh) {
    const sto = get<{ code: string; name: string }>(
      `SELECT IFNULL(code,'') AS code, IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
      [stoWh]
    );
    candidates.push({
      id: stoWh,
      code: String(sto?.code || 'STO'),
      name: String(sto?.name || 'СТО'),
      priority: 1,
    });
  }
  if (rsvWh?.id) {
    candidates.push({
      id: rsvWh.id,
      code: String(rsvWh.code || 'STO-RSV-MSK'),
      name: String(rsvWh.name || 'Резерв СТО'),
      priority: 2,
    });
  }
  if (holdWh?.id) {
    candidates.push({
      id: String(holdWh.id),
      code: String(holdWh.code || 'STO-RES-MSK'),
      name: String(holdWh.name || 'Отложено под СТО'),
      priority: 3,
    });
  }

  let from:
    | { id: string; code: string; name: string; priority: number }
    | null = null;

  const pickWithBalance = (
    ids: Array<string | undefined | null>
  ): (typeof candidates)[0] | null => {
    for (const wid of ids) {
      const idStr = String(wid || '').trim();
      if (!idStr) continue;
      const c = candidates.find((x) => x.id === idStr);
      if (!c) continue;
      if (productQtyOnWarehouse(pid, c.id) > 0) return c;
    }
    return null;
  };

  // Сначала по истории сделки (не общий остаток SKU на СТО от чужих заказов)
  const onStoQty = dealOnStoLines(id).find((l) => l.product_id === pid);
  const onRsvQty = dealReservePendingToStoLines(id).find((l) => l.product_id === pid);
  if (onStoQty && stoWh && productQtyOnWarehouse(pid, stoWh) > 0) {
    from = candidates.find((c) => c.id === stoWh) || null;
  } else if (onRsvQty) {
    // «На резерве» в истории — фактически может лежать на Отложено (STO-RES)
    from = pickWithBalance([holdWh?.id, rsvWh?.id]) || pickWithBalance([rsvWh?.id, holdWh?.id]);
  }
  // Позицию уже убрали из заказа — смотрим историю перемещений / остаток + TR сделки
  if (!from) {
    const movedHint = getDealAlreadyMovedLines(id).find((l) => l.product_id === pid);
    const last = [...(movedHint?.stages || [])].reverse()[0];
    if (last?.label === 'На СТО' && stoWh && productQtyOnWarehouse(pid, stoWh) > 0) {
      from = candidates.find((c) => c.id === stoWh) || null;
    } else if (last?.label === 'На резерве') {
      from = pickWithBalance([holdWh?.id, rsvWh?.id]) || pickWithBalance([rsvWh?.id, holdWh?.id]);
    }
  }
  if (!from) {
    // Сначала склады, где реально есть qty (Отложено важнее пустого Резерва)
    for (const c of [...candidates].sort((a, b) => {
      const qa = productQtyOnWarehouse(pid, a.id) > 0 ? 0 : 1;
      const qb = productQtyOnWarehouse(pid, b.id) > 0 ? 0 : 1;
      if (qa !== qb) return qa - qb;
      return a.priority - b.priority;
    })) {
      const bal = productQtyOnWarehouse(pid, c.id);
      if (!(bal > 0)) continue;
      // Подтверждаем, что по сделке был приход на этот склад ИЛИ соседний RSV/RES
      const hit = get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM stock_docs d
         JOIN stock_doc_lines l ON l.doc_id = d.id
         WHERE d.deal_id = ? AND l.product_id = ?
           AND IFNULL(d.posted,0) = 1
           AND (
             d.warehouse_to_id = ?
             OR (
               ? IN (
                 SELECT id FROM warehouses
                 WHERE UPPER(IFNULL(code,'')) LIKE 'STO-RSV%'
                    OR UPPER(IFNULL(code,'')) LIKE 'STO-RES%'
               )
               AND d.warehouse_to_id IN (
                 SELECT id FROM warehouses
                 WHERE UPPER(IFNULL(code,'')) LIKE 'STO-RSV%'
                    OR UPPER(IFNULL(code,'')) LIKE 'STO-RES%'
               )
             )
           )`,
        [id, pid, c.id, c.id]
      );
      if (Number(hit?.c) > 0) {
        from = c;
        break;
      }
    }
  }

  const moved = getDealAlreadyMovedLines(id).find((l) => l.product_id === pid);
  const reserveStage = [...(moved?.stages || [])].reverse().find((s) => s.label === 'На резерве');
  const stoStage = [...(moved?.stages || [])].reverse().find((s) => s.label === 'На СТО');
  const originStage = (moved?.stages || []).find((s) => s.label === 'На резерве') || reserveStage;

  let fromCell = String(line.from_cell_code || '').trim();
  if (!fromCell && from) {
    if (from.code.toUpperCase() === 'STO' && stoStage?.cell_code) fromCell = stoStage.cell_code;
    else if (reserveStage?.cell_code) fromCell = reserveStage.cell_code;
    if (!fromCell) fromCell = cellBalanceForProduct(from.id, pid);
  }

  const originCell =
    String(line.origin_cell_code || '').trim() ||
    String(originStage?.cell_code || '').trim() ||
    '';
  const originLabel =
    String(line.origin_label || '').trim() ||
    (originStage
      ? `${originStage.route || 'Основной → Резерв'}${
          originStage.cell_code ? ` · яч. ${originStage.cell_code}` : ''
        }`
      : 'Основной');

  const toCell =
    String(line.to_cell_code || '').trim() || originCell || fromCell || '';

  return {
    ...line,
    from_warehouse_id: from?.id || line.from_warehouse_id || '',
    from_warehouse_code: from?.code || line.from_warehouse_code || '',
    from_warehouse_name: from?.name || line.from_warehouse_name || '',
    from_cell_code: fromCell,
    origin_cell_code: originCell,
    origin_label: originLabel,
    to_cell_code: toCell,
  };
}

/** Название и артикул для строк возврата (виджет /pick, приходная). */
function enrichStockReturnLineProductInfo(
  dealId: string,
  line: StockReturnLine
): StockReturnLine {
  const pid = String(line.product_id || '').trim();
  if (!pid) return line;
  let name = String(line.name || '').trim();
  let sku = String(line.sku || '').trim();

  // Артикул всегда от product_id в каталоге: в заказе часто висит чужой OEM/текст,
  // а остаток и возврат идут по guid (как 9Y… vs MRAA21113 на одной пневмостойке).
  const fromProducts = get<{ name: string; sku: string; code: string }>(
    `SELECT IFNULL(name,'') AS name, IFNULL(sku,'') AS sku, IFNULL(code,'') AS code
     FROM products WHERE id = ?`,
    [pid]
  );
  if (fromProducts) {
    const catalogSku = String(fromProducts.sku || '').trim();
    const catalogName = String(fromProducts.name || '').trim();
    if (catalogSku) sku = catalogSku;
    if (catalogName) name = catalogName;
  }

  const id = String(dealId || '').trim();
  if (id && (!name || !sku)) {
    const fromDeal = get<{ name: string; sku: string }>(
      `SELECT IFNULL(NULLIF(TRIM(i.name),''), IFNULL(p.name,'')) AS name,
              IFNULL(NULLIF(TRIM(p.sku),''), IFNULL(NULLIF(TRIM(i.sku),''), '')) AS sku
       FROM crm_deal_items i
       LEFT JOIN products p ON p.id = i.product_guid
       WHERE i.deal_id = ? AND i.product_guid = ?
       LIMIT 1`,
      [id, pid]
    );
    if (fromDeal) {
      if (!name) name = String(fromDeal.name || '').trim();
      if (!sku) sku = String(fromDeal.sku || '').trim();
    }
  }

  return {
    ...line,
    ...(name ? { name } : {}),
    ...(sku ? { sku } : {}),
  };
}

function summarizeReturnRequest(req: StockReturnRequest): StockReturnRequest {
  const lines = (req.lines || []).map((l) =>
    enrichStockReturnLineLocation(
      req.deal_id,
      enrichStockReturnLineProductInfo(req.deal_id, l)
    )
  );
  const primary =
    lines.find((l) => l.from_warehouse_id) || lines[0] || null;
  const fromName = String(primary?.from_warehouse_name || '').trim() || 'Резерв/СТО';
  return {
    ...req,
    lines,
    from_warehouse_id: primary?.from_warehouse_id || req.from_warehouse_id,
    from_warehouse_code: primary?.from_warehouse_code || req.from_warehouse_code,
    from_warehouse_name: fromName,
    route_label: `${fromName} → Основной`,
  };
}

/** Все открытые требования возврата (для /pick). */
export function listPendingStockReturns(limit = 60): Array<Record<string, unknown>> {
  const rows = all<{ key: string; value: string }>(
    `SELECT key, value FROM meta WHERE key LIKE 'stock_return_pending:%' ORDER BY key DESC LIMIT ?`,
    [Math.min(200, Math.max(1, limit * 3))]
  );
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    try {
      const raw = JSON.parse(String(row.value || '')) as StockReturnRequest;
      if (!raw || raw.status !== 'pending') continue;
      const req = summarizeReturnRequest(raw);
      // Подтянуть свежие ячейки/склад в meta (без смены статуса)
      try {
        writeMetaJson(RETURN_META(String(req.deal_id)), req);
      } catch {
        /* ignore */
      }
      const deal = get<{ name: string; buyer_name: string; amo_channel: string }>(
        `SELECT IFNULL(name,'') AS name, IFNULL(buyer_name,'') AS buyer_name,
                IFNULL(amo_channel,'') AS amo_channel
         FROM crm_deals WHERE id = ?`,
        [String(req.deal_id)]
      );
      out.push({
        ...req,
        deal_id: String(req.deal_id || ''),
        lines_count: (req.lines || []).length,
        qty_sum: (req.lines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0),
        deal: deal
          ? {
              deal_id: String(req.deal_id),
              title: String(deal.name || '').replace(/\s+/g, ' ').trim(),
              buyer_name: String(deal.buyer_name || ''),
              amo_channel: String(deal.amo_channel || ''),
            }
          : null,
        complete_href: `/api/crm/deals/${encodeURIComponent(String(req.deal_id))}/stock-flow/return-complete`,
      });
      if (out.length >= limit) break;
    } catch {
      /* skip */
    }
  }
  return out;
}

async function applyPendingReturnDeletesToAmo(dealId: string, orderItemIds: number[]): Promise<void> {
  const token =
    String(process.env.MP1C_TOKEN || '').trim() || 'mp1c_mkt_9f3a2c7e1b84d0e6';
  const url = 'https://amo1c.pnevmopodveska1.ru/amo/apply_pending_return_deletes.php';
  const body = new URLSearchParams();
  body.set('deal_id', dealId);
  body.set('token', token);
  for (const id of orderItemIds) {
    if (id > 0) body.append('order_item_ids[]', String(id));
  }
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    console.warn('apply_pending_return_deletes', dealId, e instanceof Error ? e.message : e);
  }
}

export function detectRemovedFlowLines(dealId: string): StockReturnLine[] {
  const id = String(dealId || '').trim();
  const snap = readMetaJson<{ lines: StockReturnLine[] }>(FLOW_SNAPSHOT(id));
  if (!snap?.lines?.length) return [];
  const current = new Map<string, number>();
  for (const row of all<{ product_id: string; qty: number; name: string; sku: string }>(
    `SELECT IFNULL(product_guid,'') AS product_id, IFNULL(qty,0) AS qty,
            IFNULL(name,'') AS name, IFNULL(sku,'') AS sku
     FROM crm_deal_items WHERE deal_id = ?`,
    [id]
  )) {
    const pid = String(row.product_id || '').trim();
    if (!pid) continue;
    current.set(pid, Number(row.qty) || 0);
  }
  const removed: StockReturnLine[] = [];
  for (const prev of snap.lines) {
    const pid = String(prev.product_id || '').trim();
    if (!pid) continue;
    const was = Math.max(0, Number(prev.qty) || 0);
    const now = current.get(pid) ?? 0;
    if (was > now) {
      removed.push({
        product_id: pid,
        qty: was - now,
        name: prev.name,
        sku: prev.sku,
      });
    }
  }
  return removed;
}

export function getPendingStockReturn(dealId: string): StockReturnRequest | null {
  return readMetaJson<StockReturnRequest>(RETURN_META(dealId));
}

export function requestStockReturn(input: {
  deal_id: string;
  reason?: string;
  lines?: StockReturnLine[];
  order_item_ids?: number[];
}): StockReturnRequest {
  const dealId = String(input.deal_id || '').trim();
  if (!dealId) throw new Error('Нет id сделки');
  let incoming = (input.lines || []).filter((l) => l.product_id && Number(l.qty) > 0);
  if (!incoming.length) {
    incoming = detectRemovedFlowLines(dealId);
  }
  if (!incoming.length) throw new Error('Нет позиций для возврата');

  const existing = getPendingStockReturn(dealId);
  let lines = incoming;
  let orderItemIds = (input.order_item_ids || [])
    .map((n) => Number(n) || 0)
    .filter((n) => n > 0);
  for (const l of incoming) {
    const oid = Number(l.order_item_id || 0);
    if (oid > 0 && !orderItemIds.includes(oid)) orderItemIds.push(oid);
  }

  const reasonText = String(input.reason || existing?.reason || 'Удалено из заказа после перемещения').trim();
  // Полный возврат задаёт абсолютный состав сделки: повторные клики не должны складывать qty (1+1+1).
  const isFullReturn = /^полный возврат/i.test(reasonText);

  if (existing?.status === 'pending' && !isFullReturn) {
    const map = new Map<string, StockReturnLine>();
    for (const l of existing.lines || []) {
      const key = `${l.product_id}:${Number(l.order_item_id || 0)}`;
      map.set(key, { ...l });
    }
    for (const l of incoming) {
      const key = `${l.product_id}:${Number(l.order_item_id || 0)}`;
      const prev = map.get(key);
      if (prev) {
        prev.qty = Math.max(0, Number(prev.qty) || 0) + Math.max(0, Number(l.qty) || 0);
      } else {
        map.set(key, { ...l });
      }
    }
    lines = [...map.values()];
    const prevIds = (existing.order_item_ids || []).map((n) => Number(n) || 0);
    orderItemIds = [...new Set([...prevIds, ...orderItemIds].filter((n) => n > 0))];
  }

  const req: StockReturnRequest = summarizeReturnRequest({
    id: existing?.status === 'pending' ? String(existing.id) : newGuid(),
    deal_id: dealId,
    status: 'pending',
    reason: reasonText,
    lines,
    order_item_ids: orderItemIds,
    created_at: existing?.status === 'pending' ? String(existing.created_at) : new Date().toISOString(),
  });
  writeMetaJson(RETURN_META(dealId), req);
  try {
    abortOpenProductionForDeal(dealId, req.reason || reasonText);
  } catch (e) {
    console.warn('[deal-stock-flow] abort production on return failed', e);
  }
  return req;
}

/** Остаток товара на складе (stock_balances). */
export function productQtyOnWarehouse(productId: string, warehouseId: string): number {
  const pid = String(productId || '').trim();
  const wh = String(warehouseId || '').trim();
  if (!pid || !wh) return 0;
  return (
    Number(
      get<{ q: number }>(
        `SELECT IFNULL(SUM(qty),0) AS q FROM stock_balances
         WHERE product_id = ? AND warehouse_id = ? AND qty > 0`,
        [pid, wh]
      )?.q
    ) || 0
  );
}

/** Основной склад контура (1С филиал), с которого обычно идёт «→ Резерв». */
export function handoffMainWarehouseIdForSite(site: PickSiteId): string {
  if (site === 'msk') {
    const msk = get<{ id: string }>(
      `SELECT id FROM warehouses
       WHERE code IN ('НФ-000032','00-000001') AND IFNULL(is_active,1)=1
       ORDER BY CASE code WHEN 'НФ-000032' THEN 0 ELSE 1 END
       LIMIT 1`
    );
    if (msk?.id) return String(msk.id);
  }
  if (site === 'strela' || site === 'fogel') {
    const row = get<{ id: string }>(
      `SELECT id FROM warehouses
       WHERE code IN ('НФ-000045','НФ-000047','НФ-000041','НФ-000042') AND IFNULL(is_active,1)=1
       ORDER BY CASE code
         WHEN 'НФ-000045' THEN 0 WHEN 'НФ-000047' THEN 1
         WHEN 'НФ-000041' THEN 2 ELSE 3 END
       LIMIT 1`
    );
    if (row?.id) return String(row.id);
  }
  return mainWarehouseId();
}

/** «Отложено под СТО» контура — альтернативный источник списания. */
export function handoffHoldWarehouseIdForSite(site: PickSiteId): string {
  const ensured = ensureStoReserveWarehouses();
  if (site === 'msk') return String(ensured.mskHold || '');
  return String(ensured.strela || '');
}

/**
 * Откуда списывать позицию: если на «Отложено» хватает qty — оттуда, иначе Основной.
 */
export function resolveHandoffSourceWarehouseId(
  productId: string,
  qty: number,
  site: PickSiteId
): string {
  const need = Math.max(0, Number(qty) || 0);
  const mainWh = handoffMainWarehouseIdForSite(site);
  const holdWh = handoffHoldWarehouseIdForSite(site);
  if (holdWh && need > 0) {
    const holdQty = productQtyOnWarehouse(productId, holdWh);
    if (holdQty + 1e-9 >= need) return holdWh;
  }
  return mainWh;
}

/** Создать черновик «Передача на склад» для /pick (резерв или курьер). */
export function createHandoffPickDraft(input: {
  deal_id: string;
  source?: 'auto' | 'widget' | 'manual';
  actor_name?: string;
}): Record<string, unknown> {
  ensureStoReserveWarehouses();
  const dealId = String(input.deal_id || '').trim();
  if (!dealId) throw new Error('Нет id сделки');

  // СРОЧНО уже в очереди /pick — нельзя параллельно слать «→ Резерв» на ту же qty.
  const openUrgent = get<{ id: string; number: string }>(
    `SELECT id, number FROM stock_docs
     WHERE deal_id = ? AND doc_type = 'out'
       AND comment LIKE '%СРОЧНО на СТО%'
       AND IFNULL(posted,0) = 0
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [dealId]
  );
  if (openUrgent) {
    throw new Error(
      `Уже есть задание СРОЧНО на СТО (${openUrgent.number}) — передача в резерв не нужна`
    );
  }

  const existing = get<{
    id: string;
    number: string;
    posted: number;
    comment: string;
    warehouse_to_id: string | null;
  }>(
    `SELECT id, number, IFNULL(posted,0) AS posted, IFNULL(comment,'') AS comment, warehouse_to_id
     FROM stock_docs
     WHERE doc_type = 'out'
       AND IFNULL(posted,0) = 0
       AND deal_id = ?
       AND comment LIKE '%Передача на склад%'
       AND comment NOT LIKE '%Спуск на СТО%'
       AND comment NOT LIKE '%СРОЧНО на СТО%'
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [dealId]
  );
  if (existing) {
    return {
      created: false,
      doc: get('SELECT * FROM stock_docs WHERE id = ?', [existing.id]),
      message: `Черновик уже есть: ${existing.number}`,
    };
  }

  const deal = get<{
    amo_channel: string;
    amo_shipment: string;
    ship_channel: string;
  }>(
    `SELECT IFNULL(amo_channel,'') AS amo_channel,
            IFNULL(amo_shipment,'') AS amo_shipment,
            IFNULL(ship_channel,'') AS ship_channel
     FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  if (!deal) throw new Error('Сделка не найдена');

  const site = resolvePickSiteForDeal(dealId);
  const mainWh = handoffMainWarehouseIdForSite(site);

  const rows = all<{
    product_guid: string;
    qty: number;
    price: number;
    name: string;
    sku: string;
    item_kind: string;
  }>(
    `SELECT IFNULL(i.product_guid,'') AS product_guid, IFNULL(i.qty,0) AS qty, IFNULL(i.price,0) AS price,
            IFNULL(i.name,'') AS name, IFNULL(i.sku,'') AS sku,
            IFNULL(p.item_kind,'product') AS item_kind
     FROM crm_deal_items i
     LEFT JOIN products p ON p.id = i.product_guid
     WHERE i.deal_id = ?
     ORDER BY i.line_no ASC`,
    [dealId]
  );

  const snapQty = movedQtyMapForDeal(dealId);
  const hasSnapshot = snapQty.size > 0;

  const allProductLines = aggregateProductQtyLines(
    rows
      .filter((r) => String(r.item_kind) !== 'service' && String(r.product_guid || '').trim())
      .map((r) => ({
        product_id: String(r.product_guid),
        qty: Math.max(1, Math.round(Number(r.qty) || 1)),
        price: Math.max(0, Number(r.price) || 0),
        name: String(r.name || ''),
        sku: String(r.sku || ''),
      }))
  ).map((l) => ({
    ...l,
    warehouse_id: resolveHandoffSourceWarehouseId(l.product_id, l.qty, site),
  }));

  // Правило 3: после прошлого «Готово» — только дельта (что ещё не перемещали).
  const deltaLines = hasSnapshot
    ? allProductLines
        .map((l) => {
          const was = snapQty.get(l.product_id) ?? 0;
          const need = Math.max(0, l.qty - was);
          if (need <= 0) return null;
          return {
            ...l,
            qty: need,
            warehouse_id: resolveHandoffSourceWarehouseId(l.product_id, need, site),
          };
        })
        .filter((l): l is NonNullable<typeof l> => !!l)
    : allProductLines;

  const alreadyMoved = hasSnapshot
    ? allProductLines
        .map((l) => {
          const was = Math.min(l.qty, snapQty.get(l.product_id) ?? 0);
          return was > 0
            ? {
                product_id: l.product_id,
                qty: was,
                name: l.name,
                sku: l.sku,
                status: 'already_moved' as const,
              }
            : null;
        })
        .filter((l): l is NonNullable<typeof l> => !!l)
    : [];

  const lines = deltaLines.map(({ product_id, qty, price, warehouse_id }) => ({
    product_id,
    qty,
    price,
    warehouse_id,
  }));
  if (!lines.length) {
    if (hasSnapshot) {
      // Дописываем снимок, если его не было — чтобы UI/следующий раз видели can_reorder=false.
      try {
        snapshotDealFlowLines(dealId);
      } catch {
        /* ignore */
      }
      throw new Error(
        'Номенклатура не менялась — повторная сборка не нужна. Чтобы отправить снова, добавьте позиции (дозаказ).'
      );
    }
    throw new Error('Нет товаров для передачи (услуги не учитываются)');
  }

  // Шапка документа — склад большинства строк (откуда списываем).
  const whVotes = new Map<string, number>();
  for (const l of lines) {
    const wid = String(l.warehouse_id || mainWh).trim() || mainWh;
    whVotes.set(wid, (whVotes.get(wid) || 0) + 1);
  }
  let fromWh = mainWh;
  let best = -1;
  for (const [wid, n] of whVotes) {
    if (n > best) {
      best = n;
      fromWh = wid;
    }
  }

  const reserve = isReserveChannelDeal(deal)
    ? buildHandoffReserveMeta(dealId, fromWh)
    : null;
  const ship = !reserve && isShipChannelDeal(deal) ? buildHandoffShipMeta(dealId, fromWh) : null;
  if (!reserve && !ship) {
    throw new Error('Канал не требует передачи на склад (только Автосервис / Самовывоз / Отправка)');
  }

  const destId = reserve?.dest_warehouse_id || ship?.dest_warehouse_id || '';
  const label = moscowLabel();
  const who = String(input.actor_name || '').trim();
  const srcLabel =
    input.source === 'auto'
      ? 'авто после оплаты'
      : input.source === 'widget'
        ? who
          ? `кнопка → Резерв · ${who}`
          : 'кнопка → Резерв'
        : who
          ? `Учёт №1 · ${who}`
          : 'Учёт №1';
  const isReorder = hasSnapshot && alreadyMoved.length > 0;
  let comment = isReorder
    ? `Передача на склад · дозаказ · ${srcLabel} · ${label} · сделка ${dealId}`
    : `Передача на склад · ${srcLabel} · ${label} · сделка ${dealId}`;
  if (reserve) comment = ensureReserveHandoffComment(comment);

  clearHandoffReturnState(dealId);
  const docId = createDocument({
    doc_type: 'out',
    deal_id: dealId,
    warehouse_id: fromWh,
    warehouse_to_id: destId,
    comment,
    lines,
    post: false,
  });
  const doc = get('SELECT * FROM stock_docs WHERE id = ?', [docId]);
  const movedDetail = getDealAlreadyMovedLines(dealId);
  return {
    created: true,
    doc,
    is_reserve: !!reserve,
    is_ship: !!ship,
    is_reorder: isReorder,
    already_moved: alreadyMoved,
    already_moved_lines: movedDetail,
    already_moved_brief: buildHandoffRouteBrief(dealId, 'main_to_reserve'),
    need_move: deltaLines.map((l) => ({
      product_id: l.product_id,
      qty: l.qty,
      name: l.name,
      sku: l.sku,
      status: 'need_move' as const,
    })),
    message: isReorder
      ? `Дозаказ: переместить ${deltaLines.length} поз. (уже было ${alreadyMoved.length})`
      : undefined,
  };
}

/** После оплаты — черновик на /pick (резерв или курьер). */
export function ensureHandoffPickAfterPaid(dealId: string): {
  created: boolean;
  doc: Record<string, unknown> | null;
  reason?: string;
} {
  const id = String(dealId || '').trim();
  if (!id) return { created: false, doc: null, reason: 'no deal' };
  const deal = get<{ amo_channel: string; amo_shipment: string; ship_channel: string }>(
    `SELECT IFNULL(amo_channel,'') AS amo_channel,
            IFNULL(amo_shipment,'') AS amo_shipment,
            IFNULL(ship_channel,'') AS ship_channel
     FROM crm_deals WHERE id = ?`,
    [id]
  );
  if (!isReserveChannelDeal(deal) && !isShipChannelDeal(deal)) {
    return { created: false, doc: null, reason: 'channel_skip' };
  }
  try {
    const r = createHandoffPickDraft({ deal_id: id, source: 'auto' });
    return { created: !!r.created, doc: (r.doc as Record<string, unknown>) || null };
  } catch (e) {
    return {
      created: false,
      doc: null,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/** История перемещений по сделке. */
export function listDealStockMovements(dealId: string, limit = 40): Array<Record<string, unknown>> {
  const id = String(dealId || '').trim();
  if (!id) return [];
  return all(
    `SELECT d.id, d.number, d.doc_type, d.posted, d.comment, d.created_at,
            IFNULL(w.name,'') AS warehouse,
            IFNULL(wt.name,'') AS warehouse_to,
            (SELECT IFNULL(SUM(l.qty),0) FROM stock_doc_lines l WHERE l.doc_id = d.id) AS qty_sum
     FROM stock_docs d
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     WHERE d.deal_id = ?
       AND d.doc_type IN ('transfer','out','in')
     ORDER BY datetime(d.created_at) DESC
     LIMIT ?`,
    [id, Math.min(100, Math.max(1, limit))]
  ) as Array<Record<string, unknown>>;
}

export function getDealStockFlowStatus(dealId: string): Record<string, unknown> {
  const id = String(dealId || '').trim();
  const deal = get<{
    amo_channel: string;
    amo_shipment: string;
    ship_channel: string;
  }>(
    `SELECT IFNULL(amo_channel,'') AS amo_channel,
            IFNULL(amo_shipment,'') AS amo_shipment,
            IFNULL(ship_channel,'') AS ship_channel
     FROM crm_deals WHERE id = ?`,
    [id]
  );

  const handoff = get<Record<string, unknown>>(
    `SELECT d.*, IFNULL(w.name,'') AS warehouse_name, IFNULL(wt.name,'') AS warehouse_to_name
     FROM stock_docs d
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     WHERE d.deal_id = ? AND d.doc_type = 'out'
       AND d.comment LIKE '%Передача на склад%'
     ORDER BY datetime(d.created_at) DESC LIMIT 1`,
    [id]
  );

  const reserveMeta = buildHandoffReserveMeta(
    id,
    String(handoff?.warehouse_id || mainWarehouseId()),
    String(handoff?.warehouse_to_id || '')
  );
  const shipMeta = buildHandoffShipMeta(id, String(handoff?.warehouse_id || mainWarehouseId()));

  const reserveQty = dealReservePendingToStoLines(id);
  const stoQty = dealOnStoLines(id);

  const pendingReturn = getPendingStockReturn(id);
  const removedDetected = detectRemovedFlowLines(id);
  const addedDetected = detectAddedFlowLines(id);
  const movedMap = movedQtyMapForDeal(id);
  const openDraft = get<{ id: string; comment: string }>(
    `SELECT id, IFNULL(comment,'') AS comment FROM stock_docs
     WHERE deal_id = ? AND doc_type = 'out'
       AND comment LIKE '%Передача на склад%'
       AND comment NOT LIKE '%Спуск на СТО%'
       AND comment NOT LIKE '%СРОЧНО на СТО%'
       AND IFNULL(posted,0) = 0
     LIMIT 1`,
    [id]
  );
  const openToStoDraft = get<{ id: string }>(
    `SELECT id FROM stock_docs
     WHERE deal_id = ? AND doc_type = 'out'
       AND comment LIKE '%Спуск на СТО%'
       AND IFNULL(posted,0) = 0
     LIMIT 1`,
    [id]
  );
  const openUrgentDraft = get<{ id: string }>(
    `SELECT id FROM stock_docs
     WHERE deal_id = ? AND doc_type = 'out'
       AND comment LIKE '%СРОЧНО на СТО%'
       AND IFNULL(posted,0) = 0
     LIMIT 1`,
    [id]
  );
  // Дельта Основной/Отложено → ещё не ушло в резерв / срочно на СТО
  const mainPendingLines: DealFlowQtyLine[] = [];
  {
    const site = resolvePickSiteForDeal(id);
    for (const item of dealGoodsLines(id)) {
      const pid = String(item.product_id || '').trim();
      const need = Math.max(0, Math.round(Number(item.qty) || 0));
      const was = movedMap.get(pid) ?? 0;
      const left = Math.max(0, need - was);
      if (left > 0) {
        mainPendingLines.push({
          product_id: pid,
          qty: left,
          name: String(item.name || ''),
          sku: String(item.sku || ''),
        });
      }
    }
    void site;
  }

  return {
    deal_id: id,
    amo_channel: deal?.amo_channel || '',
    is_reserve_channel: isReserveChannelDeal(deal),
    is_ship_channel: isShipChannelDeal(deal),
    reserve_meta: reserveMeta,
    ship_meta: shipMeta,
    handoff: handoff || null,
    handoff_posted: handoff ? Number(handoff.posted) === 1 : false,
    handoff_open_draft: !!openDraft,
    to_sto_pending: !!openToStoDraft,
    on_reserve: reserveQty,
    on_sto: stoQty,
    movements: listDealStockMovements(id),
    pending_return: pendingReturn,
    removed_detected: removedDetected,
    added_detected: addedDetected,
    can_reorder: movedMap.size > 0 && addedDetected.length > 0 && !openDraft,
    already_moved_count: movedMap.size,
    already_moved_lines: getDealAlreadyMovedLines(id),
    already_moved_brief: buildHandoffRouteBrief(id, 'main_to_reserve'),
    nothing_to_handoff:
      (movedMap.size > 0 && addedDetected.length === 0 && !openDraft) || !!openUrgentDraft,
    // Кнопка «Резерв → СТО»: товар на резерве, нет открытого задания складу на спуск
    can_to_sto:
      reserveQty.length > 0 && isReserveChannelDeal(deal) && !openToStoDraft,
    urgent_to_sto_pending: !!openUrgentDraft,
    main_pending_to_sto: mainPendingLines,
    // СРОЧНО на СТО: есть что везти с Основного/Отложено (дозаказ или первый остаток).
    // При нажатии также создаётся Резерв→СТО, если уже лежит на резерве (до 2 заданий).
    can_urgent_to_sto:
      !!isReserveChannelDeal(deal) && !openUrgentDraft && mainPendingLines.length > 0,
    // «→ Резерв» только если нет открытого СРОЧНО и есть что везти с основного
    can_handoff_to_reserve:
      !!isReserveChannelDeal(deal) &&
      !openUrgentDraft &&
      !openDraft &&
      mainPendingLines.length > 0,
    block_success_reasons: getDealStockFlowBlockers(id),
    chain: buildDealWarehouseChain(id),
    sale_writeoff: (() => {
      const doc = getDealSaleWriteOffDoc(id);
      if (doc) {
        return {
          doc_id: doc.id,
          number: doc.number,
          doc_date: String(doc.doc_date || '').slice(0, 10),
          comment: doc.comment,
        };
      }
      return readMetaJson<Record<string, unknown>>(SALE_WRITEOFF_META(id));
    })(),
  };
}

export function getDealStockFlowBlockers(
  dealId: string,
  opts?: { ignore_on_sto?: boolean }
): string[] {
  const id = String(dealId || '').trim();
  if (!id) return [];
  const blockers: string[] = [];

  const handoff = get<{ posted: number; comment: string }>(
    `SELECT IFNULL(posted,0) AS posted, IFNULL(comment,'') AS comment
     FROM stock_docs
     WHERE deal_id = ? AND doc_type = 'out'
       AND comment LIKE '%Передача на склад%'
       AND IFNULL(posted,0) = 0
     LIMIT 1`,
    [id]
  );
  if (handoff) {
    if (/Спуск на СТО/i.test(String(handoff.comment || ''))) {
      blockers.push('Склад ещё не спустил Резерв → СТО (задание на /pick)');
    } else {
      blockers.push('Склад ещё не зарезервировал (черновик на /pick)');
    }
  }

  const pendingReturn = getPendingStockReturn(id);
  if (pendingReturn?.status === 'pending') {
    blockers.push(`Возврат на основной склад: ${pendingReturn.reason}`);
  }

  if (!opts?.ignore_on_sto) {
    const stoWh = stoWarehouseId();
    const onSto = get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM stock_balances b
       WHERE b.warehouse_id = ? AND b.qty > 0
         AND b.product_id IN (SELECT product_guid FROM crm_deal_items WHERE deal_id = ?)`,
      [stoWh, id]
    )?.c;
    if (Number(onSto) > 0) {
      blockers.push('На СТО ещё лежит товар по заказу — спишется при закрытии в «Успешно»');
    }
  }

  return blockers;
}

/** Маркер задания складу: Резерв → СТО или СРОЧНО Основной/Отложено → СТО. */
export function isToStoHandoffComment(comment: string): boolean {
  return /Спуск на СТО|СРОЧНО на СТО/i.test(String(comment || ''));
}

/**
 * Кнопка «Резерв → СТО»: не проводит сразу, а ставит задание складу на /pick.
 * Склад нажимает «✓ На СТО» → перемещение Резерв → СТО.
 */
export function transferReserveToSto(dealId: string, actorName?: string): Record<string, unknown> {
  const id = String(dealId || '').trim();
  if (!id) throw new Error('Нет id сделки');
  const site = resolvePickSiteForDeal(id);
  const reserveWh = reserveWarehouseForPickSite(site).id;
  const stoWh = stoWarehouseId();
  const deal = get<{ amo_channel: string }>(
    `SELECT IFNULL(amo_channel,'') AS amo_channel FROM crm_deals WHERE id = ?`,
    [id]
  );
  if (!isReserveChannelDeal(deal)) {
    throw new Error('Спуск на СТО только для Автосервис / Самовывоз');
  }
  const channel = String(deal?.amo_channel || '').trim() || '—';

  const existing = get<Record<string, unknown>>(
    `SELECT * FROM stock_docs
     WHERE deal_id = ? AND doc_type = 'out'
       AND comment LIKE '%Спуск на СТО%'
       AND IFNULL(posted,0) = 0
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [id]
  );
  if (existing) {
    return {
      ok: true,
      created: false,
      pending_pick: true,
      doc_id: existing.id,
      doc: existing,
      message: 'Задание складу уже в очереди /pick (Резерв → СТО)',
    };
  }

  const pendingLines = dealReservePendingToStoLines(id);
  if (!pendingLines.length) throw new Error('По этой сделке нечего спускать: всё уже на СТО или ещё не на резерве');

  const reserveName =
    get<{ name: string }>(
      `SELECT IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
      [reserveWh]
    )?.name || 'Резерв СТО';
  const stoName =
    get<{ name: string }>(
      `SELECT IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
      [stoWh]
    )?.name || 'СТО';
  const label = moscowLabel();
  const who = String(actorName || '').trim();
  const comment = [
    'Передача на склад',
    'Спуск на СТО',
    channel,
    who || 'виджет',
    label,
    `сделка ${id}`,
    `${reserveName} → ${stoName}`,
  ].join(' · ');

  // Остаток может ещё лежать на старом «Отложено» (STO-RES) — списываем оттуда, если на Резерве пусто.
  const holdWh =
    site === 'msk'
      ? String(
          get<{ id: string }>(
            `SELECT id FROM warehouses WHERE code = 'STO-RES-MSK' AND IFNULL(is_active,1)=1 LIMIT 1`
          )?.id || ''
        )
      : '';
  let fromWh = reserveWh;
  if (holdWh && holdWh !== reserveWh) {
    const onRsv = Number(
      get<{ s: number }>(
        `SELECT IFNULL(SUM(qty),0) AS s FROM stock_balances WHERE warehouse_id = ? AND qty > 0`,
        [reserveWh]
      )?.s || 0
    );
    const onHold = Number(
      get<{ s: number }>(
        `SELECT IFNULL(SUM(qty),0) AS s FROM stock_balances WHERE warehouse_id = ? AND qty > 0`,
        [holdWh]
      )?.s || 0
    );
    if (onRsv <= 0 && onHold > 0) fromWh = holdWh;
  }

  const docId = createDocument({
    doc_type: 'out',
    warehouse_id: fromWh,
    warehouse_to_id: stoWh,
    deal_id: id,
    comment,
    lines: pendingLines.map((b) => ({
      product_id: b.product_id,
      qty: Number(b.qty) || 0,
      warehouse_id: fromWh,
    })),
    post: false,
  });
  return {
    ok: true,
    created: true,
    pending_pick: true,
    doc_id: docId,
    doc: get('SELECT * FROM stock_docs WHERE id = ?', [docId]),
    message: 'Задание складу: Резерв → СТО (экран /pick)',
    route_label: `${reserveName} → ${stoName}`,
  };
}


/**
 * «СРОЧНО на СТО»: сразу на пол СТО, минуя обычный путь «сначала в Резерв».
 * Создаёт до двух заданий на /pick:
 *  1) Основной/Отложено → СТО — то, что ещё не ушло в резерв (дозаказ / первый остаток);
 *  2) Резерв → СТО — то, что уже лежит на резерве.
 */
export function createUrgentToStoHandoffs(
  dealId: string,
  actorName?: string
): Record<string, unknown> {
  ensureStoReserveWarehouses();
  const id = String(dealId || '').trim();
  if (!id) throw new Error('Нет id сделки');
  const deal = get<{ amo_channel: string }>(
    `SELECT IFNULL(amo_channel,'') AS amo_channel FROM crm_deals WHERE id = ?`,
    [id]
  );
  if (!isReserveChannelDeal(deal)) {
    throw new Error('СРОЧНО на СТО только для Автосервис / Самовывоз');
  }
  const channel = String(deal?.amo_channel || '').trim() || '—';
  const site = resolvePickSiteForDeal(id);
  const mainWh = handoffMainWarehouseIdForSite(site);
  const stoWh = stoWarehouseId();
  const stoName =
    get<{ name: string }>(
      `SELECT IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
      [stoWh]
    )?.name || 'СТО';
  const label = moscowLabel();
  const who = String(actorName || '').trim() || 'виджет';

  const existingUrgent = get<Record<string, unknown>>(
    `SELECT * FROM stock_docs
     WHERE deal_id = ? AND doc_type = 'out'
       AND comment LIKE '%СРОЧНО на СТО%'
       AND IFNULL(posted,0) = 0
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [id]
  );
  if (existingUrgent) {
    return {
      ok: true,
      created: false,
      pending_pick: true,
      urgent: true,
      docs: [existingUrgent],
      message: 'Задание СРОЧНО на СТО уже в очереди /pick',
    };
  }

  // Открытый черновик «→ Резерв» мешает: срочно везём те же позиции сразу на СТО.
  const openReserveDrafts = all<{ id: string }>(
    `SELECT id FROM stock_docs
     WHERE deal_id = ? AND doc_type = 'out'
       AND comment LIKE '%Передача на склад%'
       AND comment NOT LIKE '%Спуск на СТО%'
       AND comment NOT LIKE '%СРОЧНО на СТО%'
       AND IFNULL(posted,0) = 0`,
    [id]
  );
  for (const d of openReserveDrafts) {
    run('DELETE FROM stock_doc_lines WHERE doc_id = ?', [d.id]);
    run('DELETE FROM stock_docs WHERE id = ?', [d.id]);
  }

  const snapQty = movedQtyMapForDeal(id);
  const dealRows = all<{
    product_guid: string;
    qty: number;
    price: number;
    name: string;
    sku: string;
    item_kind: string;
  }>(
    `SELECT IFNULL(i.product_guid,'') AS product_guid, IFNULL(i.qty,0) AS qty, IFNULL(i.price,0) AS price,
            IFNULL(i.name,'') AS name, IFNULL(i.sku,'') AS sku,
            IFNULL(p.item_kind,'product') AS item_kind
     FROM crm_deal_items i
     LEFT JOIN products p ON p.id = i.product_guid
     WHERE i.deal_id = ?
     ORDER BY i.line_no ASC`,
    [id]
  );

  const mainLines: Array<{ product_id: string; qty: number; price: number; warehouse_id: string }> = [];
  for (const r of aggregateProductQtyLines(
    dealRows
      .filter((row) => String(row.item_kind) !== 'service')
      .map((row) => ({
        product_id: String(row.product_guid || '').trim(),
        qty: Math.max(1, Math.round(Number(row.qty) || 1)),
        price: Math.max(0, Number(row.price) || 0),
        name: String(row.name || ''),
        sku: String(row.sku || ''),
      }))
  )) {
    const product_id = r.product_id;
    if (!product_id) continue;
    const need = Math.max(0, Number(r.qty) || 0);
    const was = snapQty.get(product_id) ?? 0;
    const left = Math.max(0, need - was);
    if (left <= 0) continue;
    mainLines.push({
      product_id,
      qty: left,
      price: r.price,
      warehouse_id: resolveHandoffSourceWarehouseId(product_id, left, site),
    });
  }

  const docs: Array<Record<string, unknown>> = [];
  const created: string[] = [];

  if (mainLines.length) {
    const whVotes = new Map<string, number>();
    for (const l of mainLines) {
      const wid = String(l.warehouse_id || mainWh).trim() || mainWh;
      whVotes.set(wid, (whVotes.get(wid) || 0) + 1);
    }
    let fromWh = mainWh;
    let best = -1;
    for (const [wid, n] of whVotes) {
      if (n > best) {
        best = n;
        fromWh = wid;
      }
    }
    const fromName =
      get<{ name: string }>(
        `SELECT IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
        [fromWh]
      )?.name || 'Основной';
    const comment = [
      'Передача на склад',
      'СРОЧНО на СТО',
      channel,
      who,
      label,
      `сделка ${id}`,
      `${fromName} → ${stoName}`,
    ].join(' · ');
    const docId = createDocument({
      doc_type: 'out',
      warehouse_id: fromWh,
      warehouse_to_id: stoWh,
      deal_id: id,
      comment,
      lines: mainLines,
      post: false,
    });
    const doc = get('SELECT * FROM stock_docs WHERE id = ?', [docId]) as Record<string, unknown>;
    docs.push(doc);
    created.push('main_to_sto');
  }

  // 2) Уже на резерве → СТО (как обычная кнопка, без повторного idempotent-блока если уже создали)
  let reserveResult: Record<string, unknown> | null = null;
  const reservePending = dealReservePendingToStoLines(id);
  if (reservePending.length) {
    try {
      reserveResult = transferReserveToSto(id, who);
      if (reserveResult?.doc) docs.push(reserveResult.doc as Record<string, unknown>);
      else if (reserveResult?.doc_id) {
        const d = get('SELECT * FROM stock_docs WHERE id = ?', [String(reserveResult.doc_id)]);
        if (d) docs.push(d as Record<string, unknown>);
      }
      created.push('reserve_to_sto');
    } catch (e) {
      // Если только main_to_sto уже создан — не валим весь ответ
      if (!mainLines.length) throw e;
      reserveResult = {
        ok: false,
        error: e instanceof Error ? e.message : 'reserve→sto failed',
      };
    }
  }

  if (!docs.length) {
    throw new Error('Нечего срочно везти на СТО: всё уже на СТО или нет остатка к перемещению');
  }

  return {
    ok: true,
    created: true,
    pending_pick: true,
    urgent: true,
    created_kinds: created,
    docs,
    doc_id: String(docs[0]?.id || ''),
    main_to_sto: mainLines.length
      ? { lines: mainLines.length, qty: mainLines.reduce((s, l) => s + l.qty, 0) }
      : null,
    reserve_to_sto: reserveResult,
    message:
      created.length === 2
        ? 'СРОЧНО: 2 задания на /pick (Основной→СТО и Резерв→СТО)'
        : created[0] === 'main_to_sto'
          ? 'СРОЧНО: задание Основной/Отложено → СТО на /pick'
          : 'СРОЧНО: задание Резерв → СТО на /pick',
  };
}

/** Склад подтвердил возврат RESERVE/STO → MAIN. */
export async function completeStockReturnPick(input: {
  deal_id: string;
  from_warehouse_id?: string;
  from_cell_code?: string;
  to_cell_code?: string;
  lines?: Array<{
    product_id: string;
    from_cell_code?: string;
    to_cell_code?: string;
  }>;
  actor_name?: string;
}): Promise<Record<string, unknown>> {
  const dealId = String(input.deal_id || '').trim();
  const pendingRaw = getPendingStockReturn(dealId);
  if (!pendingRaw || pendingRaw.status !== 'pending') {
    throw new Error('Нет открытого требования на возврат');
  }
  const pending = summarizeReturnRequest(pendingRaw);
  const mainWh = mainWarehouseId();
  const site = resolvePickSiteForDeal(dealId);
  const reserveWh = reserveWarehouseForPickSite(site).id;
  const stoWh = stoWarehouseId();
  const holdWh =
    String(
      get<{ id: string }>(
        `SELECT id FROM warehouses
         WHERE code IN ('STO-RES-MSK','STO-RES-STRELA') AND IFNULL(is_active,1)=1
         ORDER BY CASE code WHEN 'STO-RES-MSK' THEN 0 ELSE 1 END
         LIMIT 1`
      )?.id || ''
    ).trim() || handoffHoldWarehouseIdForSite(site);

  const lineOverrides = new Map(
    (input.lines || []).map((l) => [String(l.product_id || '').trim(), l])
  );
  const headerFromHint =
    String(input.from_warehouse_id || '').trim() ||
    String(pending.from_warehouse_id || '').trim() ||
    String(pending.lines.find((l) => l.from_warehouse_id)?.from_warehouse_id || '').trim() ||
    holdWh ||
    reserveWh ||
    stoWh;
  if (!headerFromHint) throw new Error('Не удалось определить склад, откуда возвращать');

  /** Склад списания: где реально есть qty (часто «Отложено», а в заявке — «Резерв»). */
  const resolveReturnFromWh = (productId: string, qtyNeed: number, preferred: string): string => {
    const need = Math.max(1, qtyNeed);
    const candidates = [
      preferred,
      String(input.from_warehouse_id || '').trim(),
      String(pending.from_warehouse_id || '').trim(),
      holdWh,
      reserveWh,
      stoWh,
    ].filter(Boolean);
    const seen = new Set<string>();
    for (const wid of candidates) {
      if (seen.has(wid)) continue;
      seen.add(wid);
      const bal = get<{ qty: number }>(
        'SELECT qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?',
        [wid, productId]
      );
      if (bal && Number(bal.qty) + 0.0001 >= need) return wid;
    }
    return preferred || candidates[0] || headerFromHint;
  };

  const lines = pending.lines
    .map((l) => {
      const ov = lineOverrides.get(String(l.product_id));
      const fromCell =
        String(ov?.from_cell_code || input.from_cell_code || l.from_cell_code || '').trim();
      const toCell =
        String(ov?.to_cell_code || input.to_cell_code || l.to_cell_code || l.origin_cell_code || '').trim();
      const preferred =
        String(l.from_warehouse_id || headerFromHint).trim() || headerFromHint;
      const qty = Math.max(1, Number(l.qty) || 1);
      return {
        product_id: String(l.product_id),
        qty,
        warehouse_id: resolveReturnFromWh(String(l.product_id), qty, preferred),
        sku: String(l.sku || ''),
        name: String(l.name || ''),
        from_cell_code: fromCell,
        to_cell_code: toCell,
      };
    })
    .filter((l) => l.product_id);

  if (!lines.length) throw new Error('Нет позиций для возврата');

  const headerFrom =
    lines.map((l) => l.warehouse_id).find(Boolean) || headerFromHint;

  const cellHint = lines.map((l) => l.from_cell_code || l.to_cell_code).find(Boolean) || '';
  const comment = [
    'Возврат на основной',
    pending.reason,
    input.actor_name ? String(input.actor_name) : '',
    cellHint ? `яч. ${cellHint}` : '',
    pending.route_label || '',
  ]
    .filter(Boolean)
    .join(' · ');

  // Как handoff на /pick: остаток может быть только в ячейках / на соседнем СТО-складе.
  const docId = createDocument({
    doc_type: 'transfer',
    warehouse_id: headerFrom,
    warehouse_to_id: mainWh,
    deal_id: dealId,
    comment,
    lines: lines.map((l) => ({
      product_id: l.product_id,
      qty: l.qty,
      warehouse_id: l.warehouse_id,
    })),
    post: true,
    serials_optional: true,
    ignore_stock: true,
  });

  try {
    const { applyCellIssueDelta, applyCellReceiveDelta } = await import('./warehouse-cells.js');
    for (const l of lines) {
      if (l.from_cell_code) {
        try {
          applyCellIssueDelta({
            warehouse_id: l.warehouse_id,
            cell_code: l.from_cell_code,
            product_id: l.product_id,
            sku: l.sku,
            qty: l.qty,
          });
        } catch {
          /* ячейка необязательна */
        }
      }
      if (l.to_cell_code) {
        try {
          applyCellReceiveDelta({
            warehouse_id: mainWh,
            cell_code: l.to_cell_code,
            product_id: l.product_id,
            sku: l.sku,
            product_name: l.name,
            qty: l.qty,
          });
        } catch {
          /* ячейка необязательна */
        }
      }
    }
  } catch {
    /* cells module optional */
  }

  const orderItemIds = [
    ...new Set(
      [
        ...(pending.order_item_ids || []),
        ...pending.lines.map((l) => Number(l.order_item_id || 0)),
      ].filter((n) => n > 0)
    ),
  ];

  pending.status = 'done';
  pending.completed_at = new Date().toISOString();
  pending.lines = lines.map((l, i) => ({
    ...(pending.lines[i] || { product_id: l.product_id, qty: l.qty }),
    from_cell_code: l.from_cell_code,
    to_cell_code: l.to_cell_code,
    from_warehouse_id: l.warehouse_id,
  }));
  writeMetaJson(RETURN_META(dealId), pending);
  try {
    snapshotDealFlowLines(dealId);
  } catch (e) {
    console.warn(
      'snapshotDealFlowLines after return',
      dealId,
      e instanceof Error ? e.message : e
    );
  }

  // Правило 1: только после «Готово» по возврату позиции пропадают из виджета.
  await applyPendingReturnDeletesToAmo(dealId, orderItemIds);

  const docRow = get<{ number?: string }>('SELECT number FROM stock_docs WHERE id = ?', [docId]);
  const skuBits = lines
    .map((l) => {
      const sku = String(l.sku || '').trim();
      const cell = String(l.to_cell_code || l.from_cell_code || '').trim();
      return [sku || 'товар', l.qty > 1 ? `${l.qty} шт` : '', cell ? `яч. ${cell}` : '']
        .filter(Boolean)
        .join(' · ');
    })
    .filter(Boolean)
    .slice(0, 5);
  const route = String(pending.route_label || '→ Основной').trim();
  const amoNote = [
    'Склад: возврат на основной',
    route,
    docRow?.number ? String(docRow.number) : '',
    skuBits.join('; '),
    input.actor_name ? String(input.actor_name) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  try {
    const amo = await notifyAmoWarehousePacked({ dealId, text: amoNote });
    if (!amo.ok) {
      writeMetaJson(`amo_note_err:return:${dealId}`, {
        at: new Date().toISOString(),
        text: amoNote,
        error: amo.error || 'amo note failed',
      });
    }
  } catch (e) {
    writeMetaJson(`amo_note_err:return:${dealId}`, {
      at: new Date().toISOString(),
      text: amoNote,
      error: e instanceof Error ? e.message : 'amo note failed',
    });
  }

  return { ok: true, doc_id: docId, return: pending, doc: get('SELECT * FROM stock_docs WHERE id = ?', [docId]) };
}

const SALE_WRITEOFF_META = (dealId: string) =>
  `stock_flow_sale_writeoff:${String(dealId || '').trim()}`;

function resolveSuccessStatusForDeal(dealId: string): { statusId: string } | null {
  const deal = get<{ pipeline_id?: string }>(
    `SELECT IFNULL(pipeline_id,'') AS pipeline_id FROM crm_deals WHERE id = ?`,
    [dealId]
  );
  if (!deal) return null;
  const pipelineId = String(deal.pipeline_id || '').trim();
  if (!pipelineId) return null;
  const mapped = mappedSuccessStatus(pipelineId);
  if (mapped) return { statusId: mapped.statusId };
  const hit = all<{ id: string; name: string }>(
    `SELECT id, name FROM crm_pipeline_statuses WHERE pipeline_id = ? ORDER BY sort, name`,
    [pipelineId]
  ).find((s) => {
    const n = String(s.name || '');
    if (FAIL_NAME_RE.test(n)) return false;
    return SUCCESS_NAME_RE.test(n);
  });
  if (!hit) return null;
  return { statusId: rawStatusId(String(hit.id)) };
}

/** Сделка на этапе «Успешно реализовано» в своей воронке. */
export function dealIsSuccessful(dealId: string): boolean {
  const id = String(dealId || '').trim();
  if (!id) return false;
  const target = resolveSuccessStatusForDeal(id);
  if (!target) return false;
  const cur = get<{ status_id: string }>(
    `SELECT IFNULL(status_id,'') AS status_id FROM crm_deals WHERE id = ?`,
    [id]
  );
  return rawStatusId(String(cur?.status_id || '')) === rawStatusId(target.statusId);
}

function dealHasStockOnSto(dealId: string): boolean {
  const stoWh = stoWarehouseId();
  const id = String(dealId || '').trim();
  if (!stoWh || !id) return false;
  const c =
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM stock_balances b
       WHERE b.warehouse_id = ? AND b.qty > 0
         AND b.product_id IN (SELECT product_guid FROM crm_deal_items WHERE deal_id = ?)`,
      [stoWh, id]
    )?.c ?? 0;
  return Number(c) > 0;
}

const OPEN_DEAL_NOT_WRITEOFF_SQL = `NOT EXISTS (
  SELECT 1 FROM stock_docs wo
  WHERE wo.deal_id = d.deal_id
    AND IFNULL(wo.posted,0) = 1
    AND wo.doc_type = 'out'
    AND IFNULL(wo.comment,'') LIKE '%Списание по продаже%'
)`;

/** Проведённый приход на склад по сделке (перемещение или приходная). */
const OPEN_DEAL_INBOUND_TO_WH_SQL = `(
  (d.doc_type = 'transfer' AND d.warehouse_to_id = b.warehouse_id)
  OR (d.doc_type = 'in' AND l.warehouse_id = b.warehouse_id)
)`;

const OPEN_DEAL_STOCK_JOIN_SQL = `
  FROM stock_balances b
  INNER JOIN stock_doc_lines l ON l.product_id = b.product_id
  INNER JOIN stock_docs d ON d.id = l.doc_id
  LEFT JOIN crm_deals deal ON deal.id = d.deal_id
  LEFT JOIN products p ON p.id = b.product_id
  WHERE b.qty > 0
    AND IFNULL(d.posted, 0) = 1
    AND IFNULL(d.deal_id, '') != ''
    AND IFNULL(p.item_kind, 'product') != 'service'
    AND ${OPEN_DEAL_INBOUND_TO_WH_SQL}
    AND ${OPEN_DEAL_NOT_WRITEOFF_SQL}
    AND EXISTS (
      SELECT 1 FROM crm_deal_items di
      WHERE di.deal_id = d.deal_id
        AND di.product_guid = b.product_id
        AND IFNULL(di.qty, 0) > 0
    )`;

/** Последний проведённый приход по паре склад+товар → одна сделка. */
const OPEN_DEAL_LATEST_INBOUND_CTE = `
  WITH open_deal_inbound AS (
    SELECT b.warehouse_id,
           b.product_id,
           d.deal_id,
           ROW_NUMBER() OVER (
             PARTITION BY b.warehouse_id, b.product_id
             ORDER BY datetime(IFNULL(d.created_at, d.doc_date)) DESC, d.number DESC
           ) AS rn
    ${OPEN_DEAL_STOCK_JOIN_SQL}
  )`;

/** Сколько сделок с товаром на складе (по актуальному переносу на каждую позицию). */
export function countOpenDealsOnWarehouse(warehouseId: string): number {
  return listOpenDealIdsOnWarehouse(warehouseId).length;
}

/** Сделки с актуальным остатком на складе (без списания по продаже). */
export function listOpenDealIdsOnWarehouse(warehouseId: string): string[] {
  const wh = String(warehouseId || '').trim();
  if (!wh) return [];
  if (isStoHoldWarehouseId(wh)) return [];
  return all<{ deal_id: string }>(
    `${OPEN_DEAL_LATEST_INBOUND_CTE}
     SELECT DISTINCT deal_id AS deal_id
     FROM open_deal_inbound
     WHERE rn = 1 AND warehouse_id = ? AND IFNULL(deal_id,'') != ''
     ORDER BY deal_id`,
    [wh]
  )
    .map((r) => String(r.deal_id || '').trim())
    .filter(Boolean);
}

/** Текущие позиции сделки на складе (для паллета СТО / Резерв). */
export function listOpenDealStockLinesOnWarehouse(
  warehouseId: string,
  dealId: string
): Array<{ sku: string; name: string; qty: number; product_id: string }> {
  const wh = String(warehouseId || '').trim();
  const id = String(dealId || '').trim();
  if (!wh || !id) return [];
  return all<{ sku: string; name: string; qty: number; product_id: string }>(
    `${OPEN_DEAL_LATEST_INBOUND_CTE}
     SELECT IFNULL(p.sku,'') AS sku,
            IFNULL(p.name,'') AS name,
            IFNULL(b.qty,0) AS qty,
            IFNULL(o.product_id,'') AS product_id
     FROM open_deal_inbound o
     INNER JOIN stock_balances b
       ON b.warehouse_id = o.warehouse_id AND b.product_id = o.product_id
     LEFT JOIN products p ON p.id = o.product_id
     WHERE o.rn = 1 AND o.warehouse_id = ? AND o.deal_id = ? AND b.qty > 0
     ORDER BY p.sku COLLATE NOCASE`,
    [wh, id]
  ).map((r) => ({
    sku: String(r.sku || ''),
    name: String(r.name || ''),
    qty: Number(r.qty) || 0,
    product_id: String(r.product_id || ''),
  }));
}

/** «Отложено под СТО» — не склад сделок для метрик карточки. */
function isStoHoldWarehouseId(warehouseId: string): boolean {
  const id = String(warehouseId || '').trim();
  if (!id) return false;
  const code = String(
    get<{ code: string }>(`SELECT IFNULL(code,'') AS code FROM warehouses WHERE id = ?`, [id])
      ?.code || ''
  )
    .trim()
    .toUpperCase();
  return code === 'STO-RES-MSK' || code === 'STO-RES-STRELA' || /^STO-RES-/.test(code);
}

/** «Резерв СТО» (сделки) — код STO-RSV-*. */
export function isStoDealReserveWarehouseId(warehouseId: string): boolean {
  const id = String(warehouseId || '').trim();
  if (!id) return false;
  const code = String(
    get<{ code: string }>(`SELECT IFNULL(code,'') AS code FROM warehouses WHERE id = ?`, [id])
      ?.code || ''
  )
    .trim()
    .toUpperCase();
  return code === 'STO-RSV-MSK' || /^STO-RSV-/.test(code);
}

export type PendingHandoffInboundLine = {
  product_id: string;
  warehouse_id: string;
  warehouse: string;
  warehouse_code: string;
  qty: number;
  name: string;
  sku: string;
  unit: string;
  kind: string;
  category: string;
  pending: true;
  doc_id: string;
  doc_number: string;
  deal_id: string;
  open_deals: Array<{
    deal_id: string;
    deal_name: string;
    status_name: string;
    amo_channel: string;
    responsible_user_id: string;
    responsible_name: string;
  }>;
};

/** Черновики «Передача на склад» → этот склад (ещё не проведены на /pick). */
export function pendingHandoffInboundOnWarehouse(warehouseId: string): PendingHandoffInboundLine[] {
  const wh = String(warehouseId || '').trim();
  if (!wh) return [];
  const whRow = get<{ name: string; code: string }>(
    `SELECT IFNULL(name,'') AS name, IFNULL(code,'') AS code FROM warehouses WHERE id = ?`,
    [wh]
  );
  const rows = all<{
    doc_id: string;
    doc_number: string;
    deal_id: string;
    product_id: string;
    qty: number;
    name: string;
    sku: string;
    unit: string;
    kind: string;
    category: string;
    deal_name: string;
    status_name: string;
    amo_channel: string;
    responsible_user_id: string;
  }>(
    `SELECT d.id AS doc_id,
            IFNULL(d.number,'') AS doc_number,
            IFNULL(d.deal_id,'') AS deal_id,
            IFNULL(l.product_id,'') AS product_id,
            IFNULL(l.qty,0) AS qty,
            IFNULL(p.name,'') AS name,
            IFNULL(p.sku,'') AS sku,
            IFNULL(u.short_name, IFNULL(u.name,'')) AS unit,
            IFNULL(p.item_kind,'product') AS kind,
            IFNULL(c.name,'') AS category,
            IFNULL(deal.name,'') AS deal_name,
            IFNULL(deal.status_name,'') AS status_name,
            IFNULL(deal.amo_channel,'') AS amo_channel,
            IFNULL(deal.responsible_user_id,'') AS responsible_user_id
     FROM stock_docs d
     JOIN stock_doc_lines l ON l.doc_id = d.id
     LEFT JOIN products p ON p.id = l.product_id
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN crm_deals deal ON deal.id = d.deal_id
     WHERE IFNULL(d.posted,0) = 0
       AND IFNULL(d.warehouse_to_id,'') = ?
       AND d.comment LIKE '%Передача на склад%'
       AND IFNULL(l.product_id,'') != ''
       AND IFNULL(l.qty,0) > 0
       AND IFNULL(p.item_kind,'product') != 'service'
     ORDER BY datetime(d.created_at) DESC, d.number DESC`,
    [wh]
  );
  return rows.map((r) => {
    const dealId = String(r.deal_id || '').trim();
    return {
      product_id: String(r.product_id || ''),
      warehouse_id: wh,
      warehouse: String(whRow?.name || ''),
      warehouse_code: String(whRow?.code || ''),
      qty: Number(r.qty) || 0,
      name: String(r.name || ''),
      sku: String(r.sku || ''),
      unit: String(r.unit || ''),
      kind: String(r.kind || 'product'),
      category: String(r.category || ''),
      pending: true as const,
      doc_id: String(r.doc_id || ''),
      doc_number: String(r.doc_number || ''),
      deal_id: dealId,
      open_deals: dealId
        ? [
            {
              deal_id: dealId,
              deal_name: String(r.deal_name || ''),
              status_name: String(r.status_name || ''),
              amo_channel: String(r.amo_channel || ''),
              responsible_user_id: String(r.responsible_user_id || ''),
              responsible_name: '',
            },
          ]
        : [],
    };
  });
}

export function pendingHandoffInboundSummary(warehouseId: string): {
  lines: number;
  qty: number;
  deals: number;
} {
  const rows = pendingHandoffInboundOnWarehouse(warehouseId);
  const deals = new Set(rows.map((r) => r.deal_id).filter(Boolean));
  return {
    lines: rows.length,
    qty: rows.reduce((s, r) => s + (Number(r.qty) || 0), 0),
    deals: deals.size,
  };
}

/**
 * Уникальные сделки на «Резерв СТО»: остаток на складе ∪ черновики «Передача на склад».
 * Не Math.max(остаток, черновики) — иначе 1+1 разных сделок показывают как «1».
 */
export function countStoDealReserveDeals(warehouseId: string): number {
  const wh = String(warehouseId || '').trim();
  if (!wh) return 0;
  const ids = new Set<string>();
  const onStock = all<{ deal_id: string }>(
    `${OPEN_DEAL_LATEST_INBOUND_CTE}
     SELECT DISTINCT deal_id AS deal_id
     FROM open_deal_inbound
     WHERE rn = 1 AND warehouse_id = ? AND IFNULL(deal_id,'') != ''`,
    [wh]
  );
  for (const r of onStock) {
    const id = String(r.deal_id || '').trim();
    if (id) ids.add(id);
  }
  for (const r of pendingHandoffInboundOnWarehouse(wh)) {
    const id = String(r.deal_id || '').trim();
    if (id) ids.add(id);
  }
  return ids.size;
}

function isStoFloorWarehouseId(warehouseId: string): boolean {
  const id = String(warehouseId || '').trim();
  if (!id) return false;
  const code = String(
    get<{ code: string }>(`SELECT IFNULL(code,'') AS code FROM warehouses WHERE id = ?`, [id])
      ?.code || ''
  )
    .trim()
    .toUpperCase();
  return code === 'STO';
}

/** Остаток на складе только по позициям с открытой сделкой (последний приход). */
export function dealLinkedStockOnWarehouse(warehouseId: string): {
  lines: number;
  qty: number;
  deals: number;
} {
  const wh = String(warehouseId || '').trim();
  if (!wh) return { lines: 0, qty: 0, deals: 0 };
  const row = get<{ lines: number; qty: number; deals: number }>(
    `${OPEN_DEAL_LATEST_INBOUND_CTE}
     SELECT COUNT(*) AS lines,
            IFNULL(SUM(b.qty), 0) AS qty,
            COUNT(DISTINCT o.deal_id) AS deals
     FROM open_deal_inbound o
     INNER JOIN stock_balances b
       ON b.warehouse_id = o.warehouse_id AND b.product_id = o.product_id
     WHERE o.rn = 1 AND o.warehouse_id = ? AND b.qty > 0`,
    [wh]
  );
  return {
    lines: Number(row?.lines) || 0,
    qty: Number(row?.qty) || 0,
    deals: Number(row?.deals) || 0,
  };
}

/** Открытые сделки по каждому складу (для карточек / stock-totals). */
export function openDealsCountByWarehouse(): Map<string, number> {
  const rows = all<{ warehouse_id: string; c: number }>(
    `${OPEN_DEAL_LATEST_INBOUND_CTE}
     SELECT warehouse_id, COUNT(DISTINCT deal_id) AS c
     FROM open_deal_inbound
     WHERE rn = 1
     GROUP BY warehouse_id`
  );
  const map = new Map(rows.map((r) => [String(r.warehouse_id), Number(r.c) || 0]));
  // Отложено под СТО: сделок на карточке не показываем (это не «склад сделок»)
  for (const r of all<{ id: string }>(
    `SELECT id FROM warehouses WHERE UPPER(IFNULL(code,'')) LIKE 'STO-RES-%'`
  )) {
    map.set(String(r.id), 0);
  }
  return map;
}

export type OpenDealLink = {
  deal_id: string;
  deal_name: string;
  status_name: string;
  amo_channel: string;
  responsible_user_id: string;
  responsible_name: string;
};

function staffNamesByAmoId(amoIds: string[]): Map<string, string> {
  const ids = [...new Set(amoIds.map(String).filter(Boolean))];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const rows = all<{ amo_id: string; name: string }>(
    `SELECT amo_id, name FROM staff WHERE amo_id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  for (const r of rows) {
    const id = String(r.amo_id || '');
    const name = String(r.name || '').trim();
    if (id && name) map.set(id, name);
  }
  return map;
}

function enrichOpenDealLinks(links: OpenDealLink[]): OpenDealLink[] {
  const names = staffNamesByAmoId(links.map((l) => l.responsible_user_id));
  return links.map((l) => ({
    ...l,
    responsible_name:
      (l.responsible_user_id && names.get(l.responsible_user_id)) || l.responsible_name || '',
  }));
}

/** Привязка строк остатков к сделке переноса (товар+склад → последний проведённый приход).
 * «Отложено под СТО» — без сделок в UI (это не склад сделок). */
export function openDealLinksForStockRows(
  rows: Array<{ product_id: string; warehouse_id: string }>
): Map<string, OpenDealLink[]> {
  const out = new Map<string, OpenDealLink[]>();
  if (!rows.length) return out;
  const productIds = [...new Set(rows.map((r) => String(r.product_id || '').trim()).filter(Boolean))];
  if (!productIds.length) return out;
  const whIds = [
    ...new Set(
      rows
        .map((r) => String(r.warehouse_id || '').trim())
        .filter((id) => id && !isStoHoldWarehouseId(id))
    ),
  ];
  if (!whIds.length) return out;
  const params: string[] = [...productIds];
  let whSql = '';
  if (whIds.length === 1) {
    whSql = 'AND b.warehouse_id = ?';
    params.push(whIds[0]!);
  } else if (whIds.length > 1 && whIds.length <= 40) {
    whSql = `AND b.warehouse_id IN (${whIds.map(() => '?').join(',')})`;
    params.push(...whIds);
  }
  const links = all<{
    warehouse_id: string;
    product_id: string;
    deal_id: string;
    deal_name: string;
    status_name: string;
    amo_channel: string;
    responsible_user_id: string;
    doc_created_at: string;
  }>(
    `SELECT b.warehouse_id, b.product_id, d.deal_id,
            IFNULL(deal.name,'') AS deal_name,
            IFNULL(deal.status_name,'') AS status_name,
            IFNULL(deal.amo_channel,'') AS amo_channel,
            IFNULL(deal.responsible_user_id,'') AS responsible_user_id,
            IFNULL(d.created_at, d.doc_date) AS doc_created_at
     ${OPEN_DEAL_STOCK_JOIN_SQL}
       AND b.product_id IN (${productIds.map(() => '?').join(',')})
       ${whSql}
     ORDER BY datetime(IFNULL(d.created_at, d.doc_date)) DESC, d.number DESC`,
    params
  );
  const pendingKeys: string[] = [];
  const pending: OpenDealLink[] = [];
  for (const row of links) {
    const key = `${row.product_id}\0${row.warehouse_id}`;
    if (out.has(key)) continue;
    if (isStoHoldWarehouseId(String(row.warehouse_id))) continue;
    pendingKeys.push(key);
    pending.push({
      deal_id: String(row.deal_id),
      deal_name: String(row.deal_name || ''),
      status_name: String(row.status_name || ''),
      amo_channel: String(row.amo_channel || ''),
      responsible_user_id: String(row.responsible_user_id || ''),
      responsible_name: '',
    });
  }
  enrichOpenDealLinks(pending).forEach((link, i) => {
    const key = pendingKeys[i];
    if (key) out.set(key, [link]);
  });
  return out;
}

function saleWriteOffComment(dealId: string): string {
  return `Списание по продаже · склад СТО · заказ ${String(dealId || '').trim()}`;
}

/** Сколько спустили на СТО по сделке (все проведённые TR «Спуск» / Резерв→СТО). */
function dealDescendedToStoQtyByProduct(dealId: string): Map<string, number> {
  const id = String(dealId || '').trim();
  const stoWh = stoWarehouseId();
  const map = new Map<string, number>();
  if (!id || !stoWh) return map;
  const rows = all<{ product_id: string; qty: number }>(
    `SELECT l.product_id AS product_id, IFNULL(SUM(l.qty), 0) AS qty
     FROM stock_docs d
     INNER JOIN stock_doc_lines l ON l.doc_id = d.id
     LEFT JOIN warehouses wf ON wf.id = d.warehouse_id
     LEFT JOIN products p ON p.id = l.product_id
     WHERE d.deal_id = ?
       AND IFNULL(d.posted, 0) = 1
       AND d.doc_type = 'transfer'
       AND d.warehouse_to_id = ?
       AND IFNULL(p.item_kind, 'product') != 'service'
       AND (
         IFNULL(d.comment, '') LIKE '%Спуск на СТО%'
         OR UPPER(IFNULL(wf.code, '')) LIKE 'STO-RES-%'
         OR UPPER(IFNULL(wf.code, '')) LIKE 'STO-RSV-%'
       )
     GROUP BY l.product_id`,
    [id, stoWh]
  );
  for (const r of rows) {
    const pid = String(r.product_id || '').trim();
    const q = Number(r.qty) || 0;
    if (pid && q > 0) map.set(pid, (map.get(pid) || 0) + q);
  }
  return map;
}

/** Уже списано со СТО по продаже этой сделки. */
function dealSaleWriteOffQtyByProduct(dealId: string): Map<string, number> {
  const id = String(dealId || '').trim();
  const stoWh = stoWarehouseId();
  const map = new Map<string, number>();
  if (!id || !stoWh) return map;
  const rows = all<{ product_id: string; qty: number }>(
    `SELECT l.product_id AS product_id, IFNULL(SUM(l.qty), 0) AS qty
     FROM stock_docs d
     INNER JOIN stock_doc_lines l ON l.doc_id = d.id
     WHERE d.deal_id = ?
       AND IFNULL(d.posted, 0) = 1
       AND d.doc_type = 'out'
       AND IFNULL(d.comment, '') LIKE '%Списание по продаже%'
       AND (
         d.warehouse_id = ?
         OR IFNULL(l.warehouse_id, '') = ?
         OR IFNULL(l.warehouse_id, '') = ''
       )
     GROUP BY l.product_id`,
    [id, stoWh, stoWh]
  );
  for (const r of rows) {
    const pid = String(r.product_id || '').trim();
    const q = Number(r.qty) || 0;
    if (pid && q > 0) map.set(pid, (map.get(pid) || 0) + q);
  }
  return map;
}

export type DealWarehouseChainStep = {
  step: 'main_to_reserve' | 'reserve_to_sto' | 'sale_writeoff';
  status: 'done' | 'pending' | 'none';
  label: string;
  doc_id?: string;
  doc_number?: string;
  doc_date?: string;
  qty?: number;
};

/** Проведённое списание по продаже со СТО (если уже было). */
export function getDealSaleWriteOffDoc(dealId: string): Record<string, unknown> | null {
  const id = String(dealId || '').trim();
  if (!id) return null;
  return (
    get<Record<string, unknown>>(
      `SELECT id, number, doc_date, posted, comment, created_at
       FROM stock_docs
       WHERE deal_id = ?
         AND doc_type = 'out'
         AND IFNULL(posted,0) = 1
         AND IFNULL(comment,'') LIKE '%Списание по продаже%'
       ORDER BY datetime(created_at) DESC
       LIMIT 1`,
      [id]
    ) || null
  );
}

/** Цепочка склада по сделке: основной → резерв → СТО → списание при продаже. */
export function buildDealWarehouseChain(dealId: string): DealWarehouseChainStep[] {
  const id = String(dealId || '').trim();
  if (!id) return [];

  const docs = all<{
    id: string;
    number: string;
    doc_type: string;
    posted: number;
    comment: string;
    doc_date: string;
    created_at: string;
    from_code: string;
    from_name: string;
    to_code: string;
    to_name: string;
    qty_sum: number;
  }>(
    `SELECT d.id, d.number, d.doc_type, IFNULL(d.posted,0) AS posted,
            IFNULL(d.comment,'') AS comment, IFNULL(d.doc_date,'') AS doc_date,
            IFNULL(d.created_at,'') AS created_at,
            IFNULL(wf.code,'') AS from_code, IFNULL(wf.name,'') AS from_name,
            IFNULL(wt.code,'') AS to_code, IFNULL(wt.name,'') AS to_name,
            (SELECT IFNULL(SUM(l.qty),0) FROM stock_doc_lines l WHERE l.doc_id = d.id) AS qty_sum
     FROM stock_docs d
     LEFT JOIN warehouses wf ON wf.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     WHERE d.deal_id = ?
       AND d.doc_type IN ('transfer','out')
     ORDER BY datetime(COALESCE(NULLIF(d.doc_date,''), d.created_at)) ASC, d.number ASC`,
    [id]
  );

  const openReserveDraft = get<{ id: string; number: string }>(
    `SELECT id, IFNULL(number,'') AS number FROM stock_docs
     WHERE deal_id = ? AND doc_type = 'out'
       AND comment LIKE '%Передача на склад%'
       AND comment NOT LIKE '%Спуск на СТО%'
       AND IFNULL(posted,0) = 0
     LIMIT 1`,
    [id]
  );
  const openToStoDraft = get<{ id: string; number: string }>(
    `SELECT id, IFNULL(number,'') AS number FROM stock_docs
     WHERE deal_id = ? AND doc_type = 'out'
       AND comment LIKE '%Спуск на СТО%'
       AND IFNULL(posted,0) = 0
     LIMIT 1`,
    [id]
  );

  const isReserveCode = (code: string) =>
    /^STO-RES/i.test(String(code || '').trim()) || /^STO-RSV/i.test(String(code || '').trim());
  const mainToReserve = docs.find(
    (d) =>
      Number(d.posted) === 1 &&
      d.doc_type === 'transfer' &&
      !/Спуск на СТО/i.test(d.comment) &&
      (isReserveCode(d.to_code) ||
        (/Передача на склад|Склад ГОТОВО/i.test(d.comment) && !/Спуск на СТО/i.test(d.comment)))
  );
  const reserveToStoDocs = docs.filter(
    (d) =>
      Number(d.posted) === 1 &&
      d.doc_type === 'transfer' &&
      (/Спуск на СТО/i.test(d.comment) ||
        (isReserveCode(d.from_code) && String(d.to_code || '').toUpperCase() === 'STO'))
  );
  const reserveToSto = reserveToStoDocs.length ? reserveToStoDocs[reserveToStoDocs.length - 1] : null;
  const reservePending = dealReservePendingToStoLines(id);
  const saleWo = getDealSaleWriteOffDoc(id);

  const step = (
    key: DealWarehouseChainStep['step'],
    label: string,
    doneDoc?: { id: string; number: string; doc_date: string; qty_sum: number } | null,
    pendingDoc?: { id: string; number: string } | null
  ): DealWarehouseChainStep => {
    if (doneDoc) {
      return {
        step: key,
        status: 'done',
        label,
        doc_id: doneDoc.id,
        doc_number: doneDoc.number,
        doc_date: String(doneDoc.doc_date || '').slice(0, 10),
        qty: Number(doneDoc.qty_sum) || undefined,
      };
    }
    if (pendingDoc) {
      return {
        step: key,
        status: 'pending',
        label,
        doc_id: pendingDoc.id,
        doc_number: pendingDoc.number,
      };
    }
    return { step: key, status: 'none', label };
  };

  return [
    step(
      'main_to_reserve',
      'Основной → резерв СТО',
      mainToReserve || null,
      openReserveDraft
    ),
    step(
      'reserve_to_sto',
      'Резерв → СТО (самовывоз / автосервис)',
      reservePending.length === 0 && reserveToSto ? reserveToSto : null,
      openToStoDraft
    ),
    step(
      'sale_writeoff',
      'Списано со склада СТО = продажа',
      saleWo
        ? {
            id: String(saleWo.id),
            number: String(saleWo.number || ''),
            doc_date: String(saleWo.doc_date || ''),
            qty_sum: Number(
              get<{ q: number }>(
                `SELECT IFNULL(SUM(qty),0) AS q FROM stock_doc_lines WHERE doc_id = ?`,
                [String(saleWo.id)]
              )?.q || 0
            ),
          }
        : null,
      null
    ),
  ];
}

/**
 * Списать товар со склада СТО при успешной продаже (Автосервис / Самовывоз).
 * Списываем всё, что спустили на СТО по сделке (сумма TR), а не только qty строк заказа.
 * Если уже было частичное списание — досписываем остаток. Не создаёт УПД.
 */
export function writeOffStoOnDealSuccess(
  dealId: string,
  opts?: { createdBy?: string; requireSuccess?: boolean }
): {
  ok: boolean;
  skipped?: boolean;
  already?: boolean;
  written_off?: boolean;
  reason?: string;
  stock_doc_id?: string | null;
  stock_doc_number?: string | null;
  lines_count?: number;
} {
  const id = String(dealId || '').trim();
  if (!id) return { ok: false, reason: 'no deal' };

  const deal = get<{ amo_channel: string; amo_shipment: string; ship_channel: string }>(
    `SELECT IFNULL(amo_channel,'') AS amo_channel,
            IFNULL(amo_shipment,'') AS amo_shipment,
            IFNULL(ship_channel,'') AS ship_channel
     FROM crm_deals WHERE id = ?`,
    [id]
  );
  if (!deal) throw new Error('Сделка не найдена');
  if (!isReserveChannelDeal(deal)) {
    return { ok: true, skipped: true, reason: 'not_reserve_channel' };
  }

  const requireSuccess = opts?.requireSuccess !== false;
  if (requireSuccess && !dealIsSuccessful(id)) {
    return { ok: true, skipped: true, reason: 'deal_not_success' };
  }

  const stoWh = stoWarehouseId();
  const descended = dealDescendedToStoQtyByProduct(id);
  const alreadyOff = dealSaleWriteOffQtyByProduct(id);

  // Основной источник — спуски; иначе (нет TR) — строки заказа.
  const productIds =
    descended.size > 0
      ? [...descended.keys()]
      : all<{ product_id: string }>(
          `SELECT DISTINCT IFNULL(i.product_guid,'') AS product_id
           FROM crm_deal_items i
           LEFT JOIN products p ON p.id = i.product_guid
           WHERE i.deal_id = ? AND IFNULL(p.item_kind,'product') != 'service'`,
          [id]
        )
          .map((r) => String(r.product_id || '').trim())
          .filter(Boolean);

  const lines: Array<{ product_id: string; qty: number; warehouse_id: string }> = [];
  for (const productId of productIds) {
    let need = 0;
    if (descended.size > 0) {
      need = (descended.get(productId) || 0) - (alreadyOff.get(productId) || 0);
    } else {
      const dealQty =
        Number(
          get<{ qty: number }>(
            `SELECT IFNULL(SUM(qty),0) AS qty FROM crm_deal_items
             WHERE deal_id = ? AND product_guid = ?`,
            [id, productId]
          )?.qty
        ) || 0;
      need = dealQty - (alreadyOff.get(productId) || 0);
    }
    need = Math.max(0, need);
    if (!(need > 0)) continue;
    const onSto =
      Number(
        get<{ qty: number }>(
          `SELECT IFNULL(qty,0) AS qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`,
          [stoWh, productId]
        )?.qty
      ) || 0;
    const writeQty = Math.min(need, onSto);
    if (writeQty > 0) {
      lines.push({ product_id: productId, qty: writeQty, warehouse_id: stoWh });
    }
  }

  const existing = getDealSaleWriteOffDoc(id);
  if (!lines.length) {
    if (existing) {
      return {
        ok: true,
        already: true,
        stock_doc_id: String(existing.id),
        stock_doc_number: String(existing.number || ''),
      };
    }
    return { ok: true, skipped: true, reason: 'nothing_on_sto' };
  }

  const actor = String(opts?.createdBy || '').trim();
  const commentBase = actor
    ? `${saleWriteOffComment(id)} · ${actor}`
    : saleWriteOffComment(id);
  const comment = existing
    ? `${commentBase} · досписание спущенного на СТО`
    : commentBase;

  const stockDocId = createDocument({
    doc_type: 'out',
    warehouse_id: stoWh,
    deal_id: id,
    basis_order_id: id,
    comment,
    lines,
    post: true,
  });
  const stockDoc = get<{ number: string }>('SELECT number FROM stock_docs WHERE id = ?', [
    stockDocId,
  ]);
  writeMetaJson(SALE_WRITEOFF_META(id), {
    at: new Date().toISOString(),
    doc_id: stockDocId,
    number: stockDoc?.number || '',
    lines_count: lines.length,
    by: actor || null,
    supplemental: Boolean(existing),
    by_descended: descended.size > 0,
  });

  const amoNote = `Товары списаны со склада СТО = продажа · заказ ${id}${
    stockDoc?.number ? ' · ' + String(stockDoc.number) : ''
  }${existing ? ' · досписание спущенного' : ''}${actor ? ' · ' + actor : ''}`;
  void notifyAmoWarehousePacked({ dealId: id, text: amoNote }).then((r) => {
    if (!r.ok) {
      writeMetaJson(`amo_note_err:writeoff:${id}`, {
        at: new Date().toISOString(),
        text: amoNote,
        error: r.error || 'amo note failed',
      });
    }
  });

  return {
    ok: true,
    written_off: true,
    stock_doc_id: stockDocId,
    stock_doc_number: stockDoc?.number || null,
    lines_count: lines.length,
  };
}

/** После синка Amo: этап сменился на «Успешно» — списать со СТО, если ещё не списано. */
export function maybeWriteOffStoAfterAmoStatusSync(
  dealId: string,
  prevStatusId: string,
  nextStatusId: string,
  createdBy = 'синк Amo'
): ReturnType<typeof writeOffStoOnDealSuccess> | { ok: true; skipped: true; reason: string } {
  const id = String(dealId || '').trim();
  if (!id) return { ok: true, skipped: true, reason: 'no deal' };
  if (rawStatusId(prevStatusId) === rawStatusId(nextStatusId)) {
    return { ok: true, skipped: true, reason: 'status_unchanged' };
  }
  if (!dealIsSuccessful(id)) {
    return { ok: true, skipped: true, reason: 'not_success' };
  }
  try {
    return writeOffStoOnDealSuccess(id, { createdBy, requireSuccess: true });
  } catch (e) {
    writeMetaJson(`stock_flow_sale_writeoff_err:${id}`, {
      at: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

const COURIER_DELIVERED_META = (dealId: string) =>
  `stock_flow_courier_delivered:${String(dealId || '').trim()}`;

function courierWriteOffComment(dealId: string): string {
  return `Списание по продаже · курьер отвез продажа · заказ ${String(dealId || '').trim()}`;
}

/** Списание со склада «Курьер» когда курьер нажал «Доставил». */
export function writeOffCourierOnDelivered(
  dealId: string,
  opts?: { createdBy?: string; actor_name?: string }
): {
  ok: boolean;
  skipped?: boolean;
  already?: boolean;
  written_off?: boolean;
  reason?: string;
  stock_doc_id?: string | null;
  stock_doc_number?: string | null;
  lines_count?: number;
} {
  const id = String(dealId || '').trim();
  if (!id) return { ok: false, reason: 'no deal' };

  const existing = get<{ id: string; number: string }>(
    `SELECT id, IFNULL(number,'') AS number FROM stock_docs
     WHERE deal_id = ?
       AND doc_type = 'out'
       AND IFNULL(posted,0) = 1
       AND IFNULL(comment,'') LIKE '%курьер отвез%'
     ORDER BY datetime(created_at) DESC
     LIMIT 1`,
    [id]
  );
  if (existing?.id) {
    return {
      ok: true,
      already: true,
      stock_doc_id: String(existing.id),
      stock_doc_number: String(existing.number || ''),
    };
  }

  // старые списания с формулировкой «курьер отвёз»
  const existingOld = get<{ id: string; number: string }>(
    `SELECT id, IFNULL(number,'') AS number FROM stock_docs
     WHERE deal_id = ?
       AND doc_type = 'out'
       AND IFNULL(posted,0) = 1
       AND IFNULL(comment,'') LIKE '%курьер отвёз%'
     ORDER BY datetime(created_at) DESC
     LIMIT 1`,
    [id]
  );
  if (existingOld?.id) {
    return {
      ok: true,
      already: true,
      stock_doc_id: String(existingOld.id),
      stock_doc_number: String(existingOld.number || ''),
    };
  }

  const deal = get<{ amo_channel: string; amo_shipment: string; ship_channel: string }>(
    `SELECT IFNULL(amo_channel,'') AS amo_channel,
            IFNULL(amo_shipment,'') AS amo_shipment,
            IFNULL(ship_channel,'') AS ship_channel
     FROM crm_deals WHERE id = ?`,
    [id]
  );
  if (!deal) throw new Error('Сделка не найдена');
  if (!isShipChannelDeal(deal)) {
    return { ok: true, skipped: true, reason: 'not_ship_channel' };
  }

  const courierWh = courierWarehouseId();
  const itemRows = all<{ product_id: string; qty: number }>(
    `SELECT IFNULL(i.product_guid,'') AS product_id, IFNULL(i.qty,0) AS qty
     FROM crm_deal_items i
     LEFT JOIN products p ON p.id = i.product_guid
     WHERE i.deal_id = ? AND IFNULL(p.item_kind,'product') != 'service'
     ORDER BY i.line_no ASC`,
    [id]
  );

  const lines: Array<{ product_id: string; qty: number; warehouse_id: string }> = [];
  for (const row of itemRows) {
    const productId = String(row.product_id || '').trim();
    const need = Math.max(0, Number(row.qty) || 0);
    if (!productId || !(need > 0)) continue;
    const onCourier =
      Number(
        get<{ qty: number }>(
          `SELECT IFNULL(qty,0) AS qty FROM stock_balances WHERE warehouse_id = ? AND product_id = ?`,
          [courierWh, productId]
        )?.qty
      ) || 0;
    const writeQty = Math.min(need, onCourier);
    if (writeQty > 0) {
      lines.push({ product_id: productId, qty: writeQty, warehouse_id: courierWh });
    }
  }

  if (!lines.length) {
    return { ok: true, skipped: true, reason: 'nothing_on_courier' };
  }

  const actor = String(opts?.actor_name || opts?.createdBy || '').trim();
  const comment = actor ? `${courierWriteOffComment(id)} · ${actor}` : courierWriteOffComment(id);

  const stockDocId = createDocument({
    doc_type: 'out',
    warehouse_id: courierWh,
    deal_id: id,
    basis_order_id: id,
    comment,
    lines,
    post: true,
  });
  const stockDoc = get<{ number: string }>('SELECT number FROM stock_docs WHERE id = ?', [
    stockDocId,
  ]);

  writeMetaJson(COURIER_DELIVERED_META(id), {
    at: new Date().toISOString(),
    doc_id: stockDocId,
    number: stockDoc?.number || '',
    lines_count: lines.length,
    by: actor || null,
  });
  writeMetaJson(SALE_WRITEOFF_META(id), {
    at: new Date().toISOString(),
    doc_id: stockDocId,
    number: stockDoc?.number || '',
    lines_count: lines.length,
    by: actor || null,
    source: 'courier',
  });

  const amoNote = `курьер отвез продажа · заказ ${id}${
    stockDoc?.number ? ' · ' + String(stockDoc.number) : ''
  }${actor ? ' · ' + actor : ''}`;
  void notifyAmoCourierDeliveredOnce({ dealId: id, text: amoNote }).catch(() => {});

  return {
    ok: true,
    written_off: true,
    stock_doc_id: stockDocId,
    stock_doc_number: stockDoc?.number || null,
    lines_count: lines.length,
  };
}

/** Вечерний / ручной cron: успешные сделки с товаром на СТО без списания. */
export function runStoSaleWriteoffCron(limit = 80): {
  scanned: number;
  written: number;
  skipped: number;
  errors: Array<{ deal_id: string; error: string }>;
  items: Array<Record<string, unknown>>;
} {
  const cap = Math.min(200, Math.max(1, limit));
  const candidates = all<{ id: string }>(
    `SELECT DISTINCT d.id
     FROM crm_deals d
     INNER JOIN stock_docs sd ON sd.deal_id = d.id
       AND sd.doc_type = 'transfer' AND IFNULL(sd.posted,0) = 1
     INNER JOIN warehouses wt ON wt.id = sd.warehouse_to_id
       AND UPPER(IFNULL(wt.code,'')) = 'STO'
     WHERE datetime(COALESCE(NULLIF(sd.doc_date,''), sd.created_at)) >= datetime('now', '-180 days')
     ORDER BY datetime(sd.created_at) DESC
     LIMIT ?`,
    [cap * 8]
  );

  const items: Array<Record<string, unknown>> = [];
  const errors: Array<{ deal_id: string; error: string }> = [];
  let written = 0;
  let skipped = 0;

  for (const row of candidates) {
    if (items.length >= cap) break;
    const dealId = String(row.id || '').trim();
    if (!dealId) continue;
    if (!dealIsSuccessful(dealId)) {
      skipped += 1;
      continue;
    }
    const ch = get<{ amo_channel: string; amo_shipment: string; ship_channel: string }>(
      `SELECT IFNULL(amo_channel,'') AS amo_channel,
              IFNULL(amo_shipment,'') AS amo_shipment,
              IFNULL(ship_channel,'') AS ship_channel
       FROM crm_deals WHERE id = ?`,
      [dealId]
    );
    if (!isReserveChannelDeal(ch)) {
      skipped += 1;
      continue;
    }
    if (getDealSaleWriteOffDoc(dealId)) {
      skipped += 1;
      continue;
    }
    if (!dealHasStockOnSto(dealId)) {
      skipped += 1;
      continue;
    }
    try {
      const r = writeOffStoOnDealSuccess(dealId, {
        createdBy: 'cron · вечернее списание СТО',
        requireSuccess: true,
      });
      items.push({ deal_id: dealId, ...r });
      if (r.written_off) written += 1;
      else skipped += 1;
    } catch (e) {
      errors.push({
        deal_id: dealId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    scanned: candidates.length,
    written,
    skipped,
    errors,
    items,
  };
}
