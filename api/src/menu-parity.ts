/**
 * Тонкие журналы/справочники для паритета меню УНФ (без порчи учёта 1С).
 * Пустые состояния OK; проведение затрагивает только локальные stock_balances.
 */
import { all, get, run } from './db.js';
import { bankAccountLinkInfo } from './entity-delete.js';
import { newGuid, nextCode } from './ids.js';
import { companyOrganizationsPayload } from './organizations.js';
import { resolveOrganizationId } from './organizations.js';
import { createDocument } from './stock.js';
import { reportsCatalog, salesAnalysisLive } from './reports-hub.js';
import { atolConfigured } from './atol.js';

const EMPTY = '00000000-0000-0000-0000-000000000000';

export async function upsertGtdFromSync(key: string, codeHint = ''): Promise<void> {
  const id = String(key || '').trim();
  if (!id || id === EMPTY) return;
  const existing = await get<{ id: string; code: string }>('SELECT id, code FROM gtd_numbers WHERE id = ?', [
    id,
  ]);
  if (!existing) {
    await run(
      `INSERT INTO gtd_numbers (id, code, description, source, updated_at)
       VALUES (?, ?, '', '1c', datetime('now'))`,
      [id, codeHint || id.slice(0, 8)]
    );
    return;
  }
  if (codeHint && (!existing.code || existing.code === id.slice(0, 8))) {
    await run(`UPDATE gtd_numbers SET code = ?, updated_at = datetime('now') WHERE id = ?`, [
      codeHint,
      id,
    ]);
  }
}

export async function listGtdNumbers(q = '', limit = 200) {
  const lim = Math.min(500, Math.max(1, Math.floor(Number(limit) || 200)));
  const like = `%${(q || '').trim()}%`;
  const rows = await all<{
    id: string;
    code: string;
    description: string;
    source: string;
    updated_at: string;
    lines_count: number;
  }>(
    `SELECT g.*,
       (SELECT COUNT(*) FROM stock_doc_lines l WHERE l.gtd_key = g.id) AS lines_count
     FROM gtd_numbers g
     WHERE (? = '%%' OR g.code LIKE ? OR g.description LIKE ? OR g.id LIKE ?)
     ORDER BY g.updated_at DESC, g.code
     LIMIT ?`,
    [like, like, like, like, lim]
  );
  return {
    note: 'Справочник номеров ГТД. Ключи тянутся из строк приходных 1С; код/описание можно уточнить вручную (каталог ГТД в OData не опубликован).',
    total: rows.length,
    items: rows,
  };
}

export async function patchGtdNumber(
  id: string,
  patch: { code?: string; description?: string }
): Promise<Record<string, unknown> | null> {
  const row = await get('SELECT * FROM gtd_numbers WHERE id = ?', [id]);
  if (!row) return null;
  if (patch.code != null) {
    await run(`UPDATE gtd_numbers SET code = ?, updated_at = datetime('now') WHERE id = ?`, [
      String(patch.code).trim(),
      id,
    ]);
  }
  if (patch.description != null) {
    await run(`UPDATE gtd_numbers SET description = ?, updated_at = datetime('now') WHERE id = ?`, [
      String(patch.description).trim(),
      id,
    ]);
  }
  return await get('SELECT * FROM gtd_numbers WHERE id = ?', [id]) || null;
}

export async function createGtdNumber(input: { code: string; description?: string }) {
  const code = String(input.code || '').trim();
  if (!code) throw new Error('Укажите номер ГТД');
  const id = newGuid();
  await run(
    `INSERT INTO gtd_numbers (id, code, description, source, updated_at)
     VALUES (?, ?, ?, 'local', datetime('now'))`,
    [id, code, String(input.description || '').trim()]
  );
  return await get('SELECT * FROM gtd_numbers WHERE id = ?', [id]);
}

/** Остатки ниже минимального уровня (min_stock > 0 и qty < min_stock). */
export async function lowStockReport(limit = 300) {
  const lim = Math.min(1000, Math.max(1, Math.floor(Number(limit) || 300)));
  const items = (await all<{
    id: string;
    sku: string;
    name: string;
    brand: string;
    min_stock: number;
    qty: number;
    deficit: number;
  }>(
    `SELECT p.id, p.sku, p.name, IFNULL(p.brand,'') AS brand,
            IFNULL(p.min_stock, 0) AS min_stock,
            IFNULL((
              SELECT SUM(r.qty) FROM product_store_rests r WHERE r.product_id = p.id
            ), 0) AS qty,
            (IFNULL(p.min_stock, 0) - IFNULL((
              SELECT SUM(r.qty) FROM product_store_rests r WHERE r.product_id = p.id
            ), 0)) AS deficit
     FROM products p
     WHERE IFNULL(p.is_active, 1) = 1
       AND IFNULL(p.min_stock, 0) > 0
       AND IFNULL((
         SELECT SUM(r.qty) FROM product_store_rests r WHERE r.product_id = p.id
       ), 0) < IFNULL(p.min_stock, 0)
     ORDER BY deficit DESC, p.name
     LIMIT ?`,
    [lim]
  )).map((r) => ({
    ...r,
    min_stock: Number(r.min_stock) || 0,
    qty: Number(r.qty) || 0,
    deficit: Number(r.deficit) || 0,
  }));
  const unset =
    (await get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM products WHERE IFNULL(is_active,1)=1 AND IFNULL(min_stock,0)=0`
    ))?.c ?? 0;
  return {
    note: 'Позиции, где остаток (Get/Rests) ниже min_stock. Задайте минимум в карточке товара.',
    items,
    products_without_min: unset,
  };
}

export async function listCashArticles() {
  return await all(`SELECT * FROM cash_articles ORDER BY name`);
}

export async function upsertCashArticle(input: {
  id?: string;
  name: string;
  kind?: string;
  is_active?: number;
}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name required');
  const kind = ['in', 'out', 'both'].includes(String(input.kind || ''))
    ? String(input.kind)
    : 'both';
  const id = input.id || newGuid();
  const active = input.is_active == null ? 1 : input.is_active ? 1 : 0;
  await run(
    `INSERT INTO cash_articles (id, name, kind, is_active)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, is_active=excluded.is_active`,
    [id, name, kind, active]
  );
  return await get('SELECT * FROM cash_articles WHERE id = ?', [id]);
}

async function resolveCashRegisterId(preferred?: string): Promise<string> {
  const want = String(preferred || '').trim();
  if (want) {
    const row = await get<{ id: string }>(`SELECT id FROM cash_registers WHERE id = ?`, [want]);
    if (row?.id) return row.id;
  }
  const main =
    await get<{ id: string }>(
      `SELECT id FROM cash_registers WHERE name = 'Основная касса' ORDER BY rowid LIMIT 1`
    ) ||
    await get<{ id: string }>(
      `SELECT id FROM cash_registers WHERE is_active = 1 ORDER BY name LIMIT 1`
    );
  return main?.id || '';
}

export async function listCashDocs(limit = 200, opts?: { cash_register_id?: string }) {
  const lim = Math.min(500, Math.max(1, limit));
  const regId = String(opts?.cash_register_id || '').trim();
  if (regId) {
    return {
      note: 'Локальная касса Учёт №1 (не касса 1С и не Точка). Пусто — нормально до ручного ввода.',
      cash_register_id: regId,
      items: await all(
        `SELECT d.*, a.name AS article_name, r.name AS register_name
         FROM cash_docs d
         LEFT JOIN cash_articles a ON a.id = d.article_id
         LEFT JOIN cash_registers r ON r.id = d.cash_register_id
         WHERE d.cash_register_id = ?
         ORDER BY d.doc_date DESC, d.number DESC
         LIMIT ?`,
        [regId, lim]
      ),
    };
  }
  return {
    note: 'Локальная касса Учёт №1 (не касса 1С и не Точка). Пусто — нормально до ручного ввода.',
    items: await all(
      `SELECT d.*, a.name AS article_name, r.name AS register_name
       FROM cash_docs d
       LEFT JOIN cash_articles a ON a.id = d.article_id
       LEFT JOIN cash_registers r ON r.id = d.cash_register_id
       ORDER BY d.doc_date DESC, d.number DESC
       LIMIT ?`,
      [lim]
    ),
  };
}

export async function createCashDoc(input: {
  doc_type: 'in' | 'out';
  amount: number;
  article_id?: string;
  counterparty_id?: string;
  cash_register_id?: string;
  comment?: string;
  doc_date?: string;
}) {
  if (!['in', 'out'].includes(input.doc_type)) throw new Error('doc_type: in|out');
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new Error('amount > 0');
  const cashRegisterId = await resolveCashRegisterId(input.cash_register_id);
  if (!cashRegisterId) throw new Error('Нет кассы — создайте в справочнике Кассы');
  const id = newGuid();
  const number = await nextCode(input.doc_type === 'in' ? 'CIN' : 'COUT', 5);
  const docDate = (input.doc_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  await run(
    `INSERT INTO cash_docs
      (id, doc_type, number, doc_date, amount, article_id, counterparty_id, cash_register_id, comment, posted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      id,
      input.doc_type,
      number,
      docDate,
      amount,
      input.article_id || null,
      input.counterparty_id || null,
      cashRegisterId,
      String(input.comment || ''),
    ]
  );
  return await get('SELECT * FROM cash_docs WHERE id = ?', [id]);
}

