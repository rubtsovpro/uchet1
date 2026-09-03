import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { all } = require('../dist/db.js');

const cols = all(`PRAGMA table_info(products)`).map((c) => c.name);
console.log('product cols', cols.join(', '));

const sample = all(
  `SELECT sku, code, name, IFNULL(item_kind,'') kind, IFNULL(brand,'') brand
   FROM products WHERE IFNULL(item_kind,'product')!='service' LIMIT 5`
);
console.log('sample', sample);

// how fogel marked
const fogel = all(
  `SELECT COUNT(*) c FROM products WHERE sku LIKE '%@fogel%' OR sku LIKE '%@strela%' OR name LIKE '%Фогель%'`
);
console.log('fogelish', fogel);

const dept = all(
  `SELECT DISTINCT IFNULL(department,'') d, COUNT(*) c FROM products GROUP BY department ORDER BY c DESC LIMIT 20`
).catch?.(() => null);
try {
  console.log(
    'dept',
    all(
      `SELECT sql FROM sqlite_master WHERE name='products'`
    )
  );
} catch (e) {
  console.log(e.message);
}

// product_store_rests / warehouses
const wh = all(
  `SELECT IFNULL(w.code,'') code, IFNULL(w.name,'') name, COUNT(DISTINCT r.product_id) c
   FROM product_store_rests r
   JOIN warehouses w ON w.id = r.warehouse_id
   GROUP BY w.id ORDER BY c DESC LIMIT 20`
);
console.log('rests by wh', wh);

const pt = all(`SELECT name, products_count FROM dict_price_types ORDER BY name`);
console.log('price types count', pt.length);
