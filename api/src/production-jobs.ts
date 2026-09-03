/**
 * Производство: сборка (аморт+баллон→стойка) / разбор (стойка→детали).
 * Склад PROD-WIP — буфер; кладовщик перемещает туда и обратно через задания склада.
 */
import type { Hono } from 'hono';
import { all, get, run } from './db.js';
import { newGuid, nextCode } from './ids.js';
import { actorFromContext, type Actor } from './auth.js';
import { auditFromContext } from './audit.js';
import { createDocument, postDocument } from './stock.js';
import { insertLinePlacements } from './warehouse-cells.js';
import { ensureWarehouseByCode } from './supply-chain.js';
import { getTask, logTask } from './warehouse-tasks.js';
import { notifyAmoWarehousePacked } from './amo-pick-handoff.js';
import { getDeal } from './deals.js';

export type ProductionKind = 'assemble' | 'disassemble';
export type ProductionStatus =
  | 'draft'
  | 'await_send'
  | 'at_production'
  | 'await_receive'
  | 'closed'
  | 'cancelled';

export type ProductionLine = {
  id: string;
  job_id: string;
  line_no: number;
  direction: 'consume' | 'produce';
  product_id: string;
  sku: string;
  name: string;
  qty: number;
  cell_code?: string;
};

export type ProductionJob = Record<string, unknown> & {
  id: string;
  number: string;
  kind: ProductionKind;
  status: ProductionStatus;
  deal_id: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  await_send: 'Ждёт отправки на производство',
  at_production: 'В производстве',
  await_receive: 'Готово — ждёт оприходования',
  closed: 'Закрыто',
  cancelled: 'Отменено',
};

const KIND_LABELS: Record<string, string> = {
  assemble: 'Сборка',
  disassemble: 'Разбор',
};

function denyProduction(c: { json: (b: unknown, s?: number) => Response }, actor: Actor | null) {
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  return null;
}

/** Каждый шаг производства — примечание в сделку Amo (через amo1c CLI). */
export function postProductionDealNote(
  job: Record<string, unknown> | null | undefined,
  step: string,
  extra?: string
): void {
  const dealId = String(job?.deal_id || '').replace(/\D/g, '');
  if (!dealId) return;
  const number = String(job?.number || '—');
  const kind = String(
    job?.kind_label || KIND_LABELS[String(job?.kind || '')] || job?.kind || ''
  );
  const summary = String(job?.summary || '').trim();
  const lines: Record<string, string> = {
    created: `🏭 Производство · заказ ${number}\n${kind}${summary ? ': ' + summary : ''}`,
    queued_send: `🏭 Производство · ${number}\nЗадание кладовщику: отнести на участок.\n${summary}`,
    sent_to_production: `🏭 Производство · ${number}\nНа участке (PROD-WIP).\n${summary}`,
    production_done: `🏭 Производство · ${number}\nГотово — ждём оприходование склада.\n${summary}`,
    received_from_production: `🏭 Производство · ${number}\nЗакрыто — результат на основном складе.\n${summary}`,
    cancelled: `🏭 Производство · ${number}\nОтменено.`,
  };
  let text = lines[step] || `🏭 Производство · ${number}\n${step}`;
  if (extra) text += `\n${extra}`;
  void notifyAmoWarehousePacked({ dealId, text }).catch(() => {});
}

export function productionMainWarehouseId(): string {
  return ensureWarehouseByCode('MAIN', 'Основной');
}

export function productionWipWarehouseId(): string {
  return ensureWarehouseByCode('PROD-WIP', 'Производство (сборка/разбор)');
}

function loadLines(jobId: string): ProductionLine[] {
  ensureProdLineCellCol();
  return all<ProductionLine>(
    `SELECT id, job_id, line_no, direction, product_id,
            IFNULL(sku,'') AS sku, IFNULL(name,'') AS name, qty,
            IFNULL(cell_code,'') AS cell_code
     FROM production_job_lines
     WHERE job_id = ?
     ORDER BY direction DESC, line_no, name`,
    [jobId]
  );
}

