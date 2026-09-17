/**
 * MVC · HTTP routes for warehouse pick (/warehouse/pick/*).
 * Mounted from api.ts via mountPickRoutes(api).
 */
import type { Hono } from 'hono';
import { actorFromContext, canDo } from '../../auth.js';
import { auditFromContext } from '../../audit.js';
import { canAccessSection } from '../../staff.js';
import {
  cdekConfigured,
  fetchCdekPickPack,
  regenerateCdekPickShipment,
  saveCdekPickPack,
} from '../../cdek.js';
import { completeStockReturnPick } from '../../deal-stock-flow.js';
import { jsonWithEtag, listRowsEtag, weakEtagFromParts } from '../../http-etag.js';
import {
  endPickShift,
  getPickShiftSettings,
  listPickShifts,
  pickShiftStatusPayload,
  reauthPickShift,
  savePickShiftSettings,
  startPickShift,
} from '../../pick-shifts.js';
import {
  actorPickSiteLock,
  cancelHandoffPick,
  cancelHandoffPickByDeal,
  completeHandoffPick,
  completeHandoffPickByDeal,
  getHandoffReturnState,
  handoffPickSlipHtml,
  invalidatePickListCaches,
  parseHandoffPickListFilters,
  pickerBoard,
  pickerBoardLightProduction,
  pickSitesCatalog,
  setHandoffPickLineSource,
  stockReturnPickSlipHtml,
  stockReturnsForPick,
  warehouseCompletedHandoffsForPick,
  warehouseHandoffPickFilterFacets,
  warehouseHandoffsForPick,
  warehouseHandoffsPickTotal,
  type HandoffPickUnitInput,
} from '../../warehouse-tasks.js';

function canOperateWarehouseTasks(
  actor: Awaited<ReturnType<typeof actorFromContext>>
): boolean {
  if (!actor) return true;
  if (actor.isSystemAdmin || actor.role === 'admin') return true;
  if (['manager', 'warehouse', 'sto', 'courier'].includes(actor.role)) return true;
  return canDo(actor, 'can_edit_docs');
}

function isAdminActor(actor: Awaited<ReturnType<typeof actorFromContext>>): boolean {
  return !!(actor && (actor.isSystemAdmin || actor.role === 'admin'));
}



/** Провести возврат на основной с экрана /pick (раздел pick, без CRM). */

/* ——— Э1: дашборд дня / СДЭК / зеркало Доход ——— */

/* ——— Паритет меню / экран сборщика (без правок ops UI) ——— */

/** Кэш счётчика «завершённых» — UI /pick дергает today каждые ~25с. */
const pickCompletedTotalCache = new Map<string, { at: number; n: number }>();
const PICK_COMPLETED_TOTAL_TTL_MS = 120_000;
/** Полный ответ /pick/today — собираем в фоне, не на HTTP-потоке. */
const pickTodayPayloadCache = new Map<
  string,
  { at: number; body: Record<string, unknown>; etag: string }
>();
const PICK_TODAY_TTL_MS = 30_000;
let pickTodayBuilding = 0;
let pickHandoffsWarming = 0;

function emptyPickTodayBody(day: string, site?: string): Record<string, unknown> {
  return {
    day: String(day).slice(0, 10),
    title: 'Задачи на сегодня',
    note: 'Загрузка…',
    pick_site: site || 'all',
    pick_sites: [],
    counts: { open: 0, done: 0, blocked: 0 },
    urgency_counts: { overdue: 0, hot: 0, normal: 0, wait: 0 },
    next: null,
    open: [],
    groups: [],
    done: [],
    blocked: [],
    handoffs: [],
    handoffs_completed_total: 0,
    returns: [],
    loading: true,
  };
}

