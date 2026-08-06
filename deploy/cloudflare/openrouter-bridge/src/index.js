/**
 * Cloudflare Worker: STS OCR через Workers AI.
 * OpenRouter с VPS блокируется — инференс на CF.
 *
 * Стратегия: сначала вытащить сырой текст с фото (OCR), затем regex/JSON.
 * LLaVA отключён — сильно галлюцинирует.
 *
 * POST /ocr/sts + X-Bridge-Secret
 */
const EMPTY = {
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

const MODEL_LLAMA = '@cf/meta/llama-3.2-11b-vision-instruct';
const MODEL_MOON = '@cf/moondream/moondream3.1-9B-A2B';

const OCR_PROMPT = `Это фото российского Свидетельства о регистрации ТС (СТС).
Перепиши ВЕСЬ читаемый текст с документа построчно, как есть (кириллица и латиница).
Не выдумывай и не переводи. Если сторона оборотная — тоже весь текст.
В конце одной строкой: SIDE=front или SIDE=back.`;

const JSON_PROMPT = `По этому тексту российского СТС заполни JSON (пустая строка если нет в тексте). Не выдумывай.
Текст:
`;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(request) });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
      return json(
        {
          ok: true,
          service: 'openrouter-bridge-uchet1',
          mode: 'workers-ai-sts-ocr-v2',
          models: [MODEL_LLAMA, MODEL_MOON],
          endpoint: 'POST /ocr/sts',
        },
        200,
        request
      );
    }

    const secret = String(env.BRIDGE_SECRET || '').trim();
    if (secret) {
      const got = String(request.headers.get('X-Bridge-Secret') || '').trim();
      if (!got || got !== secret) {
        return json({ error: 'Unauthorized bridge' }, 401, request);
      }
    }

    if (request.method === 'POST' && url.pathname.replace(/\/+$/, '') === '/ocr/sts') {
      return handleStsOcr(request, env);
    }

    if (
      request.method === 'POST' &&
      (url.pathname.endsWith('/chat/completions') || url.pathname.endsWith('/v1/chat/completions'))
    ) {
      return handleChatCompletions(request, env);
    }

    return json({ error: 'Not found', path: url.pathname }, 404, request);
  },
};

async function handleStsOcr(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400, request);
  }
  const images = Array.isArray(body?.images) ? body.images : [];
  if (!images.length) return json({ error: 'images required' }, 400, request);
  if (!env.AI) return json({ error: 'Workers AI binding missing' }, 500, request);

  try {
    const result = await runStsVision(env, images);
    const quality = vehicleQuality(result.vehicle);
    if (!quality.ok) {
      return json(
        {
          ok: false,
          error:
            'Не удалось надёжно прочитать СТС (модель угадала поля). Введите вручную или переснимите ближе / без бликов.',
          vehicle: result.vehicle,
          model: result.model,
          raw_text: result.raw_text,
          image_sides: result.image_sides,
          quality,
        },
        422,
        request
      );
    }
    return json({ ok: true, ...result, quality }, 200, request);
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      502,
      request
    );
  }
}

async function handleChatCompletions(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400, request);
  }
  const images = extractImagesFromChat(body);
  if (!images.length) {
    return json(
      { error: 'This bridge only handles vision chat/completions with image_url' },
      400,
      request
    );
  }
  try {
    const result = await runStsVision(env, images);
    return json(
      {
        id: 'cf-sts-' + Date.now(),
        object: 'chat.completion',
        model: result.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: JSON.stringify(result.vehicle_with_sides) },
            finish_reason: 'stop',
          },
        ],
      },
      200,
      request
    );
  } catch (e) {
    return json(
      { error: { message: e instanceof Error ? e.message : String(e) } },
      502,
      request
    );
  }
}

function extractImagesFromChat(body) {
  const out = [];
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (const m of messages) {
    const content = m?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type !== 'image_url') continue;
      const url = String(part?.image_url?.url || '');
      const m64 = /^data:([^;]+);base64,(.+)$/i.exec(url);
      if (m64) out.push({ mime: m64[1], data_base64: m64[2] });
    }
  }
  return out;
}

