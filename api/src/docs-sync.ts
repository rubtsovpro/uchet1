/**
 * Импорт приходных/расходных накладных из 1С OData в stock_docs.
 * Остатки склада НЕ трогаем (уже из Get/Rests).
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import { odataConfigFromEnv, type OdataConfig } from './odata.js';
import { upsertGtdFromSync } from './menu-parity.js';
import { isServiceProduct } from './stock.js';

const EMPTY = '00000000-0000-0000-0000-000000000000';

/** Кастомное поле УНФ: номер сделки AmoCRM на расходной. */
const CRM_DEAL_FIELD = 'РашPSGдляУнФ_НомерСделкиСРМ';

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

function isEmptyGuid(id: string): boolean {
  return !id || id === EMPTY;
}

/** Разобрать заказ покупателя + сделку Amo из шапки OData. */
export function parseOutBasisFromOdata(h: Record<string, unknown>): {
  deal_id: string;
  basis_order_id: string;
} {
  const orderRaw = String(h['Заказ'] || '').trim();
  const basis_order_id = isEmptyGuid(orderRaw) ? '' : orderRaw;
  const deal_id = String(h[CRM_DEAL_FIELD] || '')
    .trim()
    .replace(/\D/g, '');
  return { deal_id, basis_order_id };
}

/** Не затирать локальные метки складской↔продажа, если в 1С комментарий пустой. */
function mergeDocComment(local: string | null | undefined, from1c: string): string {
  const a = String(local || '').trim();
  const b = String(from1c || '').trim();
  if (!b) return a;
  if (!a) return b;
  return b;
}

