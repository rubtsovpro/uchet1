/**
 * Пуш реквизитов (договор / карточка контрагента) → Amo контакт/компания.
 * «Название» в Amo не перезаписываем; при другом имени из Учёта — поле «Покупатель».
 * CLI: update_contact_buyer_for_wms.php
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { get, all } from './db.js';
import { amoPushToAmoEnabled } from './amo-settings.js';

const execFileAsync = promisify(execFile);

const DEFAULT_SCRIPT =
  process.env.AMO1C_CONTACT_BUYER_PUSH ||
  '/root/amo1c_pnevmopodveska1_ru/public_html/bin/update_contact_buyer_for_wms.php';

export type ContractBuyerPush = {
  name?: string;
  inn?: string;
  kpp?: string;
  ogrn?: string;
  address?: string;
  phone?: string;
  email?: string;
  director?: string;
  bank?: string;
  bik?: string;
  rs?: string;
  ks?: string;
};

export type AmoContactBuyerPushResult =
  | {
      ok: true;
      entity?: string;
      contact_id?: number | null;
      company_id?: number | null;
      filled?: string[];
      skipped?: string[] | boolean;
      name_differs?: boolean;
      changed?: boolean;
      amo_name?: string;
      form_name?: string;
      push_skipped?: boolean;
    }
  | { ok: false; error: string; http?: number; contact_id?: number; company_id?: number };

async function runPush(args: string[]): Promise<AmoContactBuyerPushResult> {
  try {
    const { stdout } = await execFileAsync('php', [DEFAULT_SCRIPT, ...args], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 60_000,
    });
    const parsed = JSON.parse(String(stdout || '{}')) as AmoContactBuyerPushResult & {
      error?: string;
    };
    if (!parsed || (parsed as { ok?: boolean }).ok === false) {
      return {
        ok: false,
        error: String((parsed as { error?: string }).error || 'Amo update failed'),
        http: (parsed as { http?: number }).http,
        contact_id: (parsed as { contact_id?: number }).contact_id,
        company_id: (parsed as { company_id?: number }).company_id,
      };
    }
    return parsed as AmoContactBuyerPushResult;
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

function buyerArgs(buyer: ContractBuyerPush): string[] {
  const payload: Record<string, string> = {};
  for (const [k, v] of Object.entries(buyer || {})) {
    const s = String(v ?? '').trim();
    if (s) payload[k] = s;
  }
  if (!Object.keys(payload).length) return [];
  return [`--json=${JSON.stringify(payload)}`];
}

export async function pushContractBuyerToAmoContact(opts: {
  dealId?: string;
  contactId?: string;
  companyId?: string;
  buyer: ContractBuyerPush;
  /** Обновить поле «Покупатель» в Amo (название контакта не трогаем) */
  forceName?: boolean;
}): Promise<AmoContactBuyerPushResult> {
  if (!amoPushToAmoEnabled()) {
    return { ok: true, push_skipped: true, changed: false, filled: [] };
  }
  const dealId = String(opts.dealId || '').replace(/\D/g, '');
  const contactId = String(opts.contactId || '').replace(/\D/g, '');
  const companyId = String(opts.companyId || '').replace(/\D/g, '');
  if (!dealId && !contactId && !companyId) {
    return { ok: false, error: 'deal_id or contact_id or company_id required' };
  }
  const jsonArgs = buyerArgs(opts.buyer);
  if (!jsonArgs.length) {
    return { ok: true, filled: [], skipped: [], changed: false };
  }
  const args = [...jsonArgs];
  if (opts.forceName) args.unshift('--force-name');
  if (contactId) {
    args.unshift(`--entity=contacts`, `--contact=${contactId}`);
  } else if (companyId) {
    args.unshift(`--entity=companies`, `--company=${companyId}`);
  } else if (dealId) {
    args.unshift(`--deal=${dealId}`);
  }
  return runPush(args);
}

function amoDigits(v: unknown): string {
  return String(v || '').replace(/\D/g, '');
}

/** После правки карточки контрагента — дозаполнить связанные сущности Amo. */
export async function pushCounterpartyToAmo(opts: {
  counterpartyId: string;
  buyer?: ContractBuyerPush;
  forceName?: boolean;
}): Promise<{
  ok: boolean;
  results: AmoContactBuyerPushResult[];
  error?: string;
}> {
  if (!amoPushToAmoEnabled()) {
    return { ok: true, results: [{ ok: true, push_skipped: true, changed: false, filled: [] }] };
  }
  const id = String(opts.counterpartyId || '').trim();
  if (!id) return { ok: false, results: [], error: 'counterparty id required' };

  const row = get<Record<string, unknown>>('SELECT * FROM counterparties WHERE id = ?', [id]);
  if (!row) return { ok: false, results: [], error: 'not found' };

  const buyer: ContractBuyerPush = {
    name: opts.buyer?.name ?? String(row.name || ''),
    inn: opts.buyer?.inn ?? String(row.inn || ''),
    kpp: opts.buyer?.kpp ?? String(row.kpp || ''),
    ogrn: opts.buyer?.ogrn ?? String(row.ogrn || ''),
    address: opts.buyer?.address ?? String(row.address || ''),
    phone: opts.buyer?.phone ?? String(row.phone || ''),
    email: opts.buyer?.email ?? String(row.email || ''),
    director: opts.buyer?.director ?? String(row.director || ''),
    bank: opts.buyer?.bank ?? String(row.bank || ''),
    bik: opts.buyer?.bik ?? String(row.bik || ''),
    rs: opts.buyer?.rs ?? String(row.rs || ''),
    ks: opts.buyer?.ks ?? String(row.ks || ''),
  };

  const contactIds = new Set<string>();
  const companyIds = new Set<string>();

  const selfContact = amoDigits(row.amo_contact_id);
  const selfCompany = amoDigits(row.amo_company_id);
  if (selfContact) contactIds.add(selfContact);
  if (selfCompany) companyIds.add(selfCompany);

  // связи company↔contact
  for (const r of all<{ amo_contact_id?: string }>(
    `SELECT c.amo_contact_id
     FROM counterparty_amo_links l
     JOIN counterparties c ON c.id = l.contact_id
     WHERE l.company_id = ? AND IFNULL(c.amo_contact_id,'') != ''`,
    [id]
  )) {
    const d = amoDigits(r.amo_contact_id);
    if (d) contactIds.add(d);
  }
  for (const r of all<{ amo_company_id?: string }>(
    `SELECT c.amo_company_id
     FROM counterparty_amo_links l
     JOIN counterparties c ON c.id = l.company_id
     WHERE l.contact_id = ? AND IFNULL(c.amo_company_id,'') != ''`,
    [id]
  )) {
    const d = amoDigits(r.amo_company_id);
    if (d) companyIds.add(d);
  }

  if (!contactIds.size && !companyIds.size) {
    return { ok: true, results: [], error: 'no_amo_link' };
  }

  const results: AmoContactBuyerPushResult[] = [];
  for (const cid of contactIds) {
    results.push(
      await pushContractBuyerToAmoContact({
        contactId: cid,
        buyer,
        forceName: opts.forceName,
      })
    );
  }
  for (const cid of companyIds) {
    results.push(
      await pushContractBuyerToAmoContact({
        companyId: cid,
        buyer,
        forceName: opts.forceName,
      })
    );
  }

  const failed = results.find((r) => r.ok === false);
  return {
    ok: !failed,
    results,
    error: failed && failed.ok === false ? failed.error : undefined,
  };
}
