import { run, all } from '../dist/db.js';

// Москва: включить колонки виджета WMS
run(
  `UPDATE warehouses SET show_in_widget = 1
   WHERE UPPER(IFNULL(code,'')) IN ('НФ-000032', 'STO-RES-MSK')`
);

console.log(
  'MSK widget (WMS)',
  all(
    `SELECT code, name, IFNULL(show_in_widget,0) AS show_in_widget
     FROM warehouses
     WHERE UPPER(IFNULL(code,'')) IN ('НФ-000032', 'STO-RES-MSK')`
  )
);
