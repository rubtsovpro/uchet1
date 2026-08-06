/**
 * Распознавание СТС (свидетельство о регистрации ТС) через DeepSeek / OpenAI-compatible vision.
 * Ключ: DEEPSEEK_API_KEY или Настройки → Интеграции → DeepSeek.
 * Если официальный api.deepseek.com без vision — укажите DEEPSEEK_BASE_URL на шлюз с VL (OpenRouter и т.п.).
 */
import jpegJs from 'jpeg-js';
import {
  getDeepseekSettings,
  type DeepseekSettings,
} from './integration-settings.js';

export type StsVehicleFields = {
  car_plate: string;
  car_vin: string;
  car_brand: string;
  car_model: string;
  car_year: string;
  car_color: string;
  car_category: string;
  car_pts: string;
  car_owner: string;
  car_owner_street: string;
  car_owner_house: string;
  car_owner_flat: string;
  car_sts_date: string;
  car_sts_number: string;
};

export type StsOcrImage = {
  mime?: string;
  data_base64: string;
};

const EMPTY: StsVehicleFields = {
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

const PROMPT = `Ты распознаёшь российское Свидетельство о регистрации ТС (СТС).
Фото приходят без подписи стороны — сам определи, где лицевая, где оборот.
Лицевая: госномер, VIN, марка/модель, год, цвет, категория, серия/номер СТС.
Оборот: собственник, адрес, паспорт ТС (ПТС), особые отметки.
Верни ТОЛЬКО JSON без markdown:
{
  "car_plate": "госномер без пробелов, кириллица",
  "car_vin": "VIN латиницей",
  "car_brand": "марка (BMW, БМВ…)",
  "car_model": "модель",
  "car_year": "год выпуска YYYY",
  "car_color": "цвет",
  "car_category": "категория ТС (B, B/M1…)",
  "car_pts": "паспорт ТС серия и номер",
  "car_owner": "собственник ФИО или организация",
  "car_owner_street": "улица без слова дом",
  "car_owner_house": "дом / корпус",
  "car_owner_flat": "квартира",
  "car_sts_date": "дата выдачи ДД.ММ.ГГГГ",
  "car_sts_number": "серия и номер свидетельства",
  "image_sides": ["front"|"back"|"unknown", ...]
}
image_sides — по одному элементу на каждое фото в том же порядке, что прислали.
Если поля нет на фото — пустая строка "". Не выдумывай.`;

function stripDataUrl(b64: string): { mime: string; data: string } {
  const s = String(b64 || '').trim();
  const m = /^data:([^;]+);base64,(.+)$/i.exec(s);
  if (m) return { mime: m[1], data: m[2].replace(/\s/g, '') };
  return { mime: 'image/jpeg', data: s.replace(/\s/g, '') };
}

function normalizePlate(v: string): string {
  return String(v || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[A-Z]/g, (ch) => {
      const map: Record<string, string> = {
        A: 'А',
        B: 'В',
        E: 'Е',
        K: 'К',
        M: 'М',
        H: 'Н',
        O: 'О',
        P: 'Р',
        C: 'С',
        T: 'Т',
        Y: 'У',
        U: 'У',
        X: 'Х',
      };
      return map[ch] || ch;
    });
}

function looksLikeVin(s: string): boolean {
  const t = String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return t.length >= 11 && t.length <= 17 && /^[A-HJ-NPR-Z0-9]+$/.test(t) && /\d/.test(t);
}

function isValidRuPlate(s: string): boolean {
  return /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/.test(normalizePlate(s));
}

function normalizeColor(v: string): string {
  const s = String(v || '')
    .trim()
    .toLowerCase();
  const map: Record<string, string> = {
    black: 'чёрный',
    white: 'белый',
    silver: 'серебристый',
    gray: 'серый',
    grey: 'серый',
    blue: 'синий',
    red: 'красный',
    green: 'зелёный',
    yellow: 'жёлтый',
    brown: 'коричневый',
    orange: 'оранжевый',
    beige: 'бежевый',
  };
  return map[s] || String(v || '').trim();
}

/** Отсечь галлюцинации vision-моделей (VIN→госномер, Touring, Moscow, KYA…). */
export function sanitizeStsVehicle(fields: StsVehicleFields): StsVehicleFields {
  const out: StsVehicleFields = { ...EMPTY, ...fields };
  const junk =
    /госномер|латиницей|год выпуска|серия и номер|YYYY|ДД\.ММ|^unknown$|^n\/?a$|^none$|^null$|^not available$|^не указан|^touring$|^sedan$|^suv$|^hatchback$|^coupe$|^wagon$/i;
  for (const k of Object.keys(EMPTY) as Array<keyof StsVehicleFields>) {
    const v = String(out[k] || '').trim();
    if (!v || junk.test(v)) out[k] = '';
  }

  if (out.car_plate) {
    const raw = out.car_plate.replace(/\s+/g, '');
    if (looksLikeVin(raw)) {
      if (!out.car_vin) {
        out.car_vin = raw
          .toUpperCase()
          .replace(/[^A-HJ-NPR-Z0-9]/g, '')
          .slice(0, 17);
      }
      out.car_plate = '';
    } else {
      const p = normalizePlate(out.car_plate);
      out.car_plate = isValidRuPlate(p) ? p : '';
    }
  }

  if (out.car_vin) {
    const vin = out.car_vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
    out.car_vin = vin.length >= 11 && vin.length <= 17 ? vin : '';
  }

  if (out.car_year) {
    const y = Number(String(out.car_year).replace(/\D/g, '').slice(0, 4));
    out.car_year = y >= 1970 && y <= new Date().getFullYear() + 1 ? String(y) : '';
  }

  if (out.car_category) {
    const c = out.car_category.replace(/\s+/g, '').toUpperCase();
    // РФ: B, C, D, B/M1… — не «Touring»
    out.car_category =
      /^[A-ZА-Я]{1,3}(\/[A-Z0-9А-Я]{1,4})?$/i.test(c) && !/TOURING|SEDAN|HATCH|COUPE|WAGON/.test(c)
        ? c
        : '';
  }

  if (out.car_pts && /^(\d{1,3})$/.test(out.car_pts)) out.car_pts = '';
  // дата, записанная в № СТС: 20220101
  if (out.car_sts_number && /^(19|20)\d{6}$/.test(out.car_sts_number.replace(/\s/g, ''))) {
    out.car_sts_number = '';
  }
  // короткий латинский мусор (KYA) или подпись поля
  if (
    out.car_owner &&
    (out.car_owner.replace(/\s/g, '').length < 5 ||
      /^[A-Z]{2,4}$/i.test(out.car_owner.trim()) ||
      /^(владелец|собственник|owner|фио|kya|kyaw)/i.test(out.car_owner.trim()))
  ) {
    out.car_owner = '';
  }
  if (
    /^(moscow|москва|russia|россия|unknown|kyaw)$/i.test(out.car_owner_street || '') ||
    !/[А-Яа-яЁё]{3,}/.test(out.car_owner_street || '') ||
    /NCRUE|MT\d{2}|TYPE\s*APPROVAL|одобрен|титул/i.test(out.car_owner_street || '')
  ) {
    out.car_owner_street = '';
  }
  if (/^(moscow|москва|russia|россия|unknown)$/i.test(out.car_owner_house || '')) {
    out.car_owner_house = '';
  }
  if (/^(moscow|москва|russia|unknown)$/i.test(out.car_owner_flat || '')) {
    out.car_owner_flat = '';
  }
  if (out.car_color) out.car_color = normalizeColor(out.car_color);

  return out;
}

/** Слить OCR с текущими полями: OCR побеждает; старый мусор не оставляем. */
export function mergeStsVehicleOcr(
  current: Partial<StsVehicleFields> & Record<string, unknown>,
  ocr: StsVehicleFields
): StsVehicleFields {
  const curScrub = sanitizeStsVehicle({
    car_plate: String(current.car_plate || ''),
    car_vin: String(current.car_vin || ''),
    car_brand: String(current.car_brand || ''),
    car_model: String(current.car_model || ''),
    car_year: String(current.car_year || ''),
    car_color: String(current.car_color || ''),
    car_category: String(current.car_category || ''),
    car_pts: String(current.car_pts || ''),
    car_owner: String(current.car_owner || ''),
    car_owner_street: String(current.car_owner_street || ''),
    car_owner_house: String(current.car_owner_house || ''),
    car_owner_flat: String(current.car_owner_flat || ''),
    car_sts_date: String(current.car_sts_date || ''),
    car_sts_number: String(current.car_sts_number || ''),
  });
  const o = sanitizeStsVehicle(ocr);
  const pick = (k: keyof StsVehicleFields) => o[k] || curScrub[k] || '';
  return sanitizeStsVehicle({
    car_plate: pick('car_plate'),
    car_vin: pick('car_vin'),
    car_brand: pick('car_brand'),
    car_model: pick('car_model'),
    car_year: pick('car_year'),
    car_color: pick('car_color'),
    car_category: pick('car_category'),
    car_pts: pick('car_pts'),
    car_owner: pick('car_owner'),
    car_owner_street: pick('car_owner_street'),
    car_owner_house: pick('car_owner_house'),
    car_owner_flat: pick('car_owner_flat'),
    car_sts_date: pick('car_sts_date'),
    car_sts_number: pick('car_sts_number'),
  });
}

export function stsVehicleQualityOk(v: StsVehicleFields): boolean {
  const plateOk = isValidRuPlate(v.car_plate);
  const vinOk = /^[A-HJ-NPR-Z0-9]{17}$/.test(String(v.car_vin || ''));
  const brandOk = String(v.car_brand || '').length >= 2;
  return plateOk || vinOk || (brandOk && !!v.car_year);
}

function pickStr(v: unknown): string {
  return String(v ?? '').trim();
}

function parseSides(raw: unknown, imageCount: number): Array<'front' | 'back' | 'unknown'> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const arr = Array.isArray(o.image_sides)
    ? o.image_sides
    : Array.isArray(o.sides)
      ? o.sides
      : [];
  const out: Array<'front' | 'back' | 'unknown'> = [];
  for (let i = 0; i < imageCount; i++) {
    const v = String(arr[i] ?? '')
      .trim()
      .toLowerCase();
    if (v === 'front' || v === 'лицевая' || v === 'face' || v === 'obverse') out.push('front');
    else if (v === 'back' || v === 'оборот' || v === 'оборотная' || v === 'reverse') out.push('back');
    else out.push('unknown');
  }
  return out;
}

