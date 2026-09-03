/**
 * Native СДЭК через виджет (widget.pnevmopodveska1.ru) — OAuth client_id/secret
 * живут только на виджете; Учёт №1 ходит по machine API с X-Wms-Key.
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { get, run } from './db.js';
import { getCdekBridgeSettings } from './integration-settings.js';
import { cdekWidgetUrl } from './ops.js';

/** Публичный URL PDF ярлыка СДЭК (barcode.php на виджете). */
export function cdekPublicBaseUrl(): string {
  const wms = getCdekBridgeSettings().wms_url;
  try {
    const u = new URL(wms);
    return `${u.origin}${u.pathname.replace(/\/wms_api\.php$/i, '')}`;
  } catch {
    return 'https://widget.pnevmopodveska1.ru/cdek';
  }
}

export function cdekBarcodePublicUrl(leadId: string, track: string): string {
  const id = String(leadId || '').trim();
  const num = String(track || '').trim();
  if (!id || !num) return '';
  const sign = createHmac('sha256', 'pnevmo-cdek-barcode-v1')
    .update(`${id}|${num}`)
    .digest('hex')
    .slice(0, 20);
  const qs = new URLSearchParams({ l: id, n: num, s: sign });
  return `${cdekPublicBaseUrl()}/barcode.php?${qs.toString()}`;
}

function resolveCdekBarcodeUrl(leadId: string, track: string, explicit?: string): string {
  const url = String(explicit || '').trim();
  if (url) return url;
  return cdekBarcodePublicUrl(leadId, track);
}

const WIDGET_DEALS_DIRS = (): string[] =>
  [
    process.env.CDEK_WIDGET_DEALS_DIR,
    '/root/widget_pnevmopodveska1_ru/public_html/cdek/data/deals',
  ].filter((v): v is string => !!String(v || '').trim());

/** Локальный кэш виджета (data/deals/*.json) на том же VPS. */
export function loadCdekDealFromWidgetCache(leadId: string): CdekShipment | null {
  const id = String(leadId || '').trim();
  if (!id) return null;
  for (const dir of WIDGET_DEALS_DIRS()) {
    try {
      const path = join(dir, `${id}.json`);
      if (!existsSync(path)) continue;
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      const num = String(raw.cdek_number || '').trim();
      if (!num) continue;
      const barcode = resolveCdekBarcodeUrl(id, num, String(raw.cdek_barcode_url || ''));
      return {
        ok: true,
        lead_id: Number(id) || 0,
        cdek_number: num,
        cdek_uuid: String(raw.cdek_uuid || ''),
        cdek_barcode_url: barcode,
        cdek_status_code: String(raw.cdek_last_status_code || ''),
        cdek_status_name: String(raw.cdek_last_status_name || raw.cdek_status_text || ''),
        delivery_cost: (raw.delivery_cost as number | null | undefined) ?? null,
        delivery_city: String(raw.delivery_city || ''),
        delivery_point: String(raw.delivery_point || ''),
        delivery_address: String(raw.delivery_address || ''),
        recipient_name: String(raw.recipient_name || ''),
        recipient_phone: String(raw.recipient_phone || ''),
        shipment_method_title: String(raw.shipment_method_title || ''),
        tariff_code: (raw.tariff_code as number | null | undefined) ?? null,
        has_order: true,
        widget_url: cdekWidgetUrl(id),
        native_api: false,
        updated_at: String(raw.updated_at || ''),
      };
    } catch {
      /* next dir */
    }
  }
  return null;
}

function mergeWidgetCache(leadId: string, base: CdekShipment): CdekShipment {
  if (base.cdek_number && base.cdek_barcode_url) return base;
  const cached = loadCdekDealFromWidgetCache(leadId);
  if (!cached) return base;
  const num = String(base.cdek_number || cached.cdek_number || '').trim();
  const barcode =
    String(base.cdek_barcode_url || cached.cdek_barcode_url || '').trim() ||
    (num ? cdekBarcodePublicUrl(leadId, num) : '');
  return {
    ...base,
    ok: true,
    cdek_number: num,
    cdek_barcode_url: barcode,
    cdek_uuid: String(base.cdek_uuid || cached.cdek_uuid || ''),
    has_order: base.has_order || cached.has_order,
    cdek_status_code: String(base.cdek_status_code || cached.cdek_status_code || ''),
    cdek_status_name: String(base.cdek_status_name || cached.cdek_status_name || ''),
  };
}

