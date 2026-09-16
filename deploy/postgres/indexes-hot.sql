-- Hot indexes for WMS Postgres SoT (search / resolve / pick / stock).
-- Safe to re-run. Prefer CONCURRENTLY on live.

CREATE INDEX CONCURRENTLY IF NOT EXISTS products_sku_lower_idx
  ON products (lower(trim(sku)));
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_code_lower_idx
  ON products (lower(trim(COALESCE(code, ''))));
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_barcode_idx
  ON products (barcode) WHERE COALESCE(barcode, '') <> '';
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_is_main_active_sku_idx
  ON products (is_main DESC, is_active DESC, sku);
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_warehouse_sku_idx
  ON products (warehouse_sku) WHERE warehouse_sku <> '';

CREATE INDEX CONCURRENTLY IF NOT EXISTS psl_fact_sku_lower_idx
  ON product_supplier_lots (lower(trim(fact_sku)));
CREATE INDEX CONCURRENTLY IF NOT EXISTS psl_master_sku_lower_idx
  ON product_supplier_lots (lower(trim(master_sku)));
CREATE INDEX CONCURRENTLY IF NOT EXISTS psl_product_id_idx
  ON product_supplier_lots (product_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS wh_tasks_status_updated_idx
  ON warehouse_tasks (status, updated_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS wh_tasks_deal_id_idx
  ON warehouse_tasks (deal_id) WHERE COALESCE(deal_id, '') <> '';

CREATE INDEX CONCURRENTLY IF NOT EXISTS stock_balances_wh_product_idx
  ON stock_balances (warehouse_id, product_id);
