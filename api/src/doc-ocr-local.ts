/**
 * Локальный OCR документов (СТС) — только свой сервер, без внешней сети.
 * Сервис: deploy/ocr-local → http://127.0.0.1:3105
 */
import { get, run } from './db.js';
import type { StsOcrImage, StsOcrResult, StsVehicleFields } from './sts-ocr.js';
import { sanitizeStsVehicle, stsVehicleQualityOk, decodeStsImages } from './sts-ocr.js';

const META_KEY = 'ocr_local_settings';

export type OcrMode = 'local' | 'cloud' | 'off';

export type OcrLocalSettings = {
  /** local = только on-prem; cloud = старый DeepSeek/CF; off = только ручной ввод */
  mode: OcrMode;
  base_url: string;
};

const EMPTY_VEHICLE: StsVehicleFields = {
  car_plate: '',
  car_vin: '',
  car_brand: '',
  car_model: '',
  car_year: '',
  car_color: '',
  car_category: '',
  car_pts: '',
  car_owner: '',
  car_owner_street: '',
  car_owner_house: '',
  car_owner_flat: '',
  car_sts_date: '',
  car_sts_number: '',
};

function defaultSettings(): OcrLocalSettings {
  const envUrl = String(process.env.OCR_LOCAL_URL || '').trim();
  const envMode = String(process.env.OCR_MODE || '').trim().toLowerCase();
  let mode: OcrMode = 'local';
  if (envMode === 'cloud' || envMode === 'off' || envMode === 'local') mode = envMode;
  return {
    mode,
    base_url: envUrl || 'http://127.0.0.1:3105',
  };
}

export function getOcrLocalSettings(): OcrLocalSettings {
  const d = defaultSettings();
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [META_KEY]);
  if (!row?.value) return d;
  try {
    const j = JSON.parse(row.value) as Partial<OcrLocalSettings>;
    const mode = String(j.mode || d.mode).toLowerCase();
    return {
      mode: mode === 'cloud' || mode === 'off' || mode === 'local' ? mode : d.mode,
      base_url: String(j.base_url || d.base_url).trim() || d.base_url,
    };
  } catch {
    return d;
  }
}

export function saveOcrLocalSettings(patch: Partial<OcrLocalSettings>): OcrLocalSettings {
  const cur = getOcrLocalSettings();
  const modeRaw = String(patch.mode ?? cur.mode).toLowerCase();
  const next: OcrLocalSettings = {
    mode: modeRaw === 'cloud' || modeRaw === 'off' || modeRaw === 'local' ? modeRaw : cur.mode,
    base_url: String(patch.base_url ?? cur.base_url).trim() || cur.base_url,
  };
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [META_KEY, JSON.stringify(next)]);
  return next;
}

export function ocrLocalPublic(s?: OcrLocalSettings) {
  const cur = s || getOcrLocalSettings();
  return {
    mode: cur.mode,
    base_url: cur.base_url,
    binds_localhost: /127\.0\.0\.1|localhost/i.test(cur.base_url),
    hint:
      cur.mode === 'local'
        ? 'Документы распознаются только на вашем сервере (фото не уходят во внешние API).'
        : cur.mode === 'off'
          ? 'OCR выключен — только ручной ввод полей.'
          : 'Режим cloud: фото могут уходить на внешний vision-шлюз (не для ПДн).',
  };
}

