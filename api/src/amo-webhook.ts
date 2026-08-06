/**
 * Webhook AmoCRM → Учёт №1: сделки / контакты.
 * Товары — из SQL БД amo1c (не через этот хук).
 * Вкл/выкл в UI; подписка в Amo через amo1c CLI.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { get, run } from './db.js';
import { dealsMeta } from './deals.js';
import { amoCounterpartiesMeta } from './amo-counterparties.js';

const execFileAsync = promisify(execFile);

const META_AT = 'amo_webhook_at';
const META_LAST = 'amo_webhook_last';
const META_ENABLED = 'amo_webhook_enabled';

const DEFAULT_WH_MANAGE =
  process.env.AMO1C_WEBHOOK_MANAGE ||
  '/root/amo1c_pnevmopodveska1_ru/public_html/bin/manage_webhooks_for_wms.php';

export type AmoWebhookEntity = 'deals' | 'contacts' | 'products' | 'other';

export type AmoWebhookLast = {
  at: string;
  entities: AmoWebhookEntity[];
  ids: string[];
  raw_keys: string[];
};

function portalBase(): string {
  return String(process.env.UCHET_PUBLIC_URL || process.env.WMS_PUBLIC_URL || 'https://uchetn1.ru')
    .trim()
    .replace(/\/+$/, '');
}

export function amoWebhookSecret(): string {
  return String(process.env.WMS_INGEST_KEY || process.env.AMO_WEBHOOK_KEY || '').trim();
}

export function amoWebhookPublicUrl(): string {
  const key = amoWebhookSecret();
  const base = `${portalBase()}/api/webhooks/amo`;
  return key ? `${base}?key=${encodeURIComponent(key)}` : base;
}

/** По умолчанию включён, если ключ есть и meta ещё не задана. */
export function isAmoWebhookEnabled(): boolean {
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [META_ENABLED]);
  if (!row) return Boolean(amoWebhookSecret());
  return String(row.value || '') === '1';
}

function writeEnabled(on: boolean): void {
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [META_ENABLED, on ? '1' : '0']);
}

function readLast(): AmoWebhookLast | null {
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [META_LAST]);
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as AmoWebhookLast;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeLast(last: AmoWebhookLast): void {
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [META_AT, last.at]);
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [META_LAST, JSON.stringify(last)]);
}

function maxIso(...vals: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = -1;
  for (const v of vals) {
    if (!v) continue;
    const ms = Date.parse(v);
    if (!Number.isFinite(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = new Date(ms).toISOString();
    }
  }
  return best;
}

function classifyKey(key: string): AmoWebhookEntity | null {
  const k = key.toLowerCase();
  if (k.startsWith('leads') || k.includes('[leads]') || k === 'leads') return 'deals';
  if (k.startsWith('contacts') || k.includes('[contacts]')) return 'contacts';
  if (
    k.startsWith('companies') ||
    k.includes('[companies]') ||
    k.startsWith('catalog') ||
    k.includes('[catalog') ||
    k.startsWith('products') ||
    k.includes('[products]')
  ) {
    return 'products';
  }
  return null;
}

function collectIds(obj: unknown, out: string[], depth = 0): void {
  if (depth > 6 || out.length > 40) return;
  if (obj == null) return;
  if (Array.isArray(obj)) {
    for (const x of obj) collectIds(x, out, depth + 1);
    return;
  }
  if (typeof obj !== 'object') return;
  const rec = obj as Record<string, unknown>;
  if (rec.id != null && String(rec.id).trim()) {
    const id = String(rec.id).trim();
    if (!out.includes(id)) out.push(id);
  }
  for (const v of Object.values(rec)) collectIds(v, out, depth + 1);
}

/** Разбор тела Amo (form / json) → сущности и id. */
export function parseAmoWebhookPayload(
  body: unknown,
  formKeys: string[] = []
): { entities: AmoWebhookEntity[]; ids: string[]; raw_keys: string[] } {
  const entities = new Set<AmoWebhookEntity>();
  const ids: string[] = [];
  const raw_keys = [...formKeys];

  for (const k of formKeys) {
    const ent = classifyKey(k);
    if (ent) entities.add(ent);
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const rec = body as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if (!raw_keys.includes(k)) raw_keys.push(k);
      const ent = classifyKey(k);
      if (ent) {
        entities.add(ent);
        collectIds(v, ids);
      }
    }
    if (rec.leads) {
      entities.add('deals');
      collectIds(rec.leads, ids);
    }
    if (rec.contacts) {
      entities.add('contacts');
      collectIds(rec.contacts, ids);
    }
    if (rec.companies || rec.catalogs || rec.catalog_elements || rec.products) {
      entities.add('products');
      collectIds(rec.companies, ids);
      collectIds(rec.catalogs, ids);
      collectIds(rec.catalog_elements, ids);
      collectIds(rec.products, ids);
    }
  }

  if (!entities.size && raw_keys.length) entities.add('other');
  return {
    entities: [...entities],
    ids: ids.slice(0, 40),
    raw_keys: raw_keys.slice(0, 40),
  };
}

