/**
 * Автопредложение категории номенклатуры по названию.
 * Приоритет: тип изделия в начале названия (амортизатор / пневмобаллон / …),
 * затем точное совпадение с именем категории; «пневмо» само по себе не решает.
 */
import { all, get } from './db.js';

const STOP = new Set([
  'для',
  'и',
  'или',
  'на',
  'по',
  'из',
  'к',
  'от',
  'с',
  'в',
  'без',
  'шт',
  'комплект',
  'набор',
  'мм',
  'см',
  'л',
  'кг',
  'г',
  'the',
  'of',
  'and',
  'зад',
  'пер',
  'лев',
  'прав',
  'актив',
  'под',
  'пневмо', // слишком общее: есть и у баллонов, и у стоек, и у компрессоров
]);

/**
 * Жёсткие правила: если в названии есть тип — голосуем только за категории с этим корнем.
 * Порядок важен: более длинные / специфичные первыми.
 */
const TYPE_RULES: Array<{ re: RegExp; roots: string[]; label: string }> = [
  { re: /пневмобаллон/i, roots: ['пневмобаллон'], label: 'пневмобаллон' },
  { re: /пневмостойк/i, roots: ['пневмостойк'], label: 'пневмостойк' },
  {
    re: /амортизатор/i,
    roots: ['амортизатор'],
    label: 'амортизатор',
  },
  {
    re: /рулев\w*\s*рейк|рейк\w*\s*рулев/i,
    roots: ['рулев', 'рейк'],
    label: 'рулевая рейка',
  },
  {
    re: /компрессор/i,
    roots: ['компрессор'],
    label: 'компрессор',
  },
  { re: /сальник/i, roots: ['сальник'], label: 'сальник' },
  { re: /блок\w*\s*клапан|клапан/i, roots: ['клапан'], label: 'клапан' },
  { re: /кольц/i, roots: ['кольц'], label: 'кольцо' },
  { re: /осушител/i, roots: ['осушител'], label: 'осушитель' },
  { re: /ресивер/i, roots: ['ресивер'], label: 'ресивер' },
  { re: /датчик/i, roots: ['датчик'], label: 'датчик' },
  {
    re: /гарантийн\w*\s*талон|талон\w*\s*гарант/i,
    roots: ['гарантий', 'талон', 'полиграф'],
    label: 'гарантийный талон',
  },
];

export type CategorySuggestion = {
  product_id: string;
  category_id: string;
  category_name: string;
  score: number;
  reason: string;
};

