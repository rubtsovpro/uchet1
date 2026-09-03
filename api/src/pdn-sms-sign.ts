/**
 * Согласие ПДн по SMS: короткая ссылка на брендовом домене + код подтверждения.
 * Фогель/Стрела → pdn.fogel.com.ru; подвеска → pdn.pnevmopodveska1.ru.
 * Храним полный журнал (IP, UA, устройство, geo, SMS id) для доказательной базы.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { all, get, run } from './db.js';
import { getDeal } from './deals.js';
import { resolveBuyerRole } from './deal-sale-rules.js';
import { updateSalesDocStoChecklist } from './sales-docs.js';
import { digitsOnly } from './phone.js';
import { looksLikePersonFio } from './person-fio.js';
import { enrichClientMeta, type ClientMeta } from './client-meta.js';
import { writeAudit } from './audit.js';
import { INN_BMP } from './sto-sites.js';
import { sendTargetSms, smsSenderForOrg, targetsmsConfigured, type TargetSmsSender } from './targetsms.js';
import { buildDealPdnConsentSnapshot } from './sto-pack-pdf.js';

export type PdnBrand = 'fogel' | 'pnevmo';

/** Фогель / Стрела (М.П.) → pdn.fogel.com.ru; подвеска / Можайка (Р.П.) → pdn.pnevmopodveska1.ru */
export function pdnBrandForOrg(opts: {
  inn?: string | null;
  companyCode?: string | null;
  companyName?: string | null;
  sender?: TargetSmsSender | string | null;
}): PdnBrand {
  if (String(opts.sender || '') === 'Fogel') return 'fogel';
  const inn = String(opts.inn || '').replace(/\D/g, '');
  if (inn === INN_BMP) return 'fogel';
  const code = String(opts.companyCode || opts.companyName || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (/fogel|фогел|strela|стрел/.test(code)) return 'fogel';
  return 'pnevmo';
}

export function pdnPublicBaseUrl(brand?: PdnBrand | null): string {
  const b = brand === 'fogel' || brand === 'pnevmo' ? brand : null;
  if (b === 'fogel') {
    const raw = String(process.env.PDN_FOGEL_URL || 'https://pdn.fogel.com.ru').trim();
    return raw.replace(/\/+$/, '') || 'https://pdn.fogel.com.ru';
  }
  if (b === 'pnevmo') {
    const raw = String(
      process.env.PDN_PNEVMO_URL || 'https://pdn.pnevmopodveska1.ru'
    ).trim();
    return raw.replace(/\/+$/, '') || 'https://pdn.pnevmopodveska1.ru';
  }
  const raw = String(process.env.PDN_PUBLIC_URL || 'https://pdn.uchetn1.ru').trim();
  return raw.replace(/\/+$/, '') || 'https://pdn.uchetn1.ru';
}

export function pdnLinkUrl(token: string, brand?: PdnBrand | null): string {
  return `${pdnPublicBaseUrl(brand)}/${encodeURIComponent(token)}`;
}

export function pdnBrandMeta(brand: PdnBrand): {
  brand: PdnBrand;
  brand_name: string;
  site_url: string;
  logo_url: string;
} {
  if (brand === 'fogel') {
    return {
      brand: 'fogel',
      brand_name: 'FOGEL',
      site_url: 'https://fogel.com.ru',
      logo_url: '/brand/fogel-logo.png',
    };
  }
  return {
    brand: 'pnevmo',
    brand_name: 'Пневмоподвеска №1',
    site_url: 'https://pnevmopodveska1.ru',
    logo_url: '/brand/pnevmo-logo.svg',
  };
}

const TOKEN_BYTES = 6; // ~8 символов base64url
const CODE_TTL_SEC = 10 * 60;
const LINK_TTL_DAYS = 14;
const MAX_CODE_ATTEMPTS = 8;
const CODE_RESEND_COOLDOWN_SEC = 45;

export type PdnSignStatus = 'pending' | 'opened' | 'code_sent' | 'signed' | 'expired' | 'revoked';

export type PdnDocType =
  | 'passport_rf'
  | 'foreign_passport'
  | 'driver_license'
  | 'other';

export type PdnIdentity = {
  fio: string;
  doc_type: PdnDocType;
  doc_type_label: string;
  series: string;
  number: string;
  issued_by: string;
  issued_at: string;
  other_title: string;
};

export const PDN_DOC_TYPES: Array<{ id: PdnDocType; label: string }> = [
  { id: 'passport_rf', label: 'Паспорт гражданина РФ' },
  { id: 'foreign_passport', label: 'Заграничный паспорт' },
  { id: 'driver_license', label: 'Водительское удостоверение' },
  { id: 'other', label: 'Иной документ' },
];

export type PdnSignSession = {
  id: string;
  token: string;
  deal_id: string;
  phone: string;
  phone_masked: string;
  buyer_name: string;
  org_name: string;
  org_inn: string;
  sender: TargetSmsSender;
  status: PdnSignStatus;
  consent_text: string;
  consent_sha256: string;
  link_url: string;
  link_sms_id: string;
  code_sms_id: string;
  code_sent_at: string;
  code_attempts: number;
  signed_at: string;
  created_at: string;
  created_by: string;
  expires_at: string;
  identity: PdnIdentity | null;
  brand?: PdnBrand | null;
};

let schemaReady = false;

export function ensurePdnSmsSchema(): void {
  if (schemaReady) return;
  run(`
    CREATE TABLE IF NOT EXISTS pdn_sign_sessions (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      deal_id TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      buyer_name TEXT NOT NULL DEFAULT '',
      org_name TEXT NOT NULL DEFAULT '',
      org_inn TEXT NOT NULL DEFAULT '',
      sender TEXT NOT NULL DEFAULT 'Pnevmo1',
      status TEXT NOT NULL DEFAULT 'pending',
      consent_text TEXT NOT NULL DEFAULT '',
      consent_sha256 TEXT NOT NULL DEFAULT '',
      link_url TEXT NOT NULL DEFAULT '',
      link_sms_id TEXT NOT NULL DEFAULT '',
      code_hash TEXT NOT NULL DEFAULT '',
      code_salt TEXT NOT NULL DEFAULT '',
      code_sms_id TEXT NOT NULL DEFAULT '',
      code_sent_at TEXT NOT NULL DEFAULT '',
      code_attempts INTEGER NOT NULL DEFAULT 0,
      signed_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_pdn_sign_deal ON pdn_sign_sessions(deal_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_pdn_sign_token ON pdn_sign_sessions(token);
    CREATE INDEX IF NOT EXISTS idx_pdn_sign_status ON pdn_sign_sessions(status);

    CREATE TABLE IF NOT EXISTS pdn_sign_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      deal_id TEXT NOT NULL DEFAULT '',
      event TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      os TEXT NOT NULL DEFAULT '',
      browser TEXT NOT NULL DEFAULT '',
      device TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      accept_language TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_pdn_sign_events_session ON pdn_sign_events(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_pdn_sign_events_deal ON pdn_sign_events(deal_id, created_at);
  `);
  // identity_json — ФИО + документ, введённые клиентом на pdn.uchetn1.ru
  try {
    const cols = all<{ name: string }>('PRAGMA table_info(pdn_sign_sessions)').map((c) => c.name);
    if (!cols.includes('identity_json')) {
      run(`ALTER TABLE pdn_sign_sessions ADD COLUMN identity_json TEXT NOT NULL DEFAULT ''`);
    }
  } catch {
    /* ignore */
  }
  schemaReady = true;
}

function newId(): string {
  return randomBytes(16).toString('hex');
}

function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function hashCode(code: string, salt: string): string {
  return sha256Hex(`${salt}:${code}`);
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length || ba.length === 0) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function maskPhone(phone: string): string {
  const d = digitsOnly(phone);
  if (d.length < 10) return '***';
  return `+${d.slice(0, 1)} (${d.slice(1, 4)}) ***-**-${d.slice(-2)}`;
}

export function phoneForSms(raw: unknown): string {
  const d = digitsOnly(raw);
  if (d.length === 11 && d.startsWith('7')) return d;
  if (d.length === 11 && d.startsWith('8')) return `7${d.slice(1)}`;
  if (d.length === 10) return `7${d}`;
  throw new Error('Укажите мобильный телефон заказчика (+7…)');
}

function parseIdentity(raw: unknown): PdnIdentity | null {
  if (!raw) return null;
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    try {
      obj = JSON.parse(s) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return null;
  const fio = String(obj.fio || '').trim();
  const doc_type = String(obj.doc_type || '').trim() as PdnDocType;
  if (!fio || !PDN_DOC_TYPES.some((d) => d.id === doc_type)) return null;
  return {
    fio,
    doc_type,
    doc_type_label: String(obj.doc_type_label || labelForDocType(doc_type)).trim(),
    series: String(obj.series || '').trim(),
    number: String(obj.number || '').trim(),
    issued_by: String(obj.issued_by || '').trim(),
    issued_at: String(obj.issued_at || '').trim(),
    other_title: String(obj.other_title || '').trim(),
  };
}

function labelForDocType(t: PdnDocType): string {
  return PDN_DOC_TYPES.find((d) => d.id === t)?.label || 'Документ';
}

export function formatPdnIdentityPassport(id: PdnIdentity): string {
  const title =
    id.doc_type === 'other' && id.other_title
      ? id.other_title
      : id.doc_type_label || labelForDocType(id.doc_type);
  const sn = [id.series, id.number].filter(Boolean).join(' ').trim();
  const parts = [title, sn].filter(Boolean);
  if (id.issued_by) parts.push(`выдан: ${id.issued_by}`);
  if (id.issued_at) parts.push(`от ${id.issued_at}`);
  return parts.join(', ');
}

export function normalizePdnIdentity(input: unknown): PdnIdentity {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const doc_type = String(raw.doc_type || 'passport_rf').trim() as PdnDocType;
  if (!PDN_DOC_TYPES.some((d) => d.id === doc_type)) {
    throw new Error('Выберите тип документа');
  }
  const fio = String(raw.fio || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (fio.length < 5 || fio.split(' ').filter(Boolean).length < 2) {
    throw new Error('Укажите ФИО полностью (фамилия и имя)');
  }
  if (!looksLikePersonFio(fio) && fio.split(' ').length < 2) {
    throw new Error('ФИО должно быть как в документе');
  }
  const series = String(raw.series || '')
    .replace(/\s+/g, ' ')
    .trim();
  const number = String(raw.number || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!number) throw new Error('Укажите номер документа');
  if (doc_type === 'passport_rf' && !series) {
    throw new Error('Укажите серию паспорта');
  }
  const other_title = String(raw.other_title || '').trim();
  if (doc_type === 'other' && !other_title) {
    throw new Error('Укажите название документа');
  }
  const issued_by = String(raw.issued_by || '').trim().slice(0, 200);
  const issued_at = String(raw.issued_at || '').trim().slice(0, 40);
  return {
    fio: fio.slice(0, 200),
    doc_type,
    doc_type_label: labelForDocType(doc_type),
    series: series.slice(0, 40),
    number: number.slice(0, 40),
    issued_by,
    issued_at,
    other_title: other_title.slice(0, 120),
  };
}

function applyIdentityToConsentText(baseText: string, id: PdnIdentity): string {
  let text = String(baseText || '');
  const passLine = formatPdnIdentityPassport(id);
  // Подставить ФИО в макросы/плейсхолдеры, если ещё пустые
  text = text.replace(/\{\{ФИО\}\}/g, id.fio);
  text = text.replace(/________+\s*\/\s*\{\{ФИО\}\}/g, `_______________________________ / ${id.fio}`);
  // Блок удостоверения личности перед подписью
  const block =
    `\n\nУдостоверение личности при подписании согласия:\n` +
    `Ф. И. О.: ${id.fio}\n` +
    `Документ: ${passLine}\n`;
  if (!/Удостоверение личности при подписании/i.test(text)) {
    const signIdx = text.search(/_{5,}\s*\/\s*/);
    if (signIdx >= 0) text = text.slice(0, signIdx) + block + text.slice(signIdx);
    else text = text.trimEnd() + block;
  }
  // Заменить первую строку «Я, …» (с учётом уже вписанного документа)
  text = text.replace(
    /Я,\s*[^,\n]+(?:,\s*документ\s+[^,\n]+)?,/u,
    `Я, ${id.fio}, документ ${passLine},`
  );
  return text.trim() + '\n';
}

function rowToSession(row: Record<string, unknown>): PdnSignSession {
  const phone = String(row.phone || '');
  let brand: PdnBrand | null = null;
  try {
    const meta = JSON.parse(String(row.meta_json || '') || '{}') as { brand?: string };
    if (meta.brand === 'fogel' || meta.brand === 'pnevmo') brand = meta.brand;
  } catch {
    /* ignore */
  }
  return {
    id: String(row.id || ''),
    token: String(row.token || ''),
    deal_id: String(row.deal_id || ''),
    phone,
    phone_masked: maskPhone(phone),
    buyer_name: String(row.buyer_name || ''),
    org_name: String(row.org_name || ''),
    org_inn: String(row.org_inn || ''),
    sender: (String(row.sender || 'Pnevmo1') as TargetSmsSender) || 'Pnevmo1',
    status: String(row.status || 'pending') as PdnSignStatus,
    consent_text: String(row.consent_text || ''),
    consent_sha256: String(row.consent_sha256 || ''),
    link_url: String(row.link_url || ''),
    link_sms_id: String(row.link_sms_id || ''),
    code_sms_id: String(row.code_sms_id || ''),
    code_sent_at: String(row.code_sent_at || ''),
    code_attempts: Number(row.code_attempts) || 0,
    signed_at: String(row.signed_at || ''),
    created_at: String(row.created_at || ''),
    created_by: String(row.created_by || ''),
    expires_at: String(row.expires_at || ''),
    identity: parseIdentity(row.identity_json),
    brand,
  };
}

export function getPdnSignByToken(token: string): PdnSignSession | null {
  ensurePdnSmsSchema();
  const t = String(token || '').trim();
  if (!t || t.length > 64) return null;
  const row = get<Record<string, unknown>>(
    `SELECT * FROM pdn_sign_sessions WHERE token = ? LIMIT 1`,
    [t]
  );
  return row ? rowToSession(row) : null;
}

export function getLatestPdnSignForDeal(dealId: string): PdnSignSession | null {
  ensurePdnSmsSchema();
  const id = String(dealId || '').trim();
  if (!id) return null;
  const row = get<Record<string, unknown>>(
    `SELECT * FROM pdn_sign_sessions WHERE deal_id = ?
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [id]
  );
  return row ? rowToSession(row) : null;
}

export function dealHasPdnSmsSigned(dealId: string): boolean {
  ensurePdnSmsSchema();
  const id = String(dealId || '').trim();
  if (!id) return false;
  const row = get<{ n: number }>(
    `SELECT COUNT(1) AS n FROM pdn_sign_sessions
     WHERE deal_id = ? AND status = 'signed'`,
    [id]
  );
  return Number(row?.n || 0) > 0;
}

export function pdnSmsSummary(dealId: string): {
  signed: boolean;
  status: PdnSignStatus | '';
  signed_at: string;
  phone_masked: string;
  link_url: string;
  sender: string;
} {
  const s = getLatestPdnSignForDeal(dealId);
  if (!s) {
    return { signed: false, status: '', signed_at: '', phone_masked: '', link_url: '', sender: '' };
  }
  return {
    signed: s.status === 'signed',
    status: s.status,
    signed_at: s.signed_at,
    phone_masked: s.phone_masked,
    link_url: s.link_url,
    sender: s.sender,
  };
}

async function captureMeta(c: Context): Promise<ClientMeta & { accept_language: string }> {
  const meta = await enrichClientMeta(c);
  return {
    ...meta,
    accept_language: String(c.req.header('accept-language') || '').slice(0, 200),
  };
}

export async function appendPdnSignEvent(
  c: Context | null,
  session: { id: string; deal_id: string },
  event: string,
  extra?: Record<string, unknown>
): Promise<void> {
  ensurePdnSmsSchema();
  let meta: ClientMeta & { accept_language: string } = {
    ip: '',
    ua: '',
    os: '',
    browser: '',
    device: '',
    region: '',
    country: '',
    accept_language: '',
  };
  if (c) {
    try {
      meta = await captureMeta(c);
    } catch {
      /* ignore */
    }
  }
  const headersSnap: Record<string, string> = {};
  if (c) {
    for (const name of [
      'user-agent',
      'accept-language',
      'sec-ch-ua',
      'sec-ch-ua-platform',
      'sec-ch-ua-mobile',
      'sec-ch-ua-model',
      'x-forwarded-for',
      'x-real-ip',
      'cf-connecting-ip',
      'referer',
    ]) {
      const v = c.req.header(name);
      if (v) headersSnap[name] = String(v).slice(0, 400);
    }
  }
  run(
    `INSERT INTO pdn_sign_events (
      id, session_id, deal_id, event, ip, user_agent, os, browser, device,
      region, country, accept_language, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      session.id,
      session.deal_id,
      event.slice(0, 64),
      meta.ip.slice(0, 64),
      meta.ua.slice(0, 500),
      meta.os.slice(0, 80),
      meta.browser.slice(0, 80),
      meta.device.slice(0, 40),
      meta.region.slice(0, 200),
      meta.country.slice(0, 80),
      meta.accept_language,
      JSON.stringify({ headers: headersSnap, ...(extra || {}) }).slice(0, 8000),
    ]
  );
}

function markDealPdnOk(dealId: string): void {
  const id = String(dealId || '').trim();
  if (!id) return;
  const wo = get<{ id: string }>(
    `SELECT id FROM sales_docs
     WHERE deal_id = ? AND doc_type = 'workorder'
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [id]
  );
  if (wo?.id) {
    try {
      updateSalesDocStoChecklist(String(wo.id), { checks: { pdn: true } });
    } catch {
      /* чек-лист не блокирует */
    }
  }
}

function expireIfNeeded(session: PdnSignSession): PdnSignSession {
  if (session.status === 'signed' || session.status === 'revoked') return session;
  const exp = String(session.expires_at || '').trim();
  if (exp) {
    const expMs = Date.parse(exp.includes('T') ? exp : exp.replace(' ', 'T') + 'Z');
    if (Number.isFinite(expMs) && Date.now() > expMs) {
      run(`UPDATE pdn_sign_sessions SET status = 'expired' WHERE id = ? AND status != 'signed'`, [
        session.id,
      ]);
      return { ...session, status: 'expired' };
    }
  }
  return session;
}

export async function createAndSendPdnSmsLink(input: {
  dealId: string;
  actorId?: string;
  actorName?: string;
  c?: Context | null;
}): Promise<{ session: PdnSignSession; sms_id: string }> {
  ensurePdnSmsSchema();
  if (!targetsmsConfigured()) {
    throw new Error('TargetSMS не настроен на сервере');
  }
  const dealId = String(input.dealId || '').trim();
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  if (!deal) throw new Error('Заказ не найден');
  if (resolveBuyerRole(deal) !== 'person') {
    throw new Error('Согласие ПДн по SMS только для физлица');
  }

  const snap = await buildDealPdnConsentSnapshot(dealId);
  if (!snap) throw new Error('Не удалось подготовить текст согласия');
  // ФИО клиент уточнит на странице подписи; для SMS достаточно телефона
  const phone = phoneForSms(snap.phone || deal.buyer_phone);
  const sender = smsSenderForOrg({
    inn: snap.orgInn,
    companyName: snap.orgName,
  });
  const brand = pdnBrandForOrg({
    inn: snap.orgInn,
    companyName: snap.orgName,
    sender,
  });
  const token = newToken();
  const link = pdnLinkUrl(token, brand);
  const id = newId();
  const consentSha = sha256Hex(snap.consentText);
  const smsText = `Согласие на обработку ПДн: ${link}`;
  const sent = await sendTargetSms({
    phone,
    text: smsText,
    sender,
    nameDelivery: `pdn-link-${dealId.slice(0, 24)}`,
  });
  if (!sent.ok) throw new Error(sent.error);

  run(
    `INSERT INTO pdn_sign_sessions (
      id, token, deal_id, phone, buyer_name, org_name, org_inn, sender, status,
      consent_text, consent_sha256, link_url, link_sms_id, created_by, expires_at, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, datetime('now', ?), ?)`,
    [
      id,
      token,
      dealId,
      phone,
      snap.buyerName.slice(0, 200),
      snap.orgName.slice(0, 200),
      snap.orgInn.slice(0, 20),
      sender,
      snap.consentText,
      consentSha,
      link,
      sent.sms_id,
      String(input.actorName || input.actorId || '').slice(0, 120),
      `+${LINK_TTL_DAYS} days`,
      JSON.stringify({
        brand,
        deal_label: snap.dealLabel,
        sms_text: smsText,
        actor_id: input.actorId || '',
        consent_text_base: snap.consentText,
      }),
    ]
  );

  const session = getPdnSignByToken(token)!;
  await appendPdnSignEvent(input.c || null, session, 'link_sms_sent', {
    sms_id: sent.sms_id,
    sender,
    phone_masked: maskPhone(phone),
    link,
  });

  writeAudit({
    action: 'deal.pdn_sms_send',
    entity: 'crm_deal',
    entityId: dealId,
    summary: `ПДн SMS-ссылка → ${maskPhone(phone)} (${sender})`,
    after: { token, link, sms_id: sent.sms_id, sender },
    meta: { actor_id: input.actorId || '', actor_name: input.actorName || '' },
  });

  return { session, sms_id: sent.sms_id };
}

function brandFromSession(session: PdnSignSession): PdnBrand {
  if (session.brand === 'fogel' || session.brand === 'pnevmo') return session.brand;
  return pdnBrandForOrg({
    inn: session.org_inn,
    companyName: session.org_name,
    sender: session.sender,
  });
}

export function publicPdnView(session: PdnSignSession): Record<string, unknown> {
  const s = expireIfNeeded(session);
  const id = s.identity;
  const brand = brandFromSession(s);
  const brandMeta = pdnBrandMeta(brand);
  return {
    token: s.token,
    status: s.status,
    signed: s.status === 'signed',
    signed_at: s.signed_at || null,
    buyer_name: s.buyer_name,
    phone_masked: s.phone_masked,
    org_name: s.org_name,
    ...brandMeta,
    consent_text: s.status === 'expired' || s.status === 'revoked' ? '' : s.consent_text,
    consent_sha256: s.consent_sha256,
    expires_at: s.expires_at,
    doc_types: PDN_DOC_TYPES,
    identity: id
      ? {
          fio: id.fio,
          doc_type: id.doc_type,
          series: id.series,
          number: id.number,
          issued_by: id.issued_by,
          issued_at: id.issued_at,
          other_title: id.other_title,
        }
      : {
          fio: s.buyer_name || '',
          doc_type: 'passport_rf',
          series: '',
          number: '',
          issued_by: '',
          issued_at: '',
          other_title: '',
        },
    identity_filled: !!id,
    can_request_code: s.status === 'pending' || s.status === 'opened' || s.status === 'code_sent',
    can_confirm: s.status === 'code_sent' || s.status === 'opened' || s.status === 'pending',
  };
}

export async function markPdnOpened(c: Context, token: string): Promise<PdnSignSession> {
  const session0 = getPdnSignByToken(token);
  if (!session0) throw new Error('Ссылка недействительна');
  const session = expireIfNeeded(session0);
  if (session.status === 'expired') throw new Error('Срок ссылки истёк');
  if (session.status === 'revoked') throw new Error('Ссылка отозвана');
  if (session.status === 'pending') {
    run(`UPDATE pdn_sign_sessions SET status = 'opened' WHERE id = ? AND status = 'pending'`, [
      session.id,
    ]);
    session.status = 'opened';
    await appendPdnSignEvent(c, session, 'page_open');
  }
  return session;
}

export async function savePdnIdentity(
  c: Context,
  token: string,
  identityRaw?: unknown
): Promise<{ session: PdnSignSession; identity: PdnIdentity; consent_sha256: string }> {
  const session0 = getPdnSignByToken(token);
  if (!session0) throw new Error('Ссылка недействительна');
  let session = expireIfNeeded(session0);
  if (session.status === 'signed') throw new Error('Уже подписано');
  if (session.status === 'expired' || session.status === 'revoked') {
    throw new Error('Ссылка больше не действует');
  }
  const identity = normalizePdnIdentity(identityRaw ?? session.identity);
  const rowMeta = get<{ consent_text: string; meta_json: string }>(
    `SELECT consent_text, meta_json FROM pdn_sign_sessions WHERE id = ?`,
    [session.id]
  );
  let sourceText = '';
  try {
    const meta = JSON.parse(String(rowMeta?.meta_json || '') || '{}') as {
      consent_text_base?: string;
    };
    sourceText = String(meta.consent_text_base || '').trim();
  } catch {
    sourceText = '';
  }
  if (!sourceText) {
    sourceText = String(rowMeta?.consent_text || session.consent_text || '');
    if (/Удостоверение личности при подписании/i.test(sourceText)) {
      sourceText = sourceText
        .replace(/\n*Удостоверение личности при подписании[\s\S]*$/i, '')
        .trim();
    }
    sourceText = sourceText.replace(
      /(Я,\s*[^,\n]+),\s*документ\s+[^,\n]+,/gu,
      '$1,'
    );
  }
  const consentText = applyIdentityToConsentText(sourceText, identity);
  const consentSha = sha256Hex(consentText);

  run(
    `UPDATE pdn_sign_sessions SET
      identity_json = ?,
      buyer_name = ?,
      consent_text = ?,
      consent_sha256 = ?
     WHERE id = ?`,
    [JSON.stringify(identity), identity.fio, consentText, consentSha, session.id]
  );
  await appendPdnSignEvent(c, session, 'identity_saved', {
    fio: identity.fio,
    doc_type: identity.doc_type,
    series: identity.series,
    number: identity.number,
    issued_by: identity.issued_by,
    issued_at: identity.issued_at,
    other_title: identity.other_title,
    consent_sha256: consentSha,
  });
  session = getPdnSignByToken(token)!;
  return { session, identity, consent_sha256: consentSha };
}

export async function requestPdnSignCode(
  c: Context,
  token: string,
  identityRaw?: unknown
): Promise<{ ok: true; phone_masked: string; consent_sha256: string }> {
  if (!targetsmsConfigured()) throw new Error('SMS временно недоступна');
  const session0 = getPdnSignByToken(token);
  if (!session0) throw new Error('Ссылка недействительна');
  let session = expireIfNeeded(session0);
  if (session.status === 'signed') throw new Error('Уже подписано');
  if (session.status === 'expired' || session.status === 'revoked') {
    throw new Error('Ссылка больше не действует');
  }
  if (session.code_attempts >= MAX_CODE_ATTEMPTS) {
    throw new Error('Слишком много попыток — запросите новую ссылку у мастера');
  }
  if (session.code_sent_at) {
    const sentMs = Date.parse(
      session.code_sent_at.includes('T')
        ? session.code_sent_at
        : session.code_sent_at.replace(' ', 'T') + 'Z'
    );
    if (Number.isFinite(sentMs) && Date.now() - sentMs < CODE_RESEND_COOLDOWN_SEC * 1000) {
      throw new Error(`Повторная отправка через ${CODE_RESEND_COOLDOWN_SEC} сек.`);
    }
  }

  const saved = await savePdnIdentity(c, token, identityRaw);
  session = saved.session;
  const consentSha = saved.consent_sha256;

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const salt = randomBytes(16).toString('hex');
  const codeHash = hashCode(code, salt);
  const smsText = `Код подписи согласия ПДн: ${code}`;
  const sent = await sendTargetSms({
    phone: session.phone,
    text: smsText,
    sender: session.sender,
    nameDelivery: `pdn-code-${session.deal_id.slice(0, 20)}`,
  });
  if (!sent.ok) throw new Error(sent.error);

  run(
    `UPDATE pdn_sign_sessions SET
      status = 'code_sent',
      code_hash = ?,
      code_salt = ?,
      code_sms_id = ?,
      code_sent_at = datetime('now'),
      code_attempts = code_attempts
     WHERE id = ?`,
    [codeHash, salt, sent.sms_id, session.id]
  );
  session = getPdnSignByToken(token)!;
  await appendPdnSignEvent(c, session, 'code_sms_sent', {
    sms_id: sent.sms_id,
    sender: session.sender,
    code_ttl_sec: CODE_TTL_SEC,
  });
  return { ok: true, phone_masked: session.phone_masked, consent_sha256: consentSha };
}

export async function confirmPdnSignCode(
  c: Context,
  token: string,
  codeRaw: string,
  identityRaw?: unknown
): Promise<{ ok: true; signed_at: string }> {
  const session0 = getPdnSignByToken(token);
  if (!session0) throw new Error('Ссылка недействительна');
  let session = expireIfNeeded(session0);
  if (session.status === 'signed') {
    return { ok: true, signed_at: session.signed_at };
  }
  if (session.status === 'expired' || session.status === 'revoked') {
    throw new Error('Ссылка больше не действует');
  }
  if (!session.code_sent_at || !session.consent_sha256) {
    throw new Error('Сначала запросите код');
  }
  // Дозаполнение ФИО/документа на шаге ввода кода (без новой SMS)
  if (identityRaw != null) {
    const saved = await savePdnIdentity(c, token, identityRaw);
    session = saved.session;
  }
  if (!session.identity) {
    throw new Error('Укажите ФИО и документ');
  }
  if (session.code_attempts >= MAX_CODE_ATTEMPTS) {
    throw new Error('Превышено число попыток');
  }

  const sentMs = Date.parse(
    session.code_sent_at.includes('T')
      ? session.code_sent_at
      : session.code_sent_at.replace(' ', 'T') + 'Z'
  );
  if (Number.isFinite(sentMs) && Date.now() - sentMs > CODE_TTL_SEC * 1000) {
    throw new Error('Код истёк — запросите новый');
  }

  const code = String(codeRaw || '').replace(/\D/g, '');
  run(`UPDATE pdn_sign_sessions SET code_attempts = code_attempts + 1 WHERE id = ?`, [session.id]);

  const row = get<{ code_hash: string; code_salt: string }>(
    `SELECT code_hash, code_salt FROM pdn_sign_sessions WHERE id = ?`,
    [session.id]
  );
  const expect = hashCode(code, String(row?.code_salt || ''));
  if (!safeEqualHex(expect, String(row?.code_hash || ''))) {
    await appendPdnSignEvent(c, session, 'code_reject', { attempts: session.code_attempts + 1 });
    throw new Error('Неверный код');
  }

  const signedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  run(
    `UPDATE pdn_sign_sessions SET
      status = 'signed',
      signed_at = ?,
      code_hash = '',
      code_salt = ''
     WHERE id = ?`,
    [signedAt, session.id]
  );
  markDealPdnOk(session.deal_id);
  session = getPdnSignByToken(token)!;
  // Сохранить ФИО и документ в заказ (без фото паспорта)
  if (session.identity) {
    try {
      const pass = formatPdnIdentityPassport(session.identity);
      run(
        `UPDATE crm_deals SET
           buyer_name = ?,
           buyer_passport = ?,
           updated_at = datetime('now')
         WHERE id = ?`,
        [session.identity.fio, pass.slice(0, 300), session.deal_id]
      );
      run(
        `UPDATE sales_docs SET
           counterparty_name = CASE WHEN IFNULL(counterparty_name,'') = '' OR doc_type IN ('contract','workorder') THEN ? ELSE counterparty_name END,
           buyer_passport = ?
         WHERE deal_id = ? AND doc_type IN ('contract','workorder')`,
        [session.identity.fio, pass.slice(0, 300), session.deal_id]
      );
    } catch {
      /* не блокируем подпись */
    }
  }
  await appendPdnSignEvent(c, session, 'signed', {
    consent_sha256: session.consent_sha256,
    signed_at: signedAt,
    identity: session.identity,
  });
  writeAudit({
    action: 'deal.pdn_sms_signed',
    entity: 'crm_deal',
    entityId: session.deal_id,
    summary: `ПДн подписано SMS (${session.phone_masked})${
      session.identity ? ` · ${session.identity.fio}` : ''
    }`,
    after: {
      session_id: session.id,
      consent_sha256: session.consent_sha256,
      signed_at: signedAt,
      sender: session.sender,
      identity: session.identity,
    },
    meta: { buyer_name: session.buyer_name, phone_masked: session.phone_masked },
  });
  return { ok: true, signed_at: signedAt };
}

export function listPdnSignEvents(sessionId: string, limit = 100): Array<Record<string, unknown>> {
  ensurePdnSmsSchema();
  return all<Record<string, unknown>>(
    `SELECT id, event, created_at, ip, user_agent, os, browser, device, region, country,
            accept_language, meta_json
     FROM pdn_sign_events WHERE session_id = ?
     ORDER BY datetime(created_at) ASC LIMIT ?`,
    [sessionId, Math.min(Math.max(limit, 1), 500)]
  );
}
