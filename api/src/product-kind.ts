/**
 * Классификация номенклатуры: товар | услуга.
 * Источник истины после прогона — products.item_kind.
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';

/**
 * Явные признаки услуги в названии (без ложных «болт регулировки»).
 * Важно: не использовать `\b` с кириллицей — в JS `\b` только ASCII word chars,
 * поэтому «Диагностика» раньше не ловилась и попадала в расходные из 1С.
 */
export function looksLikeServiceName(name: string): boolean {
  const n = String(name || '').trim();
  if (!n) return false;
  if (/снять\s*[\/\\]\s*установить/i.test(n)) return true;
  if (/снятие\s*[\/\\]\s*установка/i.test(n)) return true;
  if (/проверить\s*[\/\\]\s*исправить/i.test(n)) return true;
  if (/услуг/i.test(n)) return true;
  if (/нормочас/i.test(n) || /н\s*\/\s*ч/i.test(n)) return true;
  // Диагностика / Ремонт / Осмотр — работы СТО (не «Ремонтный комплект»)
  if (/^(диагностик)/i.test(n)) return true;
  if (/^(ремонт|осмотр)(\s|$|[.,;:(/\-–])/i.test(n)) return true;
  if (/развал\s*[-–]?\s*схождени/i.test(n)) return true;
  if (/дозаправк/i.test(n) && /пневмо/i.test(n)) return true;
  if (/осушк/i.test(n) && /пневмо/i.test(n)) return true;
  if (
    /замен[аы]\s+(масл|жидкост|колод|фильтр)/i.test(n) &&
    !/(комплект|набор)/i.test(n)
  ) {
    return true;
  }
  // Работы СТО: «Замена подшипника», «… разобрать/собрать» — не складской товар.
  if (/^замен[аы]\s/i.test(n)) return true;
  if (/^заменить\s/i.test(n)) return true;
  if (/разобрать\s*[\/\\]\s*собрать/i.test(n)) return true;
  if (/^доставка$/i.test(n)) return true;
  if (/^залог$/i.test(n)) return true;
  return false;
}

export function looksLikeServiceUnit(unitShort: string): boolean {
  const u = String(unitShort || '')
    .toLowerCase()
    .replace(/\./g, '')
    .trim();
  return u === 'усл' || u === 'услуга' || u === 'услуг';
}

/** Единица «услуга» в справочнике (создаём при отсутствии). */
export async function ensureServiceUnitId(): Promise<string> {
  const hit = await get<{ id: string }>(
    `SELECT id FROM units
     WHERE lower(trim(short_name)) IN ('услуга', 'усл')
        OR lower(trim(name)) IN ('услуга', 'услуги')
     LIMIT 1`
  );
  if (hit?.id) return hit.id;
  const id = newGuid();
  await run(`INSERT INTO units (id, name, short_name) VALUES (?, 'Услуга', 'услуга')`, [id]);
  return id;
}

/** Всем услугам — единица «услуга» (не «шт»). */
export async function assignServiceUnits(): Promise<number> {
  const unitId = await ensureServiceUnitId();
  const before =
    (await get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM products
       WHERE IFNULL(item_kind,'product') = 'service' AND IFNULL(unit_id,'') != ?`,
      [unitId]
    ))?.c ?? 0;
  if (before > 0) {
    await run(
      `UPDATE products SET unit_id = ?
       WHERE IFNULL(item_kind,'product') = 'service' AND IFNULL(unit_id,'') != ?`,
      [unitId, unitId]
    );
  }
  return before;
}

export function looksLikeServiceCategoryName(name: string): boolean {
  const n = String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!n) return false;
  if (/услуг/.test(n)) return true;
  if (/виды\s*работ/.test(n)) return true;
  if (/ремонтн\w*\s*работ/.test(n)) return true;
  if (/работ[ыа]\s*сто/.test(n)) return true;
  if (/^работы(\s|$)/.test(n) && /сто|основн/.test(n)) return true;
  return false;
}

/** Убрать строки-услуги из расходных (после переклассификации номенклатуры). */
export async function purgeServiceLinesFromOutDocs(): Promise<{ deleted: number }> {
  const before =
    (await get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM stock_doc_lines
       WHERE doc_id IN (SELECT id FROM stock_docs WHERE doc_type = 'out')
         AND product_id IN (
           SELECT id FROM products WHERE IFNULL(item_kind, 'product') = 'service'
         )`
    ))?.c ?? 0;
  if (before > 0) {
    await run(
      `DELETE FROM stock_doc_lines
       WHERE doc_id IN (SELECT id FROM stock_docs WHERE doc_type = 'out')
         AND product_id IN (
           SELECT id FROM products WHERE IFNULL(item_kind, 'product') = 'service'
         )`
    );
  }
  return { deleted: before };
}

