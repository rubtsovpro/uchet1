/**
 * Клиентское наименование (КН) для документов продажи.
 * Ключ: контрагент + товар (product_guid, иначе sku).
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';

export type DocClientNameKey = {
  counterpartyId: string;
  productGuid?: string;
  productSku?: string;
};

function normSku(sku: string): string {
  return String(sku || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function docClientNameLookupKey(input: DocClientNameKey): string | null {
  const cp = String(input.counterpartyId || '').trim();
  if (!cp) return null;
  const guid = String(input.productGuid || '').trim();
  if (guid) return `${cp}|g:${guid}`;
  const sku = normSku(String(input.productSku || ''));
  if (sku) return `${cp}|s:${sku}`;
  return null;
}

export function getDocClientName(input: DocClientNameKey): string {
  const cp = String(input.counterpartyId || '').trim();
  if (!cp) return '';
  const guid = String(input.productGuid || '').trim();
  if (guid) {
    const byGuid = get<{ client_name: string }>(
      `SELECT IFNULL(client_name,'') AS client_name
       FROM counterparty_product_doc_names
       WHERE counterparty_id = ? AND product_guid = ?
       LIMIT 1`,
      [cp, guid]
    );
    if (byGuid && String(byGuid.client_name || '').trim()) {
      return String(byGuid.client_name).trim();
    }
  }
  const sku = String(input.productSku || '').trim();
  const skuKey = normSku(sku);
  if (!skuKey) return '';
  const bySku = get<{ client_name: string }>(
    `SELECT IFNULL(client_name,'') AS client_name
     FROM counterparty_product_doc_names
     WHERE counterparty_id = ? AND IFNULL(product_guid,'') = ''
       AND upper(replace(IFNULL(product_sku,''), ' ', '')) = ?
     LIMIT 1`,
    [cp, skuKey]
  );
  return bySku ? String(bySku.client_name || '').trim() : '';
}

/** Карта product_guid|sku → КН для контрагента. */
export function mapDocClientNames(
  counterpartyId: string,
  products: Array<{ product_guid?: string; sku?: string }>
): Record<string, string> {
  const cp = String(counterpartyId || '').trim();
  const out: Record<string, string> = {};
  if (!cp || !products.length) return out;
  const rows = all<{
    product_guid: string;
    product_sku: string;
    client_name: string;
  }>(
    `SELECT IFNULL(product_guid,'') AS product_guid,
            IFNULL(product_sku,'') AS product_sku,
            IFNULL(client_name,'') AS client_name
     FROM counterparty_product_doc_names
     WHERE counterparty_id = ?`,
    [cp]
  );
  const byGuid = new Map<string, string>();
  const bySku = new Map<string, string>();
  for (const row of rows) {
    const name = String(row.client_name || '').trim();
    if (!name) continue;
    const g = String(row.product_guid || '').trim();
    if (g) byGuid.set(g, name);
    const s = normSku(row.product_sku);
    if (s) bySku.set(s, name);
  }
  for (const p of products) {
    const g = String(p.product_guid || '').trim();
    const s = normSku(String(p.sku || ''));
    const name = (g && byGuid.get(g)) || (s && bySku.get(s)) || '';
    if (!name) continue;
    if (g) out[`g:${g}`] = name;
    if (s) out[`s:${s}`] = name;
  }
  return out;
}

export function upsertDocClientName(input: {
  counterpartyId: string;
  productGuid?: string;
  productSku?: string;
  clientName: string;
  updatedBy?: string;
}): { ok: true; client_name: string } | { ok: false; error: string } {
  const cp = String(input.counterpartyId || '').trim();
  if (!cp) return { ok: false, error: 'counterparty_id обязателен' };
  const guid = String(input.productGuid || '').trim();
  const sku = String(input.productSku || '').trim();
  if (!guid && !sku) return { ok: false, error: 'product_guid или sku обязателен' };
  const clientName = String(input.clientName || '').trim();
  const updatedBy = String(input.updatedBy || '').trim();
  const now = new Date().toISOString();

  const existing = guid
    ? get<{ id: string }>(
        `SELECT id FROM counterparty_product_doc_names
         WHERE counterparty_id = ? AND product_guid = ? LIMIT 1`,
        [cp, guid]
      )
    : get<{ id: string }>(
        `SELECT id FROM counterparty_product_doc_names
         WHERE counterparty_id = ? AND IFNULL(product_guid,'') = ''
           AND upper(replace(IFNULL(product_sku,''), ' ', '')) = ?
         LIMIT 1`,
        [cp, normSku(sku)]
      );

  if (!clientName) {
    if (existing?.id) {
      run(`DELETE FROM counterparty_product_doc_names WHERE id = ?`, [existing.id]);
    }
    return { ok: true, client_name: '' };
  }

  if (existing?.id) {
    run(
      `UPDATE counterparty_product_doc_names
       SET client_name = ?, product_sku = CASE WHEN ? != '' THEN ? ELSE product_sku END,
           updated_at = ?, updated_by = ?
       WHERE id = ?`,
      [clientName, sku, sku, now, updatedBy, existing.id]
    );
  } else {
    run(
      `INSERT INTO counterparty_product_doc_names (
         id, counterparty_id, product_guid, product_sku, client_name, updated_at, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newGuid(), cp, guid, sku, clientName, now, updatedBy]
    );
  }
  return { ok: true, client_name: clientName };
}
