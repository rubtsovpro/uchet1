CREATE TABLE IF NOT EXISTS pick_sites (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  company_codes_json TEXT NOT NULL DEFAULT '[]',
  warehouse_codes_json TEXT NOT NULL DEFAULT '[]',
  branch_like_json TEXT NOT NULL DEFAULT '[]',
  sto_like_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS pick_site TEXT;

INSERT INTO pick_sites (
  id, label, sort_order, company_codes_json, warehouse_codes_json,
  branch_like_json, sto_like_json, is_active
) VALUES
  (
    'strela', 'Стрела', 1,
    '["STRELA","СТРЕЛА"]',
    '["MAIN","KRD","00-000002","STO","WAIT-PAY.6f66468a","IN-TRANSIT.6f66468a"]',
    '["%стрела%","%strela%","%фадеева%"]',
    '["%стрела%","%strela%","%фадеева%"]',
    1
  ),
  (
    'fogel', 'Фогель', 2,
    '["ФОГЕЛЬ","FOGEL"]',
    '["WAIT-PAY.54291ec9","IN-TRANSIT.54291ec9"]',
    '["%фогель%","%fogel%"]',
    '["%фогель%","%fogel%"]',
    1
  ),
  (
    'msk', 'МСК', 3,
    '["PNEVMO","ПНЕВМО"]',
    '["НФ-000032","00-000001"]',
    '["%москва%","%можай%","%msk%"]',
    '["%можай%","%моск%","%подвеск%"]',
    1
  )
ON CONFLICT (id) DO NOTHING;

UPDATE warehouses SET pick_site = 'strela'
 WHERE code IN ('MAIN','KRD','00-000002','STO','WAIT-PAY.6f66468a','IN-TRANSIT.6f66468a')
   AND (pick_site IS NULL OR btrim(pick_site) = '');

UPDATE warehouses SET pick_site = 'fogel'
 WHERE code IN ('WAIT-PAY.54291ec9','IN-TRANSIT.54291ec9')
   AND (pick_site IS NULL OR btrim(pick_site) = '');

UPDATE warehouses SET pick_site = 'msk'
 WHERE code IN ('НФ-000032','00-000001')
   AND (pick_site IS NULL OR btrim(pick_site) = '');

SELECT id, label, sort_order FROM pick_sites ORDER BY sort_order;
SELECT pick_site, count(*) AS n FROM warehouses
 WHERE coalesce(btrim(pick_site),'') <> ''
 GROUP BY 1 ORDER BY 1;
