/**
 * Маркировка / Честный знак — фундамент Этапов 4–5.
 *
 * Партии + DataMatrix + события сканирования.
 * Интеграция ЦРПТ (заказ КМ, ввод/вывод) — заготовка (crptConfigured / stubs).
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';

/** Статусы кода DataMatrix по жизненному циклу */
export const DM_STATUSES = [
  'ordered', // заказан в ЦРПТ (Э5)
  'emitted', // эмитирован
  'received', // принят на склад (скан при приёмке)
  'aggregated', // в агрегате (короб/паллета)
  'in_stock', // на остатке, готов к продаже
  'reserved', // резерв под заказ/сделку
  'sold', // продан (привязан к сделке)
  'withdrawn', // выведен из оборота (продажа / иное)
  'returned', // возврат на склад
  'defect', // брак / утилизация
] as const;

export type DmStatus = (typeof DM_STATUSES)[number];

export const LOT_STATUSES = ['draft', 'in_transit', 'received', 'closed'] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export type ProductLot = {
  id: string;
  product_id: string;
  lot_number: string;
  factory: string;
  production_date: string;
  arrived_at: string;
  warehouse_id: string;
  gtin: string;
  qty_planned: number;
  qty_received: number;
  status: LotStatus;
  comment: string;
  created_at?: string;
};

export type DatamatrixCode = {
  id: string;
  code: string;
  product_id: string;
  lot_id: string;
  gtin: string;
  serial: string;
  status: DmStatus;
  aggregate_id: string;
  warehouse_id: string;
  deal_id: string;
  stock_doc_id: string;
  scanned_at: string;
  withdrawn_at: string;
  meta_json: string;
};

export function crptConfigured(): boolean {
  return Boolean(
    (process.env.CRPT_API_URL || '').trim()
      && (process.env.CRPT_TOKEN || process.env.CRPT_CLIENT_ID || '').trim()
  );
}

export function markingMeta() {
  return {
    ready: true,
    stage: 'foundation', // foundation → stage4_lots → stage5_crpt
    crpt: {
      configured: crptConfigured(),
      api_url: (process.env.CRPT_API_URL || '').trim() || null,
      note: 'ЦРПТ подключается на Этапе 5. Сейчас — локальный учёт кодов и партий.',
    },
    dm_statuses: DM_STATUSES,
    lot_statuses: LOT_STATUSES,
    label_format: 'sku;factory;lot;date', // формат наклейки из ТЗ
    counts: {
      lots: get<{ c: number }>('SELECT COUNT(*) AS c FROM product_lots')?.c ?? 0,
      codes: get<{ c: number }>('SELECT COUNT(*) AS c FROM datamatrix_codes')?.c ?? 0,
      in_stock:
        get<{ c: number }>(
          `SELECT COUNT(*) AS c FROM datamatrix_codes WHERE status IN ('in_stock','received')`
        )?.c ?? 0,
      withdrawn:
        get<{ c: number }>(
          `SELECT COUNT(*) AS c FROM datamatrix_codes WHERE status IN ('sold','withdrawn')`
        )?.c ?? 0,
    },
  };
}