function ensureProdLineCellCol(): void {
  try {
    run(`ALTER TABLE production_job_lines ADD COLUMN cell_code TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* already exists */
  }
}

function resolveProductBySkuOrId(raw: string) {
  const key = String(raw || '').trim();
  if (!key) throw new Error('Укажите артикул');
  const byId = get<{ id: string; sku: string; name: string }>(
    `SELECT id, IFNULL(sku,'') AS sku, IFNULL(name,'') AS name FROM products WHERE id = ?`,
    [key]
  );
  if (byId?.id) return byId;
  const bySku = get<{ id: string; sku: string; name: string }>(
    `SELECT id, IFNULL(sku,'') AS sku, IFNULL(name,'') AS name
     FROM products
     WHERE sku = ? OR code = ? OR REPLACE(IFNULL(sku,''),' ','') = REPLACE(?,' ','')
        OR lower(REPLACE(IFNULL(sku,''),' ','')) = lower(REPLACE(?,' ',''))
        OR lower(REPLACE(IFNULL(sku,''),' ','')) LIKE lower(REPLACE(?,' ','')) || '@%'
     ORDER BY
       CASE WHEN sku = ? THEN 0
            WHEN code = ? THEN 1
            WHEN instr(IFNULL(sku,''), '@') = 0 THEN 2
            ELSE 3 END,
       length(IFNULL(sku,''))
     LIMIT 1`,
    [key, key, key, key, key, key, key]
  );
  if (bySku?.id) return bySku;
  throw new Error(`Товар не найден в номенклатуре: ${key}`);
}

/** Кладовщик указывает, какие детали получились и в какую ячейку положили. */
export function setProductionProduceResults(
  jobId: string,
  linesIn: Array<{
    product_id?: string;
    sku?: string;
    name?: string;
    qty?: number;
    cell_code?: string;
  }>,
  actorId?: string
) {
  ensureProdLineCellCol();
  const job = getProductionJob(jobId);
  if (!job) throw new Error('Заказ не найден');
  if (['closed', 'cancelled'].includes(String(job.status))) {
    throw new Error('Производство уже закрыто');
  }
  const lines = Array.isArray(linesIn) ? linesIn : [];
  if (!lines.length) throw new Error('Добавьте детали после производства');

  const resolved: Array<{ id: string; sku: string; name: string; qty: number; cell_code: string }> =
    [];
  for (const l of lines) {
    const qty = Number(l.qty) || 0;
    let cell = String(l.cell_code || '').trim();
    if (cell === '-' || cell === '–' || cell === '—') cell = '—';
    const key = String(l.product_id || l.sku || '').trim();
    if (!(qty > 0)) throw new Error('Укажите количество по каждой детали');
    // Ячейка необязательна: «—» / пусто = на склад без адреса
    if (!cell) cell = '—';
    const p = resolveProductBySkuOrId(key);
    resolved.push({
      id: p.id,
      sku: p.sku || String(l.sku || ''),
      name: p.name || String(l.name || ''),
      qty,
      cell_code: cell,
    });
  }

  const maxConsume = get<{ n: number }>(
    `SELECT IFNULL(MAX(line_no),0) AS n FROM production_job_lines WHERE job_id = ? AND direction = 'consume'`,
    [jobId]
  );
  let lineNo = Number(maxConsume?.n || 0) + 1;
  run(`DELETE FROM production_job_lines WHERE job_id = ? AND direction = 'produce'`, [jobId]);
  for (const r of resolved) {
    run(
      `INSERT INTO production_job_lines (id, job_id, line_no, direction, product_id, sku, name, qty, cell_code)
       VALUES (?, ?, ?, 'produce', ?, ?, ?, ?, ?)`,
      [newGuid(), jobId, lineNo++, r.id, r.sku, r.name, r.qty, r.cell_code]
    );
  }
  logProductionEvent(jobId, 'produce_results_set', actorId, {
    lines: resolved.map((r) => ({
      product_id: r.id,
      sku: r.sku,
      qty: r.qty,
      cell_code: r.cell_code,
    })),
  });
  return getProductionJob(jobId)!;
}

function enrichJob(row: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!row) return null;
  const lines = loadLines(String(row.id));
  const consume = lines.filter((l) => l.direction === 'consume');
  const produce = lines.filter((l) => l.direction === 'produce');
  const summary = formatJobSummary(consume, produce, String(row.kind || ''));
  return {
    ...row,
    status_label: STATUS_LABELS[String(row.status)] || String(row.status),
    kind_label: KIND_LABELS[String(row.kind)] || String(row.kind),
    lines,
    consume,
    produce,
    summary,
  };
}

export function formatJobSummary(
  consume: Array<{ sku: string; name: string; qty: number }>,
  produce: Array<{ sku: string; name: string; qty: number }>,
  kind: string
): string {
  const fmt = (rows: typeof consume) =>
    rows.map((r) => `${r.qty}× ${r.sku || r.name}`.trim()).join(' + ');
  const inS = fmt(consume) || '—';
  const outS = fmt(produce) || '—';
  if (kind === 'disassemble') return `${inS} → ${outS}`;
  return `${inS} ⇒ ${outS}`;
}

export function getProductionJob(id: string): Record<string, unknown> | null {
  const row = get('SELECT * FROM production_jobs WHERE id = ?', [id]) as Record<string, unknown> | null;
  return enrichJob(row);
}

export function listProductionJobs(opts: {
  status?: string;
  deal_id?: string;
  limit?: number;
}) {
  const where: string[] = ['1=1'];
  const params: Array<string | number> = [];
  const st = String(opts.status || '').trim();
  if (st) {
    where.push('status = ?');
    params.push(st);
  }
  const dealId = String(opts.deal_id || '').trim();
  if (dealId) {
    where.push('deal_id = ?');
    params.push(dealId);
  }
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const items = all(
    `SELECT * FROM production_jobs
     WHERE ${where.join(' AND ')}
     ORDER BY datetime(updated_at) DESC, number DESC
     LIMIT ?`,
    [...params, limit]
  ).map((r) => enrichJob(r as Record<string, unknown>));
  return { items, status_labels: STATUS_LABELS, kind_labels: KIND_LABELS };
}

function resolveProduct(productId: string) {
  const p = get<{ id: string; sku: string; name: string }>(
    `SELECT id, IFNULL(sku,'') AS sku, IFNULL(name,'') AS name FROM products WHERE id = ?`,
    [productId]
  );
  if (!p?.id) throw new Error(`Товар не найден: ${productId}`);
  return p;
}

export function createProductionJob(input: {
  kind: ProductionKind;
  deal_id?: string;
  comment?: string;
  lines: Array<{ direction: 'consume' | 'produce'; product_id: string; qty?: number }>;
  actor_id?: string;
}) {
  const kind = input.kind;
  if (!['assemble', 'disassemble'].includes(kind)) throw new Error('kind: assemble|disassemble');
  const linesIn = Array.isArray(input.lines) ? input.lines : [];
  const consume = linesIn.filter((l) => l.direction === 'consume');
  const produce = linesIn.filter((l) => l.direction === 'produce');
  if (!consume.length || !produce.length) {
    throw new Error('Нужны строки consume (что уходит) и produce (что получается)');
  }
  const dealId = String(input.deal_id || '').trim();
  const mainWh = productionMainWarehouseId();
  const prodWh = productionWipWarehouseId();
  const id = newGuid();
  const number = nextCode('PJ', 5);
  const docDate = new Date().toISOString().slice(0, 10);
  run(
    `INSERT INTO production_jobs (
       id, number, doc_date, kind, status, deal_id,
       warehouse_id, prod_warehouse_id, comment, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      id,
      number,
      docDate,
      kind,
      dealId,
      mainWh,
      prodWh,
      String(input.comment || '').trim(),
    ]
  );
  let lineNo = 1;
  for (const dir of ['consume', 'produce'] as const) {
    for (const l of linesIn.filter((x) => x.direction === dir)) {
      const productId = String(l.product_id || '').trim();
      const qty = Number(l.qty) || 0;
      if (!productId || !(qty > 0)) continue;
      const p = resolveProduct(productId);
      run(
        `INSERT INTO production_job_lines (id, job_id, line_no, direction, product_id, sku, name, qty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newGuid(), id, lineNo++, dir, p.id, p.sku, p.name, qty]
      );
    }
  }
  const job = getProductionJob(id)!;
  logProductionEvent(id, 'created', input.actor_id, { number, kind, deal_id: dealId });
  postProductionDealNote(job, 'created');
  return job;
}

function logProductionEvent(
  jobId: string,
  event: string,
  actorId?: string,
  payload?: Record<string, unknown>
) {
  run(
    `INSERT INTO production_job_events (id, job_id, event, actor_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [newGuid(), jobId, event, String(actorId || ''), JSON.stringify(payload || {})]
  );
  run(`UPDATE production_jobs SET updated_at = datetime('now') WHERE id = ?`, [jobId]);
}

function nextTaskNumber(dealId?: string): string {
  if (dealId) return nextCode('W', 4);
  return nextCode('W', 5);
}

function createProductionWarehouseTask(input: {
  job: ProductionJob;
  channel: 'production_send' | 'production_receive';
  lines: ProductionLine[];
  comment: string;
  actor_id?: string;
}) {
  const job = input.job;
  const id = newGuid();
  const dealId = String(job.deal_id || '').trim();
  const number = nextTaskNumber(dealId);
  const barcode = number.replace(/-/g, '');
  const kindLabel = KIND_LABELS[String(job.kind)] || String(job.kind);
  const routeNote =
    input.channel === 'production_send'
      ? `Основной → Производство · ${kindLabel}`
      : `Производство → Основной · ${kindLabel}`;
  let buyerName = '';
  if (dealId) {
    const d = get<{ buyer_name: string; company_name: string; name: string }>(
      `SELECT IFNULL(buyer_name,'') AS buyer_name,
              IFNULL(company_name,'') AS company_name,
              IFNULL(name,'') AS name
       FROM crm_deals WHERE id = ?`,
      [dealId]
    );
    buyerName = String(d?.buyer_name || d?.company_name || d?.name || '').trim();
  }
  if (!buyerName) buyerName = kindLabel || 'Производство';

  run(
    `INSERT INTO warehouse_tasks (
      id, number, barcode, deal_id, status, channel, city, buyer_name, amount_locked,
      payment_required, track_number, comment, stock_doc_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'new', ?, 'Производство', ?, 0, 0, '', ?, ?, datetime('now'), datetime('now'))`,
    [
      id,
      number,
      barcode,
      dealId,
      input.channel,
      buyerName,
      `${routeNote}. ${input.comment}`,
      String(job.id),
    ]
  );

  let lineNo = 1;
  for (const l of input.lines) {
    run(
      `INSERT INTO warehouse_task_lines (
        id, task_id, line_no, product_id, sku, name, qty, weight_g, dims_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, '{}')`,
      [newGuid(), id, lineNo++, l.product_id, l.sku, l.name, l.qty]
    );
  }

  logTask(id, 'task.created', input.actor_id, {
    production_job_id: job.id,
    production_job_number: job.number,
    channel: input.channel,
  });

  const col = input.channel === 'production_send' ? 'send_task_id' : 'receive_task_id';
  run(`UPDATE production_jobs SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`, [
    id,
    job.id,
  ]);

  return getTask(id);
}

/** Отправить на производство: задание кладовщику + статус await_send. */
export function queueProductionSend(jobId: string, actorId?: string) {
  const job = getProductionJob(jobId);
  if (!job) throw new Error('Заказ не найден');
  const st = String(job.status);
  if (st !== 'draft' && st !== 'await_send') {
    throw new Error(`Нельзя отправить из статуса «${job.status_label}»`);
  }
  if (String(job.send_task_id || '').trim()) {
    run(`UPDATE production_jobs SET status = 'await_send', updated_at = datetime('now') WHERE id = ?`, [
      jobId,
    ]);
    return getProductionJob(jobId)!;
  }
  const summary = String(job.summary || '');
  const dealNote = job.deal_id ? ` · сделка ${job.deal_id}` : '';
  const task = createProductionWarehouseTask({
    job: job as ProductionJob,
    channel: 'production_send',
    lines: job.consume as ProductionLine[],
    comment: `Производство ${job.number}: отнести на сборку/разбор${dealNote}. ${summary}`,
    actor_id: actorId,
  });
  run(`UPDATE production_jobs SET status = 'await_send', updated_at = datetime('now') WHERE id = ?`, [
    jobId,
  ]);
  logProductionEvent(jobId, 'queued_send', actorId, { task_id: task?.id, task_number: task?.number });
  postProductionDealNote(getProductionJob(jobId), 'queued_send');
  return getProductionJob(jobId)!;
}

/** Кладовщик отнёс на производство — перемещение на PROD-WIP. */
export function executeProductionSendFromTask(input: { task_id: string; actor_id?: string }) {
  const task = get('SELECT * FROM warehouse_tasks WHERE id = ?', [input.task_id]) as
    | Record<string, unknown>
    | undefined;
  if (!task) throw new Error('Задание не найдено');
  if (String(task.channel) !== 'production_send') {
    throw new Error('Не задание на отправку в производство');
  }
  const jobId = String(task.stock_doc_id || '').trim();
  const job = getProductionJob(jobId);
  if (!job) throw new Error('Заказ производства не найден');

  const mainWh = String(job.warehouse_id || productionMainWarehouseId());
  const prodWh = String(job.prod_warehouse_id || productionWipWarehouseId());
  const dealId = String(job.deal_id || '').trim();
  const summary = String(job.summary || '');

  const transferId = createDocument({
    doc_type: 'transfer',
    warehouse_id: mainWh,
    warehouse_to_id: prodWh,
    deal_id: dealId,
    comment: `Производство ${job.number} · на участок · ${summary}`,
    lines: (job.consume as ProductionLine[]).map((l) => ({
      product_id: l.product_id,
      qty: l.qty,
      warehouse_id: mainWh,
    })),
    post: true,
    serials_optional: true,
  });

  run(
    `UPDATE production_jobs
     SET status = 'at_production', send_transfer_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [transferId, jobId]
  );
  logProductionEvent(jobId, 'sent_to_production', input.actor_id, {
    transfer_id: transferId,
    task_id: input.task_id,
  });
  postProductionDealNote(getProductionJob(jobId), 'sent_to_production');
  return { job: getProductionJob(jobId), transfer_id: transferId };
}

/** Производство нажало «Готово» — задание складу на оприходование результата. */
export function markProductionJobDone(jobId: string, actorId?: string) {
  const job = getProductionJob(jobId);
  if (!job) throw new Error('Заказ не найден');
  if (String(job.status) !== 'at_production') {
    throw new Error(`Статус «${job.status_label}» — нельзя закрыть производство`);
  }
  if (String(job.receive_task_id || '').trim()) {
    run(
      `UPDATE production_jobs SET status = 'await_receive', done_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      [jobId]
    );
    postProductionDealNote(getProductionJob(jobId), 'production_done');
    return getProductionJob(jobId)!;
  }
  const summary = String(job.summary || '');
  const dealNote = job.deal_id ? ` · сделка ${job.deal_id}` : '';
  createProductionWarehouseTask({
    job: job as ProductionJob,
    channel: 'production_receive',
    lines: job.produce as ProductionLine[],
    comment: `Производство ${job.number}: оприходовать результат${dealNote}. ${summary}`,
    actor_id: actorId,
  });
  run(
    `UPDATE production_jobs
     SET status = 'await_receive', done_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
    [jobId]
  );
  logProductionEvent(jobId, 'production_done', actorId, {});
  postProductionDealNote(getProductionJob(jobId), 'production_done');
  return getProductionJob(jobId)!;
}

/** Кладовщик забрал с производства: списание комплектующих с PROD-WIP + приход готового на MAIN. */
export function executeProductionReceiveFromTask(input: { task_id: string; actor_id?: string }) {
  const task = get('SELECT * FROM warehouse_tasks WHERE id = ?', [input.task_id]) as
    | Record<string, unknown>
    | undefined;
  if (!task) throw new Error('Задание не найдено');
  if (String(task.channel) !== 'production_receive') {
    throw new Error('Не задание на приём с производства');
  }
  const jobId = String(task.stock_doc_id || '').trim();
  const job = getProductionJob(jobId);
  if (!job) throw new Error('Заказ производства не найден');

  const mainWh = String(job.warehouse_id || productionMainWarehouseId());
  const prodWh = String(job.prod_warehouse_id || productionWipWarehouseId());
  const dealId = String(job.deal_id || '').trim();
  const summary = String(job.summary || '');

  const outId = createDocument({
    doc_type: 'out',
    warehouse_id: prodWh,
    deal_id: dealId,
    comment: `Производство ${job.number} · списание на участке · ${summary}`,
    lines: (job.consume as ProductionLine[]).map((l) => ({
      product_id: l.product_id,
      qty: l.qty,
      warehouse_id: prodWh,
    })),
    post: true,
    serials_optional: true,
  });

  const produceLines = (job.produce as ProductionLine[]) || [];
  const inId = createDocument({
    doc_type: 'in',
    warehouse_id: mainWh,
    deal_id: dealId,
    comment: `Производство ${job.number} · приход готового · ${summary}`,
    lines: produceLines.map((l) => ({
      product_id: l.product_id,
      qty: l.qty,
      warehouse_id: mainWh,
    })),
    post: false,
    serials_optional: true,
  });
  const inDocLines = all<{ id: string; product_id: string; qty: number }>(
    `SELECT id, product_id, qty FROM stock_doc_lines WHERE doc_id = ? ORDER BY line_no`,
    [inId]
  );
  for (const pl of produceLines) {
    const cellCode = String(pl.cell_code || '').trim();
    if (!cellCode || cellCode === '—' || cellCode === '-' || cellCode === '–') continue;
    const docLine = inDocLines.find((d) => d.product_id === pl.product_id);
    if (!docLine) continue;
    const plQty = Number(pl.qty) || Number(docLine.qty) || 0;
    if (!(plQty > 0)) continue;
    insertLinePlacements({
      doc_id: inId,
      line_id: docLine.id,
      warehouse_id: mainWh,
      product_id: pl.product_id,
      placements: [{ cell_code: cellCode, qty: plQty, warehouse_id: mainWh }],
    });
  }
  postDocument(inId, { serialsOptional: true });

  run(
    `UPDATE production_jobs
     SET status = 'closed', receive_out_id = ?, receive_in_id = ?,
         received_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
    [outId, inId, jobId]
  );
  logProductionEvent(jobId, 'received_from_production', input.actor_id, {
    out_id: outId,
    in_id: inId,
    task_id: input.task_id,
  });
  postProductionDealNote(getProductionJob(jobId), 'received_from_production');
  return { job: getProductionJob(jobId), out_id: outId, in_id: inId };
}

/** Активные заказы производства по сделке (не closed/cancelled). */
export function listActiveProductionJobsForDeal(dealId: string) {
  const id = String(dealId || '').trim();
  if (!id) return [];
  return listProductionJobs({ deal_id: id, limit: 20 }).items.filter(
    (j) => !!j && !['closed', 'cancelled'].includes(String(j.status))
  );
}

/** Создать производство из сделки: consume из позиций заказа, produce из формы. */
export function createProductionFromDeal(
  dealId: string,
  input: {
    kind?: ProductionKind;
    comment?: string;
    consume_lines?: Array<{ product_id: string; qty?: number }>;
    produce_lines?: Array<{ product_id: string; qty?: number }>;
    queue_send?: boolean;
    actor_id?: string;
  }
) {
  const dealIdStr = String(dealId || '').trim();
  const deal = getDeal(dealIdStr) as { items?: Array<Record<string, unknown>> } | null;
  if (!deal) throw new Error('Сделка не найдена');

  const open = all<{ id: string; number: string; status: string }>(
    `SELECT id, number, status FROM production_jobs
     WHERE deal_id = ? AND status NOT IN ('closed','cancelled')
     LIMIT 5`,
    [dealIdStr]
  );
  if (open.length) {
    const nums = open.map((j) => j.number).join(', ');
    throw new Error(`У сделки уже есть активное производство: ${nums}`);
  }

  let consume = Array.isArray(input.consume_lines) ? input.consume_lines : [];
  let produce = Array.isArray(input.produce_lines) ? input.produce_lines : [];

  if (!consume.length) {
    const items = Array.isArray(deal.items) ? deal.items : [];
    consume = items
      .filter((it) => String(it.item_kind || '') !== 'service')
      .map((it) => ({
        product_id: String(it.product_guid || '').trim(),
        qty: Number(it.qty) || 0,
      }))
      .filter((l) => l.product_id && l.qty > 0);
  }

  consume = consume
    .map((l) => ({
      product_id: String(l.product_id || '').trim(),
      qty: Number(l.qty) || 0,
    }))
    .filter((l) => l.product_id && l.qty > 0);

  produce = produce
    .map((l) => ({
      product_id: String(l.product_id || '').trim(),
      qty: Number(l.qty) || 0,
    }))
    .filter((l) => l.product_id && l.qty > 0);

  if (!consume.length) {
    throw new Error('Нет товарных позиций для отправки в производство');
  }
  // Виджет Amo: если результат не указан — оприходуем те же позиции (ребилд).
  if (!produce.length) {
    produce = consume.map((l) => ({ product_id: l.product_id, qty: l.qty }));
  }

  const kind: ProductionKind =
    input.kind ||
    (produce.length > consume.length ? 'disassemble' : 'assemble');

  const lines = [
    ...consume.map((l) => ({
      direction: 'consume' as const,
      product_id: l.product_id,
      qty: l.qty,
    })),
    ...produce.map((l) => ({
      direction: 'produce' as const,
      product_id: l.product_id,
      qty: l.qty,
    })),
  ];

  let job = createProductionJob({
    kind,
    deal_id: dealIdStr,
    comment: String(input.comment || '').trim() || `Из заказа ${dealIdStr}`,
    lines,
    actor_id: input.actor_id,
  });

  if (input.queue_send !== false) {
    job = queueProductionSend(String(job.id), input.actor_id);
  }

  return job;
}

export function cancelProductionJob(jobId: string, actorId?: string) {
  const job = getProductionJob(jobId);
  if (!job) throw new Error('Заказ не найден');
  const st = String(job.status);
  if (['closed', 'cancelled'].includes(st)) throw new Error('Уже закрыто');
  if (['at_production', 'await_receive'].includes(st)) {
    throw new Error('Уже на производстве — отмена только вручную через склад');
  }
  run(`UPDATE production_jobs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, [
    jobId,
  ]);
  logProductionEvent(jobId, 'cancelled', actorId, {});
  postProductionDealNote(getProductionJob(jobId), 'cancelled');
  return getProductionJob(jobId)!;
}

export function mountProductionJobRoutes(api: Hono): void {
  api.get('/production/jobs/meta', (c) =>
    c.json({ status_labels: STATUS_LABELS, kind_labels: KIND_LABELS })
  );

  api.get('/production/jobs', (c) => {
    const actor = actorFromContext(c);
    const d = denyProduction(c, actor);
    if (d) return d;
    return c.json(
      listProductionJobs({
        status: c.req.query('status') || '',
        deal_id: c.req.query('deal_id') || '',
        limit: Number(c.req.query('limit') || 50),
      })
    );
  });

  api.get('/production/jobs/:id', (c) => {
    const actor = actorFromContext(c);
    const d = denyProduction(c, actor);
    if (d) return d;
    const row = getProductionJob(c.req.param('id'));
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });

  api.post('/production/jobs', async (c) => {
    const actor = actorFromContext(c);
    const d = denyProduction(c, actor);
    if (d) return d;
    const body = (await c.req.json().catch(() => ({}))) as {
      kind?: ProductionKind;
      deal_id?: string;
      comment?: string;
      lines?: Array<{ direction: 'consume' | 'produce'; product_id: string; qty?: number }>;
      queue_send?: boolean;
    };
    try {
      let job = createProductionJob({
        kind: body.kind || 'assemble',
        deal_id: body.deal_id,
        comment: body.comment,
        lines: body.lines || [],
        actor_id: actor!.id,
      });
      if (body.queue_send) {
        job = queueProductionSend(String(job.id), actor!.id);
      }
      auditFromContext(c, {
        action: 'production.job_create',
        entity: 'production_job',
        entityId: String(job.id),
        summary: `${job.number} · ${job.kind_label}`,
      });
      return c.json(job, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'create failed' }, 400);
    }
  });

  api.post('/production/jobs/:id/send', async (c) => {
    const actor = actorFromContext(c);
    const d = denyProduction(c, actor);
    if (d) return d;
    try {
      const job = queueProductionSend(c.req.param('id'), actor!.id);
      return c.json(job);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'send failed' }, 400);
    }
  });

  api.post('/production/jobs/:id/produce-results', async (c) => {
    const actor = actorFromContext(c);
    const d = denyProduction(c, actor);
    if (d) return d;
    const body = (await c.req.json().catch(() => ({}))) as {
      lines?: Array<{
        product_id?: string;
        sku?: string;
        name?: string;
        qty?: number;
        cell_code?: string;
      }>;
    };
    try {
      const job = setProductionProduceResults(
        c.req.param('id'),
        Array.isArray(body.lines) ? body.lines : [],
        actor!.id
      );
      auditFromContext(c, {
        action: 'production.produce_results',
        entity: 'production_job',
        entityId: c.req.param('id'),
        summary: `Детали после производства · ${(job.produce as unknown[])?.length || 0} поз.`,
      });
      return c.json(job);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'produce-results failed' }, 400);
    }
  });

  api.post('/production/jobs/:id/done', async (c) => {
    const actor = actorFromContext(c);
    const d = denyProduction(c, actor);
    if (d) return d;
    try {
      const job = markProductionJobDone(c.req.param('id'), actor!.id);
      auditFromContext(c, {
        action: 'production.job_done',
        entity: 'production_job',
        entityId: c.req.param('id'),
        summary: String(job.summary || ''),
      });
      return c.json(job);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'done failed' }, 400);
    }
  });

  api.post('/production/jobs/:id/cancel', async (c) => {
    const actor = actorFromContext(c);
    const d = denyProduction(c, actor);
    if (d) return d;
    try {
      return c.json(cancelProductionJob(c.req.param('id'), actor!.id));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'cancel failed' }, 400);
    }
  });
}