function tokenize(text: string): string[] {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[()[\]{}«»"'`]/g, ' ')
    .replace(/[^a-zа-я0-9*./+\-]+/gi, ' ')
    .trim();
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/\s+/)) {
    const t = part.trim();
    if (t.length < 3) continue;
    if (/^\d+[.,]?\d*$/.test(t)) continue;
    if (STOP.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function stemHit(hay: string, needle: string): boolean {
  if (!hay || !needle) return false;
  if (hay === needle) return true;
  if (needle.length >= 5 && hay.startsWith(needle)) return true;
  if (hay.length >= 5 && needle.startsWith(hay)) return true;
  return false;
}

type CatRow = { id: string; name: string; nameLower: string; tokens: string[]; products: number };

let cache: { at: number; cats: CatRow[] } | null = null;

function loadCategories(): CatRow[] {
  const now = Date.now();
  if (cache && now - cache.at < 60_000) return cache.cats;
  const rows = all<{ id: string; name: string; products: number }>(
    `SELECT c.id, c.name, COALESCE(pc.cnt, 0) AS products
     FROM categories c
     LEFT JOIN (
       SELECT category_id, COUNT(*) AS cnt FROM products
       WHERE IFNULL(TRIM(category_id),'') != ''
       GROUP BY category_id
     ) pc ON pc.category_id = c.id
     WHERE IFNULL(TRIM(c.name),'') != ''
     ORDER BY products DESC, c.name`
  );
  const cats = rows.map((r) => {
    const name = String(r.name || '');
    return {
      id: String(r.id),
      name,
      nameLower: name.toLowerCase().replace(/ё/g, 'е'),
      tokens: tokenize(name),
      products: Number(r.products) || 0,
    };
  });
  cache = { at: now, cats };
  return cats;
}

function detectType(text: string): { roots: string[]; label: string } | null {
  for (const rule of TYPE_RULES) {
    if (rule.re.test(text)) return { roots: rule.roots, label: rule.label };
  }
  return null;
}

function scoreCategory(
  tokens: string[],
  nameLower: string,
  cat: CatRow,
  type: { roots: string[]; label: string } | null
): { score: number; hits: string[] } {
  // Если определён тип изделия — категория обязана содержать этот корень
  if (type) {
    const ok = type.roots.some(
      (root) => cat.nameLower.includes(root) || cat.tokens.some((ct) => stemHit(ct, root))
    );
    if (!ok) return { score: 0, hits: [] };
  }

  let score = 0;
  const hits: string[] = [];

  // Сильный бонус: имя категории начинается с того же слова, что и товар
  const headProduct = nameLower.split(/[^a-zа-я0-9]+/).find((w) => w.length >= 4);
  const headCat = cat.nameLower.split(/[^a-zа-я0-9]+/).find((w) => w.length >= 4);
  if (headProduct && headCat && stemHit(headProduct, headCat)) {
    score += 8;
    hits.push(headProduct);
  }

  if (type && type.roots.some((r) => cat.nameLower.includes(r))) {
    score += 10;
    hits.push(type.label);
  }

  for (const t of tokens) {
    if (cat.tokens.some((ct) => stemHit(ct, t))) {
      score += t.length >= 6 ? 2.5 : 1.5;
      hits.push(t);
    } else if (cat.nameLower.includes(t) && t.length >= 5) {
      score += 1.5;
      hits.push(t);
    }
  }

  if (score > 0 && cat.products > 0) {
    score += Math.min(1.5, Math.log10(cat.products + 1));
  }
  return { score, hits: [...new Set(hits)] };
}

/** Соседи только по «типовому» слову (амортизатор…), не по марке авто / пневмо. */
function neighborVote(
  typeLabel: string | null,
  strongTokens: string[],
  excludeId: string
): Map<string, { votes: number; name: string }> {
  const votes = new Map<string, { votes: number; name: string }>();
  const key = typeLabel || strongTokens.sort((a, b) => b.length - a.length)[0];
  if (!key || key.length < 4) return votes;
  const rows = all<{ category_id: string; category_name: string; c: number }>(
    `SELECT p.category_id AS category_id, IFNULL(c.name,'') AS category_name, COUNT(*) AS c
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE IFNULL(TRIM(p.category_id),'') != ''
       AND lower(p.name) LIKE ?
       AND p.id != ?
     GROUP BY p.category_id
     ORDER BY c DESC
     LIMIT 5`,
    [`%${key}%`, excludeId]
  );
  for (const r of rows) {
    const id = String(r.category_id || '');
    if (!id) continue;
    votes.set(id, {
      votes: Number(r.c) || 0,
      name: String(r.category_name || ''),
    });
  }
  return votes;
}

export function suggestCategoryForProduct(input: {
  id: string;
  name?: string;
  sku?: string;
}): CategorySuggestion | null {
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();
  const sku = String(input.sku || '').trim();
  if (!id && !name) return null;

  let productName = name;
  let productSku = sku;
  if (!productName) {
    const row = get<{ name: string; sku: string; category_id: string }>(
      `SELECT IFNULL(name,'') AS name, IFNULL(sku,'') AS sku, IFNULL(category_id,'') AS category_id
       FROM products WHERE id = ?`,
      [id]
    );
    if (!row) return null;
    if (String(row.category_id || '').trim()) return null;
    productName = row.name;
    productSku = productSku || row.sku;
  } else if (id) {
    const row = get<{ category_id: string }>(
      `SELECT IFNULL(category_id,'') AS category_id FROM products WHERE id = ?`,
      [id]
    );
    if (row && String(row.category_id || '').trim()) return null;
  }

  const text = `${productName} ${productSku}`;
  const nameLower = productName.toLowerCase().replace(/ё/g, 'е');
  const type = detectType(text);
  const tokens = tokenize(text);
  if (!tokens.length && !type) return null;

  const cats = loadCategories();
  let best: { cat: CatRow; score: number; reason: string } | null = null;

  for (const cat of cats) {
    const { score, hits } = scoreCategory(tokens, nameLower, cat, type);
    if (score <= 0) continue;
    const reason = hits.length ? `слова: ${hits.slice(0, 4).join(', ')}` : 'совпадение';
    if (!best || score > best.score) best = { cat, score, reason };
  }

  const neighbors = neighborVote(type?.label || null, tokens, id);
  for (const [cid, v] of neighbors) {
    const cat = cats.find((c) => c.id === cid);
    if (!cat) continue;
    // при известном типе — сосед тоже должен быть «своим»
    if (type) {
      const ok = type.roots.some((root) => cat.nameLower.includes(root));
      if (!ok) continue;
    }
    const score = 4 + Math.min(5, Math.log2(v.votes + 1));
    const reason = `как у ${v.votes} похожих`;
    if (!best || score > best.score) best = { cat, score, reason };
  }

  // С типом — достаточно умеренного порога; без типа — выше, чтобы не гадать
  const minScore = type ? 6 : 8;
  if (!best || best.score < minScore) return null;
  return {
    product_id: id,
    category_id: best.cat.id,
    category_name: best.cat.name,
    score: Math.round(best.score * 10) / 10,
    reason: best.reason,
  };
}

export function suggestCategoriesForProducts(ids: string[]): CategorySuggestion[] {
  const uniq = [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 100);
  if (!uniq.length) return [];
  const placeholders = uniq.map(() => '?').join(',');
  const rows = all<{ id: string; name: string; sku: string; category_id: string }>(
    `SELECT id, IFNULL(name,'') AS name, IFNULL(sku,'') AS sku, IFNULL(category_id,'') AS category_id
     FROM products WHERE id IN (${placeholders})`,
    uniq
  );
  const out: CategorySuggestion[] = [];
  for (const r of rows) {
    if (String(r.category_id || '').trim()) continue;
    const s = suggestCategoryForProduct({ id: r.id, name: r.name, sku: r.sku });
    if (s) out.push(s);
  }
  return out;
}