function logEvent(opts: {
  code_id?: string | null;
  lot_id?: string | null;
  event: string;
  actor_id?: string;
  payload?: Record<string, unknown>;
}): void {
  run(
    `INSERT INTO marking_events (id, code_id, lot_id, event, actor_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      newGuid(),
      opts.code_id || null,
      opts.lot_id || null,
      opts.event,
      opts.actor_id || '',
      JSON.stringify(opts.payload || {}),
    ]
  );
}

/** Парсинг наклейки ТЗ: артикул;завод;партия;дата */
export function parseMarkingLabel(raw: string): {
  sku: string;
  factory: string;
  lot: string;
  date: string;
} {
  const parts = String(raw || '')
    .trim()
    .split(';')
    .map((s) => s.trim());
  return {
    sku: parts[0] || '',
    factory: parts[1] || '',
    lot: parts[2] || '',
    date: parts[3] || '',
  };
}

/** Извлечь GTIN / serial из строки DataMatrix (упрощённо, без полного GS1) */
export function parseDatamatrixPayload(raw: string): { gtin: string; serial: string; raw: string } {
  const code = String(raw || '').trim();
  // Частый вид: (01)GTIN(21)SERIAL...
  const gtinM = code.match(/\(01\)(\d{8,14})/) || code.match(/^01(\d{14})/);
  const serialM = code.match(/\(21\)([^\s(]+)/) || code.match(/21([^\x1d]+)/);
  return {
    gtin: gtinM?.[1] || '',
    serial: serialM?.[1] || '',
    raw: code,
  };
}

export function listLots(opts: {
  product_id?: string;
  warehouse_id?: string;
  status?: string;
  q?: string;
  limit?: number;
}): Array<ProductLot & { product_sku?: string; product_name?: string; warehouse_name?: string }> {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.product_id) {
    where.push('l.product_id = ?');
    params.push(opts.product_id);
  }
  if (opts.warehouse_id) {
    where.push('l.warehouse_id = ?');
    params.push(opts.warehouse_id);
  }
  if (opts.status) {
    where.push('l.status = ?');
    params.push(opts.status);
  }
  if (opts.q?.trim()) {
    where.push(
      `(l.lot_number LIKE ? OR l.factory LIKE ? OR IFNULL(p.sku,'') LIKE ? OR IFNULL(p.name,'') LIKE ?)`
    );
    const like = `%${opts.q.trim()}%`;
    params.push(like, like, like, like);
  }
  const limit = Math.min(500, Math.max(1, opts.limit || 100));
  const sql = `SELECT l.*, p.sku AS product_sku, p.name AS product_name, w.name AS warehouse_name
    FROM product_lots l
    LEFT JOIN products p ON p.id = l.product_id
    LEFT JOIN warehouses w ON w.id = l.warehouse_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY l.arrived_at DESC, l.created_at DESC
    LIMIT ?`;
  params.push(limit);
  return all(sql, params) as Array<
    ProductLot & { product_sku?: string; product_name?: string; warehouse_name?: string }
  >;
}

export function createLot(input: {
  product_id: string;
  lot_number: string;
  factory?: string;
  production_date?: string;
  arrived_at?: string;
  warehouse_id?: string;
  gtin?: string;
  qty_planned?: number;
  status?: LotStatus;
  comment?: string;
  actor_id?: string;
}): ProductLot {
  const product = get('SELECT id FROM products WHERE id = ?', [input.product_id]);
  if (!product) throw new Error('product not found');
  const lotNumber = String(input.lot_number || '').trim();
  if (!lotNumber) throw new Error('lot_number required');
  const id = newGuid();
  const status: LotStatus = input.status && LOT_STATUSES.includes(input.status) ? input.status : 'draft';
  run(
    `INSERT INTO product_lots
      (id, product_id, lot_number, factory, production_date, arrived_at, warehouse_id, gtin,
       qty_planned, qty_received, status, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      input.product_id,
      lotNumber,
      String(input.factory || '').trim(),
      String(input.production_date || '').trim(),
      String(input.arrived_at || new Date().toISOString().slice(0, 10)),
      String(input.warehouse_id || '').trim(),
      String(input.gtin || '').trim(),
      Number(input.qty_planned) || 0,
      status,
      String(input.comment || '').trim(),
    ]
  );
  logEvent({
    lot_id: id,
    event: 'lot.created',
    actor_id: input.actor_id,
    payload: { lot_number: lotNumber, product_id: input.product_id },
  });
  return get('SELECT * FROM product_lots WHERE id = ?', [id]) as unknown as ProductLot;
}

export function listCodes(opts: {
  product_id?: string;
  lot_id?: string;
  status?: string;
  deal_id?: string;
  q?: string;
  limit?: number;
}): Array<DatamatrixCode & { product_sku?: string; product_name?: string }> {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.product_id) {
    where.push('d.product_id = ?');
    params.push(opts.product_id);
  }
  if (opts.lot_id) {
    where.push('d.lot_id = ?');
    params.push(opts.lot_id);
  }
  if (opts.status) {
    where.push('d.status = ?');
    params.push(opts.status);
  }
  if (opts.deal_id) {
    where.push('d.deal_id = ?');
    params.push(opts.deal_id);
  }
  if (opts.q?.trim()) {
    where.push(`(d.code LIKE ? OR d.serial LIKE ? OR d.gtin LIKE ? OR IFNULL(p.sku,'') LIKE ?)`);
    const like = `%${opts.q.trim()}%`;
    params.push(like, like, like, like);
  }
  const limit = Math.min(1000, Math.max(1, opts.limit || 100));
  params.push(limit);
  return all(
    `SELECT d.*, p.sku AS product_sku, p.name AS product_name
     FROM datamatrix_codes d
     LEFT JOIN products p ON p.id = d.product_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY d.scanned_at DESC, d.created_at DESC
     LIMIT ?`,
    params
  ) as unknown as Array<DatamatrixCode & { product_sku?: string; product_name?: string }>;
}