function parseFields(raw: unknown): StsVehicleFields {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const year = pickStr(o.car_year || o.year).replace(/\D/g, '').slice(0, 4);
  return sanitizeStsVehicle({
    car_plate: pickStr(o.car_plate || o.plate || o.reg_number),
    car_vin: pickStr(o.car_vin || o.vin).toUpperCase().replace(/\s+/g, ''),
    car_brand: pickStr(o.car_brand || o.brand || o.make),
    car_model: pickStr(o.car_model || o.model),
    car_year: year,
    car_color: pickStr(o.car_color || o.color),
    car_category: pickStr(o.car_category || o.category),
    car_pts: pickStr(o.car_pts || o.pts || o.passport_ts),
    car_owner: pickStr(o.car_owner || o.owner),
    car_owner_street: pickStr(o.car_owner_street || o.street),
    car_owner_house: pickStr(o.car_owner_house || o.house),
    car_owner_flat: pickStr(o.car_owner_flat || o.flat || o.apartment),
    car_sts_date: pickStr(o.car_sts_date || o.sts_date || o.issued_at),
    car_sts_number: pickStr(o.car_sts_number || o.sts_number),
  });
}

function extractJson(text: string): unknown {
  const t = String(text || '').trim();
  if (!t) return {};
  try {
    return JSON.parse(t);
  } catch {
    /* continue */
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* continue */
    }
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      /* ignore */
    }
  }
  return {};
}

