import { Hono } from 'hono';
import { all, get, run } from './db.js';
import { newGuid, nextCode } from './ids.js';
import { createDocument, type DocType } from './stock.js';
import { catalogCounts, odataConfigFromEnv, syncCatalogsFromOdata } from './odata.js';
import {
  hsConfigured,
  hsSyncMeta,
  syncApplicabilityAndProperties,
  syncPricesOnly,
  syncRestsOnly,
} from './hs.js';
import { mediaSyncMeta, syncMediaFrom1c, backfillMediaOrientation } from './media.js';
import { listMediaProducts, mediaCoverageByCategory } from './media-coverage.js';
import { s3ConfigFromEnv } from './s3.js';
import { withCatalogSyncLock } from './sync-lock.js';
import { dictMeta, rebuildDictionaries } from './dicts.js';
import {
  parseRights,
  rightsForRole,
  staffMeta,
  STAFF_ROLES,
  STAFF_SECTIONS,
  syncStaffFromAmoAnd1c,
  type StaffRole,
} from './staff.js';
import {
  actorFromContext,
  canDo,
  changeOwnPassword,
  publicStaffRow,
  setStaffPassword,
} from './auth.js';
import { auditFromContext, listAudit, writeAudit } from './audit.js';
import { enrichClientMeta } from './client-meta.js';
import { listOnlinePresence, touchPresence } from './presence.js';
import { docsSyncMeta, syncDocsFromOdata } from './docs-sync.js';
import { diskStats } from './disk.js';
import {
  dealsMeta,
  getDeal,
  listDeals,
  listPipelines,
  syncDealsFromAmo1c,
  upsertDealRecord,
} from './deals.js';
import {
  createSalesDocFromDeal,
  createSalesDocPackFromDeal,
  getOrgProfile,
  getSalesDoc,
  listSalesDocs,
  renderSalesDocPrintHtml,
  saveOrgProfile,
  salesDocTypeLabel,
  type SalesDocType,
} from './sales-docs.js';
import {
  applyDocNumberingPatch,
  getDocNumberingState,
  syncDocNumberingFrom1c,
} from './doc-numbering.js';
import { renderSalesDocPdf } from './sales-docs-pdf.js';
import { createDealSbpQr, deleteDealPayment, getDealPayment, listDealPayments } from './payments.js';
import { fetchTochkaOverview } from './bank-tochka.js';
import {
  atolStatusInfo,
  getFiscalReceipt,
  listFiscalReceipts,
  prepareOrSendFiscalReceipt,
} from './atol.js';
import {
  createAggregate,
  createLot,
  listCodes,
  listLots,
  markingMeta,
  parseMarkingLabel,
  productMarkingSummary,
  registerCode,
  scanCode,
} from './marking.js';
import { buildCategoryTree } from './category-tree.js';
import {
  channelLabel,
  createTaskFromDeal,
  getTask,
  listTasks,
  packingSlip,
  scanHandOver,
  setTaskStatus,
  SHIP_CHANNELS,
  statusLabel,
  TASK_STATUSES,
} from './warehouse-tasks.js';
import {
  cdekWidgetUrl,
  listIncomeMirror,
  opsDashboard,
} from './ops.js';
import { mountSwagger } from './swagger.js';

export const api = new Hono();

api.get('/health', (c) => c.json({ ok: true, service: 'warehouse-1c' }));

/** OpenAPI + Swagger UI — not /docs (warehouse documents CRUD). */
mountSwagger(api);

function publicJsonKeyOk(c: { req: { query: (k: string) => string | undefined; header: (n: string) => string | undefined } }): boolean {
  const expect = (process.env.WMS_JSON_KEY || process.env.WMS_INGEST_KEY || '').trim();
  if (!expect) return false;
  const key =
    (c.req.query('key') || '').trim()
    || (c.req.header('x-wms-json-key') || '').trim()
    || (c.req.header('x-wms-ingest-key') || '').trim();
  return key === expect;
}

function findProductForExport(ref: string) {
  const q = String(ref || '').trim();
  if (!q) return null;
  return (
    get(
      `SELECT p.id, p.sku, p.code, p.name, p.brand, p.barcode, p.array_sku, p.is_active,
              p.package_width_cm, p.package_height_cm, p.package_length_cm, p.package_weight_g,
              u.short_name AS unit, c.name AS category, p.category_id
       FROM products p
       LEFT JOIN units u ON u.id = p.unit_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.sku = ? OR p.code = ? OR p.barcode = ? OR p.id = ?
       LIMIT 1`,
      [q, q, q, q]
    ) || null
  );
}

function buildProductExportJson(product: Record<string, unknown>) {
  const id = String(product.id);
  const prices = all<{ price_type: string; price: number }>(
    `SELECT price_type, price FROM product_prices WHERE product_id = ?
     ORDER BY
       CASE price_type
         WHEN 'Розничная цена' THEN 0
         WHEN 'ОПТ1' THEN 1
         WHEN 'ОПТ2' THEN 2
         WHEN 'Цена снятие/установки' THEN 3
         WHEN 'Цена Маркетплейс' THEN 4
         ELSE 10
       END,
       price_type`,
    [id]
  );
  const lastPurchase = get<{
    price: number;
    qty: number;
    doc_date: string;
    number: string;
    amount: number;
  }>(
    `SELECT l.price, l.qty, d.doc_date, d.number, l.amount
     FROM stock_doc_lines l
     JOIN stock_docs d ON d.id = l.doc_id
     WHERE d.doc_type = 'in' AND l.product_id = ? AND IFNULL(l.price, 0) > 0
     ORDER BY d.doc_date DESC, d.number DESC
     LIMIT 1`,
    [id]
  );
  const properties = all<{ property: string; value: string }>(
    `SELECT property, value FROM product_properties WHERE product_id = ? ORDER BY property`,
    [id]
  );
  const rests = all<{ warehouse: string; qty: number }>(
    `SELECT IFNULL(w.name, r.warehouse_id) AS warehouse, r.qty
     FROM product_store_rests r
     LEFT JOIN warehouses w ON w.id = r.warehouse_id
     WHERE r.product_id = ? AND r.qty != 0
     ORDER BY warehouse`,
    [id]
  );
  const pricesMap: Record<string, number> = {};
  for (const row of prices) {
    pricesMap[row.price_type] = Number(row.price) || 0;
  }
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    product: {
      id: product.id,
      sku: product.sku,
      code: product.code,
      name: product.name,
      brand: product.brand,
      barcode: product.barcode,
      array_sku: product.array_sku,
      category: product.category,
      unit: product.unit,
      is_active: Boolean(product.is_active),
      package: {
        width_cm: product.package_width_cm,
        height_cm: product.package_height_cm,
        length_cm: product.package_length_cm,
        weight_g: product.package_weight_g,
      },
    },
    prices: prices.map((p) => ({ type: p.price_type, price: Number(p.price) || 0 })),
    prices_map: pricesMap,
    purchase: lastPurchase
      ? {
          last_price: Number(lastPurchase.price) || 0,
          qty: Number(lastPurchase.qty) || 0,
          date: lastPurchase.doc_date,
          doc_number: lastPurchase.number,
          line_amount: Number(lastPurchase.amount) || 0,
        }
      : null,
    properties,
    rests,
  };
}

/** Постоянная JSON-ссылка: товар + цены (+ последняя цена закупа).
 *  Без сессии нужен key=WMS_JSON_KEY|WMS_INGEST_KEY
 *  Примеры:
 *    /api/public/product.json?sku=MRAE21065&key=...
 *    /api/public/product/MRAE21065.json?key=...
 */
api.get('/public/product.json', (c) => {
  if (!publicJsonKeyOk(c) && !actorFromContext(c)) {
    return c.json({ error: 'forbidden', hint: 'нужен ?key= или вход в Учёт №1' }, 403);
  }
  const ref =
    c.req.query('sku')
    || c.req.query('code')
    || c.req.query('barcode')
    || c.req.query('id')
    || '';
  const product = findProductForExport(ref);
  if (!product) return c.json({ ok: false, error: 'not found' }, 404);
  return c.json(buildProductExportJson(product as Record<string, unknown>));
});

api.get('/public/product/:ref', (c) => {
  if (!publicJsonKeyOk(c) && !actorFromContext(c)) {
    return c.json({ error: 'forbidden', hint: 'нужен ?key= или вход в Учёт №1' }, 403);
  }
  let ref = decodeURIComponent(c.req.param('ref') || '');
  if (ref.toLowerCase().endsWith('.json')) ref = ref.slice(0, -5);
  const product = findProductForExport(ref);
  if (!product) return c.json({ ok: false, error: 'not found' }, 404);
  return c.json(buildProductExportJson(product as Record<string, unknown>));
});

/** Для карточки товара: постоянная ссылка с key (нужна сессия). */
api.get('/products/:id/json-link', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');
  const product = get<{ id: string; sku: string; code: string }>(
    `SELECT id, sku, code FROM products WHERE id = ?`,
    [id]
  );
  if (!product) return c.json({ error: 'not found' }, 404);
  const key = (process.env.WMS_JSON_KEY || process.env.WMS_INGEST_KEY || '').trim();
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || '1c.pnevmopodveska1.ru';
  const proto = c.req.header('x-forwarded-proto') || 'https';
  const base = `${proto}://${host}`;
  const sku = encodeURIComponent(product.sku || product.id);
  const q = key ? `?key=${encodeURIComponent(key)}` : '';
  return c.json({
    ok: true,
    sku: product.sku,
    code: product.code,
    url: `${base}/api/public/product/${sku}.json${q}`,
    url_query: `${base}/api/public/product.json?sku=${sku}${key ? '&key=' + encodeURIComponent(key) : ''}`,
  });
});

api.get('/money/tochka', async (c) => {
  try {
    const data = await fetchTochkaOverview();
    return c.json(data);
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'tochka failed' }, 502);
  }
});

api.get('/me', (c) => {
  const actor = actorFromContext(c);
  if (!actor) {
    // legacy cookie
    return c.json({
      id: '__admin__',
      name: 'Админ (системный)',
      email: '',
      login: 'admin',
      role: 'admin',
      rights: rightsForRole('admin'),
      isSystemAdmin: true,
    });
  }
  return c.json({
    id: actor.id,
    name: actor.name,
    email: actor.email,
    login: actor.login,
    role: actor.role,
    rights: actor.rights,
    isSystemAdmin: actor.isSystemAdmin,
  });
});

