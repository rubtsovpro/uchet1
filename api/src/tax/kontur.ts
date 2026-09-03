/**
 * Адаптер Контур.Экстерн: auth + draft + upload + check/prepare/send.
 * Без ключей работает в режиме dry-run (локальный статус).
 * Docs: https://developer.kontur.ru/Docs/extern-api/scenarios/FNS/report/send_report.html
 */
import { readFileSync, existsSync } from 'node:fs';
import { get, run, all } from '../db.js';
import { newGuid } from '../ids.js';
import { resolveOrganizationId } from '../organizations.js';
import { ensureTaxSchema } from './schema.js';
import { getTaxSettings } from './settings.js';

const DEFAULT_BASE =
  process.env.KONTUR_EXTERN_BASE_URL || 'https://extern-api.testkontur.ru';

export type KonturConfig = {
  configured: boolean;
  base_url: string;
  is_test: boolean;
  has_api_key: boolean;
  has_client_id: boolean;
  note: string;
};

export function konturConfigStatus(): KonturConfig {
  const apiKey = String(process.env.KONTUR_EXTERN_API_KEY || '').trim();
  const clientId = String(process.env.KONTUR_EXTERN_CLIENT_ID || '').trim();
  const isTest = process.env.KONTUR_EXTERN_TEST !== '0';
  return {
    configured: Boolean(apiKey && clientId),
    base_url: DEFAULT_BASE,
    is_test: isTest,
    has_api_key: Boolean(apiKey),
    has_client_id: Boolean(clientId),
    note: apiKey
      ? 'Ключи заданы — можно отправлять на тестовый/боевой контур'
      : 'Задайте KONTUR_EXTERN_API_KEY и KONTUR_EXTERN_CLIENT_ID (заявка партнёра Контур.Экстерн)',
  };
}

let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  const cfg = konturConfigStatus();
  if (!cfg.configured) throw new Error('Контур.Экстерн не настроен (нет API key / client_id)');
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;

  // Партнёрский сценарий: api-key заголовок / session — уточняется по выданным credentials.
  // Здесь: client_credentials-like POST на gateway (совместимо с типичным Extern API auth).
  const apiKey = process.env.KONTUR_EXTERN_API_KEY!;
  const clientId = process.env.KONTUR_EXTERN_CLIENT_ID!;
  const authUrl =
    process.env.KONTUR_EXTERN_AUTH_URL ||
    'https://identity.testkontur.ru/connect/token';

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: apiKey,
    scope: process.env.KONTUR_EXTERN_SCOPE || 'extern.api',
  });
  const res = await fetch(authUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Kontur auth failed: ${json.error || res.status}. Проверьте ключи / URL (см. docs/TAX-payroll-kontur.md)`
    );
  }
  cachedToken = {
    token: json.access_token,
    exp: now + (Number(json.expires_in) || 3600),
  };
  return json.access_token;
}

async function konturFetch(method: string, urlPath: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  const apiKey = process.env.KONTUR_EXTERN_API_KEY || '';
  const url = urlPath.startsWith('http') ? urlPath : `${DEFAULT_BASE.replace(/\/$/, '')}${urlPath}`;
  return fetch(url, {
    ...init,
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Kontur-Apikey': apiKey,
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  });
}

export async function sendReportViaKontur(reportId: string, opts?: { dry_run?: boolean }) {
  ensureTaxSchema();
  const report = get<{
    id: string;
    organization_id: string;
    report_type: string;
    xml_path: string;
    amount: number;
  }>(`SELECT * FROM tax_reports WHERE id=?`, [reportId]);
  if (!report) throw new Error('report not found');
  if (!report.xml_path || !existsSync(report.xml_path)) {
    throw new Error('XML отчёта не найден — сначала соберите отчёт');
  }

  const oid = report.organization_id;
  const settings = getTaxSettings(oid);
  const cfg = konturConfigStatus();
  const filingId = newGuid();
  const dry = opts?.dry_run === true || !cfg.configured;

  run(
    `INSERT INTO tax_filings (id, organization_id, report_id, report_type, status)
     VALUES (?,?,?,?,?)`,
    [filingId, oid, reportId, report.report_type, dry ? 'dry_run' : 'uploading']
  );

  if (dry) {
    run(
      `UPDATE tax_filings SET status='dry_run', errors_json=?, updated_at=datetime('now'), sent_at=datetime('now')
       WHERE id=?`,
      [
        JSON.stringify([
          {
            message:
              'Dry-run: ключи Контура не заданы или dry_run=1. XML готов локально: ' + report.xml_path,
          },
        ]),
        filingId,
      ]
    );
    run(`UPDATE tax_reports SET status='ready' WHERE id=?`, [reportId]);
    return { filing_id: filingId, status: 'dry_run', draft_id: '', docflow_id: '' };
  }

  const accountId = process.env.KONTUR_EXTERN_ACCOUNT_ID || settings.kontur_account_id;
  if (!accountId) {
    throw new Error('Укажите KONTUR_EXTERN_ACCOUNT_ID или kontur_account_id в настройках org');
  }

  // 1) Create draft (упрощённое тело — поля уточняются по swagger партнёра)
  const draftRes = await konturFetch('POST', `/v1/${encodeURIComponent(accountId)}/drafts`, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payer: { inn: '' },
      recipient: {
        ifnsCode: settings.ifns_code || (cfg.is_test ? '0087' : ''),
      },
      description: { type: mapReportType(report.report_type) },
    }),
  });
  const draftJson = (await draftRes.json().catch(() => ({}))) as {
    id?: string;
    error?: unknown;
  };
  if (!draftRes.ok || !draftJson.id) {
    const msg = JSON.stringify(draftJson).slice(0, 500);
    run(
      `UPDATE tax_filings SET status='error', errors_json=?, updated_at=datetime('now') WHERE id=?`,
      [JSON.stringify([{ step: 'create_draft', message: msg }]), filingId]
    );
    throw new Error(`Kontur create draft: ${draftRes.status} ${msg}`);
  }
  const draftId = draftJson.id;
  run(`UPDATE tax_filings SET kontur_draft_id=?, status='draft' WHERE id=?`, [draftId, filingId]);

  // 2) Upload content
  const buf = readFileSync(report.xml_path);
  const upRes = await konturFetch(
    'POST',
    `/v1/${encodeURIComponent(accountId)}/contents?content-type=application/xml`,
    {
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf,
    }
  );
  const upJson = (await upRes.json().catch(() => ({}))) as { id?: string };
  if (!upRes.ok || !upJson.id) {
    run(
      `UPDATE tax_filings SET status='error', errors_json=?, updated_at=datetime('now') WHERE id=?`,
      [JSON.stringify([{ step: 'upload', status: upRes.status }]), filingId]
    );
    throw new Error(`Kontur upload content failed: ${upRes.status}`);
  }

  // 3) Add document to draft
  await konturFetch(
    'POST',
    `/v1/${encodeURIComponent(accountId)}/drafts/${encodeURIComponent(draftId)}/documents`,
    {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentId: upJson.id, description: { type: 'main' } }),
    }
  );

  // 4) Signature — если есть thumbprint / base64 подпись в env (серверная)
  const sigB64 = process.env.KONTUR_EXTERN_SIGNATURE_B64 || '';
  if (sigB64 || settings.cert_thumbprint) {
    await konturFetch(
      'POST',
      `/v1/${encodeURIComponent(accountId)}/drafts/${encodeURIComponent(draftId)}/documents/0/signatures`,
      {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentId: sigB64 || undefined,
          thumbprint: settings.cert_thumbprint || undefined,
        }),
      }
    ).catch(() => null);
  }

  // 5) Check → Prepare → Send (deferred)
  for (const step of ['check', 'prepare', 'send'] as const) {
    const r = await konturFetch(
      'POST',
      `/v1/${encodeURIComponent(accountId)}/drafts/${encodeURIComponent(draftId)}/${step}?deferred=true`,
      { headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
    const j = (await r.json().catch(() => ({}))) as { id?: string; error?: unknown };
    if (!r.ok) {
      run(
        `UPDATE tax_filings SET status='error', errors_json=?, updated_at=datetime('now') WHERE id=?`,
        [JSON.stringify([{ step, status: r.status, body: j }]), filingId]
      );
      throw new Error(`Kontur ${step} failed: ${r.status}`);
    }
    if (j.id) {
      run(`UPDATE tax_filings SET kontur_task_id=? WHERE id=?`, [j.id, filingId]);
    }
  }

  run(
    `UPDATE tax_filings SET status='sent', sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
    [filingId]
  );
  run(`UPDATE tax_reports SET status='sent' WHERE id=?`, [reportId]);
  return { filing_id: filingId, status: 'sent', draft_id: draftId, docflow_id: '' };
}

