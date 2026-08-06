/**
 * Применимость «по партии / поставщику / экземпляру».
 *
 * Каталог (product_applicability) = максимум «куда товар вообще бывает».
 * Экземпляр (product_units.apps_json) = куда годится ИМЕННО эта штука.
 * Пустой apps_json у экземпляра = без доп. ограничения (каталог).
 */
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';

export type AppVehicle = {
  mark: string;
  model: string;
  generation: string;
  years: string;
};

export function parseAppsJson(raw: unknown): AppVehicle[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) arr = p;
    } catch {
      // строки «Audi,Bentley» → только марки
      arr = String(raw)
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((mark) => ({ mark, model: '', generation: '', years: '' }));
    }
  }
  const out: AppVehicle[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const mark = String(o.mark || '').trim();
    const model = String(o.model || o.only_model || '').trim();
    const generation = String(o.generation || '').trim();
    const years = String(o.years || '').trim();
    if (!mark && !model) continue;
    const key = [mark, model, generation, years].map((s) => s.toLowerCase()).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ mark, model, generation, years });
  }
  return out;
}

export function appsToJson(apps: AppVehicle[]): string {
  return JSON.stringify(parseAppsJson(apps));
}

/** Короткая метка для UI: AU · BE · PO */
export function appsShortLabel(apps: AppVehicle[]): string {
  const marks = [...new Set(apps.map((a) => a.mark).filter(Boolean))];
  if (!marks.length) return '';
  return marks
    .map((m) => {
      const letters = m.replace(/[^A-Za-zА-Яа-яЁё0-9]/g, '');
      return letters.slice(0, 3).toUpperCase() || m.slice(0, 3).toUpperCase();
    })
    .join('+');
}

export function appsHumanLabel(apps: AppVehicle[]): string {
  if (!apps.length) return 'как в каталоге (без ограничения партии)';
  return apps
    .map((a) => [a.mark, a.model, a.generation].filter(Boolean).join(' · '))
    .filter(Boolean)
    .join('; ');
}

function norm(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Совпадает ли применимость экземпляра с авто в заказе. */
export function unitAppsMatchVehicle(
  unitApps: AppVehicle[],
  vehicle: { mark?: string; model?: string; generation?: string }
): { ok: true } | { ok: false; reason: string } {
  const mark = norm(vehicle.mark || '');
  const model = norm(vehicle.model || '');
  const generation = norm(vehicle.generation || '');
  // В заказе не указано авто — не блокируем
  if (!mark && !model) return { ok: true };
  // У экземпляра нет урезания — каталог / любая применимость товара
  if (!unitApps.length) return { ok: true };

  const hit = unitApps.some((a) => {
    const am = norm(a.mark);
    const amo = norm(a.model);
    const ag = norm(a.generation);
    if (mark && am && am !== mark) return false;
    if (model && amo && amo !== model) return false;
    if (generation && ag && ag !== generation) return false;
    // если у партии указана только марка — модель заказа ок при совпадении марки
    if (mark && !am) return false;
    return true;
  });
  if (hit) return { ok: true };
  return {
    ok: false,
    reason: `Эта партия не подходит под ${[vehicle.mark, vehicle.model, vehicle.generation]
      .filter(Boolean)
      .join(' · ')}. Партия: ${appsHumanLabel(unitApps)}`,
  };
}

export function catalogAppsForProduct(productId: string): AppVehicle[] {
  const id = String(productId || '').trim();
  if (!id) return [];
  return all<{
    mark: string;
    model: string;
    only_model: string;
    generation: string;
    years: string;
  }>(
    `SELECT IFNULL(mark,'') AS mark, IFNULL(model,'') AS model,
            IFNULL(only_model,'') AS only_model, IFNULL(generation,'') AS generation,
            IFNULL(years,'') AS years
     FROM product_applicability WHERE product_id = ?`,
    [id]
  ).map((r) => ({
    mark: r.mark,
    model: r.model || r.only_model,
    generation: r.generation,
    years: r.years,
  }));
}

export function getSupplierProductApps(
  productId: string,
  supplierId: string
): AppVehicle[] {
  const pid = String(productId || '').trim();
  const sid = String(supplierId || '').trim();
  if (!pid || !sid) return [];
  const row = get<{ apps_json: string }>(
    `SELECT IFNULL(apps_json,'[]') AS apps_json
     FROM supplier_product_apps WHERE product_id = ? AND supplier_id = ?`,
    [pid, sid]
  );
  return parseAppsJson(row?.apps_json);
}

export function setSupplierProductApps(
  productId: string,
  supplierId: string,
  apps: AppVehicle[],
  comment?: string
): { product_id: string; supplier_id: string; apps: AppVehicle[] } {
  const pid = String(productId || '').trim();
  const sid = String(supplierId || '').trim();
  if (!pid || !sid) throw new Error('Нужны product_id и supplier_id');
  const normalized = parseAppsJson(apps);
  const existing = get<{ id: string }>(
    `SELECT id FROM supplier_product_apps WHERE product_id = ? AND supplier_id = ?`,
    [pid, sid]
  );
  if (existing) {
    run(
      `UPDATE supplier_product_apps
       SET apps_json = ?, comment = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [appsToJson(normalized), String(comment || '').trim(), existing.id]
    );
  } else {
    run(
      `INSERT INTO supplier_product_apps (id, product_id, supplier_id, apps_json, comment)
       VALUES (?, ?, ?, ?, ?)`,
      [newGuid(), pid, sid, appsToJson(normalized), String(comment || '').trim()]
    );
  }
  return { product_id: pid, supplier_id: sid, apps: normalized };
}

/**
 * Какая применимость попадёт на экземпляры при приходе:
 * строка документа → дефолт поставщика → пусто (каталог).
 */
export function resolveAppsForReceive(opts: {
  productId: string;
  supplierId?: string;
  lineApps?: AppVehicle[] | string | null;
}): AppVehicle[] {
  const fromLine = parseAppsJson(opts.lineApps);
  if (fromLine.length) return fromLine;
  const fromSupplier = getSupplierProductApps(
    opts.productId,
    String(opts.supplierId || '')
  );
  if (fromSupplier.length) return fromSupplier;
  return [];
}

export function getUnitApps(unitIdOrSerial: string): AppVehicle[] {
  const key = String(unitIdOrSerial || '').trim();
  if (!key) return [];
  const row = get<{ apps_json: string }>(
    `SELECT IFNULL(apps_json,'[]') AS apps_json FROM product_units
     WHERE id = ? OR lower(serial) = lower(?)
     LIMIT 1`,
    [key, key]
  );
  return parseAppsJson(row?.apps_json);
}

export function setUnitApps(
  serial: string,
  apps: AppVehicle[]
): { serial: string; apps: AppVehicle[]; apps_label: string; apps_short: string } {
  const code = String(serial || '').trim();
  if (!code) throw new Error('Укажите марку (serial)');
  const unit = get<{ id: string; serial: string }>(
    `SELECT id, serial FROM product_units WHERE lower(serial) = lower(?) LIMIT 1`,
    [code]
  );
  if (!unit) throw new Error(`Экземпляр «${code}» не найден`);
  const normalized = parseAppsJson(apps);
  run(`UPDATE product_units SET apps_json = ?, updated_at = datetime('now') WHERE id = ?`, [
    appsToJson(normalized),
    unit.id,
  ]);
  return {
    serial: unit.serial,
    apps: normalized,
    apps_label: appsHumanLabel(normalized),
    apps_short: appsShortLabel(normalized),
  };
}
