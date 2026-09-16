/**
 * Акт о расхождениях (АРЗ): поставка / эталон vs приходная.
 */
import { all, get, run } from './db.js';
import { newGuid, nextCode } from './ids.js';

export type DiscrepancyKind = 'missing' | 'extra' | 'qty_diff';

export type BaselineLine = {
  product_id: string;
  qty: number;
  price?: number;
};

export type DiscrepancyLine = {
  product_id: string;
  kind: DiscrepancyKind;
  qty_supply: number;
  qty_inbound: number;
  qty_diff: number;
  note: string;
  product_name?: string;
  sku?: string;
  code?: string;
};

function qtyEq(a: number, b: number): boolean {
  return Math.abs(Number(a) - Number(b)) < 0.0001;
}

function aggregateByProduct(lines: BaselineLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const l of lines) {
    const pid = String(l.product_id || '').trim();
    if (!pid) continue;
    const q = Number(l.qty) || 0;
    map.set(pid, (map.get(pid) || 0) + q);
  }
  return map;
}

/** Эталон: сначала снимок baseline, затем заказ (native / thin), затем строки документа. */
export async function resolveInboundBaseline(docId: string): Promise<{
  source: 'supplier_order' | 'baseline' | 'lines' | 'thin_order';
  supplier_order_id: string;
  supply_number: string;
  lines: BaselineLine[];
}> {
  const doc = await get<{
    source_supplier_order_id: string;
    supply_number: string;
    inbound_baseline_json: string;
  }>(
    `SELECT IFNULL(source_supplier_order_id,'') AS source_supplier_order_id,
            IFNULL(supply_number,'') AS supply_number,
            IFNULL(inbound_baseline_json,'') AS inbound_baseline_json
     FROM stock_docs WHERE id = ?`,
    [docId]
  );
  if (!doc) throw new Error('Документ не найден');

  const orderId = String(doc.source_supplier_order_id || '').trim();
  const supplyNumber = String(doc.supply_number || '').trim();

  const raw = String(doc.inbound_baseline_json || '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { lines?: BaselineLine[] };
      const lines = Array.isArray(parsed?.lines) ? parsed.lines : [];
      if (lines.length) {
        return {
          source: 'baseline',
          supplier_order_id: orderId,
          supply_number: supplyNumber,
          lines: lines
            .map((l) => ({
              product_id: String(l.product_id || '').trim(),
              qty: Number(l.qty) || 0,
              price: Number(l.price) || 0,
            }))
            .filter((l) => l.product_id),
        };
      }
    } catch {
      /* fall through */
    }
  }

  if (orderId) {
    const orderLines = await all<{ product_id: string; qty: number; price: number }>(
      `SELECT IFNULL(product_id,'') AS product_id, qty, IFNULL(price,0) AS price
       FROM supplier_order_lines WHERE order_id = ? ORDER BY sort_order, rowid`,
      [orderId]
    );
    if (orderLines.length) {
      return {
        source: 'supplier_order',
        supplier_order_id: orderId,
        supply_number: supplyNumber,
        lines: orderLines.map((r) => ({
          product_id: String(r.product_id),
          qty: Number(r.qty) || 0,
          price: Number(r.price) || 0,
        })),
      };
    }
    const thin = await get<{ payload_json: string }>(
      `SELECT IFNULL(payload_json,'') AS payload_json
       FROM thin_journal_docs WHERE id = ? AND journal_key = 'supplier_orders'`,
      [orderId]
    );
    if (thin?.payload_json) {
      try {
        const payload = JSON.parse(thin.payload_json) as { lines?: Array<Record<string, unknown>> };
        const lines = Array.isArray(payload.lines) ? payload.lines : [];
        const mapped = lines
          .map((l) => ({
            product_id: String(l.product_id || '').trim(),
            qty: Number(l.qty) || 0,
            price: Number(l.price) || 0,
          }))
          .filter((l) => l.product_id);
        if (mapped.length) {
          return {
            source: 'thin_order',
            supplier_order_id: orderId,
            supply_number: supplyNumber,
            lines: mapped,
          };
        }
      } catch {
        /* fall through */
      }
    }
  }

  const dbLines = await all<{ product_id: string; qty: number; price: number }>(
    `SELECT IFNULL(product_id,'') AS product_id, qty, IFNULL(price,0) AS price
     FROM stock_doc_lines WHERE doc_id = ? ORDER BY rowid`,
    [docId]
  );
  return {
    source: 'lines',
    supplier_order_id: orderId,
    supply_number: supplyNumber,
    lines: dbLines.map((r) => ({
      product_id: String(r.product_id),
      qty: Number(r.qty) || 0,
      price: Number(r.price) || 0,
    })),
  };
}