async function runStsVision(env, images) {
  const sides = [];
  const partials = [];
  const rawParts = [];
  const modelsUsed = [];

  for (let i = 0; i < Math.min(images.length, 4); i++) {
    const img = images[i];
    const b64 = String(img.data_base64 || '').replace(/\s/g, '');
    if (!b64 || b64.length < 80) continue;
    const mime = String(img.mime || 'image/jpeg');
    const dataUri = `data:${mime};base64,${b64}`;

    const { text, model } = await ocrImageText(env, dataUri, b64);
    modelsUsed.push(model);
    rawParts.push(text);

    const fromRegex = fieldsFromOcrText(text);
    let fromJson = { ...EMPTY };
    try {
      const jText = await structFromText(env, text);
      if (jText) {
        rawParts.push('[json]\n' + jText);
        fromJson = sanitizeVehicle(parseFields(extractJson(jText)));
      }
    } catch {
      /* ignore */
    }

    const fields = sanitizeVehicle(mergeFields([fromRegex, fromJson]));
    const side = detectSide(text, fields);
    sides.push(side);
    partials.push(fields);
  }

  if (!partials.length) throw new Error('Нет валидных изображений');

  // Финальный проход по склеенному тексту: адрес/ФИО часто только на обороте,
  // а по отдельным фото regex иногда пропускает поля из‑за разметки.
  const combined = rawParts.join('\n---\n');
  const vehicle = sanitizeVehicle(
    mergeFields([...partials, fieldsFromOcrText(combined)])
  );
  return {
    vehicle,
    vehicle_with_sides: { ...vehicle, image_sides: sides },
    model: modelsUsed.join('|') || MODEL_LLAMA,
    raw_text: combined.slice(0, 8000),
    image_sides: sides,
  };
}

async function ocrImageText(env, dataUri, b64) {
  const errors = [];

  // 1) Moondream — лучше для OCR
  try {
    const r = await env.AI.run(MODEL_MOON, {
      task: 'query',
      image: dataUri,
      question: OCR_PROMPT,
      max_tokens: 1600,
      stream: false,
      reasoning: false,
    });
    const text = unwrapAiText(r);
    if (text && text.length > 20 && !looksLikeSchemaEcho(text)) {
      return { text, model: MODEL_MOON };
    }
  } catch (e) {
    errors.push('moon:' + (e instanceof Error ? e.message : e));
  }

  // 2) Llama: messages + image (data URI) — формат из доков CF
  try {
    const r = await env.AI.run(MODEL_LLAMA, {
      messages: [
        {
          role: 'system',
          content: 'You are an OCR engine for Russian documents. Transcribe visible text only. Never invent.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            { type: 'image_url', image_url: { url: dataUri } },
          ],
        },
      ],
      max_tokens: 1600,
      temperature: 0,
    });
    const text = unwrapAiText(r);
    if (text && text.length > 20) return { text, model: MODEL_LLAMA + '+messages' };
  } catch (e) {
    errors.push('llama-msg:' + (e instanceof Error ? e.message : e));
  }

  // 3) Llama: prompt + image base64
  try {
    const r = await env.AI.run(MODEL_LLAMA, {
      prompt: OCR_PROMPT,
      image: b64,
      max_tokens: 1600,
      temperature: 0,
    });
    const text = unwrapAiText(r);
    if (text && text.length > 20) return { text, model: MODEL_LLAMA + '+prompt' };
  } catch (e) {
    errors.push('llama-prompt:' + (e instanceof Error ? e.message : e));
  }

  throw new Error('OCR failed: ' + errors.join('; '));
}

async function structFromText(env, ocrText) {
  const t = String(ocrText || '').trim();
  if (t.length < 20) return '';
  try {
    const r = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        {
          role: 'system',
          content: 'Extract fields from Russian STS OCR text. Reply with JSON only. Empty string if not in text. Never invent.',
        },
        {
          role: 'user',
          content:
            JSON_PROMPT +
            t.slice(0, 3500) +
            `\n\nJSON keys: ${Object.keys(EMPTY).join(', ')}, image_sides`,
        },
      ],
      max_tokens: 800,
      temperature: 0,
    });
    return unwrapAiText(r);
  } catch {
    return '';
  }
}

