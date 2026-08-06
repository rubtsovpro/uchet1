/**
 * Фрактальное имя номенклатуры — как в виджете amo1c
 * (product_applicability_display_name):
 * «{категория} {марка} {модель} {годы}»
 * Без применимости → оригинальное имя товара из 1С.
 */
import { get } from './db.js';

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
  push(input.category);
  push(input.mark);
  push(input.model);
  // годы из применимости; если пусто — поколение (у нас в сделке есть generation)
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

/** Имя для заказа покупателя: фрактал по марке/модели; иначе имя товара. */
export function customerOrderLineDisplayName(line: {
  product_guid?: string | null;
  product_id?: string | null;
  name?: string | null;
  product_name?: string | null;
  mark?: string | null;
  model?: string | null;
  generation?: string | null;
  category?: string | null;
  years?: string | null;
}): { display_name: string; name_1c: string; has_applicability: boolean } {
  const productId = String(line.product_guid || line.product_id || '').trim();
  const name1c = String(line.product_name || line.name || '').trim() || 'Товар';
  const mark = String(line.mark || '').trim();
  const model = String(line.model || '').trim();
  const generation = String(line.generation || '').trim();
  const hasApp = Boolean(mark || model || generation);

  if (!hasApp) {
    return { display_name: name1c, name_1c: name1c, has_applicability: false };
  }

  let category = String(line.category || '').trim();
  let years = String(line.years || '').trim();
  if (productId && (!category || !years)) {
    const meta = lookupApplicabilityMeta(productId, mark, model);
    if (!category) category = meta.category;
    if (!years) years = meta.years;
  }

  return {
    display_name: fractalDisplayName({
      category,
      mark,
      model,
      years,
      generation,
      fallbackName: name1c,
    }),
    name_1c: name1c,
    has_applicability: true,
  };
}
