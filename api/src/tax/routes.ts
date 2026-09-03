/**
 * HTTP-маршруты налогового контура и зарплаты.
 */
import { readFileSync, existsSync } from 'node:fs';
import type { Hono } from 'hono';
import { actorFromContext, canDo, type Actor } from '../auth.js';
import { auditFromContext } from '../audit.js';
import { get } from '../db.js';
import { canUseTax, canUsePayroll } from '../staff.js';
import { ensureTaxSchema } from './schema.js';
import { getTaxSettings, patchTaxSettings } from './settings.js';
import { buildTaxCalendar } from './calendar.js';
import {
  rebuildVatBooks,
  vatBooksSummary,
  listVatSales,
  listVatPurchases,
  buildVatDeclarationXml,
} from './vat.js';
import {
  rebuildKudir,
  kudirSummary,
  listKudir,
  buildUsnReport,
  buildTaxNotice,
} from './usn-kudir.js';
import {
  createOrRebuildPayrollRun,
  getPayrollRun,
  listPayrollRuns,
  postPayrollRun,
} from './payroll.js';
import { buildPayrollReportXml, listTaxReports } from './payroll-reports.js';
import {
  konturConfigStatus,
  sendReportViaKontur,
  listFilings,
  syncFilingStatuses,
} from './kontur.js';
import { listArchive, saveArchiveUpload, readArchiveBytes, deleteArchive } from './archive.js';
import { run } from '../db.js';
import { newGuid } from '../ids.js';

function denyTax(c: { json: (b: unknown, s: number) => Response }, actor: Actor | null) {
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canUseTax(actor)) return c.json({ error: 'Нет права can_tax (бухгалтер / админ)' }, 403);
  return null;
}

function denyPayroll(c: { json: (b: unknown, s: number) => Response }, actor: Actor | null) {
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canUsePayroll(actor)) {
    return c.json({ error: 'Нет права can_payroll (бухгалтер / админ)' }, 403);
  }
  return null;
}

function orgId(c: { req: { query: (k: string) => string | undefined } }, body?: Record<string, unknown>) {
  return String(
    (body && (body.organization_id || body.organizationId)) ||
      c.req.query('organization_id') ||
      ''
  ).trim();
}

function yq(c: { req: { query: (k: string) => string | undefined } }, body?: Record<string, unknown>) {
  const year = Number((body && body.year) || c.req.query('year') || new Date().getFullYear()) || new Date().getFullYear();
  const quarter =
    Number((body && body.quarter) || c.req.query('quarter') || Math.ceil((new Date().getMonth() + 1) / 3)) ||
    1;
  return { year, quarter: Math.min(4, Math.max(1, quarter)) };
}

async function readUpload(c: {
  req: { header: (n: string) => string | undefined; parseBody: () => Promise<Record<string, unknown>> };
}): Promise<{ buf: Buffer; fileName: string; mime: string }> {
  const ctype = String(c.req.header('content-type') || '');
  if (!ctype.includes('multipart/form-data')) {
    throw new Error('Нужен multipart с полем file');
  }
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === 'string') throw new Error('Поле file обязательно');
  const f = file as File;
  const ab = await f.arrayBuffer();
  return {
    buf: Buffer.from(ab),
    fileName: f.name || 'upload.bin',
    mime: f.type || 'application/octet-stream',
  };
}