export function compareSupplyVsInbound(
  supply: BaselineLine[],
  inbound: BaselineLine[]
): DiscrepancyLine[] {
  const sMap = aggregateByProduct(supply);
  const iMap = aggregateByProduct(inbound);
  const ids = new Set([...sMap.keys(), ...iMap.keys()]);
  const out: DiscrepancyLine[] = [];
  for (const productId of ids) {
    const qtySupply = sMap.get(productId) || 0;
    const qtyInbound = iMap.get(productId) || 0;
    if (qtyEq(qtySupply, qtyInbound)) continue;
    let kind: DiscrepancyKind = 'qty_diff';
    let note = '';
    if (qtySupply > 0.0001 && qtyInbound < 0.0001) {
      kind = 'missing';
      note = 'Было в поставке — нет в приходе';
    } else if (qtyInbound > 0.0001 && qtySupply < 0.0001) {
      kind = 'extra';
      note = 'Есть в приходе — не было в поставке';
    } else {
      kind = 'qty_diff';
      note = `В поставке ${qtySupply}, оприходовано ${qtyInbound}`;
    }
    out.push({
      product_id: productId,
      kind,
      qty_supply: qtySupply,
      qty_inbound: qtyInbound,
      qty_diff: qtyInbound - qtySupply,
      note,
    });
  }
  return out.sort((a, b) => a.product_id.localeCompare(b.product_id));
}

async function enrichDiscrepancyLines(lines: DiscrepancyLine[]): Promise<DiscrepancyLine[]> {
  return await Promise.all(lines.map(async (l) => {
    const p = await get<{ name: string; sku: string; code: string }>(
      `SELECT IFNULL(name,'') AS name, IFNULL(sku,'') AS sku, IFNULL(code,'') AS code
       FROM products WHERE id = ?`,
      [l.product_id]
    );
    return {
      ...l,
      product_name: String(p?.name || ''),
      sku: String(p?.sku || ''),
      code: String(p?.code || ''),
    };
  }));
}

/** Записать эталон, если ещё пуст. */
export async function ensureInboundBaseline(docId: string, fallbackLines?: BaselineLine[]): Promise<void> {
  const row = await get<{ inbound_baseline_json: string; source_supplier_order_id: string }>(
    `SELECT IFNULL(inbound_baseline_json,'') AS inbound_baseline_json,
            IFNULL(source_supplier_order_id,'') AS source_supplier_order_id
     FROM stock_docs WHERE id = ?`,
    [docId]
  );
  if (!row) return;
  if (String(row.inbound_baseline_json || '').trim()) return;

  const orderId = String(row.source_supplier_order_id || '').trim();
  let lines: BaselineLine[] = [];
  if (orderId) {
    lines = (await all<{ product_id: string; qty: number; price: number }>(
      `SELECT IFNULL(product_id,'') AS product_id, qty, IFNULL(price,0) AS price
       FROM supplier_order_lines WHERE order_id = ?`,
      [orderId]
    )).map((r) => ({
      product_id: String(r.product_id),
      qty: Number(r.qty) || 0,
      price: Number(r.price) || 0,
    }));
    if (!lines.length) {
      const thin = await get<{ payload_json: string }>(
        `SELECT IFNULL(payload_json,'') AS payload_json
         FROM thin_journal_docs WHERE id = ? AND journal_key = 'supplier_orders'`,
        [orderId]
      );
      if (thin?.payload_json) {
        try {
          const payload = JSON.parse(thin.payload_json) as {
            lines?: Array<Record<string, unknown>>;
          };
          lines = (Array.isArray(payload.lines) ? payload.lines : [])
            .map((l) => ({
              product_id: String(l.product_id || '').trim(),
              qty: Number(l.qty) || 0,
              price: Number(l.price) || 0,
            }))
            .filter((l) => l.product_id);
        } catch {
          /* ignore */
        }
      }
    }
  }
  if (!lines.length && Array.isArray(fallbackLines) && fallbackLines.length) {
    lines = fallbackLines;
  }
  if (!lines.length) {
    lines = (await all<{ product_id: string; qty: number; price: number }>(
      `SELECT IFNULL(product_id,'') AS product_id, qty, IFNULL(price,0) AS price
       FROM stock_doc_lines WHERE doc_id = ?`,
      [docId]
    )).map((r) => ({
      product_id: String(r.product_id),
      qty: Number(r.qty) || 0,
      price: Number(r.price) || 0,
    }));
  }
  if (!lines.length) return;
  await run(`UPDATE stock_docs SET inbound_baseline_json = ? WHERE id = ?`, [
    JSON.stringify({ lines, saved_at: new Date().toISOString() }),
    docId,
  ]);
}

