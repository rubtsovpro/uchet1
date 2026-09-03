import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite');
const msk = '00000000-0000-4000-8000-000000000001';
const meta = JSON.parse(
  db.prepare('SELECT value FROM meta WHERE key = ?').get('hs_podveska_store_ids')?.value || '[]'
);
const all = db
  .prepare(
    `SELECT id, code, name, IFNULL(is_active,1) AS is_active, company_id
     FROM warehouses ORDER BY is_active DESC, code`
  )
  .all();
const bal = db
  .prepare(
    `SELECT w.id, COUNT(DISTINCT b.product_id) AS skus, IFNULL(SUM(b.qty),0) AS qty
     FROM warehouses w LEFT JOIN stock_balances b ON b.warehouse_id=w.id GROUP BY w.id`
  )
  .all();
const balMap = Object.fromEntries(bal.map((r) => [r.id, r]));
const cos = Object.fromEntries(
  db.prepare('SELECT id,name FROM companies').all().map((c) => [c.id, c.name])
);

function uiHidden(code, name) {
  const c = String(code || '').trim().toUpperCase();
  const n = String(name || '').trim();
  if (
    [
      '1C-NONE',
      'KRD',
      'MAIN',
      'MSK',
      '00-000002',
      'STO-RES-STRELA',
      'IN-TRANSIT',
      'PROD-WIP',
      'НФ-000033',
      'НФ-000035',
      'НФ-000036',
      'НФ-000043',
    ].includes(c) ||
    c.startsWith('IN-TRANSIT.') ||
    c.startsWith('PROD-WIP.') ||
    c.startsWith('НФ-000037:')
  )
    return true;
  if (/основное\s*подразделение/i.test(n)) return true;
  if (/резерв\s*сто.*стрела/i.test(n)) return true;
  if (/сто\s*фадеева/i.test(n)) return true;
  if (/^в\s*пути/i.test(n)) return true;
  if (/не\s*найден/i.test(n)) return true;
  return false;
}

console.log('TOTAL', all.length, 'active', all.filter((w) => w.is_active).length);

console.log('\n=== ВИДНО в UI (контур Москва) ===');
for (const row of all.filter((x) => x.is_active && x.company_id === msk && !uiHidden(x.code, x.name))) {
  const b = balMap[row.id] || {};
  const hs = meta.includes(row.id) ? '1С·Подвеска' : '';
  console.log(`${row.code} | ${row.name} | skus ${b.skus || 0} | ${hs}`);
}

console.log('\n=== СКРЫТО UI, но есть в БД (контур Москва) ===');
for (const row of all.filter((x) => x.is_active && x.company_id === msk && uiHidden(x.code, x.name))) {
  const b = balMap[row.id] || {};
  console.log(`${row.code} | ${row.name} | skus ${b.skus || 0}`);
}

console.log('\n=== Другие контуры (не Москва), активные со stock ===');
for (const w of all.filter((x) => x.is_active && x.company_id !== msk)) {
  const b = balMap[w.id] || {};
  if ((b.skus || 0) > 0)
    console.log(`${cos[w.company_id]} | ${w.code} | ${w.name} | skus ${b.skus}`);
}

console.log('\n=== Архив, но остатки остались ===');
for (const w of all.filter((x) => !x.is_active)) {
  const b = balMap[w.id] || {};
  if ((b.skus || 0) > 0)
    console.log(`${w.code} | ${w.name} | ${cos[w.company_id]} | skus ${b.skus}`);
}
