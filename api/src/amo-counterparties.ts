/**
 * Синк компаний и контактов AmoCRM → counterparties + связи.
 * Источник: amo1c CLI export_counterparties_for_wms.php
 *
 * Важно: PHP-экспорт через async execFile (не execFileSync) — иначе event loop
 * Node зависает на ~1 мин и «сайт не грузит».
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { all, get, run } from './db.js';
import { normalizePhoneForStorage } from './phone.js';

const execFileAsync = promisify(execFile);

const DEFAULT_EXPORT =
  process.env.AMO1C_COUNTERPARTIES_EXPORT ||
  '/root/amo1c_pnevmopodveska1_ru/public_html/bin/export_counterparties_for_wms.php';

let syncInFlight: Promise<unknown> | null = null;

export type AmoCpExport = {
  ok?: boolean;
  companies?: AmoCpRow[];
  contacts?: AmoCpRow[];
  links?: Array<{ company_id: string; contact_id: string }>;
  counts?: { companies?: number; contacts?: number; links?: number };
};

export type AmoCpRow = {
  id: string;
  name?: string;
  inn?: string;
  phone?: string;
  phones?: string[];
  email?: string;
  emails?: string[];
  buyer_kind?: string;
  is_legal_entity?: number;
  is_partner?: number;
  amo_url?: string;
  linked_ids?: string[];
};

async function loadExport(scriptPath = DEFAULT_EXPORT, extraArgs: string[] = []): Promise<AmoCpExport> {
  const { stdout } = await execFileAsync('php', [scriptPath, ...extraArgs], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300_000,
  });
  return JSON.parse(stdout) as AmoCpExport;
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function joinPhones(phones: string[] | undefined, fallback = ''): string {
  const list = (phones && phones.length ? phones : fallback ? [fallback] : [])
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  if (!list.length) return '';
  return normalizePhoneForStorage(list.slice(0, 2).join('; '));
}

function companyLocalId(amoId: string): string {
  return `amo:company:${amoId}`;
}

function contactLocalId(amoId: string): string {
  return `amo:contact:${amoId}`;
}

function findExistingByAmo(kind: 'company' | 'contact', amoId: string) {
  if (kind === 'company') {
    return get<{ id: string; kind: string }>(
      `SELECT id, kind FROM counterparties WHERE amo_company_id = ? LIMIT 1`,
      [amoId]
    );
  }
  return get<{ id: string; kind: string }>(
    `SELECT id, kind FROM counterparties WHERE amo_contact_id = ? LIMIT 1`,
    [amoId]
  );
}

function findExistingByInn(inn: string) {
  const digits = String(inn || '').replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 12) return null;
  return get<{ id: string; kind: string; amo_company_id: string }>(
    `SELECT id, kind, IFNULL(amo_company_id,'') AS amo_company_id
     FROM counterparties
     WHERE REPLACE(REPLACE(IFNULL(inn,''),' ',''),'-','') = ?
     ORDER BY CASE WHEN IFNULL(amo_company_id,'') != '' THEN 0 ELSE 1 END, name
     LIMIT 1`,
    [digits]
  );
}

/** Не затираем supplier/both из 1С — только дополняем до both при buyer из Amo. */
function mergeKind(existing: string | undefined, fromAmo: 'buyer'): string {
  const cur = String(existing || '');
  if (cur === 'supplier') return 'both';
  if (cur === 'both') return 'both';
  if (cur === 'buyer') return 'buyer';
  return fromAmo;
}