async function buildPickTodayPayload(
  day: string,
  site: string | undefined,
  actor: Awaited<ReturnType<typeof actorFromContext>>
): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const board = await pickerBoard(day, site, actor);
  const tBoard = Date.now();
  const handoffs = await warehouseHandoffsForPick(40, site, actor, { light: true });
  const tHandoffs = Date.now();
  const totalKey = `${site || 'all'}|${actor?.role || ''}|${actorPickSiteLock(actor) || ''}`;
  const cached = pickCompletedTotalCache.get(totalKey);
  let handoffs_completed_total: number;
  if (cached && Date.now() - cached.at < PICK_COMPLETED_TOTAL_TTL_MS) {
    handoffs_completed_total = cached.n;
  } else {
    // Счётчик «Закрытые» — только по выбранной площадке (Стрела / Фогель / МСК).
    handoffs_completed_total = await warehouseHandoffsPickTotal(site, actor, true);
    pickCompletedTotalCache.set(totalKey, { at: Date.now(), n: handoffs_completed_total });
  }
  const tTotal = Date.now();
  const returns = await stockReturnsForPick(40);
  const tEnd = Date.now();
  if (tEnd - t0 > 400) {
    console.warn(
      `[pick/today] ${tEnd - t0}ms board=${tBoard - t0} handoffs=${tHandoffs - tBoard} total=${tTotal - tHandoffs} returns=${tEnd - tTotal} site=${site || ''}`
    );
  }
  return { ...board, handoffs, handoffs_completed_total, returns };
}

function pickTodayBodyEtag(body: Record<string, unknown>): string {
  const open = Array.isArray(body.open) ? (body.open as Array<Record<string, unknown>>) : [];
  const groups = Array.isArray(body.groups) ? (body.groups as Array<Record<string, unknown>>) : [];
  const parts: Array<string | number> = [
    String(body.day || ''),
    JSON.stringify(body.counts || {}),
    String(body.handoffs_completed_total ?? ''),
  ];
  for (const t of open) {
    parts.push(`o:${t.id}:${t.status}:${t.updated_at || t.urgency || ''}`);
  }
  for (const g of groups) {
    const tasks = Array.isArray(g.tasks) ? (g.tasks as Array<Record<string, unknown>>) : [];
    parts.push(`g:${g.key || g.id || ''}:${g.count ?? tasks.length}`);
    for (const t of tasks) {
      parts.push(`t:${t.id}:${t.status}:${t.updated_at || ''}`);
    }
  }
  return weakEtagFromParts(parts);
}

/** Фоновый прогрев полного /pick/today — по одному сайту за тик, с yield. */
export function warmPickTodayCaches(): void {
  if (pickTodayBuilding > 0) return;
  pickTodayBuilding = 1;
  const day = new Date().toISOString().slice(0, 10);
  const sites: Array<string | undefined> = [undefined, 'msk', 'strela', 'fogel'];
  let i = 0;
  const step = async () => {
    if (i >= sites.length) {
      pickTodayBuilding = 0;
      return;
    }
    const site = sites[i++];
    try {
      const body = await buildPickTodayPayload(day, site, null);
      const at = Date.now();
      const etag = pickTodayBodyEtag(body);
      pickTodayPayloadCache.set(`${day}|${site || 'all'}|||`, { at, body, etag });
      pickTodayPayloadCache.set(`${day}|${site || 'all'}|admin||`, { at, body, etag });
    } catch (e) {
      console.warn('[pick/today] warm', site, e instanceof Error ? e.message : e);
    }
    setImmediate(step);
  };
  setImmediate(step);
}


async function enrichPickHandoffsWithCdek(
  items: Array<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  const { cdekBarcodePublicUrl, fetchCdekShipment, loadCdekDealFromWidgetCache } = await import('../../cdek.js');
  for (const item of items) {
    const dealId = String(item.deal_id || '').trim();
    const deal = (item.deal as Record<string, unknown> | null) || null;
    const ship = String(deal?.amo_shipment || deal?.ship_channel || '').trim();
    const isCdek = !!(deal?.is_cdek || /сдэк|cdek/i.test(ship));
    if (!dealId || !isCdek) continue;
    try {
      const cdek = await fetchCdekShipment(dealId);
      const num = String(cdek.cdek_number || deal?.cdek_number || '').trim();
      const barcode =
        String(cdek.cdek_barcode_url || '').trim() ||
        (num ? await cdekBarcodePublicUrl(dealId, num) : '');
      if (barcode) item.cdek_barcode_url = barcode;
      if (num) item.cdek_number = num;
      if (deal) {
        if (barcode) deal.cdek_barcode_url = barcode;
        if (num) deal.cdek_number = num;
      }
    } catch {
      const cached = await loadCdekDealFromWidgetCache(dealId);
      const num = String(cached?.cdek_number || deal?.cdek_number || '').trim();
      if (num) {
        const barcode =
          String(cached?.cdek_barcode_url || '').trim() ||
          await cdekBarcodePublicUrl(dealId, num);
        item.cdek_barcode_url = barcode;
        item.cdek_number = num;
        if (deal) {
          deal.cdek_barcode_url = barcode;
          deal.cdek_number = num;
        }
      }
    }
  }
  return items;
}


