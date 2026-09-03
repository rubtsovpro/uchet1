/**
 * DaData: подсказки по организациям / реквизиты для контрагентов.
 * Ключи: UI Настройки → Интеграции → DaData или DADATA_API_KEY / DADATA_SECRET.
 */
import { all, get, run } from './db.js';
import { getDadataSettings } from './integration-settings.js';

const SUGGEST_PARTY_URL =
  'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party';
const FIND_PARTY_URL =
  'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party';
const SUGGEST_FIO_URL =
  'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/fio';
const SUGGEST_ADDRESS_URL =
  'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address';

export type DadataParty = {
  value: string;
  unrestricted_value: string;
  inn: string;
  kpp: string;
  ogrn: string;
  type: 'LEGAL' | 'INDIVIDUAL' | string;
  name: string;
  name_full: string;
  address: string;
  management: string;
  /** Должность руководителя из DaData (management.post). */
  management_post: string;
  status: string;
  hid: string;
};

function mapSuggestion(raw: Record<string, unknown>): DadataParty {
  const data = (raw.data || {}) as Record<string, unknown>;
  const nameObj = (data.name || {}) as Record<string, unknown>;
  const addr = (data.address || {}) as Record<string, unknown>;
  const mgmt = (data.management || {}) as Record<string, unknown>;
  const state = (data.state || {}) as Record<string, unknown>;
  const short =
    String(nameObj.short_with_opf || nameObj.short || raw.value || '').trim() ||
    String(raw.value || '').trim();
  const full = String(nameObj.full_with_opf || nameObj.full || short).trim();
  return {
    value: String(raw.value || short),
    unrestricted_value: String(raw.unrestricted_value || short),
    inn: String(data.inn || '').replace(/\D/g, ''),
    kpp: String(data.kpp || '').replace(/\D/g, ''),
    ogrn: String(data.ogrn || '').replace(/\D/g, ''),
    type: String(data.type || ''),
    name: short,
    name_full: full,
    address: String(addr.value || addr.unrestricted_value || '').trim(),
    management: String(mgmt.name || '').trim(),
    management_post: String(mgmt.post || '').trim(),
    status: String(state.status || ''),
    hid: String(data.hid || ''),
  };
}

/** «В лице …» для договора: должность + ФИО. */
export function formatContractInFace(directorName: string, post?: string): string {
  const name = String(directorName || '').trim();
  if (!name) return '';
  if (/в лице\s/i.test(name) || /директор|управляющ|представител|ип\b/i.test(name)) {
    return name.replace(/^в лице\s+/i, '').trim();
  }
  const rawPost = String(post || '').trim();
  let title = 'Генерального директора';
  if (rawPost) {
    const p = rawPost.toLowerCase();
    if (/ген/i.test(p) && /директор/i.test(p)) title = 'Генерального директора';
    else if (/директор/i.test(p)) title = 'Директора';
    else if (/управляющ/i.test(p)) title = 'Управляющего';
    else title = rawPost;
  }
  return `${title} ${name}`;
}

async function dadataPost(url: string, body: Record<string, unknown>): Promise<unknown> {
  const s = getDadataSettings();
  if (!s.api_key) {
    throw new Error('DaData не настроена — укажите API-ключ в Настройки → Интеграции → DaData');
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Token ${s.api_key}`,
  };
  if (s.secret) headers['X-Secret'] = s.secret;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const msg =
      (json && typeof json === 'object' && 'message' in json
        ? String((json as { message: unknown }).message)
        : '') ||
      text.slice(0, 200) ||
      `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      throw new Error(`DaData: ${msg || 'ключ неверный / почта не подтверждена / лимит'}`);
    }
    throw new Error(`DaData: ${msg}`);
  }
  return json;
}

export async function suggestParty(query: string, count = 10): Promise<DadataParty[]> {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const json = (await dadataPost(SUGGEST_PARTY_URL, {
    query: q,
    count: Math.min(20, Math.max(1, count)),
  })) as { suggestions?: Array<Record<string, unknown>> };
  return (json.suggestions || []).map(mapSuggestion);
}

export async function findPartyByInn(inn: string): Promise<DadataParty | null> {
  const q = String(inn || '').replace(/\D/g, '');
  if (!(q.length === 10 || q.length === 12)) {
    throw new Error('ИНН должен быть 10 или 12 цифр');
  }
  const json = (await dadataPost(FIND_PARTY_URL, { query: q })) as {
    suggestions?: Array<Record<string, unknown>>;
  };
  const first = (json.suggestions || [])[0];
  return first ? mapSuggestion(first) : null;
}

