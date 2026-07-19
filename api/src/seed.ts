import { migrate, run, get } from './db.js';
import { newGuid } from './ids.js';

migrate();

const seeded = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['seeded']);
if (seeded?.value === '1') {
  console.log('Already seeded');
  process.exit(0);
}

const unitPcs = newGuid();
const unitSet = newGuid();
run('INSERT INTO units (id, name, short_name) VALUES (?, ?, ?)', [unitPcs, 'Штука', 'шт']);
run('INSERT INTO units (id, name, short_name) VALUES (?, ?, ?)', [unitSet, 'Комплект', 'компл']);

const catAir = newGuid();
const catSvc = newGuid();
run('INSERT INTO categories (id, name) VALUES (?, ?)', [catAir, 'Пневмоподвеска']);
run('INSERT INTO categories (id, name) VALUES (?, ?)', [catSvc, 'Услуги']);

const whMsk = newGuid();
const whKras = newGuid();
run('INSERT INTO warehouses (id, name, code) VALUES (?, ?, ?)', [whMsk, 'Склад Москва', 'MSK']);
run('INSERT INTO warehouses (id, name, code) VALUES (?, ?, ?)', [whKras, 'Склад Краснодар', 'KRD']);

const cp = newGuid();
run(
  'INSERT INTO counterparties (id, name, inn, kind) VALUES (?, ?, ?, ?)',
  [cp, 'ООО Поставщик Пример', '7700000000', 'supplier']
);

const products = [
  ['AIR-001', 'Пневмобаллон передний', catAir, unitPcs],
  ['AIR-002', 'Пневмобаллон задний', catAir, unitPcs],
  ['CMP-010', 'Компрессор 12V', catAir, unitPcs],
  ['KIT-100', 'Комплект пневмоподвески', catAir, unitSet],
  ['SVC-01', 'Диагностика подвески', catSvc, unitPcs],
] as const;

const productIds: string[] = [];
for (const [sku, name, cat, unit] of products) {
  const id = newGuid();
  productIds.push(id);
  run(
    'INSERT INTO products (id, sku, name, category_id, unit_id) VALUES (?, ?, ?, ?, ?)',
    [id, sku, name, cat, unit]
  );
}

run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['seeded', '1']);
run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['wh_msk', whMsk]);
run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['product0', productIds[0]]);

console.log('Seed OK');
console.log({ unitPcs, whMsk, whKras, products: productIds.length });