function fieldsFromOcrText(text) {
  const t = String(text || '');
  const out = { ...EMPTY };

  // VIN 17
  const vinM = t.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
  if (vinM) out.car_vin = vinM[1].toUpperCase();

  // Госномер РФ (часто латиницей: U276KC799 → У276КС799)
  const plateChars = 'АВЕКМНОРСТУХABEKMHOPCTYXU';
  const plateRe = new RegExp(
    `([${plateChars}]\\s?\\d{3}\\s?[${plateChars}]{2}\\s?\\d{2,3})`,
    'i'
  );
  const plateM = t.match(plateRe);
  if (plateM) out.car_plate = normalizePlate(plateM[1]);

  // Год выпуска (не путать с датой выдачи СТС)
  const yearM =
    t.match(/(?:год\s*выпуска|выпуска|year)[^\d]{0,12}((?:19|20)\d{2})/i) ||
    t.match(/T\s*((?:19|20)\d{2})\b/);
  if (yearM) {
    const y = Number(yearM[1]);
    if (y >= 1970 && y <= new Date().getFullYear() + 1) out.car_year = String(y);
  }

  // Категория B / B/M1
  const catM = t.match(
    /(?:категор\w*)[^\nA-ZА-Я]{0,16}\b([A-ZА-Я](?:\s*\/\s*[A-Z0-9А-Я]+)?)\b/i
  );
  if (catM && !/прицеп|abcd/i.test(catM[0])) {
    out.car_category = catM[1].replace(/\s+/g, '').toUpperCase();
  }

  // Цвет
  const colorM = t.match(/(?:цвет|color)[^\nА-Яа-яA-Za-z]{0,8}([А-Яа-яA-Za-z\-]+)/i);
  if (colorM) out.car_color = normalizeColor(colorM[1]);

  // Марка / модель
  const brandLine = t.match(/(?:марка|make|brand)\s*[:*]?\s*([^\n*]+)/i);
  if (brandLine) {
    const parts = brandLine[1]
      .replace(/[*_]/g, ' ')
      .trim()
      .split(/\s+/);
    if (parts.length) {
      out.car_brand = parts[0].slice(0, 40);
      if (parts.length > 1 && !out.car_model) out.car_model = parts.slice(1).join(' ').slice(0, 40);
    }
  }
  const modelM = t.match(/(?:модель|model)\s*[:*]?\s*([^\n*]+)/i);
  if (modelM) {
    let m = modelM[1].replace(/[*_]/g, ' ').trim().slice(0, 40);
    const bm = m.match(
      /^(BMW|БМВ|MERCEDES|AUDI|TOYOTA|LEXUS|VOLKSWAGEN|VW|KIA|HYUNDAI)\s+(.+)$/i
    );
    if (bm) {
      if (!out.car_brand) out.car_brand = bm[1];
      m = bm[2];
    }
    out.car_model = m;
  }

  // № СТС: 12 АА 123456 или цифровой 99 35 688984
  const stsM =
    t.match(/(?:свидетельств|серия|№\s*СТС)[^\n\d]{0,20}(\d{2}\s*[А-ЯA-Z]{2}\s*\d{6})/i) ||
    t.match(/\b(\d{2}\s*[А-ЯA-Z]{2}\s*\d{6})\b/i) ||
    t.match(/\b(\d{2}\s+\d{2}\s+\d{6})\b/);
  if (stsM) out.car_sts_number = stsM[1].replace(/\s+/g, ' ').trim();

  // ПТС
  const ptsM =
    t.match(
      /(?:ПТС|паспорт\s*T[CS]|паспорт\s*ТС)[^\n\dА-ЯA-Z]{0,12}([A-ZА-Я]?\d{2}\s*[A-ZА-Я]{2}\s*\d{6})/i
    ) || t.match(/\b([A-ZА-Я]\d{2}\s*[A-ZА-Я]{2}\s*\d{6})\b/i);
  if (ptsM) out.car_pts = ptsM[1].replace(/\s+/g, ' ').trim();

  // Дата ДД.ММ.ГГГГ
  const dateM = t.match(/\b(\d{2}[./]\d{2}[./]\d{4})\b/);
  if (dateM) out.car_sts_date = dateM[1].replace(/\//g, '.');

  // Собственник — часто ФИО по строкам после «СОБСТВЕННИК»
  const ownerInline = t.match(
    /(?:собственник|владелец)\s*[\(（][^\)）]*[\)）]?\s*[:*]?\s*([А-ЯЁ][А-Яа-яё\-]+(?:\s+[А-ЯЁ][А-Яа-яё\-]+){1,3})/i
  );
  if (ownerInline) {
    out.car_owner = ownerInline[1].replace(/\s+/g, ' ').trim().slice(0, 120);
  } else {
    const after = t.split(/(?:собственник|владелец)[^\n]*/i)[1] || '';
    const fio = [];
    for (const rawLine of after.split(/\n/)) {
      const line = rawLine.replace(/[*_#]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!line) continue;
      if (/^(субъект|населенн|улица|ул\.|дом|квартира|кв\.|особые|регион|район|паспорт|серия)/i.test(line))
        break;
      const cyr = line.match(/[А-ЯЁ][А-Яа-яё\-]+/g);
      if (cyr && cyr.length) {
        for (const w of cyr) {
          if (!/^(владелец|собственник|федераци|российск)/i.test(w)) fio.push(w);
        }
      }
      if (fio.length >= 3) break;
    }
    if (fio.length >= 2) out.car_owner = fio.slice(0, 3).join(' ');
  }

  // Адрес с оборота: только слово «улица» (не «ул» внутри «титул»)
  const streetM = t.match(/(?:^|\n)\s*\**\s*улица\s*(?:ул\.?\s*)?([^\n*]+)/i);
  if (streetM) {
    let street = streetM[1]
      .replace(/[*_]/g, ' ')
      .replace(/^(ул\.?\s*)/i, '')
      .trim()
      .slice(0, 80);
    // мусор OCR: код одобрения типа ТС и т.п.
    if (
      !street ||
      !/[А-Яа-яЁё]{3,}/.test(street) ||
      /NCRUE|одобрен|титул|MT\d{2}|NOTSUT|TYPE\s*APPROVAL/i.test(street)
    ) {
      street = '';
    }
    out.car_owner_street = street;
  }
  const houseM = t.match(/(?:^|\n)\s*\**\s*дом\s*[:*]?\s*(\d+[А-Яа-яA-Z0-9\/\-]*)/i);
  if (houseM) out.car_owner_house = houseM[1].trim();
  const flatM = t.match(/(?:квартира|кв\.?)\s*[:*]?\s*(\d+[А-Яа-яA-Z0-9\/\-]*)/i);
  if (flatM) out.car_owner_flat = flatM[1].trim();

  return sanitizeVehicle(out);
}

function detectSide(text, fields) {
  const t = String(text || '').toLowerCase();
  if (/side\s*=\s*front|лицевая|госномер|идентификационн|vin/.test(t) || fields.car_plate || fields.car_vin)
    return fields.car_owner && !fields.car_plate ? 'back' : 'front';
  if (/side\s*=\s*back|оборот|собственник|адрес/.test(t) || fields.car_owner) return 'back';
  return 'unknown';
}

function vehicleQuality(v) {
  const plateOk = isValidRuPlate(v.car_plate);
  const vinOk = /^[A-HJ-NPR-Z0-9]{17}$/.test(String(v.car_vin || ''));
  const brandOk = String(v.car_brand || '').length >= 2;
  const score = (plateOk ? 2 : 0) + (vinOk ? 2 : 0) + (brandOk ? 1 : 0) + (v.car_year ? 1 : 0);
  return {
    ok: plateOk || vinOk || (brandOk && !!v.car_year && score >= 3),
    plateOk,
    vinOk,
    score,
  };
}

function sanitizeVehicle(f) {
  const out = { ...EMPTY, ...f };
  const junk =
    /госномер|латиницей|год выпуска|серия и номер|YYYY|ДД\.ММ|^unknown$|^n\/?a$|^none$|^null$|^not available$|^не указан|^touring$|^sedan$|^suv$/i;

  for (const k of Object.keys(EMPTY)) {
    let v = String(out[k] || '').trim();
    if (!v || junk.test(v)) {
      out[k] = '';
      continue;
    }
    out[k] = v;
  }

  // plate: только валидный РФ; VIN-подобные не превращать в «госномер»
  if (out.car_plate) {
    const raw = out.car_plate.replace(/\s+/g, '');
    if (looksLikeVin(raw)) {
      if (!out.car_vin) out.car_vin = raw.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17);
      out.car_plate = '';
    } else {
      const p = normalizePlate(out.car_plate);
      out.car_plate = isValidRuPlate(p) ? p : '';
    }
  }

  if (out.car_vin) {
    const vin = out.car_vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
    out.car_vin = vin.length === 17 ? vin : vin.length >= 11 && vin.length <= 17 ? vin : '';
  }

  if (out.car_year) {
    const y = Number(String(out.car_year).replace(/\D/g, '').slice(0, 4));
    out.car_year = y >= 1970 && y <= new Date().getFullYear() + 1 ? String(y) : '';
  }

  if (out.car_category) {
    const c = out.car_category.replace(/\s+/g, '').toUpperCase();
    out.car_category = /^[A-ZА-Я]{1,3}(\/[A-Z0-9А-Я]+)?$/i.test(c) && !/TOURING|SEDAN/.test(c) ? c : '';
  }

  if (out.car_pts && /^(\d{1,3})$/.test(out.car_pts)) out.car_pts = '';
  if (out.car_sts_number && /^(19|20)\d{6}$/.test(out.car_sts_number.replace(/\s/g, ''))) {
    out.car_sts_number = '';
  }
  if (
    out.car_owner &&
    (out.car_owner.replace(/\s/g, '').length < 5 ||
      /^[A-Z]{2,4}$/i.test(out.car_owner.trim()) ||
      /^(владелец|собственник|owner|фио|kya|kyaw)$/i.test(out.car_owner.trim()))
  ) {
    out.car_owner = '';
  }
  if (
    /^(moscow|москва|russia|россия|unknown|kyaw)$/i.test(out.car_owner_street || '') ||
    !/[А-Яа-яЁё]{3,}/.test(out.car_owner_street || '') ||
    /NCRUE|MT\d{2}|TYPE\s*APPROVAL|одобрен/i.test(out.car_owner_street || '')
  ) {
    out.car_owner_street = '';
  }
  if (/^(moscow|москва|russia|россия|unknown)$/i.test(out.car_owner_house || '')) {
    out.car_owner_house = '';
  }
  if (out.car_color) out.car_color = normalizeColor(out.car_color);

  return out;
}

function looksLikeVin(s) {
  const t = String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return t.length >= 11 && t.length <= 17 && /^[A-HJ-NPR-Z0-9]+$/.test(t) && /\d/.test(t);
}

function isValidRuPlate(s) {
  const p = normalizePlate(s);
  return /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/.test(p);
}

function normalizeColor(v) {
  const s = String(v || '').trim().toLowerCase();
  const map = {
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

function normalizePlate(v) {
  return pickStr(v)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[A-Z]/g, (ch) => {
      const map = {
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

function mergeFields(list) {
  const out = { ...EMPTY };
  for (const f of list) {
    for (const k of Object.keys(EMPTY)) {
      if (!out[k] && f[k]) out[k] = f[k];
    }
  }
  return out;
}

function pickStr(v) {
  return String(v ?? '').trim();
}

function parseFields(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    car_plate: pickStr(o.car_plate || o.plate || o.reg_number),
    car_vin: pickStr(o.car_vin || o.vin)
      .toUpperCase()
      .replace(/\s+/g, ''),
    car_brand: pickStr(o.car_brand || o.brand || o.make),
    car_model: pickStr(o.car_model || o.model),
    car_year: pickStr(o.car_year || o.year)
      .replace(/\D/g, '')
      .slice(0, 4),
    car_color: pickStr(o.car_color || o.color),
    car_category: pickStr(o.car_category || o.category),
    car_pts: pickStr(o.car_pts || o.pts || o.passport_ts),
    car_owner: pickStr(o.car_owner || o.owner),
    car_owner_street: pickStr(o.car_owner_street || o.street),
    car_owner_house: pickStr(o.car_owner_house || o.house),
    car_owner_flat: pickStr(o.car_owner_flat || o.flat || o.apartment),
    car_sts_date: pickStr(o.car_sts_date || o.sts_date || o.issued_at),
    car_sts_number: pickStr(o.car_sts_number || o.sts_number),
  };
}

function looksLikeSchemaEcho(text) {
  return /госномер без пробелов|год выпуска YYYY|VIN латиницей|собственник ФИО/i.test(
    String(text || '')
  );
}

function unwrapAiText(r) {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (typeof r.response === 'string') return r.response;
  if (typeof r.description === 'string') return r.description;
  if (typeof r.answer === 'string') return r.answer;
  if (typeof r.text === 'string') return r.text;
  if (typeof r.result === 'string') return r.result;
  if (r.result && typeof r.result.answer === 'string') return r.result.answer;
  if (r.result && typeof r.result.response === 'string') return r.result.response;
  try {
    return JSON.stringify(r);
  } catch {
    return '';
  }
}

function extractJson(text) {
  let t = String(text || '')
    .trim()
    .replace(/\\_/g, '_')
    .replace(/\\([A-Za-z])/g, '$1');
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

function cors(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Bridge-Secret',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(request) },
  });
}