api.post('/me/password', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ old_password?: string; new_password?: string }>();
  try {
    changeOwnPassword(actor.id, String(body.old_password || ''), String(body.new_password || ''));
    auditFromContext(c, {
      action: 'auth.password_change',
      entity: 'staff',
      entityId: actor.id,
      summary: `Смена своего пароля: ${actor.name}`,
    });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/audit', (c) => {
  const page = Number(c.req.query('page') || 1);
  const limit = Number(c.req.query('limit') || 50);
  return c.json(
    listAudit({
      q: c.req.query('q') || '',
      action: c.req.query('action') || '',
      entity: c.req.query('entity') || '',
      entityId: c.req.query('entity_id') || '',
      actorId: c.req.query('actor_id') || '',
      page,
      limit,
    })
  );
});

function isAdminActor(actor: ReturnType<typeof actorFromContext>): boolean {
  return !!(actor && (actor.isSystemAdmin || actor.role === 'admin'));
}

/** Heartbeat: кто где сидит (для всех авторизованных) + IP/UA/регион. */
api.post('/presence/heartbeat', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({})) as {
    path?: string;
    title?: string;
    section?: string;
  };
  const client = await enrichClientMeta(c);
  touchPresence({
    actor,
    path: body.path,
    title: body.title,
    section: body.section,
    client,
  });
  return c.json({ ok: true });
});

/** Список онлайн — только админам. */
api.get('/presence/online', (c) => {
  const actor = actorFromContext(c);
  if (!isAdminActor(actor)) {
    return c.json({ error: 'Только для администраторов' }, 403);
  }
  const items = listOnlinePresence();
  return c.json({ items, total: items.length, online_sec: 120 });
});

api.get('/stats', (c) => {
  const products = get<{ c: number }>('SELECT COUNT(*) AS c FROM products WHERE is_active = 1')?.c ?? 0;
  const warehouses = get<{ c: number }>('SELECT COUNT(*) AS c FROM warehouses WHERE is_active = 1')?.c ?? 0;
  const docs = get<{ c: number }>('SELECT COUNT(*) AS c FROM stock_docs')?.c ?? 0;
  const skuQty = get<{ s: number }>('SELECT COALESCE(SUM(qty),0) AS s FROM stock_balances')?.s ?? 0;
  const counts = catalogCounts();
  return c.json({
    products,
    warehouses,
    docs,
    skuQty,
    odata: counts,
    hs: hsSyncMeta(),
    media: mediaSyncMeta(),
    dicts: dictMeta(),
    staff: staffMeta(),
    docs1c: docsSyncMeta(),
    crm: dealsMeta(),
    disk: diskStats(process.env.WMS_DATA_DIR || '/'),
  });
});

api.get('/crm/pipelines', (c) => c.json({ items: listPipelines(), meta: dealsMeta() }));

api.get('/crm/deals', (c) => {
  const q = (c.req.query('q') || '').trim();
  const pipelineId = (c.req.query('pipeline_id') || '').trim();
  const statusId = (c.req.query('status_id') || '').trim();
  const page = Math.max(1, Number(c.req.query('page') || 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 50) || 50));
  return c.json(
    listDeals({
      q,
      pipelineId: pipelineId || undefined,
      statusId: statusId || undefined,
      page,
      limit,
    })
  );
});

api.get('/crm/deals/:id', (c) => {
  const deal = getDeal(c.req.param('id'));
  if (!deal) return c.json({ error: 'not found' }, 404);
  return c.json(deal);
});

/** QR СБП на оплату заказа (Точка через bank). */
api.post('/crm/deals/:id/sbp-qr', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json().catch(() => ({})) as {
    amount?: number;
    purpose?: string;
    account?: string;
    ttl_sec?: number;
  };
  try {
    const payment = await createDealSbpQr({
      dealId: c.req.param('id'),
      amount: body.amount,
      purpose: body.purpose,
      account: body.account,
      ttlSec: body.ttl_sec,
    });
    auditFromContext(c, {
      action: 'deal.sbp_qr',
      entity: 'crm_deal',
      entityId: c.req.param('id'),
      summary: `QR СБП по сделке ${c.req.param('id')} на ${payment?.amount}`,
      after: { payment_id: payment?.id, qrc_id: payment?.qrc_id, amount: payment?.amount },
    });
    return c.json({ ok: true, payment });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'qr failed' }, 400);
  }
});

api.get('/crm/deals/:id/payments', (c) =>
  c.json({ items: listDealPayments(c.req.param('id')) })
);

api.get('/payments/:id', (c) => {
  const row = getDealPayment(c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});

api.delete('/payments/:id', (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const id = c.req.param('id');
  const row = deleteDealPayment(id);
  if (!row) return c.json({ error: 'not found' }, 404);
  auditFromContext(c, {
    action: 'deal.payment_delete',
    entity: 'deal_payment',
    entityId: id,
    summary: `Удалён QR/оплата ${row.qrc_id || id} по сделке ${row.deal_id} на ${row.amount}`,
    before: {
      payment_id: row.id,
      deal_id: row.deal_id,
      qrc_id: row.qrc_id,
      amount: row.amount,
      status: row.status,
    },
  });
  return c.json({ ok: true, id, deal_id: row.deal_id });
});

api.get('/payments/:id/image.png', (c) => {
  const row = getDealPayment(c.req.param('id'));
  if (!row || !row.image_png_base64) return c.json({ error: 'not found' }, 404);
  const buf = Buffer.from(String(row.image_png_base64), 'base64');
  c.header('Content-Type', 'image/png');
  c.header('Cache-Control', 'no-store');
  return c.body(buf);
});

api.get('/fiscal/status', (c) => c.json(atolStatusInfo()));

api.get('/crm/deals/:id/fiscal', (c) =>
  c.json({ items: listFiscalReceipts(c.req.param('id')), atol: atolStatusInfo() })
);

/** Чек 1 (предоплата) или чек 2 (полный расчёт). send=true — в АТОЛ, иначе черновик. */
api.post('/crm/deals/:id/fiscal/:kind', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const kind = c.req.param('kind');
  if (kind !== 'advance' && kind !== 'full') {
    return c.json({ error: 'kind: advance | full' }, 400);
  }
  const body = await c.req.json().catch(() => ({})) as { send?: boolean };
  try {
    const receipt = await prepareOrSendFiscalReceipt({
      dealId: c.req.param('id'),
      kind,
      send: Boolean(body.send),
    });
    auditFromContext(c, {
      action: 'fiscal.receipt',
      entity: 'crm_deal',
      entityId: c.req.param('id'),
      summary: `Чек ${kind} по сделке ${c.req.param('id')}: ${receipt?.status}`,
      after: { receipt_id: receipt?.id, status: receipt?.status, amount: receipt?.amount },
    });
    return c.json({ ok: true, receipt, atol: atolStatusInfo() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'fiscal failed' }, 400);
  }
});

api.get('/fiscal/receipts/:id', (c) => {
  const row = getFiscalReceipt(c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});

api.post('/crm/deals/sync', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_sync')) {
    return c.json({ error: 'Недостаточно прав: синхронизация' }, 403);
  }
  const body = await c.req.json().catch(() => ({})) as {
    days?: number;
    limit?: number;
    deal_id?: string;
  };
  try {
    const result = syncDealsFromAmo1c({
      days: body.days ?? 60,
      limit: body.limit ?? 800,
      dealId: body.deal_id,
    });
    auditFromContext(c, {
      action: 'crm.deals_sync',
      entity: 'crm_deal',
      entityId: body.deal_id ? String(body.deal_id) : '',
      summary: body.deal_id
        ? `Обновление сделки Amo ${body.deal_id}`
        : `Синк сделок Amo: ${result.deals}, воронок ${result.pipelines}`,
      after: result,
    });
    return c.json({ ok: true, ...result, meta: dealsMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'deals sync failed' }, 500);
  }
});

/** Dual-write из amo1c при «Отправить в 1С» (ключ WMS_INGEST_KEY). */
api.post('/crm/deals/ingest', async (c) => {
  const key = c.req.query('key') || c.req.header('x-wms-ingest-key') || '';
  const expect = process.env.WMS_INGEST_KEY || '';
  if (!expect || key !== expect) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const body = await c.req.json().catch(() => ({})) as {
    deal?: Record<string, unknown>;
    pipelines?: Array<Record<string, unknown>>;
  };
  if (!body.deal || !body.deal.id) {
    return c.json({ error: 'deal required' }, 400);
  }
  const dealId = String(body.deal.id);
  const before = getDeal(dealId);
  upsertDealRecord(body.deal);
  writeAudit({
    action: 'crm.deal_ingest',
    entity: 'crm_deal',
    entityId: dealId,
    summary: `Сделка из amo1c: ${String(body.deal.name || dealId)}`,
    before: before || undefined,
    after: { id: dealId, name: body.deal.name, price: body.deal.price },
  });
  return c.json({ ok: true, id: dealId });
});

api.get('/org-profile', (c) => c.json(getOrgProfile()));

api.put('/org-profile', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json().catch(() => ({})) as Record<string, string | number>;
  const saved = saveOrgProfile(body as Record<string, string>);
  auditFromContext(c, {
    action: 'org.profile_save',
    entity: 'org_profile',
    summary: 'Реквизиты организации для печати счетов/УПД',
    after: saved,
  });
  return c.json(saved);
});

api.get('/doc-numbering', (c) => c.json(getDocNumberingState()));

api.post('/doc-numbering/sync-from-1c', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  try {
    const state = await syncDocNumberingFrom1c();
    auditFromContext(c, {
      action: 'doc.numbering_sync',
      entity: 'doc_numbering',
      summary: `Нумерация из 1С: расход ${state.last_out_1c}, приход ${state.last_in_1c}`,
      after: state,
    });
    return c.json({ ok: true, ...state });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'sync failed' }, 500);
  }
});

api.put('/doc-numbering', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    last_out?: string | number;
    last_in?: string | number;
    last_invoice?: string | number;
  };
  try {
    const state = applyDocNumberingPatch(body);
    auditFromContext(c, {
      action: 'doc.numbering_set',
      entity: 'doc_numbering',
      summary: 'Ручная установка последних номеров документов',
      after: state,
    });
    return c.json({ ok: true, ...state });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'bad numbering' }, 400);
  }
});