export function recordAmoWebhookHit(parsed: {
  entities: AmoWebhookEntity[];
  ids: string[];
  raw_keys: string[];
}): AmoWebhookLast {
  const last: AmoWebhookLast = {
    at: new Date().toISOString(),
    entities: parsed.entities.length ? parsed.entities : ['other'],
    ids: parsed.ids,
    raw_keys: parsed.raw_keys,
  };
  writeLast(last);
  return last;
}

async function callAmoWebhookManage(
  action: 'on' | 'off' | 'status'
): Promise<{ ok: boolean; subscribed?: boolean; error?: string; http?: number }> {
  const url = amoWebhookPublicUrl();
  const secret = amoWebhookSecret();
  if (!secret) return { ok: false, error: 'WMS_INGEST_KEY не задан' };
  try {
    const { stdout } = await execFileAsync(
      'php',
      [DEFAULT_WH_MANAGE, `--action=${action}`, `--url=${url}`],
      { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 45_000 }
    );
    const parsed = JSON.parse(String(stdout || '{}')) as {
      ok?: boolean;
      subscribed?: boolean;
      error?: string;
      http?: number;
    };
    return {
      ok: Boolean(parsed.ok),
      subscribed: parsed.subscribed,
      error: parsed.error ? String(parsed.error) : undefined,
      http: parsed.http,
    };
  } catch (e) {
    const err = e as { stdout?: string; message?: string };
    let detail = String(err.message || e);
    try {
      const parsed = JSON.parse(String(err.stdout || '{}')) as { error?: string };
      if (parsed.error) detail = String(parsed.error);
    } catch {
      /* keep */
    }
    return { ok: false, error: detail };
  }
}

/** Вкл/выкл приём + подписка в Amo. */
export async function setAmoWebhookEnabled(enabled: boolean): Promise<{
  ok: boolean;
  enabled: boolean;
  amo_ok: boolean;
  amo_subscribed: boolean;
  error?: string;
}> {
  const secret = amoWebhookSecret();
  if (!secret) {
    return {
      ok: false,
      enabled: false,
      amo_ok: false,
      amo_subscribed: false,
      error: 'Нет ключа WMS_INGEST_KEY',
    };
  }

  const amo = await callAmoWebhookManage(enabled ? 'on' : 'off');
  // локально включаем даже если Amo ответил ошибкой — URL всё равно готов; но при off всегда гасим
  if (enabled) {
    writeEnabled(true);
  } else {
    writeEnabled(false);
  }

  return {
    ok: true,
    enabled: isAmoWebhookEnabled(),
    amo_ok: amo.ok,
    amo_subscribed: Boolean(amo.subscribed),
    error: amo.ok ? undefined : amo.error,
  };
}

export function amoIntegrationStatusPublic() {
  const secret = amoWebhookSecret();
  const enabled = isAmoWebhookEnabled();
  const webhookLast = readLast();
  const deals = dealsMeta();
  const cps = amoCounterpartiesMeta();
  const lastReceived = maxIso(webhookLast?.at, deals.lastSync, cps.lastSync);
  const dealsCount = Number(deals.deals || 0);

  let status: 'ok' | 'waiting' | 'no_key' = 'waiting';
  let status_label = 'Ожидает данных';
  if (!secret) {
    status = 'no_key';
    status_label = 'Нет ключа';
  } else if (lastReceived || dealsCount > 0) {
    status = 'ok';
    status_label = 'Активна';
  }

  return {
    status,
    status_label,
    last_received_at: lastReceived,
    last_webhook_at: webhookLast?.at || null,
    last_webhook_entities: webhookLast?.entities || [],
    deals_count: dealsCount,
    webhook_enabled: enabled,
    webhook_key_set: Boolean(secret),
    webhook_entities: ['deals', 'contacts'] as AmoWebhookEntity[],
    webhook_hint: 'Сделки · контакты',
    products_source: 'amo1c_sql',
  };
}