function upsertCompany(row: AmoCpRow): string {
  const amoId = String(row.id || '').trim();
  if (!amoId) return '';
  const name = String(row.name || '').trim() || `Компания Amo #${amoId}`;
  const inn = String(row.inn || '').replace(/\D/g, '');
  const phone = joinPhones(row.phones, row.phone || '');
  const email = String(row.email || (row.emails && row.emails[0]) || '').trim();
  const amoUrl = String(row.amo_url || '').trim();

  let existing = findExistingByAmo('company', amoId);
  if (!existing && inn) {
    const byInn = findExistingByInn(inn);
    // Не цепляем к чужой уже привязанной компании Amo
    if (byInn && (!byInn.amo_company_id || byInn.amo_company_id === amoId)) {
      existing = byInn;
    }
  }

  const id = existing?.id || companyLocalId(amoId);
  const kind = mergeKind(existing?.kind, 'buyer');
  const isPartner = Number(row.is_partner) === 1 || String(row.buyer_kind || '') === 'partner';
  const partyKind = isPartner
    ? 'partner'
    : inn.length === 12
      ? 'ip'
      : 'legal';

  if (existing) {
    run(
      `UPDATE counterparties SET
         name = CASE WHEN length(trim(?)) > 0 THEN ? ELSE name END,
         inn = CASE WHEN length(?) > 0 THEN ? ELSE inn END,
         phone = CASE WHEN length(?) > 0 THEN ? ELSE phone END,
         email = CASE WHEN length(?) > 0 THEN ? ELSE IFNULL(email,'') END,
         kind = ?,
         party_kind = CASE WHEN length(?) > 0 THEN ? ELSE IFNULL(party_kind,'') END,
         is_partner = ?,
         amo_company_id = ?,
         amo_url = CASE WHEN length(?) > 0 THEN ? ELSE IFNULL(amo_url,'') END,
         amo_entity = 'company',
         source = CASE WHEN IFNULL(source,'') = '' OR source = 'amo' THEN 'amo' ELSE source END,
         synced_at = datetime('now')
       WHERE id = ?`,
      [
        name,
        name,
        inn,
        inn,
        phone,
        phone,
        email,
        email,
        kind,
        partyKind,
        partyKind,
        isPartner ? 1 : 0,
        amoId,
        amoUrl,
        amoUrl,
        id,
      ]
    );
  } else {
    run(
      `INSERT INTO counterparties (
         id, name, inn, phone, kind, party_kind, is_partner, email, amo_company_id, amo_contact_id,
         amo_url, amo_entity, source, synced_at, is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, 'company', 'amo', datetime('now'), 1)`,
      [id, name, inn, phone, kind, partyKind, isPartner ? 1 : 0, email, amoId, amoUrl]
    );
  }
  return id;
}

function upsertContact(row: AmoCpRow): string {
  const amoId = String(row.id || '').trim();
  if (!amoId) return '';
  const name = String(row.name || '').trim() || `Контакт Amo #${amoId}`;
  const inn = String(row.inn || '').replace(/\D/g, '');
  const phone = joinPhones(row.phones, row.phone || '');
  const email = String(row.email || (row.emails && row.emails[0]) || '').trim();
  const amoUrl = String(row.amo_url || '').trim();

  const existing = findExistingByAmo('contact', amoId);
  const id = existing?.id || contactLocalId(amoId);
  const kind = mergeKind(existing?.kind, 'buyer');

  if (existing) {
    run(
      `UPDATE counterparties SET
         name = CASE WHEN length(trim(?)) > 0 THEN ? ELSE name END,
         inn = CASE WHEN length(?) > 0 THEN ? ELSE inn END,
         phone = CASE WHEN length(?) > 0 THEN ? ELSE phone END,
         email = CASE WHEN length(?) > 0 THEN ? ELSE IFNULL(email,'') END,
         kind = ?,
         amo_contact_id = ?,
         amo_url = CASE WHEN length(?) > 0 THEN ? ELSE IFNULL(amo_url,'') END,
         amo_entity = CASE WHEN IFNULL(amo_entity,'') = 'company' THEN amo_entity ELSE 'contact' END,
         source = CASE WHEN IFNULL(source,'') = '' OR source = 'amo' THEN 'amo' ELSE source END,
         synced_at = datetime('now')
       WHERE id = ?`,
      [name, name, inn, inn, phone, phone, email, email, kind, amoId, amoUrl, amoUrl, id]
    );
  } else {
    run(
      `INSERT INTO counterparties (
         id, name, inn, phone, kind, email, amo_company_id, amo_contact_id,
         amo_url, amo_entity, source, synced_at, is_active
       ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 'contact', 'amo', datetime('now'), 1)`,
      [id, name, inn, phone, kind, email, amoId, amoUrl]
    );
  }
  return id;
}