export type CdekShipment = {
  ok: boolean;
  lead_id: number;
  account_id?: string;
  account_title?: string;
  cdek_number: string;
  cdek_uuid: string;
  cdek_barcode_url: string;
  cdek_status_code: string;
  cdek_status_name: string;
  delivery_cost?: number | null;
  shipment_point?: string;
  delivery_city?: string;
  delivery_point?: string;
  delivery_address?: string;
  recipient_name?: string;
  recipient_phone?: string;
  shipment_method_title?: string;
  tariff_code?: number | null;
  has_order: boolean;
  widget_url: string;
  native_api: boolean;
  updated_at?: string;
  refresh?: { ok?: boolean; changed?: boolean; message?: string } | null;
  error?: string;
};

export type CdekAccountPublic = {
  id: string;
  title: string;
  hint?: string;
  cdek_client_id: string;
  cdek_client_secret: string;
  cdek_client_secret_set: boolean;
  cdek_account: string;
  cdek_password: string;
  cdek_password_set: boolean;
  branch_value: string;
  shipment_point: string;
  from_city: string;
  from_city_code: string;
  from_address: string;
  from_postal_code: string;
  from_lat: string;
  from_lon: string;
  sender_company: string;
  sender_name: string;
  sender_phone: string;
  api_status?: string;
  api_status_message?: string;
  api_status_at?: string;
  pvz_cache?: {
    points_count?: number;
    cities_count?: number;
    refreshed_at?: string;
  } | null;
};

export type CdekSettings = {
  ok: boolean;
  branch_field_id: number;
  branch_enums: string[];
  branch_enums_loaded_at?: string | null;
  yandex_api_key: string;
  map_show_pvz: boolean;
  map_show_postamat: boolean;
  default_delivery_payer: string;
  default_cod_enabled: boolean;
  widget_url: string;
  shipment_methods: Array<{
    id: string;
    title: string;
    tariff_code: number;
    delivery_mode: string;
  }>;
  status_notes?: Array<{
    code: string;
    name: string;
    action_type?: string;
    enabled?: boolean;
    is_terminal?: boolean;
    seen_count?: number;
  }>;
  accounts: CdekAccountPublic[];
  updated_at?: string | null;
  source?: string;
  saved?: boolean;
  message?: string;
  error?: string;
  settings_home?: string;
};

export type CdekDealRow = CdekShipment & {
  order_items?: unknown[];
  package_weight_g?: number | null;
  package_length_cm?: number | null;
  package_width_cm?: number | null;
  package_height_cm?: number | null;
  delivery_payer?: string;
  cod_enabled?: boolean;
};

function cdekWmsUrl(): string {
  return getCdekBridgeSettings().wms_url;
}

function cdekWmsKey(): string {
  return getCdekBridgeSettings().wms_key;
}

export function cdekConfigured(): boolean {
  return cdekWmsKey() !== '';
}

type WmsAction =
  | 'shipment'
  | 'refresh'
  | 'settings'
  | 'settings_save'
  | 'deals'
  | 'deal'
  | 'load_branches'
  | 'check_api'
  | 'refresh_pvz_cache'
  | 'load_category_defaults'
  | 'save_category_defaults'
  | 'pick_pack'
  | 'pick_pack_save'
  | 'pick_regenerate';

async function callCdekWmsRaw(
  action: WmsAction,
  opts: {
    leadId?: string;
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
    query?: Record<string, string | number>;
  } = {}
): Promise<Record<string, unknown>> {
  const key = cdekWmsKey();
  if (!key) {
    return {
      ok: false,
      error: 'Не задан ключ СДЭК (Настройки → Интеграции → СДЭК)',
    };
  }

  const url = new URL(cdekWmsUrl());
  url.searchParams.set('action', action);
  if (opts.leadId) {
    url.searchParams.set('lead_id', opts.leadId);
  }
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      url.searchParams.set(k, String(v));
    }
  }

  const method = opts.method || (action === 'settings_save' || action === 'refresh' ? 'POST' : 'GET');
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Wms-Key': key,
  };
  let body: string | undefined;
  if (opts.body && method === 'POST') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ action, ...opts.body });
  }

  const res = await fetch(url.toString(), { method, headers, body });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      error: `СДЭК wms_api: не JSON (HTTP ${res.status})`,
    };
  }
  if (!res.ok && data.ok !== true) {
    return {
      ...data,
      ok: false,
      error: String(data.error || data.message || `HTTP ${res.status}`),
    };
  }
  return data;
}