/** Не блокируем HTTP/статику на время длинного импорта документов. */
function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

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
    const select =
      entity === ENT.out.header
        ? `Ref_Key,Number,Date,Posted,DeletionMark,Контрагент_Key,СтруктурнаяЕдиница_Key,СуммаДокумента,Комментарий,Заказ,${CRM_DEAL_FIELD}`
        : 'Ref_Key,Number,Date,Posted,DeletionMark,Контрагент_Key,СтруктурнаяЕдиница_Key,СуммаДокумента,Комментарий';
    const q =
      `${enc(entity)}?$format=json&$top=${pageSize}&$orderby=Number` +
      `&$select=${enc(select)}` +
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
      const prev = get<{ comment: string }>('SELECT IFNULL(comment,\'\') AS comment FROM stock_docs WHERE id = ?', [
        id,
      ]);
      const comment = mergeDocComment(prev?.comment, String(h['Комментарий'] || ''));
      const posted = h.Posted ? 1 : 0;
      const basis =
        kind === 'out' ? parseOutBasisFromOdata(h) : { deal_id: '', basis_order_id: '' };

      run(
        `INSERT INTO stock_docs
          (id, doc_type, number, doc_date, warehouse_id, warehouse_to_id, counterparty_id, comment, posted, amount, source, deal_id, basis_order_id)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, '1c', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           number=excluded.number,
           doc_date=excluded.doc_date,
           warehouse_id=excluded.warehouse_id,
           counterparty_id=excluded.counterparty_id,
           comment=excluded.comment,
           posted=excluded.posted,
           amount=excluded.amount,
           source='1c',
           deal_id=CASE
             WHEN excluded.deal_id != '' THEN excluded.deal_id
             ELSE IFNULL(stock_docs.deal_id, '')
           END,
           basis_order_id=CASE
             WHEN excluded.basis_order_id != '' THEN excluded.basis_order_id
             ELSE IFNULL(stock_docs.basis_order_id, '')
           END`,
        [
          id,
          spec.docType,
          number,
          docDate,
          wh,
          cp,
          comment,
          posted,
          amount,
          basis.deal_id,
          basis.basis_order_id,
        ]
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
        // Расходные — только товары; услуги остаются в заказах / УПД
        if (kind === 'out' && isServiceProduct(productId)) {
          skippedLines += 1;
          continue;
        }
        const price = Number(L['Цена'] || 0) || 0;
        const lineAmount = Number(L['Сумма'] || L['Всего'] || 0) || price * qty;
        const lineNo = Number(L['LineNumber'] || 0) || 0;
        const gtdKey = String(L['НомерГТД_Key'] || '');
        const countryKey = String(L['СтранаПроисхождения_Key'] || '');
        let gtdCode = '';
        if (gtdKey && gtdKey !== EMPTY) {
          // Catalog_НомераГТД в OData не опубликован — храним ключ + локальный код.
          upsertGtdFromSync(gtdKey);
          const g = get<{ code: string }>('SELECT code FROM gtd_numbers WHERE id = ?', [gtdKey]);
          gtdCode = g?.code || gtdKey.slice(0, 8);
        }
        run(
          `INSERT INTO stock_doc_lines
            (id, doc_id, product_id, qty, price, amount, line_no, gtd_key, gtd_code, country_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newGuid(),
            id,
            productId,
            qty,
            price,
            lineAmount,
            lineNo,
            gtdKey && gtdKey !== EMPTY ? gtdKey : '',
            gtdCode,
            countryKey && countryKey !== EMPTY ? countryKey : '',
          ]
        );
        if (kind === 'in') inLines += 1;
        else outLines += 1;
      }
      // После sync-SQLite отдаём event loop — иначе UI/legacy.js/api зависают на минуты.
      if (i % 5 === 0) await yieldEventLoop();
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

function saveOutBasis(
  docId: string,
  dealId: string,
  basisOrderId: string
): { deal_id: string; basis_order_id: string } {
  const deal = String(dealId || '').trim();
  const basis = String(basisOrderId || '').trim() || deal;
  run(`UPDATE stock_docs SET deal_id = ?, basis_order_id = ? WHERE id = ?`, [
    deal,
    basis,
    docId,
  ]);
  return { deal_id: deal, basis_order_id: basis };
}

/** Достать номер сделки Amo / заказ из комментария или связанных УПД/марок. */
export function recoverOutDealLocally(
  docId: string,
  commentRaw: string
): { deal_id: string; basis_order_id: string; from: 'comment' | 'upd' | 'serial' | 'sales' } | null {
  const comment = String(commentRaw || '');

  const fromComment =
    comment.match(/сделк[аи]\s*[№#:.]?\s*(\d{3,})/i)?.[1] ||
    comment.match(/deal[_\s-]?id\s*[:=]?\s*(\d{3,})/i)?.[1] ||
    '';
  if (fromComment) {
    return { deal_id: fromComment, basis_order_id: fromComment, from: 'comment' };
  }

  const updNum = comment.match(/УПД\s+([0-9A-Za-zА-Яа-я.\-]+)/i)?.[1]?.trim() || '';
  if (updNum) {
    const sd = get<{ deal_id: string }>(
      `SELECT IFNULL(deal_id,'') AS deal_id FROM sales_docs
       WHERE number = ? AND IFNULL(deal_id,'') != '' LIMIT 1`,
      [updNum]
    );
    if (sd?.deal_id) {
      return { deal_id: sd.deal_id, basis_order_id: sd.deal_id, from: 'upd' };
    }
  }

  // УПД/СФ по этому stock_doc в комментарии sales_docs или по номеру расходной
  const doc = get<{ number: string }>(`SELECT IFNULL(number,'') AS number FROM stock_docs WHERE id = ?`, [
    docId,
  ]);
  const docNum = String(doc?.number || '').trim();
  if (docNum) {
    const bySales = get<{ deal_id: string }>(
      `SELECT IFNULL(deal_id,'') AS deal_id FROM sales_docs
       WHERE IFNULL(deal_id,'') != ''
         AND (comment LIKE ? OR comment LIKE ?)
       ORDER BY datetime(created_at) DESC LIMIT 1`,
      [`%${docNum}%`, `%расходн%${docNum}%`]
    );
    if (bySales?.deal_id) {
      return { deal_id: bySales.deal_id, basis_order_id: bySales.deal_id, from: 'sales' };
    }
  }

  // Марки в строках расхода ↔ позиции заказа покупателя
  const lineSerialJson = all<{ serials_json: string }>(
    `SELECT IFNULL(serials_json,'[]') AS serials_json FROM stock_doc_lines WHERE doc_id = ?`,
    [docId]
  );
  const serials = new Set<string>();
  for (const row of lineSerialJson) {
    try {
      const arr = JSON.parse(String(row.serials_json || '[]')) as unknown[];
      if (Array.isArray(arr)) {
        for (const s of arr) {
          const v = String(s || '').trim();
          if (v) serials.add(v);
        }
      }
    } catch {
      /* ignore */
    }
  }
  const unitSerials = all<{ serial: string }>(
    `SELECT IFNULL(serial,'') AS serial FROM product_units
     WHERE out_doc_id = ? AND IFNULL(serial,'') != '' LIMIT 80`,
    [docId]
  );
  for (const u of unitSerials) {
    if (u.serial) serials.add(u.serial);
  }
  for (const serial of serials) {
    const hit = get<{ deal_id: string }>(
      `SELECT deal_id FROM crm_deal_items
       WHERE IFNULL(serials_json,'') LIKE ? ESCAPE '\\'
       LIMIT 1`,
      [`%${serial.replace(/[%_\\]/g, (ch) => '\\' + ch)}%`]
    );
    if (hit?.deal_id) {
      return { deal_id: String(hit.deal_id), basis_order_id: String(hit.deal_id), from: 'serial' };
    }
  }

  return null;
}

/**
 * Подтянуть основание расходной (заказ GUID + сделка Amo) из OData для одной карточки.
 * Нужно для уже импортированных документов без полного re-sync.
 * Для складского расхода — наследует сделку с парной продажи.
 * Также: комментарий «сделка N», УПД, марки на позициях заказа.
 */
export async function enrichOutDocBasis(docId: string): Promise<{
  deal_id: string;
  basis_order_id: string;
  from: 'self' | 'sale' | 'cached' | 'comment' | 'upd' | 'serial' | 'sales' | 'none';
}> {
  const doc = get<{
    id: string;
    doc_type: string;
    source: string;
    comment: string;
    deal_id: string;
    basis_order_id: string;
  }>(
    `SELECT id, doc_type, IFNULL(source,'') AS source, IFNULL(comment,'') AS comment,
            IFNULL(deal_id,'') AS deal_id, IFNULL(basis_order_id,'') AS basis_order_id
     FROM stock_docs WHERE id = ?`,
    [docId]
  );
  if (!doc || doc.doc_type !== 'out') {
    return { deal_id: '', basis_order_id: '', from: 'none' };
  }
  // Уже есть номер сделки Amo — готово (basis_order_id без deal не считаем «готово»)
  if (doc.deal_id) {
    return { deal_id: doc.deal_id, basis_order_id: doc.basis_order_id, from: 'cached' };
  }

  const local = recoverOutDealLocally(docId, doc.comment);
  if (local?.deal_id) {
    const saved = saveOutBasis(docId, local.deal_id, local.basis_order_id || doc.basis_order_id);
    return { ...saved, from: local.from };
  }

  const cfg = odataConfigFromEnv();
  if (cfg && doc.source === '1c') {
    try {
      const path =
        `${encodeURIComponent(ENT.out.header)}(guid'${docId}')?$format=json` +
        `&$select=${encodeURIComponent(`Number,Заказ,${CRM_DEAL_FIELD}`)}`;
      const h = (await odataGet(cfg, path)) as Record<string, unknown>;
      const basis = parseOutBasisFromOdata(h);
      if (basis.deal_id || basis.basis_order_id) {
        const saved = saveOutBasis(
          docId,
          basis.deal_id || doc.deal_id,
          basis.basis_order_id || doc.basis_order_id
        );
        return { ...saved, from: 'self' };
      }
    } catch (e) {
      console.warn(
        'enrichOutDocBasis odata',
        docId,
        e instanceof Error ? e.message : e
      );
    }
  }

  // Складской: взять сделку с парной продажи
  const saleNum = String(doc.comment || '').match(/продажа:([^\s·]+)/)?.[1];
  if (saleNum) {
    const sale = get<{ id: string; deal_id: string; basis_order_id: string }>(
      `SELECT id, IFNULL(deal_id,'') AS deal_id, IFNULL(basis_order_id,'') AS basis_order_id
       FROM stock_docs
       WHERE number = ? AND doc_type = 'out'
         AND instr(IFNULL(comment,''), 'тип:складской') = 0
       ORDER BY doc_date DESC LIMIT 1`,
      [saleNum]
    );
    if (sale && !sale.deal_id) {
      await enrichOutDocBasis(sale.id);
      const again = get<{ deal_id: string; basis_order_id: string }>(
        `SELECT IFNULL(deal_id,'') AS deal_id, IFNULL(basis_order_id,'') AS basis_order_id
         FROM stock_docs WHERE id = ?`,
        [sale.id]
      );
      if (again?.deal_id) {
        const saved = saveOutBasis(docId, again.deal_id, again.basis_order_id || doc.basis_order_id);
        return { ...saved, from: 'sale' };
      }
    } else if (sale?.deal_id) {
      const saved = saveOutBasis(docId, sale.deal_id, sale.basis_order_id || doc.basis_order_id);
      return { ...saved, from: 'sale' };
    }
  }

  // Остался только GUID заказа 1С без номера Amo
  if (doc.basis_order_id) {
    return { deal_id: '', basis_order_id: doc.basis_order_id, from: 'cached' };
  }

  return { deal_id: '', basis_order_id: '', from: 'none' };
}

/** Ручная привязка заказа покупателя (сделки) к расходной. */
export function setOutDocDeal(
  docId: string,
  dealIdRaw: string
): { ok: true; deal_id: string; basis_order_id: string } {
  const id = String(docId || '').trim();
  const dealId = String(dealIdRaw || '')
    .trim()
    .replace(/\D/g, '');
  if (!id) throw new Error('doc_id required');
  if (!dealId) throw new Error('Укажите номер заказа покупателя (сделки Amo)');
  const doc = get<{ doc_type: string }>(`SELECT doc_type FROM stock_docs WHERE id = ?`, [id]);
  if (!doc) throw new Error('Документ не найден');
  if (doc.doc_type !== 'out') throw new Error('Привязка заказа — только для расходной');
  const saved = saveOutBasis(id, dealId, dealId);
  return { ok: true, ...saved };
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

/** Какие документы цепочки заказа доступны в OData (сейчас обычно только расходная). */
export async function probeOrderChainOdata(): Promise<{
  available: string[];
  missing: string[];
  note: string;
}> {
  const cfg = odataConfigFromEnv();
  const wanted = [
    'Document_ЗаказПокупателя',
    'Document_ЗаказНаПеремещение',
    'Document_ПеремещениеЗапасов',
    'Document_ОперацияПоПлатежнымКартам',
    'Document_ОперацияПоПлатежнойКарте',
    'Document_РасходнаяНакладная',
  ];
  if (!cfg) {
    return {
      available: [],
      missing: wanted,
      note: 'OData не настроен',
    };
  }
  const available: string[] = [];
  const missing: string[] = [];
  for (const name of wanted) {
    try {
      await odataGet(cfg, `${enc(name)}?$format=json&$top=1&$select=Ref_Key`);
      available.push(name);
    } catch {
      missing.push(name);
    }
  }
  return {
    available,
    missing,
    note:
      missing.length > 1
        ? 'В публикации OData нет заказа/перемещений/карт — цепочка ведётся в Учёте №1. Расходные синхронизируются.'
        : 'Все сущности цепочки доступны в OData.',
  };
}