api.get('/sales-docs', (c) => {
  const type = (c.req.query('type') || '').trim() as SalesDocType | '';
  const q = (c.req.query('q') || '').trim();
  const dealId = (c.req.query('deal_id') || '').trim();
  const items = listSalesDocs({
    type:
      type === 'invoice' || type === 'upd' || type === 'sf' || type === 'workorder' ? type : '',
    q,
    dealId: dealId || undefined,
  });
  return c.json({
    items,
    labels: { invoice: 'Счёт', upd: 'УПД', sf: 'СФ', workorder: 'Заказ-наряд' },
  });
});

api.get('/sales-docs/:id', (c) => {
  const doc = getSalesDoc(c.req.param('id'));
  if (!doc) return c.json({ error: 'not found' }, 404);
  return c.json(doc);
});

api.get('/sales-docs/:id/print', (c) => {
  const html = renderSalesDocPrintHtml(c.req.param('id'));
  if (!html) return c.html('<p>Документ не найден</p>', 404);
  return c.html(html);
});

/** Настоящий PDF: открыть в вкладке или скачать (?download=1). */
api.get('/sales-docs/:id/pdf', async (c) => {
  try {
    const result = await renderSalesDocPdf(c.req.param('id'));
    if (!result) return c.json({ error: 'not found' }, 404);
    const download = c.req.query('download') === '1' || c.req.query('download') === 'true';
    const asciiName = result.filename.replace(/[^\x20-\x7E]+/g, '_');
    c.header('Content-Type', 'application/pdf');
    c.header(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
    );
    c.header('Cache-Control', 'no-store');
    return c.body(new Uint8Array(result.buffer));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'pdf failed' }, 500);
  }
});

api.post('/sales-docs/from-deal', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав на документы' }, 403);
  }
  const body = await c.req.json().catch(() => ({})) as {
    deal_id?: string;
    doc_type?: string;
    vat_rate?: number;
    buyer_name?: string;
    buyer_inn?: string;
    comment?: string;
  };
  const dealId = String(body.deal_id || '').trim();
  const docType = String(body.doc_type || '').trim() as SalesDocType;
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  if (!['invoice', 'upd', 'sf', 'workorder'].includes(docType)) {
    return c.json({ error: 'doc_type: invoice | upd | sf | workorder' }, 400);
  }
  try {
    const doc = createSalesDocFromDeal({
      dealId,
      docType,
      vatRate: body.vat_rate,
      buyerName: body.buyer_name,
      buyerInn: body.buyer_inn,
      comment: body.comment,
      createdBy: actor?.login || actor?.name || '',
    });
    auditFromContext(c, {
      action: 'sales_doc.create',
      entity: 'sales_doc',
      entityId: String(doc?.id || ''),
      summary: `${salesDocTypeLabel(docType)} из сделки ${dealId}`,
      after: { id: doc?.id, number: doc?.number, total: doc?.total },
    });
    return c.json({ ok: true, doc });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'create failed' }, 400);
  }
});

/** Пакет: счёт + заказ-наряд + УПД за один запрос. */
api.post('/sales-docs/pack-from-deal', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав на документы' }, 403);
  }
  const body = await c.req.json().catch(() => ({})) as {
    deal_id?: string;
    types?: string[];
    vat_rate?: number;
    buyer_name?: string;
    buyer_inn?: string;
  };
  const dealId = String(body.deal_id || '').trim();
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  const allowed = new Set(['invoice', 'upd', 'sf', 'workorder']);
  const types = (body.types || [])
    .map((t) => String(t).trim())
    .filter((t): t is SalesDocType => allowed.has(t));
  try {
    const docs = createSalesDocPackFromDeal({
      dealId,
      types: types.length ? types : undefined,
      vatRate: body.vat_rate,
      buyerName: body.buyer_name,
      buyerInn: body.buyer_inn,
      createdBy: actor?.login || actor?.name || '',
    });
    for (const doc of docs) {
      if (!doc) continue;
      auditFromContext(c, {
        action: 'sales_doc.create',
        entity: 'sales_doc',
        entityId: String(doc.id || ''),
        summary: `${salesDocTypeLabel(doc.doc_type as SalesDocType)} из сделки ${dealId} (пакет)`,
        after: { id: doc.id, number: doc.number, total: doc.total },
      });
    }
    return c.json({ ok: true, docs: docs.filter(Boolean) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'create pack failed' }, 400);
  }
});

api.post('/sync/docs', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { kinds?: Array<'in' | 'out'> };
  const kinds = body.kinds?.length ? body.kinds : (['in', 'out'] as Array<'in' | 'out'>);
  try {
    const result = await syncDocsFromOdata(kinds);
    auditFromContext(c, {
      action: 'sync.docs',
      entity: 'stock_doc',
      summary: `Документы 1С: приход ${result.inHeaders}/${result.inLines} стр., расход ${result.outHeaders}/${result.outLines} стр.`,
      after: result,
    });
    return c.json({ ok: true, ...result, meta: docsSyncMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'docs sync failed' }, 500);
  }
});

api.post('/sync/odata', async (c) => {
  const cfg = odataConfigFromEnv();
  if (!cfg) {
    return c.json({ error: 'OData не настроен (ODATA_BASE_URL / USER / PASSWORD)' }, 500);
  }
  try {
    const result = await withCatalogSyncLock('odata', async () => {
      const odata = await syncCatalogsFromOdata(cfg);
      let hs = null as Awaited<ReturnType<typeof syncApplicabilityAndProperties>> | null;
      let hsError: string | null = null;
      if (hsConfigured()) {
        try {
          hs = await syncApplicabilityAndProperties();
        } catch (e) {
          hsError = e instanceof Error ? e.message : 'hs sync failed';
        }
      }
      return { odata, hs, hsError };
    });
    auditFromContext(c, {
      action: 'sync.odata',
      entity: 'sync',
      summary: `OData: складов ${result.odata.warehouses}, категорий ${result.odata.categories}, товаров ${result.odata.products}`,
      after: result.odata,
    });
    return c.json({
      ok: true,
      ...result.odata,
      hs: result.hs,
      hsError: result.hsError,
      counts: catalogCounts(),
      hsMeta: hsSyncMeta(),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'sync failed' }, 500);
  }
});

api.post('/sync/hs', async (c) => {
  if (!hsConfigured()) {
    return c.json({ error: 'HS не настроен (HS_BASE_URL / HS_USER / HS_PASS)' }, 500);
  }
  try {
    const result = await withCatalogSyncLock('hs', () => syncApplicabilityAndProperties());
    auditFromContext(c, {
      action: 'sync.hs',
      entity: 'sync',
      summary: `HS полный: товаров ${result.productsUpserted}, цен ${result.prices}, остатков ${result.restRows}`,
      after: result,
    });
    return c.json({ ok: true, ...result, hsMeta: hsSyncMeta(), dicts: dictMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'hs sync failed' }, 500);
  }
});

api.post('/sync/prices', async (c) => {
  if (!hsConfigured()) {
    return c.json({ error: 'HS не настроен (HS_BASE_URL / HS_USER / HS_PASS)' }, 500);
  }
  try {
    const result = await withCatalogSyncLock('prices', () => syncPricesOnly());
    auditFromContext(c, {
      action: 'sync.prices',
      entity: 'price',
      summary: `Синк цен из 1С: ${result.prices} строк`,
      after: result,
    });
    return c.json({ ok: true, ...result, hsMeta: hsSyncMeta(), dicts: dictMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'prices sync failed' }, 500);
  }
});

api.post('/sync/rests', async (c) => {
  if (!hsConfigured()) {
    return c.json({ error: 'HS не настроен (HS_BASE_URL / HS_USER / HS_PASS)' }, 500);
  }
  try {
    const result = await withCatalogSyncLock('rests', () => syncRestsOnly());
    auditFromContext(c, {
      action: 'sync.rests',
      entity: 'stock',
      summary: `Синк остатков из 1С: ${result.restRows} строк`,
      after: result,
    });
    return c.json({ ok: true, ...result, hsMeta: hsSyncMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'rests sync failed' }, 500);
  }
});

api.get('/employees', (c) => c.json(all('SELECT * FROM employees ORDER BY name')));