export type DadataFio = {
  value: string;
  unrestricted_value: string;
  surname: string;
  name: string;
  patronymic: string;
  gender: string;
};

export async function suggestFio(query: string, count = 8): Promise<DadataFio[]> {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const json = (await dadataPost(SUGGEST_FIO_URL, {
    query: q,
    count: Math.min(20, Math.max(1, count)),
  })) as { suggestions?: Array<Record<string, unknown>> };
  return (json.suggestions || []).map((raw) => {
    const data = (raw.data || {}) as Record<string, unknown>;
    return {
      value: String(raw.value || '').trim(),
      unrestricted_value: String(raw.unrestricted_value || raw.value || '').trim(),
      surname: String(data.surname || '').trim(),
      name: String(data.name || '').trim(),
      patronymic: String(data.patronymic || '').trim(),
      gender: String(data.gender || '').trim(),
    };
  });
}

export type DadataAddress = {
  value: string;
  unrestricted_value: string;
  postal_code: string;
  city: string;
  street: string;
  house: string;
};

export async function suggestAddress(query: string, count = 8): Promise<DadataAddress[]> {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  const json = (await dadataPost(SUGGEST_ADDRESS_URL, {
    query: q,
    count: Math.min(20, Math.max(1, count)),
  })) as { suggestions?: Array<Record<string, unknown>> };
  return (json.suggestions || []).map((raw) => {
    const data = (raw.data || {}) as Record<string, unknown>;
    return {
      value: String(raw.value || '').trim(),
      unrestricted_value: String(raw.unrestricted_value || raw.value || '').trim(),
      postal_code: String(data.postal_code || '').trim(),
      city: String(data.city || data.settlement || '').trim(),
      street: String(data.street || '').trim(),
      house: String(data.house || '').trim(),
    };
  });
}

