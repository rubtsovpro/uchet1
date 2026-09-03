/**
 * КУДиР + упрощённый расчёт УСН + черновик уведомления.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { all, get, run } from '../db.js';
import { newGuid } from '../ids.js';
import { resolveOrganizationId, getOrganization } from '../organizations.js';
import { ensureTaxSchema, orgTaxDir } from './schema.js';
import { getTaxSettings } from './settings.js';

export function rebuildKudir(
  organizationId: string | null | undefined,
  year: number,
  quarter: number
): { income: number; expense: number; lines: number } {
  ensureTaxSchema();
  const oid = resolveOrganizationId(organizationId);
  const startM = (quarter - 1) * 3 + 1;
  const endM = quarter * 3;
  const from = `${year}-${String(startM).padStart(2, '0')}-01`;
  const toDay = new Date(year, endM, 0).getDate();
  const to = `${year}-${String(endM).padStart(2, '0')}-${String(toDay).padStart(2, '0')}`;

  run(
    `DELETE FROM tax_kudir_lines WHERE organization_id=? AND period_year=? AND period_quarter=? AND manual=0 AND section='I'`,
    [oid, year, quarter]
  );

  let line = 0;
  let income = 0;
  let expense = 0;

  // Доходы: продажи / поступления (sales_docs total)
  const sales = all<{ id: string; number: string; doc_date: string; total: number; name: string }>(
    `SELECT s.id, s.number, s.doc_date, s.total, IFNULL(c.name,'') AS name
     FROM sales_docs s
     LEFT JOIN counterparties c ON c.id = s.counterparty_id
     WHERE s.organization_id = ?
       AND s.doc_date >= ? AND s.doc_date <= ?
       AND s.doc_type IN ('upd','sf','invoice','act')
       AND IFNULL(s.status,'') NOT IN ('cancelled','void')
     ORDER BY s.doc_date`,
    [oid, from, to]
  );
  for (const d of sales) {
    const amt = Number(d.total) || 0;
    if (amt <= 0) continue;
    line += 1;
    income += amt;
    run(
      `INSERT INTO tax_kudir_lines (
         id, organization_id, period_year, period_quarter, section, line_no, op_date, doc_no, content, income, source_ref
       ) VALUES (?,?,?,?, 'I', ?,?,?,?,?,?)`,
      [
        newGuid(),
        oid,
        year,
        quarter,
        line,
        d.doc_date,
        d.number,
        `Реализация · ${d.name || d.number}`,
        amt,
        `sales:${d.id}`,
      ]
    );
  }

  // Расходы: приходы склада (для УСН доходы-расходы)
  const settings = getTaxSettings(oid);
  if (settings.tax_system === 'usn_income_expense') {
    const purch = all<{ id: string; number: string; doc_date: string; amount: number; name: string }>(
      `SELECT d.id, d.number, d.doc_date, IFNULL(d.amount,0) AS amount, IFNULL(c.name,'') AS name
       FROM stock_docs d
       LEFT JOIN counterparties c ON c.id = d.counterparty_id
       WHERE d.doc_type='in' AND d.doc_date >= ? AND d.doc_date <= ?
         AND IFNULL(d.organization_id,'') IN ('', ?)
       ORDER BY d.doc_date`,
      [from, to, oid]
    );
    for (const d of purch) {
      const amt = Number(d.amount) || 0;
      if (amt <= 0) continue;
      line += 1;
      expense += amt;
      run(
        `INSERT INTO tax_kudir_lines (
           id, organization_id, period_year, period_quarter, section, line_no, op_date, doc_no, content, expense, source_ref
         ) VALUES (?,?,?,?, 'I', ?,?,?,?,?,?)`,
        [
          newGuid(),
          oid,
          year,
          quarter,
          line,
          d.doc_date,
          d.number,
          `Закупка · ${d.name || d.number}`,
          amt,
          `stock:${d.id}`,
        ]
      );
    }
  }

  return {
    income: Math.round(income * 100) / 100,
    expense: Math.round(expense * 100) / 100,
    lines: line,
  };
}

export function kudirSummary(organizationId: string | null | undefined, year: number, quarter: number) {
  ensureTaxSchema();
  const oid = resolveOrganizationId(organizationId);
  const row = get<{ income: number; expense: number; fee: number; c: number }>(
    `SELECT IFNULL(SUM(income),0) AS income, IFNULL(SUM(expense),0) AS expense,
            IFNULL(SUM(trade_fee),0) AS fee, COUNT(*) AS c
     FROM tax_kudir_lines WHERE organization_id=? AND period_year=? AND period_quarter=?`,
    [oid, year, quarter]
  );
  const settings = getTaxSettings(oid);
  const income = Number(row?.income) || 0;
  const expense = Number(row?.expense) || 0;
  const base =
    settings.tax_system === 'usn_income_expense' ? Math.max(0, income - expense) : income;
  const tax = Math.round(base * (Number(settings.usn_rate) || 6) / 100 * 100) / 100;
  return {
    lines: Number(row?.c) || 0,
    income,
    expense,
    trade_fee: Number(row?.fee) || 0,
    tax_base: base,
    usn_rate: settings.usn_rate,
    usn_tax: tax,
  };
}

export function listKudir(organizationId: string | null | undefined, year: number, quarter: number) {
  const oid = resolveOrganizationId(organizationId);
  return all(
    `SELECT * FROM tax_kudir_lines WHERE organization_id=? AND period_year=? AND period_quarter=? ORDER BY line_no`,
    [oid, year, quarter]
  );
}

export function buildUsnReport(
  organizationId: string | null | undefined,
  year: number,
  quarter: number
): { report_id: string; xml_path: string; amount: number } {
  ensureTaxSchema();
  const oid = resolveOrganizationId(organizationId);
  rebuildKudir(oid, year, quarter);
  const sum = kudirSummary(oid, year, quarter);
  const org = getOrganization(oid);
  const settings = getTaxSettings(oid);
  const dir = orgTaxDir(oid, `${year}-Q${quarter}`);
  const xmlPath = path.join(dir, `USN_${year}_Q${quarter}.xml`);
  const xml = `<?xml version="1.0" encoding="windows-1251"?>
<!-- WMS draft УСН ${year} Q${quarter} -->
<Файл ВерсПрог="Uchet1">
  <Документ>
    <СвНП ИНН="${org?.inn || ''}" Наим="${escapeXml(org?.name || '')}" />
    <УСН Ставка="${settings.usn_rate}" Доход="${sum.income.toFixed(2)}" Расход="${sum.expense.toFixed(2)}"
         База="${sum.tax_base.toFixed(2)}" Налог="${sum.usn_tax.toFixed(2)}" />
  </Документ>
</Файл>
`;
  writeFileSync(xmlPath, xml, 'utf8');
  const id = newGuid();
  run(
    `INSERT INTO tax_reports (id, organization_id, report_type, period_year, period_quarter, status, amount, xml_path, meta_json, built_at)
     VALUES (?,?,?,?,?,'ready',?,?,?, datetime('now'))`,
    [id, oid, quarter === 4 ? 'USN' : 'USN_ADV', year, quarter, sum.usn_tax, xmlPath, JSON.stringify(sum)]
  );
  return { report_id: id, xml_path: xmlPath, amount: sum.usn_tax };
}

export function buildTaxNotice(
  organizationId: string | null | undefined,
  year: number,
  month: number
): { report_id: string; xml_path: string; amount: number } {
  ensureTaxSchema();
  const oid = resolveOrganizationId(organizationId);
  const q = Math.ceil(month / 3);
  const sum = kudirSummary(oid, year, q);
  const org = getOrganization(oid);
  const dir = orgTaxDir(oid, `${year}-${String(month).padStart(2, '0')}`);
  const xmlPath = path.join(dir, `NOTICE_${year}_${String(month).padStart(2, '0')}.xml`);
  const amount = sum.usn_tax;
  writeFileSync(
    xmlPath,
    `<?xml version="1.0" encoding="windows-1251"?>
<!-- Уведомление об исчисленных суммах · ${month}.${year} -->
<Уведомление ИНН="${org?.inn || ''}" Период="${month}.${year}" Сумма="${amount.toFixed(2)}" КБК="18210501011011000110" />
`,
    'utf8'
  );
  const id = newGuid();
  run(
    `INSERT INTO tax_reports (id, organization_id, report_type, period_year, period_month, period_quarter, status, amount, xml_path, built_at)
     VALUES (?,?,?,?,?,?, 'ready', ?, ?, datetime('now'))`,
    [id, oid, 'NOTICE', year, month, q, amount, xmlPath]
  );
  return { report_id: id, xml_path: xmlPath, amount };
}

function escapeXml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