/** Завершённые передачи на склад (проведённые) — архив для /pick.
 *  Без CDEK-enrich: иначе 15× внешние запросы → таймаут UI (25с) и пустой список при total>0. */

/** Справочники фильтров передач (каналы, склады) для /pick. */

/** Печатная форма расходной для сборки (прикрепить к коробке). */

/** Кладовщик собрал — провести расходную «Передача на склад». */

/** Кладовщик сменил склад-источник строки на /pick. */


/** То же по amo deal_id — запасной путь для экрана /pick. */

/** Статус «вернулось со склада» для виджета Amo. */

/** Склад не собрал — отмена черновика «Передача на склад». */


/** СДЭК · места / габариты для панели «Передано» (/pick). */



/** Статус смены сборщика + утренний автостарт. */








export function mountPickRoutes(api: Hono): void {
api.get('/warehouse/pick/returns', async (c) => {
  const actor = await actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const items = await stockReturnsForPick(80);
  const body = { items };
  const etag = listRowsEtag(items as Array<Record<string, unknown>>, ['returns']);
  return jsonWithEtag(c, body, etag);
});
api.get('/warehouse/pick/returns/:dealId/print', async (c) => {
  const actor = await actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const dealId = String(c.req.param('dealId') || '').trim();
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  const autoprint =
    (c.req.query('autoprint') || '').trim() === '1' ||
    (c.req.query('autoprint') || '').trim().toLowerCase() === 'true';
  try {
    const html = await stockReturnPickSlipHtml(dealId, { autoprint });
    return c.html(html);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'print failed' }, 404);
  }
});
api.post('/warehouse/pick/returns/:dealId/complete', async (c) => {
  const actor = await actorFromContext(c);
  if (
    !canOperateWarehouseTasks(actor) &&
    actor?.role !== 'picker' &&
    !canAccessSection(actor, 'pick')
  ) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const dealId = String(c.req.param('dealId') || '').trim();
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  let body: {
    from_warehouse_id?: string;
    from_cell_code?: string;
    to_cell_code?: string;
    lines?: Array<{
      product_id: string;
      from_cell_code?: string;
      to_cell_code?: string;
    }>;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  try {
    const result = await completeStockReturnPick({
      deal_id: dealId,
      from_warehouse_id: body.from_warehouse_id,
      from_cell_code: body.from_cell_code,
      to_cell_code: body.to_cell_code,
      lines: body.lines,
      actor_name: actor?.name || actor?.login,
    });
    await invalidatePickListCaches();
    await auditFromContext(c, {
      action: 'pick_return.complete',
      entity: 'crm_deal',
      entityId: dealId,
      summary: 'Возврат на основной проведён (/pick)',
      after: result,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'return complete failed' }, 400);
  }
});
api.get('/warehouse/pick/today', async (c) => {
  const actor = await actorFromContext(c);
  const day = (c.req.query('day') || '').trim() || new Date().toISOString().slice(0, 10);
  const site = (c.req.query('site') || '').trim() || undefined;
  const d = String(day).slice(0, 10);
  const cacheKey = `${d}|${site || 'all'}|${actor?.role || ''}|${actorPickSiteLock(actor) || ''}|${actor?.id || ''}`;
  const hit =
    pickTodayPayloadCache.get(cacheKey) ||
    pickTodayPayloadCache.get(`${d}|${site || 'all'}|||`);
  if (hit && Date.now() - hit.at < PICK_TODAY_TTL_MS) {
    return jsonWithEtag(c, hit.body, hit.etag || pickTodayBodyEtag(hit.body));
  }
  // Не считаем handoffs на HTTP-потоке: под нагрузкой это кладёт event loop.
  // production_send/receive — лёгкий SQL, кладём сразу (иначе W-xxxx пропадают с /pick).
  let prodBoard: Awaited<ReturnType<typeof pickerBoardLightProduction>> = {
    open: [],
    groups: [],
    counts: { open: 0, done: 0, blocked: 0 },
  };
  try {
    prodBoard = await pickerBoardLightProduction(site, actor);
  } catch (e) {
    console.warn('[pick/today] light production', e instanceof Error ? e.message : e);
  }
  const body = {
    ...emptyPickTodayBody(d, site),
    note: 'Склад · задачи',
    loading: false,
    open: prodBoard.open,
    groups: prodBoard.groups,
    counts: { ...prodBoard.counts },
    // handoffs не считаем здесь — иначе WMS захлёбывается; расходные догружаются отдельно при необходимости
    handoffs: [],
    handoffs_completed_total: pickCompletedTotalCache.get('all||')?.n ?? 0,
  };
  const etag = pickTodayBodyEtag(body);
  pickTodayPayloadCache.set(cacheKey, { at: Date.now(), body, etag });
  return jsonWithEtag(c, body, etag);
});
api.get('/warehouse/pick/handoffs', async (c) => {
  const actor = await actorFromContext(c);
  const limit = Math.max(1, Math.min(40, Number(c.req.query('limit') || 30) || 30));
  const site = (c.req.query('site') || '').trim() || undefined;
  // Только light: полный enrich валит event loop при опросе с нескольких вкладок.
  const items = await warehouseHandoffsForPick(limit, site, actor, { light: true });
  const cacheKey = `${site || 'all'}|${actor?.role || ''}|${actorPickSiteLock(actor) || ''}`;
  const cached = pickCompletedTotalCache.get(cacheKey);
  let completed_total: number;
  if (cached && Date.now() - cached.at < PICK_COMPLETED_TOTAL_TTL_MS) {
    completed_total = cached.n;
  } else {
    completed_total = await warehouseHandoffsPickTotal(site, actor, true);
    pickCompletedTotalCache.set(cacheKey, { at: Date.now(), n: completed_total });
  }
  const body = {
    items,
    count: items.length,
    completed_total,
    pick_sites: (await pickSitesCatalog()).map((s) => ({ id: s.id, label: s.label })),
  };
  const etag = listRowsEtag(items as Array<Record<string, unknown>>, [
    site || 'all',
    completed_total,
    limit,
  ]);
  return jsonWithEtag(c, body, etag);
});
api.get('/warehouse/pick/handoffs/completed', async (c) => {
  const actor = await actorFromContext(c);
  const page = Math.max(1, Number(c.req.query('page') || 1) || 1);
  const limit = Math.max(1, Math.min(50, Number(c.req.query('limit') || 15) || 15));
  const site = (c.req.query('site') || '').trim() || undefined;
  const dealQ = (c.req.query('deal') || c.req.query('q') || '').trim() || undefined;
  const filters = parseHandoffPickListFilters({
    date_from: c.req.query('date_from'),
    date_to: c.req.query('date_to'),
    type: c.req.query('type'),
    channel: c.req.query('channel'),
    route_from: c.req.query('route_from'),
    route_to: c.req.query('route_to'),
  });
  const result = await warehouseCompletedHandoffsForPick(page, limit, site, actor, dealQ, filters);
  return c.json(result);
});
api.get('/warehouse/pick/handoffs/filters', async (c) => {
  const actor = await actorFromContext(c);
  const site = (c.req.query('site') || '').trim() || undefined;
  const posted = String(c.req.query('posted') || '1') !== '0';
  return c.json(await warehouseHandoffPickFilterFacets(site, actor, posted));
});
api.get('/warehouse/pick/handoffs/:id/print', async (c) => {
  const id = String(c.req.param('id') || '').trim();
  const autoprint = String(c.req.query('autoprint') || '') === '1';
  try {
    const html = await handoffPickSlipHtml(id, { autoprint });
    return c.html(html);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'print failed';
    return c.html(`<p style="font-family:sans-serif;padding:16px">${msg}</p>`, 400);
  }
});
api.post('/warehouse/pick/handoffs/:id/complete', async (c) => {
  const actor = await actorFromContext(c);
  if (!canOperateWarehouseTasks(actor) && actor?.role !== 'picker') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const id = String(c.req.param('id') || '').trim();
  try {
    const body = (await c.req.json().catch(() => ({}))) as { picks?: HandoffPickUnitInput[] };
    const picks = Array.isArray(body?.picks) ? body.picks : undefined;
    const result = await completeHandoffPick(id, actor?.id, picks);
    await invalidatePickListCaches();
    pickCompletedTotalCache.clear();
    await auditFromContext(c, {
      action: 'pick_handoff.complete',
      entity: 'stock_doc',
      entityId: id,
      summary: `Собрано · расходная ${String(result.number || id)} · сделка ${String(result.deal_id || '')}`,
      after: result,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'complete failed' }, 400);
  }
});
api.post('/warehouse/pick/handoffs/:id/line-source', async (c) => {
  const actor = await actorFromContext(c);
  if (!canOperateWarehouseTasks(actor) && actor?.role !== 'picker') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const id = String(c.req.param('id') || '').trim();
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      product_id?: string;
      warehouse_id?: string;
    };
    const result = await setHandoffPickLineSource({
      doc_id: id,
      product_id: String(body?.product_id || '').trim(),
      warehouse_id: String(body?.warehouse_id || '').trim(),
    });
    await auditFromContext(c, {
      action: 'pick_handoff.line_source',
      entity: 'stock_doc',
      entityId: id,
      summary: `Склад-источник строки · ${String(body?.product_id || '')} → ${String(body?.warehouse_id || '')}`,
      after: result,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'line-source failed' }, 400);
  }
});
api.post('/warehouse/pick/handoffs/by-deal/:dealId/complete', async (c) => {
  const actor = await actorFromContext(c);
  if (!canOperateWarehouseTasks(actor) && actor?.role !== 'picker') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const dealId = String(c.req.param('dealId') || '').trim();
  try {
    const body = (await c.req.json().catch(() => ({}))) as { picks?: HandoffPickUnitInput[] };
    const picks = Array.isArray(body?.picks) ? body.picks : undefined;
    const result = await completeHandoffPickByDeal(dealId, actor?.id, picks);
    await invalidatePickListCaches();
    pickCompletedTotalCache.clear();
    await auditFromContext(c, {
      action: 'pick_handoff.complete',
      entity: 'stock_doc',
      entityId: String(result.doc_id || dealId),
      summary: `Собрано · расходная ${String(result.number || '')} · сделка ${dealId}`,
      after: result,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'complete failed' }, 400);
  }
});
api.get('/warehouse/pick/handoffs/return/:dealId', async (c) => {
  const actor = await actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const dealId = String(c.req.param('dealId') || '').trim();
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  const state = await getHandoffReturnState(dealId);
  return c.json({ ok: true, deal_id: dealId, return: state });
});
api.post('/warehouse/pick/handoffs/:id/cancel', async (c) => {
  const actor = await actorFromContext(c);
  if (!canOperateWarehouseTasks(actor) && actor?.role !== 'picker') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const id = String(c.req.param('id') || '').trim();
  const body = (await c.req.json().catch(() => ({}))) as { comment?: string };
  const comment = String(body.comment || '').trim();
  if (!comment) return c.json({ error: 'Укажите комментарий' }, 400);
  try {
    const result = await cancelHandoffPick(id, comment, actor?.id);
    await auditFromContext(c, {
      action: 'pick_handoff.cancel',
      entity: 'stock_doc',
      entityId: id,
      summary: `Не собрали · сделка ${String(result.deal_id || '')} · ${comment.slice(0, 120)}`,
      after: result,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'cancel failed' }, 400);
  }
});
api.post('/warehouse/pick/handoffs/by-deal/:dealId/cancel', async (c) => {
  const actor = await actorFromContext(c);
  if (!canOperateWarehouseTasks(actor) && actor?.role !== 'picker') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const dealId = String(c.req.param('dealId') || '').trim();
  const body = (await c.req.json().catch(() => ({}))) as { comment?: string };
  const comment = String(body.comment || '').trim();
  if (!comment) return c.json({ error: 'Укажите комментарий' }, 400);
  try {
    const result = await cancelHandoffPickByDeal(dealId, comment, actor?.id);
    await auditFromContext(c, {
      action: 'pick_handoff.cancel',
      entity: 'stock_doc',
      entityId: String(result.doc_id || dealId),
      summary: `Не собрали · сделка ${dealId} · ${comment.slice(0, 120)}`,
      after: result,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'cancel failed' }, 400);
  }
});
api.get('/warehouse/pick/handoffs/:dealId/cdek-pack', async (c) => {
  const actor = await actorFromContext(c);
  if (!canOperateWarehouseTasks(actor) && actor?.role !== 'picker') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const dealId = String(c.req.param('dealId') || '').trim();
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  if (!await cdekConfigured()) {
    return c.json({ ok: false, error: 'СДЭК не настроен (ключ в интеграциях)' }, 503);
  }
  try {
    const pack = await fetchCdekPickPack(dealId);
    if (pack.ok === false) {
      return c.json(pack, 400);
    }
    return c.json(pack);
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'load failed' }, 502);
  }
});
api.post('/warehouse/pick/handoffs/:dealId/cdek-pack', async (c) => {
  const actor = await actorFromContext(c);
  if (!canOperateWarehouseTasks(actor) && actor?.role !== 'picker') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const dealId = String(c.req.param('dealId') || '').trim();
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  if (!await cdekConfigured()) {
    return c.json({ ok: false, error: 'СДЭК не настроен' }, 503);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await saveCdekPickPack(dealId, body);
    if (result.ok === false) {
      return c.json(result, 400);
    }
    return c.json(result);
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'save failed' }, 502);
  }
});
api.post('/warehouse/pick/handoffs/:dealId/cdek-regenerate', async (c) => {
  const actor = await actorFromContext(c);
  if (!canOperateWarehouseTasks(actor) && actor?.role !== 'picker') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const dealId = String(c.req.param('dealId') || '').trim();
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  if (!await cdekConfigured()) {
    return c.json({ ok: false, error: 'СДЭК не настроен' }, 503);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await regenerateCdekPickShipment(dealId, body);
    const code = result.ok ? 200 : 400;
    return c.json(result, code);
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'regenerate failed' }, 502);
  }
});
api.get('/warehouse/pick/shift', async (c) => {
  const actor = await actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  return c.json(await pickShiftStatusPayload(actor));
});
api.post('/warehouse/pick/shift/start', async (c) => {
  const actor = await actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    kind?: string;
    pin?: string;
    password?: string;
    auto?: boolean;
  };
  try {
    const shift = await startPickShift(actor, {
      kind: body.kind,
      pin: body.pin,
      password: body.password,
      auto: Boolean(body.auto),
    });
    await auditFromContext(c, {
      action: 'pick_shift.start',
      entity: 'pick_shift',
      entityId: shift.id,
      summary: `Смена ${shift.kind === 'evening' ? 'вечерняя' : 'дневная'}${shift.auto_started ? ' (утро)' : ''}: ${actor.name}`,
      after: shift,
    });
    return c.json({ ok: true, ...await pickShiftStatusPayload(actor) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'start failed' }, 400);
  }
});
api.post('/warehouse/pick/shift/end', async (c) => {
  const actor = await actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  try {
    const ended = await endPickShift(actor);
    if (ended) {
      await auditFromContext(c, {
        action: 'pick_shift.end',
        entity: 'pick_shift',
        entityId: ended.id,
        summary: `Смена завершена: ${actor.name}`,
        after: ended,
      });
    }
    return c.json({ ok: true, ended, ...await pickShiftStatusPayload(actor) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'end failed' }, 400);
  }
});
api.post('/warehouse/pick/shift/reauth', async (c) => {
  const actor = await actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    pin?: string;
    password?: string;
  };
  try {
    await reauthPickShift(actor, { pin: body.pin, password: body.password });
    return c.json({ ok: true, ...await pickShiftStatusPayload(actor) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'reauth failed' }, 400);
  }
});
api.get('/warehouse/pick/shift/settings', async (c) => {
  const actor = await actorFromContext(c);
  if (!isAdminActor(actor)) return c.json({ error: 'Только администратор' }, 403);
  return c.json(await getPickShiftSettings());
});
api.patch('/warehouse/pick/shift/settings', async (c) => {
  const actor = await actorFromContext(c);
  if (!isAdminActor(actor)) return c.json({ error: 'Только администратор' }, 403);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const next = await savePickShiftSettings(body as Parameters<typeof savePickShiftSettings>[0]);
  await auditFromContext(c, {
    action: 'pick_shift.settings',
    entity: 'meta',
    entityId: 'pick_shift_settings',
    summary: `Настройки смен сборщика: ${next.morning_from}–${next.morning_to}, авто=${next.auto_morning ? 'да' : 'нет'}`,
    after: next,
  });
  return c.json(next);
});
api.get('/warehouse/pick/shifts', async (c) => {
  const actor = await actorFromContext(c);
  if (!isAdminActor(actor) && !canAccessSection(actor, 'staff')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  return c.json({
    items: await listPickShifts({
      day: (c.req.query('day') || '').trim() || undefined,
      staff_id: (c.req.query('staff_id') || '').trim() || undefined,
      limit: Number(c.req.query('limit') || 100),
    }),
    settings: await getPickShiftSettings(),
  });
});
}
