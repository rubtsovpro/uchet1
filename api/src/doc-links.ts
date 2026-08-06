/**
 * Перелинковка складских/продажных документов: продажа ↔ складской,
 * возврат ↔ расходная, приходы/заказы поставщику по номенклатуре строк.
 */
import { all, get } from './db.js';

export type DocLinkKind =
  | 'sale'
  | 'warehouse'
  | 'return_basis'
  | 'inbound_basis'
  | 'supplier_order'
  | 'purchase'
  | 'customer_order'
  | 'related';

export type DocLink = {
  kind: DocLinkKind;
  label: string;
  doc_id: string;
  number: string;
  doc_date: string;
  doc_type: string;
  amount: number;
  counterparty: string;
  comment: string;
  product_name?: string;
  qty?: number;
  price?: number;
};

function isWarehouseComment(comment: string | null | undefined): boolean {
  return String(comment || '').includes('тип:складской');
}

function findStockByNumber(number: string, prefer: 'sale' | 'warehouse' | 'any' = 'any') {
  const num = String(number || '').trim();
  if (!num) return null;
  const rows = all<{
    id: string;
    number: string;
    doc_date: string;
    doc_type: string;
    amount: number;
    comment: string;
    counterparty: string | null;
  }>(
    `SELECT d.id, d.number, d.doc_date, d.doc_type, IFNULL(d.amount,0) AS amount,
            IFNULL(d.comment,'') AS comment, c.name AS counterparty
     FROM stock_docs d
     LEFT JOIN counterparties c ON c.id = d.counterparty_id
     WHERE d.number = ?
     ORDER BY d.doc_date DESC`,
    [num]
  );
  if (!rows.length) return null;
  if (prefer === 'warehouse') {
    return rows.find((r) => isWarehouseComment(r.comment)) || rows[0];
  }
  if (prefer === 'sale') {
    return (
      rows.find((r) => r.doc_type === 'out' && !isWarehouseComment(r.comment)) ||
      rows.find((r) => !isWarehouseComment(r.comment)) ||
      rows[0]
    );
  }
  return rows[0];
}

