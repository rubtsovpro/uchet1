/**
 * Зарплатная отчётность: черновики XML 6‑НДФЛ / РСВ / ЕФС‑1 / перс.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { all, get, run } from '../db.js';
import { newGuid } from '../ids.js';
import { resolveOrganizationId, getOrganization } from '../organizations.js';
import { ensureTaxSchema, orgTaxDir } from './schema.js';
import { getPayrollRun } from './payroll.js';

function escapeXml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function runsForQuarter(oid: string, year: number, quarter: number) {
  const m0 = (quarter - 1) * 3 + 1;
  const months = [m0, m0 + 1, m0 + 2];
  return all<{ id: string; month: number; accrued_total: number; ndfl_total: number; contrib_total: number }>(
    `SELECT id, month, accrued_total, ndfl_total, contrib_total FROM payroll_runs
     WHERE organization_id=? AND year=? AND month IN (?,?,?) AND status IN ('draft','posted')
     ORDER BY month`,
    [oid, year, months[0], months[1], months[2]]
  );
}

export function buildPayrollReportXml(
  organizationId: string | null | undefined,
  reportType: '6NDFL' | 'RSV' | 'EFS1' | 'PERS',
  year: number,
  quarterOrMonth: number
): { report_id: string; xml_path: string; amount: number } {
  ensureTaxSchema();
  const oid = resolveOrganizationId(organizationId);
  const org = getOrganization(oid);
  const isMonth = reportType === 'PERS';
  const quarter = isMonth ? Math.ceil(quarterOrMonth / 3) : quarterOrMonth;
  const month = isMonth ? quarterOrMonth : 0;
  const dir = orgTaxDir(
    oid,
    isMonth ? `${year}-${String(month).padStart(2, '0')}` : `${year}-Q${quarter}`
  );

  let accrued = 0;
  let ndfl = 0;
  let contrib = 0;
  let people = 0;

  if (isMonth) {
    const runRow = get<{ id: string }>(
      `SELECT id FROM payroll_runs WHERE organization_id=? AND year=? AND month=?`,
      [oid, year, month]
    );
    if (runRow) {
      const full = getPayrollRun(runRow.id);
      accrued = Number(full?.accrued_total) || 0;
      ndfl = Number(full?.ndfl_total) || 0;
      contrib = Number(full?.contrib_total) || 0;
      people = (full?.lines as unknown[] | undefined)?.length || 0;
    }
  } else {
    const runs = runsForQuarter(oid, year, quarter);
    for (const r of runs) {
      accrued += Number(r.accrued_total) || 0;
      ndfl += Number(r.ndfl_total) || 0;
      contrib += Number(r.contrib_total) || 0;
    }
    people = get<{ c: number }>(
      `SELECT COUNT(DISTINCT staff_id) AS c FROM payroll_lines
       WHERE run_id IN (SELECT id FROM payroll_runs WHERE organization_id=? AND year=? AND month BETWEEN ? AND ?)`,
      [oid, year, (quarter - 1) * 3 + 1, quarter * 3]
    )?.c || 0;
  }

  const tag = reportType;
  const xmlPath = path.join(
    dir,
    `${tag}_${year}_${isMonth ? String(month).padStart(2, '0') : 'Q' + quarter}.xml`
  );
  const amount = reportType === '6NDFL' ? ndfl : reportType === 'RSV' ? contrib : accrued;
  const xml = `<?xml version="1.0" encoding="windows-1251"?>
<!-- WMS draft ${tag} · ${year} ${isMonth ? 'm' + month : 'Q' + quarter} · заменить на актуальный XSD перед отправкой в Контур -->
<Файл ВерсПрог="Uchet1" Тип="${tag}">
  <СвНП ИНН="${org?.inn || ''}" Наим="${escapeXml(org?.name || '')}" />
  <Итог Начислено="${accrued.toFixed(2)}" НДФЛ="${ndfl.toFixed(2)}" Взносы="${contrib.toFixed(2)}" Физлиц="${people}" />
</Файл>
`;
  writeFileSync(xmlPath, xml, 'utf8');
  const id = newGuid();
  run(
    `INSERT INTO tax_reports (id, organization_id, report_type, period_year, period_quarter, period_month, status, amount, xml_path, meta_json, built_at)
     VALUES (?,?,?,?,?,?, 'ready', ?, ?, ?, datetime('now'))`,
    [
      id,
      oid,
      tag,
      year,
      quarter,
      month,
      amount,
      xmlPath,
      JSON.stringify({ accrued, ndfl, contrib, people }),
    ]
  );
  return { report_id: id, xml_path: xmlPath, amount };
}

export function listTaxReports(organizationId: string | null | undefined, reportType?: string) {
  const oid = resolveOrganizationId(organizationId);
  if (reportType) {
    return all(
      `SELECT * FROM tax_reports WHERE organization_id=? AND report_type=? ORDER BY created_at DESC LIMIT 50`,
      [oid, reportType]
    );
  }
  return all(
    `SELECT * FROM tax_reports WHERE organization_id=? ORDER BY created_at DESC LIMIT 100`,
    [oid]
  );
}