function emptyShipment(leadId: string, error?: string): CdekShipment {
  return {
    ok: false,
    lead_id: Number(leadId) || 0,
    cdek_number: '',
    cdek_uuid: '',
    cdek_barcode_url: '',
    cdek_status_code: '',
    cdek_status_name: '',
    has_order: false,
    widget_url: cdekWidgetUrl(leadId),
    native_api: false,
    error,
  };
}

function asShipment(data: Record<string, unknown>, leadId: string): CdekShipment {
  const cdekNum = String(data.cdek_number || '');
  if (data.ok === false) {
    return {
      ...emptyShipment(leadId, String(data.error || 'ошибка')),
      cdek_number: cdekNum,
      cdek_uuid: String(data.cdek_uuid || ''),
      cdek_barcode_url: resolveCdekBarcodeUrl(leadId, cdekNum, String(data.cdek_barcode_url || '')),
      cdek_status_code: String(data.cdek_status_code || ''),
      cdek_status_name: String(data.cdek_status_name || ''),
      has_order: Boolean(data.has_order),
      widget_url: String(data.widget_url || cdekWidgetUrl(leadId)),
      native_api: true,
    };
  }
  return {
    ok: true,
    lead_id: Number(data.lead_id || leadId) || 0,
    account_id: String(data.account_id || ''),
    account_title: String(data.account_title || ''),
    cdek_number: cdekNum,
    cdek_uuid: String(data.cdek_uuid || ''),
    cdek_barcode_url: resolveCdekBarcodeUrl(leadId, cdekNum, String(data.cdek_barcode_url || '')),
    cdek_status_code: String(data.cdek_status_code || ''),
    cdek_status_name: String(data.cdek_status_name || ''),
    delivery_cost: (data.delivery_cost as number | null | undefined) ?? null,
    shipment_point: String(data.shipment_point || data.delivery_point || ''),
    delivery_city: String(data.delivery_city || ''),
    delivery_point: String(data.delivery_point || ''),
    delivery_address: String(data.delivery_address || ''),
    recipient_name: String(data.recipient_name || ''),
    recipient_phone: String(data.recipient_phone || ''),
    shipment_method_title: String(data.shipment_method_title || ''),
    tariff_code: (data.tariff_code as number | null | undefined) ?? null,
    has_order: Boolean(data.has_order),
    widget_url: String(data.widget_url || cdekWidgetUrl(leadId)),
    native_api: true,
    updated_at: String(data.updated_at || ''),
    refresh: (data.refresh as CdekShipment['refresh']) ?? null,
  };
}

async function callCdekWms(
  action: 'shipment' | 'refresh',
  leadId: string
): Promise<CdekShipment> {
  const data = await callCdekWmsRaw(action, {
    leadId,
    method: action === 'refresh' ? 'POST' : 'GET',
  });
  return asShipment(data, leadId);
}

export async function fetchCdekShipment(leadId: string): Promise<CdekShipment> {
  const id = String(leadId || '').trim();
  if (!cdekWmsKey()) {
    return mergeWidgetCache(id, emptyShipment(id, 'Не задан ключ СДЭК (Настройки → Интеграции → СДЭК)'));
  }
  const ship = mergeWidgetCache(id, await callCdekWms('shipment', id));
  return ship;
}

export async function refreshCdekShipment(leadId: string): Promise<CdekShipment> {
  return callCdekWms('refresh', leadId);
}

export async function fetchCdekSettings(): Promise<CdekSettings> {
  const data = await callCdekWmsRaw('settings');
  if (data.ok === false) {
    return {
      ok: false,
      branch_field_id: 0,
      branch_enums: [],
      yandex_api_key: '',
      map_show_pvz: true,
      map_show_postamat: false,
      default_delivery_payer: 'client',
      default_cod_enabled: false,
      widget_url: '',
      shipment_methods: [],
      accounts: [],
      error: String(data.error || 'Не удалось загрузить настройки СДЭК'),
    };
  }
  return data as unknown as CdekSettings;
}