export function amoCounterpartiesMeta() {
  return {
    companies:
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM counterparties WHERE IFNULL(amo_company_id,'') != ''`
      )?.c ?? 0,
    contacts:
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM counterparties WHERE IFNULL(amo_contact_id,'') != ''`
      )?.c ?? 0,
    links:
      get<{ c: number }>(`SELECT COUNT(*) AS c FROM counterparty_amo_links`)?.c ?? 0,
    lastSync:
      get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [
        'amo_counterparties_synced_at',
      ])?.value ?? null,
  };
}

export function listLinkedCounterparties(id: string): {
  companies: Array<Record<string, unknown>>;
  contacts: Array<Record<string, unknown>>;
} {
  const contacts = all(
    `SELECT c.*
     FROM counterparty_amo_links l
     JOIN counterparties c ON c.id = l.contact_id
     WHERE l.company_id = ?
     ORDER BY c.name`,
    [id]
  ) as Array<Record<string, unknown>>;
  const companies = all(
    `SELECT c.*
     FROM counterparty_amo_links l
     JOIN counterparties c ON c.id = l.company_id
     WHERE l.contact_id = ?
     ORDER BY c.name`,
    [id]
  ) as Array<Record<string, unknown>>;
  return { companies, contacts };
}

export async function syncCounterpartiesFromAmo(opts: {
  limit?: number;
  pages?: number;
  scriptPath?: string;
} = {}): Promise<{
  companies: number;
  contacts: number;
  links: number;
  upsertedCompanies: number;
  upsertedContacts: number;
  upsertedLinks: number;
  seconds: number;
}> {
  if (syncInFlight) {
    throw new Error('Синк компаний/контактов Amo уже выполняется — подождите');
  }
  const job = (async () => {
    const t0 = Date.now();
    const args: string[] = [];
    if (opts.limit) args.push(`--limit=${opts.limit}`);
    if (opts.pages) args.push(`--pages=${opts.pages}`);
    const exp = await loadExport(opts.scriptPath || DEFAULT_EXPORT, args);

    const companyMap = new Map<string, string>();
    const contactMap = new Map<string, string>();

    let upsertedCompanies = 0;
    for (const row of exp.companies || []) {
      const localId = upsertCompany(row);
      if (localId) {
        companyMap.set(String(row.id), localId);
        upsertedCompanies += 1;
      }
      if (upsertedCompanies % 100 === 0) await yieldEventLoop();
    }

    let upsertedContacts = 0;
    for (const row of exp.contacts || []) {
      const localId = upsertContact(row);
      if (localId) {
        contactMap.set(String(row.id), localId);
        upsertedContacts += 1;
      }
      if (upsertedContacts % 100 === 0) await yieldEventLoop();
    }

    const resolveCompany = (amoId: string): string => {
      if (companyMap.has(amoId)) return companyMap.get(amoId)!;
      const row = findExistingByAmo('company', amoId);
      if (row) {
        companyMap.set(amoId, row.id);
        return row.id;
      }
      return '';
    };
    const resolveContact = (amoId: string): string => {
      if (contactMap.has(amoId)) return contactMap.get(amoId)!;
      const row = findExistingByAmo('contact', amoId);
      if (row) {
        contactMap.set(amoId, row.id);
        return row.id;
      }
      return '';
    };

    let upsertedLinks = 0;
    for (const link of exp.links || []) {
      const companyId = resolveCompany(String(link.company_id || ''));
      const contactId = resolveContact(String(link.contact_id || ''));
      if (!companyId || !contactId) continue;
      run(
        `INSERT INTO counterparty_amo_links (company_id, contact_id, synced_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(company_id, contact_id) DO UPDATE SET synced_at = datetime('now')`,
        [companyId, contactId]
      );
      upsertedLinks += 1;
      if (upsertedLinks % 100 === 0) await yieldEventLoop();
    }

    run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      'amo_counterparties_synced_at',
      new Date().toISOString(),
    ]);

    return {
      companies: Number(exp.counts?.companies ?? (exp.companies || []).length),
      contacts: Number(exp.counts?.contacts ?? (exp.contacts || []).length),
      links: Number(exp.counts?.links ?? (exp.links || []).length),
      upsertedCompanies,
      upsertedContacts,
      upsertedLinks,
      seconds: Math.round((Date.now() - t0) / 1000),
    };
  })();

  syncInFlight = job;
  try {
    return await job;
  } finally {
    if (syncInFlight === job) syncInFlight = null;
  }
}