api.get('/staff', (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase();
  const role = (c.req.query('role') || '').trim();
  let rows = all<Record<string, unknown>>(
    `SELECT * FROM staff ORDER BY
      CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 WHEN 'warehouse' THEN 2
        WHEN 'sales' THEN 3 WHEN 'readonly' THEN 4 ELSE 5 END,
      name`
  );
  if (role) rows = rows.filter((r) => String(r.role) === role);
  if (q) {
    rows = rows.filter((r) => {
      const hay = [r.name, r.email, r.amo_id, r.one_c_name, r.one_c_code, r.auth_login, r.department, r.login]
        .map((x) => String(x || '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
  }
  return c.json({
    items: rows.map(publicStaffRow),
    meta: staffMeta(),
    roles: STAFF_ROLES,
    sections: STAFF_SECTIONS,
  });
});

api.post('/staff/sync', (c) => {
  try {
    const result = syncStaffFromAmoAnd1c();
    auditFromContext(c, {
      action: 'staff.sync',
      entity: 'staff',
      summary: `Синк персонала: Amo ${result.amoUsers}, 1С ${result.hsEmployees}, записей ${result.upserted}`,
      after: result,
    });
    return c.json({ ok: true, ...result, meta: staffMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'staff sync failed' }, 500);
  }
});

api.patch('/staff/:id', async (c) => {
  const id = c.req.param('id');
  const row = get<Record<string, unknown>>('SELECT * FROM staff WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'Не найдено' }, 404);
  const body = await c.req.json<{
    role?: string;
    can_login?: boolean | number;
    notes?: string;
    password?: string;
    login?: string;
    rights?: {
      sections?: string[];
      can_sync?: boolean;
      can_edit_products?: boolean;
      can_edit_prices?: boolean;
      can_edit_docs?: boolean;
    };
    apply_role_defaults?: boolean;
  }>();

  const before = publicStaffRow(row);

  let role = String(row.role || 'none');
  if (body.role !== undefined) {
    if (!STAFF_ROLES.includes(body.role as StaffRole)) {
      return c.json({ error: 'Неизвестная роль' }, 400);
    }
    role = body.role;
  }

  let rights = parseRights(String(row.rights_json || ''), role);
  if (body.apply_role_defaults || (body.role !== undefined && body.rights === undefined)) {
    rights = rightsForRole(role as StaffRole);
  }
  if (body.rights) {
    if (Array.isArray(body.rights.sections)) {
      rights.sections = body.rights.sections.map(String).filter((s) =>
        (STAFF_SECTIONS as readonly string[]).includes(s)
      );
    }
    if (body.rights.can_sync !== undefined) rights.can_sync = Boolean(body.rights.can_sync);
    if (body.rights.can_edit_products !== undefined) {
      rights.can_edit_products = Boolean(body.rights.can_edit_products);
    }
    if (body.rights.can_edit_prices !== undefined) {
      rights.can_edit_prices = Boolean(body.rights.can_edit_prices);
    }
    if (body.rights.can_edit_docs !== undefined) {
      rights.can_edit_docs = Boolean(body.rights.can_edit_docs);
    }
  }

  let canLogin = Number(row.can_login) ? 1 : 0;
  if (body.can_login !== undefined) canLogin = body.can_login ? 1 : 0;

  const notes = body.notes !== undefined ? String(body.notes).slice(0, 500) : String(row.notes || '');
  let login = String(row.login || '');
  if (body.login !== undefined) login = String(body.login).trim().slice(0, 80);

  run(
    `UPDATE staff SET role = ?, rights_json = ?, can_login = ?, notes = ?, login = ? WHERE id = ?`,
    [role, JSON.stringify(rights), canLogin, notes, login, id]
  );

  if (body.password) {
    try {
      setStaffPassword(id, body.password);
      auditFromContext(c, {
        action: 'auth.password_set',
        entity: 'staff',
        entityId: id,
        summary: `Пароль задан админом: ${row.name}`,
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'password error' }, 400);
    }
  }

  const after = publicStaffRow(get<Record<string, unknown>>('SELECT * FROM staff WHERE id = ?', [id])!);
  auditFromContext(c, {
    action: 'staff.update',
    entity: 'staff',
    entityId: id,
    summary: `Права/роль: ${after.name} → ${after.role}, вход=${after.can_login ? 'да' : 'нет'}`,
    before,
    after,
  });
  return c.json(after);
});

api.post('/sync/dicts', (c) => {
  try {
    const result = rebuildDictionaries();
    return c.json({ ok: true, ...result, dicts: dictMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'dicts rebuild failed' }, 500);
  }
});

api.get('/dicts/properties', (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q) {
    const like = `%${q}%`;
    return c.json(
      all(
        `SELECT * FROM dict_properties WHERE name LIKE ? ORDER BY name`,
        [like]
      )
    );
  }
  return c.json(all('SELECT * FROM dict_properties ORDER BY name'));
});

api.get('/dicts/properties/:id/values', (c) => {
  const id = c.req.param('id');
  return c.json(
    all(
      `SELECT * FROM dict_property_values WHERE property_id = ? ORDER BY value`,
      [id]
    )
  );
});

api.get('/dicts/marks', (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q) {
    return c.json(
      all(`SELECT * FROM dict_marks WHERE name LIKE ? ORDER BY name`, [`%${q}%`])
    );
  }
  return c.json(all('SELECT * FROM dict_marks ORDER BY name'));
});

api.get('/dicts/marks/:id/models', (c) => {
  const id = c.req.param('id');
  return c.json(
    all(`SELECT * FROM dict_models WHERE mark_id = ? ORDER BY name`, [id])
  );
});

api.get('/dicts/brands', (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q) {
    return c.json(
      all(`SELECT * FROM dict_brands WHERE name LIKE ? ORDER BY name`, [`%${q}%`])
    );
  }
  return c.json(all('SELECT * FROM dict_brands ORDER BY name'));
});

api.get('/dicts/generations', (c) =>
  c.json(all('SELECT * FROM dict_generations ORDER BY name'))
);

api.get('/dicts/price-types', (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q) {
    return c.json(
      all(`SELECT * FROM dict_price_types WHERE name LIKE ? ORDER BY name`, [`%${q}%`])
    );
  }
  return c.json(all('SELECT * FROM dict_price_types ORDER BY name'));
});

api.post('/dicts/price-types', async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const name = (body.name || '').trim();
  if (!name) return c.json({ error: 'name required' }, 400);
  const exists = get('SELECT id FROM dict_price_types WHERE name = ?', [name]);
  if (exists) return c.json({ error: 'Такой тип цены уже есть' }, 409);
  const id = newGuid();
  run('INSERT INTO dict_price_types (id, name, products_count) VALUES (?, ?, 0)', [id, name]);
  auditFromContext(c, {
    action: 'price_type.create',
    entity: 'price_type',
    entityId: id,
    summary: `Тип цены добавлен: ${name}`,
  });
  return c.json({ id, name, products_count: 0 }, 201);
});

api.patch('/dicts/price-types/:id', async (c) => {
  const id = c.req.param('id');
  const row = get<{ id: string; name: string }>('SELECT * FROM dict_price_types WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ name?: string }>();
  const name = (body.name || '').trim();
  if (!name) return c.json({ error: 'name required' }, 400);
  if (name === row.name) return c.json(row);
  const clash = get('SELECT id FROM dict_price_types WHERE name = ? AND id != ?', [name, id]);
  if (clash) return c.json({ error: 'Такой тип цены уже есть' }, 409);
  run('BEGIN');
  try {
    run('UPDATE product_prices SET price_type = ? WHERE price_type = ?', [name, row.name]);
    run('UPDATE dict_price_types SET name = ? WHERE id = ?', [name, id]);
    const count =
      get<{ c: number }>(
        'SELECT COUNT(DISTINCT product_id) AS c FROM product_prices WHERE price_type = ?',
        [name]
      )?.c ?? 0;
    run('UPDATE dict_price_types SET products_count = ? WHERE id = ?', [count, id]);
    run('COMMIT');
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
  auditFromContext(c, {
    action: 'price_type.rename',
    entity: 'price_type',
    entityId: id,
    summary: `Тип цены: «${row.name}» → «${name}»`,
    before: { name: row.name },
    after: { name },
  });
  return c.json(get('SELECT * FROM dict_price_types WHERE id = ?', [id]));
});

api.delete('/dicts/price-types/:id', async (c) => {
  const id = c.req.param('id');
  const row = get<{ id: string; name: string }>('SELECT * FROM dict_price_types WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  run('BEGIN');
  try {
    run('DELETE FROM product_prices WHERE price_type = ?', [row.name]);
    run('DELETE FROM dict_price_types WHERE id = ?', [id]);
    run('COMMIT');
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
  auditFromContext(c, {
    action: 'price_type.delete',
    entity: 'price_type',
    entityId: id,
    summary: `Тип цены удалён: ${row.name}`,
    before: row,
  });
  return c.json({ ok: true });
});

api.get('/dicts/meta', (c) => c.json(dictMeta()));

api.post('/sync/media', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_sync')) {
    return c.json({ error: 'Недостаточно прав: синхронизация 1С' }, 403);
  }
  if (!hsConfigured() || !s3ConfigFromEnv()) {
    return c.json({ error: 'Нужны HS_* и S3_* в окружении сервиса' }, 500);
  }
  const body = await c.req.json().catch(() => ({})) as {
    limit?: number;
    onlyMissing?: boolean;
    replace?: boolean;
    product_id?: string;
  };
  try {
    const result = await syncMediaFrom1c({
      limit: body.limit ?? 100,
      onlyMissing: body.onlyMissing !== false,
      replace: !!body.replace,
      productIds: body.product_id ? [body.product_id] : undefined,
    });
    auditFromContext(c, {
      action: 'media.sync',
      entity: body.product_id ? 'product' : 'media',
      entityId: body.product_id ? String(body.product_id) : '',
      summary: body.product_id
        ? `Фото из 1С для товара ${body.product_id}: +${result.uploaded || 0}`
        : `Синк фото: загружено ${result.uploaded || 0}, пусто ${result.empty || 0}`,
      after: result,
    });
    return c.json({ ok: true, ...result, media: mediaSyncMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'media sync failed' }, 500);
  }
});

api.post('/sync/media-orient', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_sync')) {
    return c.json({ error: 'Недостаточно прав: синхронизация 1С' }, 403);
  }
  const body = await c.req.json().catch(() => ({})) as {
    limit?: number;
    product_id?: string;
  };
  try {
    const result = await backfillMediaOrientation({
      limit: body.limit ?? 300,
      productId: body.product_id,
    });
    return c.json({ ok: true, ...result, media: mediaSyncMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'orient backfill failed' }, 500);
  }
});

api.get('/sync/odata/status', (c) =>
  c.json({ ...catalogCounts(), hs: hsSyncMeta(), media: mediaSyncMeta() })
);

/* ——— фото / медиа покрытие ——— */
api.get('/media/coverage', (c) => c.json(mediaCoverageByCategory()));

api.get('/media/products', (c) => {
  const statusRaw = (c.req.query('status') || 'all').trim();
  const status =
    statusRaw === 'with' || statusRaw === 'without' ? statusRaw : 'all';
  return c.json(
    listMediaProducts({
      q: (c.req.query('q') || '').trim() || undefined,
      category_id: (c.req.query('category_id') || '').trim() || undefined,
      status,
      page: Number(c.req.query('page') || 1) || 1,
      limit: Number(c.req.query('limit') || 50) || 50,
    })
  );
});