function mapReportType(t: string): string {
  const m: Record<string, string> = {
    NDS: 'urn:fns:nds',
    USN: 'urn:fns:usn',
    USN_ADV: 'urn:fns:usn',
    '6NDFL': 'urn:fns:ndfl6',
    RSV: 'urn:sfr:rsv',
    EFS1: 'urn:sfr:efs1',
    PERS: 'urn:fns:pers',
    NOTICE: 'urn:fns:notice',
  };
  return m[t] || t;
}

export function listFilings(organizationId?: string | null) {
  ensureTaxSchema();
  const oid = resolveOrganizationId(organizationId);
  return all(
    `SELECT * FROM tax_filings WHERE organization_id=? ORDER BY created_at DESC LIMIT 100`,
    [oid]
  );
}

export async function syncFilingStatuses(organizationId?: string | null) {
  ensureTaxSchema();
  const oid = resolveOrganizationId(organizationId);
  const cfg = konturConfigStatus();
  const open = all<{ id: string; kontur_draft_id: string; kontur_task_id: string }>(
    `SELECT id, kontur_draft_id, kontur_task_id FROM tax_filings
     WHERE organization_id=? AND status IN ('sent','draft','uploading','checking')`,
    [oid]
  );
  if (!cfg.configured) {
    return { updated: 0, note: 'Контур не настроен — статусы не обновлялись' };
  }
  let updated = 0;
  const accountId = process.env.KONTUR_EXTERN_ACCOUNT_ID || '';
  for (const f of open) {
    if (!f.kontur_task_id || !accountId) continue;
    try {
      const r = await konturFetch(
        'GET',
        `/v1/${encodeURIComponent(accountId)}/drafts/tasks/${encodeURIComponent(f.kontur_task_id)}`
      );
      const j = (await r.json().catch(() => ({}))) as {
        status?: string;
        docflowId?: string;
      };
      if (j.status) {
        run(
          `UPDATE tax_filings SET status=?, kontur_docflow_id=COALESCE(NULLIF(?,''), kontur_docflow_id),
             updated_at=datetime('now') WHERE id=?`,
          [String(j.status).toLowerCase(), j.docflowId || '', f.id]
        );
        updated += 1;
      }
    } catch {
      /* skip */
    }
  }
  return { updated };
}