export async function testDadataConnection(): Promise<{
  ok: boolean;
  sample?: string;
  error?: string;
}> {
  try {
    const items = await suggestParty('сбербанк', 1);
    return { ok: true, sample: items[0]?.name || items[0]?.value || 'ok' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function applyPartyToCounterparty(id: string, party: DadataParty, opts?: { overwriteName?: boolean }) {
  const name = String(party.name || '').trim();
  const nameFull = String(party.name_full || name).trim();
  const inn = String(party.inn || '').replace(/\D/g, '');
  const kpp = String(party.kpp || '').replace(/\D/g, '');
  const ogrn = String(party.ogrn || '').replace(/\D/g, '');
  const address = String(party.address || '').trim();
  const director = formatContractInFace(party.management, party.management_post);
  if (opts?.overwriteName && name) run('UPDATE counterparties SET name = ? WHERE id = ?', [name, id]);
  if (nameFull) run('UPDATE counterparties SET name_full = ? WHERE id = ?', [nameFull, id]);
  if (inn) run('UPDATE counterparties SET inn = ? WHERE id = ?', [inn, id]);
  const partyKind =
    String(party.type || '').toUpperCase() === 'INDIVIDUAL'
      ? 'ip'
      : String(party.type || '').toUpperCase() === 'LEGAL'
        ? 'legal'
        : '';
  if (partyKind) run('UPDATE counterparties SET party_kind = ? WHERE id = ?', [partyKind, id]);
  run('UPDATE counterparties SET kpp = ? WHERE id = ?', [kpp, id]);
  run('UPDATE counterparties SET ogrn = ? WHERE id = ?', [ogrn, id]);
  run('UPDATE counterparties SET address = ? WHERE id = ?', [address, id]);
  if (director) {
    run(
      `UPDATE counterparties SET director = CASE
         WHEN IFNULL(TRIM(director),'') = '' THEN ?
         ELSE director
       END WHERE id = ?`,
      [director, id]
    );
  }
  run('UPDATE counterparties SET dadata_synced_at = datetime(?) WHERE id = ?', [
    new Date().toISOString(),
    id,
  ]);
}

/** Нужно обогащение: есть ИНН, ещё не сходили в DaData, или пустые реквизиты. */
export function listCounterpartiesNeedingDadata(limit = 500): Array<{ id: string; inn: string; name: string }> {
  const lim = Math.min(5000, Math.max(1, Math.floor(limit)));
  return all<{ id: string; inn: string; name: string }>(
    `SELECT id, inn, name FROM counterparties
     WHERE length(replace(IFNULL(inn,''),' ','')) IN (10, 12)
       AND IFNULL(dadata_synced_at,'') = ''
       AND (
         IFNULL(name_full,'') = ''
         OR IFNULL(address,'') = ''
         OR (
           length(replace(IFNULL(inn,''),' ','')) = 10
           AND IFNULL(kpp,'') = ''
         )
       )
     ORDER BY name
     LIMIT ?`,
    [lim]
  )
    .map((r) => ({
      id: String(r.id),
      inn: String(r.inn || '').replace(/\D/g, ''),
      name: String(r.name || ''),
    }))
    .filter((r) => r.inn.length === 10 || r.inn.length === 12);
}

export function dadataEnrichStats() {
  const total = get<{ c: number }>('SELECT COUNT(*) AS c FROM counterparties')?.c ?? 0;
  const withInn =
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM counterparties
       WHERE length(replace(IFNULL(inn,''),' ','')) IN (10, 12)`
    )?.c ?? 0;
  const need =
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM counterparties
       WHERE length(replace(IFNULL(inn,''),' ','')) IN (10, 12)
         AND IFNULL(dadata_synced_at,'') = ''
         AND (
           IFNULL(name_full,'') = ''
           OR IFNULL(address,'') = ''
           OR (
             length(replace(IFNULL(inn,''),' ','')) = 10
             AND IFNULL(kpp,'') = ''
           )
         )`
    )?.c ?? 0;
  const synced =
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM counterparties WHERE IFNULL(dadata_synced_at,'') != ''`
    )?.c ?? 0;
  return { total, with_inn: withInn, need_fill: need, synced };
}

/**
 * Пакетное обогащение по ИНН. Бесплатный лимит DaData suggest ~10k/день.
 * throttleMs — пауза между запросами (по умолчанию 80ms ≈ 12 rps, лимит 30).
 */
export async function enrichCounterpartiesFromDadata(input?: {
  limit?: number;
  onlyMissing?: boolean;
  overwriteName?: boolean;
  throttleMs?: number;
}): Promise<{
  scanned: number;
  updated: number;
  not_found: number;
  errors: number;
  skipped: number;
  samples: Array<{ id: string; name: string; inn: string }>;
  error_samples: Array<{ id: string; inn: string; error: string }>;
}> {
  const limit = Math.min(3000, Math.max(1, Math.floor(input?.limit ?? 500)));
  const overwriteName = input?.overwriteName === true;
  const throttleMs = Math.max(40, Math.floor(input?.throttleMs ?? 80));
  const rows = listCounterpartiesNeedingDadata(limit);

  let updated = 0;
  let notFound = 0;
  let errors = 0;
  let skipped = 0;
  const samples: Array<{ id: string; name: string; inn: string }> = [];
  const errorSamples: Array<{ id: string; inn: string; error: string }> = [];

  for (const row of rows) {
    if (!(row.inn.length === 10 || row.inn.length === 12)) {
      skipped += 1;
      continue;
    }
    try {
      const party = await findPartyByInn(row.inn);
      if (!party) {
        notFound += 1;
        // чтобы не долбить один и тот же ИНН каждый день
        run('UPDATE counterparties SET dadata_synced_at = datetime(?) WHERE id = ?', [
          new Date().toISOString(),
          row.id,
        ]);
      } else {
        applyPartyToCounterparty(row.id, party, { overwriteName });
        updated += 1;
        if (samples.length < 8) {
          samples.push({ id: row.id, name: party.name || row.name, inn: party.inn || row.inn });
        }
      }
    } catch (e) {
      errors += 1;
      if (errorSamples.length < 8) {
        errorSamples.push({
          id: row.id,
          inn: row.inn,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      // лимит / 403 — дальше нет смысла
      const msg = e instanceof Error ? e.message : '';
      if (/лимит|403|401|ключ/i.test(msg)) break;
    }
    await sleep(throttleMs);
  }

  return {
    scanned: rows.length,
    updated,
    not_found: notFound,
    errors,
    skipped,
    samples,
    error_samples: errorSamples,
  };
}
