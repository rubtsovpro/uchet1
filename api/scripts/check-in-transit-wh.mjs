import { all, get } from '../dist/db.js';

const companies = all(`SELECT id, code, name FROM companies WHERE is_active = 1`);
console.log('companies', companies);

const transit = all(
  `SELECT w.id, w.code, w.name, w.company_id, c.code AS co_code,
          (SELECT IFNULL(SUM(b.qty),0) FROM stock_balances b WHERE b.warehouse_id=w.id AND b.qty>0) AS qty
   FROM warehouses w
   LEFT JOIN companies c ON c.id = w.company_id
   WHERE w.code LIKE 'IN-TRANSIT%' OR w.name LIKE '%пути%'
   ORDER BY w.code`
);
console.log('transit warehouses', transit);
