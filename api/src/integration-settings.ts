/**
 * Настройки интеграций (СДЭК / АТОЛ / Точка) в meta SQLite.
 * Секреты не отдаются наружу — только флаги *_set; пустое значение при save = не менять.
 * Env (.env / systemd) остаётся fallback, пока в meta пусто.
 */
import { get, run } from './db.js';

const META_ATOL = 'integration_atol';
const META_TOCHKA = 'integration_tochka';
const META_CDEK = 'integration_cdek';
const META_DADATA = 'integration_dadata';
const META_YANDEX_PAY = 'integration_yandex_pay';
const META_DEEPSEEK = 'integration_deepseek';

export type AtolSettings = {
  api_url: string;
  login: string;
  pass: string;
  group_code: string;
  inn: string;
  sno: string;
  company_email: string;
  payment_address: string;
  client_email: string;
};

export type TochkaBridgeSettings = {
  bank_sbp_key: string;
  overview_url: string;
  sbp_create_url: string;
  sbp_status_url: string;
};

export type CdekBridgeSettings = {
  wms_key: string;
  wms_url: string;
  widget_url: string;
};

export type DadataSettings = {
  api_key: string;
  secret: string;
};

/** DeepSeek / OpenAI-compatible vision для OCR СТС. */
export type DeepseekSettings = {
  api_key: string;
  base_url: string;
  vision_model: string;
};

/** Яндекс Пэй + Сплит (организация в https://id.yandex.ru/org). */
export type YandexPaySettings = {
  /** Merchant ID из кабинета pay.yandex.ru */
  merchant_id: string;
  /** API-ключ Merchant API (в sandbox = merchant_id) */
  api_key: string;
  /** sandbox | production */
  env: string;
  /** Название организации в Яндекс ID (подпись) */
  org_name: string;
  /** Произвольный ID/метка организации из id.yandex.ru/org */
  org_id: string;
  /** Юрлицо в Учёте №1 (organizations.id) — для кого этот merchant */
  organization_id: string;
  /** Методы на форме: CARD,SPLIT */
  payment_methods: string;
  enabled: string;
};

function readMeta<T extends Record<string, unknown>>(key: string): Partial<T> {
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value) as Partial<T>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMeta(key: string, value: Record<string, unknown>): void {
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
}

function pickStr(...vals: Array<string | undefined | null>): string {
  for (const v of vals) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
}

function applySecret(
  current: string,
  incoming: unknown,
  opts?: { clearable?: boolean }
): string {
  if (incoming === undefined || incoming === null) return current;
  const s = String(incoming);
  if (s === '' && !opts?.clearable) return current;
  return s.trim();
}

function maskHint(secret: string): string {
  const s = secret.trim();
  if (!s) return '';
  if (s.length <= 4) return '••••';
  return '••••' + s.slice(-4);
}

/* ——— АТОЛ ——— */

const ATOL_DEFAULTS: AtolSettings = {
  api_url: 'https://online.atol.ru/possystem/v5',
  login: '',
  pass: '',
  group_code: '',
  inn: '231215603728',
  sno: 'usn_income',
  company_email: '',
  payment_address: 'https://pay.pnevmopodveska1.ru',
  client_email: '',
};

/** Ключ профиля АТОЛ: rp = БРП Москва, mp = БМП Краснодар (Фогель/Стрела). */
export type AtolProfileKey = 'rp' | 'mp';

type AtolStoreRaw = Partial<AtolSettings> & {
  profiles?: Partial<Record<AtolProfileKey, Partial<AtolSettings>>>;
};

const ATOL_PROFILE_PRESETS: Record<AtolProfileKey, Partial<AtolSettings>> = {
  rp: {
    inn: '231215603728',
    payment_address: 'https://pay.pnevmopodveska1.ru',
  },
  mp: {
    inn: '231295963240',
    payment_address: 'https://pay.fogel.com.ru',
  },
};

const BMP_ORG_INN = '231295963240';

function readAtolStore(): AtolStoreRaw {
  return readMeta<AtolStoreRaw>(META_ATOL);
}

