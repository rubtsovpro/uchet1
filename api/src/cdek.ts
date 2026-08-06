/**
 * Native СДЭК через виджет (widget.pnevmopodveska1.ru) — OAuth client_id/secret
 * живут только на виджете; Учёт №1 ходит по machine API с X-Wms-Key.
 */
import { get, run } from './db.js';
import { getCdekBridgeSettings } from './integration-settings.js';
import { cdekWidgetUrl } from './ops.js';

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
  | 'save_category_defaults';

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
  if (data.ok === false) {
    return {
      ...emptyShipment(leadId, String(data.error || 'ошибка')),
      cdek_number: String(data.cdek_number || ''),
      cdek_uuid: String(data.cdek_uuid || ''),
      cdek_barcode_url: String(data.cdek_barcode_url || ''),
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
    cdek_number: String(data.cdek_number || ''),
    cdek_uuid: String(data.cdek_uuid || ''),
    cdek_barcode_url: String(data.cdek_barcode_url || ''),
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
  return callCdekWms('shipment', leadId);
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
  ]);
  return callCdekWmsRaw(action, {
    method: postish.has(action) ? 'POST' : 'GET',
    body,
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