export async function saveCdekSettings(
  body: Record<string, unknown>
): Promise<CdekSettings> {
  const data = await callCdekWmsRaw('settings_save', {
    method: 'POST',
    body,
  });
  if (data.ok === false) {
    return {
      ok: false,
      branch_field_id: 0,
      branch_enums: [],
      yandex_api_key: '',
      map_show_pvz: true,
      map_show_postamat: false,
      default_delivery_payer: 'client',
      default_cod_enabled: false,
      widget_url: '',
      shipment_methods: [],
      accounts: [],
      error: String(data.error || 'Не удалось сохранить настройки СДЭК'),
    };
  }
  return data as unknown as CdekSettings;
}

/** Произвольное действие machine API виджета (ветки / API check / ПВЗ / габариты). */
export async function callCdekWidgetAction(
  action: WmsAction,
  body: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const postish = new Set([
    'settings_save',
    'refresh',
    'load_branches',
    'check_api',
    'refresh_pvz_cache',
    'save_category_defaults',
    'pick_pack_save',
    'pick_regenerate',
  ]);
  return callCdekWmsRaw(action, {
    method: postish.has(action) ? 'POST' : 'GET',
    body,
    leadId: String(body.lead_id || body.deal_id || ''),
  });
}

export async function fetchCdekPickPack(leadId: string): Promise<Record<string, unknown>> {
  return callCdekWmsRaw('pick_pack' as WmsAction, { leadId });
}

export async function saveCdekPickPack(
  leadId: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return callCdekWmsRaw('pick_pack_save' as WmsAction, {
    leadId,
    method: 'POST',
    body: { lead_id: leadId, ...body },
  });
}

export async function regenerateCdekPickShipment(
  leadId: string,
  body: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  return callCdekWmsRaw('pick_regenerate' as WmsAction, {
    leadId,
    method: 'POST',
    body: { lead_id: leadId, ...body },
  });
}

export async function listCdekDeals(limit = 300): Promise<{
  ok: boolean;
  items: CdekDealRow[];
  count: number;
  error?: string;
  source?: string;
}> {
  const data = await callCdekWmsRaw('deals', { query: { limit } });
  if (data.ok === false) {
    return {
      ok: false,
      items: [],
      count: 0,
      error: String(data.error || 'Не удалось загрузить сделки СДЭК'),
    };
  }
  const items = Array.isArray(data.items) ? (data.items as CdekDealRow[]) : [];
  return {
    ok: true,
    items,
    count: Number(data.count || items.length) || items.length,
    source: String(data.source || ''),
  };
}

export async function fetchCdekDeal(leadId: string): Promise<CdekDealRow> {
  const data = await callCdekWmsRaw('deal', { leadId });
  return asShipment(data, leadId) as CdekDealRow;
}

/** Подтянуть трек из виджета в warehouse_tasks.track_number. */
export async function syncTaskCdekTrack(input: {
  taskId: string;
  refresh?: boolean;
  actor_id?: string;
}): Promise<{ task: Record<string, unknown>; cdek: CdekShipment }> {
  const task = get(`SELECT * FROM warehouse_tasks WHERE id = ?`, [input.taskId]) as
    | { id: string; deal_id: string; track_number?: string }
    | undefined;
  if (!task) throw new Error('Задание не найдено');
  const dealId = String(task.deal_id || '').trim();
  if (!dealId) throw new Error('У задания нет deal_id');

  const cdek = input.refresh
    ? await refreshCdekShipment(dealId)
    : await fetchCdekShipment(dealId);

  const track = String(cdek.cdek_number || '').trim();
  if (track && track !== String(task.track_number || '').trim()) {
    run(
      `UPDATE warehouse_tasks SET track_number = ?, updated_at = datetime('now') WHERE id = ?`,
      [track, input.taskId]
    );
  }

  const updated = get(`SELECT * FROM warehouse_tasks WHERE id = ?`, [input.taskId]) as Record<
    string,
    unknown
  >;
  return { task: updated, cdek };
}