export type CashRegisterBalance = {
  id: string;
  name: string;
  kind: string;
  is_active: number;
  organization_id: string;
  organization_name: string;
  organization_short: string;
  organization_inn: string;
  balance: number;
  docs_count: number;
};

export async function listCashRegistersWithBalances(opts?: {
  organization_id?: string;
  /** Контур (companies.id) — кассы всех юрлиц этого контура. */
  company_id?: string;
  include_inactive?: boolean;
}): Promise<CashRegisterBalance[]> {
  const orgFilter = String(opts?.organization_id || '').trim();
  const companyFilter = String(opts?.company_id || '').trim();
  const where: string[] = [];
  const params: string[] = [];
  if (!opts?.include_inactive) where.push('r.is_active = 1');
  if (orgFilter) {
    where.push('r.organization_id = ?');
    params.push(orgFilter);
  } else if (companyFilter) {
    where.push(
      `r.organization_id IN (SELECT id FROM organizations WHERE IFNULL(company_id,'') = ?)`
    );
    params.push(companyFilter);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const regs = await all<{
    id: string;
    name: string;
    kind: string;
    is_active: number;
    organization_id: string;
    organization_name: string | null;
    organization_short: string | null;
    organization_inn: string | null;
  }>(
    `SELECT r.id, r.name, r.kind, r.is_active, IFNULL(r.organization_id,'') AS organization_id,
            o.name AS organization_name, o.short_name AS organization_short, o.inn AS organization_inn
     FROM cash_registers r
     LEFT JOIN organizations o ON o.id = r.organization_id
     ${whereSql}
     ORDER BY r.is_active DESC, IFNULL(o.short_name, o.name), r.name`,
    params
  );
  return await Promise.all(regs.map(async (r) => {
    const row = await get<{ balance: number; docs_count: number }>(
      `SELECT
         IFNULL(SUM(CASE WHEN doc_type = 'in' THEN amount ELSE -amount END), 0) AS balance,
         COUNT(*) AS docs_count
       FROM cash_docs
       WHERE cash_register_id = ? AND IFNULL(posted, 1) = 1`,
      [r.id]
    );
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      is_active: Number(r.is_active) ? 1 : 0,
      organization_id: String(r.organization_id || ''),
      organization_name: String(r.organization_name || ''),
      organization_short: String(r.organization_short || r.organization_name || ''),
      organization_inn: String(r.organization_inn || ''),
      balance: Math.round(Number(row?.balance) || 0),
      docs_count: Number(row?.docs_count) || 0,
    };
  }));
}

export async function listPaymentOrders(limit = 200) {
  return {
    note: 'Локальный журнал ПП (черновики). Не создаёт платежи в Точке/1С автоматически.',
    items: await all(
      `SELECT * FROM payment_orders ORDER BY doc_date DESC, number DESC LIMIT ?`,
      [Math.min(500, Math.max(1, limit))]
    ),
  };
}