export function deepseekConfigured(settings?: DeepseekSettings): boolean {
  if (String(process.env.CF_STS_OCR_URL || '').trim()) return true;
  const s = settings || getDeepseekSettings();
  return Boolean(s.api_key);
}

/** Официальный api.deepseek.com — только текст, image_url не принимает. */
export function deepseekVisionEndpointOk(settings?: DeepseekSettings): boolean {
  if (String(process.env.CF_STS_OCR_URL || '').trim()) return true;
  const s = settings || getDeepseekSettings();
  const base = String(s.base_url || '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
  if (!base) return false;
  // text-only hosts
  if (
    base === 'https://api.deepseek.com' ||
    base === 'http://api.deepseek.com' ||
    base === 'https://api.deepseek.com/v1' ||
    base === 'https://api.deepseek.com/v1/'
  ) {
    return false;
  }
  return true;
}

export function deepseekVisionHint(settings?: DeepseekSettings): string {
  return (
    'Официальный api.deepseek.com не умеет фото (только текст). ' +
    'Для СТС укажите шлюз с vision: Base URL https://openrouter.ai/api/v1 и модель ' +
    'deepseek/deepseek-vl2 (ключ с openrouter.ai). Настройки → DeepSeek / СТС.'
  );
}

export type StsOcrResult = {
  vehicle: StsVehicleFields;
  model: string;
  raw_text: string;
  image_sides: Array<'front' | 'back' | 'unknown'>;
  buffers: Array<{ mime: string; buf: Buffer }>;
};

/** Разобрать base64-фото без вызова OCR (для сохранения). */
export function decodeStsImages(images: StsOcrImage[]): Array<{ mime: string; buf: Buffer }> {
  const list = (images || [])
    .map((img) => {
      const raw = String(img?.data_base64 || '').trim();
      if (!raw) return null;
      const { mime, data } = stripDataUrl(raw);
      const m = String(img.mime || mime || 'image/jpeg').trim() || 'image/jpeg';
      if (data.length < 80) return null;
      try {
        const buf = Buffer.from(data, 'base64');
        if (buf.length < 80) return null;
        return { mime: m, buf };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<{ mime: string; buf: Buffer }>;
  if (!list.length) throw new Error('Прикрепите фото СТС (1–2 снимка, сторона определится сама)');
  if (list.length > 4) throw new Error('Не больше 4 фото за раз');
  return list;
}

/** Сжать JPEG для Workers AI / workers.dev (большие POST с VPS ловят CF 1010). */
function shrinkForBridge(buf: Buffer, mime: string): { mime: string; data_base64: string } {
  const m = String(mime || 'image/jpeg').toLowerCase();
  const targetBytes = 900_000; // ~0.9 МБ raw → payload < ~1.5 МБ base64
  if (buf.length <= targetBytes && (m.includes('jpeg') || m.includes('jpg') || m.includes('png'))) {
    return { mime: m.includes('png') ? 'image/png' : 'image/jpeg', data_base64: buf.toString('base64') };
  }
  try {
    if (m.includes('png')) throw new Error('png-too-large');
    const decoded = jpegJs.decode(buf, { useTArray: true });
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height));
    const w = Math.max(1, Math.round(decoded.width * scale));
    const h = Math.max(1, Math.round(decoded.height * scale));
    let rgba: Buffer;
    if (scale < 0.999) {
      rgba = Buffer.alloc(w * h * 4);
      for (let y = 0; y < h; y++) {
        const sy = Math.min(decoded.height - 1, Math.floor(y / scale));
        for (let x = 0; x < w; x++) {
          const sx = Math.min(decoded.width - 1, Math.floor(x / scale));
          const si = (sy * decoded.width + sx) * 4;
          const di = (y * w + x) * 4;
          rgba[di] = decoded.data[si];
          rgba[di + 1] = decoded.data[si + 1];
          rgba[di + 2] = decoded.data[si + 2];
          rgba[di + 3] = 255;
        }
      }
    } else {
      rgba = Buffer.from(decoded.data);
    }
    let quality = 72;
    let out = jpegJs.encode({ data: rgba, width: w, height: h }, quality).data;
    while (out.length > targetBytes && quality > 40) {
      quality -= 8;
      out = jpegJs.encode({ data: rgba, width: w, height: h }, quality).data;
    }
    return { mime: 'image/jpeg', data_base64: Buffer.from(out).toString('base64') };
  } catch {
    if (buf.length <= 2_500_000) {
      return { mime: mime || 'image/jpeg', data_base64: buf.toString('base64') };
    }
    throw new Error(
      'Фото СТС слишком большое для OCR-моста. Переснимите ближе или сожмите JPEG.'
    );
  }
}

async function recognizeViaCfBridge(
  bridgeBase: string,
  buffers: Array<{ mime: string; buf: Buffer }>
): Promise<StsOcrResult> {
  const secret = String(process.env.OPENROUTER_BRIDGE_SECRET || '').trim();
  const url = `${bridgeBase}/ocr/sts`;
  const payload = {
    images: buffers.map((b) => shrinkForBridge(b.buf, b.mime)),
  };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'uchet1-wms/1.0',
  };
  if (secret) headers['X-Bridge-Secret'] = secret;

  const res = await fetch(url, {
    method: 'POST',
    headers,
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
    throw new Error(`CF STS OCR HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const vehicle = sanitizeStsVehicle({ ...EMPTY, ...(j.vehicle || {}) });
  const sides =
    Array.isArray(j.image_sides) && j.image_sides.length
      ? j.image_sides
      : buffers.map(() => 'unknown' as const);
  if (!res.ok || j.ok === false || !stsVehicleQualityOk(vehicle)) {
    throw new Error(
      j.error ||
        'Не удалось надёжно прочитать СТС. Введите вручную или переснимите ближе / без бликов.'
    );
  }
  return {
    vehicle,
    model: String(j.model || 'workers-ai'),
    raw_text: String(j.raw_text || ''),
    image_sides: sides,
    buffers,
  };
}

export async function recognizeStsFromImages(
  images: StsOcrImage[],
  settings?: DeepseekSettings
): Promise<StsOcrResult> {
  const buffers = decodeStsImages(images);

  // Cloudflare Workers AI bridge (когда OpenRouter режет IP VPS)
  const cfBridge = String(process.env.CF_STS_OCR_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (cfBridge) {
    return recognizeViaCfBridge(cfBridge, buffers);
  }

  const s = settings || getDeepseekSettings();
  if (!s.api_key) {
    throw new Error('Не задан ключ DeepSeek (DEEPSEEK_API_KEY или Настройки → DeepSeek)');
  }
  if (!deepseekVisionEndpointOk(s)) {
    throw new Error(deepseekVisionHint(s));
  }

  const content: Array<Record<string, unknown>> = [{ type: 'text', text: PROMPT }];
  for (const img of buffers) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mime};base64,${img.buf.toString('base64')}` },
    });
  }

  let base = (s.base_url || '').replace(/\/+$/, '');
  // OpenRouter: /api/v1; чужие шлюзы часто уже с /v1
  if (!/\/v\d+$/i.test(base) && /openrouter\.ai/i.test(base)) {
    base = base.replace(/\/api$/i, '') + '/api/v1';
  }
  const model = s.vision_model || 'deepseek/deepseek-vl2';
  const url = `${base}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${s.api_key}`,
  };
  if (/openrouter\.ai/i.test(base)) {
    headers['HTTP-Referer'] = process.env.OPENROUTER_REFERER || 'https://uchetn1.ru';
    headers['X-Title'] = process.env.OPENROUTER_TITLE || 'Uchet1 STS OCR';
  }
  const bridgeSecret = String(process.env.OPENROUTER_BRIDGE_SECRET || '').trim();
  if (bridgeSecret) headers['X-Bridge-Secret'] = bridgeSecret;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1400,
      messages: [
        {
          role: 'system',
          content:
            'Ты аккуратный OCR-парсер документов РФ. Отвечай только валидным JSON-объектом. Сам определяй сторону СТС на каждом фото.',
        },
        { role: 'user', content },
      ],
    }),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    let detail = bodyText.slice(0, 400);
    try {
      const j = JSON.parse(bodyText) as {
        error?: { message?: string } | string;
        success?: boolean;
      };
      if (typeof j?.error === 'string') detail = j.error;
      else if (j?.error && typeof j.error === 'object' && j.error.message) detail = j.error.message;
    } catch {
      /* keep */
    }
    if (/access denied by security policy/i.test(detail) || (res.status === 403 && /security policy/i.test(bodyText))) {
      throw new Error(
        'OpenRouter блокирует IP этого сервера (Cloudflare: Access denied by security policy). ' +
          'Ключ верный, но запросы с VPS не доходят. Варианты: исходящий HTTPS-прокси в другой стране ' +
          '(OPENROUTER_HTTPS_PROXY в /etc/warehouse-wms.env) или другой vision-шлюз, доступный с сервера. ' +
          'Проверьте ключ с домашнего ПК: curl https://openrouter.ai/api/v1/models -H "Authorization: Bearer …"'
      );
    }
    if (
      /image_url|unknown variant|vision|multimodal|content.*array|not support|image/i.test(
        detail
      )
    ) {
      throw new Error(`${deepseekVisionHint(s)} Ответ API: ${detail}`);
    }
    throw new Error(`Vision OCR HTTP ${res.status}: ${detail}`);
  }

  let rawText = '';
  try {
    const j = JSON.parse(bodyText) as {
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    };
    const msg = j.choices?.[0]?.message?.content;
    if (typeof msg === 'string') rawText = msg;
    else if (Array.isArray(msg)) {
      rawText = msg.map((p) => (p?.type === 'text' ? p.text || '' : '')).join('\n');
    }
  } catch {
    rawText = bodyText;
  }

  const parsed = extractJson(rawText);
  const vehicle = parseFields(parsed);
  const image_sides = parseSides(parsed, buffers.length);
  if (!stsVehicleQualityOk(vehicle)) {
    throw new Error(
      'Не удалось надёжно прочитать СТС. Введите вручную или переснимите ближе / без бликов.'
    );
  }
  return {
    vehicle,
    model,
    raw_text: rawText.slice(0, 2000),
    image_sides,
    buffers,
  };
}
