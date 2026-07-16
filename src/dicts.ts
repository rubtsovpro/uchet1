/**
 * Словари доп. характеристик и применимостей.
 * В опубликованном OData нет ChartOfCharacteristicTypes — значения приходят
 * текстом из HS Get/property_products / Get/products.array.
 */
import { createHash } from 'node:crypto';
import { all, db, get, run } from './db.js';

/** Стабильный UUID из строки (как v5, без внешних зависимостей). */
export function guidFromKey(key: string): string {
  const h = createHash('sha1').update(`wms-dict:${key}`).digest();
  const b = Buffer.from(h);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export type DictRebuildResult = {
  properties: number;
  propertyValues: number;
  marks: number;
  models: number;
  generations: number;
  brands: number;
  priceTypes: number;
};

export function rebuildDictionaries(): DictRebuildResult {
  run('DELETE FROM dict_property_values');
  run('DELETE FROM dict_properties');
  run('DELETE FROM dict_models');
  run('DELETE FROM dict_marks');
  run('DELETE FROM dict_generations');
  run('DELETE FROM dict_brands');
  // dict_price_types не чистим целиком — ручные типы/переименования сохраняются
  run('UPDATE dict_price_types SET products_count = 0');

  const insertProp = db.prepare(
    `INSERT OR IGNORE INTO dict_properties (id, name, products_count) VALUES (?, ?, ?)`
  );
  const insertVal = db.prepare(
    `INSERT OR IGNORE INTO dict_property_values (id, property_id, value, products_count) VALUES (?, ?, ?, ?)`
  );
  const insertMark = db.prepare(
    `INSERT OR IGNORE INTO dict_marks (id, name, products_count) VALUES (?, ?, ?)`
  );
  const insertModel = db.prepare(
    `INSERT OR IGNORE INTO dict_models (id, mark_id, name, only_model, products_count) VALUES (?, ?, ?, ?, ?)`
  );
  const insertGen = db.prepare(
    `INSERT OR IGNORE INTO dict_generations (id, name, products_count) VALUES (?, ?, ?)`
  );
  const insertBrand = db.prepare(
    `INSERT OR IGNORE INTO dict_brands (id, name, products_count) VALUES (?, ?, ?)`
  );

  run('BEGIN');
  try {
    const props = all<{ property: string; c: number }>(
      `SELECT property, COUNT(DISTINCT product_id) AS c
       FROM product_properties WHERE IFNULL(property,'') != ''
       GROUP BY property ORDER BY property`
    );
    for (const p of props) {
      const id = guidFromKey(`property:${p.property}`);
      insertProp.run(id, p.property, p.c);
      const vals = all<{ value: string; c: number }>(
        `SELECT value, COUNT(DISTINCT product_id) AS c
         FROM product_properties WHERE property = ?
         GROUP BY value ORDER BY value`,
        [p.property]
      );
      for (const v of vals) {
        const vid = guidFromKey(`propval:${p.property}|${v.value}`);
        insertVal.run(vid, id, v.value, v.c);
      }
    }

    const marks = all<{ mark: string; c: number }>(
      `SELECT mark, COUNT(DISTINCT product_id) AS c
       FROM product_applicability WHERE IFNULL(mark,'') != ''
       GROUP BY mark ORDER BY mark`
    );
    for (const m of marks) {
      const mid = guidFromKey(`mark:${m.mark}`);
      insertMark.run(mid, m.mark, m.c);
      const models = all<{ model: string; only_model: string; c: number }>(
        `SELECT model, only_model, COUNT(DISTINCT product_id) AS c
         FROM product_applicability
         WHERE mark = ? AND (IFNULL(model,'') != '' OR IFNULL(only_model,'') != '')
         GROUP BY model, only_model ORDER BY model, only_model`,
        [m.mark]
      );
      for (const mo of models) {
        const name = mo.model || mo.only_model;
        const id = guidFromKey(`model:${m.mark}|${mo.model}|${mo.only_model}`);
        insertModel.run(id, mid, name, mo.only_model || '', mo.c);
      }
    }

    const gens = all<{ generation: string; c: number }>(
      `SELECT generation, COUNT(DISTINCT product_id) AS c
       FROM product_applicability WHERE IFNULL(generation,'') != ''
       GROUP BY generation ORDER BY generation`
    );
    for (const g of gens) {
      insertGen.run(guidFromKey(`gen:${g.generation}`), g.generation, g.c);
    }

    const brands = all<{ brand: string; c: number }>(
      `SELECT brand, COUNT(*) AS c FROM products
       WHERE is_active = 1 AND IFNULL(brand,'') != ''
       GROUP BY brand ORDER BY brand`
    );
    for (const b of brands) {
      insertBrand.run(guidFromKey(`brand:${b.brand}`), b.brand, b.c);
    }

    const priceTypes = all<{ price_type: string; c: number }>(
      `SELECT price_type, COUNT(DISTINCT product_id) AS c
       FROM product_prices WHERE IFNULL(price_type,'') != ''
       GROUP BY price_type ORDER BY price_type`
    );
    const upsertPt = db.prepare(
      `INSERT INTO dict_price_types (id, name, products_count) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET products_count = excluded.products_count`
    );
    for (const pt of priceTypes) {
      upsertPt.run(guidFromKey(`pricetype:${pt.price_type}`), pt.price_type, pt.c);
    }

    run('COMMIT');
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }

  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    'dicts_rebuilt_at',
    new Date().toISOString(),
  ]);

  return {
    properties: get<{ c: number }>('SELECT COUNT(*) AS c FROM dict_properties')?.c ?? 0,
    propertyValues: get<{ c: number }>('SELECT COUNT(*) AS c FROM dict_property_values')?.c ?? 0,
    marks: get<{ c: number }>('SELECT COUNT(*) AS c FROM dict_marks')?.c ?? 0,
    models: get<{ c: number }>('SELECT COUNT(*) AS c FROM dict_models')?.c ?? 0,
    generations: get<{ c: number }>('SELECT COUNT(*) AS c FROM dict_generations')?.c ?? 0,
    brands: get<{ c: number }>('SELECT COUNT(*) AS c FROM dict_brands')?.c ?? 0,
    priceTypes: get<{ c: number }>('SELECT COUNT(*) AS c FROM dict_price_types')?.c ?? 0,
  };
}

export function dictMeta() {
  return {
    properties: get<{ c: number }>('SELECT COUNT(*) AS c FROM dict_properties')?.c ?? 0,
    propertyValues: get<{ c: number }>('SELECT COUNT(*) AS c FROM dict_property_values')?.c ?? 0,
    marks: get<{ c: number }>('SELECT COUNT(*) AS c FROM dict_marks')?.c ?? 0,
    models: get<{ c: number }>('SELECT COUNT(*) AS c FROM dict_models')?.c ?? 0,
    generations: get<{ c: number }>('SELECT COUNT(*) AS c FROM dict_generations')?.c ?? 0,
    brands: get<{ c: number }>('SELECT COUNT(*) AS c FROM dict_brands')?.c ?? 0,
    priceTypes: get<{ c: number }>('SELECT COUNT(*) AS c FROM dict_price_types')?.c ?? 0,
    lastRebuild:
      get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['dicts_rebuilt_at'])?.value ??
      null,
  };
}