export async function previewDiscrepancyForInbound(docId: string): Promise<{
  source: string;
  supplier_order_id: string;
  supply_number: string;
  lines: DiscrepancyLine[];
  act: Record<string, unknown> | null;
}> {
  const base = await resolveInboundBaseline(docId);
  const inbound = (await all<{ product_id: string; qty: number; price: number }>(
    `SELECT IFNULL(product_id,'') AS product_id, qty, IFNULL(price,0) AS price
     FROM stock_doc_lines WHERE doc_id = ?`,
    [docId]
  )).map((r) => ({
    product_id: String(r.product_id),
    qty: Number(r.qty) || 0,
    price: Number(r.price) || 0,
  }));
  const diffs = await enrichDiscrepancyLines(compareSupplyVsInbound(base.lines, inbound));
  const act = await get<Record<string, unknown>>(
    `SELECT * FROM purchase_discrepancy_acts WHERE inbound_doc_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`,
    [docId]
  );
  return {
    source: base.source,
    supplier_order_id: base.supplier_order_id,
    supply_number: base.supply_number,
    lines: diffs,
    act: act || null,
  };
}

/** После оприходования: создать/обновить акт, если есть расхождения. */
export async function ensureDiscrepancyAct(docId: string): Promise<{
  created: boolean;
  act: Record<string, unknown> | null;
  lines: DiscrepancyLine[];
}> {
  const preview = await previewDiscrepancyForInbound(docId);
  if (!preview.lines.length) {
    return { created: false, act: preview.act, lines: [] };
  }

  let actId = String((preview.act as { id?: string } | null)?.id || '').trim();
  let created = false;
  if (!actId) {
    actId = newGuid();
    const number = await nextCode('АРЗ', 5);
    await run(
      `INSERT INTO purchase_discrepancy_acts
        (id, number, inbound_doc_id, supplier_order_id, supply_number, status, comment)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      [
        actId,
        number,
        docId,
        preview.supplier_order_id,
        preview.supply_number,
        `Расхождения по приходной · эталон: ${preview.source}`,
      ]
    );
    created = true;
  } else {
    await run(
      `UPDATE purchase_discrepancy_acts
       SET supplier_order_id = ?, supply_number = ?, updated_at = datetime('now'), status = 'open'
       WHERE id = ?`,
      [preview.supplier_order_id, preview.supply_number, actId]
    );
    await run(`DELETE FROM purchase_discrepancy_lines WHERE act_id = ?`, [actId]);
  }

  preview.lines.forEach(async (l, i) => {
    await run(
      `INSERT INTO purchase_discrepancy_lines
        (id, act_id, product_id, kind, qty_supply, qty_inbound, qty_diff, note, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newGuid(),
        actId,
        l.product_id,
        l.kind,
        l.qty_supply,
        l.qty_inbound,
        l.qty_diff,
        l.note,
        i + 1,
      ]
    );
  });

  const act = await get<Record<string, unknown>>(
    `SELECT * FROM purchase_discrepancy_acts WHERE id = ?`,
    [actId]
  );
  return { created, act: act || null, lines: preview.lines };
}

export async function getDiscrepancyAct(actId: string): Promise<{
  act: Record<string, unknown>;
  lines: DiscrepancyLine[];
} | null> {
  const act = await get<Record<string, unknown>>(
    `SELECT * FROM purchase_discrepancy_acts WHERE id = ?`,
    [actId]
  );
  if (!act) return null;
  const rows = await all<{
    product_id: string;
    kind: string;
    qty_supply: number;
    qty_inbound: number;
    qty_diff: number;
    note: string;
  }>(
    `SELECT product_id, kind, qty_supply, qty_inbound, qty_diff, note
     FROM purchase_discrepancy_lines WHERE act_id = ? ORDER BY sort_order, rowid`,
    [actId]
  );
  return {
    act,
    lines: await enrichDiscrepancyLines(
      rows.map((r) => ({
        product_id: String(r.product_id),
        kind: (r.kind as DiscrepancyKind) || 'qty_diff',
        qty_supply: Number(r.qty_supply) || 0,
        qty_inbound: Number(r.qty_inbound) || 0,
        qty_diff: Number(r.qty_diff) || 0,
        note: String(r.note || ''),
      }))
    ),
  };
}

export async function listDiscrepancyActs(limit = 50): Promise<Array<Record<string, unknown>>> {
  return await all<Record<string, unknown>>(
    `SELECT a.*,
            (SELECT COUNT(*) FROM purchase_discrepancy_lines l WHERE l.act_id = a.id) AS lines_count,
            IFNULL(d.number,'') AS inbound_number
     FROM purchase_discrepancy_acts a
     LEFT JOIN stock_docs d ON d.id = a.inbound_doc_id
     ORDER BY datetime(a.created_at) DESC
     LIMIT ?`,
    [Math.min(200, Math.max(1, limit))]
  );
}