function pushUnique(out: DocLink[], link: DocLink, seen: Set<string>) {
  const key = `${link.kind}:${link.doc_id}:${link.product_name || ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(link);
}

function linkFromStock(
  kind: DocLinkKind,
  label: string,
  row: {
    id: string;
    number: string;
    doc_date: string;
    doc_type: string;
    amount: number;
    comment: string;
    counterparty: string | null;
  },
  extra?: Partial<DocLink>
): DocLink {
  return {
    kind,
    label,
    doc_id: row.id,
    number: row.number,
    doc_date: String(row.doc_date || '').slice(0, 10),
    doc_type: row.doc_type,
    amount: Number(row.amount) || 0,
    counterparty: row.counterparty || '',
    comment: row.comment || '',
    ...extra,
  };
}

/** Извлечь номера из comment импорта 1С. */
export function parseCommentRefs(comment: string): {
  sale?: string;
  warehouse?: string;
  returnBasis?: string;
  inboundBasis?: string;
  receipts?: string[];
} {
  const c = String(comment || '');
  const sale = c.match(/продажа:([^\s·]+)/)?.[1];
  const warehouse = c.match(/складской:([^\s·]+)/)?.[1];
  const returnBasis = c.match(/на основании расходной:([^\s·]+)/)?.[1];
  const inboundBasis = c.match(/на основании складского:([^\s·]+)/)?.[1];
  const receiptsRaw = c.match(/приходные:([^·]+)/)?.[1] || '';
  const receipts = receiptsRaw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { sale, warehouse, returnBasis, inboundBasis, receipts };
}

export function buildDocLinks(docId: string): { links: DocLink[]; note: string } {
  const doc = get<{
    id: string;
    number: string;
    doc_type: string;
    doc_date: string;
    comment: string;
    amount: number;
    deal_id: string;
    basis_order_id: string;
  }>(
    `SELECT id, number, doc_type, IFNULL(doc_date,'') AS doc_date,
            IFNULL(comment,'') AS comment, IFNULL(amount,0) AS amount,
            IFNULL(deal_id,'') AS deal_id, IFNULL(basis_order_id,'') AS basis_order_id
     FROM stock_docs WHERE id = ?`,
    [docId]
  );
  if (!doc) return { links: [], note: '' };

  const links: DocLink[] = [];
  const seen = new Set<string>();
  const refs = parseCommentRefs(doc.comment);
  const whSelf = isWarehouseComment(doc.comment);

  // Заказ покупателя = сделка Amo (в 1С GUID заказа в OData недоступен как документ)
  const dealId = String(doc.deal_id || '').trim();
  if (dealId) {
    const deal = get<{
      id: string;
      name: string;
      price: number;
      status_name: string;
      updated_at: string;
      buyer_name: string;
      company_name: string;
    }>(
      `SELECT id, IFNULL(name,'') AS name, IFNULL(price,0) AS price,
              IFNULL(status_name,'') AS status_name, IFNULL(updated_at,'') AS updated_at,
              IFNULL(buyer_name,'') AS buyer_name, IFNULL(company_name,'') AS company_name
       FROM crm_deals WHERE id = ?`,
      [dealId]
    );
    pushUnique(
      links,
      {
        kind: 'customer_order',
        label: 'Заказ покупателя',
        doc_id: dealId,
        number: dealId,
        doc_date: String(deal?.updated_at || doc.doc_date || '').slice(0, 10),
        doc_type: 'deal',
        amount: Number(deal?.price) || 0,
        counterparty: (deal?.company_name || deal?.buyer_name || '').trim(),
        comment: deal
          ? [deal.name, deal.status_name].filter(Boolean).join(' · ')
          : doc.basis_order_id
            ? `заказ 1С ${doc.basis_order_id.slice(0, 8)}…`
            : '',
      },
      seen
    );
    const salesByDeal = all<{
      id: string;
      number: string;
      doc_date: string;
      doc_type: string;
      amount: number;
      counterparty_name: string;
    }>(
      `SELECT id, number, IFNULL(doc_date,'') AS doc_date, IFNULL(doc_type,'') AS doc_type,
              IFNULL(amount,0) AS amount, IFNULL(counterparty_name,'') AS counterparty_name
       FROM sales_docs WHERE deal_id = ?
       ORDER BY datetime(created_at) DESC LIMIT 8`,
      [dealId]
    );
    for (const sd of salesByDeal) {
      pushUnique(
        links,
        {
          kind: 'related',
          label: String(sd.doc_type || 'doc').toUpperCase() === 'UPD' ? 'УПД' : 'Документ продажи',
          doc_id: sd.id,
          number: sd.number,
          doc_date: String(sd.doc_date || '').slice(0, 10),
          doc_type: 'sales_doc',
          amount: Number(sd.amount) || 0,
          counterparty: sd.counterparty_name || '',
          comment: `по заказу ${dealId}`,
        },
        seen
      );
    }
  } else if (doc.basis_order_id) {
    pushUnique(
      links,
      {
        kind: 'customer_order',
        label: 'Заказ 1С (без номера Amo)',
        doc_id: doc.basis_order_id,
        number: doc.basis_order_id.slice(0, 8) + '…',
        doc_date: String(doc.doc_date || '').slice(0, 10),
        doc_type: 'basis_order',
        amount: 0,
        counterparty: '',
        comment: 'GUID заказа из 1С — номер сделки CRM в шапке пустой',
      },
      seen
    );
  }

  if (refs.sale) {
    const row = findStockByNumber(refs.sale, 'sale');
    if (row) pushUnique(links, linkFromStock('sale', 'Расходная (продажа)', row), seen);
  }
  if (refs.warehouse) {
    const row = findStockByNumber(refs.warehouse, 'warehouse');
    if (row) pushUnique(links, linkFromStock('warehouse', 'Складской расход', row), seen);
  }
  if (refs.returnBasis) {
    const row = findStockByNumber(refs.returnBasis, 'sale');
    if (row) pushUnique(links, linkFromStock('return_basis', 'Основание — расходная', row), seen);
  }
  if (refs.inboundBasis) {
    const row =
      findStockByNumber(refs.inboundBasis, 'warehouse') ||
      findStockByNumber(refs.inboundBasis, 'any');
    if (row) {
      pushUnique(
        links,
        linkFromStock(
          'inbound_basis',
          row.doc_type === 'in' ? 'Основание — закупка' : 'Основание — складской',
          row
        ),
        seen
      );
    } else {
      pushUnique(
        links,
        {
          kind: 'inbound_basis',
          label: 'Основание — закупка',
          doc_id: '',
          number: refs.inboundBasis,
          doc_date: String(doc.doc_date || '').slice(0, 10),
          doc_type: 'in',
          amount: 0,
          counterparty: '',
          comment: `на основании складского:${refs.inboundBasis}`,
        },
        seen
      );
    }
  }

  // Приход по заказу поставщику (1С док.501)
  if (doc.doc_type === 'in' && String(doc.comment || '').includes('основание:док.501')) {
    const so = get<{
      id: string;
      number: string;
      doc_date: string;
      amount: number;
      counterparty_name: string;
      comment: string;
    }>(
      `SELECT id, number, doc_date, IFNULL(amount,0) AS amount,
              IFNULL(counterparty_name,'') AS counterparty_name,
              IFNULL(comment,'') AS comment
       FROM thin_journal_docs
       WHERE journal_key = 'supplier_orders'
         AND (
           number = ?
           OR comment LIKE ?
           OR comment LIKE ?
         )
       ORDER BY doc_date DESC
       LIMIT 1`,
      [doc.number, `%приходные:${doc.number}%`, `%приходные: ${doc.number}%`]
    );
    pushUnique(
      links,
      so
        ? {
            kind: 'supplier_order',
            label: 'Основание — заказ поставщика',
            doc_id: so.id,
            number: so.number,
            doc_date: String(so.doc_date || '').slice(0, 10),
            doc_type: 'supplier_order',
            amount: Number(so.amount) || 0,
            counterparty: so.counterparty_name || '',
            comment: so.comment || 'основание:док.501',
          }
        : {
            kind: 'supplier_order',
            label: 'Основание — заказ поставщика',
            doc_id: '',
            number: '',
            doc_date: String(doc.doc_date || '').slice(0, 10),
            doc_type: 'supplier_order',
            amount: 0,
            counterparty: '',
            comment: 'основание:док.501',
          },
      seen
    );
  }

  for (const rn of refs.receipts || []) {
    const row = findStockByNumber(rn, 'any');
    if (row) pushUnique(links, linkFromStock('purchase', 'Приход по заказу', row), seen);
  }

  // Обратные ссылки по номеру этого документа в comment других
  const reverse = all<{
    id: string;
    number: string;
    doc_date: string;
    doc_type: string;
    amount: number;
    comment: string;
    counterparty: string | null;
  }>(
    `SELECT d.id, d.number, d.doc_date, d.doc_type, IFNULL(d.amount,0) AS amount,
            IFNULL(d.comment,'') AS comment, c.name AS counterparty
     FROM stock_docs d
     LEFT JOIN counterparties c ON c.id = d.counterparty_id
     WHERE d.id != ?
       AND (
         d.comment LIKE ?
         OR d.comment LIKE ?
         OR d.comment LIKE ?
         OR d.comment LIKE ?
       )
     ORDER BY d.doc_date DESC
     LIMIT 30`,
    [
      docId,
      `%продажа:${doc.number}%`,
      `%складской:${doc.number}%`,
      `%на основании расходной:${doc.number}%`,
      `%на основании складского:${doc.number}%`,
    ]
  );
  for (const row of reverse) {
    let kind: DocLinkKind = 'related';
    let label = 'Связанный документ';
    if (row.comment.includes(`продажа:${doc.number}`)) {
      kind = 'warehouse';
      // В 1С одна отгрузка часто = две расходные: «продажа» + «складской» (списание)
      label = 'Парное складское списание';
    } else if (row.comment.includes(`складской:${doc.number}`)) {
      kind = 'sale';
      label = 'Парная расходная (продажа)';
    } else if (row.comment.includes(`на основании расходной:${doc.number}`)) {
      kind = 'related';
      label = 'Возврат по этой расходной';
    } else if (row.comment.includes(`на основании складского:${doc.number}`)) {
      kind = 'related';
      label = 'Приход/корректировка по складскому';
    }
    pushUnique(links, linkFromStock(kind, label, row), seen);
  }

  // Если это продажа без явного складского в comment — ищем twin по reverse already done.
  // Если складской без продажи — уже из comment.

  // По строкам: приходы с ценой (поставщик) + заказы поставщику
  const lineProducts = all<{ product_id: string; name: string; qty: number }>(
    `SELECT l.product_id, IFNULL(p.name,'') AS name, l.qty
     FROM stock_doc_lines l
     LEFT JOIN products p ON p.id = l.product_id
     WHERE l.doc_id = ? AND IFNULL(l.qty,0) > 0
     LIMIT 40`,
    [docId]
  );

  for (const lp of lineProducts) {
    const purchases = all<{
      id: string;
      number: string;
      doc_date: string;
      doc_type: string;
      amount: number;
      comment: string;
      counterparty: string | null;
      qty: number;
      price: number;
    }>(
      `SELECT d.id, d.number, d.doc_date, d.doc_type, IFNULL(d.amount,0) AS amount,
              IFNULL(d.comment,'') AS comment, c.name AS counterparty,
              l.qty, IFNULL(l.price,0) AS price
       FROM stock_doc_lines l
       JOIN stock_docs d ON d.id = l.doc_id
       LEFT JOIN counterparties c ON c.id = d.counterparty_id
       WHERE l.product_id = ?
         AND d.doc_type = 'in'
         AND IFNULL(l.price,0) > 0
         AND instr(IFNULL(d.comment,''), 'тип:складской приход') = 0
         AND (? = '' OR d.doc_date <= ?)
       ORDER BY d.doc_date DESC
       LIMIT 8`,
      [lp.product_id, String(doc.doc_date || '').slice(0, 10), String(doc.doc_date || '').slice(0, 10)]
    );
    for (const row of purchases) {
      const supplier = (row.counterparty || '').trim() || 'поставщик не указан';
      const byOrder = String(row.comment || '').includes('основание:док.501');
      // Это не «основание текущего документа», а история: товар раньше приходил от поставщика
      const label = byOrder
        ? `Раньше приходил · ${supplier} (по заказу поставщику)`
        : `Раньше приходил · ${supplier}`;
      pushUnique(
        links,
        linkFromStock('purchase', label, row, {
          product_name: lp.name,
          qty: Number(row.qty) || 0,
          price: Number(row.price) || 0,
        }),
        seen
      );

      // Жёсткая связь заказ→приход из тонкого журнала (comment: приходные:НОМЕР)
      const so = get<{
        id: string;
        number: string;
        doc_date: string;
        amount: number;
        counterparty_name: string;
        comment: string;
      }>(
        `SELECT id, number, doc_date, IFNULL(amount,0) AS amount,
                IFNULL(counterparty_name,'') AS counterparty_name,
                IFNULL(comment,'') AS comment
         FROM thin_journal_docs
         WHERE journal_key = 'supplier_orders'
           AND (
             comment LIKE ?
             OR comment LIKE ?
           )
         ORDER BY doc_date DESC
         LIMIT 1`,
        [`%приходные:${row.number}%`, `%приходные: ${row.number}%`]
      );
      if (so) {
        pushUnique(
          links,
          {
            kind: 'supplier_order',
            label: `Заказ поставщику · ${(so.counterparty_name || supplier).trim()}`,
            doc_id: so.id,
            number: so.number,
            doc_date: String(so.doc_date || '').slice(0, 10),
            doc_type: 'supplier_order',
            amount: Number(so.amount) || 0,
            counterparty: so.counterparty_name || supplier,
            comment: so.comment || '',
            product_name: lp.name,
          },
          seen
        );
      }
    }

    const orders = all<{
      id: string;
      number: string;
      doc_date: string;
      amount: number;
      counterparty_name: string;
      comment: string;
    }>(
      `SELECT id, number, doc_date, IFNULL(amount,0) AS amount,
              IFNULL(counterparty_name,'') AS counterparty_name,
              IFNULL(comment,'') AS comment
       FROM thin_journal_docs
       WHERE journal_key = 'supplier_orders'
         AND payload_json LIKE ?
       ORDER BY doc_date DESC
       LIMIT 3`,
      [`%${lp.product_id}%`]
    );
    for (const o of orders) {
      pushUnique(
        links,
        {
          kind: 'supplier_order',
          label: `Заказ · ${(o.counterparty_name || 'поставщик').trim()}`,
          doc_id: o.id,
          number: o.number,
          doc_date: String(o.doc_date || '').slice(0, 10),
          doc_type: 'supplier_order',
          amount: Number(o.amount) || 0,
          counterparty: o.counterparty_name || '',
          comment: o.comment || '',
          product_name: lp.name,
        },
        seen
      );
      const r = parseCommentRefs(o.comment);
      for (const rn of r.receipts || []) {
        const row = findStockByNumber(rn, 'any');
        if (!row) continue;
        // только если в приходе реально есть эта номенклатура с ценой
        const hit = get<{ qty: number; price: number }>(
          `SELECT l.qty, IFNULL(l.price,0) AS price
           FROM stock_doc_lines l
           WHERE l.doc_id = ? AND l.product_id = ? AND IFNULL(l.price,0) > 0
           LIMIT 1`,
          [row.id, lp.product_id]
        );
        if (!hit) continue;
        const supplier = (row.counterparty || o.counterparty_name || 'поставщик').trim();
        pushUnique(
          links,
          linkFromStock(
            'purchase',
            `Приход по заказу ${o.number} · ${supplier}`,
            row,
            {
              product_name: lp.name,
              qty: Number(hit.qty) || 0,
              price: Number(hit.price) || 0,
            }
          ),
          seen
        );
      }
    }
  }

  // Оплаты (bank_docs) с расходной в purpose
  if (doc.doc_type === 'out' && !whSelf) {
    const pays = all<{
      id: string;
      number: string;
      doc_date: string;
      amount: number;
      counterparty: string;
      purpose: string;
    }>(
      `SELECT id, number, doc_date, IFNULL(amount,0) AS amount,
              IFNULL(counterparty,'') AS counterparty, IFNULL(purpose,'') AS purpose
       FROM bank_docs_local
       WHERE source = '1c' AND purpose LIKE ?
       ORDER BY doc_date DESC
       LIMIT 10`,
      [`%расходная:${doc.number}%`]
    );
    for (const p of pays) {
      pushUnique(
        links,
        {
          kind: 'related',
          label: 'Оплата',
          doc_id: p.id,
          number: p.number,
          doc_date: String(p.doc_date || '').slice(0, 10),
          doc_type: 'payment',
          amount: Number(p.amount) || 0,
          counterparty: p.counterparty || '',
          comment: p.purpose || '',
        },
        seen
      );
    }
  }

  const note =
    doc.doc_type === 'return'
      ? 'Возврат: основание (расходная) + откуда товар закупался (поставщик и приходные по артикулу до даты возврата).'
      : doc.doc_type === 'out'
        ? 'Основание расходной — заказ покупателя (раздел «Заказы покупателей»). Также парный складской/продажа и приходы по артикулу.'
        : 'Связи из комментариев 1С и по номенклатуре строк. Партия «эта единица из прихода X» не фиксируется — приходы показаны по артикулу.';

  return { links, note };
}
