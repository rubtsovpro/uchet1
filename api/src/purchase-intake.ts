/**
 * Закупки · прайсы поставщиков: загрузка → маппинг колонок → дифф → корзины →
 * письмо / создание номенклатуры + свободные DiSAI EAN-13.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import { all, get, run, db } from './db.js';
import { newGuid, nextCode, ensureSeqAtLeast } from './ids.js';
import { actorFromContext, canDo, type Actor } from './auth.js';
import { canUsePurchaseIntake } from './staff.js';
import { auditFromContext } from './audit.js';
import { extractXlsxImagesByRow } from './xlsx-embedded-images.js';

const DISAI_BODY_PREFIX = '69837277'; // 12-digit body without check digit: 69837277XXXX

const FIELD_KEYS = [
  'article',
  'name',
  'brand',
  'price',
  'currency',
  'barcode',
  'oem',
  'crosses',
  'applicability',
  'qty',
  'picture',
  'skip',
] as const;
export type MapField = (typeof FIELD_KEYS)[number];

type ColumnMap = Record<string, MapField>; // colIndex -> field

function deny(c: { json: (b: unknown, s: number) => Response }, actor: Actor | null) {
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canUsePurchaseIntake(actor)) {
    return c.json({ error: 'Доступ только у админа и отдела закупки' }, 403);
  }
  return null;
}

function storageRoot(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dataDir =
    process.env.WMS_DATA_DIR || path.resolve(__dirname, '..', '..', 'data');
  const dir = join(dataDir, 'purchase-intake');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function importDir(id: string): string {
  const dir = join(storageRoot(), id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function filePath(importId: string, filename: string): string {
  return join(importDir(importId), filename.replace(/[/\\]/g, '_').slice(0, 180) || 'file.bin');
}

function ean13CheckDigit(d12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = Number(d12[i] || 0);
    sum += n * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

function makeEan13(serial4: number): string {
  const body = `${DISAI_BODY_PREFIX}${String(Math.max(0, Math.min(9999, serial4))).padStart(4, '0')}`;
  return `${body}${ean13CheckDigit(body)}`;
}

/** Следующие свободные DiSAI EAN-13 из диапазона свидетельства. */
export function allocateDisaiBarcodes(count: number): string[] {
  const used = new Set(
    all<{ barcode: string }>(
      `SELECT barcode FROM products WHERE barcode LIKE '69837277%'
       UNION
       SELECT barcode FROM purchase_basket_lines WHERE barcode LIKE '69837277%'`
    ).map((r) => String(r.barcode || '').trim())
  );
  let serial = 0;
  for (const b of used) {
    if (!/^69837277\d{5}$/.test(b)) continue;
    const s = Number(b.slice(8, 12));
    if (Number.isFinite(s) && s >= serial) serial = s + 1;
  }
  const out: string[] = [];
  while (out.length < count && serial <= 9999) {
    const code = makeEan13(serial);
    serial += 1;
    if (used.has(code)) continue;
    used.add(code);
    out.push(code);
  }
  if (out.length < count) {
    throw new Error(`Не хватает свободных DiSAI ШК (нужно ${count}, есть ${out.length})`);
  }
  return out;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQ = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') {
      inQ = true;
      continue;
    }
    if (ch === ',' || ch === ';' || ch === '\t') {
      row.push(cur.trim());
      cur = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cur.trim());
      cur = '';
      if (row.some((c) => c)) rows.push(row);
      row = [];
      continue;
    }
    if (ch === '\r') continue;
    cur += ch;
  }
  row.push(cur.trim());
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

async function parseSpreadsheet(
  buf: Buffer,
  filename: string,
  sheetName?: string
): Promise<{ sheets: string[]; sheet: string; rows: string[][] }> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const rows = parseCsv(buf.toString('utf8'));
    return { sheets: ['CSV'], sheet: 'CSV', rows };
  }
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, raw: false });
  const sheets = wb.SheetNames || [];
  if (!sheets.length) throw new Error('В файле нет листов');
  const sheet = sheetName && sheets.includes(sheetName) ? sheetName : sheets[0]!;
  const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheet]!, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: true,
  }) as unknown as string[][];
  const rows = (aoa || []).map((r) =>
    (Array.isArray(r) ? r : []).map((c) => String(c ?? '').trim())
  );
  return { sheets, sheet, rows };
}

function cellAt(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return '';
  return String(row[idx] ?? '').trim();
}

function parsePrice(raw: string): number {
  const s = raw.replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-я]+/gi, '')
    .trim();
}

