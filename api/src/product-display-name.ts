/**
 * Именование номенклатуры.
 *
 * **Применимость** (фрактал / имя из виджета) — заказ покупателя, виджеты Amo,
 * счёт, УПД, оплата, договор.
 *
 * **Складское имя 1С** (`products.name`, `name_1c`) — только закупки, приход,
 * списание, карточка товара на складе. Не подставлять в документы продажи.
 */
import { all, get } from './db.js';

/** Внутренний код 1С (НФ-… / УСЛ-…), не каталожный артикул. */
function looksLikeInternalNfCode(s: string): boolean {
  return /^(00)?НФ-|УСЛ-/i.test(String(s || '').trim());
}

/** Убрать `@podveska` / `@fogel` для отображения; хвост `:8hex` оставить — отдельные карточки 1С.
 *  Строки остатков / PDF — всегда по product_id, не объединять. */
export function stripDeptSkuSuffix(sku: string): string {
  let s = String(sku || '').trim();
  if (!s) return '';
  const at = s.indexOf('@');
  if (at > 0) {
    const tail = s.slice(at + 1).toLowerCase();
    if (tail.startsWith('podveska') || tail.startsWith('fogel')) {
      const afterAt = s.slice(at + 1);
      const colonIdx = afterAt.indexOf(':');
      s = colonIdx >= 0 ? s.slice(0, at) + afterAt.slice(colonIdx) : s.slice(0, at);
    }
  }
  return s.trim();
}

/** Старые складские артикулы из warehouse_sku (через ; , | /). */
export function oldWarehouseSkus(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw || '')
    .split(/[;,|/\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)) {
    const key = part.toUpperCase().replace(/\s+/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out;
}

/** Склад: мастер, затем старые MRAER. */
export function warehouseArticleOf(p: {
  sku?: string | null;
  warehouse_sku?: string | null;
}): string {
  const sku = String(p?.sku || '').trim();
  const skuKey = sku.toUpperCase().replace(/\s+/g, '');
  const olds = oldWarehouseSkus(p?.warehouse_sku).filter(
    (x) => x.toUpperCase().replace(/\s+/g, '') !== skuKey
  );
  if (sku && olds.length) return `${sku} · старые: ${olds.join('; ')}`;
  return olds.join('; ') || sku;
}

export function catalogArticleOf(p: {
  sku?: string | null;
  code?: string | null;
  barcode?: string | null;
  array_sku?: string | null;
}): { article: string; code: string } {
  const sku = String(p?.sku || '').trim();
  const code = String(p?.code || '').trim() || sku;
  const barcode = String(p?.barcode || '').trim();
  const tokens = String(p?.array_sku || '')
    .split(/[,;|/]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // Мастер MRAER — как в виджете: и из sku, и из кроссов (старые 00- с OEM в sku).
  if (/^MRA[A-Z0-9]/i.test(sku)) return { article: sku, code };
  const mra = tokens.find((t) => /^MRA[A-Z0-9]/i.test(t));
  if (mra) return { article: mra, code };

  if (barcode && !looksLikeInternalNfCode(barcode) && !/^00-/i.test(barcode)) {
    return { article: barcode, code };
  }
  const oem = tokens.find(
    (t) =>
      t.toLowerCase() !== sku.toLowerCase() &&
      t.toLowerCase() !== code.toLowerCase() &&
      !looksLikeInternalNfCode(t) &&
      !/^00-/i.test(t)
  );
  if (oem) return { article: oem, code };
  if (sku && !looksLikeInternalNfCode(sku) && !/^00-/i.test(sku)) return { article: sku, code };
  if (sku && looksLikeInternalNfCode(sku) && code && !looksLikeInternalNfCode(code)) {
    return { article: code, code: sku };
  }
  return { article: sku || code, code };
}

/** Категория для маркетингового заголовка: рулевые рейки / амортизаторы. */
export function marketingCategoryLabel(category: string, inferFrom = ''): string {
  const cat = String(category || '').trim();
  const hay = `${cat} ${String(inferFrom || '').trim()}`.toLowerCase().replace(/ё/g, 'е');
  if (/рулев\w*\s*рейк|рейк\w*\s*рулев/.test(hay)) {
    if (cat && /рулев\w*\s*рейк|рейк\w*\s*рулев/i.test(cat)) return cat;
    return 'Рулевые рейки';
  }
  if (/амортизатор/.test(hay)) {
    if (cat && /амортизатор/i.test(cat)) return cat;
    return 'Амортизаторы';
  }
  return cat;
}

export function fractalDisplayName(input: {
  category?: string | null;
  mark?: string | null;
  model?: string | null;
  years?: string | null;
  generation?: string | null;
  fallbackName?: string | null;
}): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    const s = String(v ?? '').trim();
    if (s) parts.push(s);
  };
  push(marketingCategoryLabel(String(input.category ?? ''), String(input.fallbackName ?? '')));
  push(input.mark);
  push(input.model);
  const years = String(input.years ?? '').trim();
  const generation = String(input.generation ?? '').trim();
  if (years) push(years);
  else if (generation) push(generation);

  const title = parts.join(' ').trim();
  if (title) return title.slice(0, 255);
  const fallback = String(input.fallbackName ?? '').trim();
  return fallback ? fallback.slice(0, 255) : 'Товар';
}

