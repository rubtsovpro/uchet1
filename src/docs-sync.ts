/**
 * Импорт приходных/расходных накладных из 1С OData в stock_docs.
 * Остатки склада НЕ трогаем (уже из Get/Rests).
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { odataConfigFromEnv, type OdataConfig } from './odata.js';

const EMPTY = '00000000-0000-0000-0000-000000000000';

const ENT = {
  in: {
    header: 'Document_ПриходнаяНакладная',
    linesNav: 'Запасы',
    docType: 'in' as const,
  },
  out: {
    header: 'Document_РасходнаяНакладная',
    linesNav: 'Запасы',
    docType: 'out' as const,
  },
};

async function odataGet(cfg: OdataConfig, pathAndQuery: string): Promise<unknown> {
  const url = cfg.baseUrl + pathAndQuery.replace(/^\//, '');
  const auth = Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
  const res = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OData HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json();
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

async function fetchHeaders(
  cfg: OdataConfig,
  entity: string,
  pageSize = 200
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let lastNumber = '';
  let guard = 0;
  for (;;) {
    guard += 1;
    if (guard > 300) break;
    const filter = lastNumber
      ? `DeletionMark eq false and Number gt '${lastNumber.replace(/'/g, "''")}'`
      : 'DeletionMark eq false';
    const q =
      `${enc(entity)}?$format=json&$top=${pageSize}&$orderby=Number` +
      `&$select=${enc('Ref_Key,Number,Date,Posted,DeletionMark,Контрагент_Key,СтруктурнаяЕдиница_Key,СуммаДокумента,Комментарий')}` +
      `&$filter=${enc(filter)}`;
    const data = (await odataGet(cfg, q)) as { value?: Record<string, unknown>[] };
    const batch = data.value || [];
    if (!batch.length) break;
    for (const row of batch) {
      const id = String(row.Ref_Key || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(row);
    }
    const next = String(batch[batch.length - 1]?.Number || '');
    if (!next || next === lastNumber) break;
    lastNumber = next;
    if (batch.length < pageSize) break;
    if (guard % 5 === 0) console.log(entity, 'headers', out.length, 'last', lastNumber);
  }
  return out;
}

async function fetchLines(
  cfg: OdataConfig,
  entity: string,
  docId: string,
  nav: string
): Promise<Record<string, unknown>[]> {
  const path = `${enc(entity)}(guid'${docId}')/${enc(nav)}?$format=json`;
  const data = (await odataGet(cfg, path)) as { value?: Record<string, unknown>[] };
  return data.value || [];
}

function ensureWarehouse(id: string): string {
  if (!id || id === EMPTY) {
    const fallback = '00000000-0000-0000-0000-000000000001';
    if (!get('SELECT id FROM warehouses WHERE id = ?', [fallback])) {
      run(
        `INSERT OR IGNORE INTO warehouses (id, name, code, is_active) VALUES (?, 'Склад не указан (1С)', '1C-NONE', 1)`,
        [fallback]
      );
    }
    return fallback;
  }
  if (!get('SELECT id FROM warehouses WHERE id = ?', [id])) {
    run(
      `INSERT OR IGNORE INTO warehouses (id, name, code, is_active) VALUES (?, ?, ?, 1)`,
      [id, `Склад 1С ${id.slice(0, 8)}`, `1C-${id.slice(0, 8)}`]
    );
  }
  return id;
}

function ensureCounterparty(id: string): string | null {
  if (!id || id === EMPTY) return null;
  if (!get('SELECT id FROM counterparties WHERE id = ?', [id])) {
    run(
      `INSERT OR IGNORE INTO counterparties (id, name, inn, phone, kind) VALUES (?, ?, '', '', 'supplier')`,
      [id, `Контрагент 1С ${id.slice(0, 8)}`]
    );
  }
  return id;
}

export type DocsSyncResult = {
  inHeaders: number;
  outHeaders: number;
  inLines: number;
  outLines: number;
  skippedLines: number;
  seconds: number;
};

export async function syncDocsFromOdata(
  kinds: Array<'in' | 'out'> = ['in', 'out']
): Promise<DocsSyncResult> {
  const cfg = odataConfigFromEnv();
  if (!cfg) throw new Error('OData не настроен');
  const t0 = Date.now();
  let inHeaders = 0;
  let outHeaders = 0;
  let inLines = 0;
  let outLines = 0;
  let skippedLines = 0;

  for (const kind of kinds) {
    const spec = ENT[kind];
    console.log('Docs sync', kind, spec.header);
    const headers = await fetchHeaders(cfg, spec.header);
    console.log('Docs headers', kind, headers.length);

    let i = 0;
    for (const h of headers) {
      i += 1;
      const id = String(h.Ref_Key || '');
      if (!id) continue;
      const number = String(h.Number || id).trim();
      const docDate = String(h.Date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
      const wh = ensureWarehouse(String(h['СтруктурнаяЕдиница_Key'] || ''));
      const cp = ensureCounterparty(String(h['Контрагент_Key'] || ''));
      const amount = Number(h['СуммаДокумента'] || 0) || 0;
      const comment = String(h['Комментарий'] || '');
      const posted = h.Posted ? 1 : 0;

      run(
        `INSERT INTO stock_docs
          (id, doc_type, number, doc_date, warehouse_id, warehouse_to_id, counterparty_id, comment, posted, amount, source)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, '1c')
         ON CONFLICT(id) DO UPDATE SET
           number=excluded.number,
           doc_date=excluded.doc_date,
           warehouse_id=excluded.warehouse_id,
           counterparty_id=excluded.counterparty_id,
           comment=excluded.comment,
           posted=excluded.posted,
           amount=excluded.amount,
           source='1c'`,
        [id, spec.docType, number, docDate, wh, cp, comment, posted, amount]
      );
      if (kind === 'in') inHeaders += 1;
      else outHeaders += 1;

      run('DELETE FROM stock_doc_lines WHERE doc_id = ?', [id]);
      let lines: Record<string, unknown>[] = [];
      try {
        lines = await fetchLines(cfg, spec.header, id, spec.linesNav);
      } catch (e) {
        console.warn('lines fail', number, e instanceof Error ? e.message : e);
        continue;
      }
      for (const L of lines) {
        const productId = String(L['Номенклатура_Key'] || '');
        const qty = Number(L['Количество'] || 0);
        if (!productId || productId === EMPTY || !(qty > 0)) {
          skippedLines += 1;
          continue;
        }
        if (!get('SELECT id FROM products WHERE id = ?', [productId])) {
          skippedLines += 1;
          continue;
        }
        const price = Number(L['Цена'] || 0) || 0;
        const lineAmount = Number(L['Сумма'] || L['Всего'] || 0) || price * qty;
        const lineNo = Number(L['LineNumber'] || 0) || 0;
        run(
          `INSERT INTO stock_doc_lines (id, doc_id, product_id, qty, price, amount, line_no)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [newGuid(), id, productId, qty, price, lineAmount, lineNo]
        );
        if (kind === 'in') inLines += 1;
        else outLines += 1;
      }
      if (i % 50 === 0) {
        console.log(`Docs ${kind} ${i}/${headers.length} lines+`, kind === 'in' ? inLines : outLines);
      }
    }
  }

  run(
    `INSERT INTO meta (key, value) VALUES ('docs_synced_at', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [new Date().toISOString()]
  );

  return {
    inHeaders,
    outHeaders,
    inLines,
    outLines,
    skippedLines,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

export function docsSyncMeta() {
  return {
    docs: get<{ c: number }>(`SELECT COUNT(*) AS c FROM stock_docs WHERE source = '1c'`)?.c ?? 0,
    inDocs:
      get<{ c: number }>(`SELECT COUNT(*) AS c FROM stock_docs WHERE source = '1c' AND doc_type = 'in'`)
        ?.c ?? 0,
    outDocs:
      get<{ c: number }>(`SELECT COUNT(*) AS c FROM stock_docs WHERE source = '1c' AND doc_type = 'out'`)
        ?.c ?? 0,
    lines: get<{ c: number }>(`SELECT COUNT(*) AS c FROM stock_doc_lines`)?.c ?? 0,
    lastSync: get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['docs_synced_at'])
      ?.value ?? null,
  };
}

export function listImportedDocs(limit = 200) {
  return all(
    `SELECT d.*, w.name AS warehouse, c.name AS counterparty
     FROM stock_docs d
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     LEFT JOIN counterparties c ON c.id = d.counterparty_id
     ORDER BY d.doc_date DESC, d.number DESC
     LIMIT ?`,
    [limit]
  );
}
