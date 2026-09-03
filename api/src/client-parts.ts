/**
 * Запчасти / материалы, принесённые клиентом (для ЗН §6).
 * Локально: data/client-parts/{dealId}/ (фото + parts.json).
 * Распознавание: DeepSeek vision / текст.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureStsJpeg } from './sts-media.js';
import { getDeepseekSettings } from './integration-settings.js';
import {
  deepseekConfigured,
  deepseekVisionEndpointOk,
} from './sts-ocr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_PHOTOS = 12;

export type ClientPart = {
  name: string;
  sku?: string;
  brand?: string;
  condition?: string;
  qty: number;
  price: number;
  conformity?: string;
  note?: string;
};

export type ClientPartsState = {
  items: ClientPart[];
  note?: string;
  updated_at?: string;
  source?: 'manual' | 'deepseek' | 'mixed';
};

function dataDir(): string {
  return process.env.WMS_DATA_DIR || path.resolve(__dirname, '..', '..', 'data');
}

function safeDealId(dealId: string): string {
  const id = String(dealId || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!id) throw new Error('deal_id required');
  return id;
}

export function clientPartsDir(dealId: string): string {
  const dir = path.join(dataDir(), 'client-parts', safeDealId(dealId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function partsJsonPath(dealId: string): string {
  return path.join(clientPartsDir(dealId), 'parts.json');
}

export function emptyClientParts(): ClientPartsState {
  return { items: [] };
}

export function loadClientParts(dealId: string): ClientPartsState {
  const p = partsJsonPath(dealId);
  try {
    if (!fs.existsSync(p)) return emptyClientParts();
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as ClientPartsState;
    const items = Array.isArray(j?.items)
      ? j.items
          .map(normalizePart)
          .filter((x): x is ClientPart => Boolean(x?.name))
      : [];
    return {
      items,
      note: String(j?.note || '').trim() || undefined,
      updated_at: String(j?.updated_at || '').trim() || undefined,
      source: j?.source,
    };
  } catch {
    return emptyClientParts();
  }
}

function normalizePart(raw: unknown): ClientPart | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = String(o.name || o.title || o.наименование || '').trim();
  if (!name) return null;
  const qty = Math.max(0, Number(o.qty ?? o.quantity ?? o.кол_во ?? 1) || 1);
  const price = Math.max(0, Number(o.price ?? o.цена ?? 0) || 0);
  return {
    name,
    sku: String(o.sku || o.article || o.артикул || '').trim() || undefined,
    brand: String(o.brand || o.производитель || '').trim() || undefined,
    condition: String(o.condition || o.состояние || '').trim() || undefined,
    qty,
    price,
    conformity: String(o.conformity || o.соответствие || '').trim() || undefined,
    note: String(o.note || o.примечание || '').trim() || undefined,
  };
}

export function saveClientParts(
  dealId: string,
  state: Partial<ClientPartsState> & { items?: ClientPart[] }
): ClientPartsState {
  const prev = loadClientParts(dealId);
  const items = Array.isArray(state.items)
    ? state.items.map(normalizePart).filter((x): x is ClientPart => Boolean(x))
    : prev.items;
  const next: ClientPartsState = {
    items,
    note:
      state.note !== undefined
        ? String(state.note || '').trim() || undefined
        : prev.note,
    updated_at: new Date().toISOString(),
    source: state.source || prev.source || (items.length ? 'manual' : undefined),
  };
  fs.writeFileSync(partsJsonPath(dealId), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function clientPartsSummary(dealId: string): ClientPartsState & {
  count: number;
  has_parts: boolean;
  photos: Array<{ id: string; url: string }>;
} {
  const state = loadClientParts(dealId);
  const photos = listClientPartPhotos(dealId);
  return {
    ...state,
    count: state.items.length,
    has_parts: state.items.length > 0,
    photos,
  };
}

function photoUrl(dealId: string, photoId: string): string {
  return `/api/crm/deals/${encodeURIComponent(dealId)}/client-parts/photos/${encodeURIComponent(photoId)}`;
}

export function listClientPartPhotos(
  dealId: string
): Array<{ id: string; url: string; mime: string; size: number }> {
  const id = safeDealId(dealId);
  const dir = clientPartsDir(id);
  const out: Array<{ id: string; url: string; mime: string; size: number }> = [];
  for (const name of fs.readdirSync(dir)) {
    const m = /^([a-zA-Z0-9_-]+)\.(jpe?g|png|webp|gif)$/i.exec(name);
    if (!m) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      const ext = m[2].toLowerCase();
      const mime =
        ext === 'png'
          ? 'image/png'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'gif'
              ? 'image/gif'
              : 'image/jpeg';
      out.push({ id: m[1], url: photoUrl(id, m[1]), mime, size: st.size });
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function readClientPartPhoto(
  dealId: string,
  photoId: string
): { buf: Buffer; mime: string } | null {
  const id = safeDealId(dealId);
  const pid = String(photoId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  if (!pid) return null;
  const dir = clientPartsDir(id);
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
    const full = path.join(dir, `${pid}.${ext}`);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        const mime =
          ext === 'png'
            ? 'image/png'
            : ext === 'webp'
              ? 'image/webp'
              : ext === 'gif'
                ? 'image/gif'
                : 'image/jpeg';
        return { buf: fs.readFileSync(full), mime };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function saveClientPartPhoto(
  dealId: string,
  buf: Buffer,
  mime?: string
): Promise<{ id: string; url: string; mime: string; size: number }> {
  if (!buf?.length) throw new Error('Пустое фото');
  if (buf.length > MAX_FILE_BYTES) throw new Error('Фото больше 12 МБ');
  if (listClientPartPhotos(dealId).length >= MAX_PHOTOS) {
    throw new Error(`Уже ${MAX_PHOTOS} фото`);
  }
  const normalized = await ensureStsJpeg(buf, mime);
  const pid = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
  const dest = path.join(clientPartsDir(dealId), `${pid}.jpg`);
  fs.writeFileSync(dest, normalized.buf);
  const st = fs.statSync(dest);
  return {
    id: pid,
    url: photoUrl(safeDealId(dealId), pid),
    mime: 'image/jpeg',
    size: st.size,
  };
}

export function deleteClientPartPhoto(dealId: string, photoId: string): boolean {
  const id = safeDealId(dealId);
  const pid = String(photoId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  if (!pid) return false;
  let ok = false;
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
    const full = path.join(clientPartsDir(id), `${pid}.${ext}`);
    try {
      if (fs.existsSync(full)) {
        fs.unlinkSync(full);
        ok = true;
      }
    } catch {
      /* ignore */
    }
  }
  return ok;
}