export async function createPaymentOrder(input: {
  amount: number;
  payee?: string;
  purpose?: string;
  doc_date?: string;
  status?: string;
}) {
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new Error('amount > 0');
  const id = newGuid();
  const number = await nextCode('PP', 5);
  const docDate = (input.doc_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const status = ['draft', 'sent', 'paid', 'cancelled'].includes(String(input.status || ''))
    ? String(input.status)
    : 'draft';
  await run(
    `INSERT INTO payment_orders (id, number, doc_date, amount, payee, purpose, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      number,
      docDate,
      amount,
      String(input.payee || '').trim(),
      String(input.purpose || '').trim(),
      status,
    ]
  );
  return await get('SELECT * FROM payment_orders WHERE id = ?', [id]);
}

export async function listJobTitles() {
  return await all(`SELECT * FROM job_titles ORDER BY name`);
}

export async function upsertJobTitle(input: { id?: string; name: string; is_active?: number }) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name required');
  const id = input.id || newGuid();
  const active = input.is_active == null ? 1 : input.is_active ? 1 : 0;
  await run(
    `INSERT INTO job_titles (id, name, is_active) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, is_active=excluded.is_active`,
    [id, name, active]
  );
  return await get('SELECT * FROM job_titles WHERE id = ?', [id]);
}

export async function listWorkSchedules() {
  return await all(`SELECT * FROM work_schedules ORDER BY name`);
}

export async function upsertWorkSchedule(input: {
  id?: string;
  name: string;
  hours_json?: string;
  is_active?: number;
}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name required');
  const id = input.id || newGuid();
  const active = input.is_active == null ? 1 : input.is_active ? 1 : 0;
  const hours =
    input.hours_json && String(input.hours_json).trim()
      ? String(input.hours_json).trim()
      : '{"mon":"09-18","tue":"09-18","wed":"09-18","thu":"09-18","fri":"09-18","sat":"","sun":""}';
  await run(
    `INSERT INTO work_schedules (id, name, hours_json, is_active) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, hours_json=excluded.hours_json, is_active=excluded.is_active`,
    [id, name, hours, active]
  );
  return await get('SELECT * FROM work_schedules WHERE id = ?', [id]);
}

export async function listProductionOrders(limit = 200) {
  return {
    note: 'Локальный журнал заказов на производство (без списания материалов).',
    items: await all(
      `SELECT * FROM production_orders ORDER BY doc_date DESC, number DESC LIMIT ?`,
      [Math.min(500, Math.max(1, limit))]
    ),
  };
}

export async function createProductionOrder(input: {
  product_name?: string;
  qty?: number;
  comment?: string;
  doc_date?: string;
  status?: string;
}) {
  const id = newGuid();
  const number = await nextCode('PO', 5);
  const docDate = (input.doc_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const status = ['draft', 'in_progress', 'done', 'cancelled'].includes(String(input.status || ''))
    ? String(input.status)
    : 'draft';
  await run(
    `INSERT INTO production_orders (id, number, doc_date, product_name, qty, status, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      number,
      docDate,
      String(input.product_name || '').trim(),
      Number(input.qty) || 0,
      status,
      String(input.comment || ''),
    ]
  );
  return await get('SELECT * FROM production_orders WHERE id = ?', [id]);
}

export async function listCrmEvents(limit = 200) {
  return {
    note: 'Локальный журнал событий CRM (звонки/встречи вручную). Звонки МегаФон — отдельно через Amo.',
    items: await all(
      `SELECT * FROM crm_events ORDER BY event_at DESC LIMIT ?`,
      [Math.min(500, Math.max(1, limit))]
    ),
  };
}

export async function createCrmEvent(input: {
  kind?: string;
  title: string;
  deal_id?: string;
  counterparty_id?: string;
  event_at?: string;
  comment?: string;
}) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('title required');
  const id = newGuid();
  const kind = String(input.kind || 'note').trim() || 'note';
  const eventAt = input.event_at || new Date().toISOString();
  await run(
    `INSERT INTO crm_events (id, kind, title, deal_id, counterparty_id, event_at, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      kind,
      title,
      input.deal_id || null,
      input.counterparty_id || null,
      eventAt,
      String(input.comment || ''),
    ]
  );
  return await get('SELECT * FROM crm_events WHERE id = ?', [id]);
}

export async function priceListMatrix(limit = 200) {
  const lim = Math.min(500, Math.max(1, limit));
  const types = (await all<{ price_type: string }>(
    `SELECT DISTINCT price_type FROM product_prices ORDER BY price_type`
  )).map((r) => r.price_type);
  const products = await all<{ id: string; sku: string; name: string }>(
    `SELECT id, sku, name FROM products WHERE IFNULL(is_active,1)=1 ORDER BY name LIMIT ?`,
    [lim]
  );
  const priceRows = await all<{ product_id: string; price_type: string; price: number }>(
    `SELECT product_id, price_type, price FROM product_prices
     WHERE product_id IN (${products.map(() => '?').join(',') || "''"})`,
    products.map((p) => p.id)
  );
  const byProd = new Map<string, Record<string, number>>();
  for (const r of priceRows) {
    const m = byProd.get(r.product_id) || {};
    m[r.price_type] = Number(r.price) || 0;
    byProd.set(r.product_id, m);
  }
  return {
    note: 'Прайс-лист = матрица типов цен из sync. Не печатная форма 1С.',
    price_types: types,
    items: products.map((p) => ({
      ...p,
      prices: byProd.get(p.id) || {},
    })),
  };
}

export async function salesAnalysis() {
  return await salesAnalysisLive();
}

export async function listInventorySheets(limit = 100) {
  return {
    note: 'Инвентаризации локальные. Проведение создаёт списание/оприходование по разнице (stock_balances).',
    items: await all(
      `SELECT s.*, w.name AS warehouse
       FROM inventory_sheets s
       LEFT JOIN warehouses w ON w.id = s.warehouse_id
       ORDER BY s.doc_date DESC, s.number DESC
       LIMIT ?`,
      [Math.min(300, Math.max(1, limit))]
    ),
  };
}

export async function createInventorySheet(input: {
  warehouse_id: string;
  comment?: string;
  lines: Array<{ product_id: string; counted_qty: number }>;
  post?: boolean;
}) {
  if (!input.warehouse_id) throw new Error('warehouse_id required');
  if (!input.lines?.length) throw new Error('lines required');
  const id = newGuid();
  const number = await nextCode('INV', 5);
  const docDate = new Date().toISOString().slice(0, 10);
  await run(
    `INSERT INTO inventory_sheets (id, number, doc_date, warehouse_id, comment, posted)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [id, number, docDate, input.warehouse_id, String(input.comment || '')]
  );
  for (const line of input.lines) {
    const sys =
      (await get<{ qty: number }>(
        `SELECT qty FROM product_store_rests WHERE product_id = ? AND warehouse_id = ?`,
        [line.product_id, input.warehouse_id]
      ))?.qty ??
      (await get<{ qty: number }>(
        `SELECT qty FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`,
        [line.product_id, input.warehouse_id]
      ))?.qty ??
      0;
    await run(
      `INSERT INTO inventory_sheet_lines (id, sheet_id, product_id, system_qty, counted_qty)
       VALUES (?, ?, ?, ?, ?)`,
      [newGuid(), id, line.product_id, Number(sys) || 0, Number(line.counted_qty) || 0]
    );
  }
  if (input.post) await postInventorySheet(id);
  return await getInventorySheet(id);
}

export async function getInventorySheet(id: string) {
  const sheet = await get(
    `SELECT s.*, w.name AS warehouse
     FROM inventory_sheets s
     LEFT JOIN warehouses w ON w.id = s.warehouse_id
     WHERE s.id = ?`,
    [id]
  );
  if (!sheet) return null;
  const lines = await all(
    `SELECT l.*, p.sku, p.name AS product_name
     FROM inventory_sheet_lines l
     LEFT JOIN products p ON p.id = l.product_id
     WHERE l.sheet_id = ?
     ORDER BY p.name`,
    [id]
  );
  return { ...sheet, lines };
}

export async function postInventorySheet(id: string) {
  const sheet = await get<{
    id: string;
    warehouse_id: string;
    posted: number;
    number: string;
  }>('SELECT * FROM inventory_sheets WHERE id = ?', [id]);
  if (!sheet) throw new Error('not found');
  if (sheet.posted) throw new Error('Уже проведена');
  const lines = await all<{ product_id: string; system_qty: number; counted_qty: number }>(
    `SELECT product_id, system_qty, counted_qty FROM inventory_sheet_lines WHERE sheet_id = ?`,
    [id]
  );
  const shortages: Array<{ product_id: string; qty: number }> = [];
  const surplus: Array<{ product_id: string; qty: number }> = [];
  for (const L of lines) {
    const diff = (Number(L.counted_qty) || 0) - (Number(L.system_qty) || 0);
    if (diff < -0.0001) shortages.push({ product_id: L.product_id, qty: Math.abs(diff) });
    if (diff > 0.0001) surplus.push({ product_id: L.product_id, qty: diff });
  }
  const created: string[] = [];
  if (shortages.length) {
    created.push(
      await createDocument({
        doc_type: 'out',
        warehouse_id: sheet.warehouse_id,
        comment: `Инвентаризация ${sheet.number}: недостача`,
        lines: shortages,
        post: true,
      })
    );
  }
  if (surplus.length) {
    created.push(
      await createDocument({
        doc_type: 'in',
        warehouse_id: sheet.warehouse_id,
        comment: `Инвентаризация ${sheet.number}: излишек`,
        lines: surplus,
        post: true,
      })
    );
  }
  await run(`UPDATE inventory_sheets SET posted = 1 WHERE id = ?`, [id]);
  return { ok: true, docs: created };
}