function headerNorm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Правила угадывания колонок прайса (RU / EN / CN). Порядок = приоритет. */
const HEADER_FIELD_RULES: { field: MapField; re: RegExp }[] = [
  { field: 'skip', re: /^(line\s*no\.?|№\s*п\/?п|packaging|status|状态|watermark|备注|备注说明)$/i },
  { field: 'picture', re: /(picture|фото|photo|图片|产品图片|image|img)/i },
  { field: 'price', re: /(цена|price|单价|价格|\bamount\b|\bcost\b|￥|₽)/i },
  { field: 'currency', re: /(валюта|currency|币种|currency\s*code)/i },
  { field: 'barcode', re: /(штрих|barcode|ean|upc|条码)/i },
  { field: 'oem', re: /(^oe\b|\boem\b|oe\s*#|oe\s*no|oe号|原厂|原厂号|oe\s*number)/i },
  { field: 'crosses', re: /(кросс|cross(es)?|analog|дубл|互换|替代)/i },
  {
    field: 'article',
    re: /(артикул|\bsku\b|article|xgm\s*no|ty\s*no\.?|图号|工厂编号|货号|part\s*no|item\s*no|item\s*code|product\s*no|厂编)/i,
  },
  { field: 'qty', re: /(кол-?во|qty|quantity|количество|数量|мот)/i },
  { field: 'brand', re: /(бренд|\bbrand\b|品牌|\bmake\b)/i },
  {
    field: 'applicability',
    re: /(применим|applic|model|chassis|year|год|года|车型|车系|底盘|年份|fitting|platform|position|位置|车辆)/i,
  },
  {
    field: 'name',
    re: /(наименован|название|назван|\bname\b|名称|category|分类|description|vehicle|product|номенклатур|品名)/i,
  },
];

function guessFieldFromHeader(header: string): MapField | 'skip' | null {
  const h = headerNorm(header);
  if (!h) return null;
  for (const rule of HEADER_FIELD_RULES) {
    if (rule.re.test(h)) return rule.field;
  }
  return null;
}

function scoreHeaderRow(cells: string[]): number {
  let score = 0;
  const seen = new Set<string>();
  for (const cell of cells) {
    const f = guessFieldFromHeader(cell);
    if (!f || f === 'skip') continue;
    if (seen.has(f) && (f === 'article' || f === 'price' || f === 'name')) continue;
    seen.add(f);
    score += f === 'article' || f === 'price' || f === 'oem' || f === 'name' ? 3 : 1;
  }
  return score;
}

/** Найти строку заголовков среди первых строк листа. */
export function guessHeaderRowIndex(rows: string[][], maxScan = 20): number {
  let bestIdx = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, maxScan);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] || [];
    if (!row.some((c) => String(c || '').trim())) continue;
    const nonEmpty = row.filter((c) => String(c || '').trim()).length;
    // заголовок бренда «AUDI 奥迪» — одна-две ячейки, мало ключевых слов
    const score = scoreHeaderRow(row) + (nonEmpty >= 4 ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestScore >= 2 ? bestIdx : Math.max(0, rows.findIndex((r) => r.some((c) => String(c || '').trim())));
}

/** Угадать маппинг колонок по заголовкам. */
export function guessColumnMap(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const takenUnique = new Set<MapField>();
  const uniqueOnce: MapField[] = ['article', 'name', 'brand', 'price', 'currency', 'barcode', 'qty'];
  headers.forEach((h, i) => {
    const field = guessFieldFromHeader(h);
    if (!field || field === 'skip') {
      map[String(i)] = 'skip';
      return;
    }
    if (uniqueOnce.includes(field) && takenUnique.has(field)) {
      // второй «model» → applicability уже занят не уникальным; второй article → skip
      if (field === 'name') {
        map[String(i)] = 'applicability';
        return;
      }
      map[String(i)] = 'skip';
      return;
    }
    map[String(i)] = field;
    if (uniqueOnce.includes(field)) takenUnique.add(field);
  });
  return map;
}

function detectSheetLayout(rows: string[][]): {
  headerIdx: number;
  headers: string[];
  column_map: ColumnMap;
} {
  const headerIdx = guessHeaderRowIndex(rows);
  const headers = (rows[headerIdx] || []).map((c) => String(c ?? '').trim());
  // обрезать хвост пустых заголовков, но сохранить индексы
  let last = headers.length - 1;
  while (last > 0 && !headers[last]) last -= 1;
  const trimmed = headers.slice(0, last + 1);
  return { headerIdx, headers: trimmed, column_map: guessColumnMap(trimmed) };
}

function purchasePriceFor(productId: string): number | null {
  const row = get<{ price: number }>(
    `SELECT price FROM product_prices
     WHERE product_id = ?
       AND (lower(price_type) LIKE '%закуп%' OR lower(price_type) LIKE '%purchase%'
            OR lower(price_type) LIKE '%себест%' OR lower(price_type) LIKE '%cost%')
     ORDER BY price ASC LIMIT 1`,
    [productId]
  );
  if (row && Number.isFinite(Number(row.price))) return Number(row.price);
  const any = get<{ price: number }>(
    `SELECT price FROM product_prices WHERE product_id = ? ORDER BY price ASC LIMIT 1`,
    [productId]
  );
  return any && Number.isFinite(Number(any.price)) ? Number(any.price) : null;
}

function matchProduct(opts: {
  barcode: string;
  article: string;
  oem: string;
  name: string;
}): { id: string; sku: string } | null {
  const barcode = opts.barcode.trim();
  if (barcode) {
    const byBc = get<{ id: string; sku: string }>(
      `SELECT id, sku FROM products WHERE barcode = ? AND IFNULL(is_active,1)=1 LIMIT 1`,
      [barcode]
    );
    if (byBc) return byBc;
  }
  for (const token of [opts.article, opts.oem].map((x) => x.trim()).filter(Boolean)) {
    const hit = get<{ id: string; sku: string }>(
      `SELECT id, sku FROM products
       WHERE IFNULL(is_active,1)=1 AND (
         sku = ? OR code = ? OR barcode = ?
         OR (',' || REPLACE(IFNULL(array_sku,''),' ','') || ',') LIKE ?
       )
       LIMIT 1`,
      [token, token, token, `%,${token.replace(/,/g, '')},%`]
    );
    if (hit) return hit;
  }
  const nk = normKey(opts.name);
  if (nk.length >= 6) {
    const candidates = all<{ id: string; sku: string; name: string }>(
      `SELECT id, sku, name FROM products WHERE IFNULL(is_active,1)=1 AND length(name) >= 4 LIMIT 8000`
    );
    for (const c of candidates) {
      if (normKey(c.name) === nk) return { id: c.id, sku: c.sku };
    }
  }
  return null;
}

function ensurePurchaseIntakeSchema(): void {
  try {
    const cols = db
      .prepare(`PRAGMA table_info(purchase_price_rows)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'picture_path')) {
      db.exec(
        `ALTER TABLE purchase_price_rows ADD COLUMN picture_path TEXT NOT NULL DEFAULT ''`
      );
    }
  } catch {
    /* ignore */
  }
}

function applyMapAndMatch(
  importId: string,
  map: ColumnMap,
  headerRow: number,
  sheetRows: string[][],
  opts?: { xlsxBuf?: Buffer }
): {
  row_count: number;
  new_count: number;
  changed_count: number;
  matched_count: number;
  pictures: number;
} {
  ensurePurchaseIntakeSchema();
  run('DELETE FROM purchase_price_rows WHERE import_id = ?', [importId]);
  const picsDir = join(importDir(importId), 'pics');
  try {
    rmSync(picsDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  mkdirSync(picsDir, { recursive: true });

  const imagesByRow = opts?.xlsxBuf
    ? extractXlsxImagesByRow(opts.xlsxBuf)
    : new Map<number, { buf: Buffer; ext: string; mime: string }>();

  const startIdx = Math.max(0, headerRow); // 1-based header → data starts at headerRow
  let new_count = 0;
  let changed_count = 0;
  let matched_count = 0;
  let row_count = 0;
  let pictures = 0;

  const entries = Object.entries(map)
    .map(([k, v]) => [Number(k), v] as const)
    .filter(([i, f]) => Number.isFinite(i) && f && f !== 'skip' && f !== 'picture');

  for (let i = startIdx; i < sheetRows.length; i++) {
    const raw = sheetRows[i] || [];
    if (!raw.some((c) => String(c || '').trim()) && !imagesByRow.has(i)) continue;
    const fields: Record<string, string> = {
      article: '',
      name: '',
      brand: '',
      price: '',
      currency: 'RUB',
      barcode: '',
      oem: '',
      crosses: '',
      applicability: '',
      qty: '',
    };
    for (const [col, field] of entries) {
      if (field === 'skip') continue;
      const val = cellAt(raw, col);
      if (!val) continue;
      if (field in fields) {
        fields[field] = fields[field] ? `${fields[field]}; ${val}` : val;
      }
    }
    // если name пусто — взять article
    if (!fields.name && fields.article) fields.name = fields.article;
    if (!fields.name && !fields.article && !fields.barcode && !fields.oem) continue;

    const price = parsePrice(fields.price);
    const qty = parsePrice(fields.qty) || 0;
    const hit = matchProduct({
      barcode: fields.barcode,
      article: fields.article,
      oem: fields.oem,
      name: fields.name,
    });

    let match_status = 'new';
    let old_price: number | null = null;
    let price_delta: number | null = null;
    let match_product_id = '';
    let match_sku = '';

    if (hit) {
      match_product_id = hit.id;
      match_sku = hit.sku;
      old_price = purchasePriceFor(hit.id);
      if (old_price != null && price > 0 && Math.abs(old_price - price) >= 0.01) {
        match_status = 'price_changed';
        price_delta = price - old_price;
        changed_count += 1;
      } else {
        match_status = 'matched';
        matched_count += 1;
      }
    } else {
      new_count += 1;
    }

    let picture_path = '';
    const img = imagesByRow.get(i);
    if (img) {
      const fname = `r${i}.${img.ext}`;
      writeFileSync(join(picsDir, fname), img.buf);
      picture_path = `pics/${fname}`;
      pictures += 1;
    }

    const id = newGuid();
    run(
      `INSERT INTO purchase_price_rows (
         id, import_id, row_no, raw_json, article, name, brand, price, currency,
         barcode, oem, crosses, applicability, qty, match_status, match_product_id,
         match_sku, old_price, price_delta, picture_path
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        importId,
        i + 1,
        JSON.stringify(raw),
        fields.article,
        fields.name,
        fields.brand,
        price,
        fields.currency || 'RUB',
        fields.barcode,
        fields.oem,
        fields.crosses,
        fields.applicability,
        qty,
        match_status,
        match_product_id,
        match_sku,
        old_price,
        price_delta,
        picture_path,
      ]
    );
    row_count += 1;
  }

  run(
    `UPDATE purchase_price_imports SET
       status = 'parsed', parsed_at = datetime('now'),
       row_count = ?, new_count = ?, changed_count = ?, matched_count = ?,
       column_map_json = ?, header_row = ?
     WHERE id = ?`,
    [row_count, new_count, changed_count, matched_count, JSON.stringify(map), headerRow, importId]
  );

  return { row_count, new_count, changed_count, matched_count, pictures };
}

function importDto(id: string) {
  const row = get<Record<string, unknown>>(
    'SELECT * FROM purchase_price_imports WHERE id = ?',
    [id]
  );
  if (!row) return null;
  let column_map: ColumnMap = {};
  try {
    column_map = JSON.parse(String(row.column_map_json || '{}')) as ColumnMap;
  } catch {
    column_map = {};
  }
  return {
    ...row,
    column_map,
    column_map_json: undefined,
  };
}

function basketDto(id: string): Record<string, unknown> | null {
  const b = get<Record<string, unknown>>('SELECT * FROM purchase_baskets WHERE id = ?', [id]);
  if (!b) return null;
  const lines = all<Record<string, unknown>>(
    `SELECT * FROM purchase_basket_lines WHERE basket_id = ? ORDER BY created_at, rowid`,
    [id]
  );
  const sum = lines.reduce((a, L) => a + Number(L.price || 0) * Number(L.qty || 0), 0);
  return { ...b, lines, lines_count: lines.length, sum };
}

function parseApplicability(text: string): Array<{
  mark: string;
  model: string;
  years: string;
}> {
  const t = text.trim();
  if (!t) return [];
  // «Mark Model 2015-2020» / несколько через ;
  return t
    .split(/[;|\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) => {
      const years = (part.match(/\b(19|20)\d{2}(\s*[-–—]\s*(19|20)\d{2})?\b/) || [''])[0] || '';
      const rest = part.replace(years, '').trim();
      const bits = rest.split(/\s+/).filter(Boolean);
      return {
        mark: bits[0] || rest || part,
        model: bits.slice(1).join(' '),
        years: years.replace(/\s+/g, ''),
      };
    });
}

async function readUploadBuffer(c: {
  req: { parseBody: () => Promise<Record<string, unknown>>; json: () => Promise<unknown> };
}): Promise<{ buf: Buffer; fileName: string }> {
  const ctype = String(
    (c as unknown as { req: { header: (n: string) => string | undefined } }).req.header(
      'content-type'
    ) || ''
  );
  if (ctype.includes('multipart/form-data')) {
    const form = await c.req.parseBody();
    const file = form.file ?? form.attachment ?? form.document;
    if (file && typeof file === 'object' && 'arrayBuffer' in file) {
      const f = file as File;
      const ab = await f.arrayBuffer();
      return { buf: Buffer.from(ab), fileName: f.name || 'price.xlsx' };
    }
    throw new Error('Нужен multipart с полем file');
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    filename?: string;
    content_base64?: string;
  };
  if (!body.content_base64) throw new Error('Нужен file или content_base64');
  return {
    buf: Buffer.from(body.content_base64, 'base64'),
    fileName: body.filename || 'price.xlsx',
  };
}

/** Создать импорт прайса из буфера (ручная загрузка / Google Drive). */
export async function createPurchaseImportFromBuffer(input: {
  buf: Buffer;
  fileName: string;
  supplier_id?: string;
  supplier_name?: string;
  created_by?: string;
  drive_file_id?: string;
  drive_folder_id?: string;
}): Promise<{ id: string; filename: string; sheet_name: string; sheets: string[] }> {
  const { ensurePurchaseDriveSchema } = await import('./purchase-drive.js');
  ensurePurchaseDriveSchema();
  const fileName = String(input.fileName || 'price.xlsx').replace(/[/\\]/g, '_').slice(0, 180);
  let supplier_id = String(input.supplier_id || '').trim();
  let supplier_name = String(input.supplier_name || '').trim();
  if (supplier_id && !supplier_name) {
    supplier_name =
      get<{ name: string }>('SELECT name FROM counterparties WHERE id = ?', [supplier_id])?.name ||
      '';
  }
  const parsed = await parseSpreadsheet(input.buf, fileName);
  const layout = detectSheetLayout(parsed.rows);
  const id = newGuid();
  writeFileSync(filePath(id, fileName), input.buf);
  run(
    `INSERT INTO purchase_price_imports (
       id, supplier_id, supplier_name, filename, sheet_name, status, created_by,
       drive_file_id, drive_folder_id, column_map_json, header_row
     ) VALUES (?,?,?,?,?,'uploaded',?,?,?,?,?)`,
    [
      id,
      supplier_id,
      supplier_name,
      fileName,
      parsed.sheet,
      String(input.created_by || 'drive'),
      String(input.drive_file_id || ''),
      String(input.drive_folder_id || ''),
      JSON.stringify(layout.column_map),
      layout.headerIdx + 1,
    ]
  );
  // сразу разобрать, если угадали артикул/имя
  const vals = Object.values(layout.column_map);
  if (vals.includes('article') || vals.includes('name')) {
    try {
      applyMapAndMatch(id, layout.column_map, layout.headerIdx + 1, parsed.rows, {
        xlsxBuf: input.buf,
      });
    } catch {
      /* оставим uploaded — разберут вручную */
    }
  }
  return { id, filename: fileName, sheet_name: parsed.sheet, sheets: parsed.sheets };
}

export function mountPurchaseIntakeRoutes(api: Hono): void {
  api.get('/purchase-intake/meta', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    return c.json({
      fields: FIELD_KEYS.filter((f) => f !== 'skip').map((id) => ({
        id,
        label:
          (
            {
              article: 'Артикул',
              name: 'Наименование',
              brand: 'Бренд',
              price: 'Цена',
              currency: 'Валюта',
              barcode: 'Штрихкод',
              oem: 'OEM',
              crosses: 'Кроссы',
              applicability: 'Применимость',
              qty: 'Кол-во',
              picture: 'Фото',
            } as Record<string, string>
          )[id] || id,
      })),
      ok: true,
    });
  });

  api.get('/purchase-intake/imports', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const rows = all<Record<string, unknown>>(
      `SELECT id, supplier_id, supplier_name, filename, sheet_name, status,
              row_count, new_count, changed_count, matched_count, created_at, created_by
       FROM purchase_price_imports ORDER BY created_at DESC LIMIT 100`
    );
    return c.json({ items: rows });
  });

  api.post('/purchase-intake/imports', async (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    try {
      const { buf, fileName } = await readUploadBuffer(c);
      if (!buf.length) return c.json({ error: 'Пустой файл' }, 400);
      const supplier_id = String(c.req.query('supplier_id') || '').trim();
      let supplier_name = String(c.req.query('supplier_name') || '').trim();
      if (supplier_id && !supplier_name) {
        supplier_name =
          get<{ name: string }>('SELECT name FROM counterparties WHERE id = ?', [supplier_id])
            ?.name || '';
      }
      const id = newGuid();
      const path = filePath(id, fileName);
      writeFileSync(path, buf);
      const parsed = await parseSpreadsheet(buf, fileName);
      const layout = detectSheetLayout(parsed.rows);
      run(
        `INSERT INTO purchase_price_imports (
           id, supplier_id, supplier_name, filename, sheet_name, status, created_by,
           column_map_json, header_row
         ) VALUES (?,?,?,?,?,'uploaded',?,?,?)`,
        [
          id,
          supplier_id,
          supplier_name,
          fileName,
          parsed.sheet,
          actor!.id,
          JSON.stringify(layout.column_map),
          layout.headerIdx + 1,
        ]
      );
      auditFromContext(c, {
        action: 'purchase_intake.upload',
        entity: 'purchase_price_import',
        entityId: id,
        summary: `Прайс загружен: ${fileName}`,
      });
      return c.json(
        {
          import: importDto(id),
          sheets: parsed.sheets,
          header_row_1based: layout.headerIdx + 1,
          headers: layout.headers,
          sample: parsed.rows.slice(layout.headerIdx + 1, layout.headerIdx + 6),
          suggested_map: layout.column_map,
        },
        201
      );
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'upload failed' }, 400);
    }
  });

  api.get('/purchase-intake/imports/:id', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const dto = importDto(c.req.param('id'));
    if (!dto) return c.json({ error: 'not found' }, 404);
    return c.json(dto);
  });

  api.get('/purchase-intake/imports/:id/preview', async (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const id = c.req.param('id');
    const imp = get<{ filename: string; sheet_name: string; header_row: number }>(
      'SELECT filename, sheet_name, header_row FROM purchase_price_imports WHERE id = ?',
      [id]
    );
    if (!imp) return c.json({ error: 'not found' }, 404);
    const path = filePath(id, imp.filename);
    if (!existsSync(path)) return c.json({ error: 'Файл импорта не найден на диске' }, 404);
    const sheetQ = String(c.req.query('sheet') || imp.sheet_name || '').trim();
    try {
      const parsed = await parseSpreadsheet(readFileSync(path), imp.filename, sheetQ || undefined);
      const forcedHeader = c.req.query('header_row');
      const savedMap = (() => {
        try {
          return JSON.parse(
            String(
              get<{ column_map_json: string }>(
                'SELECT column_map_json FROM purchase_price_imports WHERE id = ?',
                [id]
              )?.column_map_json || '{}'
            )
          ) as ColumnMap;
        } catch {
          return {} as ColumnMap;
        }
      })();
      const layout = detectSheetLayout(parsed.rows);
      let headerIdx = forcedHeader
        ? Math.max(0, Number(forcedHeader) - 1)
        : Object.keys(savedMap).length
          ? Math.max(0, (Number(imp.header_row) || layout.headerIdx + 1) - 1)
          : layout.headerIdx;
      if (!parsed.rows[headerIdx]?.some((x) => x)) {
        headerIdx = layout.headerIdx;
      }
      const headers = (parsed.rows[headerIdx] || []).map((c) => String(c ?? '').trim());
      let last = headers.length - 1;
      while (last > 0 && !headers[last]) last -= 1;
      const trimmed = headers.slice(0, last + 1);
      const suggested_map =
        Object.keys(savedMap).length && forcedHeader == null && Number(imp.header_row) === headerIdx + 1
          ? savedMap
          : guessColumnMap(trimmed);
      // если в БД пустой маппинг — сохранить угаданный
      if (!Object.keys(savedMap).length && Object.values(suggested_map).some((v) => v !== 'skip')) {
        run(
          `UPDATE purchase_price_imports SET column_map_json = ?, header_row = ? WHERE id = ?`,
          [JSON.stringify(suggested_map), headerIdx + 1, id]
        );
      }
      return c.json({
        sheets: parsed.sheets,
        sheet: parsed.sheet,
        header_row_1based: headerIdx + 1,
        headers: trimmed,
        sample: parsed.rows.slice(headerIdx + 1, headerIdx + 8),
        suggested_map,
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'preview failed' }, 400);
    }
  });

  api.put('/purchase-intake/imports/:id/map', async (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const id = c.req.param('id');
    const imp = get<{ filename: string; sheet_name: string }>(
      'SELECT filename, sheet_name FROM purchase_price_imports WHERE id = ?',
      [id]
    );
    if (!imp) return c.json({ error: 'not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      column_map?: ColumnMap;
      header_row?: number;
      sheet?: string;
      supplier_id?: string;
      supplier_name?: string;
    };
    const map = body.column_map || {};
    if (!Object.values(map).includes('name') && !Object.values(map).includes('article')) {
      return c.json({ error: 'Укажите колонку «Наименование» или «Артикул»' }, 400);
    }
    const path = filePath(id, imp.filename);
    if (!existsSync(path)) return c.json({ error: 'Файл не найден' }, 404);
    const sheet = String(body.sheet || imp.sheet_name || '').trim();
    try {
      const xlsxBuf = readFileSync(path);
      const parsed = await parseSpreadsheet(xlsxBuf, imp.filename, sheet || undefined);
      const headerRow = Math.max(1, Number(body.header_row) || 1);
      if (body.supplier_id != null || body.supplier_name != null) {
        run(
          `UPDATE purchase_price_imports SET supplier_id = ?, supplier_name = ?, sheet_name = ? WHERE id = ?`,
          [
            String(body.supplier_id || ''),
            String(body.supplier_name || ''),
            parsed.sheet,
            id,
          ]
        );
      } else {
        run(`UPDATE purchase_price_imports SET sheet_name = ? WHERE id = ?`, [parsed.sheet, id]);
      }
      const stats = applyMapAndMatch(id, map, headerRow, parsed.rows, { xlsxBuf });
      auditFromContext(c, {
        action: 'purchase_intake.parse',
        entity: 'purchase_price_import',
        entityId: id,
        summary: `Прайс разобран: ${stats.row_count} строк (новых ${stats.new_count}, цен↑↓ ${stats.changed_count}, фото ${stats.pictures})`,
      });
      return c.json({ import: importDto(id), ...stats });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'parse failed' }, 400);
    }
  });

  api.get('/purchase-intake/imports/:id/rows', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    ensurePurchaseIntakeSchema();
    const id = c.req.param('id');
    const status = String(c.req.query('status') || '').trim();
    const q = String(c.req.query('q') || '').trim();
    const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') || 200) || 200));
    const offset = Math.max(0, Number(c.req.query('offset') || 0) || 0);
    const where = ['import_id = ?'];
    const params: Array<string | number> = [id];
    if (status) {
      where.push('match_status = ?');
      params.push(status);
    }
    if (q) {
      where.push(
        `(name LIKE ? OR article LIKE ? OR brand LIKE ? OR barcode LIKE ? OR oem LIKE ? OR match_sku LIKE ?)`
      );
      const like = `%${q}%`;
      params.push(like, like, like, like, like, like);
    }
    const items = all<Record<string, unknown>>(
      `SELECT * FROM purchase_price_rows WHERE ${where.join(' AND ')}
       ORDER BY row_no LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ).map((r) => {
      const pic = String(r.picture_path || '').trim();
      return {
        ...r,
        has_picture: Boolean(pic),
        picture_url: pic
          ? `/api/purchase-intake/imports/${id}/rows/${r.id}/picture`
          : '',
      };
    });
    const total =
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM purchase_price_rows WHERE ${where.join(' AND ')}`,
        params
      )?.c ?? 0;
    return c.json({ items, total, limit, offset });
  });

  api.get('/purchase-intake/imports/:id/rows/:rowId/picture', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    ensurePurchaseIntakeSchema();
    const id = c.req.param('id');
    const rowId = c.req.param('rowId');
    const row = get<{ picture_path: string; import_id: string }>(
      `SELECT picture_path, import_id FROM purchase_price_rows WHERE id = ? AND import_id = ?`,
      [rowId, id]
    );
    if (!row) return c.json({ error: 'not found' }, 404);
    const rel = String(row.picture_path || '').trim();
    if (!rel || rel.includes('..') || !rel.startsWith('pics/')) {
      return c.json({ error: 'no picture' }, 404);
    }
    const root = importDir(id);
    const abs = join(root, rel);
    if (!abs.startsWith(root) || !existsSync(abs)) {
      return c.json({ error: 'file missing' }, 404);
    }
    const buf = readFileSync(abs);
    const lower = abs.toLowerCase();
    const mime = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.gif')
        ? 'image/gif'
        : lower.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg';
    return new Response(buf, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=86400',
      },
    });
  });

  api.delete('/purchase-intake/imports/:id', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const id = c.req.param('id');
    run('DELETE FROM purchase_price_rows WHERE import_id = ?', [id]);
    run('DELETE FROM purchase_price_imports WHERE id = ?', [id]);
    return c.json({ ok: true });
  });

  // —— baskets ——
  api.get('/purchase-intake/baskets', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const items = all<Record<string, unknown>>(
      `SELECT b.*,
         (SELECT COUNT(*) FROM purchase_basket_lines l WHERE l.basket_id = b.id) AS lines_count,
         (SELECT IFNULL(SUM(l.price * l.qty),0) FROM purchase_basket_lines l WHERE l.basket_id = b.id) AS sum
       FROM purchase_baskets b ORDER BY b.updated_at DESC LIMIT 100`
    );
    return c.json({ items });
  });

  api.post('/purchase-intake/baskets', async (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      supplier_id?: string;
      supplier_name?: string;
      notes?: string;
    };
    const id = newGuid();
    const name = String(body.name || '').trim() || `Корзина ${new Date().toLocaleDateString('ru-RU')}`;
    run(
      `INSERT INTO purchase_baskets (id, name, supplier_id, supplier_name, notes, created_by)
       VALUES (?,?,?,?,?,?)`,
      [
        id,
        name,
        String(body.supplier_id || ''),
        String(body.supplier_name || ''),
        String(body.notes || ''),
        actor!.id,
      ]
    );
    return c.json(basketDto(id), 201);
  });

  api.get('/purchase-intake/baskets/:id', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const dto = basketDto(c.req.param('id'));
    if (!dto) return c.json({ error: 'not found' }, 404);
    return c.json(dto);
  });

  api.patch('/purchase-intake/baskets/:id', async (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const id = c.req.param('id');
    if (!get('SELECT id FROM purchase_baskets WHERE id = ?', [id])) {
      return c.json({ error: 'not found' }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      status?: string;
      notes?: string;
      supplier_id?: string;
      supplier_name?: string;
    };
    if (body.name != null) {
      run(`UPDATE purchase_baskets SET name = ?, updated_at = datetime('now') WHERE id = ?`, [
        String(body.name).trim(),
        id,
      ]);
    }
    if (body.status != null) {
      run(`UPDATE purchase_baskets SET status = ?, updated_at = datetime('now') WHERE id = ?`, [
        String(body.status).trim() || 'open',
        id,
      ]);
    }
    if (body.notes != null) {
      run(`UPDATE purchase_baskets SET notes = ?, updated_at = datetime('now') WHERE id = ?`, [
        String(body.notes),
        id,
      ]);
    }
    if (body.supplier_id != null || body.supplier_name != null) {
      run(
        `UPDATE purchase_baskets SET supplier_id = ?, supplier_name = ?, updated_at = datetime('now') WHERE id = ?`,
        [String(body.supplier_id || ''), String(body.supplier_name || ''), id]
      );
    }
    return c.json(basketDto(id));
  });

  api.delete('/purchase-intake/baskets/:id', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const id = c.req.param('id');
    run('DELETE FROM purchase_basket_lines WHERE basket_id = ?', [id]);
    run('DELETE FROM purchase_baskets WHERE id = ?', [id]);
    return c.json({ ok: true });
  });

  api.post('/purchase-intake/baskets/:id/lines', async (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const basketId = c.req.param('id');
    if (!get('SELECT id FROM purchase_baskets WHERE id = ?', [basketId])) {
      return c.json({ error: 'basket not found' }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      row_ids?: string[];
      /** Кол-во по id строки прайса (перекрывает qty из файла) */
      qtys?: Record<string, number>;
      lines?: Array<Record<string, unknown>>;
    };
    let added = 0;
    if (Array.isArray(body.row_ids) && body.row_ids.length) {
      const qtys = body.qtys && typeof body.qtys === 'object' ? body.qtys : {};
      for (const rid of body.row_ids) {
        const r = get<Record<string, unknown>>(
          'SELECT * FROM purchase_price_rows WHERE id = ?',
          [rid]
        );
        if (!r) continue;
        const fromUi = Number(qtys[String(rid)]);
        const fromFile = Number(r.qty);
        const qty = fromUi > 0 ? fromUi : fromFile > 0 ? fromFile : 1;
        run(
          `INSERT INTO purchase_basket_lines (
             id, basket_id, import_row_id, product_id, article, name, brand, price, currency,
             qty, barcode, oem, crosses, applicability
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            newGuid(),
            basketId,
            String(r.id),
            String(r.match_product_id || ''),
            String(r.article || ''),
            String(r.name || ''),
            String(r.brand || ''),
            Number(r.price) || 0,
            String(r.currency || 'RUB'),
            qty,
            String(r.barcode || ''),
            String(r.oem || ''),
            String(r.crosses || ''),
            String(r.applicability || ''),
          ]
        );
        added += 1;
      }
    }
    if (Array.isArray(body.lines)) {
      for (const L of body.lines) {
        run(
          `INSERT INTO purchase_basket_lines (
             id, basket_id, import_row_id, product_id, article, name, brand, price, currency,
             qty, barcode, oem, crosses, applicability, notes
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            newGuid(),
            basketId,
            String(L.import_row_id || ''),
            String(L.product_id || ''),
            String(L.article || ''),
            String(L.name || ''),
            String(L.brand || ''),
            Number(L.price) || 0,
            String(L.currency || 'RUB'),
            Number(L.qty) > 0 ? Number(L.qty) : 1,
            String(L.barcode || ''),
            String(L.oem || ''),
            String(L.crosses || ''),
            String(L.applicability || ''),
            String(L.notes || ''),
          ]
        );
        added += 1;
      }
    }
    run(`UPDATE purchase_baskets SET updated_at = datetime('now') WHERE id = ?`, [basketId]);
    return c.json({ ...basketDto(basketId), added });
  });

  api.patch('/purchase-intake/baskets/:bid/lines/:lid', async (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const body = (await c.req.json().catch(() => ({}))) as {
      qty?: number;
      price?: number;
      notes?: string;
      barcode?: string;
    };
    const lid = c.req.param('lid');
    if (body.qty != null) {
      run('UPDATE purchase_basket_lines SET qty = ? WHERE id = ?', [Number(body.qty) || 0, lid]);
    }
    if (body.price != null) {
      run('UPDATE purchase_basket_lines SET price = ? WHERE id = ?', [
        Math.max(0, Math.round(Number(body.price) || 0)),
        lid,
      ]);
    }
    if (body.notes != null) {
      run('UPDATE purchase_basket_lines SET notes = ? WHERE id = ?', [String(body.notes), lid]);
    }
    if (body.barcode != null) {
      run('UPDATE purchase_basket_lines SET barcode = ? WHERE id = ?', [
        String(body.barcode).trim(),
        lid,
      ]);
    }
    run(`UPDATE purchase_baskets SET updated_at = datetime('now') WHERE id = ?`, [
      c.req.param('bid'),
    ]);
    return c.json(basketDto(c.req.param('bid')));
  });

  api.delete('/purchase-intake/baskets/:bid/lines/:lid', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    run('DELETE FROM purchase_basket_lines WHERE id = ? AND basket_id = ?', [
      c.req.param('lid'),
      c.req.param('bid'),
    ]);
    run(`UPDATE purchase_baskets SET updated_at = datetime('now') WHERE id = ?`, [
      c.req.param('bid'),
    ]);
    return c.json(basketDto(c.req.param('bid')));
  });

  api.post('/purchase-intake/baskets/:id/email-draft', (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    const dto = basketDto(c.req.param('id'));
    if (!dto) return c.json({ error: 'not found' }, 404);
    const lines = (dto.lines || []) as Array<Record<string, unknown>>;
    const subject = `Заказ: ${dto.name}${dto.supplier_name ? ` · ${dto.supplier_name}` : ''}`;
    const bodyLines = [
      `Здравствуйте!`,
      ``,
      `Просим подтвердить заказ (${lines.length} поз.):`,
      ``,
      ...lines.map((L, i) => {
        const art = String(L.article || L.oem || '').trim();
        return `${i + 1}. ${art ? `[${art}] ` : ''}${L.name} × ${L.qty} · ${Math.round(Number(L.price) || 0)} ${L.currency || 'RUB'}`;
      }),
      ``,
      `Сумма: ${Number(dto.sum || 0).toFixed(2)}`,
      ``,
      `С уважением,`,
      actor?.name || '',
    ];
    const html = `<p>Здравствуйте!</p><p>Просим подтвердить заказ (${lines.length} поз.):</p><table border="1" cellpadding="4" cellspacing="0"><tr><th>#</th><th>Артикул</th><th>Наименование</th><th>Кол-во</th><th>Цена</th></tr>${lines
      .map(
        (L, i) =>
          `<tr><td>${i + 1}</td><td>${esc(String(L.article || L.oem || ''))}</td><td>${esc(String(L.name || ''))}</td><td>${L.qty}</td><td>${Math.round(Number(L.price) || 0)} ${esc(String(L.currency || 'RUB'))}</td></tr>`
      )
      .join('')}</table><p><b>Сумма:</b> ${Number(dto.sum || 0).toFixed(2)}</p>`;
    return c.json({
      subject,
      body_text: bodyLines.join('\n'),
      body_html: html,
      mailto: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`,
    });
  });

  api.get('/purchase-intake/baskets/:id/order.html', (c) => {
    const actor = actorFromContext(c);
    if (!actor || !canUsePurchaseIntake(actor)) {
      return c.text('Доступ запрещён', 403);
    }
    const dto = basketDto(c.req.param('id'));
    if (!dto) return c.text('not found', 404);
    const lines = (dto.lines || []) as Array<Record<string, unknown>>;
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"/><title>${esc(String(dto.name))}</title>
<style>body{font-family:system-ui,sans-serif;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 8px;font-size:13px}th{background:#f4f4f4;text-align:left}@media print{button{display:none}}</style></head><body>
<button onclick="print()">Печать</button>
<h1>${esc(String(dto.name))}</h1>
<p>${esc(String(dto.supplier_name || ''))} · ${lines.length} поз. · сумма ${Number(dto.sum || 0).toFixed(2)}</p>
<table><thead><tr><th>#</th><th>Артикул</th><th>OEM</th><th>Наименование</th><th>Бренд</th><th>ШК</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>
${lines
  .map((L, i) => {
    const qty = Number(L.qty) || 0;
    const price = Number(L.price) || 0;
    return `<tr><td>${i + 1}</td><td>${esc(String(L.article || ''))}</td><td>${esc(String(L.oem || ''))}</td><td>${esc(String(L.name || ''))}</td><td>${esc(String(L.brand || ''))}</td><td>${esc(String(L.barcode || ''))}</td><td>${qty}</td><td>${price.toFixed(2)}</td><td>${(qty * price).toFixed(2)}</td></tr>`;
  })
  .join('')}
</tbody></table></body></html>`;
    return c.html(html);
  });

  api.post('/purchase-intake/baskets/:id/allocate-barcodes', async (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    if (!canDo(actor, 'can_edit_products')) {
      return c.json({ error: 'Нужны права на номенклатуру' }, 403);
    }
    const dto = basketDto(c.req.param('id'));
    if (!dto) return c.json({ error: 'not found' }, 404);
    const lines = (dto.lines || []) as Array<Record<string, unknown>>;
    const need = lines.filter((L) => !String(L.barcode || '').trim() && !String(L.product_id || '').trim());
    if (!need.length) return c.json({ ...dto, allocated: 0, note: 'Нечего назначать' });
    try {
      const codes = allocateDisaiBarcodes(need.length);
      need.forEach((L, i) => {
        run('UPDATE purchase_basket_lines SET barcode = ? WHERE id = ?', [codes[i]!, String(L.id)]);
      });
      run(`UPDATE purchase_baskets SET updated_at = datetime('now') WHERE id = ?`, [
        c.req.param('id'),
      ]);
      auditFromContext(c, {
        action: 'purchase_intake.allocate_barcodes',
        entity: 'purchase_basket',
        entityId: c.req.param('id'),
        summary: `Назначено DiSAI ШК: ${codes.length}`,
      });
      return c.json({ ...basketDto(c.req.param('id')), allocated: codes.length, barcodes: codes });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'allocate failed' }, 400);
    }
  });

  api.post('/purchase-intake/baskets/:id/create-products', async (c) => {
    const actor = actorFromContext(c);
    const d = deny(c, actor);
    if (d) return d;
    if (!canDo(actor, 'can_edit_products')) {
      return c.json({ error: 'Нужны права на номенклатуру' }, 403);
    }
    const basketId = c.req.param('id');
    const dto = basketDto(basketId);
    if (!dto) return c.json({ error: 'not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      only_without_product?: boolean;
      assign_barcodes?: boolean;
      price_type?: string;
    };
    const onlyNew = body.only_without_product !== false;
    let lines = (dto.lines || []) as Array<Record<string, unknown>>;
    if (onlyNew) lines = lines.filter((L) => !String(L.product_id || '').trim());
    if (!lines.length) return c.json({ created: [], note: 'Нет строк для создания' });

    if (body.assign_barcodes !== false) {
      const needBc = lines.filter((L) => !String(L.barcode || '').trim());
      if (needBc.length) {
        const codes = allocateDisaiBarcodes(needBc.length);
        needBc.forEach((L, i) => {
          L.barcode = codes[i]!;
          run('UPDATE purchase_basket_lines SET barcode = ? WHERE id = ?', [
            codes[i]!,
            String(L.id),
          ]);
        });
      }
    }

    const unitId =
      get<{ id: string }>('SELECT id FROM units WHERE short_name = ? LIMIT 1', ['шт'])?.id ||
      get<{ id: string }>('SELECT id FROM units LIMIT 1')?.id ||
      '';
    if (!unitId) return c.json({ error: 'нет единиц измерения' }, 400);

    const priceType = String(body.price_type || 'Закупка').trim() || 'Закупка';
    const created: Array<{ line_id: string; product_id: string; sku: string; barcode: string }> =
      [];

    for (const L of lines) {
      const name = String(L.name || '').trim();
      if (!name) continue;
      const id = newGuid();
      const mx = get<{ m: number }>(
        `SELECT MAX(CAST(substr(v, instr(v, '-') + 1) AS INTEGER)) AS m FROM (
           SELECT sku AS v FROM products WHERE sku LIKE 'НФ-%'
           UNION ALL SELECT code AS v FROM products WHERE code LIKE 'НФ-%'
         )`
      )?.m;
      if (mx && Number.isFinite(Number(mx))) ensureSeqAtLeast('НФ', Number(mx));
      const sku = nextCode('НФ');
      const barcode = String(L.barcode || '').trim();
      const brand = String(L.brand || '').trim();
      const article = String(L.article || '').trim();
      const oem = String(L.oem || '').trim();
      const crosses = String(L.crosses || '').trim();
      const arraySku = [article, oem, ...crosses.split(/[;,|]/).map((x) => x.trim())]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(',');

      try {
        run(
          `INSERT INTO products (id, sku, name, category_id, unit_id, barcode, item_kind, code, brand, array_sku)
           VALUES (?,?,?,?,?,?, 'product', ?,?,?)`,
          [id, sku, name, null, unitId, barcode, sku, brand, arraySku]
        );
      } catch (e) {
        // fallback without brand/array if columns somehow missing
        run(
          `INSERT INTO products (id, sku, name, category_id, unit_id, barcode, item_kind, code)
           VALUES (?,?,?,?,?,?,'product',?)`,
          [id, sku, name, null, unitId, barcode, sku]
        );
        try {
          run('UPDATE products SET brand = ?, array_sku = ? WHERE id = ?', [brand, arraySku, id]);
        } catch {
          /* ignore */
        }
      }

      if (Number(L.price) > 0) {
        run(
          `INSERT OR REPLACE INTO product_prices (id, product_id, price_type, price) VALUES (?,?,?,?)`,
          [newGuid(), id, priceType, Math.round(Number(L.price))]
        );
      }

      for (const app of parseApplicability(String(L.applicability || ''))) {
        run(
          `INSERT INTO product_applicability (id, product_id, mark, model, only_model, generation, years)
           VALUES (?,?,?,?, '','', ?)`,
          [newGuid(), id, app.mark, app.model, app.years]
        );
      }

      // фото из прайса (встроенные картинки Excel)
      const importRowId = String(L.import_row_id || '').trim();
      if (importRowId) {
        try {
          ensurePurchaseIntakeSchema();
          const prow = get<{ picture_path: string; import_id: string }>(
            `SELECT picture_path, import_id FROM purchase_price_rows WHERE id = ?`,
            [importRowId]
          );
          const rel = String(prow?.picture_path || '').trim();
          if (prow && rel && !rel.includes('..') && rel.startsWith('pics/')) {
            const abs = join(importDir(prow.import_id), rel);
            if (existsSync(abs)) {
              const { uploadManualProductPhoto } = await import('./media.js');
              await uploadManualProductPhoto(id, readFileSync(abs));
            }
          }
        } catch {
          /* фото опционально — товар уже создан */
        }
      }

      run(
        `UPDATE purchase_basket_lines SET product_id = ?, barcode = ? WHERE id = ?`,
        [id, barcode, String(L.id)]
      );
      created.push({ line_id: String(L.id), product_id: id, sku, barcode });
    }

    run(`UPDATE purchase_baskets SET updated_at = datetime('now') WHERE id = ?`, [basketId]);
    auditFromContext(c, {
      action: 'purchase_intake.create_products',
      entity: 'purchase_basket',
      entityId: basketId,
      summary: `Создано товаров из корзины: ${created.length}`,
    });
    return c.json({ created, basket: basketDto(basketId) });
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