function mergeAtolProfile(
  key: AtolProfileKey,
  partial?: Partial<AtolSettings>,
  envPrefix = ''
): AtolSettings {
  const preset = ATOL_PROFILE_PRESETS[key];
  const p = partial || {};
  const ep = (name: string) => (envPrefix ? process.env[`${envPrefix}_${name}`] : undefined);
  return {
    api_url: pickStr(p.api_url, ep('API_URL'), ATOL_DEFAULTS.api_url),
    login: pickStr(p.login, ep('LOGIN')),
    pass: pickStr(p.pass, ep('PASS')),
    group_code: pickStr(p.group_code, ep('GROUP_CODE')),
    inn: pickStr(p.inn, ep('INN'), preset.inn, ATOL_DEFAULTS.inn),
    sno: pickStr(p.sno, ep('SNO'), ATOL_DEFAULTS.sno),
    company_email: pickStr(p.company_email, ep('COMPANY_EMAIL')),
    payment_address: pickStr(
      p.payment_address,
      ep('PAYMENT_ADDRESS'),
      preset.payment_address,
      ATOL_DEFAULTS.payment_address
    ),
    client_email: pickStr(p.client_email, ep('CLIENT_EMAIL')),
  };
}

/** Перенос legacy flat → profiles.rp. */
function normalizeAtolStore(raw: AtolStoreRaw): Record<AtolProfileKey, AtolSettings> {
  const profiles: Partial<Record<AtolProfileKey, Partial<AtolSettings>>> = {
    ...(raw.profiles && typeof raw.profiles === 'object' ? { ...raw.profiles } : {}),
  };
  const legacyLogin = pickStr(raw.login, process.env.ATOL_LOGIN);
  if (legacyLogin && !profiles.rp?.login) {
    profiles.rp = {
      api_url: raw.api_url,
      login: raw.login,
      pass: raw.pass,
      group_code: raw.group_code,
      inn: raw.inn,
      sno: raw.sno,
      company_email: raw.company_email,
      payment_address: raw.payment_address,
      client_email: raw.client_email,
    };
  }
  return {
    rp: mergeAtolProfile('rp', profiles.rp, 'ATOL'),
    mp: mergeAtolProfile('mp', profiles.mp, 'ATOL_MP'),
  };
}

export function getAtolSettings(profile: AtolProfileKey = 'rp'): AtolSettings {
  const { rp, mp } = normalizeAtolStore(readAtolStore());
  return profile === 'mp' ? mp : rp;
}

export function listAtolProfileKeys(): AtolProfileKey[] {
  return ['rp', 'mp'];
}

/** Профиль АТОЛ по ИНН организации сделки. */
export function resolveAtolProfileKey(input?: {
  organization_id?: string | null;
  inn?: string | null;
  legal_entity?: string | null;
}): AtolProfileKey {
  const legal = String(input?.legal_entity || '').trim().toLowerCase();
  if (legal === 'mp') return 'mp';
  if (legal === 'rp') return 'rp';
  const inn = String(input?.inn || '').replace(/\D/g, '');
  if (inn === BMP_ORG_INN) return 'mp';
  if (inn === '231215603728') return 'rp';
  const orgId = String(input?.organization_id || '').trim();
  if (orgId) {
    const row = get<{ inn: string }>(
      `SELECT IFNULL(inn,'') AS inn FROM organizations WHERE id = ? LIMIT 1`,
      [orgId]
    );
    const orgInn = String(row?.inn || '').replace(/\D/g, '');
    if (orgInn === BMP_ORG_INN) return 'mp';
    if (orgInn === '231215603728') return 'rp';
  }
  return 'rp';
}

export function getAtolSettingsForDeal(deal: Record<string, unknown>): AtolSettings {
  const key = resolveAtolProfileKey({
    organization_id: deal.organization_id as string | undefined,
    inn: deal.seller_inn as string | undefined,
    legal_entity: deal.fiscal_legal_entity as string | undefined,
  });
  return getAtolSettings(key);
}

