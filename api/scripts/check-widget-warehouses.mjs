import { all } from '../dist/db.js';

console.log(
  all(
    `SELECT code, name, IFNULL(show_in_widget, 0) AS show_in_widget, company_id
     FROM warehouses
     WHERE code IN ('НФ-000032', 'STO-RES-MSK', 'STO', 'COURIER')
     ORDER BY code`
  )
);

console.log(
  'widget columns',
  all(
    `SELECT w.code, w.name, IFNULL(w.show_in_widget, 0) AS show_in_widget
     FROM warehouses w
     WHERE w.is_active = 1 AND IFNULL(w.show_in_widget, 0) = 1
     ORDER BY w.name`
  )
);