export async function ocrLocalHealth(
  settings?: OcrLocalSettings
): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }> {
  const s = settings || getOcrLocalSettings();
  const base = s.base_url.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* raw */
    }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function recognizeStsViaLocal(
  images: StsOcrImage[],
  settings?: OcrLocalSettings
): Promise<StsOcrResult> {
  const buffers = decodeStsImages(images);
  const s = settings || getOcrLocalSettings();
  const base = s.base_url.replace(/\/+$/, '');
  const payload = {
    doc_type: 'sts' as const,
    images: buffers.map((b) => ({
      mime: b.mime,
      data_base64: b.buf.toString('base64'),
    })),
  };
  const res = await fetch(`${base}/ocr/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let j: {
    ok?: boolean;
    error?: string;
    vehicle?: StsVehicleFields;
    model?: string;
    raw_text?: string;
    image_sides?: Array<'front' | 'back' | 'unknown'>;
  } = {};
  try {
    j = JSON.parse(text) as typeof j;
  } catch {
    throw new Error(`OCR local HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  if (!res.ok) {
    throw new Error(j.error || `OCR local HTTP ${res.status}`);
  }
  const vehicle = sanitizeStsVehicle({ ...EMPTY_VEHICLE, ...(j.vehicle || {}) });
  const sides =
    Array.isArray(j.image_sides) && j.image_sides.length
      ? j.image_sides
      : buffers.map(() => 'unknown' as const);
  // Частичный результат тоже отдаём — UI покажет warn, поля не затрутся пустотой зря
  if (!stsVehicleQualityOk(vehicle)) {
    const anyField = Object.values(vehicle).some((v) => Boolean(v));
    if (!anyField) {
      throw new Error(
        j.error ||
          'Локальный OCR не вытащил поля СТС. Переснимите ближе / без бликов или введите вручную.'
      );
    }
  }
  return {
    vehicle,
    model: String(j.model || 'ocr-local'),
    raw_text: String(j.raw_text || ''),
    image_sides: sides,
    buffers,
  };
}

export type PassportOcrFields = {
  fio: string;
  passport: string;
  buyer_name: string;
  buyer_passport: string;
};

export type PassportOcrResult = {
  fields: PassportOcrFields;
  model: string;
  raw_text: string;
  warn?: string;
};

function emptyPassportFields(): PassportOcrFields {
  return { fio: '', passport: '', buyer_name: '', buyer_passport: '' };
}

/** Паспорт РФ → ФИО + серия/номер. Фото в OCR уходит только в RAM, на диск не пишем. */
export async function recognizePassportViaLocal(
  images: StsOcrImage[],
  settings?: OcrLocalSettings
): Promise<PassportOcrResult> {
  const buffers = decodeStsImages(images);
  if (!buffers.length) {
    throw new Error('Прикрепите фото разворота паспорта с ФИО');
  }
  const s = settings || getOcrLocalSettings();
  if (s.mode === 'off') {
    throw new Error('OCR выключен (Настройки → OCR документов). Введите ФИО вручную.');
  }
  if (s.mode !== 'local') {
    throw new Error(
      'Паспорт распознаётся только локально (режим local). Cloud для ПДн не используем — введите вручную или включите local OCR.'
    );
  }
  const base = s.base_url.replace(/\/+$/, '');
  const payload = {
    doc_type: 'passport_rf' as const,
    images: buffers.map((b) => ({
      mime: b.mime,
      data_base64: b.buf.toString('base64'),
    })),
  };
  const res = await fetch(`${base}/ocr/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let j: {
    ok?: boolean;
    error?: string;
    fields?: Partial<PassportOcrFields>;
    model?: string;
    raw_text?: string;
  } = {};
  try {
    j = JSON.parse(text) as typeof j;
  } catch {
    throw new Error(`OCR local HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  if (!res.ok) {
    throw new Error(j.error || `OCR local HTTP ${res.status}`);
  }
  const raw = j.fields || {};
  const fio = String(raw.fio || raw.buyer_name || '').trim();
  const passport = String(raw.passport || raw.buyer_passport || '').trim();
  const fields: PassportOcrFields = {
    ...emptyPassportFields(),
    fio,
    passport,
    buyer_name: fio,
    buyer_passport: passport,
  };
  if (!fio && !passport) {
    throw new Error(
      j.error ||
        'Не удалось вытащить ФИО/серию из фото — переснимите разворот с ФИО или введите вручную.'
    );
  }
  return {
    fields,
    model: String(j.model || 'ocr-local'),
    raw_text: String(j.raw_text || ''),
    warn: j.ok === false ? String(j.error || '') : undefined,
  };
}

/** Есть ли рабочий локальный сервис (для UI / configured). */
export async function ocrLocalConfigured(): Promise<boolean> {
  const s = getOcrLocalSettings();
  if (s.mode === 'off') return false;
  if (s.mode !== 'local') return false;
  const h = await ocrLocalHealth(s);
  return h.ok;
}