/* ——— catalogs ——— */
api.get('/categories', (c) => {
  const wantAll = c.req.query('all') === '1' || c.req.query('all') === 'true';
  const rows = all<{
    id: string;
    name: string;
    parent_id: string | null;
    created_at?: string;
    products_count: number;
  }>(
    `SELECT c.id, c.name, c.parent_id, c.created_at,
            COALESCE(pc.cnt, 0) AS products_count
     FROM categories c
     LEFT JOIN (
       SELECT category_id, COUNT(*) AS cnt FROM products GROUP BY category_id
     ) pc ON pc.category_id = c.id
     ORDER BY c.name COLLATE NOCASE, products_count DESC, c.created_at DESC`
  );
  if (wantAll) return c.json(rows);
  // Одноимённые папки (пустая оболочка + рабочая) — в UI одна строка. Фогель не синчим.
  const seen = new Set<string>();
  const deduped: typeof rows = [];
  for (const row of rows) {
    const key = String(row.name || '')
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return c.json(deduped);
});

api.get('/categories/tree', (c) => c.json(buildCategoryTree()));

api.post('/categories', async (c) => {
  const body = await c.req.json<{ name: string; parent_id?: string }>();
  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400);
  const id = newGuid();
  run('INSERT INTO categories (id, name, parent_id) VALUES (?, ?, ?)', [
    id,
    body.name.trim(),
    body.parent_id ?? null,
  ]);
  return c.json({ id }, 201);
});

api.get('/units', (c) => c.json(all('SELECT * FROM units ORDER BY name')));
api.post('/units', async (c) => {
  const body = await c.req.json<{ name: string; short_name: string }>();
  const id = newGuid();
  run('INSERT INTO units (id, name, short_name) VALUES (?, ?, ?)', [
    id,
    body.name.trim(),
    body.short_name.trim(),
  ]);
  return c.json({ id }, 201);
});

api.get('/warehouses', (c) => {
  const archived = (c.req.query('archived') || '0').trim();
  if (archived === '1') {
    return c.json(all('SELECT * FROM warehouses WHERE is_active = 0 ORDER BY name'));
  }
  if (archived === 'all') {
    return c.json(all('SELECT * FROM warehouses ORDER BY is_active DESC, name'));
  }
  return c.json(all('SELECT * FROM warehouses WHERE is_active = 1 ORDER BY name'));
});

api.post('/warehouses', async (c) => {
  const body = await c.req.json<{ name: string; code?: string }>();
  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400);
  const id = newGuid();
  // Код как в 1С: авто WH-000001 (ручной код — только если явно передали)
  const code = (body.code || '').trim() || nextCode('WH');
  try {
    run('INSERT INTO warehouses (id, name, code, is_active) VALUES (?, ?, ?, 1)', [
      id,
      body.name.trim(),
      code,
    ]);
  } catch {
    return c.json({ error: 'Код склада уже существует' }, 409);
  }
  return c.json({ id, code, name: body.name.trim(), is_active: 1 }, 201);
});

