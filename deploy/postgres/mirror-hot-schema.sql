-- Минимальная схема зеркала для dual-run (горячие таблицы).
-- Полная schema_from_sqlite.sql — следующим шагом.

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT,
  name TEXT,
  code TEXT,
  barcode TEXT,
  brand TEXT,
  is_active BIGINT,
  item_kind TEXT,
  unit TEXT,
  category_id TEXT
);

CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  code TEXT,
  name TEXT,
  is_active BIGINT
);

CREATE TABLE IF NOT EXISTS stock_balances (
  warehouse_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  qty DOUBLE PRECISION,
  PRIMARY KEY (warehouse_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_docs (
  id TEXT PRIMARY KEY,
  doc_type TEXT,
  number TEXT,
  doc_date TEXT,
  warehouse_id TEXT,
  warehouse_to_id TEXT,
  deal_id TEXT,
  posted BIGINT,
  comment TEXT,
  created_at TEXT,
  amount DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS stock_doc_lines (
  id TEXT PRIMARY KEY,
  doc_id TEXT,
  product_id TEXT,
  qty DOUBLE PRECISION,
  price DOUBLE PRECISION,
  warehouse_id TEXT,
  line_no BIGINT
);

CREATE TABLE IF NOT EXISTS crm_deals (
  id TEXT PRIMARY KEY,
  name TEXT,
  status_name TEXT,
  amo_channel TEXT,
  org_company_id TEXT,
  updated_at TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS crm_deal_items (
  id TEXT PRIMARY KEY,
  deal_id TEXT,
  product_guid TEXT,
  qty DOUBLE PRECISION,
  price DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS warehouse_tasks (
  id TEXT PRIMARY KEY,
  number TEXT,
  barcode TEXT,
  deal_id TEXT,
  status TEXT,
  channel TEXT,
  city TEXT,
  buyer_name TEXT,
  comment TEXT,
  stock_doc_id TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS warehouse_task_lines (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  product_id TEXT,
  qty DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS sync_deal_queue (
  deal_id TEXT PRIMARY KEY,
  status TEXT,
  tries BIGINT,
  last_error TEXT,
  created_at TEXT,
  updated_at TEXT,
  locked_at TEXT
);

CREATE TABLE IF NOT EXISTS production_jobs (
  id TEXT PRIMARY KEY,
  number TEXT,
  deal_id TEXT,
  status TEXT,
  kind TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS _mirror_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