export function saveAtolSettings(
  patch: Partial<Record<keyof AtolSettings, unknown>> & { profile?: AtolProfileKey }
): AtolSettings {
  const profile = (patch.profile === 'mp' ? 'mp' : 'rp') as AtolProfileKey;
  const store = readAtolStore();
  const normalized = normalizeAtolStore(store);
  const cur = normalized[profile];
  const next: AtolSettings = {
    api_url: pickStr(String(patch.api_url ?? ''), cur.api_url) || ATOL_DEFAULTS.api_url,
    login: applySecret(cur.login, patch.login, { clearable: true }),
    pass: applySecret(cur.pass, patch.pass),
    group_code: pickStr(String(patch.group_code ?? cur.group_code)),
    inn: pickStr(String(patch.inn ?? cur.inn)),
    sno: pickStr(String(patch.sno ?? cur.sno), ATOL_DEFAULTS.sno),
    company_email: pickStr(String(patch.company_email ?? cur.company_email)),
    payment_address: pickStr(
      String(patch.payment_address ?? cur.payment_address),
      ATOL_PROFILE_PRESETS[profile].payment_address || ATOL_DEFAULTS.payment_address
    ),
    client_email: pickStr(String(patch.client_email ?? cur.client_email)),
  };
  const profiles: Partial<Record<AtolProfileKey, AtolSettings>> = {
    ...normalized,
    [profile]: next,
  };
  writeMeta(META_ATOL, { profiles });
  return next;
}

function atolProfilePublic(key: AtolProfileKey, s: AtolSettings) {
  return {
    profile: key,
    label: key === 'mp' ? 'БМП · Фогель / Стрела' : 'БРП · Москва',
    configured: Boolean(s.login && s.pass && s.group_code),
    api_url: s.api_url,
    login: s.login,
    login_set: Boolean(s.login),
    pass: '',
    pass_set: Boolean(s.pass),
    pass_hint: maskHint(s.pass),
    group_code: s.group_code,
    inn: s.inn,
    sno: s.sno,
    company_email: s.company_email,
    payment_address: s.payment_address,
    client_email: s.client_email,
  };
}

export function atolSettingsPublic(s: AtolSettings = getAtolSettings()) {
  const store = readAtolStore();
  const normalized = normalizeAtolStore(store);
  const fromDb = Boolean(
    store.login ||
      store.pass ||
      store.group_code ||
      store.profiles?.rp?.login ||
      store.profiles?.mp?.login
  );
  const profiles = listAtolProfileKeys().map((k) => atolProfilePublic(k, normalized[k]));
  return {
    ...atolProfilePublic('rp', s),
    configured: profiles.some((p) => p.configured),
    profiles,
    source: fromDb ? 'db' : 'env',
    sno_options: [
      { id: 'osn', label: 'ОСН' },
      { id: 'usn_income', label: 'УСН доходы' },
      { id: 'usn_income_outcome', label: 'УСН доходы-расходы' },
      { id: 'envd', label: 'ЕНВД' },
      { id: 'esn', label: 'ЕСН' },
      { id: 'patent', label: 'Патент' },
    ],
  };
}

/* ——— Точка (мост WMS → bank) ——— */

const TOCHKA_DEFAULTS: TochkaBridgeSettings = {
  bank_sbp_key: '',
  overview_url: 'https://bank.pnevmopodveska1.ru/api/tochka_overview.php',
  sbp_create_url: 'https://bank.pnevmopodveska1.ru/api/sbp_create_qr.php',
  sbp_status_url: 'https://bank.pnevmopodveska1.ru/api/sbp_qr_status.php',
};

export function getTochkaBridgeSettings(): TochkaBridgeSettings {
  const stored = readMeta<TochkaBridgeSettings>(META_TOCHKA);
  return {
    bank_sbp_key: pickStr(
      stored.bank_sbp_key,
      process.env.BANK_SBP_KEY,
      process.env.WMS_BANK_API_KEY
    ),
    overview_url: pickStr(
      stored.overview_url,
      process.env.BANK_TOCHKA_OVERVIEW_URL,
      TOCHKA_DEFAULTS.overview_url
    ),
    sbp_create_url: pickStr(
      stored.sbp_create_url,
      process.env.BANK_SBP_CREATE_URL,
      TOCHKA_DEFAULTS.sbp_create_url
    ),
    sbp_status_url: pickStr(
      stored.sbp_status_url,
      process.env.BANK_SBP_STATUS_URL,
      TOCHKA_DEFAULTS.sbp_status_url
    ),
  };
}