/** Категория + годы применимости для товара (по марке/модели строки). */
export function lookupApplicabilityMeta(
  productId: string,
  mark: string,
  model: string
): { category: string; years: string } {
  const id = String(productId || '').trim();
  if (!id) return { category: '', years: '' };

  const cat = get<{ name: string }>(
    `SELECT c.name AS name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ?`,
    [id]
  );
  const category = String(cat?.name || '').trim();

  const m = String(mark || '').trim();
  const mo = String(model || '').trim();
  let years = '';
  if (m || mo) {
    const row = get<{ years: string }>(
      `SELECT IFNULL(years,'') AS years
       FROM product_applicability
       WHERE product_id = ?
         AND (? = '' OR mark = ?)
         AND (? = '' OR model = ? OR only_model = ?)
       ORDER BY
         CASE WHEN mark = ? AND (model = ? OR only_model = ?) THEN 0 ELSE 1 END,
         length(IFNULL(years,'')) DESC
       LIMIT 1`,
      [id, m, m, mo, mo, mo, m, mo, mo]
    );
    years = String(row?.years || '').trim();
  }
  return { category, years };
}

export type ApplicabilityLineInput = {
  product_guid?: string | null;
  product_id?: string | null;
  /** Имя применимости из виджета (order_items.name / crm_deal_items.name). */
  applicability_name?: string | null;
  /** Устар.: то же, что applicability_name. */
  name?: string | null;
  /** Складское имя 1С — не использовать для display_name. */
  name_1c?: string | null;
  product_name?: string | null;
  product_name_1c?: string | null;
  mark?: string | null;
  model?: string | null;
  generation?: string | null;
  category?: string | null;
  years?: string | null;
};

/** Склад / закупки / приход — только имя из карточки товара (1С). */
export function warehouseCatalogName(
  line: Pick<
    ApplicabilityLineInput,
    'name_1c' | 'product_name_1c' | 'product_name' | 'name'
  >
): string {
  const from1c = String(line.name_1c || line.product_name_1c || '').trim();
  if (from1c) return from1c;
  return String(line.product_name || line.name || '').trim() || 'Товар';
}

function applicabilityNameFromLine(line: ApplicabilityLineInput): string {
  return String(line.applicability_name || line.name || '').trim();
}

/**
 * Применимость для продаж: виджет, заказ, счёт, УПД, оплата.
 * Никогда не возвращает складское имя 1С.
 */
export function applicabilityLineName(line: ApplicabilityLineInput): string {
  const widgetName = applicabilityNameFromLine(line);
  const mark = String(line.mark || '').trim();
  const model = String(line.model || '').trim();
  const generation = String(line.generation || '').trim();
  const hasApp = Boolean(mark || model || generation);

  if (!hasApp) {
    return widgetName || 'Товар';
  }

  const productId = String(line.product_guid || line.product_id || '').trim();
  let category = String(line.category || '').trim();
  let years = String(line.years || '').trim();
  if (productId && (!category || !years)) {
    const meta = lookupApplicabilityMeta(productId, mark, model);
    if (!category) category = meta.category;
    if (!years) years = meta.years;
  }
  const inferFrom =
    widgetName ||
    String(line.name_1c || line.product_name_1c || line.product_name || '').trim();
  category = marketingCategoryLabel(category, inferFrom);

  return fractalDisplayName({
    category,
    mark,
    model,
    years,
    generation,
    fallbackName: widgetName || 'Товар',
  });
}

/** Заказ покупателя / UI сделки: display + складское имя отдельно. */
export function customerOrderLineDisplayName(
  line: ApplicabilityLineInput
): { display_name: string; name_1c: string; has_applicability: boolean } {
  const warehouseName = warehouseCatalogName(line);
  const widgetName = applicabilityNameFromLine(line);
  const display_name = applicabilityLineName(line);
  const mark = String(line.mark || '').trim();
  const model = String(line.model || '').trim();
  const generation = String(line.generation || '').trim();
  const hasApp =
    Boolean(mark || model || generation) ||
    Boolean(widgetName && warehouseName && widgetName !== warehouseName);

  return {
    display_name,
    name_1c: warehouseName,
    has_applicability: hasApp,
  };
}