export async function aboutProgram() {
  const health = {
    products: (await get<{ c: number }>('SELECT COUNT(*) AS c FROM products'))?.c ?? 0,
    docs: (await get<{ c: number }>('SELECT COUNT(*) AS c FROM stock_docs'))?.c ?? 0,
    deals: (await get<{ c: number }>('SELECT COUNT(*) AS c FROM crm_deals'))?.c ?? 0,
  };
  return {
    name: 'Учёт №1',
    vendor: 'Rubtsov.pro',
    live: 'https://1c.pnevmopodveska1.ru',
    description:
      'Операционный контур склада/CRM/продаж/денег вместо полного UI 1С:УНФ. Цель — паритет меню 308 пунктов волнами.',
    stack: 'Hono + SQLite + React/legacy UI · OData/HS 1С · Amo · Точка СБП',
    counts: health,
    version_label: '2026-07 wave',
  };
}

/** ——— CRM extras / СТО / МП / производство (тонкие журналы) ——— */

export async function patchProductionOrder(
  id: string,
  patch: { status?: string; product_name?: string; qty?: number; comment?: string }
) {
  const row = await get('SELECT * FROM production_orders WHERE id = ?', [id]);
  if (!row) return null;
  if (patch.status != null) {
    const st = String(patch.status);
    if (!['draft', 'in_progress', 'done', 'cancelled'].includes(st)) {
      throw new Error('status: draft|in_progress|done|cancelled');
    }
    await run(`UPDATE production_orders SET status = ? WHERE id = ?`, [st, id]);
  }
  if (patch.product_name != null) {
    await run(`UPDATE production_orders SET product_name = ? WHERE id = ?`, [
      String(patch.product_name).trim(),
      id,
    ]);
  }
  if (patch.qty != null) {
    await run(`UPDATE production_orders SET qty = ? WHERE id = ?`, [Number(patch.qty) || 0, id]);
  }
  if (patch.comment != null) {
    await run(`UPDATE production_orders SET comment = ? WHERE id = ?`, [String(patch.comment), id]);
  }
  return await get('SELECT * FROM production_orders WHERE id = ?', [id]);
}

export async function listStoWorkOrders(limit = 200) {
  return {
    note: 'Заказ-наряды СТО — локальный журнал Учёт №1. Не полный экран мастера Э2 (касса/ЗП/подъёмники — позже).',
    items: await all(
      `SELECT * FROM sto_work_orders ORDER BY doc_date DESC, number DESC LIMIT ?`,
      [Math.min(500, Math.max(1, limit))]
    ),
  };
}