const PARTS_PROMPT = `Ты мастер-приёмщик автосервиса (СТО). По тексту и/или фото составь перечень запасных частей, которые клиент ПРИНЁС С СОБОЙ для установки (не со склада СТО).

Верни ТОЛЬКО JSON без markdown:
{"parts":[{"name":"полное наименование","sku":"","brand":"","condition":"","qty":1,"price":0,"note":""}]}

Правила:
- Нужен простой список наименований: исправь опечатки, раскрой сокращения, сделай понятные названия по-русски.
- Цены и количества НЕ обязательны: price=0, qty=1, если не сказаны явно.
- Не выдумывай артикулы (sku пусто, если не видно/не сказано).
- Одна позиция = одна деталь/комплект в списке.
- Если деталей нет — {"parts":[]}.`;

function extractJsonObject(raw: string): unknown {
  const s = String(raw || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('DeepSeek не вернул JSON списка деталей');
  return JSON.parse(body.slice(start, end + 1));
}

export async function recognizeClientParts(opts: {
  dealId: string;
  note?: string;
  images?: Array<{ buf: Buffer; mime: string }>;
  savePhotos?: boolean;
}): Promise<ClientPartsState> {
  const note = String(opts.note || '').trim();
  const images = opts.images || [];
  if (!note && !images.length) {
    throw new Error('Добавьте фото деталей и/или текст, что наговорили');
  }
  if (!deepseekConfigured()) {
    throw new Error('Не задан ключ DeepSeek (Настройки → OCR документов / DeepSeek)');
  }

  const savedPhotos: string[] = [];
  if (opts.savePhotos !== false) {
    for (const img of images.slice(0, MAX_PHOTOS)) {
      const ph = await saveClientPartPhoto(opts.dealId, img.buf, img.mime);
      savedPhotos.push(ph.id);
    }
  }

  const s = getDeepseekSettings();
  let base = (s.base_url || '').replace(/\/+$/, '');
  if (!/\/v\d+$/i.test(base) && /openrouter\.ai/i.test(base)) {
    base = base.replace(/\/api$/i, '') + '/api/v1';
  }

  const useVision = images.length > 0;
  if (useVision && !deepseekVisionEndpointOk(s)) {
    throw new Error(
      'Для фото деталей нужен vision-шлюз (OpenRouter + deepseek/deepseek-vl2). Текст можно распознать без фото.'
    );
  }

  const model = useVision
    ? s.vision_model || 'deepseek/deepseek-vl2'
    : /openrouter\.ai/i.test(base)
      ? 'deepseek/deepseek-chat'
      : 'deepseek-chat';

  const content: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text:
        PARTS_PROMPT +
        (note ? `\n\nТекст клиента/мастера:\n${note}` : ''),
    },
  ];
  for (const img of images.slice(0, 6)) {
    const normalized = await ensureStsJpeg(img.buf, img.mime);
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${normalized.mime};base64,${normalized.buf.toString('base64')}`,
      },
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${s.api_key}`,
  };
  if (/openrouter\.ai/i.test(base)) {
    headers['HTTP-Referer'] = 'https://uchetn1.ru';
    headers['X-Title'] = 'uchet1-client-parts';
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [{ role: 'user', content: useVision ? content : content[0].text }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  let rawContent = '';
  try {
    const j = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    };
    const c = j.choices?.[0]?.message?.content;
    if (typeof c === 'string') rawContent = c;
    else if (Array.isArray(c)) {
      rawContent = c.map((x) => (typeof x === 'string' ? x : String(x?.text || ''))).join('\n');
    }
  } catch {
    rawContent = text;
  }

  const parsed = extractJsonObject(rawContent) as { parts?: unknown[] };
  const items = (Array.isArray(parsed.parts) ? parsed.parts : [])
    .map(normalizePart)
    .filter((x): x is ClientPart => Boolean(x));

  return saveClientParts(opts.dealId, {
    items,
    note: note || undefined,
    source: 'deepseek',
  });
}

/** Строки для ЗН: список наименований (цены/кол-во не обязательны). */
export function clientPartsToFillLines(
  parts: ClientPart[]
): Array<{ name: string; sku?: string; qty: number; price: number; amount: number }> {
  return (parts || [])
    .filter((p) => p.name)
    .map((p) => {
      const bits = [p.name];
      if (p.brand) bits.push(p.brand);
      if (p.condition) bits.push(`(${p.condition})`);
      const name = bits.join(', ');
      const qty = p.qty > 0 ? p.qty : 1;
      const price = p.price > 0 ? p.price : 0;
      return {
        name,
        sku: p.sku,
        qty,
        price,
        amount: price > 0 ? Math.round(qty * price) : 0,
      };
    });
}