export function saveTochkaBridgeSettings(
  patch: Partial<Record<keyof TochkaBridgeSettings, unknown>>
): TochkaBridgeSettings {
  const cur = getTochkaBridgeSettings();
  const next: TochkaBridgeSettings = {
    bank_sbp_key: applySecret(cur.bank_sbp_key, patch.bank_sbp_key),
    overview_url:
      pickStr(String(patch.overview_url ?? ''), cur.overview_url) || TOCHKA_DEFAULTS.overview_url,
    sbp_create_url:
      pickStr(String(patch.sbp_create_url ?? ''), cur.sbp_create_url) ||
      TOCHKA_DEFAULTS.sbp_create_url,
    sbp_status_url:
      pickStr(String(patch.sbp_status_url ?? ''), cur.sbp_status_url) ||
      TOCHKA_DEFAULTS.sbp_status_url,
  };
  writeMeta(META_TOCHKA, next);
  return next;
}

export function tochkaBridgePublic(s: TochkaBridgeSettings = getTochkaBridgeSettings()) {
  const stored = readMeta<TochkaBridgeSettings>(META_TOCHKA);
  return {
    configured: Boolean(s.bank_sbp_key),
    bank_sbp_key: '',
    bank_sbp_key_set: Boolean(s.bank_sbp_key),
    bank_sbp_key_hint: maskHint(s.bank_sbp_key),
    overview_url: s.overview_url,
    sbp_create_url: s.sbp_create_url,
    sbp_status_url: s.sbp_status_url,
    source: stored.bank_sbp_key ? 'db' : 'env',
    balances_path: '/money/tochka',
  };
}

/* ——— СДЭК (мост WMS → виджет) ——— */

const CDEK_DEFAULTS: CdekBridgeSettings = {
  wms_key: '',
  wms_url: 'https://widget.pnevmopodveska1.ru/cdek/wms_api.php',
  widget_url: 'https://widget.pnevmopodveska1.ru/cdek/deal.php?l={lead_id}',
};

export function getCdekBridgeSettings(): CdekBridgeSettings {
  const stored = readMeta<CdekBridgeSettings>(META_CDEK);
  const tochka = getTochkaBridgeSettings();
  return {
    wms_key: pickStr(
      stored.wms_key,
      process.env.CDEK_WMS_KEY,
      process.env.BANK_SBP_KEY,
      process.env.WMS_BANK_API_KEY,
      tochka.bank_sbp_key
    ),
    wms_url: pickStr(stored.wms_url, process.env.CDEK_WMS_URL, CDEK_DEFAULTS.wms_url),
    widget_url: pickStr(stored.widget_url, process.env.CDEK_WIDGET_URL, CDEK_DEFAULTS.widget_url),
  };
}

export function saveCdekBridgeSettings(
  patch: Partial<Record<keyof CdekBridgeSettings, unknown>>
): CdekBridgeSettings {
  const cur = getCdekBridgeSettings();
  const next: CdekBridgeSettings = {
    wms_key: applySecret(cur.wms_key, patch.wms_key),
    wms_url: pickStr(String(patch.wms_url ?? ''), cur.wms_url) || CDEK_DEFAULTS.wms_url,
    widget_url:
      pickStr(String(patch.widget_url ?? ''), cur.widget_url) || CDEK_DEFAULTS.widget_url,
  };
  writeMeta(META_CDEK, next);
  return next;
}

export function cdekBridgePublic(s: CdekBridgeSettings = getCdekBridgeSettings()) {
  const stored = readMeta<CdekBridgeSettings>(META_CDEK);
  return {
    configured: Boolean(s.wms_key),
    wms_key: '',
    wms_key_set: Boolean(s.wms_key),
    wms_key_hint: maskHint(s.wms_key),
    wms_url: s.wms_url,
    widget_url: s.widget_url,
    source: stored.wms_key ? 'db' : 'env',
    widget_index: 'https://widget.pnevmopodveska1.ru/cdek/',
  };
}

/* ——— DaData ——— */

