/**
 * Варианты строки поиска по номенклатуре.
 * SQLite LIKE/upper/lower — только ASCII; кириллица «нф» ≠ «НФ».
 */
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
