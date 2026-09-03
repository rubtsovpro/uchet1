import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite');

const rows = db
  .prepare(
    `SELECT id, code, name, IFNULL(is_active,1) AS is_active
     FROM warehouses
     WHERE code IN ('НФ-000032','MAIN','00-000001','НФ-000034','НФ-000037','STO','STO-RES-MSK')
        OR name LIKE '%Основн%'
        OR name LIKE '%ФИЛИАЛ%МОСКВ%'
        OR code LIKE 'STO-RES%'
     ORDER BY code`
  )
  .all();

const bal = db.prepare(
  `SELECT w.code, COUNT(DISTINCT b.product_id) AS skus, IFNULL(SUM(b.qty),0) AS qty
   FROM stock_balances b
   INNER JOIN warehouses w ON w.id = b.warehouse_id
   WHERE w.code IN ('НФ-000032','MAIN','00-000001','НФ-000034','STO','STO-RES-MSK')
   GROUP BY w.code`
);

console.log(JSON.stringify({ warehouses: rows, balances: bal.all() }, null, 2));
