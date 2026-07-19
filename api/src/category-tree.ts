/**
 * Дерево категорий номенклатуры (только база подвески — Фогель не грузим).
 * Одноимённые GUID часто = пустая папка + рабочая с товарами; склеиваем в одну строку.
 */
import { all } from './db.js';

export type CategoryFlat = {
  id: string;
  name: string;
  parent_id: string | null;
  products_own: number;
};

export type CategoryTreeNode = {
  id: string;
  name: string;
  parent_id: string | null;
  products_own: number;
  products_total: number;
  ids: string[];
  children: CategoryTreeNode[];
};

function normalizeParent(pid: string | null | undefined): string | null {
  const s = String(pid || '').trim();
  if (!s || s === '00000000-0000-0000-0000-000000000000') return null;
  return s;
}

export function nameKey(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

export function listCategoriesFlat(): CategoryFlat[] {
  return all<{
    id: string;
    name: string;
    parent_id: string | null;
    products_own: number;
  }>(
    `SELECT c.id, c.name, c.parent_id,
            COALESCE(pc.cnt, 0) AS products_own
     FROM categories c
     LEFT JOIN (
       SELECT category_id, COUNT(*) AS cnt
       FROM products
       WHERE category_id IS NOT NULL AND TRIM(category_id) != ''
       GROUP BY category_id
     ) pc ON pc.category_id = c.id
     ORDER BY c.name COLLATE NOCASE`
  ).map((r) => ({
    id: String(r.id),
    name: String(r.name || ''),
    parent_id: normalizeParent(r.parent_id),
    products_own: Number(r.products_own) || 0,
  }));
}

type MergedCat = {
  id: string;
  name: string;
  /** исходные parent_id до резолва в канон */
  parentVotes: Map<string, number>;
  products_own: number;
  ids: string[];
};

/** Склеить все категории с одним именем → один узел. */
function mergeByName(flat: CategoryFlat[]): {
  merged: MergedCat[];
  idToCanon: Map<string, string>;
} {
  const groups = new Map<string, MergedCat>();
  const idToCanon = new Map<string, string>();

  for (const row of flat) {
    const key = nameKey(row.name) || row.id;
    let g = groups.get(key);
    if (!g) {
      g = {
        id: row.id,
        name: row.name,
        parentVotes: new Map(),
        products_own: 0,
        ids: [],
      };
      groups.set(key, g);
    }
    g.ids.push(row.id);
    g.products_own += row.products_own;
    if (row.products_own > 0 && row.id !== g.id) {
      // канон — GUID с товарами (если текущий пустой)
      const curOwn = flat.find((f) => f.id === g!.id)?.products_own ?? 0;
      if (row.products_own > curOwn) g.id = row.id;
    }
    if (row.name && (!g.name || g.name.startsWith('<'))) g.name = row.name;
    if (row.parent_id) {
      g.parentVotes.set(row.parent_id, (g.parentVotes.get(row.parent_id) || 0) + 1 + row.products_own);
    }
  }

  // после выбора канон-id: map каждый исходный id → канон группы
  for (const g of groups.values()) {
    for (const id of g.ids) idToCanon.set(id, g.id);
  }

  // второй проход: канон = у кого максимум own в группе
  for (const g of groups.values()) {
    let bestId = g.ids[0];
    let bestOwn = -1;
    for (const id of g.ids) {
      const own = flat.find((f) => f.id === id)?.products_own ?? 0;
      if (own > bestOwn) {
        bestOwn = own;
        bestId = id;
      }
    }
    g.id = bestId;
    for (const id of g.ids) idToCanon.set(id, g.id);
  }

  return { merged: [...groups.values()], idToCanon };
}

function resolveParentId(
  g: MergedCat,
  idToCanon: Map<string, string>,
  canonIds: Set<string>
): string | null {
  // голос за parent_id: берём самый «весомый», мапим в канон
  let best: string | null = null;
  let bestW = -1;
  for (const [pid, w] of g.parentVotes) {
    const canon = idToCanon.get(pid) || pid;
    if (canon === g.id) continue; // цикл на себя
    if (w > bestW) {
      bestW = w;
      best = canon;
    }
  }
  if (best && canonIds.has(best)) return best;
  return null;
}

export function buildCategoryTree(): {
  roots: CategoryTreeNode[];
  total_categories: number;
  total_products_in_tree: number;
  uncategorized: number;
  raw_categories: number;
} {
  const flat = listCategoriesFlat();
  const { merged, idToCanon } = mergeByName(flat);
  const canonIds = new Set(merged.map((g) => g.id));

  const byId = new Map<string, CategoryTreeNode>();
  for (const g of merged) {
    const name = g.name || '';
    if (/^удалить\b/i.test(name) || name.startsWith('<')) continue;
    byId.set(g.id, {
      id: g.id,
      name: g.name,
      parent_id: resolveParentId(g, idToCanon, canonIds),
      products_own: g.products_own,
      products_total: g.products_own,
      ids: [...g.ids],
      children: [],
    });
  }

  const roots: CategoryTreeNode[] = [];
  for (const node of byId.values()) {
    const pid = node.parent_id;
    if (pid && byId.has(pid) && pid !== node.id) {
      byId.get(pid)!.children.push(node);
    } else {
      node.parent_id = null;
      roots.push(node);
    }
  }

  const sortRec = (nodes: CategoryTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);

  const rollup = (node: CategoryTreeNode): number => {
    let sum = node.products_own;
    for (const ch of node.children) sum += rollup(ch);
    node.products_total = sum;
    return sum;
  };
  for (const r of roots) rollup(r);

  // спрятать полностью пустые листья
  const prune = (nodes: CategoryTreeNode[]): CategoryTreeNode[] =>
    nodes
      .map((n) => ({ ...n, children: prune(n.children) }))
      .filter((n) => (n.products_total || 0) > 0 || n.children.length > 0);

  const prunedRoots = prune(roots);

  const countNodes = (nodes: CategoryTreeNode[]): number =>
    nodes.reduce((s, n) => s + 1 + countNodes(n.children), 0);

  const uncategorized =
    all<{ c: number }>(
      `SELECT COUNT(*) AS c FROM products
       WHERE category_id IS NULL OR TRIM(IFNULL(category_id,'')) = ''`
    )[0]?.c ?? 0;

  return {
    roots: prunedRoots,
    total_categories: countNodes(prunedRoots),
    raw_categories: flat.length,
    total_products_in_tree: prunedRoots.reduce((s, r) => s + r.products_total, 0),
    uncategorized: Number(uncategorized) || 0,
  };
}
