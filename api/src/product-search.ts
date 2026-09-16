/**
 * Варианты строки поиска по номенклатуре.
 * SQLite LIKE/upper/lower — только ASCII; кириллица «нф» ≠ «НФ».
 */
import { all, get } from './db.js';

export function productSearchVariants(raw: string): string[] {
  const q = String(raw || '').trim();
  if (!q) return [];
  const out = new Set<string>();
  const add = (s: string) => {
    const t = String(s || '').trim();
    if (t) out.add(t);
  };
  add(q);
  add(q.toLocaleUpperCase('ru-RU'));
  add(q.toLocaleLowerCase('ru-RU'));

  // NF- / HФ- / нф- → канонический НФ-
  const nfCanon = q.replace(/^(?:[HhNnНн])(?:[FfФф])-/u, 'НФ-');
  add(nfCanon);
  add(nfCanon.toLocaleUpperCase('ru-RU'));
  add(nfCanon.toLocaleLowerCase('ru-RU'));

  // 00НФ- ↔ НФ-
  if (/^00НФ-/iu.test(nfCanon) || /^00нф-/u.test(nfCanon)) {
    add(nfCanon.replace(/^00/i, ''));
  } else if (/^НФ-/iu.test(nfCanon) || /^нф-/u.test(nfCanon)) {
    add('00' + nfCanon.replace(/^нф-/iu, 'НФ-').replace(/^Нф-/u, 'НФ-'));
    const up = nfCanon.toLocaleUpperCase('ru-RU');
    if (up.startsWith('НФ-')) add('00' + up);
  }

  return [...out];
}

/** Похоже на код 1С (НФ-… / 00-…) — не режем is_main, иначе клоны/архив мастера не находятся. */
export function looksLike1cProductCode(raw: string): boolean {
  const q = String(raw || '').trim();
  if (!q) return false;
  if (/^(?:00)?(?:НФ|нф|NF|nf|HФ|hф|Нф)-/u.test(q)) return true;
  if (/^00-\d{4,}/.test(q)) return true;
  return false;
}

/**
 * SQL-фрагмент OR по полям sku/code/… для всех Unicode-вариантов q.
 * @returns { sql, params } без ведущего AND
 */
export function sqlProductTextSearch(
  alias: string,
  q: string,
  opts?: { withAltCodes?: boolean; withLots?: boolean; withApplicability?: boolean; withCategory?: boolean }
): { sql: string; params: string[] } {
  const p = alias ? `${alias}.` : '';
  const variants = productSearchVariants(q);
  if (!variants.length) return { sql: '1=1', params: [] };

  const parts: string[] = [];
  const params: string[] = [];
  for (const v of variants) {
    const like = `%${v}%`;
    parts.push(
      `${p}name LIKE ? OR ${p}sku LIKE ? OR IFNULL(${p}code,'') LIKE ?
       OR IFNULL(${p}barcode,'') LIKE ? OR IFNULL(${p}array_sku,'') LIKE ?
       OR IFNULL(${p}warehouse_sku,'') LIKE ?
       OR IFNULL(${p}sheet_supplier,'') LIKE ?
       OR IFNULL(${p}brand,'') LIKE ?`
    );
    params.push(like, like, like, like, like, like, like, like);
    if (opts?.withCategory !== false) {
      // category join alias `c` — только если вызывающий сделал JOIN
    }
  }

  // Категория — один раз на все варианты
  if (opts?.withCategory !== false) {
    const catOr = variants.map(() => `IFNULL(c.name,'') LIKE ?`).join(' OR ');
    parts.push(`(${catOr})`);
    for (const v of variants) params.push(`%${v}%`);
  }

  if (opts?.withAltCodes !== false) {
    const altOr = variants.map(() => `value LIKE ?`).join(' OR ');
    parts.push(
      `${p}id IN (SELECT product_id FROM product_alt_codes WHERE ${altOr})`
    );
    for (const v of variants) params.push(`%${v}%`);
  }

  if (opts?.withApplicability) {
    const aOr = variants
      .map(
        () =>
          `a.mark LIKE ? OR a.model LIKE ? OR a.only_model LIKE ?`
      )
      .join(' OR ');
    parts.push(
      `${p}id IN (
        SELECT a.product_id FROM product_applicability a
        WHERE ${aOr}
        LIMIT 2000
      )`
    );
    for (const v of variants) params.push(`%${v}%`, `%${v}%`, `%${v}%`);
  }

  if (opts?.withLots) {
    const lOr = variants
      .map(
        () =>
          `l.fact_sku LIKE ? OR l.master_sku LIKE ? OR IFNULL(l.supplier,'') LIKE ?`
      )
      .join(' OR ');
    parts.push(
      `EXISTS (
        SELECT 1 FROM product_supplier_lots l
        WHERE (l.product_id = ${p}id OR l.master_sku = ${p}sku)
          AND (${lOr})
      )`
    );
    for (const v of variants) params.push(`%${v}%`, `%${v}%`, `%${v}%`);
  }

  return { sql: `(${parts.join(' OR ')})`, params };
}

