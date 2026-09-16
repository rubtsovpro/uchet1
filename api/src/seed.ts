import { migrate, run, get } from './db.js';
import { newGuid } from './ids.js';

migrate();

const seeded = await get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['seeded']);
if (seeded?.value === '1') {
  console.log('Already seeded');
  process.exit(0);
}

const unitPcs = newGuid();
const unitSet = newGuid();
await run('INSERT INTO units (id, name, short_name) VALUES (?, ?, ?)', [unitPcs, 'Штука', 'шт']);
await run('INSERT INTO units (id, name, short_name) VALUES (?, ?, ?)', [unitSet, 'Комплект', 'компл']);

const catAir = newGuid();
const catSvc = newGuid();
await run('INSERT INTO categories (id, name) VALUES (?, ?)', [catAir, 'Пневмоподвеска']);
await run('INSERT INTO categories (id, name) VALUES (?, ?)', [catSvc, 'Услуги']);

const whMsk = newGuid();
const whKras = newGuid();
await run('INSERT INTO warehouses (id, name, code) VALUES (?, ?, ?)', [whMsk, 'Склад Москва', 'MSK']);
await run('INSERT INTO warehouses (id, name, code) VALUES (?, ?, ?)', [whKras, 'Склад Краснодар', 'KRD']);

const cp = newGuid();
await run(
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
  await run(
    'INSERT INTO products (id, sku, name, category_id, unit_id) VALUES (?, ?, ?, ?, ?)',
    [id, sku, name, cat, unit]
  );
}

await run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['seeded', '1']);
await run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['wh_msk', whMsk]);
await run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['product0', productIds[0]]);

console.log('Seed OK');
console.log({ unitPcs, whMsk, whKras, products: productIds.length });
