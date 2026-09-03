/**
 * Книги НДС из sales_docs (upd/sf) + черновик XML декларации.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { all, get, run } from '../db.js';
import { newGuid } from '../ids.js';
import { resolveOrganizationId, getOrganization } from '../organizations.js';
import { ensureTaxSchema, orgTaxDir } from './schema.js';
import { getTaxSettings } from './settings.js';

function quarterOf(dateStr: string): { year: number; quarter: number } {
  const d = String(dateStr || '').slice(0, 10);
  const y = Number(d.slice(0, 4)) || new Date().getFullYear();
  const m = Number(d.slice(5, 7)) || 1;
  return { year: y, quarter: Math.ceil(m / 3) };
}

export function rebuildVatBooks(
  organizationId: string | null | undefined,
  year: number,
  quarter: number
): { sales: number; purchases: number } {
  ensureTaxSchema();
  const oid = resolveOrganizationId(organizationId);
  const startM = (quarter - 1) * 3 + 1;
  const endM = quarter * 3;
  const from = `${year}-${String(startM).padStart(2, '0')}-01`;
  const toDay = new Date(year, endM, 0).getDate();
  const to = `${year}-${String(endM).padStart(2, '0')}-${String(toDay).padStart(2, '0')}`;

  run(
    `DELETE FROM tax_vat_ledger_sales WHERE organization_id=? AND period_year=? AND period_quarter=? AND manual=0`,
    [oid, year, quarter]
  );
  run(
    `DELETE FROM tax_vat_ledger_purchases WHERE organization_id=? AND period_year=? AND period_quarter=? AND manual=0`,
    [oid, year, quarter]
  );

  const salesDocs = all<{
    id: string;
    doc_type: string;
    number: string;
    doc_date: string;
    amount: number;
    vat_amount: number;
    total: number;
    vat_rate: number;
    cp_name: string;
    cp_inn: string;
  }>(
    `SELECT s.id, s.doc_type, s.number, s.doc_date, s.amount, s.vat_amount, s.total, s.vat_rate,
            IFNULL(c.name,'') AS cp_name, IFNULL(c.inn,'') AS cp_inn
     FROM sales_docs s
     LEFT JOIN counterparties c ON c.id = s.counterparty_id
     WHERE s.organization_id = ?
       AND s.doc_type IN ('upd','sf','invoice')
       AND s.doc_date >= ? AND s.doc_date <= ?
       AND IFNULL(s.status,'') NOT IN ('cancelled','void')
     ORDER BY s.doc_date, s.number`,
    [oid, from, to]
  );

  let line = 0;
  for (const d of salesDocs) {
    line += 1;
    run(
      `INSERT INTO tax_vat_ledger_sales (
         id, organization_id, period_year, period_quarter, line_no, op_date, invoice_no, invoice_date,
         buyer_name, buyer_inn, amount_wo_vat, vat_amount, total, vat_rate, source_doc_id, source_doc_type
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        newGuid(),
        oid,
        year,
        quarter,
        line,
        d.doc_date,
        d.number,
        d.doc_date,
        d.cp_name,
        d.cp_inn,
        Number(d.amount) || 0,
        Number(d.vat_amount) || 0,
        Number(d.total) || 0,
        Number(d.vat_rate) || 20,
        d.id,
        d.doc_type,
      ]
    );
  }

  // Закупки: приходные stock_docs in с суммой (если есть) — упрощённо
  const purch = all<{
    id: string;
    number: string;
    doc_date: string;
    amount: number;
    cp_name: string;
    cp_inn: string;
  }>(
    `SELECT d.id, d.number, d.doc_date, IFNULL(d.amount,0) AS amount,
            IFNULL(c.name,'') AS cp_name, IFNULL(c.inn,'') AS cp_inn
     FROM stock_docs d
     LEFT JOIN counterparties c ON c.id = d.counterparty_id
     WHERE d.doc_type = 'in'
       AND IFNULL(d.organization_id,'') IN ('', ?)
       AND d.doc_date >= ? AND d.doc_date <= ?
     ORDER BY d.doc_date, d.number`,
    [oid, from, to]
  );
  const settings = getTaxSettings(oid);
  let pl = 0;
  for (const d of purch) {
    const total = Number(d.amount) || 0;
    if (total <= 0) continue;
    const rate = settings.vat_rate || 20;
    const amount = Math.round((total / (1 + rate / 100)) * 100) / 100;
    const vat = Math.round((total - amount) * 100) / 100;
    pl += 1;
    run(
      `INSERT INTO tax_vat_ledger_purchases (
         id, organization_id, period_year, period_quarter, line_no, op_date, invoice_no, invoice_date,
         seller_name, seller_inn, amount_wo_vat, vat_amount, total, vat_rate, source_doc_id, source_doc_type
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        newGuid(),
        oid,
        year,
        quarter,
        pl,
        d.doc_date,
        d.number,
        d.doc_date,
        d.cp_name,
        d.cp_inn,
        amount,
        vat,
        total,
        rate,
        d.id,
        'in',
      ]
    );
  }

  return { sales: line, purchases: pl };
}

export function vatBooksSummary(organizationId: string | null | undefined, year: number, quarter: number) {
  ensureTaxSchema();
  const oid = resolveOrganizationId(organizationId);
  const sales = get<{ c: number; vat: number; total: number }>(
    `SELECT COUNT(*) AS c, IFNULL(SUM(vat_amount),0) AS vat, IFNULL(SUM(total),0) AS total
     FROM tax_vat_ledger_sales WHERE organization_id=? AND period_year=? AND period_quarter=?`,
    [oid, year, quarter]
  );
  const purch = get<{ c: number; vat: number; total: number }>(
    `SELECT COUNT(*) AS c, IFNULL(SUM(vat_amount),0) AS vat, IFNULL(SUM(total),0) AS total
     FROM tax_vat_ledger_purchases WHERE organization_id=? AND period_year=? AND period_quarter=?`,
    [oid, year, quarter]
  );
  const outVat = Number(sales?.vat) || 0;
  const inVat = Number(purch?.vat) || 0;
  return {
    sales_lines: Number(sales?.c) || 0,
    sales_vat: outVat,
    sales_total: Number(sales?.total) || 0,
    purchase_lines: Number(purch?.c) || 0,
    purchase_vat: inVat,
    purchase_total: Number(purch?.total) || 0,
    vat_payable: Math.round((outVat - inVat) * 100) / 100,
  };
}

export function listVatSales(organizationId: string | null | undefined, year: number, quarter: number) {
  const oid = resolveOrganizationId(organizationId);
  return all(`SELECT * FROM tax_vat_ledger_sales WHERE organization_id=? AND period_year=? AND period_quarter=? ORDER BY line_no`, [
    oid,
    year,
    quarter,
  ]);
}

export function listVatPurchases(
  organizationId: string | null | undefined,
  year: number,
  quarter: number
) {
  const oid = resolveOrganizationId(organizationId);
  return all(
    `SELECT * FROM tax_vat_ledger_purchases WHERE organization_id=? AND period_year=? AND period_quarter=? ORDER BY line_no`,
    [oid, year, quarter]
  );
}

/** Упрощённый XML-черновик декларации НДС (не финальный формат ФНС — каркас под Kontur). */
export function buildVatDeclarationXml(
  organizationId: string | null | undefined,
  year: number,
  quarter: number
): { report_id: string; xml_path: string; amount: number } {
  ensureTaxSchema();
  const oid = resolveOrganizationId(organizationId);
  rebuildVatBooks(oid, year, quarter);
  const sum = vatBooksSummary(oid, year, quarter);
  const org = getOrganization(oid);
  const settings = getTaxSettings(oid);
  const dir = orgTaxDir(oid, `${year}-Q${quarter}`);
  mkdirSync(dir, { recursive: true });
  const fname = `NDS_${year}_Q${quarter}.xml`;
  const xmlPath = path.join(dir, fname);
  const xml = `<?xml version="1.0" encoding="windows-1251"?>
<!-- WMS tax draft · НДС ${year} Q${quarter} · не финальный XSD ФНС; для Check в Контуре заменить на актуальный формат -->
<Файл ИдФайл="NO_NDS_${year}_${quarter}_${org?.inn || ''}" ВерсФорм="5.11" ВерсПрог="Uchet1">
  <Документ>
    <СвНП>
      <НПИП ИННФЛ="${org?.inn || ''}" />
      <СвНаим НаимОрг="${escapeXml(org?.name || '')}" />
    </СвНП>
    <СвПредст КодНО="${settings.ifns_code || '0000'}" />
    <НДС>
      <КнигаПродаж СумНДС="${sum.sales_vat.toFixed(2)}" Сумма="${sum.sales_total.toFixed(2)}" Строк="${sum.sales_lines}" />
      <КнигаПокупок СумНДС="${sum.purchase_vat.toFixed(2)}" Сумма="${sum.purchase_total.toFixed(2)}" Строк="${sum.purchase_lines}" />
      <КУплате СумНДС="${sum.vat_payable.toFixed(2)}" />
    </НДС>
  </Документ>
</Файл>
`;
  writeFileSync(xmlPath, xml, 'utf8');
  const reportId = newGuid();
  run(
    `INSERT INTO tax_reports (
       id, organization_id, report_type, period_year, period_quarter, status, amount, xml_path, meta_json, built_at
     ) VALUES (?,?,?,?,?,'ready',?,?,?, datetime('now'))`,
    [
      reportId,
      oid,
      'NDS',
      year,
      quarter,
      sum.vat_payable,
      path.relative(orgTaxDir(oid, ''), xmlPath).replace(/^\.\.\//, '') || fname,
      JSON.stringify(sum),
    ]
  );
  // store absolute-ish path under org dir
  run(`UPDATE tax_reports SET xml_path=? WHERE id=?`, [xmlPath, reportId]);
  return { report_id: reportId, xml_path: xmlPath, amount: sum.vat_payable };
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { quarterOf };