export function getDadataSettings(): DadataSettings {
  const stored = readMeta<DadataSettings>(META_DADATA);
  return {
    api_key: pickStr(stored.api_key, process.env.DADATA_API_KEY, process.env.DADATA_TOKEN),
    secret: pickStr(stored.secret, process.env.DADATA_SECRET, process.env.DADATA_SECRET_KEY),
  };
}

export function saveDadataSettings(
  patch: Partial<Record<keyof DadataSettings, unknown>>
): DadataSettings {
  const cur = getDadataSettings();
  const next: DadataSettings = {
    api_key: applySecret(cur.api_key, patch.api_key),
    secret: applySecret(cur.secret, patch.secret),
  };
  writeMeta(META_DADATA, next);
  return next;
}

export function dadataPublic(s: DadataSettings = getDadataSettings()) {
  const stored = readMeta<DadataSettings>(META_DADATA);
  return {
    configured: Boolean(s.api_key),
    api_key: '',
    api_key_set: Boolean(s.api_key),
    api_key_hint: maskHint(s.api_key),
    secret: '',
    secret_set: Boolean(s.secret),
    secret_hint: maskHint(s.secret),
    source: stored.api_key ? 'db' : 'env',
    profile_url: 'https://dadata.ru/profile/#info',
  };
}

/* ——— Яндекс Пэй / Сплит (профиль на каждое юрлицо) ——— */

type YandexPayStore = {
  /** organization_id → настройки merchant */
  profiles?: Record<string, Omit<YandexPaySettings, 'organization_id'>>;
  /** legacy flat fields (до мульти-профилей) */
  merchant_id?: string;
  api_key?: string;
  env?: string;
  org_name?: string;
  org_id?: string;
  organization_id?: string;
  payment_methods?: string;
  enabled?: string;
};

const YANDEX_PAY_PROFILE_DEFAULTS: Omit<YandexPaySettings, 'organization_id'> = {
  merchant_id: '',
  api_key: '',
  env: 'sandbox',
  org_name: '',
  org_id: '',
  payment_methods: 'SPLIT',
  enabled: '0',
};

function readYandexPayStore(): YandexPayStore {
  return readMeta<YandexPayStore>(META_YANDEX_PAY) as YandexPayStore;
}

/** Нормализовать store: перенести legacy flat → profiles. */
function normalizeYandexPayStore(raw: YandexPayStore): {
  profiles: Record<string, Omit<YandexPaySettings, 'organization_id'>>;
} {
  const profiles: Record<string, Omit<YandexPaySettings, 'organization_id'>> = {
    ...(raw.profiles && typeof raw.profiles === 'object' ? { ...raw.profiles } : {}),
  };
  const legacyOrg = pickStr(raw.organization_id, process.env.YANDEX_PAY_ORGANIZATION_ID);
  const legacyMerchant = pickStr(raw.merchant_id, process.env.YANDEX_PAY_MERCHANT_ID);
  if (legacyMerchant && legacyOrg && !profiles[legacyOrg]) {
    profiles[legacyOrg] = {
      merchant_id: legacyMerchant,
      api_key: pickStr(raw.api_key, process.env.YANDEX_PAY_API_KEY),
      env: pickStr(raw.env, process.env.YANDEX_PAY_ENV, YANDEX_PAY_PROFILE_DEFAULTS.env),
      org_name: pickStr(raw.org_name, process.env.YANDEX_PAY_ORG_NAME),
      org_id: pickStr(raw.org_id, process.env.YANDEX_PAY_ORG_ID),
      payment_methods: pickStr(
        raw.payment_methods,
        process.env.YANDEX_PAY_METHODS,
        YANDEX_PAY_PROFILE_DEFAULTS.payment_methods
      ),
      enabled: pickStr(raw.enabled, process.env.YANDEX_PAY_ENABLED, '0'),
    };
  }
  // env-only без org — не кладём в profiles (нужно выбрать юрлицо в UI)
  return { profiles };
}

function emptyProfile(organizationId: string): YandexPaySettings {
  return { ...YANDEX_PAY_PROFILE_DEFAULTS, organization_id: organizationId };
}