function splitSkuList(raw: string): string[] {
  return String(raw || '')
    .split(/[,;\n|/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function skuEq(a: string, b: string): boolean {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

export type ProductionSkuResolve = {
  ok: boolean;
  input: string;
  /** master — ввели мастер; fact — ввели номер на складе (факт), подставили мастер */
  kind: 'master' | 'fact' | 'none';
  product_id: string;
  master_sku: string;
  name: string;
  fact_sku: string;
  is_active: number;
  message: string;
};

/**
 * Результат производства: нужен мастер.
 * Если ввели «номер на складе (факт)» — находим мастер и помечаем kind=fact.
 * Карточка с sku=факту и is_main=1 не побеждает, если тот же код есть как факт у другого мастера.
 */
export async function resolveSkuForProduction(raw: string): Promise<ProductionSkuResolve> {
  const input = String(raw || '').trim();
  if (input.length < 2) {
    return {
      ok: false,
      input,
      kind: 'none',
      product_id: '',
      master_sku: '',
      name: '',
      fact_sku: '',
      is_active: 0,
      message: '',
    };
  }

  type Row = {
    id: string;
    sku: string;
    name: string;
    is_main: number;
    is_active: number;
    warehouse_sku: string;
  };

  // 1) Лоты: fact_sku → master
  const lot = await get<{
    product_id: string;
    master_sku: string;
    fact_sku: string;
  }>(
    `SELECT IFNULL(product_id,'') AS product_id,
            IFNULL(master_sku,'') AS master_sku,
            IFNULL(fact_sku,'') AS fact_sku
     FROM product_supplier_lots
     WHERE lower(trim(IFNULL(fact_sku,''))) = lower(?)
     ORDER BY CASE WHEN IFNULL(product_id,'') != '' THEN 0 ELSE 1 END
     LIMIT 1`,
    [input]
  );

  let factMaster: Row | undefined;
  if (lot) {
    const pid = String(lot.product_id || '').trim();
    const msku = String(lot.master_sku || '').trim();
    if (pid) {
      factMaster = await get<Row>(
        `SELECT id, IFNULL(sku,'') AS sku, IFNULL(name,'') AS name,
                IFNULL(is_main,0) AS is_main, IFNULL(is_active,1) AS is_active,
                IFNULL(warehouse_sku,'') AS warehouse_sku
         FROM products WHERE id = ?`,
        [pid]
      );
    }
    if (!factMaster && msku) {
      factMaster = await get<Row>(
        `SELECT id, IFNULL(sku,'') AS sku, IFNULL(name,'') AS name,
                IFNULL(is_main,0) AS is_main, IFNULL(is_active,1) AS is_active,
                IFNULL(warehouse_sku,'') AS warehouse_sku
         FROM products
         WHERE lower(trim(IFNULL(sku,''))) = lower(?)
         ORDER BY IFNULL(is_main,0) DESC, IFNULL(is_active,1) DESC
         LIMIT 1`,
        [msku]
      );
    }
  }

  // 2) warehouse_sku токен (номер на складе) у мастер-карточек
  if (!factMaster) {
    const candidates = await all<Row>(
      `SELECT id, IFNULL(sku,'') AS sku, IFNULL(name,'') AS name,
              IFNULL(is_main,0) AS is_main, IFNULL(is_active,1) AS is_active,
              IFNULL(warehouse_sku,'') AS warehouse_sku
       FROM products
       WHERE IFNULL(warehouse_sku,'') != ''
         AND (
           lower(';' || replace(replace(IFNULL(warehouse_sku,''), ' ', ''), ',', ';') || ';')
           LIKE '%;' || lower(?) || ';%'
         )
       ORDER BY IFNULL(is_main,0) DESC, IFNULL(is_active,1) DESC, sku
       LIMIT 20`,
      [input.replace(/\s+/g, '')]
    );
    for (const row of candidates) {
      const parts = splitSkuList(row.warehouse_sku);
      if (parts.some((p) => skuEq(p, input))) {
        // Не считаем «фактом», если совпал сам sku карточки (мастер = себе)
        if (!skuEq(row.sku, input)) {
          factMaster = row;
          break;
        }
      }
    }
  }

  // 3) Прямой мастер по sku
  const asMaster = await get<Row>(
    `SELECT id, IFNULL(sku,'') AS sku, IFNULL(name,'') AS name,
            IFNULL(is_main,0) AS is_main, IFNULL(is_active,1) AS is_active,
            IFNULL(warehouse_sku,'') AS warehouse_sku
     FROM products
     WHERE lower(trim(IFNULL(sku,''))) = lower(?)
       AND IFNULL(is_main,0) = 1
     ORDER BY IFNULL(is_active,1) DESC
     LIMIT 1`,
    [input]
  );

  // Факт побеждает одноимённую карточку-«мастер» (как MRAE12657).
  if (factMaster && (!asMaster || !skuEq(factMaster.sku, input))) {
    const masterSku = String(factMaster.sku || '').trim();
    const name = String(factMaster.name || '').trim();
    return {
      ok: true,
      input,
      kind: 'fact',
      product_id: String(factMaster.id || ''),
      master_sku: masterSku,
      name,
      fact_sku: input,
      is_active: Number(factMaster.is_active) ? 1 : 0,
      message:
        'Это номер на складе (факт) «' +
        input +
        '» → мастер <b>' +
        masterSku +
        '</b>' +
        (name ? ' — ' + name : ''),
    };
  }

  if (asMaster) {
    const masterSku = String(asMaster.sku || '').trim();
    const name = String(asMaster.name || '').trim();
    return {
      ok: true,
      input,
      kind: 'master',
      product_id: String(asMaster.id || ''),
      master_sku: masterSku,
      name,
      fact_sku: '',
      is_active: Number(asMaster.is_active) ? 1 : 0,
      message:
        'Мастер: <b>' + masterSku + '</b>' + (name ? ' — ' + name : ''),
    };
  }

  return {
    ok: false,
    input,
    kind: 'none',
    product_id: '',
    master_sku: '',
    name: '',
    fact_sku: '',
    is_active: 0,
    message:
      'Нет мастера для «' +
      input +
      '» — укажите мастер-артикул (не только факт без карточки).',
  };
}