function catalogGuidFromProductId(productId: string): string {
  const id = String(productId || '').trim();
  const idx = id.indexOf('::');
  if (idx >= 0) return id.slice(idx + 2).trim();
  return id;
}

/** Все id карточки для product_properties: bare GUID из сделки → scoped pnevmopodveska_2025::… */
function productIdsForPropertiesLookup(productId: string): string[] {
  const id = String(productId || '').trim();
  if (!id) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (x: string) => {
    const v = String(x || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  push(id);
  const guid = catalogGuidFromProductId(id);
  if (guid && guid !== id) push(guid);
  if (guid && !id.includes('::')) {
    push(`pnevmopodveska_2025::${guid}`);
    push(`fogel_2025::${guid}`);
    const rows = all<{ id: string }>(
      `SELECT id FROM products WHERE catalog_guid = ? LIMIT 4`,
      [guid]
    );
    for (const row of rows) push(String(row.id || '').trim());
  }
  return out;
}

/** Сторона / ось / привод из product_properties (как подсветка в виджете заказа). */
export function productPropsHighlight(productId: string): {
  side: string;
  axis: string;
  drive: string;
  model_version: string;
} {
  const ids = productIdsForPropertiesLookup(productId);
  if (!ids.length) {
    return { side: '', axis: '', drive: '', model_version: '' };
  }
  const ph = ids.map(() => '?').join(',');
  const rows = all<{ property: string; value: string }>(
    `SELECT property, IFNULL(value,'') AS value FROM product_properties
     WHERE product_id IN (${ph}) AND property IN ('Сторона','Ось','Привод','Версия модели')`,
    ids
  );
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[String(row.property || '')] = String(row.value || '').trim();
  }
  return {
    side: map['Сторона'] || '',
    axis: map['Ось'] || '',
    drive: map['Привод'] || '',
    model_version: map['Версия модели'] || '',
  };
}

/** « · Сторона: … · Ось: …» — как widgetNameHighlightHtml в amo/index.php. */
export function salesDocLineCharacteristicsSuffix(it: Record<string, unknown>): string {
  const s = (v: unknown) => String(v ?? '').trim();
  const guid = s(it.product_guid || it.product_id);
  const fromDb = productPropsHighlight(guid);
  const side = s(it.prop_side || it.side) || fromDb.side;
  const drive = s(it.prop_drive || it.drive) || fromDb.drive;
  const axis = s(it.prop_axis || it.axis) || fromDb.axis;
  const modelVer = s(it.prop_model_version || it.model_version) || fromDb.model_version;
  const parts: string[] = [];
  if (side) parts.push(`Сторона: ${side}`);
  if (drive) parts.push(`Привод: ${drive}`);
  if (axis) parts.push(`Ось: ${axis}`);
  if (modelVer) parts.push(`Версия модели: ${modelVer}`);
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

/** Счёт / УПД / ЗН / виджет документов. */
export function salesDocLineDisplayName(it: Record<string, unknown>): string {
  const s = (v: unknown) => String(v ?? '').trim();
  const base = applicabilityLineName({
    applicability_name: s(it.name),
    name_1c: s(it.name_1c),
    product_name_1c: s(it.product_name_1c),
    product_guid: s(it.product_guid || it.product_id),
    mark: s(it.mark),
    model: s(it.model),
    generation: s(it.generation),
    category: s(it.category_name),
  });
  if (/Сторона\s*:/i.test(base) || /Ось\s*:/i.test(base)) {
    return base;
  }
  return base + salesDocLineCharacteristicsSuffix(it);
}

/** Слить одинаковые строки (один товар + применимость + цена). */
export function mergeSalesDocLines<
  T extends {
    product_guid: string;
    sku: string;
    name: string;
    price: number;
    qty: number;
    amount: number;
    vat_amount: number;
    line_kind: string;
    line_no: number;
  },
>(lines: T[]): T[] {
  const out: T[] = [];
  const idxByKey = new Map<string, number>();
  for (const line of lines) {
    const key = [
      line.product_guid,
      line.sku,
      line.name,
      line.price,
      line.line_kind,
    ].join('\0');
    const hit = idxByKey.get(key);
    if (hit != null) {
      const prev = out[hit]!;
      prev.qty += line.qty;
      prev.amount = Math.round((prev.amount + line.amount) * 100) / 100;
      prev.vat_amount = Math.round((prev.vat_amount + line.vat_amount) * 100) / 100;
      continue;
    }
    idxByKey.set(key, out.length);
    out.push({ ...line });
  }
  return out.map((l, i) => ({ ...l, line_no: i + 1 }));
}