api.patch('/warehouses/:id', async (c) => {
  const id = c.req.param('id');
  const row = get('SELECT * FROM warehouses WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ name?: string; is_active?: boolean | number }>();
  if (body.name?.trim()) {
    run('UPDATE warehouses SET name = ? WHERE id = ?', [body.name.trim(), id]);
  }
  if (body.is_active != null) {
    const active = body.is_active === true || body.is_active === 1 ? 1 : 0;
    run('UPDATE warehouses SET is_active = ? WHERE id = ?', [active, id]);
  }
  return c.json(get('SELECT * FROM warehouses WHERE id = ?', [id]));
});

function parsePage(c: { req: { query: (k: string) => string | undefined } }, defLimit = 50) {
  const page = Math.max(1, Number(c.req.query('page') || 1) || 1);
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') || defLimit) || defLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

api.get('/counterparties', (c) => {
  const q = (c.req.query('q') || '').trim();
  const kind = (c.req.query('kind') || '').trim(); // supplier | buyer | both | ''
  const { page, limit, offset } = parsePage(c, 50);
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (kind === 'supplier') {
    where.push(`(kind = 'supplier' OR kind = 'both')`);
  } else if (kind === 'buyer') {
    where.push(`(kind = 'buyer' OR kind = 'both')`);
  } else if (kind === 'both') {
    where.push(`kind = 'both'`);
  }
  if (q) {
    where.push(`(name LIKE ? OR IFNULL(inn,'') LIKE ? OR IFNULL(phone,'') LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total =
    get<{ c: number }>(`SELECT COUNT(*) AS c FROM counterparties ${whereSql}`, params)?.c ?? 0;
  const items = all(
    `SELECT * FROM counterparties ${whereSql} ORDER BY name LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return c.json({
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});
api.post('/counterparties', async (c) => {
  const body = await c.req.json<{ name: string; inn?: string; phone?: string; kind?: string }>();
  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400);
  const id = newGuid();
  const kind = ['supplier', 'buyer', 'both'].includes(String(body.kind || ''))
    ? String(body.kind)
    : 'supplier';
  run(
    'INSERT INTO counterparties (id, name, inn, phone, kind) VALUES (?, ?, ?, ?, ?)',
    [id, body.name.trim(), body.inn ?? '', body.phone ?? '', kind]
  );
  auditFromContext(c, {
    action: 'counterparty.create',
    entity: 'counterparty',
    entityId: id,
    summary: `Контрагент создан: ${body.name.trim()}`,
    after: { name: body.name.trim(), inn: body.inn ?? '', phone: body.phone ?? '', kind },
  });
  return c.json({ id }, 201);
});

api.get('/counterparties/:id', (c) => {
  const id = c.req.param('id');
  const row = get('SELECT * FROM counterparties WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const docs = all(
    `SELECT d.id, d.doc_type, d.number, d.doc_date, d.posted, d.amount, d.source,
            w.name AS warehouse
     FROM stock_docs d
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     WHERE d.counterparty_id = ?
     ORDER BY d.doc_date DESC, d.number DESC
     LIMIT 50`,
    [id]
  );
  const docsTotal =
    get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM stock_docs WHERE counterparty_id = ?',
      [id]
    )?.c ?? 0;
  return c.json({ ...row, docs, docs_total: docsTotal });
});

api.patch('/counterparties/:id', async (c) => {
  const id = c.req.param('id');
  const row = get<Record<string, unknown>>('SELECT * FROM counterparties WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{
    name?: string;
    inn?: string;
    phone?: string;
    kind?: string;
  }>();
  const before = {
    name: row.name,
    inn: row.inn,
    phone: row.phone,
    kind: row.kind,
  };
  if (body.name != null) {
    const name = body.name.trim();
    if (!name) return c.json({ error: 'name не может быть пустым' }, 400);
    run('UPDATE counterparties SET name = ? WHERE id = ?', [name, id]);
  }
  if (body.inn != null) {
    run('UPDATE counterparties SET inn = ? WHERE id = ?', [body.inn.trim(), id]);
  }
  if (body.phone != null) {
    run('UPDATE counterparties SET phone = ? WHERE id = ?', [body.phone.trim(), id]);
  }
  if (body.kind != null) {
    const kind = String(body.kind).trim();
    if (!['supplier', 'buyer', 'both'].includes(kind)) {
      return c.json({ error: 'kind: supplier | buyer | both' }, 400);
    }
    run('UPDATE counterparties SET kind = ? WHERE id = ?', [kind, id]);
  }
  const after = get('SELECT name, inn, phone, kind FROM counterparties WHERE id = ?', [id]);
  auditFromContext(c, {
    action: 'counterparty.update',
    entity: 'counterparty',
    entityId: id,
    summary: `Контрагент изменён: ${(after as { name?: string })?.name || id}`,
    before,
    after,
  });
  return c.json({ ok: true });
});

api.get('/products', (c) => {
  const q = (c.req.query('q') || '').trim();
  const categoryId = (c.req.query('category_id') || '').trim();
  const categoryName = (c.req.query('category') || '').trim();
  const { page, limit, offset } = parsePage(c, 50);
  const select = `SELECT p.*, u.short_name AS unit, c.name AS category
     FROM products p
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN categories c ON c.id = p.category_id`;

  let where = 'WHERE p.is_active = 1';
  const params: Array<string | number> = [];

  if (q) {
    const like = `%${q}%`;
    // Сначала быстрый фильтр по полям товара; применимость — только если q ≥ 2 символов
    if (q.length >= 2) {
      where += ` AND (
        p.name LIKE ? OR p.sku LIKE ? OR IFNULL(p.brand,'') LIKE ?
        OR p.id IN (
          SELECT a.product_id FROM product_applicability a
          WHERE a.mark LIKE ? OR a.model LIKE ? OR a.only_model LIKE ?
          LIMIT 2000
        )
      )`;
      params.push(like, like, like, like, like, like);
    } else {
      where += ` AND (p.name LIKE ? OR p.sku LIKE ? OR IFNULL(p.brand,'') LIKE ?)`;
      params.push(like, like, like);
    }
  }

  if (categoryId === '__none__' || categoryName === '__none__') {
    where += ' AND (p.category_id IS NULL OR p.category_id = \'\')';
  } else if (categoryId) {
    // Две базы 1С → один и тот же name с разными GUID — берём все с этим именем
    where += ` AND (
      p.category_id = ?
      OR IFNULL(c.name,'') = (SELECT name FROM categories WHERE id = ? LIMIT 1)
    )`;
    params.push(categoryId, categoryId);
  } else if (categoryName) {
    where += ' AND IFNULL(c.name,\'\') = ?';
    params.push(categoryName);
  }

  const total =
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ${where}`,
      params
    )?.c ?? 0;
  const items = all(
    `${select} ${where} ORDER BY p.name LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return c.json({
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

api.get('/products/:id', (c) => {
  const id = c.req.param('id');
  const product = get(
    `SELECT p.*, u.short_name AS unit, c.name AS category
     FROM products p
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ?`,
    [id]
  );
  if (!product) return c.json({ error: 'not found' }, 404);
  const applicabilityRaw = all<{
    id: string;
    mark: string;
    model: string;
    only_model: string;
    generation: string;
    years: string;
  }>(
    `SELECT id, mark, model, only_model, generation, years
     FROM product_applicability WHERE product_id = ?
     ORDER BY mark, model, years`,
    [id]
  );
  const appCombos = all<{
    mark: string;
    model: string;
    generation: string;
    years: string;
  }>(
    `SELECT mark, model, generation, years
     FROM product_applicability
     WHERE IFNULL(mark,'') != ''
     GROUP BY mark, model, generation, years
     ORDER BY mark, COUNT(*) DESC, model, generation, years`
  );
  const markSet = new Set<string>();
  for (const row of appCombos) {
    if (row.mark) markSet.add(row.mark);
  }
  for (const row of applicabilityRaw) {
    if (row.mark) markSet.add(row.mark);
  }
  const applicability = applicabilityRaw;
  const applicability_options = {
    marks: [...markSet].sort((a, b) => a.localeCompare(b, 'ru')),
    combos: appCombos,
  };
  const propertiesRaw = all<{ property: string; value: string }>(
    `SELECT property, value FROM product_properties WHERE product_id = ? ORDER BY property`,
    [id]
  );
  const propNames = [...new Set(propertiesRaw.map((p) => p.property).filter(Boolean))];
  const optionsByProp = new Map<string, string[]>();
  if (propNames.length) {
    const placeholders = propNames.map(() => '?').join(',');
    const optionRows = all<{ property: string; value: string }>(
      `SELECT property, value
       FROM product_properties
       WHERE property IN (${placeholders}) AND IFNULL(value,'') != ''
       GROUP BY property, value
       ORDER BY property, COUNT(*) DESC, value`,
      propNames
    );
    for (const row of optionRows) {
      const list = optionsByProp.get(row.property) || [];
      list.push(row.value);
      optionsByProp.set(row.property, list);
    }
  }
  const properties = propertiesRaw.map((p) => {
    const options = optionsByProp.get(p.property) || [];
    if (p.value && !options.includes(p.value)) options.unshift(p.value);
    return { ...p, options };
  });
  const prices = all(
    `SELECT price_type, price FROM product_prices WHERE product_id = ?
     ORDER BY
       CASE price_type
         WHEN 'Розничная цена' THEN 0
         WHEN 'ОПТ1' THEN 1
         WHEN 'ОПТ2' THEN 2
         WHEN 'Цена снятие/установки' THEN 3
         WHEN 'Цена Маркетплейс' THEN 4
         ELSE 10
       END,
       price_type`,
    [id]
  );
  const media = all(
    `SELECT id, kind, mime, ext, url, size, sort_order, width, height, orientation
     FROM product_media WHERE product_id = ?
     ORDER BY sort_order, synced_at`,
    [id]
  );
  const rests = all(
    `SELECT r.warehouse_id, w.name AS warehouse, r.qty
     FROM product_store_rests r
     LEFT JOIN warehouses w ON w.id = r.warehouse_id
     WHERE r.product_id = ? AND r.qty != 0
     ORDER BY w.name`,
    [id]
  );
  const related = all(
    `SELECT p.id, p.sku, p.name
     FROM product_related r
     JOIN products p ON p.id = r.related_id
     WHERE r.product_id = ?
     ORDER BY p.name`,
    [id]
  );
  return c.json({
    ...product,
    applicability,
    applicability_options,
    properties,
    prices,
    media,
    rests,
    related,
  });
});

api.post('/products', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав: редактирование номенклатуры' }, 403);
  }
  const body = await c.req.json<{
    sku?: string;
    name: string;
    unit_id?: string;
    category_id?: string;
    barcode?: string;
  }>();
  if (!body.name?.trim()) {
    return c.json({ error: 'name required' }, 400);
  }
  const id = newGuid();
  const sku = (body.sku || '').trim() || nextCode('SKU');
  let unitId = (body.unit_id || '').trim();
  if (!unitId) {
    unitId =
      get<{ id: string }>('SELECT id FROM units WHERE short_name = ? LIMIT 1', ['шт'])?.id ||
      get<{ id: string }>('SELECT id FROM units LIMIT 1')?.id ||
      '';
  }
  if (!unitId) return c.json({ error: 'нет единиц измерения — синхронизируйте справочники' }, 400);
  try {
    run(
      `INSERT INTO products (id, sku, name, category_id, unit_id, barcode)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        sku,
        body.name.trim(),
        body.category_id ?? null,
        unitId,
        body.barcode ?? '',
      ]
    );
  } catch {
    return c.json({ error: 'SKU уже существует' }, 409);
  }
  auditFromContext(c, {
    action: 'product.create',
    entity: 'product',
    entityId: id,
    summary: `Товар добавлен: ${body.name.trim()} (${sku})`,
    after: { id, sku, name: body.name.trim() },
  });
  return c.json({ id, sku }, 201);
});

api.patch('/products/:id', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав: редактирование номенклатуры' }, 403);
  }
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    sku?: string;
    brand?: string;
    barcode?: string;
    category_id?: string | null;
    is_active?: boolean;
    code?: string;
    array_sku?: string;
    package_width_cm?: number | null;
    package_height_cm?: number | null;
    package_length_cm?: number | null;
    package_weight_g?: number | null;
    gtin?: string;
    requires_marking?: boolean | number;
  }>();
  const row = get<Record<string, unknown>>('SELECT * FROM products WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const before = {
    name: row.name,
    sku: row.sku,
    brand: row.brand,
    barcode: row.barcode,
    category_id: row.category_id,
    is_active: row.is_active,
    code: row.code,
    array_sku: row.array_sku,
    package_width_cm: row.package_width_cm,
    package_height_cm: row.package_height_cm,
    package_length_cm: row.package_length_cm,
    package_weight_g: row.package_weight_g,
    gtin: row.gtin,
    requires_marking: row.requires_marking,
  };
  if (body.name != null) {
    run('UPDATE products SET name = ? WHERE id = ?', [body.name.trim(), id]);
  }
  if (body.sku != null) {
    const sku = body.sku.trim();
    if (!sku) return c.json({ error: 'sku не может быть пустым' }, 400);
    const clash = get<{ id: string }>(
      'SELECT id FROM products WHERE sku = ? AND id != ? LIMIT 1',
      [sku, id]
    );
    if (clash) return c.json({ error: 'SKU уже занят' }, 409);
    run('UPDATE products SET sku = ? WHERE id = ?', [sku, id]);
  }
  if (body.brand != null) {
    run('UPDATE products SET brand = ? WHERE id = ?', [body.brand.trim(), id]);
  }
  if (body.barcode != null) {
    run('UPDATE products SET barcode = ? WHERE id = ?', [body.barcode.trim(), id]);
  }
  if (body.code != null) {
    run('UPDATE products SET code = ? WHERE id = ?', [body.code.trim(), id]);
  }
  if (body.array_sku != null) {
    run('UPDATE products SET array_sku = ? WHERE id = ?', [body.array_sku.trim(), id]);
  }
  if (body.category_id !== undefined) {
    const cat = body.category_id ? String(body.category_id).trim() : '';
    if (cat) {
      const exists = get('SELECT id FROM categories WHERE id = ?', [cat]);
      if (!exists) return c.json({ error: 'категория не найдена' }, 400);
      run('UPDATE products SET category_id = ? WHERE id = ?', [cat, id]);
    } else {
      run('UPDATE products SET category_id = NULL WHERE id = ?', [id]);
    }
  }
  if (body.is_active != null) {
    run('UPDATE products SET is_active = ? WHERE id = ?', [body.is_active ? 1 : 0, id]);
  }
  const numOrNull = (v: number | null | undefined) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const pw = numOrNull(body.package_width_cm);
  const ph = numOrNull(body.package_height_cm);
  const pl = numOrNull(body.package_length_cm);
  const pwg = numOrNull(body.package_weight_g);
  if (pw !== undefined) run('UPDATE products SET package_width_cm = ? WHERE id = ?', [pw, id]);
  if (ph !== undefined) run('UPDATE products SET package_height_cm = ? WHERE id = ?', [ph, id]);
  if (pl !== undefined) run('UPDATE products SET package_length_cm = ? WHERE id = ?', [pl, id]);
  if (pwg !== undefined) run('UPDATE products SET package_weight_g = ? WHERE id = ?', [pwg, id]);
  if (body.gtin != null) {
    run('UPDATE products SET gtin = ? WHERE id = ?', [String(body.gtin).trim(), id]);
  }
  if (body.requires_marking != null) {
    run('UPDATE products SET requires_marking = ? WHERE id = ?', [
      body.requires_marking ? 1 : 0,
      id,
    ]);
  }

  const after = get(
    `SELECT name, sku, brand, barcode, category_id, is_active, code, array_sku,
            package_width_cm, package_height_cm, package_length_cm, package_weight_g,
            IFNULL(gtin,'') AS gtin, IFNULL(requires_marking,0) AS requires_marking
     FROM products WHERE id = ?`,
    [id]
  );
  auditFromContext(c, {
    action: 'product.update',
    entity: 'product',
    entityId: id,
    summary: `Товар изменён: ${(after as { name?: string })?.name || id}`,
    before,
    after,
  });
  return c.json({ ok: true });
});

api.put('/products/:id/properties', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав: редактирование номенклатуры' }, 403);
  }
  const id = c.req.param('id');
  const product = get('SELECT id FROM products WHERE id = ?', [id]);
  if (!product) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{
    properties?: Array<{ property: string; value: string }>;
  }>();
  const list = Array.isArray(body.properties) ? body.properties : null;
  if (!list) return c.json({ error: 'properties required' }, 400);

  const before = all<{ property: string; value: string }>(
    `SELECT property, value FROM product_properties WHERE product_id = ? ORDER BY property`,
    [id]
  );
  const byProp = new Map(before.map((r) => [r.property, r]));
  for (const item of list) {
    const property = String(item.property || '').trim();
    if (!property) continue;
    const value = String(item.value ?? '').trim();
    const existing = byProp.get(property);
    if (existing) {
      run(`UPDATE product_properties SET value = ? WHERE product_id = ? AND property = ?`, [
        value,
        id,
        property,
      ]);
    } else {
      const rowId = newGuid();
      run(
        `INSERT INTO product_properties (id, product_id, property, value) VALUES (?, ?, ?, ?)`,
        [rowId, id, property, value]
      );
    }
  }
  const after = all<{ property: string; value: string }>(
    `SELECT property, value FROM product_properties WHERE product_id = ? ORDER BY property`,
    [id]
  );
  auditFromContext(c, {
    action: 'product.properties.update',
    entity: 'product',
    entityId: id,
    summary: `Характеристики обновлены: ${id}`,
    before,
    after,
  });
  return c.json({ ok: true, properties: after });
});

api.put('/products/:id/applicability', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав: редактирование номенклатуры' }, 403);
  }
  const id = c.req.param('id');
  const product = get('SELECT id FROM products WHERE id = ?', [id]);
  if (!product) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{
    applicability?: Array<{
      id?: string;
      mark?: string;
      model?: string;
      only_model?: string;
      generation?: string;
      years?: string;
      _delete?: boolean;
    }>;
  }>();
  const list = Array.isArray(body.applicability) ? body.applicability : null;
  if (!list) return c.json({ error: 'applicability required' }, 400);

  const before = all(
    `SELECT id, mark, model, only_model, generation, years
     FROM product_applicability WHERE product_id = ? ORDER BY mark, model, years`,
    [id]
  );

  // Полная замена списка: у товара бывает несколько применимостей
  run('DELETE FROM product_applicability WHERE product_id = ?', [id]);
  for (const item of list) {
    if (item._delete) continue;
    const mark = String(item.mark || '').trim();
    const model = String(item.model || '').trim();
    const generation = String(item.generation || '').trim();
    const years = String(item.years || '').trim();
    const onlyModel = String(
      item.only_model != null && String(item.only_model).trim()
        ? item.only_model
        : model
          ? model.replace(/\s+[IVX]+(\s*\(.*\))?$/i, '').trim() || model
          : ''
    ).trim();
    if (!mark && !model && !onlyModel && !generation && !years) continue;
    const rowId = `${id}|${mark}|${model}|${onlyModel}|${generation}|${years}`;
    run(
      `INSERT OR IGNORE INTO product_applicability
        (id, product_id, mark, model, only_model, generation, years)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [rowId, id, mark, model, onlyModel, generation, years]
    );
  }

  const after = all(
    `SELECT id, mark, model, only_model, generation, years
     FROM product_applicability WHERE product_id = ? ORDER BY mark, model, years`,
    [id]
  );
  auditFromContext(c, {
    action: 'product.applicability.update',
    entity: 'product',
    entityId: id,
    summary: `Применимости: ${before.length} → ${after.length} у ${id}`,
    before,
    after,
  });
  return c.json({ ok: true, applicability: after });
});

api.put('/products/:id/prices', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_prices')) {
    return c.json({ error: 'Недостаточно прав: редактирование цен' }, 403);
  }
  const id = c.req.param('id');
  const product = get<{ id: string; name: string; sku: string }>(
    'SELECT id, name, sku FROM products WHERE id = ?',
    [id]
  );
  if (!product) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ prices?: Array<{ price_type: string; price: number }> }>();
  const prices = Array.isArray(body.prices) ? body.prices : [];
  if (!prices.length) return c.json({ error: 'prices[] required' }, 400);

  const before = all(
    'SELECT price_type, price FROM product_prices WHERE product_id = ? ORDER BY price_type',
    [id]
  );
  const beforeMap = new Map(before.map((p) => [String(p.price_type), Number(p.price)]));

  run('BEGIN');
  try {
    for (const p of prices) {
      const type = String(p.price_type || '').trim();
      const price = Number(p.price);
      if (!type || !Number.isFinite(price)) continue;
      const existing = get<{ id: string }>(
        'SELECT id FROM product_prices WHERE product_id = ? AND price_type = ? LIMIT 1',
        [id, type]
      );
      if (existing) {
        run('UPDATE product_prices SET price = ? WHERE id = ?', [price, existing.id]);
      } else {
        run(
          `INSERT INTO product_prices (id, product_id, price_type, price) VALUES (?, ?, ?, ?)`,
          [newGuid(), id, type, price]
        );
      }
    }
    run('COMMIT');
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }

  const after = all(
    'SELECT price_type, price FROM product_prices WHERE product_id = ? ORDER BY price_type',
    [id]
  );
  const changes: string[] = [];
  for (const p of after) {
    const t = String(p.price_type);
    const old = beforeMap.get(t);
    const neu = Number(p.price);
    if (old === undefined) changes.push(`${t}: (нет) → ${neu}`);
    else if (old !== neu) changes.push(`${t}: ${old} → ${neu}`);
  }
  auditFromContext(c, {
    action: 'price.change',
    entity: 'product',
    entityId: id,
    summary:
      `Цена изменена: ${product.name} (${product.sku})` +
      (changes.length ? ` — ${changes.join('; ')}` : ''),
    before,
    after,
  });
  return c.json({ ok: true, prices: after, changes });
});

/* ——— stock ——— */
api.get('/balances', (c) => {
  const warehouseId = c.req.query('warehouse_id');
  const q = (c.req.query('q') || '').trim();
  const { page, limit, offset } = parsePage(c, 50);
  const where: string[] = ['b.qty != 0'];
  const params: Array<string | number> = [];
  if (warehouseId) {
    where.push('b.warehouse_id = ?');
    params.push(warehouseId);
  }
  if (q) {
    const like = `%${q}%`;
    where.push('(p.name LIKE ? OR p.sku LIKE ?)');
    params.push(like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = `
    FROM stock_balances b
    JOIN products p ON p.id = b.product_id
    JOIN warehouses w ON w.id = b.warehouse_id
    JOIN units u ON u.id = p.unit_id
    ${whereSql}`;
  const total = get<{ c: number }>(`SELECT COUNT(*) AS c ${from}`, params)?.c ?? 0;
  const items = all(
    `SELECT b.qty, p.id AS product_id, p.sku, p.name, w.id AS warehouse_id, w.name AS warehouse,
            u.short_name AS unit
     ${from}
     ORDER BY w.name, p.name
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return c.json({
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

api.get('/docs', (c) => {
  const type = (c.req.query('type') || '').trim();
  const q = (c.req.query('q') || '').trim();
  const sort = (c.req.query('sort') || 'date').trim();
  const dir = (c.req.query('dir') || 'desc').trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (type === 'in' || type === 'out' || type === 'transfer') {
    where.push('d.doc_type = ?');
    params.push(type);
  }
  if (q) {
    where.push('(d.number LIKE ? OR IFNULL(c.name,"") LIKE ? OR IFNULL(w.name,"") LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderMap: Record<string, string> = {
    number: `d.number ${dir}`,
    type: `d.doc_type ${dir}, d.doc_date DESC`,
    date: `d.doc_date ${dir}, d.number ${dir}`,
    counterparty: `IFNULL(c.name,'') ${dir}, d.doc_date DESC`,
    warehouse: `IFNULL(w.name,'') ${dir}, d.doc_date DESC`,
    amount: `d.amount ${dir}, d.doc_date DESC`,
    status: `d.posted ${dir}, d.doc_date DESC`,
  };
  const orderBy = orderMap[sort] || orderMap.date;
  return c.json(
    all(
      `SELECT d.*, w.name AS warehouse, wt.name AS warehouse_to, c.name AS counterparty
       FROM stock_docs d
       LEFT JOIN warehouses w ON w.id = d.warehouse_id
       LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
       LEFT JOIN counterparties c ON c.id = d.counterparty_id
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT 300`,
      params
    )
  );
});

api.get('/docs/:id', (c) => {
  const id = c.req.param('id');
  const doc = get(
    `SELECT d.*, w.name AS warehouse, wt.name AS warehouse_to, c.name AS counterparty
     FROM stock_docs d
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     LEFT JOIN counterparties c ON c.id = d.counterparty_id
     WHERE d.id = ?`,
    [id]
  );
  if (!doc) return c.json({ error: 'not found' }, 404);
  const lines = all(
    `SELECT l.*, p.sku, p.name AS product_name
     FROM stock_doc_lines l
     LEFT JOIN products p ON p.id = l.product_id
     WHERE l.doc_id = ?
     ORDER BY l.line_no, p.name`,
    [id]
  );
  return c.json({ ...doc, lines });
});

api.post('/docs', async (c) => {
  const body = await c.req.json<{
    doc_type: DocType;
    warehouse_id: string;
    warehouse_to_id?: string;
    counterparty_id?: string;
    comment?: string;
    lines: Array<{ product_id: string; qty: number }>;
    post?: boolean;
  }>();
  try {
    const id = createDocument(body);
    const doc = get('SELECT * FROM stock_docs WHERE id = ?', [id]);
    auditFromContext(c, {
      action: 'doc.create',
      entity: 'stock_doc',
      entityId: id,
      summary: `Документ ${body.doc_type}: ${doc?.number || id}, строк ${body.lines?.length || 0}`,
      after: doc,
    });
    return c.json(doc, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

const FEEDBACK_KINDS = new Set(['idea', 'bug']);
const FEEDBACK_STATUSES = new Set(['new', 'planned', 'done', 'rejected']);

api.get('/feedback', (c) => {
  const status = (c.req.query('status') || '').trim();
  if (status && FEEDBACK_STATUSES.has(status)) {
    return c.json(
      all(
        `SELECT * FROM feedback_items WHERE status = ? ORDER BY datetime(created_at) DESC LIMIT 200`,
        [status]
      )
    );
  }
  return c.json(all(`SELECT * FROM feedback_items ORDER BY datetime(created_at) DESC LIMIT 200`));
});

api.post('/feedback', async (c) => {
  const body = await c.req.json<{
    kind?: string;
    title?: string;
    body?: string;
    author?: string;
  }>();
  const kind = (body.kind || 'idea').trim();
  const title = (body.title || '').trim();
  const text = (body.body || '').trim();
  const author = (body.author || '').trim().slice(0, 120);
  if (!FEEDBACK_KINDS.has(kind)) {
    return c.json({ error: 'kind: idea или bug' }, 400);
  }
  if (!title) {
    return c.json({ error: 'Укажите заголовок' }, 400);
  }
  if (title.length > 200) {
    return c.json({ error: 'Заголовок слишком длинный (макс. 200)' }, 400);
  }
  if (text.length > 5000) {
    return c.json({ error: 'Текст слишком длинный (макс. 5000)' }, 400);
  }
  const id = newGuid();
  run(
    `INSERT INTO feedback_items (id, kind, title, body, author, status) VALUES (?, ?, ?, ?, ?, 'new')`,
    [id, kind, title, text, author]
  );
  const row = get('SELECT * FROM feedback_items WHERE id = ?', [id]);
  auditFromContext(c, {
    action: 'feedback.create',
    entity: 'feedback',
    entityId: id,
    summary: `${kind}: ${title}`,
    after: row,
  });
  return c.json(row, 201);
});

api.patch('/feedback/:id', async (c) => {
  const id = c.req.param('id');
  const existing = get('SELECT * FROM feedback_items WHERE id = ?', [id]);
  if (!existing) return c.json({ error: 'Не найдено' }, 404);
  const body = await c.req.json<{ status?: string }>();
  const status = (body.status || '').trim();
  if (!FEEDBACK_STATUSES.has(status)) {
    return c.json({ error: 'status: new | planned | done | rejected' }, 400);
  }
  run(`UPDATE feedback_items SET status = ? WHERE id = ?`, [status, id]);
  auditFromContext(c, {
    action: 'feedback.status',
    entity: 'feedback',
    entityId: id,
    summary: `Идея/ошибка «${existing.title}»: ${existing.status} → ${status}`,
    before: { status: existing.status },
    after: { status },
  });
  return c.json(get('SELECT * FROM feedback_items WHERE id = ?', [id]));
});

/* ——— Маркировка / партии / DataMatrix (Этапы 4–5) ——— */

api.get('/marking/meta', (c) => c.json(markingMeta()));

api.get('/marking/parse-label', (c) => {
  const raw = (c.req.query('raw') || '').trim();
  return c.json(parseMarkingLabel(raw));
});

api.get('/lots', (c) => {
  return c.json(
    listLots({
      product_id: (c.req.query('product_id') || '').trim() || undefined,
      warehouse_id: (c.req.query('warehouse_id') || '').trim() || undefined,
      status: (c.req.query('status') || '').trim() || undefined,
      q: (c.req.query('q') || '').trim() || undefined,
      limit: Number(c.req.query('limit') || 100) || 100,
    })
  );
});

api.post('/lots', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<{
    product_id?: string;
    lot_number?: string;
    factory?: string;
    production_date?: string;
    arrived_at?: string;
    warehouse_id?: string;
    gtin?: string;
    qty_planned?: number;
    status?: string;
    comment?: string;
  }>();
  try {
    const lot = createLot({
      product_id: String(body.product_id || ''),
      lot_number: String(body.lot_number || ''),
      factory: body.factory,
      production_date: body.production_date,
      arrived_at: body.arrived_at,
      warehouse_id: body.warehouse_id,
      gtin: body.gtin,
      qty_planned: body.qty_planned,
      status: body.status as 'draft' | 'in_transit' | 'received' | 'closed' | undefined,
      comment: body.comment,
      actor_id: actor?.id,
    });
    auditFromContext(c, {
      action: 'lot.create',
      entity: 'product_lot',
      entityId: lot.id,
      summary: `Партия ${lot.lot_number}`,
      after: lot,
    });
    return c.json(lot, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'lot create failed' }, 400);
  }
});

api.get('/lots/:id', (c) => {
  const id = c.req.param('id');
  const lot = get(
    `SELECT l.*, p.sku AS product_sku, p.name AS product_name, w.name AS warehouse_name
     FROM product_lots l
     LEFT JOIN products p ON p.id = l.product_id
     LEFT JOIN warehouses w ON w.id = l.warehouse_id
     WHERE l.id = ?`,
    [id]
  );
  if (!lot) return c.json({ error: 'not found' }, 404);
  const codes = listCodes({ lot_id: id, limit: 500 });
  return c.json({ ...lot, codes });
});

api.get('/marking/codes', (c) => {
  return c.json(
    listCodes({
      product_id: (c.req.query('product_id') || '').trim() || undefined,
      lot_id: (c.req.query('lot_id') || '').trim() || undefined,
      status: (c.req.query('status') || '').trim() || undefined,
      deal_id: (c.req.query('deal_id') || '').trim() || undefined,
      q: (c.req.query('q') || '').trim() || undefined,
      limit: Number(c.req.query('limit') || 100) || 100,
    })
  );
});

api.post('/marking/codes', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<{
    code?: string;
    product_id?: string;
    lot_id?: string;
    warehouse_id?: string;
    status?: string;
  }>();
  try {
    const row = registerCode({
      code: String(body.code || ''),
      product_id: String(body.product_id || ''),
      lot_id: body.lot_id,
      warehouse_id: body.warehouse_id,
      status: body.status as import('./marking.js').DmStatus | undefined,
      actor_id: actor?.id,
    });
    return c.json(row, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'register failed' }, 400);
  }
});

api.post('/marking/scan', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<{
    code?: string;
    action?: 'receive' | 'sale' | 'withdraw' | 'return' | 'defect';
    product_id?: string;
    lot_id?: string;
    warehouse_id?: string;
    deal_id?: string;
    stock_doc_id?: string;
  }>();
  try {
    const result = scanCode({
      code: String(body.code || ''),
      action: body.action || 'receive',
      product_id: body.product_id,
      lot_id: body.lot_id,
      warehouse_id: body.warehouse_id,
      deal_id: body.deal_id,
      stock_doc_id: body.stock_doc_id,
      actor_id: actor?.id,
    });
    auditFromContext(c, {
      action: `marking.scan.${body.action || 'receive'}`,
      entity: 'datamatrix',
      entityId: result.code.id,
      summary: `Скан ${body.action || 'receive'}: ${String(body.code || '').slice(0, 24)}…`,
      after: result.code,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'scan failed' }, 400);
  }
});

api.post('/marking/aggregate', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<{ codes?: string[]; parent_code?: string }>();
  try {
    const result = createAggregate({
      codes: Array.isArray(body.codes) ? body.codes : [],
      parent_code: body.parent_code,
      actor_id: actor?.id,
    });
    return c.json(result, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'aggregate failed' }, 400);
  }
});

api.get('/products/:id/marking', (c) => {
  const id = c.req.param('id');
  const product = get('SELECT id FROM products WHERE id = ?', [id]);
  if (!product) return c.json({ error: 'not found' }, 404);
  return c.json(productMarkingSummary(id));
});

api.patch('/products/:id/marking-flags', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const id = c.req.param('id');
  const product = get('SELECT id, gtin, requires_marking FROM products WHERE id = ?', [id]);
  if (!product) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ gtin?: string; requires_marking?: boolean | number }>();
  if (body.gtin !== undefined) {
    run('UPDATE products SET gtin = ? WHERE id = ?', [String(body.gtin).trim(), id]);
  }
  if (body.requires_marking !== undefined) {
    run('UPDATE products SET requires_marking = ? WHERE id = ?', [
      body.requires_marking ? 1 : 0,
      id,
    ]);
  }
  return c.json(
    get(
      `SELECT id, sku, name, IFNULL(gtin,'') AS gtin, IFNULL(requires_marking,0) AS requires_marking
       FROM products WHERE id = ?`,
      [id]
    )
  );
});

/* ——— Э1: задания склада ——— */

api.get('/warehouse/tasks/meta', (c) =>
  c.json({
    statuses: TASK_STATUSES,
    status_labels: Object.fromEntries(TASK_STATUSES.map((s) => [s, statusLabel(s)])),
    channels: SHIP_CHANNELS,
    channel_labels: Object.fromEntries(SHIP_CHANNELS.map((ch) => [ch, channelLabel(ch)])),
  })
);

api.get('/warehouse/tasks', (c) => {
  return c.json(
    listTasks({
      status: (c.req.query('status') || '').trim() || undefined,
      q: (c.req.query('q') || '').trim() || undefined,
      limit: Number(c.req.query('limit') || 80) || 80,
    })
  );
});

api.get('/warehouse/tasks/:id', (c) => {
  const row = getTask(c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});

api.get('/warehouse/tasks/:id/slip', (c) => {
  try {
    return c.json(packingSlip(c.req.param('id')));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'slip failed' }, 404);
  }
});

api.post('/warehouse/tasks/from-deal', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin' && actor?.role !== 'manager') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<{
    deal_id?: string;
    channel?: string;
    payment_required?: boolean;
    comment?: string;
  }>();
  try {
    const task = createTaskFromDeal({
      deal_id: String(body.deal_id || ''),
      channel: body.channel,
      payment_required: body.payment_required,
      comment: body.comment,
      actor_id: actor?.id,
    });
    auditFromContext(c, {
      action: 'warehouse_task.create',
      entity: 'warehouse_task',
      entityId: String(task?.id || ''),
      summary: `Задание складу ${task?.number} по сделке ${body.deal_id}`,
      after: task,
    });
    return c.json(task, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'create failed' }, 400);
  }
});

api.patch('/warehouse/tasks/:id/status', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ status?: string; track_number?: string }>();
  try {
    const row = setTaskStatus({
      id: c.req.param('id'),
      status: body.status as import('./warehouse-tasks.js').TaskStatus,
      track_number: body.track_number,
      actor_id: actor.id,
    });
    auditFromContext(c, {
      action: 'warehouse_task.status',
      entity: 'warehouse_task',
      entityId: c.req.param('id'),
      summary: `Задание → ${body.status}`,
      after: { status: body.status },
    });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'status failed' }, 400);
  }
});

api.post('/warehouse/tasks/scan-hand', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ barcode?: string }>();
  try {
    const row = scanHandOver({ barcode: String(body.barcode || ''), actor_id: actor.id });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'scan failed' }, 400);
  }
});

api.post('/crm/deals/:id/warehouse-task', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin' && actor?.role !== 'manager') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<{ channel?: string; comment?: string }>().catch(() => ({}));
  try {
    const dealId = c.req.param('id');
    const task = createTaskFromDeal({
      deal_id: dealId,
      channel: (body as { channel?: string }).channel,
      comment: (body as { comment?: string }).comment,
      actor_id: actor?.id,
    });
    auditFromContext(c, {
      action: 'deal.warehouse_task',
      entity: 'crm_deal',
      entityId: dealId,
      summary: `Задание склада ${(task as { number?: string }).number || ''} по сделке ${dealId}`,
      after: { task_id: (task as { id?: string }).id, number: (task as { number?: string }).number },
    });
    return c.json(task, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'create failed' }, 400);
  }
});

/* ——— Э1: дашборд дня / СДЭК / зеркало Доход ——— */

api.get('/ops/dashboard', (c) => c.json(opsDashboard()));

api.get('/ops/income', (c) => {
  return c.json(
    listIncomeMirror({
      q: (c.req.query('q') || '').trim() || undefined,
      limit: Number(c.req.query('limit') || 80) || 80,
    })
  );
});

api.get('/ops/cdek-url', (c) => {
  const dealId = (c.req.query('deal_id') || c.req.query('lead_id') || '').trim();
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  return c.json({ url: cdekWidgetUrl(dealId), deal_id: dealId });
});