/** Настройки Сплита для конкретного юрлица. */
export function getYandexPaySettingsForOrg(organizationId?: string | null): YandexPaySettings | null {
  const orgId = String(organizationId || '').trim();
  if (!orgId) return null;
  const { profiles } = normalizeYandexPayStore(readYandexPayStore());
  const p = profiles[orgId];
  if (!p) return null;
  return {
    organization_id: orgId,
    merchant_id: String(p.merchant_id || '').trim(),
    api_key: String(p.api_key || '').trim(),
    env: String(p.env || 'sandbox').trim() || 'sandbox',
    org_name: String(p.org_name || '').trim(),
    org_id: String(p.org_id || '').trim(),
    payment_methods: String(p.payment_methods || 'SPLIT').trim() || 'SPLIT',
    enabled: String(p.enabled || '0').trim() || '0',
  };
}

/** Все профили (с organization_id). */
export function listYandexPayProfiles(): YandexPaySettings[] {
  const { profiles } = normalizeYandexPayStore(readYandexPayStore());
  return Object.keys(profiles)
    .sort()
    .map((id) => getYandexPaySettingsForOrg(id)!)
    .filter(Boolean);
}

/**
 * @deprecated один профиль: первый enabled или первый любой / legacy.
 * Для оплаты используйте getYandexPaySettingsForOrg.
 */
export function getYandexPaySettings(): YandexPaySettings {
  const list = listYandexPayProfiles();
  const enabled = list.find((p) => p.enabled === '1' || p.enabled === 'true');
  if (enabled) return enabled;
  if (list[0]) return list[0];
  const envMerchant = pickStr(process.env.YANDEX_PAY_MERCHANT_ID);
  if (envMerchant) {
    return {
      ...YANDEX_PAY_PROFILE_DEFAULTS,
      organization_id: pickStr(process.env.YANDEX_PAY_ORGANIZATION_ID),
      merchant_id: envMerchant,
      api_key: pickStr(process.env.YANDEX_PAY_API_KEY),
      env: pickStr(process.env.YANDEX_PAY_ENV, 'sandbox'),
      enabled: pickStr(process.env.YANDEX_PAY_ENABLED, '0'),
      payment_methods: pickStr(process.env.YANDEX_PAY_METHODS, 'SPLIT'),
    };
  }
  return emptyProfile('');
}

/** Сохранить / обновить профиль юрлица. organization_id обязателен. */
export function saveYandexPaySettings(
  patch: Partial<Record<keyof YandexPaySettings, unknown>>
): YandexPaySettings {
  const orgId = pickStr(String(patch.organization_id ?? ''));
  if (!orgId) throw new Error('Выберите юрлицо (organization_id)');

  const cur = getYandexPaySettingsForOrg(orgId) || emptyProfile(orgId);
  const next: YandexPaySettings = {
    organization_id: orgId,
    merchant_id: pickStr(String(patch.merchant_id ?? ''), cur.merchant_id),
    api_key: applySecret(cur.api_key, patch.api_key),
    env: pickStr(String(patch.env ?? ''), cur.env, YANDEX_PAY_PROFILE_DEFAULTS.env),
    org_name: pickStr(String(patch.org_name ?? ''), cur.org_name),
    org_id: pickStr(String(patch.org_id ?? ''), cur.org_id),
    payment_methods: pickStr(
      String(patch.payment_methods ?? ''),
      cur.payment_methods,
      YANDEX_PAY_PROFILE_DEFAULTS.payment_methods
    ),
    enabled:
      patch.enabled === true || patch.enabled === 1 || patch.enabled === '1' || patch.enabled === 'true'
        ? '1'
        : patch.enabled === false ||
            patch.enabled === 0 ||
            patch.enabled === '0' ||
            patch.enabled === 'false'
          ? '0'
          : pickStr(String(patch.enabled ?? ''), cur.enabled, '0'),
  };

  const store = readYandexPayStore();
  const { profiles } = normalizeYandexPayStore(store);
  const { organization_id: _oid, ...rest } = next;
  profiles[orgId] = rest;
  // пишем только profiles — без legacy flat
  writeMeta(META_YANDEX_PAY, { profiles });
  return next;
}