/** Категории-услуги и все их потомки. */
export async function serviceCategoryIds(): Promise<Set<string>> {
  const cats = await all<{ id: string; name: string; parent_id: string | null }>(
    `SELECT id, IFNULL(name,'') AS name, parent_id FROM categories`
  );
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const c of cats) {
    if (looksLikeServiceCategoryName(c.name)) roots.push(c.id);
    const p = String(c.parent_id || '').trim();
    if (!p) continue;
    const list = children.get(p) || [];
    list.push(c.id);
    children.set(p, list);
  }
  const out = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const ch of children.get(id) || []) stack.push(ch);
  }
  return out;
}

export async function classifyProductKind(input: {
  name?: string;
  unit_short?: string;
  category_id?: string;
  serviceCategoryIds?: Set<string>;
}): Promise<'service' | 'product'> {
  if (looksLikeServiceUnit(String(input.unit_short || ''))) return 'service';
  const svcCats = input.serviceCategoryIds || await serviceCategoryIds();
  const cid = String(input.category_id || '').trim();
  if (cid && svcCats.has(cid)) return 'service';
  if (looksLikeServiceName(String(input.name || ''))) return 'service';
  return 'product';
}

/**
 * Проставить item_kind по всей номенклатуре.
 * @returns счётчики
 */
export async function reclassifyAllProductKinds(): Promise<{
  total: number;
  service: number;
  product: number;
  changed: number;
}> {
  const svcCats = await serviceCategoryIds();
  const rows = await all<{
    id: string;
    name: string;
    category_id: string;
    item_kind: string;
    unit_short: string;
  }>(
    `SELECT p.id, IFNULL(p.name,'') AS name, IFNULL(p.category_id,'') AS category_id,
            IFNULL(p.item_kind,'product') AS item_kind,
            IFNULL(u.short_name,'') AS unit_short
     FROM products p
     LEFT JOIN units u ON u.id = p.unit_id`
  );
  let service = 0;
  let product = 0;
  let changed = 0;
  for (const r of rows) {
    const next = await classifyProductKind({
      name: r.name,
      unit_short: r.unit_short,
      category_id: r.category_id,
      serviceCategoryIds: svcCats,
    });
    if (next === 'service') service += 1;
    else product += 1;
    const prev = String(r.item_kind || 'product').toLowerCase() === 'service' ? 'service' : 'product';
    if (prev !== next) {
      await run(`UPDATE products SET item_kind = ? WHERE id = ?`, [next, r.id]);
      changed += 1;
    }
  }
  await assignServiceUnits();
  return { total: rows.length, service, product, changed };
}

/** Корни и потомки категорий-услуг (Услуги СТО и т.п.) — для SQL-фильтров остатков. */
export function sqlServiceCategoryTreeCte(): string {
  return `WITH RECURSIVE svc_cat(id) AS (
    SELECT id FROM categories
    WHERE lower(replace(trim(IFNULL(name,'')), '  ', ' ')) LIKE '%услуг%'
       OR lower(replace(trim(IFNULL(name,'')), '  ', ' ')) LIKE '%виды%работ%'
       OR lower(replace(trim(IFNULL(name,'')), '  ', ' ')) LIKE '%ремонтн%работ%'
       OR lower(replace(trim(IFNULL(name,'')), '  ', ' ')) LIKE '%работ%сто%'
       OR (
         lower(replace(trim(IFNULL(name,'')), '  ', ' ')) LIKE 'работы%'
         AND lower(replace(trim(IFNULL(name,'')), '  ', ' ')) LIKE '%сто%'
       )
    UNION ALL
    SELECT c.id FROM categories c
    INNER JOIN svc_cat s ON c.parent_id = s.id
  )`;
}

/**
 * SQL-фильтр: не услуга (item_kind + категории-услуги + типовые названия работ СТО).
 * Для списков остатков на складе — услуги только в виджете/заказе, не на складе.
 */
