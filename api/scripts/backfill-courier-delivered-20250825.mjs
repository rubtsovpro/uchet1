/**
 * Догонка по сделкам «курьер отвёз» 25.08.2026:
 * — проверка переноса на склад курьера
 * — списание со склада курьера (Отправка курьером)
 * — примечание в Amo без дублей
 *
 * Usage: node scripts/backfill-courier-delivered-20250825.mjs [YYYY-MM-DD] [--dry-run]
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const day = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '2026-08-25';
const dryRun = process.argv.includes('--dry-run');

process.chdir(path.resolve(__dirname, '..'));
const { get, all } = await import(pathToFileURL(path.resolve('dist/db.js')).href);
const { writeOffCourierOnDelivered } = await import(
  pathToFileURL(path.resolve('dist/deal-stock-flow.js')).href
);
const { courierWarehouseId, mainWarehouseId } = await import(
  pathToFileURL(path.resolve('dist/supply-chain.js')).href
);
const { notifyAmoCourierDeliveredOnce, amoHasCourierDeliveredNote } = await import(
  pathToFileURL(path.resolve('dist/amo-pick-handoff.js')).href
);

const courierWh = courierWarehouseId();
let mainWh = '';
try {
  mainWh = mainWarehouseId();
} catch {
  mainWh = '';
}

const mainLikeIds = new Set(
  all(
    `SELECT id FROM warehouses
     WHERE UPPER(IFNULL(code,'')) IN ('MAIN','НФ-000032')
        OR IFNULL(name,'') LIKE '%Основн%'`
  ).map((r) => String(r.id))
);

const runs = all(
  `SELECT cr.deal_id, cr.id AS run_id, cr.status, cr.delivered_at, cr.kind,
          IFNULL(d.name,'') AS deal_name, IFNULL(d.amo_shipment,'') AS amo_shipment
   FROM courier_runs cr
   LEFT JOIN crm_deals d ON d.id = cr.deal_id
   WHERE IFNULL(cr.deal_id,'') != ''
     AND cr.status = 'delivered'
     AND substr(IFNULL(cr.delivered_at,''), 1, 10) = ?
   ORDER BY cr.delivered_at ASC, cr.deal_id ASC`,
  [day]
);

function findXferToCourier(dealId) {
  const rows = all(
    `SELECT d.id, d.number, IFNULL(d.posted,0) AS posted,
            d.warehouse_id, d.warehouse_to_id, IFNULL(d.comment,'') AS comment,
            IFNULL(wf.code,'') AS from_code, IFNULL(wt.code,'') AS to_code
     FROM stock_docs d
     LEFT JOIN warehouses wf ON wf.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     WHERE d.deal_id = ? AND d.doc_type = 'transfer' AND d.warehouse_to_id = ?
     ORDER BY datetime(d.created_at) ASC`,
    [dealId, courierWh]
  );
  const posted = rows.filter((r) => Number(r.posted) === 1);
  const fromMain = posted.some(
    (r) =>
      mainLikeIds.has(String(r.warehouse_id || '')) ||
      /основ/i.test(String(r.from_code || '')) ||
      String(r.warehouse_id || '') === mainWh
  );
  return { rows, posted, fromMain };
}

function findWriteoff(dealId) {
  return get(
    `SELECT id, number FROM stock_docs
     WHERE deal_id = ? AND doc_type = 'out' AND IFNULL(posted,0) = 1
       AND IFNULL(comment,'') LIKE '%курьер отвёз%'
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [dealId]
  );
}

const report = {
  day,
  dryRun,
  total: runs.length,
  ok: [],
  errors: [],
  skipped: [],
};

for (const run of runs) {
  const dealId = String(run.deal_id || '').trim();
  const item = {
    deal_id: dealId,
    run_id: run.run_id,
    delivered_at: run.delivered_at,
    shipment: run.amo_shipment,
  };

  const xfer = findXferToCourier(dealId);
  if (!xfer.posted.length) {
    report.errors.push({ ...item, error: 'нет проведённого переноса на склад курьера' });
    continue;
  }
  item.xfer = xfer.posted.map((r) => `${r.number} (${r.from_code}→${r.to_code})`).join(', ');
  if (!xfer.fromMain) {
    item.xfer_warn = 'перенос не с MAIN, но на курьера есть';
  }

  if (String(run.status || '') !== 'delivered') {
    report.errors.push({ ...item, error: `courier_run status=${run.status}` });
    continue;
  }

  let wo = findWriteoff(dealId);
  if (!wo?.id) {
    if (dryRun) {
      item.writeoff = 'would_create';
    } else {
      try {
        const r = writeOffCourierOnDelivered(dealId, {
          createdBy: 'backfill · курьер 25.08',
          actor_name: 'backfill · курьер 25.08',
        });
        item.writeoff = r;
        if (r.written_off || r.already) {
          wo = findWriteoff(dealId);
        } else if (r.skipped) {
          report.skipped.push({ ...item, reason: r.reason || 'writeoff_skipped' });
          continue;
        }
      } catch (e) {
        report.errors.push({
          ...item,
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }
    }
  } else {
    item.writeoff = { already: true, number: wo.number };
  }

  const docNum = wo?.number ? String(wo.number) : '';
  const noteText = `Курьер отвёз · Отправка курьером · списание со склада курьера · заказ ${dealId}${
    docNum ? ' · ' + docNum : ''
  } · backfill 25.08`;

  if (dryRun) {
    item.amo_note = 'would_send_if_missing';
  } else {
    const has = await amoHasCourierDeliveredNote(dealId);
    if (has) {
      item.amo_note = { skipped: true, reason: 'already_in_amo' };
    } else {
      const nr = await notifyAmoCourierDeliveredOnce({ dealId, text: noteText });
      item.amo_note = nr;
    }
  }

  report.ok.push(item);
}

const courierLeft = get(
  `SELECT COUNT(*) AS lines, IFNULL(SUM(qty),0) AS qty
   FROM stock_balances WHERE warehouse_id = ? AND qty > 0`,
  [courierWh]
);

console.log(JSON.stringify({ ...report, courier_stock_after: courierLeft }, null, 2));