export async function createStoWorkOrder(input: {
  customer_name?: string;
  vehicle?: string;
  status?: string;
  total?: number;
  comment?: string;
  doc_date?: string;
}) {
  const id = newGuid();
  const number = await nextCode('ЗН', 5);
  const docDate = (input.doc_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const status = [
    'draft',
    'booked',
    'in_progress',
    'waiting_parts',
    'ready',
    'handed',
    'cancelled',
  ].includes(String(input.status || ''))
    ? String(input.status)
    : 'draft';
  await run(
    `INSERT INTO sto_work_orders
      (id, number, doc_date, customer_name, vehicle, status, total, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      number,
      docDate,
      String(input.customer_name || '').trim(),
      String(input.vehicle || '').trim(),
      status,
      Number(input.total) || 0,
      String(input.comment || ''),
    ]
  );
  return await get('SELECT * FROM sto_work_orders WHERE id = ?', [id]);
}

export async function patchStoWorkOrder(
  id: string,
  patch: { status?: string; customer_name?: string; vehicle?: string; total?: number; comment?: string }
) {
  const row = await get('SELECT * FROM sto_work_orders WHERE id = ?', [id]);
  if (!row) return null;
  if (patch.status != null) {
    await run(`UPDATE sto_work_orders SET status = ? WHERE id = ?`, [String(patch.status), id]);
  }
  if (patch.customer_name != null) {
    await run(`UPDATE sto_work_orders SET customer_name = ? WHERE id = ?`, [
      String(patch.customer_name).trim(),
      id,
    ]);
  }
  if (patch.vehicle != null) {
    await run(`UPDATE sto_work_orders SET vehicle = ? WHERE id = ?`, [String(patch.vehicle).trim(), id]);
  }
  if (patch.total != null) {
    await run(`UPDATE sto_work_orders SET total = ? WHERE id = ?`, [Number(patch.total) || 0, id]);
  }
  if (patch.comment != null) {
    await run(`UPDATE sto_work_orders SET comment = ? WHERE id = ?`, [String(patch.comment), id]);
  }
  return await get('SELECT * FROM sto_work_orders WHERE id = ?', [id]);
}

export async function listStoResources() {
  return {
    note: 'Ресурсы СТО (подъёмники / посты). Планировщик загрузки — позже.',
    items: await all(`SELECT * FROM sto_resources ORDER BY kind, name`),
  };
}

export function marketplaceChannelMeta() {
  const ozon =
    Boolean((process.env.OZON_CLIENT_ID || '').trim()) &&
    Boolean((process.env.OZON_API_KEY || process.env.OZON_CLIENT_SECRET || '').trim());
  const ym = Boolean((process.env.YM_CAMPAIGN_ID || '').trim() && (process.env.YM_TOKEN || '').trim());
  const vk = Boolean((process.env.VK_MARKET_TOKEN || '').trim());
  return {
    ozon: {
      id: 'ozon',
      label: 'Ozon',
      configured: ozon,
      note: ozon
        ? 'Ключи OZON_* заданы в env — live sync в WMS ещё не подключён (заказы вручную / stub).'
        : 'Ключи Ozon в WMS не заданы. Живого sync нет — журнал пустой до ручного ввода или подключения API.',
    },
    ym: {
      id: 'ym',
      label: 'Яндекс Маркет',
      configured: ym,
      note: ym
        ? 'Ключи YM_* заданы — live sync в WMS ещё не подключён.'
        : 'Ключи Я.Маркета не заданы. Журнал локальный, без кабинета МП.',
    },
    vk: {
      id: 'vk',
      label: 'ВКонтакте',
      configured: vk,
      note: vk
        ? 'Ключ VK задан — live sync в WMS ещё не подключён.'
        : 'Ключ VK не задан. Журнал локальный.',
    },
  };
}

export async function listMarketplaceOrders(channel = '', limit = 200) {
  const lim = Math.min(500, Math.max(1, limit));
  const ch = String(channel || '').trim().toLowerCase();
  const items = ch
    ? await all(
        `SELECT * FROM marketplace_orders WHERE channel = ? ORDER BY ordered_at DESC, created_at DESC LIMIT ?`,
        [ch, lim]
      )
    : await all(
        `SELECT * FROM marketplace_orders ORDER BY ordered_at DESC, created_at DESC LIMIT ?`,
        [lim]
      );
  const channels = marketplaceChannelMeta();
  return {
    note: 'Заказы маркетплейсов — локальный журнал Учёт №1. Не утверждаем live-синк с Ozon/ЯМ/VK без рабочего контура.',
    channels,
    items,
  };
}

export async function createMarketplaceOrder(input: {
  channel: string;
  external_id?: string;
  number?: string;
  status?: string;
  amount?: number;
  ordered_at?: string;
  comment?: string;
}) {
  const channel = String(input.channel || '').trim().toLowerCase();
  if (!['ozon', 'ym', 'vk', 'avito'].includes(channel)) {
    throw new Error('channel: ozon|ym|vk|avito');
  }
  const id = newGuid();
  const number = String(input.number || '').trim() || await nextCode(channel.toUpperCase().slice(0, 3), 5);
  await run(
    `INSERT INTO marketplace_orders
      (id, channel, external_id, number, status, amount, ordered_at, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      channel,
      String(input.external_id || '').trim(),
      number,
      String(input.status || 'new').trim() || 'new',
      Number(input.amount) || 0,
      (input.ordered_at || new Date().toISOString()).slice(0, 19),
      String(input.comment || ''),
    ]
  );
  return await get('SELECT * FROM marketplace_orders WHERE id = ?', [id]);
}

export async function listCrmTasks(limit = 200) {
  return {
    note: 'Задания CRM — локальный список. Задачи Amo живут в Amo; здесь — операционный журнал Учёт №1.',
    items: await all(
      `SELECT * FROM crm_tasks ORDER BY COALESCE(due_at, created_at) DESC LIMIT ?`,
      [Math.min(500, Math.max(1, limit))]
    ),
  };
}

export async function createCrmTask(input: {
  title: string;
  status?: string;
  due_at?: string;
  deal_id?: string;
  comment?: string;
  assignee_amo_id?: string;
  source?: string;
  payment_link_id?: string;
}) {
  const title = String(input.title || '').trim();
  if (!title) throw new Error('title required');
  const id = newGuid();
  await run(
    `INSERT INTO crm_tasks (
       id, title, status, due_at, deal_id, comment,
       assignee_amo_id, source, payment_link_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      title,
      String(input.status || 'open').trim() || 'open',
      input.due_at || null,
      input.deal_id || null,
      String(input.comment || ''),
      String(input.assignee_amo_id || '').trim(),
      String(input.source || '').trim(),
      String(input.payment_link_id || '').trim(),
    ]
  );
  return await get('SELECT * FROM crm_tasks WHERE id = ?', [id]);
}

export async function listCrmTasksForDeal(dealId: string, limit = 50) {
  return await all(
    `SELECT * FROM crm_tasks WHERE deal_id = ?
     ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, datetime(created_at) DESC
     LIMIT ?`,
    [String(dealId || ''), Math.min(100, Math.max(1, limit))]
  );
}

export async function patchCrmTask(
  id: string,
  patch: { status?: string; comment?: string }
): Promise<Record<string, unknown> | null> {
  const row = await get('SELECT * FROM crm_tasks WHERE id = ?', [id]) as Record<string, unknown> | undefined;
  if (!row) return null;
  const status =
    patch.status != null ? String(patch.status).trim() || String(row.status) : String(row.status);
  const comment =
    patch.comment != null ? String(patch.comment) : String(row.comment || '');
  await run(`UPDATE crm_tasks SET status = ?, comment = ? WHERE id = ?`, [status, comment, id]);
  return await get('SELECT * FROM crm_tasks WHERE id = ?', [id]) as Record<string, unknown>;
}

export async function listPayQuestionsForDeal(dealId: string, limit = 30) {
  return await all(
    `SELECT * FROM crm_events WHERE deal_id = ? AND kind = 'pay_question'
     ORDER BY datetime(event_at) DESC LIMIT ?`,
    [String(dealId || ''), Math.min(100, Math.max(1, limit))]
  );
}

export async function listOrderStatusTypes(kind = '') {
  const k = String(kind || '').trim();
  const items = k
    ? await all(
        `SELECT * FROM order_status_types WHERE kind = ? ORDER BY sort_order, name`,
        [k]
      )
    : await all(`SELECT * FROM order_status_types ORDER BY kind, sort_order, name`);
  return {
    note: 'Виды и состояния заказов (продажи / СТО). Справочник Учёт №1, не роботы 1С.',
    items,
  };
}

export async function listCrmCalendar(limit = 100) {
  const lim = Math.min(300, Math.max(1, limit));
  const events = await all(
    `SELECT id, kind, title, event_at AS at, 'event' AS source FROM crm_events
     ORDER BY event_at DESC LIMIT ?`,
    [lim]
  );
  const tasks = await all(
    `SELECT id, 'task' AS kind, title, due_at AS at, 'task' AS source FROM crm_tasks
     WHERE due_at IS NOT NULL AND due_at != ''
     ORDER BY due_at DESC LIMIT ?`,
    [lim]
  );
  const sto = await all(
    `SELECT id, status AS kind, ('ЗН ' || number || ' · ' || IFNULL(customer_name,'')) AS title,
            doc_date AS at, 'sto' AS source
     FROM sto_work_orders
     ORDER BY doc_date DESC LIMIT ?`,
    [lim]
  );
  const items = [...events, ...tasks, ...sto]
    .filter((r) => r.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, lim);
  return {
    note: 'Календарь CRM/СТО — сводка локальных событий, заданий и заказ-нарядов. Не полный планировщик 1С.',
    items,
  };
}

export async function cashBook(limit = 200) {
  const lim = Math.min(500, Math.max(1, limit));
  const rows = await all<{
    id: string;
    doc_type: string;
    number: string;
    doc_date: string;
    amount: number;
    article_name: string | null;
    comment: string;
  }>(
    `SELECT d.id, d.doc_type, d.number, d.doc_date, d.amount, a.name AS article_name, d.comment
     FROM cash_docs d
     LEFT JOIN cash_articles a ON a.id = d.article_id
     ORDER BY d.doc_date ASC, d.created_at ASC
     LIMIT ?`,
    [lim]
  );
  let bal = 0;
  const items = rows.map((r) => {
    const amt = Number(r.amount) || 0;
    if (r.doc_type === 'in') bal += amt;
    else bal -= amt;
    return { ...r, amount: amt, balance: Math.round(bal) };
  });
  return {
    note: 'Кассовая книга по локальным ПКО/РКО Учёт №1. Не заменяет кассовую книгу 1С.',
    balance: bal,
    items,
  };
}

export async function listMoneyTransfers(limit = 200) {
  return {
    note: 'Перемещения денег между кассами/счетами (локальный журнал). Пусто — нормально.',
    items: await all(
      `SELECT * FROM money_transfers ORDER BY doc_date DESC, number DESC LIMIT ?`,
      [Math.min(500, Math.max(1, limit))]
    ),
  };
}

export async function createMoneyTransfer(input: {
  amount: number;
  from_name?: string;
  to_name?: string;
  comment?: string;
  doc_date?: string;
}) {
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new Error('amount > 0');
  const id = newGuid();
  const number = await nextCode('MT', 5);
  const docDate = (input.doc_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  await run(
    `INSERT INTO money_transfers (id, number, doc_date, amount, from_name, to_name, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      number,
      docDate,
      amount,
      String(input.from_name || '').trim(),
      String(input.to_name || '').trim(),
      String(input.comment || ''),
    ]
  );
  return await get('SELECT * FROM money_transfers WHERE id = ?', [id]);
}

export async function listBankDocsLocal(limit = 200, docType = '') {
  const lim = Math.min(500, Math.max(1, limit));
  const t = String(docType || '').trim();
  const items = t
    ? await all(
        `SELECT * FROM bank_docs_local WHERE doc_type = ? ORDER BY doc_date DESC, number DESC LIMIT ?`,
        [t, lim]
      )
    : await all(`SELECT * FROM bank_docs_local ORDER BY doc_date DESC, number DESC LIMIT ?`, [lim]);
  return {
    note: 'Локальный журнал банковских документов. Живые обороты Точки — /money/tochka. Пусто OK.',
    items,
  };
}

export async function createBankDocLocal(input: {
  doc_type?: string;
  amount: number;
  counterparty?: string;
  purpose?: string;
  doc_date?: string;
}) {
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new Error('amount > 0');
  const docType = ['in', 'out'].includes(String(input.doc_type || ''))
    ? String(input.doc_type)
    : 'in';
  const id = newGuid();
  const number = await nextCode(docType === 'in' ? 'BIN' : 'BOUT', 5);
  const docDate = (input.doc_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  await run(
    `INSERT INTO bank_docs_local (id, doc_type, number, doc_date, amount, counterparty, purpose, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'local')`,
    [
      id,
      docType,
      number,
      docDate,
      amount,
      String(input.counterparty || '').trim(),
      String(input.purpose || '').trim(),
    ]
  );
  return await get('SELECT * FROM bank_docs_local WHERE id = ?', [id]);
}

export async function listCashRegisters(opts?: { organization_id?: string; company_id?: string }) {
  const orgFilter = String(opts?.organization_id || '').trim();
  const companyFilter = String(opts?.company_id || '').trim();
  const where: string[] = [];
  const params: string[] = [];
  if (orgFilter) {
    where.push('r.organization_id = ?');
    params.push(orgFilter);
  } else if (companyFilter) {
    where.push(
      `r.organization_id IN (SELECT id FROM organizations WHERE IFNULL(company_id,'') = ?)`
    );
    params.push(companyFilter);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const items = await all(
    `SELECT r.*, o.name AS organization_name, o.short_name AS organization_short, o.inn AS organization_inn,
            (SELECT COUNT(*) FROM cash_docs d WHERE d.cash_register_id = r.id) AS docs_count
     FROM cash_registers r
     LEFT JOIN organizations o ON o.id = r.organization_id
     ${whereSql}
     ORDER BY r.is_active DESC, IFNULL(o.short_name, o.name), r.name`,
    params
  ) as Array<Record<string, unknown> & { docs_count?: number }>;
  return {
    note: 'Справочник касс Учёт №1. У каждой кассы — своё юрлицо (организация). Пустую кассу без документов можно удалить.',
    items: items.map((r) => {
      const docs = Number(r.docs_count) || 0;
      return {
        ...r,
        docs_count: docs,
        can_delete: docs === 0,
      };
    }),
  };
}

export async function upsertCashRegister(input: {
  id?: string;
  name: string;
  kind?: string;
  organization_id?: string;
  is_active?: number;
}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name required');
  const id = input.id || newGuid();
  const kind = String(input.kind || 'cash').trim() || 'cash';
  const active = input.is_active == null ? 1 : input.is_active ? 1 : 0;
  let organizationId = String(input.organization_id || '').trim();
  if (!organizationId) {
    organizationId = await resolveOrganizationId(null);
  } else {
    const ok = await get<{ id: string }>(`SELECT id FROM organizations WHERE id = ? AND is_active = 1`, [
      organizationId,
    ]);
    if (!ok) throw new Error('Организация не найдена или неактивна');
  }
  if (!organizationId) throw new Error('Укажите юрлицо (организацию) для кассы');
  await run(
    `INSERT INTO cash_registers (id, name, kind, organization_id, is_active) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, kind=excluded.kind,
       organization_id=excluded.organization_id, is_active=excluded.is_active`,
    [id, name, kind, organizationId, active]
  );
  return await get(
    `SELECT r.*, o.name AS organization_name, o.short_name AS organization_short, o.inn AS organization_inn
     FROM cash_registers r
     LEFT JOIN organizations o ON o.id = r.organization_id
     WHERE r.id = ?`,
    [id]
  );
}

/** Удалить кассу без документов. С документами — только архив (is_active=0). */
export async function deleteCashRegister(id: string) {
  const rid = String(id || '').trim();
  if (!rid) throw new Error('id required');
  const row = await get<{ id: string; name: string }>(`SELECT id, name FROM cash_registers WHERE id = ?`, [
    rid,
  ]);
  if (!row) throw new Error('Касса не найдена');
  const docs =
    Number(
      (await get<{ c: number }>(`SELECT COUNT(*) AS c FROM cash_docs WHERE cash_register_id = ?`, [rid]))?.c
    ) || 0;
  if (docs > 0) {
    throw new Error(`Нельзя удалить: есть документы кассы (${docs}). Сначала в архив.`);
  }
  await run(`DELETE FROM cash_registers WHERE id = ?`, [rid]);
  return { ok: true, id: rid, name: row.name };
}

export async function listCardOps(limit = 200) {
  return {
    note: 'Операции по платёжным картам (эквайринг) — локальный журнал. Пусто OK; live POS — позже.',
    items: await all(
      `SELECT * FROM card_ops ORDER BY doc_date DESC, number DESC LIMIT ?`,
      [Math.min(500, Math.max(1, limit))]
    ),
  };
}

export async function createCardOp(input: {
  amount: number;
  card_mask?: string;
  status?: string;
  comment?: string;
  doc_date?: string;
  deal_id?: string;
  stock_doc_id?: string;
}) {
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new Error('amount > 0');
  const id = newGuid();
  const number = await nextCode('CARD', 5);
  const docDate = (input.doc_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const status = String(input.status || 'ok').trim() || 'ok';
  const dealId = String(input.deal_id || '').trim();
  const stockDocId = String(input.stock_doc_id || '').trim();
  await run(
    `INSERT INTO card_ops (id, number, doc_date, amount, card_mask, status, comment, deal_id, stock_doc_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      number,
      docDate,
      amount,
      String(input.card_mask || '').trim(),
      status,
      String(input.comment || ''),
      dealId,
      stockDocId,
    ]
  );
  return await get('SELECT * FROM card_ops WHERE id = ?', [id]);
}

export async function paymentCalendar(from = '', to = '') {
  const start = (from || new Date().toISOString().slice(0, 8) + '01').slice(0, 10);
  const endDate = to
    ? to.slice(0, 10)
    : (() => {
        const d = new Date(start + 'T12:00:00Z');
        d.setUTCMonth(d.getUTCMonth() + 1);
        d.setUTCDate(0);
        return d.toISOString().slice(0, 10);
      })();
  const planned = await all(
    `SELECT id, plan_date AS day, kind, amount, counterparty, comment, status, 'plan' AS source
     FROM payment_plan WHERE plan_date >= ? AND plan_date <= ?
     ORDER BY plan_date, kind`,
    [start, endDate]
  );
  const orders = await all(
    `SELECT id, doc_date AS day, 'out' AS kind, amount, payee AS counterparty, purpose AS comment, status, 'pp' AS source
     FROM payment_orders WHERE doc_date >= ? AND doc_date <= ?
     ORDER BY doc_date`,
    [start, endDate]
  );
  return {
    note: 'Платёжный календарь: план + черновики ПП. Не банк Точки.',
    from: start,
    to: endDate,
    items: [...planned, ...orders].sort((a, b) =>
      String((a as { day: string }).day).localeCompare(String((b as { day: string }).day))
    ),
  };
}

export async function createPaymentPlanItem(input: {
  plan_date: string;
  kind?: string;
  amount: number;
  counterparty?: string;
  comment?: string;
  status?: string;
}) {
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new Error('amount > 0');
  const planDate = String(input.plan_date || '').slice(0, 10);
  if (!planDate) throw new Error('plan_date required');
  const id = newGuid();
  const kind = ['in', 'out'].includes(String(input.kind || '')) ? String(input.kind) : 'out';
  const status = String(input.status || 'planned').trim() || 'planned';
  await run(
    `INSERT INTO payment_plan (id, plan_date, kind, amount, counterparty, comment, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      planDate,
      kind,
      amount,
      String(input.counterparty || '').trim(),
      String(input.comment || ''),
      status,
    ]
  );
  return await get('SELECT * FROM payment_plan WHERE id = ?', [id]);
}

export async function listHrDocs(limit = 200, docType = '') {
  const lim = Math.min(500, Math.max(1, limit));
  const t = String(docType || '').trim();
  const items = t
    ? await all(`SELECT * FROM hr_docs WHERE doc_type = ? ORDER BY doc_date DESC LIMIT ?`, [t, lim])
    : await all(`SELECT * FROM hr_docs ORDER BY doc_date DESC LIMIT ?`, [lim]);
  return {
    note: 'Кадровые документы (локальный журнал). Полный HR 1С не переносится.',
    items,
  };
}

export async function createHrDoc(input: {
  doc_type?: string;
  person_name?: string;
  comment?: string;
  doc_date?: string;
}) {
  const id = newGuid();
  const docType = String(input.doc_type || 'hire').trim() || 'hire';
  const number = await nextCode('HR', 5);
  const docDate = (input.doc_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  await run(
    `INSERT INTO hr_docs (id, doc_type, number, doc_date, person_name, comment)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, docType, number, docDate, String(input.person_name || '').trim(), String(input.comment || '')]
  );
  return await get('SELECT * FROM hr_docs WHERE id = ?', [id]);
}

export async function listWorkShifts() {
  return await all(`SELECT * FROM work_shifts ORDER BY name`);
}

export async function upsertWorkShift(input: {
  id?: string;
  name: string;
  hours_from?: string;
  hours_to?: string;
  is_active?: number;
}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name required');
  const id = input.id || newGuid();
  const active = input.is_active == null ? 1 : input.is_active ? 1 : 0;
  await run(
    `INSERT INTO work_shifts (id, name, hours_from, hours_to, is_active) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, hours_from=excluded.hours_from,
       hours_to=excluded.hours_to, is_active=excluded.is_active`,
    [
      id,
      name,
      String(input.hours_from || '09:00'),
      String(input.hours_to || '18:00'),
      active,
    ]
  );
  return await get('SELECT * FROM work_shifts WHERE id = ?', [id]);
}

export async function listTimeKinds() {
  return await all(`SELECT * FROM time_kinds ORDER BY code`);
}

export async function upsertTimeKind(input: {
  id?: string;
  code: string;
  name: string;
  is_active?: number;
}) {
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  if (!code || !name) throw new Error('code and name required');
  const id = input.id || newGuid();
  const active = input.is_active == null ? 1 : input.is_active ? 1 : 0;
  await run(
    `INSERT INTO time_kinds (id, code, name, is_active) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, is_active=excluded.is_active`,
    [id, code, name, active]
  );
  return await get('SELECT * FROM time_kinds WHERE id = ?', [id]);
}

export async function listPersons() {
  const staff = await all<{
    id: string;
    name: string;
    email: string;
    department: string;
    role: string;
  }>(
    `SELECT id, IFNULL(name,'') AS name, IFNULL(email,'') AS email,
            IFNULL(department,'') AS department, IFNULL(role,'') AS role
     FROM staff ORDER BY name`
  );
  return {
    note: 'Физические лица = сотрудники WMS/Amo (без отдельной карточки ФЛ 1С).',
    items: staff,
  };
}

export async function listCompanyBankAccounts() {
  const items = await all(`SELECT * FROM company_bank_accounts ORDER BY is_active DESC, name`) as Array<
    Record<string, unknown>
  >;
  return {
    note: 'Банковские счета организации (справочник). При связях — только архив, не удаление.',
    items: await Promise.all(items.map(async (r) => {
      const id = String(r.id || '');
      const links = await bankAccountLinkInfo(id);
      return {
        ...r,
        has_links: links.linked,
        can_delete: !links.linked,
        link_counts: links.counts,
      };
    })),
  };
}

export async function upsertCompanyBankAccount(input: {
  id?: string;
  name: string;
  bank_name?: string;
  bik?: string;
  account?: string;
  currency?: string;
  is_active?: number;
}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name required');
  const id = input.id || newGuid();
  const active = input.is_active == null ? 1 : input.is_active ? 1 : 0;
  await run(
    `INSERT INTO company_bank_accounts (id, name, bank_name, bik, account, currency, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, bank_name=excluded.bank_name,
       bik=excluded.bik, account=excluded.account, currency=excluded.currency, is_active=excluded.is_active`,
    [
      id,
      name,
      String(input.bank_name || '').trim(),
      String(input.bik || '').trim(),
      String(input.account || '').trim(),
      String(input.currency || 'RUB').trim() || 'RUB',
      active,
    ]
  );
  return await get('SELECT * FROM company_bank_accounts WHERE id = ?', [id]);
}

export async function companyOrganizations() {
  return await companyOrganizationsPayload();
}

export function allDictionariesIndex() {
  return {
    note: 'Индекс справочников Учёт №1 (аналог «Все справочники» 1С).',
    groups: [
      {
        title: 'Деньги',
        items: [
          { path: '/currencies', label: 'Валюты' },
          { path: '/cash-registers', label: 'Кассы' },
          { path: '/cash-articles', label: 'Статьи ДДС' },
        ],
      },
      {
        title: 'Компания',
        items: [
          { path: '/organizations', label: 'Организации' },
          { path: '/bank-accounts', label: 'Банковские счета' },
          { path: '/warehouses', label: 'Склады' },
        ],
      },
      {
        title: 'Персонал',
        items: [
          { path: '/staff', label: 'Сотрудники' },
          { path: '/job-titles', label: 'Должности' },
          { path: '/work-schedules', label: 'Графики работы' },
          { path: '/work-shifts', label: 'Рабочие смены' },
          { path: '/time-kinds', label: 'Виды рабочего времени' },
        ],
      },
      {
        title: 'Номенклатура',
        items: [
          { path: '/products', label: 'Номенклатура' },
          { path: '/brands', label: 'Бренды' },
          { path: '/prices', label: 'Типы цен' },
        ],
      },
    ],
  };
}

export async function homeKpi() {
  const y = new Date().getFullYear();
  const salesYtd = await get<{ docs: number; amount: number }>(
    `SELECT COUNT(*) AS docs, IFNULL(SUM(amount),0) AS amount
     FROM sales_docs WHERE substr(doc_date,1,4) = ?`,
    [String(y)]
  );
  const deals =
    await get<{ c: number; won: number }>(
      `SELECT COUNT(*) AS c,
              SUM(CASE WHEN lower(IFNULL(status_name,'')) LIKE '%реализ%'
                        OR lower(IFNULL(status_name,'')) LIKE '%успеш%'
                        OR lower(IFNULL(status_name,'')) LIKE '%закрыт%' THEN 1 ELSE 0 END) AS won
       FROM crm_deals`
    ) || { c: 0, won: 0 };
  const stockVal =
    (await get<{ v: number }>(
      `SELECT IFNULL(SUM(qty * IFNULL((
         SELECT price FROM product_prices pp
         WHERE pp.product_id = r.product_id
         ORDER BY CASE WHEN pp.price_type LIKE '%Розниц%' THEN 0 ELSE 1 END
         LIMIT 1
       ), 0)), 0) AS v
       FROM product_store_rests r`
    ))?.v ?? 0;
  const cashBal = await (async () => {
    const rows = await all<{ doc_type: string; amount: number }>(`SELECT doc_type, amount FROM cash_docs`);
    let b = 0;
    for (const r of rows) {
      if (r.doc_type === 'in') b += Number(r.amount) || 0;
      else b -= Number(r.amount) || 0;
    }
    return b;
  })();
  const byMonth = await all<{ ym: string; amount: number }>(
    `SELECT substr(doc_date,1,7) AS ym, IFNULL(SUM(amount),0) AS amount
     FROM sales_docs WHERE IFNULL(doc_date,'') != ''
     GROUP BY substr(doc_date,1,7) ORDER BY ym DESC LIMIT 12`
  );
  const spendByArticle = await all<{ name: string; amount: number }>(
    `SELECT IFNULL(a.name,'(без статьи)') AS name, IFNULL(SUM(d.amount),0) AS amount
     FROM cash_docs d
     LEFT JOIN cash_articles a ON a.id = d.article_id
     WHERE d.doc_type = 'out'
     GROUP BY IFNULL(a.name,'(без статьи)')
     ORDER BY amount DESC LIMIT 12`
  );
  const conversion =
    deals.c > 0 ? Math.round(((Number(deals.won) || 0) / Number(deals.c)) * 1000) / 10 : 0;
  return {
    note: 'KPI Главного. Дебиторка/кредиторка — заглушки до единого контура взаиморасчётов.',
    money_balance: cashBal,
    stock_value_retail_est: stockVal,
    debts_receivable: { amount: 0, note: 'Единая дебиторка — позже (P2)' },
    debts_payable: { amount: 0, note: 'Кредиторка — позже (P2)' },
    net_assets: {
      amount: Math.round(cashBal + stockVal),
      note: 'Черновик: касса локальная + оценка склада; не баланс 1С',
    },
    leads: { count: 0, note: 'Лиды ведутся в Amo CRM' },
    sales_ytd: { year: y, docs: salesYtd?.docs || 0, amount: salesYtd?.amount || 0 },
    order_conversion_pct: conversion,
    sales_dynamics: byMonth.reverse(),
    money_spend_structure: spendByArticle,
    todos: [
      { id: 'month-close', label: 'Закрытие месяца', status: '1c', href: null },
      { id: 'edo', label: 'ЭДО', status: '1c', href: null },
      { id: 'settings', label: 'Настройки', status: 'ready', href: '/settings' },
      { id: 'other', label: 'Прочие дела', status: 'open', href: '/home-todos' },
    ],
  };
}

export async function companyAnalytics() {
  const kpi = await homeKpi();
  return {
    note: 'Анализ / показатели / состояние компании — управленческий срез Учёт №1.',
    state: {
      products: (await get<{ c: number }>('SELECT COUNT(*) AS c FROM products WHERE IFNULL(is_active,1)=1'))
        ?.c,
      counterparties: (await get<{ c: number }>('SELECT COUNT(*) AS c FROM counterparties'))?.c,
      deals_open: (await get<{ c: number }>(`SELECT COUNT(*) AS c FROM crm_deals`))?.c,
      warehouse_tasks_open: (await get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM warehouse_tasks WHERE status NOT IN ('done','cancelled','handed')`
      ))?.c,
    },
    sales_ytd: kpi.sales_ytd,
    sales_dynamics: kpi.sales_dynamics,
    money_balance: kpi.money_balance,
    net_assets: kpi.net_assets,
  };
}

export function settingsMyProfile(actor: { id?: string; email?: string; name?: string } | null) {
  return {
    note: 'Мои настройки — профиль сессии WMS.',
    profile: {
      id: actor?.id || '',
      email: actor?.email || '',
      name: actor?.name || '',
    },
    links: [
      { path: '/settings/phones', label: 'Формат телефонов' },
      { path: '/presence', label: 'Кто в системе' },
      { path: '/audit', label: 'История действий' },
    ],
  };
}

export function settingsCalendars() {
  return {
    note: 'Календари Учёт №1 (заготовка). Полный календарь 1С/СТО — позже.',
    items: [
      { id: 'work', name: 'Рабочий календарь РФ', kind: 'production' },
      { id: 'staff', name: 'Календарь сотрудников', kind: 'staff' },
    ],
  };
}

export async function settingsEquipment() {
  const atolOk = await atolConfigured();
  return {
    note:
      'Камера ШК — сверху экрана /pick (кнопка «Камера»): live-превью, чтение ШК и «Сделал». USB/Bluetooth-сканер — в то же поле. ТСД — отдельно.',
    items: [
      {
        id: 'atol',
        name: 'АТОЛ (онлайн-касса)',
        status: atolOk ? 'ok' : 'prepared',
        live: atolOk,
        path: '/settings/atol',
      },
      { id: 'tsd', name: 'ТСД', status: 'planned', live: false },
      {
        id: 'scanner',
        name: 'Сканер ШК (браузер / камера)',
        status: 'ok',
        live: true,
        path: '/pick',
      },
      {
        id: 'scanner-hid',
        name: 'USB / Bluetooth-сканер (клавиатура)',
        status: 'ok',
        live: true,
        path: '/pick',
      },
    ],
  };
}

export function settingsSalesChannels() {
  return {
    note: 'Каналы продаж. МП (Ozon/ЯМ) — Э3; сейчас розница/Amo/СБП.',
    items: [
      { id: 'retail', name: 'Розница / склад', status: 'active' },
      { id: 'amo', name: 'Amo CRM', status: 'active' },
      { id: 'sbp', name: 'СБП Точка', status: 'active' },
      { id: 'ozon', name: 'Ozon', status: 'planned' },
      { id: 'ym', name: 'Яндекс Маркет', status: 'planned' },
      { id: 'vk', name: 'VK', status: 'planned' },
    ],
  };
}

export function settingsYookassa() {
  return {
    note: 'ЮKassa не подключена: оплаты идут через СБП Точка (/money/tochka + payments).',
    configured: false,
    alternative: { id: 'tochka_sbp', label: 'СБП Точка', path: '/money/tochka' },
  };
}

export function settingsReportsIndex() {
  const catalog = reportsCatalog();
  return {
    note: catalog.note,
    summary: catalog.summary,
    items: catalog.items.map((it) => ({
      path: it.path,
      label: it.title,
      status: it.status,
      section: it.section,
      view: it.view,
      note: it.note,
    })),
    links: [
      { path: '/sales/reports', label: 'Отчёты продаж', view: 'parity-sales-reports' },
      { path: '/crm/reports', label: 'Отчёты CRM', view: 'parity-crm-reports' },
      { path: '/warehouse/reports', label: 'Отчёты склада', view: 'parity-warehouse-reports' },
      { path: '/purchases/reports', label: 'Отчёты закупок', view: 'parity-purchases-reports' },
      { path: '/audit', label: 'История / логи' },
      { path: '/presence', label: 'Кто в системе' },
      { path: '/ops', label: 'Дашборд склада' },
    ],
  };
}