export function registerCode(input: {
  code: string;
  product_id: string;
  lot_id?: string;
  warehouse_id?: string;
  status?: DmStatus;
  actor_id?: string;
}): DatamatrixCode {
  const code = String(input.code || '').trim();
  if (!code) throw new Error('code required');
  const existing = get('SELECT id FROM datamatrix_codes WHERE code = ?', [code]);
  if (existing) throw new Error('code already registered');
  const product = get('SELECT id, gtin FROM products WHERE id = ?', [input.product_id]);
  if (!product) throw new Error('product not found');
  const parsed = parseDatamatrixPayload(code);
  const id = newGuid();
  const status: DmStatus =
    input.status && DM_STATUSES.includes(input.status) ? input.status : 'received';
  run(
    `INSERT INTO datamatrix_codes
      (id, code, product_id, lot_id, gtin, serial, status, aggregate_id, warehouse_id,
       deal_id, stock_doc_id, scanned_at, withdrawn_at, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, '', '', datetime('now'), '', ?)`,
    [
      id,
      code,
      input.product_id,
      String(input.lot_id || '').trim(),
      parsed.gtin || String((product as { gtin?: string }).gtin || ''),
      parsed.serial,
      status,
      String(input.warehouse_id || '').trim(),
      JSON.stringify({ source: 'manual_register' }),
    ]
  );
  if (input.lot_id) {
    run(
      `UPDATE product_lots SET qty_received = qty_received + 1,
         status = CASE WHEN status = 'draft' THEN 'received' ELSE status END
       WHERE id = ?`,
      [input.lot_id]
    );
  }
  logEvent({
    code_id: id,
    lot_id: input.lot_id || null,
    event: 'code.registered',
    actor_id: input.actor_id,
    payload: { status, code: code.slice(0, 64) },
  });
  return get('SELECT * FROM datamatrix_codes WHERE id = ?', [id]) as unknown as DatamatrixCode;
}

/**
 * Скан при приёмке / продаже / выводе.
 * action: receive | sale | withdraw | return | defect
 */