export function deleteYandexPayProfile(organizationId: string): { ok: true; organization_id: string } {
  const orgId = String(organizationId || '').trim();
  if (!orgId) throw new Error('organization_id required');
  const store = readYandexPayStore();
  const { profiles } = normalizeYandexPayStore(store);
  delete profiles[orgId];
  writeMeta(META_YANDEX_PAY, { profiles });
  return { ok: true, organization_id: orgId };
}

export function yandexPayProfilePublic(s: YandexPaySettings) {
  return {
    organization_id: s.organization_id,
    configured: Boolean(s.merchant_id && (s.api_key || s.env === 'sandbox')),
    enabled: s.enabled === '1' || s.enabled === 'true',
    merchant_id: s.merchant_id,
    api_key: '',
    api_key_set: Boolean(s.api_key),
    api_key_hint: maskHint(s.api_key),
    env: s.env === 'production' ? 'production' : 'sandbox',
    org_name: s.org_name,
    org_id: s.org_id,
    payment_methods: s.payment_methods,
  };
}

export function yandexPaySettingsPublic(s?: YandexPaySettings) {
  const profiles = listYandexPayProfiles().map(yandexPayProfilePublic);
  const one = s || getYandexPaySettings();
  return {
    ...yandexPayProfilePublic(one),
    profiles,
    source: profiles.length ? 'db' : 'env',
    org_url: 'https://id.yandex.ru/org',
    console_url: 'https://pay.yandex.ru/',
    docs_url: 'https://pay.yandex.ru/docs/ru/custom/integration-guide-link.md',
    callback_url_hint: 'https://widget.pnevmopodveska1.ru/yandex-pay',
  };
}

/** Есть ли хотя бы один включённый профиль с ключами. */
export function yandexPayAnyConfigured(): boolean {
  return listYandexPayProfiles().some(
    (p) =>
      (p.enabled === '1' || p.enabled === 'true') &&
      Boolean(p.merchant_id && (p.api_key || p.env === 'sandbox'))
  );
}

export function getDeepseekSettings(): DeepseekSettings {
  const stored = readMeta<DeepseekSettings>(META_DEEPSEEK);
  return {
    api_key: pickStr(stored.api_key, process.env.DEEPSEEK_API_KEY),
    base_url: pickStr(
      stored.base_url,
      process.env.DEEPSEEK_BASE_URL,
      'https://openrouter.ai/api/v1'
    ),
    vision_model: pickStr(
      stored.vision_model,
      process.env.DEEPSEEK_VISION_MODEL,
      'deepseek/deepseek-vl2'
    ),
  };
}

export function saveDeepseekSettings(
  patch: Partial<Record<keyof DeepseekSettings, unknown>>
): DeepseekSettings {
  const cur = getDeepseekSettings();
  const next: DeepseekSettings = {
    api_key: applySecret(cur.api_key, patch.api_key),
    base_url: pickStr(
      String(patch.base_url ?? ''),
      cur.base_url,
      'https://openrouter.ai/api/v1'
    ),
    vision_model: pickStr(
      String(patch.vision_model ?? ''),
      cur.vision_model,
      'deepseek/deepseek-vl2'
    ),
  };
  writeMeta(META_DEEPSEEK, next);
  return next;
}

export function deepseekPublic(s?: DeepseekSettings) {
  const cur = s || getDeepseekSettings();
  const base = String(cur.base_url || '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
  const visionOk = Boolean(
    cur.api_key &&
      base &&
      base !== 'https://api.deepseek.com' &&
      base !== 'https://api.deepseek.com/v1' &&
      !/^https?:\/\/api\.deepseek\.com\/?$/.test(base)
  );
  return {
    configured: Boolean(cur.api_key),
    vision_ok: visionOk,
    api_key: '',
    api_key_set: Boolean(cur.api_key),
    api_key_hint: maskHint(cur.api_key),
    base_url: cur.base_url,
    vision_model: cur.vision_model,
    docs_url: 'https://openrouter.ai/deepseek/deepseek-vl2',
    hint: visionOk
      ? ''
      : 'Для фото СТС нужен vision-шлюз (OpenRouter), не api.deepseek.com',
  };
}
