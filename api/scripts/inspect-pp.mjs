import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { all } = require('../dist/db.js');

console.log(
  'pp',
  all(`PRAGMA table_info(product_properties)`).map((c) => c.name)
);
console.log('sample', all(`SELECT * FROM product_properties LIMIT 3`));
console.log(
  'prices',
  all(`PRAGMA table_info(product_prices)`).map((c) => c.name)
);
console.log(
  'dept',
  all(
    `SELECT IFNULL(source_department,'') AS d, COUNT(*) AS c
     FROM products GROUP BY source_department ORDER BY c DESC`
  )
);
