/**
 * Схема налогового контура и зарплаты (мультиорг).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, all } from '../db.js';

export function ensureTaxSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tax_org_settings (
      organization_id TEXT PRIMARY KEY,
      tax_system TEXT NOT NULL DEFAULT 'usn_income',
      usn_rate REAL NOT NULL DEFAULT 6,
      vat_rate REAL NOT NULL DEFAULT 20,
      vat_payer INTEGER NOT NULL DEFAULT 1,
      ifns_code TEXT NOT NULL DEFAULT '',
      sfr_reg_number TEXT NOT NULL DEFAULT '',
      trade_fee INTEGER NOT NULL DEFAULT 0,
      kontur_account_id TEXT NOT NULL DEFAULT '',
      cert_thumbprint TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tax_periods (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      year INTEGER NOT NULL,
      quarter INTEGER NOT NULL DEFAULT 0,
      month INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      closed_at TEXT NOT NULL DEFAULT '',
      UNIQUE(organization_id, kind, year, quarter, month)
    );
    CREATE INDEX IF NOT EXISTS idx_tax_periods_org ON tax_periods(organization_id, year);

    CREATE TABLE IF NOT EXISTS tax_vat_ledger_sales (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      period_year INTEGER NOT NULL,
      period_quarter INTEGER NOT NULL,
      line_no INTEGER NOT NULL DEFAULT 0,
      op_date TEXT NOT NULL DEFAULT '',
      invoice_no TEXT NOT NULL DEFAULT '',
      invoice_date TEXT NOT NULL DEFAULT '',
      buyer_name TEXT NOT NULL DEFAULT '',
      buyer_inn TEXT NOT NULL DEFAULT '',
      amount_wo_vat REAL NOT NULL DEFAULT 0,
      vat_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      vat_rate REAL NOT NULL DEFAULT 20,
      source_doc_id TEXT NOT NULL DEFAULT '',
      source_doc_type TEXT NOT NULL DEFAULT '',
      manual INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vat_sales_org ON tax_vat_ledger_sales(organization_id, period_year, period_quarter);

    CREATE TABLE IF NOT EXISTS tax_vat_ledger_purchases (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      period_year INTEGER NOT NULL,
      period_quarter INTEGER NOT NULL,
      line_no INTEGER NOT NULL DEFAULT 0,
      op_date TEXT NOT NULL DEFAULT '',
      invoice_no TEXT NOT NULL DEFAULT '',
      invoice_date TEXT NOT NULL DEFAULT '',
      seller_name TEXT NOT NULL DEFAULT '',
      seller_inn TEXT NOT NULL DEFAULT '',
      amount_wo_vat REAL NOT NULL DEFAULT 0,
      vat_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      vat_rate REAL NOT NULL DEFAULT 20,
      source_doc_id TEXT NOT NULL DEFAULT '',
      source_doc_type TEXT NOT NULL DEFAULT '',
      manual INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vat_purch_org ON tax_vat_ledger_purchases(organization_id, period_year, period_quarter);

    CREATE TABLE IF NOT EXISTS tax_kudir_lines (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      period_year INTEGER NOT NULL,
      period_quarter INTEGER NOT NULL DEFAULT 0,
      section TEXT NOT NULL DEFAULT 'I',
      line_no INTEGER NOT NULL DEFAULT 0,
      op_date TEXT NOT NULL DEFAULT '',
      doc_no TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      income REAL NOT NULL DEFAULT 0,
      expense REAL NOT NULL DEFAULT 0,
      trade_fee REAL NOT NULL DEFAULT 0,
      source_ref TEXT NOT NULL DEFAULT '',
      manual INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kudir_org ON tax_kudir_lines(organization_id, period_year, period_quarter);

    CREATE TABLE IF NOT EXISTS payroll_runs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      accrued_total REAL NOT NULL DEFAULT 0,
      ndfl_total REAL NOT NULL DEFAULT 0,
      contrib_total REAL NOT NULL DEFAULT 0,
      net_total REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      posted_at TEXT NOT NULL DEFAULT '',
      UNIQUE(organization_id, year, month)
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_runs_org ON payroll_runs(organization_id, year, month);

    CREATE TABLE IF NOT EXISTS payroll_lines (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      staff_id TEXT NOT NULL DEFAULT '',
      person_name TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL DEFAULT '',
      salary_base REAL NOT NULL DEFAULT 0,
      days_worked REAL NOT NULL DEFAULT 0,
      days_norm REAL NOT NULL DEFAULT 0,
      accrued REAL NOT NULL DEFAULT 0,
      ndfl REAL NOT NULL DEFAULT 0,
      contrib_pfr REAL NOT NULL DEFAULT 0,
      contrib_foms REAL NOT NULL DEFAULT 0,
      contrib_fss REAL NOT NULL DEFAULT 0,
      contrib_total REAL NOT NULL DEFAULT 0,
      net_pay REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_lines_run ON payroll_lines(run_id);

    CREATE TABLE IF NOT EXISTS tax_reports (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      period_year INTEGER NOT NULL,
      period_quarter INTEGER NOT NULL DEFAULT 0,
      period_month INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      amount REAL NOT NULL DEFAULT 0,
      xml_path TEXT NOT NULL DEFAULT '',
      pdf_path TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      built_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_tax_reports_org ON tax_reports(organization_id, report_type, period_year);

    CREATE TABLE IF NOT EXISTS tax_filings (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      report_id TEXT NOT NULL DEFAULT '',
      report_type TEXT NOT NULL DEFAULT '',
      kontur_draft_id TEXT NOT NULL DEFAULT '',
      kontur_docflow_id TEXT NOT NULL DEFAULT '',
      kontur_task_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      errors_json TEXT NOT NULL DEFAULT '[]',
      sent_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tax_filings_org ON tax_filings(organization_id, status);

    CREATE TABLE IF NOT EXISTS tax_kontur_accounts (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      api_key_env TEXT NOT NULL DEFAULT 'KONTUR_EXTERN_API_KEY',
      client_id_env TEXT NOT NULL DEFAULT 'KONTUR_EXTERN_CLIENT_ID',
      account_id TEXT NOT NULL DEFAULT '',
      is_test INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tax_archive (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT '',
      period_label TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      stored_path TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      uploaded_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tax_archive_org ON tax_archive(organization_id, created_at DESC);
  `);

  try {
    const cols = all<{ name: string }>(`PRAGMA table_info(staff)`).map((c) => c.name);
    if (!cols.includes('salary')) {
      db.exec(`ALTER TABLE staff ADD COLUMN salary REAL NOT NULL DEFAULT 0`);
    }
    if (!cols.includes('organization_id')) {
      db.exec(`ALTER TABLE staff ADD COLUMN organization_id TEXT NOT NULL DEFAULT ''`);
    }
  } catch {
    /* ignore */
  }
}

export function taxStorageRoot(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const base =
    process.env.WMS_DATA_DIR || path.resolve(__dirname, '..', '..', '..', 'data');
  const dir = path.join(base, 'tax');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function orgTaxDir(organizationId: string, period = ''): string {
  const dir = path.join(taxStorageRoot(), organizationId.replace(/[/\\]/g, '_'), period || '_');
  mkdirSync(dir, { recursive: true });
  return dir;
}