export function scanCode(input: {
  code: string;
  action: 'receive' | 'sale' | 'withdraw' | 'return' | 'defect';
  product_id?: string;
  lot_id?: string;
  warehouse_id?: string;
  deal_id?: string;
  stock_doc_id?: string;
  actor_id?: string;
}): { code: DatamatrixCode; created: boolean } {
  const codeStr = String(input.code || '').trim();
  if (!codeStr) throw new Error('code required');

  let row = get<DatamatrixCode>('SELECT * FROM datamatrix_codes WHERE code = ?', [codeStr]) as
    | DatamatrixCode
    | undefined;
  let created = false;

  if (!row) {
    if (input.action !== 'receive') {
      throw new Error('Код не найден в базе. Сначала приёмка (receive) или регистрация.');
    }
    if (!input.product_id) throw new Error('product_id required for first receive');
    row = registerCode({
      code: codeStr,
      product_id: input.product_id,
      lot_id: input.lot_id,
      warehouse_id: input.warehouse_id,
      status: 'in_stock',
      actor_id: input.actor_id,
    });
    created = true;
  }

  const id = row.id;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let nextStatus: DmStatus = row.status;
  const patch: string[] = [];
  const params: Array<string | number> = [];

  switch (input.action) {
    case 'receive':
      nextStatus = 'in_stock';
      patch.push(`status = ?`, `scanned_at = ?`);
      params.push(nextStatus, now);
      if (input.warehouse_id) {
        patch.push(`warehouse_id = ?`);
        params.push(input.warehouse_id);
      }
      if (input.lot_id) {
        patch.push(`lot_id = ?`);
        params.push(input.lot_id);
      }
      break;
    case 'sale':
      nextStatus = 'sold';
      patch.push(`status = ?`, `deal_id = ?`, `withdrawn_at = ?`);
      params.push(nextStatus, String(input.deal_id || ''), now);
      if (input.stock_doc_id) {
        patch.push(`stock_doc_id = ?`);
        params.push(input.stock_doc_id);
      }
      break;
    case 'withdraw':
      nextStatus = 'withdrawn';
      patch.push(`status = ?`, `withdrawn_at = ?`);
      params.push(nextStatus, now);
      break;
    case 'return':
      nextStatus = 'returned';
      patch.push(`status = ?`, `deal_id = ''`);
      params.push(nextStatus);
      break;
    case 'defect':
      nextStatus = 'defect';
      patch.push(`status = ?`, `withdrawn_at = ?`);
      params.push(nextStatus, now);
      break;
    default:
      throw new Error('unknown action');
  }

  params.push(id);
  run(`UPDATE datamatrix_codes SET ${patch.join(', ')} WHERE id = ?`, params);

  logEvent({
    code_id: id,
    lot_id: row.lot_id || input.lot_id || null,
    event: `code.scan.${input.action}`,
    actor_id: input.actor_id,
    payload: {
      from: row.status,
      to: nextStatus,
      deal_id: input.deal_id || null,
    },
  });

  // Заготовка под ЦРПТ: при sale/withdraw — очередь на вывод из оборота
  if (input.action === 'sale' || input.action === 'withdraw') {
    run(
      `INSERT INTO crpt_outbox (id, code_id, operation, status, payload_json, created_at)
       VALUES (?, ?, 'withdraw', 'pending', ?, datetime('now'))`,
      [
        newGuid(),
        id,
        JSON.stringify({
          code: codeStr.slice(0, 200),
          action: input.action,
          deal_id: input.deal_id || null,
          crpt_ready: crptConfigured(),
        }),
      ]
    );
  }

  return {
    code: get('SELECT * FROM datamatrix_codes WHERE id = ?', [id]) as unknown as DatamatrixCode,
    created,
  };
}

export function createAggregate(input: {
  codes: string[];
  parent_code?: string;
  actor_id?: string;
}): { aggregate_id: string; linked: number } {
  const codes = (input.codes || []).map((c) => String(c).trim()).filter(Boolean);
  if (codes.length < 2) throw new Error('Нужно минимум 2 кода для агрегации');
  const aggId = newGuid();
  const parent = String(input.parent_code || '').trim();
  run(
    `INSERT INTO datamatrix_aggregates (id, parent_code, status, codes_count, created_at)
     VALUES (?, ?, 'active', ?, datetime('now'))`,
    [aggId, parent, codes.length]
  );
  let linked = 0;
  for (const code of codes) {
    const row = get<{ id: string }>('SELECT id FROM datamatrix_codes WHERE code = ?', [code]);
    if (!row) continue;
    run(
      `UPDATE datamatrix_codes SET aggregate_id = ?, status = 'aggregated' WHERE id = ?`,
      [aggId, row.id]
    );
    linked += 1;
    logEvent({
      code_id: row.id,
      event: 'code.aggregated',
      actor_id: input.actor_id,
      payload: { aggregate_id: aggId },
    });
  }
  return { aggregate_id: aggId, linked };
}

export function productMarkingSummary(productId: string) {
  const lots = listLots({ product_id: productId, limit: 50 });
  const codes = listCodes({ product_id: productId, limit: 50 });
  const byStatus = all<{ status: string; c: number }>(
    `SELECT status, COUNT(*) AS c FROM datamatrix_codes WHERE product_id = ? GROUP BY status`,
    [productId]
  );
  const product = get<{ id: string; sku: string; name: string; gtin: string; requires_marking: number }>(
    `SELECT id, sku, name, IFNULL(gtin,'') AS gtin, IFNULL(requires_marking,0) AS requires_marking
     FROM products WHERE id = ?`,
    [productId]
  );
  return { product, lots, codes, by_status: byStatus };
}