export function sqlExcludeServices(productAlias = 'p', unitAlias = 'u'): string {
  const p = productAlias;
  const u = unitAlias;
  return `(
    IFNULL(${p}.item_kind,'product') != 'service'
    AND NOT EXISTS (
      ${sqlServiceCategoryTreeCte()}
      SELECT 1 FROM svc_cat WHERE svc_cat.id = ${p}.category_id
    )
    AND NOT (
      ${p}.name LIKE '%снять/установить%' COLLATE NOCASE
      OR ${p}.name LIKE '%снять\\установить%' COLLATE NOCASE
      OR ${p}.name LIKE '%снятие/установка%' COLLATE NOCASE
      OR ${p}.name LIKE '%проверить/исправить%' COLLATE NOCASE
      OR ${p}.name LIKE '%Слить/Залить%' COLLATE NOCASE
      OR ${p}.name LIKE '%Оклейка%' COLLATE NOCASE
      OR ${p}.name LIKE '%услуг%' COLLATE NOCASE
      OR ${p}.name LIKE 'Диагностик%' COLLATE NOCASE
      OR ${p}.name LIKE 'Ремонт %' COLLATE NOCASE
      OR ${p}.name LIKE 'Осмотр%' COLLATE NOCASE
      OR ${p}.name LIKE 'Замена %' COLLATE NOCASE
      OR ${p}.name LIKE 'ЗАМЕНА %' COLLATE NOCASE
      OR ${p}.name LIKE 'Заменить %' COLLATE NOCASE
      OR ${p}.name LIKE '%разобрать/собрать%' COLLATE NOCASE
      OR ${p}.name LIKE '%разобрать\\собрать%' COLLATE NOCASE
      OR lower(trim(${p}.name)) IN ('доставка','залог')
      OR lower(trim(IFNULL(${u}.short_name,''))) IN ('усл','услуга','услуг')
    )
  )`;
}

/**
 * Не показывать чужой контур 1С на складе компании (общие GUID складов).
 * coAlias — companies, привязанная к warehouses.company_id.
 */
export function sqlExcludeCrossContourProducts(productAlias = 'p', companyAlias = 'co'): string {
  const p = productAlias;
  const co = companyAlias;
  return `NOT (
    (upper(IFNULL(${co}.code,'')) = 'PNEVMO'
      AND (
        IFNULL(${p}.source_department,'') = 'fogel_2025'
        OR IFNULL(${p}.sku,'') LIKE '%@fogel%' ESCAPE '\\'
        OR IFNULL(${p}.code,'') LIKE '%@fogel%' ESCAPE '\\'
      ))
    OR
    (upper(IFNULL(${co}.code,'')) IN ('ФОГЕЛЬ','FOGEL')
      AND (
        IFNULL(${p}.source_department,'') = 'pnevmopodveska_2025'
        OR IFNULL(${p}.sku,'') LIKE '%@podveska%' ESCAPE '\\'
        OR IFNULL(${p}.code,'') LIKE '%@podveska%' ESCAPE '\\'
      ))
    OR
    (upper(IFNULL(${co}.code,'')) = 'STRELA'
      AND (
        IFNULL(${p}.source_department,'') IN ('pnevmopodveska_2025','fogel_2025')
        OR IFNULL(${p}.sku,'') LIKE '%@podveska%' ESCAPE '\\'
        OR IFNULL(${p}.sku,'') LIKE '%@fogel%' ESCAPE '\\'
        OR IFNULL(${p}.code,'') LIKE '%@podveska%' ESCAPE '\\'
        OR IFNULL(${p}.code,'') LIKE '%@fogel%' ESCAPE '\\'
      ))
  )`;
}

/** Оставить активными только общие услуги se-* (23 шт.). Остальное — legacy из 1С. */
export async function deactivateLegacyServices(): Promise<number> {
  // Только реально активные — иначе каждый boot «меняет» сотни строк (WAL/CPU).
  await run(
    `UPDATE products SET is_active = 0
     WHERE IFNULL(item_kind,'product') = 'service'
       AND IFNULL(is_active,1) != 0
       AND lower(IFNULL(sku,'')) NOT LIKE 'se-%'
       AND lower(IFNULL(code,'')) NOT LIKE 'se-%'`
  );
  return 0;
}

/** Быстрая проверка по id (с учётом актуального item_kind и эвристик). */
export async function productIsService(productId: string): Promise<boolean> {
  const row = await get<{
    item_kind: string;
    name: string;
    category_id: string;
    unit_short: string;
  }>(
    `SELECT IFNULL(p.item_kind,'product') AS item_kind,
            IFNULL(p.name,'') AS name,
            IFNULL(p.category_id,'') AS category_id,
            IFNULL(u.short_name,'') AS unit_short
     FROM products p
     LEFT JOIN units u ON u.id = p.unit_id
     WHERE p.id = ?`,
    [productId]
  );
  if (!row) return false;
  if (String(row.item_kind).toLowerCase() === 'service') return true;
  return (
    await classifyProductKind({
      name: row.name,
      unit_short: row.unit_short,
      category_id: row.category_id,
    }) === 'service'
  );
}
