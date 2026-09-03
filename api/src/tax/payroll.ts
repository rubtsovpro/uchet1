/**
 * Начисление зарплаты: оклад × дни, НДФЛ 13%, взносы (упрощённые ставки 2026).
 */
import { all, get, run } from '../db.js';
import { newGuid } from '../ids.js';
import { resolveOrganizationId } from '../organizations.js';
import { ensureTaxSchema } from './schema.js';

const NDFL_RATE = 0.13;
const PFR_RATE = 0.22;
const FOMS_RATE = 0.051;
const FSS_RATE = 0.029;

function workdaysInMonth(year: number, month: number): number {
  let n = 0;
  const days = new Date(year, month, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const wd = new Date(year, month - 1, d).getDay();
    if (wd !== 0 && wd !== 6) n += 1;
  }
  return n || 21;
}

export function createOrRebuildPayrollRun(
  organizationId: string | null | undefined,
  year: number,
  month: number,
  createdBy = ''
): { run_id: string; lines: number } {
  ensureTaxSchema();
  const oid = resolveOrganizationId(organizationId);
  const existing = get<{ id: string; status: string }>(
    `SELECT id, status FROM payroll_runs WHERE organization_id=? AND year=? AND month=?`,
    [oid, year, month]
  );
  if (existing && existing.status === 'posted') {
    throw new Error('Расчёт уже проведён — сторно не реализовано, создайте корректировку вручную');
  }
  let runId = existing?.id;
  if (runId) {
    run(`DELETE FROM payroll_lines WHERE run_id=?`, [runId]);
  } else {
    runId = newGuid();
    run(
      `INSERT INTO payroll_runs (id, organization_id, year, month, status, created_by)
       VALUES (?,?,?,?, 'draft', ?)`,
      [runId, oid, year, month, createdBy]
    );
  }

  const staff = all<{
    id: string;
    name: string;
    department: string;
    salary: number;
  }>(
    `SELECT id, name, IFNULL(department,'') AS department, IFNULL(salary,0) AS salary
     FROM staff
     WHERE IFNULL(is_active,1)=1
       AND IFNULL(salary,0) > 0
       AND (IFNULL(organization_id,'')='' OR organization_id=?)
     ORDER BY name`,
    [oid]
  );

  const norm = workdaysInMonth(year, month);
  let accrued_total = 0;
  let ndfl_total = 0;
  let contrib_total = 0;
  let net_total = 0;
  let n = 0;

  for (const s of staff) {
    const base = Number(s.salary) || 0;
    const days = norm;
    const accrued = Math.round(base * (days / norm) * 100) / 100;
    const ndfl = Math.round(accrued * NDFL_RATE * 100) / 100;
    const pfr = Math.round(accrued * PFR_RATE * 100) / 100;
    const foms = Math.round(accrued * FOMS_RATE * 100) / 100;
    const fss = Math.round(accrued * FSS_RATE * 100) / 100;
    const contrib = Math.round((pfr + foms + fss) * 100) / 100;
    const net = Math.round((accrued - ndfl) * 100) / 100;
    n += 1;
    run(
      `INSERT INTO payroll_lines (
         id, run_id, staff_id, person_name, position, salary_base, days_worked, days_norm,
         accrued, ndfl, contrib_pfr, contrib_foms, contrib_fss, contrib_total, net_pay
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        newGuid(),
        runId,
        s.id,
        s.name,
        s.department,
        base,
        days,
        norm,
        accrued,
        ndfl,
        pfr,
        foms,
        fss,
        contrib,
        net,
      ]
    );
    accrued_total += accrued;
    ndfl_total += ndfl;
    contrib_total += contrib;
    net_total += net;
  }

  run(
    `UPDATE payroll_runs SET accrued_total=?, ndfl_total=?, contrib_total=?, net_total=? WHERE id=?`,
    [
      Math.round(accrued_total * 100) / 100,
      Math.round(ndfl_total * 100) / 100,
      Math.round(contrib_total * 100) / 100,
      Math.round(net_total * 100) / 100,
      runId,
    ]
  );
  return { run_id: runId!, lines: n };
}

export function postPayrollRun(runId: string) {
  const runRow = get<{ id: string; status: string }>(`SELECT id, status FROM payroll_runs WHERE id=?`, [
    runId,
  ]);
  if (!runRow) throw new Error('run not found');
  if (runRow.status === 'posted') return;
  run(`UPDATE payroll_runs SET status='posted', posted_at=datetime('now') WHERE id=?`, [runId]);
}

export function getPayrollRun(runId: string): (Record<string, unknown> & { lines: unknown[] }) | null {
  const runRow = get<Record<string, unknown>>(`SELECT * FROM payroll_runs WHERE id=?`, [runId]);
  if (!runRow) return null;
  const lines = all(`SELECT * FROM payroll_lines WHERE run_id=? ORDER BY person_name`, [runId]);
  return { ...runRow, lines };
}

export function listPayrollRuns(organizationId: string | null | undefined) {
  const oid = resolveOrganizationId(organizationId);
  return all(
    `SELECT * FROM payroll_runs WHERE organization_id=? ORDER BY year DESC, month DESC LIMIT 36`,
    [oid]
  );
}