export function mountTaxRoutes(api: Hono): void {
  ensureTaxSchema();

  api.get('/tax/meta', (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    return c.json({
      ok: true,
      kontur: konturConfigStatus(),
      can_tax: canUseTax(actor),
      can_payroll: canUsePayroll(actor),
    });
  });

  api.get('/tax/settings', (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      return c.json({ settings: getTaxSettings(orgId(c)) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'settings failed' }, 400);
    }
  });

  api.patch('/tax/settings', async (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const settings = patchTaxSettings(orgId(c, body), body as never);
      auditFromContext(c, {
        action: 'tax.settings.patch',
        entity: 'tax_org_settings',
        entityId: settings.organization_id,
        summary: 'Настройки налогов org',
      });
      return c.json({ settings });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'patch failed' }, 400);
    }
  });

  api.get('/tax/calendar', (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      return c.json({ items: buildTaxCalendar(orgId(c)) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'calendar failed' }, 400);
    }
  });

  /* ——— НДС ——— */
  api.post('/tax/vat/rebuild', async (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const { year, quarter } = yq(c, body);
      const counts = rebuildVatBooks(orgId(c, body), year, quarter);
      const summary = vatBooksSummary(orgId(c, body), year, quarter);
      return c.json({ ok: true, counts, summary, year, quarter });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'rebuild failed' }, 400);
    }
  });

  api.get('/tax/vat/books', (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      const { year, quarter } = yq(c);
      const oid = orgId(c);
      return c.json({
        year,
        quarter,
        summary: vatBooksSummary(oid, year, quarter),
        sales: listVatSales(oid, year, quarter),
        purchases: listVatPurchases(oid, year, quarter),
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'books failed' }, 400);
    }
  });

  api.post('/tax/vat/declare', async (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const { year, quarter } = yq(c, body);
      const result = buildVatDeclarationXml(orgId(c, body), year, quarter);
      auditFromContext(c, {
        action: 'tax.vat.declare',
        entity: 'tax_report',
        entityId: result.report_id,
        summary: `НДС ${year} Q${quarter}`,
      });
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'declare failed' }, 400);
    }
  });

  /* ——— УСН / КУДиР ——— */
  api.post('/tax/usn/rebuild', async (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const { year, quarter } = yq(c, body);
      const oid = orgId(c, body);
      const counts = rebuildKudir(oid, year, quarter);
      return c.json({ ok: true, counts, summary: kudirSummary(oid, year, quarter), year, quarter });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'rebuild failed' }, 400);
    }
  });

  api.get('/tax/kudir', (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      const { year, quarter } = yq(c);
      const oid = orgId(c);
      return c.json({
        year,
        quarter,
        summary: kudirSummary(oid, year, quarter),
        lines: listKudir(oid, year, quarter),
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'kudir failed' }, 400);
    }
  });

  api.post('/tax/usn/declare', async (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const { year, quarter } = yq(c, body);
      const result = buildUsnReport(orgId(c, body), year, quarter);
      auditFromContext(c, {
        action: 'tax.usn.declare',
        entity: 'tax_report',
        entityId: result.report_id,
        summary: `УСН ${year} Q${quarter}`,
      });
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'declare failed' }, 400);
    }
  });

  api.post('/tax/notice/build', async (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const year = Number(body.year || new Date().getFullYear());
      const month = Number(body.month || new Date().getMonth() + 1);
      const result = buildTaxNotice(orgId(c, body), year, month);
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'notice failed' }, 400);
    }
  });

  /* ——— Зарплата ——— */
  api.get('/payroll/runs', (c) => {
    const actor = actorFromContext(c);
    const d = denyPayroll(c, actor);
    if (d) return d;
    try {
      return c.json({ items: listPayrollRuns(orgId(c)) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'list failed' }, 400);
    }
  });

  api.post('/payroll/runs', async (c) => {
    const actor = actorFromContext(c);
    const d = denyPayroll(c, actor);
    if (d) return d;
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const year = Number(body.year || new Date().getFullYear());
      const month = Number(body.month || new Date().getMonth() + 1);
      const result = createOrRebuildPayrollRun(orgId(c, body), year, month, actor?.id || '');
      auditFromContext(c, {
        action: 'payroll.run.create',
        entity: 'payroll_run',
        entityId: result.run_id,
        summary: `ЗП ${year}-${month}`,
      });
      return c.json({ ...result, run: getPayrollRun(result.run_id) }, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'payroll failed' }, 400);
    }
  });

  api.get('/payroll/runs/:id', (c) => {
    const actor = actorFromContext(c);
    const d = denyPayroll(c, actor);
    if (d) return d;
    const runRow = getPayrollRun(c.req.param('id'));
    if (!runRow) return c.json({ error: 'not found' }, 404);
    return c.json({ run: runRow });
  });

  api.post('/payroll/runs/:id/post', (c) => {
    const actor = actorFromContext(c);
    const d = denyPayroll(c, actor);
    if (d) return d;
    try {
      postPayrollRun(c.req.param('id'));
      auditFromContext(c, {
        action: 'payroll.run.post',
        entity: 'payroll_run',
        entityId: c.req.param('id'),
        summary: 'Проведение начисления ЗП',
      });
      return c.json({ run: getPayrollRun(c.req.param('id')) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'post failed' }, 400);
    }
  });

  /* ——— Отчёты XML ——— */
  api.get('/tax/reports', (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      return c.json({
        items: listTaxReports(orgId(c), c.req.query('type') || undefined),
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'list failed' }, 400);
    }
  });

  api.post('/tax/reports/build', async (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const type = String(body.type || body.report_type || '').toUpperCase();
      const year = Number(body.year || new Date().getFullYear());
      const oid = orgId(c, body);
      let result: { report_id: string; xml_path: string; amount: number };
      if (type === 'NDS') {
        result = buildVatDeclarationXml(oid, year, Number(body.quarter || 1));
      } else if (type === 'USN' || type === 'USN_ADV') {
        result = buildUsnReport(oid, year, Number(body.quarter || 4));
      } else if (type === 'NOTICE') {
        result = buildTaxNotice(oid, year, Number(body.month || 1));
      } else if (['6NDFL', 'RSV', 'EFS1', 'PERS'].includes(type)) {
        const d2 = denyPayroll(c, actor);
        if (d2) return d2;
        result = buildPayrollReportXml(
          oid,
          type as '6NDFL' | 'RSV' | 'EFS1' | 'PERS',
          year,
          Number(body.period || body.quarter || body.month || 1)
        );
      } else {
        return c.json({ error: `Неизвестный тип отчёта: ${type}` }, 400);
      }
      auditFromContext(c, {
        action: 'tax.report.build',
        entity: 'tax_report',
        entityId: result.report_id,
        summary: `${type} XML`,
      });
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'build failed' }, 400);
    }
  });

  api.get('/tax/reports/:id/xml', (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    const row = get<{ xml_path: string; report_type: string }>(
      `SELECT xml_path, report_type FROM tax_reports WHERE id=?`,
      [c.req.param('id')]
    );
    if (!row?.xml_path || !existsSync(row.xml_path)) {
      return c.json({ error: 'XML не найден' }, 404);
    }
    const xml = readFileSync(row.xml_path);
    c.header('Content-Type', 'application/xml; charset=utf-8');
    c.header(
      'Content-Disposition',
      `inline; filename="${row.report_type}-${c.req.param('id').slice(0, 8)}.xml"`
    );
    return c.body(new Uint8Array(xml));
  });

  /* ——— Контур / отправки ——— */
  api.get('/tax/kontur/status', (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    return c.json(konturConfigStatus());
  });

  api.get('/tax/filings', (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      return c.json({ items: listFilings(orgId(c)) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'list failed' }, 400);
    }
  });

  api.post('/tax/filings/:id/send', async (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    // id здесь — report_id (удобнее с UI) или filing через report
    try {
      const body = (await c.req.json().catch(() => ({}))) as { dry_run?: boolean; report_id?: string };
      const reportId = String(body.report_id || c.req.param('id'));
      const result = await sendReportViaKontur(reportId, { dry_run: body.dry_run });
      auditFromContext(c, {
        action: 'tax.filing.send',
        entity: 'tax_filing',
        entityId: result.filing_id,
        summary: `Отправка в Контур: ${result.status}`,
      });
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'send failed' }, 400);
    }
  });

  api.post('/tax/filings/send', async (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        report_id?: string;
        dry_run?: boolean;
      };
      if (!body.report_id) return c.json({ error: 'report_id обязателен' }, 400);
      const result = await sendReportViaKontur(body.report_id, { dry_run: body.dry_run });
      auditFromContext(c, {
        action: 'tax.filing.send',
        entity: 'tax_filing',
        entityId: result.filing_id,
        summary: `Отправка в Контур: ${result.status}`,
      });
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'send failed' }, 400);
    }
  });

  api.post('/tax/filings/sync-status', async (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      return c.json(await syncFilingStatuses(orgId(c, body)));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'sync failed' }, 400);
    }
  });

  /* ——— Архив эталонов ——— */
  api.get('/tax/archive', (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      return c.json({ items: listArchive(orgId(c), c.req.query('kind') || undefined) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'list failed' }, 400);
    }
  });

  api.post('/tax/archive/upload', async (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    try {
      const { buf, fileName, mime } = await readUpload(c);
      const kind = String(c.req.query('kind') || 'etalon').slice(0, 64);
      const title = String(c.req.query('title') || fileName);
      const periodLabel = String(c.req.query('period_label') || '');
      const notes = String(c.req.query('notes') || '');
      const result = saveArchiveUpload({
        organizationId: orgId(c),
        kind,
        title,
        periodLabel,
        notes,
        originalName: fileName,
        mime,
        buffer: buf,
        uploadedBy: actor?.id || '',
      });
      auditFromContext(c, {
        action: 'tax.archive.upload',
        entity: 'tax_archive',
        entityId: result.id,
        summary: `Эталон: ${fileName}`,
      });
      return c.json(result, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'upload failed' }, 400);
    }
  });

  api.get('/tax/archive/:id/file', (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    const packed = readArchiveBytes(c.req.param('id'));
    if (!packed) return c.json({ error: 'not found' }, 404);
    c.header('Content-Type', packed.meta.mime || 'application/octet-stream');
    c.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(packed.meta.filename || 'file')}"`
    );
    return c.body(new Uint8Array(packed.buf));
  });

  api.delete('/tax/archive/:id', (c) => {
    const actor = actorFromContext(c);
    const d = denyTax(c, actor);
    if (d) return d;
    if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'accountant') {
      return c.json({ error: 'forbidden' }, 403);
    }
    const ok = deleteArchive(c.req.param('id'));
    if (!ok) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  /* seed partner account row (idempotent) */
  try {
    const exists = get<{ c: number }>(`SELECT COUNT(*) AS c FROM tax_kontur_accounts`);
    if (!exists || Number(exists.c) === 0) {
      run(
        `INSERT INTO tax_kontur_accounts (id, label, is_test, notes)
         VALUES (?,?,1,?)`,
        [
          newGuid(),
          'Контур.Экстерн (тест)',
          'Заполните KONTUR_EXTERN_* в /etc/warehouse-wms.env. Тестовые ИФНС-роботы — см. docs/TAX-payroll-kontur.md',
        ]
      );
    }
  } catch {
    /* ignore */
  }
}
