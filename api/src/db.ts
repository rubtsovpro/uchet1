import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** SQLite по умолчанию в корне репо (data/), не в api/ — удобнее бэкапы и WMS_DATA_DIR на проде. */
const dataDir = process.env.WMS_DATA_DIR
  || path.resolve(__dirname, '..', '..', 'data');
const dbPath = path.join(dataDir, 'warehouse.sqlite');

fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 60000;
  PRAGMA wal_autocheckpoint = 200;
`);

export type Row = Record<string, unknown>;
type SqlParam = string | number | bigint | null | Uint8Array;

function isBusyError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(msg);
}

function withBusyRetry<T>(fn: () => T, attempts = 8): T {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (e) {
      last = e;
      if (!isBusyError(e) || i === attempts - 1) {
        throw e;
      }
      // 50ms, 100ms, 200ms… (синхронная пауза)
      const ms = Math.min(2000, 50 * 2 ** i);
      const until = Date.now() + ms;
      while (Date.now() < until) {
        /* busy wait — sync API, без async */
      }
    }
  }
  throw last;
}

export function all<T extends Row = Row>(sql: string, params: SqlParam[] = []): T[] {
  return withBusyRetry(() => db.prepare(sql).all(...params) as T[]);
}

export function get<T extends Row = Row>(sql: string, params: SqlParam[] = []): T | undefined {
  return withBusyRetry(() => db.prepare(sql).get(...params) as T | undefined);
}

export function run(sql: string, params: SqlParam[] = []): void {
  withBusyRetry(() => {
    db.prepare(sql).run(...params);
  });
}

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS units (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      short_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS warehouses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS counterparties (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      inn TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'supplier'
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      counterparty_id TEXT,
      code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'local',
      FOREIGN KEY (counterparty_id) REFERENCES counterparties(id)
    );
    CREATE INDEX IF NOT EXISTS idx_contracts_cp ON contracts(counterparty_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_code ON contracts(code);

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category_id TEXT,
      unit_id TEXT NOT NULL,
      barcode TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (unit_id) REFERENCES units(id)
    );

    CREATE TABLE IF NOT EXISTS product_applicability (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      mark TEXT DEFAULT '',
      model TEXT DEFAULT '',
      only_model TEXT DEFAULT '',
      generation TEXT DEFAULT '',
      years TEXT DEFAULT '',
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS product_properties (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      property TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS product_prices (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      price_type TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS product_related (
      product_id TEXT NOT NULL,
      related_id TEXT NOT NULL,
      PRIMARY KEY (product_id, related_id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS product_store_rests (
      product_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (product_id, warehouse_id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    );

    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      code TEXT DEFAULT '',
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_media (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'image',
      mime TEXT NOT NULL DEFAULT '',
      ext TEXT NOT NULL DEFAULT '',
      s3_key TEXT NOT NULL,
      url TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      orientation TEXT NOT NULL DEFAULT '',
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS dict_properties (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      products_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dict_property_values (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL,
      value TEXT NOT NULL,
      products_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (property_id) REFERENCES dict_properties(id)
    );

    CREATE TABLE IF NOT EXISTS dict_marks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      products_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dict_models (
      id TEXT PRIMARY KEY,
      mark_id TEXT NOT NULL,
      name TEXT NOT NULL,
      only_model TEXT DEFAULT '',
      products_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (mark_id) REFERENCES dict_marks(id)
    );

    CREATE TABLE IF NOT EXISTS dict_generations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      products_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dict_brands (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      products_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dict_price_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      products_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stock_docs (
      id TEXT PRIMARY KEY,
      doc_type TEXT NOT NULL,
      number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      warehouse_to_id TEXT,
      counterparty_id TEXT,
      comment TEXT DEFAULT '',
      posted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (warehouse_to_id) REFERENCES warehouses(id),
      FOREIGN KEY (counterparty_id) REFERENCES counterparties(id)
    );

    CREATE TABLE IF NOT EXISTS stock_doc_lines (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      qty REAL NOT NULL,
      FOREIGN KEY (doc_id) REFERENCES stock_docs(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS stock_balances (
      warehouse_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (warehouse_id, product_id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
    CREATE INDEX IF NOT EXISTS idx_products_active_name ON products(is_active, name);
    CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
    CREATE INDEX IF NOT EXISTS idx_counterparties_name ON counterparties(name);
    CREATE INDEX IF NOT EXISTS idx_counterparties_inn ON counterparties(inn);
    CREATE INDEX IF NOT EXISTS idx_balances_wh ON stock_balances(warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_app_product ON product_applicability(product_id);
    CREATE INDEX IF NOT EXISTS idx_app_mark ON product_applicability(mark);
    CREATE INDEX IF NOT EXISTS idx_app_model ON product_applicability(model);
    CREATE INDEX IF NOT EXISTS idx_prop_product ON product_properties(product_id);
    CREATE INDEX IF NOT EXISTS idx_prices_product ON product_prices(product_id);
    CREATE INDEX IF NOT EXISTS idx_prices_type ON product_prices(price_type);
    CREATE INDEX IF NOT EXISTS idx_media_product ON product_media(product_id);
    CREATE INDEX IF NOT EXISTS idx_media_sha ON product_media(product_id, sha256);
    CREATE INDEX IF NOT EXISTS idx_dict_pval_prop ON dict_property_values(property_id);
    CREATE INDEX IF NOT EXISTS idx_dict_models_mark ON dict_models(mark_id);

    CREATE TABLE IF NOT EXISTS feedback_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'idea',
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback_items(created_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_items(status);

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      amo_id TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      group_id TEXT NOT NULL DEFAULT '',
      one_c_guid TEXT NOT NULL DEFAULT '',
      one_c_code TEXT NOT NULL DEFAULT '',
      one_c_name TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      auth_login TEXT NOT NULL DEFAULT '',
      sto_location TEXT NOT NULL DEFAULT '',
      is_admin_amo INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'none',
      rights_json TEXT NOT NULL DEFAULT '{}',
      can_login INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      login TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL DEFAULT '',
      password_set_at TEXT NOT NULL DEFAULT '',
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_staff_amo ON staff(amo_id);
    CREATE INDEX IF NOT EXISTS idx_staff_1c ON staff(one_c_guid);
    CREATE INDEX IF NOT EXISTS idx_staff_name ON staff(name);
    CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_actor ON sessions(actor_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      actor_id TEXT NOT NULL DEFAULT '',
      actor_login TEXT NOT NULL DEFAULT '',
      actor_name TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      before_json TEXT NOT NULL DEFAULT '',
      after_json TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
  `);

  // Миграция для уже существующих БД
  const cols = all<{ name: string }>('PRAGMA table_info(products)').map((c) => c.name);
  const addCol = (name: string, ddl: string) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE products ADD COLUMN ${ddl}`);
  };
  addCol('brand', `brand TEXT DEFAULT ''`);
  addCol('code', `code TEXT DEFAULT ''`);
  addCol('array_sku', `array_sku TEXT DEFAULT ''`);
  addCol('notupload', `notupload INTEGER NOT NULL DEFAULT 0`);
  addCol('package_width_cm', `package_width_cm REAL`);
  addCol('package_height_cm', `package_height_cm REAL`);
  addCol('package_length_cm', `package_length_cm REAL`);
  addCol('package_weight_g', `package_weight_g REAL`);
  addCol('hs_category_id', `hs_category_id TEXT DEFAULT ''`);
  addCol('measurement_unit', `measurement_unit TEXT DEFAULT ''`);
  addCol('item_kind', `item_kind TEXT NOT NULL DEFAULT 'product'`);
  addCol('is_main', `is_main INTEGER NOT NULL DEFAULT 0`);
  addCol('warehouse_sku', `warehouse_sku TEXT NOT NULL DEFAULT ''`);
  /** База 1С: pnevmopodveska_2025 (Москва / Роман) или fogel_2025 (Краснодар / Михаил). */
  addCol('source_department', `source_department TEXT NOT NULL DEFAULT ''`);
  /** GUID номенклатуры в 1С (Amo); id строки = source_department::catalog_guid для изоляции баз. */
  addCol('catalog_guid', `catalog_guid TEXT NOT NULL DEFAULT ''`);

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at DESC)`);
  } catch {
    /* ignore */
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_products_is_main ON products(is_main)`);
  } catch {
    /* ignore */
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_products_source_department ON products(source_department)`);
  } catch {
    /* ignore */
  }
  try {
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_products_dept_catalog ON products(source_department, catalog_guid)`
    );
  } catch {
    /* ignore */
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS product_related (
      product_id TEXT NOT NULL,
      related_id TEXT NOT NULL,
      PRIMARY KEY (product_id, related_id)
    );
    CREATE TABLE IF NOT EXISTS product_store_rests (
      product_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (product_id, warehouse_id)
    );
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      code TEXT DEFAULT '',
      name TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rests_wh ON product_store_rests(warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_rests_product ON product_store_rests(product_id);
    CREATE TABLE IF NOT EXISTS feedback_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'idea',
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback_items(created_at);
    CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_items(status);

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      amo_id TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      group_id TEXT NOT NULL DEFAULT '',
      one_c_guid TEXT NOT NULL DEFAULT '',
      one_c_code TEXT NOT NULL DEFAULT '',
      one_c_name TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      auth_login TEXT NOT NULL DEFAULT '',
      sto_location TEXT NOT NULL DEFAULT '',
      is_admin_amo INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'none',
      rights_json TEXT NOT NULL DEFAULT '{}',
      can_login INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      login TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL DEFAULT '',
      password_set_at TEXT NOT NULL DEFAULT '',
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_staff_amo ON staff(amo_id);
    CREATE INDEX IF NOT EXISTS idx_staff_1c ON staff(one_c_guid);
    CREATE INDEX IF NOT EXISTS idx_staff_name ON staff(name);
    CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_actor ON sessions(actor_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      actor_id TEXT NOT NULL DEFAULT '',
      actor_login TEXT NOT NULL DEFAULT '',
      actor_name TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      before_json TEXT NOT NULL DEFAULT '',
      after_json TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
  `);

  // audit_log: доп. поля для KPI / истории (логин, UA, path, meta)
  const auditCols = all<{ name: string }>('PRAGMA table_info(audit_log)').map((c) => c.name);
  const addAuditCol = (name: string, ddl: string) => {
    if (!auditCols.includes(name)) db.exec(`ALTER TABLE audit_log ADD COLUMN ${ddl}`);
  };
  addAuditCol('actor_login', `actor_login TEXT NOT NULL DEFAULT ''`);
  addAuditCol('user_agent', `user_agent TEXT NOT NULL DEFAULT ''`);
  addAuditCol('path', `path TEXT NOT NULL DEFAULT ''`);
  addAuditCol('meta_json', `meta_json TEXT NOT NULL DEFAULT ''`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_day_actor ON audit_log(created_at, actor_id)`);

  // Колонки пароля у уже существующей staff (индексы — только после ALTER)
  const staffCols = all<{ name: string }>('PRAGMA table_info(staff)').map((c) => c.name);
  const addStaffCol = (name: string, ddl: string) => {
    if (!staffCols.includes(name)) db.exec(`ALTER TABLE staff ADD COLUMN ${ddl}`);
  };
  addStaffCol('login', `login TEXT NOT NULL DEFAULT ''`);
  addStaffCol('password_hash', `password_hash TEXT NOT NULL DEFAULT ''`);
  addStaffCol('password_set_at', `password_set_at TEXT NOT NULL DEFAULT ''`);
  addStaffCol('telegram_chat_id', `telegram_chat_id TEXT NOT NULL DEFAULT ''`);
  addStaffCol('pin_hash', `pin_hash TEXT NOT NULL DEFAULT ''`);
  addStaffCol('pin_set_at', `pin_set_at TEXT NOT NULL DEFAULT ''`);
  addStaffCol('phone', `phone TEXT NOT NULL DEFAULT ''`);
  addStaffCol('avatar_url', `avatar_url TEXT NOT NULL DEFAULT ''`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_staff_login ON staff(login)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_staff_email ON staff(email)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_2fa_challenges (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_2fa_exp ON auth_2fa_challenges(expires_at);
    CREATE INDEX IF NOT EXISTS idx_2fa_actor ON auth_2fa_challenges(actor_id);
  `);

  const docCols = all<{ name: string }>('PRAGMA table_info(stock_docs)').map((c) => c.name);
  if (!docCols.includes('amount')) db.exec(`ALTER TABLE stock_docs ADD COLUMN amount REAL NOT NULL DEFAULT 0`);
  if (!docCols.includes('source')) db.exec(`ALTER TABLE stock_docs ADD COLUMN source TEXT NOT NULL DEFAULT 'local'`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_docs_source ON stock_docs(source)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_docs_type_date ON stock_docs(doc_type, doc_date)`);

  const lineCols = all<{ name: string }>('PRAGMA table_info(stock_doc_lines)').map((c) => c.name);
  if (!lineCols.includes('price')) db.exec(`ALTER TABLE stock_doc_lines ADD COLUMN price REAL NOT NULL DEFAULT 0`);
  if (!lineCols.includes('amount')) db.exec(`ALTER TABLE stock_doc_lines ADD COLUMN amount REAL NOT NULL DEFAULT 0`);
  if (!lineCols.includes('line_no')) db.exec(`ALTER TABLE stock_doc_lines ADD COLUMN line_no INTEGER NOT NULL DEFAULT 0`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_doc_lines_product ON stock_doc_lines(product_id)`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_docs_type_product_date ON stock_docs(doc_type, doc_date)`
  );

  const mediaCols = all<{ name: string }>('PRAGMA table_info(product_media)').map((c) => c.name);
  const addMediaCol = (name: string, ddl: string) => {
    if (!mediaCols.includes(name)) db.exec(`ALTER TABLE product_media ADD COLUMN ${ddl}`);
  };
  addMediaCol('width', `width INTEGER NOT NULL DEFAULT 0`);
  addMediaCol('height', `height INTEGER NOT NULL DEFAULT 0`);
  addMediaCol('orientation', `orientation TEXT NOT NULL DEFAULT ''`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_media_orient ON product_media(orientation)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_pipelines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      is_archive INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS crm_pipeline_statuses (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (pipeline_id) REFERENCES crm_pipelines(id)
    );
    CREATE TABLE IF NOT EXISTS crm_deals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      pipeline_id TEXT NOT NULL DEFAULT '',
      pipeline_name TEXT NOT NULL DEFAULT '',
      status_id TEXT NOT NULL DEFAULT '',
      status_name TEXT NOT NULL DEFAULT '',
      responsible_user_id TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      queued_to_1c INTEGER NOT NULL DEFAULT 0,
      queue_status TEXT NOT NULL DEFAULT '',
      queued_by TEXT NOT NULL DEFAULT '',
      queued_at TEXT,
      amo_url TEXT NOT NULL DEFAULT '',
      print_url TEXT NOT NULL DEFAULT '',
      items_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS crm_deal_items (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL,
      product_guid TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      qty REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      line_no INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (deal_id) REFERENCES crm_deals(id)
    );
    CREATE INDEX IF NOT EXISTS idx_crm_deals_pipe ON crm_deals(pipeline_id, status_id);
    CREATE INDEX IF NOT EXISTS idx_crm_deals_queued ON crm_deals(queued_to_1c, queued_at);
    CREATE INDEX IF NOT EXISTS idx_crm_deal_items_deal ON crm_deal_items(deal_id);
    CREATE INDEX IF NOT EXISTS idx_crm_statuses_pipe ON crm_pipeline_statuses(pipeline_id);
  `);

  // Позиция сделки: склад / поставщик / партия (приход) + применимость
  const dealItemCols = all<{ name: string }>('PRAGMA table_info(crm_deal_items)').map((c) => c.name);
  const addDealItemCol = (name: string, ddl: string) => {
    if (dealItemCols.length && !dealItemCols.includes(name)) {
      db.exec(`ALTER TABLE crm_deal_items ADD COLUMN ${ddl}`);
    }
  };
  addDealItemCol('warehouse_id', `warehouse_id TEXT NOT NULL DEFAULT ''`);
  addDealItemCol('supplier_id', `supplier_id TEXT NOT NULL DEFAULT ''`);
  addDealItemCol('in_doc_id', `in_doc_id TEXT NOT NULL DEFAULT ''`);
  addDealItemCol('mark', `mark TEXT NOT NULL DEFAULT ''`);
  addDealItemCol('model', `model TEXT NOT NULL DEFAULT ''`);
  addDealItemCol('generation', `generation TEXT NOT NULL DEFAULT ''`);
  addDealItemCol('name_1c', `name_1c TEXT NOT NULL DEFAULT ''`);
  addDealItemCol('applicability_key', `applicability_key TEXT NOT NULL DEFAULT ''`);
  addDealItemCol('serials_json', `serials_json TEXT NOT NULL DEFAULT '[]'`);

  // Amo-синк часто писал price, но amount=0 — сумма в UI была «0 ₽»
  try {
    db.exec(`
      UPDATE crm_deal_items
      SET amount = ROUND(IFNULL(qty,0) * IFNULL(price,0), 2)
      WHERE IFNULL(amount,0) = 0
        AND IFNULL(price,0) != 0
        AND IFNULL(qty,0) != 0
    `);
  } catch {
    /* ignore */
  }

  // покупатель / юрлицо на сделке
  const dealCols = all<{ name: string }>('PRAGMA table_info(crm_deals)').map((c) => c.name);
  const dealExtra: Array<[string, string]> = [
    ['company_id', "TEXT NOT NULL DEFAULT ''"],
    ['company_name', "TEXT NOT NULL DEFAULT ''"],
    /** Главный контакт сделки в Amo — якорь реквизитов покупателя */
    ['amo_contact_id', "TEXT NOT NULL DEFAULT ''"],
    /** Все контакты сделки (после склейки в Amo их может быть несколько), через запятую */
    ['amo_contact_ids', "TEXT NOT NULL DEFAULT ''"],
    ['buyer_name', "TEXT NOT NULL DEFAULT ''"],
    ['buyer_inn', "TEXT NOT NULL DEFAULT ''"],
    ['buyer_phone', "TEXT NOT NULL DEFAULT ''"],
    ['buyer_kind', "TEXT NOT NULL DEFAULT 'person'"],
    ['buyer_email', "TEXT NOT NULL DEFAULT ''"],
    ['buyer_address', "TEXT NOT NULL DEFAULT ''"],
    ['buyer_passport', "TEXT NOT NULL DEFAULT ''"],
    ['buyer_kpp', "TEXT NOT NULL DEFAULT ''"],
    ['buyer_ogrn', "TEXT NOT NULL DEFAULT ''"],
    ['buyer_director', "TEXT NOT NULL DEFAULT ''"],
    ['buyer_bank', "TEXT NOT NULL DEFAULT ''"],
    ['buyer_bik', "TEXT NOT NULL DEFAULT ''"],
    ['buyer_rs', "TEXT NOT NULL DEFAULT ''"],
    ['buyer_ks', "TEXT NOT NULL DEFAULT ''"],
    ['is_legal_entity', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_partner', 'INTEGER NOT NULL DEFAULT 0'],
    ['client_role', "TEXT NOT NULL DEFAULT 'client'"],
    ['ship_channel', "TEXT NOT NULL DEFAULT ''"],
    ['amo_channel', "TEXT NOT NULL DEFAULT ''"],
    ['amo_shipment', "TEXT NOT NULL DEFAULT ''"],
    ['amo_payment_type', "TEXT NOT NULL DEFAULT ''"],
    ['amo_pay_method', "TEXT NOT NULL DEFAULT ''"],
    ['amo_sto', "TEXT NOT NULL DEFAULT ''"],
    /** Amo CF 855167 «Филиал» */
    ['amo_branch', "TEXT NOT NULL DEFAULT ''"],
    /** Amo CF 816977 «Жалоба клиента» → ЗН п. 3.3 */
    ['amo_client_complaint', "TEXT NOT NULL DEFAULT ''"],
    /** 1 = работы СТО (заказ-наряд); 0 = продажа (счёт/УПД) */
    ['is_sto', 'INTEGER NOT NULL DEFAULT 0'],
    /** 1 = менеджер задал вручную — синк из Amo не перезаписывает */
    ['is_sto_manual', 'INTEGER NOT NULL DEFAULT 0'],
    /** Автомобиль для заказ-наряда / СТС */
    ['car_plate', "TEXT NOT NULL DEFAULT ''"],
    ['car_vin', "TEXT NOT NULL DEFAULT ''"],
    ['car_year', "TEXT NOT NULL DEFAULT ''"],
    ['car_mileage', "TEXT NOT NULL DEFAULT ''"],
    ['car_brand', "TEXT NOT NULL DEFAULT ''"],
    ['car_model', "TEXT NOT NULL DEFAULT ''"],
    ['car_color', "TEXT NOT NULL DEFAULT ''"],
    ['car_category', "TEXT NOT NULL DEFAULT ''"],
    ['car_pts', "TEXT NOT NULL DEFAULT ''"],
    ['car_owner', "TEXT NOT NULL DEFAULT ''"],
    ['car_owner_street', "TEXT NOT NULL DEFAULT ''"],
    ['car_owner_house', "TEXT NOT NULL DEFAULT ''"],
    ['car_owner_flat', "TEXT NOT NULL DEFAULT ''"],
    ['car_sts_date', "TEXT NOT NULL DEFAULT ''"],
    ['car_sts_number', "TEXT NOT NULL DEFAULT ''"],
    /** Кто пригнал авто на СТО (представитель) + основание полномочий */
    ['car_brought_by', "TEXT NOT NULL DEFAULT ''"],
    ['car_authority_basis', "TEXT NOT NULL DEFAULT ''"],
    ['car_authority_details', "TEXT NOT NULL DEFAULT ''"],
    /** Приёмка: топливо / ключи / комплектность / повреждения → ЗН */
    ['car_fuel_level', "TEXT NOT NULL DEFAULT ''"],
    ['car_keys_count', "TEXT NOT NULL DEFAULT ''"],
    ['car_docs_left', "TEXT NOT NULL DEFAULT ''"],
    ['car_docs_note', "TEXT NOT NULL DEFAULT ''"],
    ['car_damage_notes', "TEXT NOT NULL DEFAULT ''"],
    ['car_completeness', "TEXT NOT NULL DEFAULT ''"],
    ['car_completeness_other', "TEXT NOT NULL DEFAULT ''"],
    /** НДС для счёта / УПД / СФ по юр/ИП: '' | no | yes + ставка % */
    ['buyer_vat', "TEXT NOT NULL DEFAULT ''"],
    ['buyer_vat_rate', 'REAL NOT NULL DEFAULT 0'],
    /** Контур (companies.id) по маппингу воронки Amo */
    ['org_company_id', "TEXT NOT NULL DEFAULT ''"],
  ];
  if (dealCols.length) {
    for (const [col, def] of dealExtra) {
      if (!dealCols.includes(col)) {
        db.exec(`ALTER TABLE crm_deals ADD COLUMN ${col} ${def}`);
      }
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_deals_org_co ON crm_deals(org_company_id)`);
  }

  {
    const migrated = get<{ value: string }>(
      `SELECT value FROM meta WHERE key = ?`,
      ['client_role_migrated_v1']
    );
    if (!migrated) {
      try {
        db.exec(`
          UPDATE crm_deals
          SET client_role = 'partner_delay'
          WHERE (IFNULL(is_partner,0) = 1 OR lower(IFNULL(buyer_kind,'')) IN ('partner','partner_delay'))
            AND lower(IFNULL(amo_pay_method,'')) LIKE '%отсроч%';
          UPDATE crm_deals
          SET client_role = 'partner'
          WHERE (IFNULL(is_partner,0) = 1 OR lower(IFNULL(buyer_kind,'')) IN ('partner','partner_delay'))
            AND IFNULL(client_role,'client') = 'client';
          UPDATE crm_deals
          SET buyer_kind = CASE
            WHEN length(replace(IFNULL(buyer_inn,''), ' ', '')) = 10 THEN 'legal'
            WHEN length(replace(IFNULL(buyer_inn,''), ' ', '')) = 12 THEN 'ip'
            WHEN IFNULL(is_legal_entity,0) = 1 THEN 'legal'
            ELSE 'person'
          END
          WHERE lower(IFNULL(buyer_kind,'')) IN ('partner','partner_delay');
          UPDATE crm_deals
          SET is_legal_entity = 0
          WHERE client_role IN ('partner','partner_delay') AND lower(IFNULL(buyer_kind,'')) = 'person';
          UPDATE crm_deals
          SET is_legal_entity = 1
          WHERE client_role IN ('partner','partner_delay') AND lower(IFNULL(buyer_kind,'')) IN ('legal','ip');
        `);
        run(
          `INSERT INTO meta (key, value) VALUES ('client_role_migrated_v1', datetime('now'))`
        );
      } catch {
        /* ignore */
      }
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS deal_payments (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'sbp_qr',
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'created',
      qrc_id TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '',
      image_png_base64 TEXT NOT NULL DEFAULT '',
      account TEXT NOT NULL DEFAULT '',
      purpose TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (deal_id) REFERENCES crm_deals(id)
    );
    CREATE INDEX IF NOT EXISTS idx_deal_payments_deal ON deal_payments(deal_id, created_at);

    CREATE TABLE IF NOT EXISTS fiscal_receipts (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      external_id TEXT NOT NULL DEFAULT '',
      atol_uuid TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'prepared',
      amount REAL NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_deal ON fiscal_receipts(deal_id, created_at);
  `);

  {
    const fiscalCols = all<{ name: string }>('PRAGMA table_info(fiscal_receipts)').map((c) => c.name);
    if (fiscalCols.length && !fiscalCols.includes('parent_receipt_id')) {
      db.exec(`ALTER TABLE fiscal_receipts ADD COLUMN parent_receipt_id TEXT NOT NULL DEFAULT ''`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_docs (
      id TEXT PRIMARY KEY,
      doc_type TEXT NOT NULL,
      number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      deal_id TEXT NOT NULL DEFAULT '',
      counterparty_name TEXT NOT NULL DEFAULT '',
      counterparty_inn TEXT NOT NULL DEFAULT '',
      buyer_address TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      vat_rate REAL NOT NULL DEFAULT 20,
      vat_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      comment TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sales_doc_lines (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      line_no INTEGER NOT NULL DEFAULT 0,
      product_guid TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      qty REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      vat_amount REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (doc_id) REFERENCES sales_docs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sales_docs_type ON sales_docs(doc_type, doc_date);
    CREATE INDEX IF NOT EXISTS idx_sales_docs_deal ON sales_docs(deal_id);
    CREATE INDEX IF NOT EXISTS idx_sales_docs_number ON sales_docs(number);
    CREATE INDEX IF NOT EXISTS idx_sales_lines_doc ON sales_doc_lines(doc_id);
  `);

  const salesLineCols = all<{ name: string }>('PRAGMA table_info(sales_doc_lines)').map((c) => c.name);
  if (salesLineCols.length && !salesLineCols.includes('line_kind')) {
    db.exec(`ALTER TABLE sales_doc_lines ADD COLUMN line_kind TEXT NOT NULL DEFAULT 'goods'`);
  }

  // реквизиты ИП Безматерных (как в бланках 1С), если ещё не заданы
  const orgRow = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['org_profile']);
  if (!orgRow?.value) {
    run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      'org_profile',
      JSON.stringify({
        name: 'Индивидуальный предприниматель Безматерных Роман Павлович',
        short_name: 'Безматерных Р.П.',
        inn: '231215603728',
        kpp: '',
        ogrnip: '322237500133521',
        address: '350000, Краснодарский край, Селезнева, д. 84, кв. 73',
        phone: '',
        bank: 'ООО "Банк Точка" г. Москва',
        bik: '044525104',
        rs: '40802810109500030587',
        ks: '30101810745374525104',
        director: 'Безматерных Р.П.',
        accountant: '',
        master_title: 'Мастер-приемщик Пневмоподвеска №1',
        vat_rate: 5,
      }),
    ]);
  }

  // ——— Маркировка / Честный знак (Этапы 4–5) ———
  const prodColsMark = all<{ name: string }>('PRAGMA table_info(products)').map((c) => c.name);
  if (prodColsMark.length && !prodColsMark.includes('gtin')) {
    db.exec(`ALTER TABLE products ADD COLUMN gtin TEXT NOT NULL DEFAULT ''`);
  }
  if (prodColsMark.length && !prodColsMark.includes('requires_marking')) {
    db.exec(`ALTER TABLE products ADD COLUMN requires_marking INTEGER NOT NULL DEFAULT 0`);
  }
  if (prodColsMark.length && !prodColsMark.includes('serial_tracked')) {
    db.exec(`ALTER TABLE products ADD COLUMN serial_tracked INTEGER NOT NULL DEFAULT 0`);
  }

  const lineColsSerial = all<{ name: string }>('PRAGMA table_info(stock_doc_lines)').map(
    (c) => c.name
  );
  if (lineColsSerial.length && !lineColsSerial.includes('serials_json')) {
    db.exec(`ALTER TABLE stock_doc_lines ADD COLUMN serials_json TEXT NOT NULL DEFAULT '[]'`);
  }
  if (lineColsSerial.length && !lineColsSerial.includes('warehouse_id')) {
    db.exec(`ALTER TABLE stock_doc_lines ADD COLUMN warehouse_id TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_doc_lines_wh ON stock_doc_lines(warehouse_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS product_units (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      serial TEXT NOT NULL,
      warehouse_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'in_stock',
      in_doc_id TEXT NOT NULL DEFAULT '',
      in_line_id TEXT NOT NULL DEFAULT '',
      out_doc_id TEXT NOT NULL DEFAULT '',
      out_line_id TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_units_serial
      ON product_units(product_id, serial COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_product_units_wh ON product_units(warehouse_id, status);
    CREATE INDEX IF NOT EXISTS idx_product_units_status ON product_units(status);
    CREATE INDEX IF NOT EXISTS idx_product_units_in_doc ON product_units(in_doc_id);
    CREATE INDEX IF NOT EXISTS idx_product_units_out_doc ON product_units(out_doc_id);
  `);

  // Применимость партии на экземпляре: [] = как в каталоге; иначе урезание (Audi/Bentley…)
  const unitCols = all<{ name: string }>('PRAGMA table_info(product_units)').map((c) => c.name);
  if (unitCols.length && !unitCols.includes('apps_json')) {
    db.exec(`ALTER TABLE product_units ADD COLUMN apps_json TEXT NOT NULL DEFAULT '[]'`);
  }
  // На строке прихода — шаблон применимости для создаваемых марок
  const lineColsApps = all<{ name: string }>('PRAGMA table_info(stock_doc_lines)').map((c) => c.name);
  if (lineColsApps.length && !lineColsApps.includes('apps_json')) {
    db.exec(`ALTER TABLE stock_doc_lines ADD COLUMN apps_json TEXT NOT NULL DEFAULT '[]'`);
  }
  // Дефолт применимости «товар × поставщик»
  db.exec(`
    CREATE TABLE IF NOT EXISTS supplier_product_apps (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      apps_json TEXT NOT NULL DEFAULT '[]',
      comment TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(product_id, supplier_id)
    );
    CREATE INDEX IF NOT EXISTS idx_spa_product ON supplier_product_apps(product_id);
    CREATE INDEX IF NOT EXISTS idx_spa_supplier ON supplier_product_apps(supplier_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS product_lots (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      lot_number TEXT NOT NULL,
      factory TEXT NOT NULL DEFAULT '',
      production_date TEXT NOT NULL DEFAULT '',
      arrived_at TEXT NOT NULL DEFAULT '',
      warehouse_id TEXT NOT NULL DEFAULT '',
      gtin TEXT NOT NULL DEFAULT '',
      qty_planned REAL NOT NULL DEFAULT 0,
      qty_received REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE INDEX IF NOT EXISTS idx_lots_product ON product_lots(product_id);
    CREATE INDEX IF NOT EXISTS idx_lots_number ON product_lots(lot_number);
    CREATE INDEX IF NOT EXISTS idx_lots_status ON product_lots(status);

    CREATE TABLE IF NOT EXISTS datamatrix_aggregates (
      id TEXT PRIMARY KEY,
      parent_code TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      codes_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS datamatrix_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      product_id TEXT NOT NULL,
      lot_id TEXT NOT NULL DEFAULT '',
      gtin TEXT NOT NULL DEFAULT '',
      serial TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'received',
      aggregate_id TEXT NOT NULL DEFAULT '',
      warehouse_id TEXT NOT NULL DEFAULT '',
      deal_id TEXT NOT NULL DEFAULT '',
      stock_doc_id TEXT NOT NULL DEFAULT '',
      scanned_at TEXT NOT NULL DEFAULT '',
      withdrawn_at TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE INDEX IF NOT EXISTS idx_dm_product ON datamatrix_codes(product_id);
    CREATE INDEX IF NOT EXISTS idx_dm_lot ON datamatrix_codes(lot_id);
    CREATE INDEX IF NOT EXISTS idx_dm_status ON datamatrix_codes(status);
    CREATE INDEX IF NOT EXISTS idx_dm_deal ON datamatrix_codes(deal_id);
    CREATE INDEX IF NOT EXISTS idx_dm_agg ON datamatrix_codes(aggregate_id);

    CREATE TABLE IF NOT EXISTS marking_events (
      id TEXT PRIMARY KEY,
      code_id TEXT,
      lot_id TEXT,
      event TEXT NOT NULL,
      actor_id TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mark_ev_code ON marking_events(code_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_mark_ev_lot ON marking_events(lot_id, created_at);

    CREATE TABLE IF NOT EXISTS crpt_outbox (
      id TEXT PRIMARY KEY,
      code_id TEXT NOT NULL DEFAULT '',
      operation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload_json TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_crpt_outbox_status ON crpt_outbox(status, created_at);
  `);

  // ——— Э1: задания склада ———
  const dealColsLock = all<{ name: string }>('PRAGMA table_info(crm_deals)').map((c) => c.name);
  if (dealColsLock.length && !dealColsLock.includes('amount_locked')) {
    db.exec(`ALTER TABLE crm_deals ADD COLUMN amount_locked INTEGER NOT NULL DEFAULT 0`);
  }
  if (dealColsLock.length && !dealColsLock.includes('amount_locked_at')) {
    db.exec(`ALTER TABLE crm_deals ADD COLUMN amount_locked_at TEXT NOT NULL DEFAULT ''`);
  }
  if (dealColsLock.length && !dealColsLock.includes('payment_status')) {
    db.exec(`ALTER TABLE crm_deals ADD COLUMN payment_status TEXT NOT NULL DEFAULT ''`);
  }
  if (dealColsLock.length && !dealColsLock.includes('paid')) {
    db.exec(`ALTER TABLE crm_deals ADD COLUMN paid INTEGER NOT NULL DEFAULT 0`);
  }
  if (dealColsLock.length && !dealColsLock.includes('money_refunded_at')) {
    db.exec(`ALTER TABLE crm_deals ADD COLUMN money_refunded_at TEXT NOT NULL DEFAULT ''`);
  }
  if (dealColsLock.length && !dealColsLock.includes('money_refunded_by')) {
    db.exec(`ALTER TABLE crm_deals ADD COLUMN money_refunded_by TEXT NOT NULL DEFAULT ''`);
  }
  if (dealColsLock.length && !dealColsLock.includes('money_refunded_by_name')) {
    db.exec(`ALTER TABLE crm_deals ADD COLUMN money_refunded_by_name TEXT NOT NULL DEFAULT ''`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS warehouse_tasks (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      barcode TEXT NOT NULL DEFAULT '',
      deal_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      channel TEXT NOT NULL DEFAULT 'cdek_prepaid',
      city TEXT NOT NULL DEFAULT '',
      buyer_name TEXT NOT NULL DEFAULT '',
      amount_locked REAL NOT NULL DEFAULT 0,
      payment_required INTEGER NOT NULL DEFAULT 1,
      track_number TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      picked_at TEXT NOT NULL DEFAULT '',
      packed_at TEXT NOT NULL DEFAULT '',
      ready_at TEXT NOT NULL DEFAULT '',
      handed_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wt_status ON warehouse_tasks(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_wt_deal ON warehouse_tasks(deal_id);
    CREATE INDEX IF NOT EXISTS idx_wt_barcode ON warehouse_tasks(barcode);

    CREATE TABLE IF NOT EXISTS warehouse_task_lines (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      line_no INTEGER NOT NULL DEFAULT 1,
      product_id TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      qty REAL NOT NULL DEFAULT 1,
      weight_g REAL NOT NULL DEFAULT 0,
      dims_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (task_id) REFERENCES warehouse_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_wtl_task ON warehouse_task_lines(task_id);

    CREATE TABLE IF NOT EXISTS warehouse_task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      event TEXT NOT NULL,
      actor_id TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wte_task ON warehouse_task_events(task_id, created_at);

    CREATE TABLE IF NOT EXISTS income_mirror (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL DEFAULT '',
      deal_id TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      buyer_name TEXT NOT NULL DEFAULT '',
      track_number TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_income_mirror_created ON income_mirror(created_at);
    CREATE INDEX IF NOT EXISTS idx_income_mirror_deal ON income_mirror(deal_id);
    CREATE INDEX IF NOT EXISTS idx_income_mirror_task ON income_mirror(task_id);

    CREATE TABLE IF NOT EXISTS user_presence (
      actor_id TEXT PRIMARY KEY,
      actor_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      section TEXT NOT NULL DEFAULT '',
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      client_ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      os TEXT NOT NULL DEFAULT '',
      browser TEXT NOT NULL DEFAULT '',
      device TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_presence_seen ON user_presence(last_seen);

    /** Быстрые закладки titlebar ★ — на пользователя (как в браузере). */
    CREATE TABLE IF NOT EXISTS user_bookmarks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '',
      tab_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_bookmarks_user_path ON user_bookmarks(user_id, path);
    CREATE INDEX IF NOT EXISTS idx_user_bookmarks_user ON user_bookmarks(user_id, created_at);


    CREATE TABLE IF NOT EXISTS ip_geo_cache (
      ip TEXT PRIMARY KEY,
      region TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS staff_departments (
      name TEXT PRIMARY KEY,
      rights_json TEXT NOT NULL DEFAULT '{}',
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('dm', 'group')),
      title TEXT NOT NULL DEFAULT '',
      dm_key TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_dm_key ON chats(dm_key) WHERE dm_key != '';
    CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at);

    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_read_at TEXT NOT NULL DEFAULT '',
      muted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (chat_id, actor_id),
      FOREIGN KEY (chat_id) REFERENCES chats(id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_members_actor ON chat_members(actor_id);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_id TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      reply_to_id TEXT NOT NULL DEFAULT '',
      forwarded_from_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (chat_id) REFERENCES chats(id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

    CREATE TABLE IF NOT EXISTS chat_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      s3_key TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'file',
      FOREIGN KEY (message_id) REFERENCES chat_messages(id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_attachments_msg ON chat_attachments(message_id);
  `);

  const chatMsgCols = all<{ name: string }>('PRAGMA table_info(chat_messages)').map((c) => c.name);
  if (chatMsgCols.length) {
    for (const [name, ddl] of [
      ['ref_type', "ref_type TEXT NOT NULL DEFAULT ''"],
      ['ref_id', "ref_id TEXT NOT NULL DEFAULT ''"],
      ['ref_label', "ref_label TEXT NOT NULL DEFAULT ''"],
      ['ref_href', "ref_href TEXT NOT NULL DEFAULT ''"],
    ] as const) {
      if (!chatMsgCols.includes(name)) db.exec(`ALTER TABLE chat_messages ADD COLUMN ${ddl}`);
    }
  }

  const presenceCols = all<{ name: string }>('PRAGMA table_info(user_presence)').map((c) => c.name);
  for (const [name, ddl] of [
    ['client_ip', "client_ip TEXT NOT NULL DEFAULT ''"],
    ['user_agent', "user_agent TEXT NOT NULL DEFAULT ''"],
    ['os', "os TEXT NOT NULL DEFAULT ''"],
    ['browser', "browser TEXT NOT NULL DEFAULT ''"],
    ['device', "device TEXT NOT NULL DEFAULT ''"],
    ['region', "region TEXT NOT NULL DEFAULT ''"],
    ['country', "country TEXT NOT NULL DEFAULT ''"],
  ] as const) {
    if (!presenceCols.includes(name)) db.exec(`ALTER TABLE user_presence ADD COLUMN ${ddl}`);
  }

  // КПД склада: метки этапов created → picked → packed → ready → handed
  const wtCols = all<{ name: string }>('PRAGMA table_info(warehouse_tasks)').map((c) => c.name);
  if (wtCols.length) {
    for (const [name, ddl] of [
      ['picked_at', "picked_at TEXT NOT NULL DEFAULT ''"],
      ['packed_at', "packed_at TEXT NOT NULL DEFAULT ''"],
      ['ready_at', "ready_at TEXT NOT NULL DEFAULT ''"],
      ['handed_at', "handed_at TEXT NOT NULL DEFAULT ''"],
      ['block_reason', "block_reason TEXT NOT NULL DEFAULT ''"],
      ['stock_doc_id', "stock_doc_id TEXT NOT NULL DEFAULT ''"],
    ] as const) {
      if (!wtCols.includes(name)) db.exec(`ALTER TABLE warehouse_tasks ADD COLUMN ${ddl}`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_wt_stock_doc ON warehouse_tasks(stock_doc_id)`);
  }

  // Валюты (справочник + курсы ЦБ; документы пока RUB)
  db.exec(`
    CREATE TABLE IF NOT EXISTS currencies (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      symbol TEXT NOT NULL DEFAULT '',
      numeric_code TEXT NOT NULL DEFAULT '',
      alt_code TEXT NOT NULL DEFAULT '',
      rate_mode TEXT NOT NULL DEFAULT 'manual',
      linked_code TEXT NOT NULL DEFAULT '',
      linked_markup_pct REAL NOT NULL DEFAULT 0,
      formula TEXT NOT NULL DEFAULT '',
      spell_unit_1 TEXT NOT NULL DEFAULT '',
      spell_unit_2 TEXT NOT NULL DEFAULT '',
      spell_unit_5 TEXT NOT NULL DEFAULT '',
      spell_frac_1 TEXT NOT NULL DEFAULT '',
      spell_frac_2 TEXT NOT NULL DEFAULT '',
      spell_frac_5 TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 100,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS currency_rates (
      id TEXT PRIMARY KEY,
      base_code TEXT NOT NULL DEFAULT 'RUB',
      quote_code TEXT NOT NULL,
      rate REAL NOT NULL DEFAULT 0,
      rate_date TEXT NOT NULL DEFAULT (date('now')),
      source TEXT NOT NULL DEFAULT 'manual',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_currency_rates_pair ON currency_rates(base_code, quote_code, rate_date);
  `);
  const curCols = all<{ name: string }>('PRAGMA table_info(currencies)').map((c) => c.name);
  for (const [name, ddl] of [
    ['alt_code', "alt_code TEXT NOT NULL DEFAULT ''"],
    ['rate_mode', "rate_mode TEXT NOT NULL DEFAULT 'manual'"],
    ['linked_code', "linked_code TEXT NOT NULL DEFAULT ''"],
    ['linked_markup_pct', 'linked_markup_pct REAL NOT NULL DEFAULT 0'],
    ['formula', "formula TEXT NOT NULL DEFAULT ''"],
    ['spell_unit_1', "spell_unit_1 TEXT NOT NULL DEFAULT ''"],
    ['spell_unit_2', "spell_unit_2 TEXT NOT NULL DEFAULT ''"],
    ['spell_unit_5', "spell_unit_5 TEXT NOT NULL DEFAULT ''"],
    ['spell_frac_1', "spell_frac_1 TEXT NOT NULL DEFAULT ''"],
    ['spell_frac_2', "spell_frac_2 TEXT NOT NULL DEFAULT ''"],
    ['spell_frac_5', "spell_frac_5 TEXT NOT NULL DEFAULT ''"],
  ] as const) {
    if (!curCols.includes(name)) db.exec(`ALTER TABLE currencies ADD COLUMN ${ddl}`);
  }

  const curCount = get<{ c: number }>('SELECT COUNT(*) AS c FROM currencies')?.c ?? 0;
  if (!curCount) {
    run(
      `INSERT INTO currencies (
        code, name, symbol, numeric_code, alt_code, rate_mode,
        spell_unit_1, spell_unit_2, spell_unit_5,
        spell_frac_1, spell_frac_2, spell_frac_5,
        is_active, sort_order
      ) VALUES
       ('RUB', 'Российский рубль', '₽', '643', '', 'manual',
        'рубль', 'рубля', 'рублей', 'копейка', 'копейки', 'копеек', 1, 1),
       ('USD', 'Доллар США', '$', '840', '', 'internet',
        'доллар', 'доллара', 'долларов', 'цент', 'цента', 'центов', 1, 2),
       ('CNY', 'Китайский юань', '¥', '156', 'RMB', 'internet',
        'юань', 'юаня', 'юаней', 'фынь', 'фыня', 'фыней', 1, 3)`
    );
  } else {
    // Ensure seed trio + modes for existing DBs
    const ensure = (
      code: string,
      name: string,
      symbol: string,
      numeric: string,
      alt: string,
      mode: string,
      sort: number,
      spell: [string, string, string, string, string, string]
    ) => {
      const row = get<{ code: string }>('SELECT code FROM currencies WHERE code = ?', [code]);
      if (!row) {
        run(
          `INSERT INTO currencies (
            code, name, symbol, numeric_code, alt_code, rate_mode,
            spell_unit_1, spell_unit_2, spell_unit_5,
            spell_frac_1, spell_frac_2, spell_frac_5,
            is_active, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [code, name, symbol, numeric, alt, mode, ...spell, sort]
        );
      } else if (code === 'CNY') {
        run(
          `UPDATE currencies SET alt_code = CASE WHEN alt_code = '' THEN 'RMB' ELSE alt_code END,
            rate_mode = CASE WHEN rate_mode = 'manual' OR rate_mode = '' THEN 'internet' ELSE rate_mode END,
            updated_at = datetime('now')
           WHERE code = 'CNY'`
        );
      } else if (code === 'USD') {
        run(
          `UPDATE currencies SET
            rate_mode = CASE WHEN rate_mode = 'manual' OR rate_mode = '' THEN 'internet' ELSE rate_mode END,
            updated_at = datetime('now')
           WHERE code = 'USD'`
        );
      }
    };
    ensure('RUB', 'Российский рубль', '₽', '643', '', 'manual', 1, [
      'рубль',
      'рубля',
      'рублей',
      'копейка',
      'копейки',
      'копеек',
    ]);
    ensure('USD', 'Доллар США', '$', '840', '', 'internet', 2, [
      'доллар',
      'доллара',
      'долларов',
      'цент',
      'цента',
      'центов',
    ]);
    ensure('CNY', 'Китайский юань', '¥', '156', 'RMB', 'internet', 3, [
      'юань',
      'юаня',
      'юаней',
      'фынь',
      'фыня',
      'фыней',
    ]);
  }

  // ——— Паритет меню УНФ: ГТД / мин.остаток / касса / ПП / должности / графики / производство / CRM ———
  const lineColsParity = all<{ name: string }>('PRAGMA table_info(stock_doc_lines)').map((c) => c.name);
  if (!lineColsParity.includes('gtd_key')) {
    db.exec(`ALTER TABLE stock_doc_lines ADD COLUMN gtd_key TEXT NOT NULL DEFAULT ''`);
  }
  if (!lineColsParity.includes('gtd_code')) {
    db.exec(`ALTER TABLE stock_doc_lines ADD COLUMN gtd_code TEXT NOT NULL DEFAULT ''`);
  }
  if (!lineColsParity.includes('country_key')) {
    db.exec(`ALTER TABLE stock_doc_lines ADD COLUMN country_key TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_doc_lines_gtd ON stock_doc_lines(gtd_key)`);

  const cpCols = all<{ name: string }>('PRAGMA table_info(counterparties)').map((c) => c.name);
  if (!cpCols.includes('lead_time_days')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN lead_time_days INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cpCols.includes('is_active')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
  }
  if (!cpCols.includes('email')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN email TEXT NOT NULL DEFAULT ''`);
  }
  if (!cpCols.includes('amo_company_id')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN amo_company_id TEXT NOT NULL DEFAULT ''`);
  }
  if (!cpCols.includes('amo_contact_id')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN amo_contact_id TEXT NOT NULL DEFAULT ''`);
  }
  if (!cpCols.includes('amo_url')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN amo_url TEXT NOT NULL DEFAULT ''`);
  }
  if (!cpCols.includes('amo_entity')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN amo_entity TEXT NOT NULL DEFAULT ''`);
  }
  if (!cpCols.includes('source')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN source TEXT NOT NULL DEFAULT ''`);
  }
  if (!cpCols.includes('synced_at')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN synced_at TEXT NOT NULL DEFAULT ''`);
  }
  if (!cpCols.includes('kpp')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN kpp TEXT NOT NULL DEFAULT ''`);
  }
  if (!cpCols.includes('ogrn')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN ogrn TEXT NOT NULL DEFAULT ''`);
  }
  if (!cpCols.includes('address')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN address TEXT NOT NULL DEFAULT ''`);
  }
  if (!cpCols.includes('name_full')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN name_full TEXT NOT NULL DEFAULT ''`);
  }
  if (!cpCols.includes('dadata_synced_at')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN dadata_synced_at TEXT NOT NULL DEFAULT ''`);
  }
  if (!cpCols.includes('party_kind')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN party_kind TEXT NOT NULL DEFAULT ''`);
  }
  if (!cpCols.includes('is_partner')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN is_partner INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cpCols.includes('is_main')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN is_main INTEGER NOT NULL DEFAULT 0`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_counterparties_is_main ON counterparties(is_main)`);
  if (!cpCols.includes('director')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN director TEXT NOT NULL DEFAULT ''`);
  }
  for (const col of ['bank', 'bik', 'rs', 'ks'] as const) {
    if (!cpCols.includes(col)) {
      db.exec(`ALTER TABLE counterparties ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
    }
  }
  if (!cpCols.includes('created_at')) {
    db.exec(`ALTER TABLE counterparties ADD COLUMN created_at TEXT NOT NULL DEFAULT ''`);
    // уже известные даты синка Amo / прошлых загрузок
    db.exec(`
      UPDATE counterparties
      SET created_at = synced_at
      WHERE IFNULL(TRIM(created_at),'') = ''
        AND IFNULL(TRIM(synced_at),'') != ''
    `);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_counterparties_created ON counterparties(created_at)`);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_counterparties_amo_company ON counterparties(amo_company_id);
    CREATE INDEX IF NOT EXISTS idx_counterparties_amo_contact ON counterparties(amo_contact_id);
    CREATE TABLE IF NOT EXISTS counterparty_amo_links (
      company_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (company_id, contact_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cp_amo_links_contact ON counterparty_amo_links(contact_id);
  `);

  const prodColsMin = all<{ name: string }>('PRAGMA table_info(products)').map((c) => c.name);
  if (prodColsMin.length && !prodColsMin.includes('min_stock')) {
    db.exec(`ALTER TABLE products ADD COLUMN min_stock REAL NOT NULL DEFAULT 0`);
  }
  if (prodColsMin.length && !prodColsMin.includes('item_kind')) {
    db.exec(`ALTER TABLE products ADD COLUMN item_kind TEXT NOT NULL DEFAULT 'product'`);
  }
  if (prodColsMin.length && !prodColsMin.includes('is_main')) {
    db.exec(`ALTER TABLE products ADD COLUMN is_main INTEGER NOT NULL DEFAULT 0`);
  }
  if (prodColsMin.length && !prodColsMin.includes('warehouse_sku')) {
    db.exec(`ALTER TABLE products ADD COLUMN warehouse_sku TEXT NOT NULL DEFAULT ''`);
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_products_is_main ON products(is_main)`);
  } catch {
    /* ignore */
  }
  // Расходные — только товары; услуги не храним в stock_doc_lines out
  try {
    run(
      `DELETE FROM stock_doc_lines
       WHERE doc_id IN (SELECT id FROM stock_docs WHERE doc_type = 'out')
         AND product_id IN (
           SELECT id FROM products WHERE IFNULL(item_kind, 'product') = 'service'
         )`
    );
  } catch {
    /* ignore */
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS gtd_numbers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'local',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gtd_code ON gtd_numbers(code);

    CREATE TABLE IF NOT EXISTS cash_articles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'both',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS cash_docs (
      id TEXT PRIMARY KEY,
      doc_type TEXT NOT NULL,
      number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      article_id TEXT,
      counterparty_id TEXT,
      cash_register_id TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      posted INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cash_docs_date ON cash_docs(doc_date);

    CREATE TABLE IF NOT EXISTS payment_orders (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      payee TEXT NOT NULL DEFAULT '',
      purpose TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_titles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS work_schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hours_json TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS production_orders (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      qty REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crm_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'note',
      title TEXT NOT NULL,
      deal_id TEXT,
      counterparty_id TEXT,
      event_at TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_events_at ON crm_events(event_at);

    CREATE TABLE IF NOT EXISTS inventory_sheets (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      posted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS inventory_sheet_lines (
      id TEXT PRIMARY KEY,
      sheet_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      system_qty REAL NOT NULL DEFAULT 0,
      counted_qty REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (sheet_id) REFERENCES inventory_sheets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS money_transfers (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      from_name TEXT NOT NULL DEFAULT '',
      to_name TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bank_docs_local (
      id TEXT PRIMARY KEY,
      doc_type TEXT NOT NULL DEFAULT 'in',
      number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      counterparty TEXT NOT NULL DEFAULT '',
      purpose TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bank_docs_date ON bank_docs_local(doc_date);

    CREATE TABLE IF NOT EXISTS cash_registers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'cash',
      organization_id TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS card_ops (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      card_mask TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ok',
      comment TEXT NOT NULL DEFAULT '',
      deal_id TEXT NOT NULL DEFAULT '',
      stock_doc_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payment_plan (
      id TEXT PRIMARY KEY,
      plan_date TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'out',
      amount REAL NOT NULL DEFAULT 0,
      counterparty TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planned',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_payment_plan_date ON payment_plan(plan_date);

    CREATE TABLE IF NOT EXISTS hr_docs (
      id TEXT PRIMARY KEY,
      doc_type TEXT NOT NULL DEFAULT 'hire',
      number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      person_name TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS work_shifts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hours_from TEXT NOT NULL DEFAULT '09:00',
      hours_to TEXT NOT NULL DEFAULT '18:00',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    /** Фактические смены сборщика (/pick), привязаны к staff. */
    CREATE TABLE IF NOT EXISTS pick_shifts (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL DEFAULT '',
      staff_login TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'day',
      day TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL DEFAULT '',
      pin_verified_at TEXT NOT NULL DEFAULT '',
      last_activity_at TEXT NOT NULL DEFAULT '',
      auto_started INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pick_shifts_staff ON pick_shifts(staff_id, ended_at);
    CREATE INDEX IF NOT EXISTS idx_pick_shifts_day ON pick_shifts(day);

    /** Смены фотографа (/photo), отдельно от pick_shifts. */
    CREATE TABLE IF NOT EXISTS photo_shifts (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL DEFAULT '',
      staff_login TEXT NOT NULL DEFAULT '',
      day TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL DEFAULT '',
      products_done INTEGER NOT NULL DEFAULT 0,
      photos_uploaded INTEGER NOT NULL DEFAULT 0,
      files_uploaded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_photo_shifts_staff ON photo_shifts(staff_id, ended_at);
    CREATE INDEX IF NOT EXISTS idx_photo_shifts_day ON photo_shifts(day);

    CREATE TABLE IF NOT EXISTS time_kinds (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS company_bank_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bank_name TEXT NOT NULL DEFAULT '',
      bik TEXT NOT NULL DEFAULT '',
      account TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'RUB',
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS thin_journal_docs (
      id TEXT PRIMARY KEY,
      journal_key TEXT NOT NULL,
      number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      counterparty_name TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      comment TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_thin_journal_key_date
      ON thin_journal_docs(journal_key, doc_date);

    CREATE TABLE IF NOT EXISTS sto_work_orders (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      vehicle TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      total REAL NOT NULL DEFAULT 0,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sto_wo_date ON sto_work_orders(doc_date);

    CREATE TABLE IF NOT EXISTS marketplace_orders (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      external_id TEXT NOT NULL DEFAULT '',
      number TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      amount REAL NOT NULL DEFAULT 0,
      ordered_at TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mp_orders_ch ON marketplace_orders(channel);

    CREATE TABLE IF NOT EXISTS crm_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      due_at TEXT,
      deal_id TEXT,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_status_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'sales',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sto_resources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'lift',
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);

  {
    const taskCols = all<{ name: string }>('PRAGMA table_info(crm_tasks)').map((c) => c.name);
    const addTaskCol = (name: string, ddl: string) => {
      if (taskCols.length && !taskCols.includes(name)) {
        db.exec(`ALTER TABLE crm_tasks ADD COLUMN ${ddl}`);
      }
    };
    addTaskCol('assignee_amo_id', `assignee_amo_id TEXT NOT NULL DEFAULT ''`);
    addTaskCol('source', `source TEXT NOT NULL DEFAULT ''`);
    addTaskCol('payment_link_id', `payment_link_id TEXT NOT NULL DEFAULT ''`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_tasks_deal ON crm_tasks(deal_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_tasks_assignee ON crm_tasks(assignee_amo_id, status)`);
  }

  const cashArtCount = get<{ c: number }>('SELECT COUNT(*) AS c FROM cash_articles')?.c ?? 0;
  if (!cashArtCount) {
    const seeds = [
      ['Поступление от покупателя', 'in'],
      ['Оплата поставщику', 'out'],
      ['Прочий приход', 'in'],
      ['Прочий расход', 'out'],
    ] as const;
    for (const [name, kind] of seeds) {
      run(`INSERT INTO cash_articles (id, name, kind, is_active) VALUES (?, ?, ?, 1)`, [
        cryptoRandomId(),
        name,
        kind,
      ]);
    }
  }

  const cashRegCount = get<{ c: number }>('SELECT COUNT(*) AS c FROM cash_registers')?.c ?? 0;
  if (!cashRegCount) {
    run(
      `INSERT INTO cash_registers (id, name, kind, organization_id, is_active) VALUES (?, ?, 'cash', '', 1)`,
      [cryptoRandomId(), 'Основная касса']
    );
  }

  // ПКО/РКО → касса: колонка + старые документы на «Основная касса»
  const cashDocCols = all<{ name: string }>('PRAGMA table_info(cash_docs)').map((c) => c.name);
  if (cashDocCols.length && !cashDocCols.includes('cash_register_id')) {
    db.exec(`ALTER TABLE cash_docs ADD COLUMN cash_register_id TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cash_docs_register ON cash_docs(cash_register_id)`);
  const orphanCash = get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM cash_docs WHERE IFNULL(cash_register_id,'') = ''`
  )?.c;
  if (orphanCash) {
    const mainReg =
      get<{ id: string }>(
        `SELECT id FROM cash_registers WHERE name = 'Основная касса' ORDER BY rowid LIMIT 1`
      ) ||
      get<{ id: string }>(
        `SELECT id FROM cash_registers WHERE is_active = 1 ORDER BY name LIMIT 1`
      );
    if (mainReg?.id) {
      run(`UPDATE cash_docs SET cash_register_id = ? WHERE IFNULL(cash_register_id,'') = ''`, [
        mainReg.id,
      ]);
    }
  }

  // Кассы → юрлицо
  const cashRegCols = all<{ name: string }>('PRAGMA table_info(cash_registers)').map((c) => c.name);
  if (cashRegCols.length && !cashRegCols.includes('organization_id')) {
    db.exec(`ALTER TABLE cash_registers ADD COLUMN organization_id TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cash_registers_org ON cash_registers(organization_id)`);
  run(
    `UPDATE cash_registers SET name = 'Операционная касса'
     WHERE name = 'Операционная касса (Точка)'`
  );
  // Пользователю не нужна «касса Точки» — удаляем пустые операционные заготовки
  run(
    `DELETE FROM cash_registers
     WHERE kind = 'operating'
       AND (name = 'Операционная касса' OR name LIKE 'Операционная касса%Точка%')
       AND NOT EXISTS (
         SELECT 1 FROM cash_docs d WHERE d.cash_register_id = cash_registers.id
       )`
  );

  const timeKindsCount = get<{ c: number }>('SELECT COUNT(*) AS c FROM time_kinds')?.c ?? 0;
  if (!timeKindsCount) {
    for (const [code, name] of [
      ['Я', 'Явка'],
      ['В', 'Выходной'],
      ['О', 'Отпуск'],
      ['Б', 'Больничный'],
    ] as const) {
      run(`INSERT INTO time_kinds (id, code, name, is_active) VALUES (?, ?, ?, 1)`, [
        cryptoRandomId(),
        code,
        name,
      ]);
    }
  }

  const shiftsCount = get<{ c: number }>('SELECT COUNT(*) AS c FROM work_shifts')?.c ?? 0;
  if (!shiftsCount) {
    run(
      `INSERT INTO work_shifts (id, name, hours_from, hours_to, is_active) VALUES (?, ?, '09:00', '18:00', 1)`,
      [cryptoRandomId(), 'Дневная']
    );
    run(
      `INSERT INTO work_shifts (id, name, hours_from, hours_to, is_active) VALUES (?, ?, '18:00', '22:00', 1)`,
      [cryptoRandomId(), 'Вечерняя']
    );
  }

  const jobCount = get<{ c: number }>('SELECT COUNT(*) AS c FROM job_titles')?.c ?? 0;
  if (!jobCount) {
    for (const name of ['Кладовщик', 'Менеджер', 'Мастер СТО', 'Администратор']) {
      run(`INSERT INTO job_titles (id, name, is_active) VALUES (?, ?, 1)`, [cryptoRandomId(), name]);
    }
  }

  const schedCount = get<{ c: number }>('SELECT COUNT(*) AS c FROM work_schedules')?.c ?? 0;
  if (!schedCount) {
    run(
      `INSERT INTO work_schedules (id, name, hours_json, is_active) VALUES (?, ?, ?, 1)`,
      [
        cryptoRandomId(),
        'Пн–Пт 9–18',
        '{"mon":"09-18","tue":"09-18","wed":"09-18","thu":"09-18","fri":"09-18","sat":"","sun":""}',
      ]
    );
  }

  const bankAccCount = get<{ c: number }>('SELECT COUNT(*) AS c FROM company_bank_accounts')?.c ?? 0;
  if (!bankAccCount) {
    run(
      `INSERT INTO company_bank_accounts (id, name, bank_name, currency, is_active)
       VALUES (?, ?, ?, 'RUB', 1)`,
      [cryptoRandomId(), 'Расчётный счёт Точка', 'Точка Банк']
    );
  }

  const orderStCount = get<{ c: number }>('SELECT COUNT(*) AS c FROM order_status_types')?.c ?? 0;
  if (!orderStCount) {
    const sales = [
      'Новый',
      'Подтверждён',
      'В сборке',
      'Отгружен',
      'Закрыт',
      'Отменён',
    ];
    sales.forEach((name, i) => {
      run(
        `INSERT INTO order_status_types (id, name, kind, sort_order, is_active) VALUES (?, ?, 'sales', ?, 1)`,
        [cryptoRandomId(), name, i + 1]
      );
    });
    const sto = ['Записан', 'В работе', 'Ожидает запчасть', 'Готов', 'Выдан', 'Отменён'];
    sto.forEach((name, i) => {
      run(
        `INSERT INTO order_status_types (id, name, kind, sort_order, is_active) VALUES (?, ?, 'sto', ?, 1)`,
        [cryptoRandomId(), name, i + 1]
      );
    });
  }

  const stoResCount = get<{ c: number }>('SELECT COUNT(*) AS c FROM sto_resources')?.c ?? 0;
  if (!stoResCount) {
    for (const [name, kind] of [
      ['Подъёмник 1', 'lift'],
      ['Подъёмник 2', 'lift'],
      ['Пост диагностики', 'bay'],
    ] as const) {
      run(`INSERT INTO sto_resources (id, name, kind, is_active) VALUES (?, ?, ?, 1)`, [
        cryptoRandomId(),
        name,
        kind,
      ]);
    }
  }

  // Промежуточная ссылка на оплату + резерв на складе «Ожидание оплаты»
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_links (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      deal_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      amount REAL NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      timer_minutes INTEGER NOT NULL DEFAULT 30,
      payment_id TEXT NOT NULL DEFAULT '',
      acquiring_url TEXT NOT NULL DEFAULT '',
      acquiring_error TEXT NOT NULL DEFAULT '',
      yandex_pay_url TEXT NOT NULL DEFAULT '',
      yandex_order_id TEXT NOT NULL DEFAULT '',
      yandex_pay_error TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at TEXT,
      expired_at TEXT,
      FOREIGN KEY (deal_id) REFERENCES crm_deals(id)
    );
    CREATE INDEX IF NOT EXISTS idx_payment_links_token ON payment_links(token);
    CREATE INDEX IF NOT EXISTS idx_payment_links_deal ON payment_links(deal_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_payment_links_expire ON payment_links(status, expires_at);

    CREATE TABLE IF NOT EXISTS stock_reserves (
      id TEXT PRIMARY KEY,
      payment_link_id TEXT NOT NULL DEFAULT '',
      sales_doc_id TEXT NOT NULL DEFAULT '',
      deal_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      qty REAL NOT NULL,
      source_warehouse_id TEXT NOT NULL,
      reserve_warehouse_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      stock_doc_id TEXT NOT NULL DEFAULT '',
      return_doc_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      released_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stock_reserves_link ON stock_reserves(payment_link_id, status);
    CREATE INDEX IF NOT EXISTS idx_stock_reserves_product ON stock_reserves(product_id, status);
  `);

  // Старые БД: добавить sales_doc_id и снять FK на payment_links
  {
    const srCols = all<{ name: string }>('PRAGMA table_info(stock_reserves)').map((c) => c.name);
    if (srCols.length && !srCols.includes('sales_doc_id')) {
      db.exec(`
        CREATE TABLE stock_reserves__mig (
          id TEXT PRIMARY KEY,
          payment_link_id TEXT NOT NULL DEFAULT '',
          sales_doc_id TEXT NOT NULL DEFAULT '',
          deal_id TEXT NOT NULL,
          product_id TEXT NOT NULL,
          qty REAL NOT NULL,
          source_warehouse_id TEXT NOT NULL,
          reserve_warehouse_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          stock_doc_id TEXT NOT NULL DEFAULT '',
          return_doc_id TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          released_at TEXT
        );
        INSERT INTO stock_reserves__mig (
          id, payment_link_id, sales_doc_id, deal_id, product_id, qty,
          source_warehouse_id, reserve_warehouse_id, status, stock_doc_id, return_doc_id,
          created_at, released_at
        )
        SELECT
          id, IFNULL(payment_link_id,''), '', deal_id, product_id, qty,
          source_warehouse_id, reserve_warehouse_id, status, stock_doc_id, return_doc_id,
          created_at, released_at
        FROM stock_reserves;
        DROP TABLE stock_reserves;
        ALTER TABLE stock_reserves__mig RENAME TO stock_reserves;
        CREATE INDEX IF NOT EXISTS idx_stock_reserves_link ON stock_reserves(payment_link_id, status);
        CREATE INDEX IF NOT EXISTS idx_stock_reserves_product ON stock_reserves(product_id, status);
      `);
    }
    const srCols2 = all<{ name: string }>('PRAGMA table_info(stock_reserves)').map((c) => c.name);
    if (srCols2.includes('sales_doc_id')) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_stock_reserves_doc ON stock_reserves(sales_doc_id, status);
        CREATE INDEX IF NOT EXISTS idx_stock_reserves_deal ON stock_reserves(deal_id, status);
      `);
    }
  }

  const waitWh = get<{ id: string }>(
    `SELECT id FROM warehouses WHERE code = 'WAIT-PAY' OR name = 'Ожидание оплаты' LIMIT 1`
  );
  if (!waitWh) {
    run(
      `INSERT INTO warehouses (id, name, code, is_active) VALUES (?, 'Ожидание оплаты', 'WAIT-PAY', 1)`,
      [cryptoRandomId()]
    );
  }

  // ——— Мультиорг: справочник организаций + organization_id на ключевых документах ———
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      short_name TEXT NOT NULL DEFAULT '',
      inn TEXT NOT NULL DEFAULT '',
      kpp TEXT NOT NULL DEFAULT '',
      ogrnip TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      bank TEXT NOT NULL DEFAULT '',
      bik TEXT NOT NULL DEFAULT '',
      rs TEXT NOT NULL DEFAULT '',
      ks TEXT NOT NULL DEFAULT '',
      director TEXT NOT NULL DEFAULT '',
      accountant TEXT NOT NULL DEFAULT '',
      master_title TEXT NOT NULL DEFAULT '',
      vat_rate REAL NOT NULL DEFAULT 5,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_organizations_inn ON organizations(inn);
    CREATE INDEX IF NOT EXISTS idx_organizations_active ON organizations(is_active, is_default);
  `);
  {
    const orgColsEmail = all<{ name: string }>('PRAGMA table_info(organizations)').map((c) => c.name);
    if (orgColsEmail.length && !orgColsEmail.includes('email')) {
      db.exec(`ALTER TABLE organizations ADD COLUMN email TEXT NOT NULL DEFAULT ''`);
    }
    if (orgColsEmail.length && !orgColsEmail.includes('site_address')) {
      db.exec(`ALTER TABLE organizations ADD COLUMN site_address TEXT NOT NULL DEFAULT ''`);
    }
    if (orgColsEmail.length && !orgColsEmail.includes('work_hours')) {
      db.exec(`ALTER TABLE organizations ADD COLUMN work_hours TEXT NOT NULL DEFAULT ''`);
    }
  }

  // Контуры (Пневмоподвеска / Фогель): companies + company_id
  {
    const DEFAULT_COMPANY_ID = '00000000-0000-4000-8000-000000000001';
    db.exec(`
      CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(is_active, is_default);
    `);
    const orgColsCo = all<{ name: string }>('PRAGMA table_info(organizations)').map((c) => c.name);
    if (orgColsCo.length && !orgColsCo.includes('company_id')) {
      db.exec(`ALTER TABLE organizations ADD COLUMN company_id TEXT NOT NULL DEFAULT ''`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_organizations_company ON organizations(company_id)`);
    const whColsCo = all<{ name: string }>('PRAGMA table_info(warehouses)').map((c) => c.name);
    if (whColsCo.length && !whColsCo.includes('company_id')) {
      db.exec(`ALTER TABLE warehouses ADD COLUMN company_id TEXT NOT NULL DEFAULT ''`);
    }
    if (whColsCo.length && !whColsCo.includes('created_at')) {
      db.exec(`ALTER TABLE warehouses ADD COLUMN created_at TEXT NOT NULL DEFAULT ''`);
    }
    if (whColsCo.length && !whColsCo.includes('created_by')) {
      db.exec(`ALTER TABLE warehouses ADD COLUMN created_by TEXT NOT NULL DEFAULT ''`);
    }
    if (whColsCo.length && !whColsCo.includes('updated_at')) {
      db.exec(`ALTER TABLE warehouses ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''`);
    }
    if (whColsCo.length && !whColsCo.includes('show_in_widget')) {
      db.exec(`ALTER TABLE warehouses ADD COLUMN show_in_widget INTEGER NOT NULL DEFAULT 0`);
    }
    if (whColsCo.length && !whColsCo.includes('allow_inbound')) {
      db.exec(`ALTER TABLE warehouses ADD COLUMN allow_inbound INTEGER NOT NULL DEFAULT 0`);
      // По умолчанию приходуем на Основной и «Отложено под СТО»
      run(
        `UPDATE warehouses SET allow_inbound = 1
         WHERE IFNULL(code,'') = 'НФ-000032'
            OR IFNULL(code,'') LIKE 'STO-RES-%'
            OR lower(IFNULL(name,'')) LIKE 'филиал%москва%'
            OR lower(IFNULL(name,'')) LIKE 'отложено%под%сто%'`
      );
    }
    // Флаги show_in_widget в WMS — настраиваются на карточке склада.
    // Виджет Amo · Москва (pnevmopodveska_2025) — whitelist в wms_picker_widget_store_columns.
    // Краснодар (fogel_2025) — MySQL stores.show_in_widget, WMS-флаги не трогаем.
    db.exec(`CREATE INDEX IF NOT EXISTS idx_warehouses_company ON warehouses(company_id)`);
    const coCount = get<{ c: number }>('SELECT COUNT(*) AS c FROM companies')?.c ?? 0;
    if (!coCount) {
      run(
        `INSERT INTO companies (id, name, code, is_default, is_active) VALUES (?, 'Пневмоподвеска', 'PNEVMO', 1, 1)`,
        [DEFAULT_COMPANY_ID]
      );
    }
    const defCo =
      get<{ id: string }>(
        `SELECT id FROM companies WHERE is_default = 1 AND is_active = 1 LIMIT 1`
      )?.id ||
      get<{ id: string }>(`SELECT id FROM companies WHERE is_active = 1 ORDER BY name LIMIT 1`)?.id ||
      DEFAULT_COMPANY_ID;
    run(`UPDATE organizations SET company_id = ? WHERE IFNULL(company_id,'') = ''`, [defCo]);
    run(`UPDATE warehouses SET company_id = ? WHERE IFNULL(company_id,'') = ''`, [defCo]);
  }

  const salesOrgCols = all<{ name: string }>('PRAGMA table_info(sales_docs)').map((c) => c.name);
  if (salesOrgCols.length && !salesOrgCols.includes('organization_id')) {
    db.exec(`ALTER TABLE sales_docs ADD COLUMN organization_id TEXT NOT NULL DEFAULT ''`);
  }
  if (salesOrgCols.length) {
    const salesCarCols: Array<[string, string]> = [
      ['car_plate', "TEXT NOT NULL DEFAULT ''"],
      ['car_vin', "TEXT NOT NULL DEFAULT ''"],
      ['car_year', "TEXT NOT NULL DEFAULT ''"],
      ['car_mileage', "TEXT NOT NULL DEFAULT ''"],
      ['car_brand', "TEXT NOT NULL DEFAULT ''"],
      ['car_model', "TEXT NOT NULL DEFAULT ''"],
      ['car_color', "TEXT NOT NULL DEFAULT ''"],
      ['car_category', "TEXT NOT NULL DEFAULT ''"],
      ['car_pts', "TEXT NOT NULL DEFAULT ''"],
      ['car_owner', "TEXT NOT NULL DEFAULT ''"],
      ['car_owner_street', "TEXT NOT NULL DEFAULT ''"],
      ['car_owner_house', "TEXT NOT NULL DEFAULT ''"],
      ['car_owner_flat', "TEXT NOT NULL DEFAULT ''"],
      ['car_sts_date', "TEXT NOT NULL DEFAULT ''"],
      ['car_sts_number', "TEXT NOT NULL DEFAULT ''"],
    ];
    for (const [col, def] of salesCarCols) {
      if (!salesOrgCols.includes(col)) {
        db.exec(`ALTER TABLE sales_docs ADD COLUMN ${col} ${def}`);
      }
    }
    const salesBuyerCols: Array<[string, string]> = [
      ['buyer_phone', "TEXT NOT NULL DEFAULT ''"],
      ['buyer_email', "TEXT NOT NULL DEFAULT ''"],
      ['buyer_passport', "TEXT NOT NULL DEFAULT ''"],
      ['buyer_kpp', "TEXT NOT NULL DEFAULT ''"],
      ['buyer_ogrn', "TEXT NOT NULL DEFAULT ''"],
      ['buyer_director', "TEXT NOT NULL DEFAULT ''"],
      ['buyer_bank', "TEXT NOT NULL DEFAULT ''"],
      ['buyer_bik', "TEXT NOT NULL DEFAULT ''"],
      ['buyer_rs', "TEXT NOT NULL DEFAULT ''"],
      ['buyer_ks', "TEXT NOT NULL DEFAULT ''"],
      ['template_id', "TEXT NOT NULL DEFAULT ''"],
      ['checklist_json', "TEXT NOT NULL DEFAULT ''"],
      ['printed_at', "TEXT NOT NULL DEFAULT ''"],
    ];
    for (const [col, def] of salesBuyerCols) {
      if (!salesOrgCols.includes(col)) {
        db.exec(`ALTER TABLE sales_docs ADD COLUMN ${col} ${def}`);
      }
    }
  }
  const stockOrgCols = all<{ name: string }>('PRAGMA table_info(stock_docs)').map((c) => c.name);
  if (stockOrgCols.length && !stockOrgCols.includes('organization_id')) {
    db.exec(`ALTER TABLE stock_docs ADD COLUMN organization_id TEXT NOT NULL DEFAULT ''`);
  }
  // Основание расходной: заказ покупателя (GUID 1С, сущность в OData часто недоступна) + номер сделки Amo
  if (stockOrgCols.length && !stockOrgCols.includes('deal_id')) {
    db.exec(`ALTER TABLE stock_docs ADD COLUMN deal_id TEXT NOT NULL DEFAULT ''`);
  }
  if (stockOrgCols.length && !stockOrgCols.includes('basis_order_id')) {
    db.exec(`ALTER TABLE stock_docs ADD COLUMN basis_order_id TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_docs_deal ON stock_docs(deal_id)`);
  const payOrgCols = all<{ name: string }>('PRAGMA table_info(payment_links)').map((c) => c.name);
  if (payOrgCols.length && !payOrgCols.includes('organization_id')) {
    db.exec(`ALTER TABLE payment_links ADD COLUMN organization_id TEXT NOT NULL DEFAULT ''`);
  }
  if (payOrgCols.length && !payOrgCols.includes('yandex_pay_url')) {
    db.exec(`ALTER TABLE payment_links ADD COLUMN yandex_pay_url TEXT NOT NULL DEFAULT ''`);
  }
  if (payOrgCols.length && !payOrgCols.includes('yandex_order_id')) {
    db.exec(`ALTER TABLE payment_links ADD COLUMN yandex_order_id TEXT NOT NULL DEFAULT ''`);
  }
  if (payOrgCols.length && !payOrgCols.includes('yandex_pay_error')) {
    db.exec(`ALTER TABLE payment_links ADD COLUMN yandex_pay_error TEXT NOT NULL DEFAULT ''`);
  }

  // СТО: записи приёмщика, смены мастера на подъёмнике, работы/материалы ЗН
  db.exec(`
    CREATE TABLE IF NOT EXISTS sto_appointments (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      time_hm TEXT NOT NULL DEFAULT '',
      plate TEXT NOT NULL DEFAULT '',
      vin TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      client_name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'expected',
      work_order_id TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sto_appt_day ON sto_appointments(day, status);
    CREATE INDEX IF NOT EXISTS idx_sto_appt_plate ON sto_appointments(plate);

    CREATE TABLE IF NOT EXISTS sto_lift_shifts (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL DEFAULT '',
      staff_login TEXT NOT NULL DEFAULT '',
      day TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL DEFAULT '',
      pin_verified_at TEXT NOT NULL DEFAULT '',
      last_activity_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sto_lift_shifts_staff ON sto_lift_shifts(staff_id, ended_at);
    CREATE INDEX IF NOT EXISTS idx_sto_lift_shifts_day ON sto_lift_shifts(day);

    CREATE TABLE IF NOT EXISTS sto_wo_works (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL,
      name TEXT NOT NULL,
      qty REAL NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sto_wo_works_wo ON sto_wo_works(work_order_id);

    CREATE TABLE IF NOT EXISTS sto_wo_materials (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL,
      product_id TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      qty REAL NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT '',
      staff_id TEXT NOT NULL DEFAULT '',
      staff_name TEXT NOT NULL DEFAULT '',
      work_log_id TEXT NOT NULL DEFAULT '',
      stock_doc_id TEXT NOT NULL DEFAULT '',
      wrote_off INTEGER NOT NULL DEFAULT 0,
      stock_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sto_wo_mat_wo ON sto_wo_materials(work_order_id);

    /** Справочник типовых работ СТО (для быстрого выбора на подъёмнике). */
    CREATE TABLE IF NOT EXISTS sto_work_catalog (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hours_default REAL NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /** Факт: кто из слесарей что сделал по наряду / подъёмнику. */
    CREATE TABLE IF NOT EXISTS sto_work_logs (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL DEFAULT '',
      lift_id TEXT NOT NULL DEFAULT '',
      appointment_id TEXT NOT NULL DEFAULT '',
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL DEFAULT '',
      work_name TEXT NOT NULL,
      catalog_id TEXT NOT NULL DEFAULT '',
      qty REAL NOT NULL DEFAULT 1,
      hours REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'done',
      note TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sto_work_logs_staff_day
      ON sto_work_logs(staff_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sto_work_logs_wo ON sto_work_logs(work_order_id);
    CREATE INDEX IF NOT EXISTS idx_sto_work_logs_lift ON sto_work_logs(lift_id);
  `);

  const stoMatCols = all<{ name: string }>('PRAGMA table_info(sto_wo_materials)').map((c) => c.name);
  if (stoMatCols.length && !stoMatCols.includes('work_log_id')) {
    db.exec(`ALTER TABLE sto_wo_materials ADD COLUMN work_log_id TEXT NOT NULL DEFAULT ''`);
  }

  const stoCatCount = get<{ c: number }>('SELECT COUNT(*) AS c FROM sto_work_catalog')?.c ?? 0;
  if (!stoCatCount) {
    const seeds = [
      ['Диагностика подвески', 1, 1],
      ['Замена пневмобаллона', 2, 2],
      ['Замена компрессора', 2.5, 3],
      ['Замена клапанного блока', 1.5, 4],
      ['Прокачка / опрессовка системы', 1, 5],
      ['Сход-развал', 1, 6],
    ] as const;
    for (const [name, hours, sort] of seeds) {
      run(
        `INSERT INTO sto_work_catalog (id, name, hours_default, is_active, sort_order)
         VALUES (?, ?, ?, 1, ?)`,
        [cryptoRandomId(), name, hours, sort]
      );
    }
  }

  const stoWoCols = all<{ name: string }>('PRAGMA table_info(sto_work_orders)').map((c) => c.name);
  if (stoWoCols.length) {
    const addWo: Array<[string, string]> = [
      ['plate', "TEXT NOT NULL DEFAULT ''"],
      ['vin', "TEXT NOT NULL DEFAULT ''"],
      ['model', "TEXT NOT NULL DEFAULT ''"],
      ['car_year', "TEXT NOT NULL DEFAULT ''"],
      ['car_mileage', "TEXT NOT NULL DEFAULT ''"],
      ['lift_id', "TEXT NOT NULL DEFAULT ''"],
      ['lift_started_at', "TEXT NOT NULL DEFAULT ''"],
      ['master_staff_id', "TEXT NOT NULL DEFAULT ''"],
      ['master_staff_name', "TEXT NOT NULL DEFAULT ''"],
    ];
    for (const [name, ddl] of addWo) {
      if (!stoWoCols.includes(name)) db.exec(`ALTER TABLE sto_work_orders ADD COLUMN ${name} ${ddl}`);
    }
  }

  // Сид из org_profile / реквизитов ИП Безматерных, если справочник пуст
  const orgCount = get<{ c: number }>('SELECT COUNT(*) AS c FROM organizations')?.c ?? 0;
  if (!orgCount) {
    let seed = {
      name: 'Индивидуальный предприниматель Безматерных Роман Павлович',
      short_name: 'Безматерных Р.П.',
      inn: '231215603728',
      kpp: '',
      ogrnip: '322237500133521',
      address: '350000, Краснодарский край, Селезнева, д. 84, кв. 73',
      site_address: 'г. Москва, Можайское шоссе, вл. 167',
      work_hours: 'понедельник — суббота с 9:00 до 19:00',
      phone: '+7 (925) 160-80-31',
      email: 'info@pnevmopodveska1.ru',
      bank: 'ООО "Банк Точка" г. Москва',
      bik: '044525104',
      rs: '40802810109500030587',
      ks: '30101810745374525104',
      director: 'Безматерных Р.П.',
      accountant: '',
      master_title: 'Мастер-приемщик Пневмоподвеска №1',
      vat_rate: 5,
    };
    const orgRow = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['org_profile']);
    if (orgRow?.value) {
      try {
        seed = { ...seed, ...(JSON.parse(orgRow.value) as typeof seed) };
      } catch {
        /* keep default */
      }
    }
    const defCoId =
      get<{ id: string }>(
        `SELECT id FROM companies WHERE is_default = 1 AND is_active = 1 LIMIT 1`
      )?.id || '00000000-0000-4000-8000-000000000001';
    run(
      `INSERT INTO organizations (
         id, code, company_id, name, short_name, inn, kpp, ogrnip, address, site_address, work_hours,
         phone, email, bank, bik, rs, ks, director, accountant, master_title, vat_rate,
         is_default, is_active, source
       ) VALUES (?, 'MAIN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'seed')`,
      [
        cryptoRandomId(),
        defCoId,
        seed.name,
        seed.short_name,
        seed.inn,
        seed.kpp,
        seed.ogrnip,
        seed.address,
        seed.site_address || '',
        seed.work_hours || '',
        seed.phone,
        seed.email || '',
        seed.bank,
        seed.bik,
        seed.rs,
        seed.ks,
        seed.director,
        seed.accountant,
        seed.master_title,
        Number(seed.vat_rate) || 5,
      ]
    );
  }

  // Кассы без юрлица → организация по умолчанию (после сида organizations)
  {
    const orphanRegOrg = get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM cash_registers WHERE IFNULL(organization_id,'') = ''`
    )?.c;
    if (orphanRegOrg) {
      const defOrg =
        get<{ id: string }>(
          `SELECT id FROM organizations WHERE is_default = 1 AND is_active = 1 LIMIT 1`
        ) ||
        get<{ id: string }>(`SELECT id FROM organizations WHERE is_active = 1 ORDER BY name LIMIT 1`);
      if (defOrg?.id) {
        run(`UPDATE cash_registers SET organization_id = ? WHERE IFNULL(organization_id,'') = ''`, [
          defOrg.id,
        ]);
      }
    }
  }

  // ——— Цепочка поставок: ШК партий, заказы поставщику, заявки на СТО ———
  {
    const cpCols = all<{ name: string }>('PRAGMA table_info(counterparties)').map((c) => c.name);
    if (cpCols.length && !cpCols.includes('barcode_prefix')) {
      db.exec(`ALTER TABLE counterparties ADD COLUMN barcode_prefix TEXT NOT NULL DEFAULT ''`);
    }
    const stockCols = all<{ name: string }>('PRAGMA table_info(stock_docs)').map((c) => c.name);
    if (stockCols.length && !stockCols.includes('source_supplier_order_id')) {
      db.exec(`ALTER TABLE stock_docs ADD COLUMN source_supplier_order_id TEXT NOT NULL DEFAULT ''`);
    }
    if (stockCols.length && !stockCols.includes('mismatch')) {
      db.exec(`ALTER TABLE stock_docs ADD COLUMN mismatch INTEGER NOT NULL DEFAULT 0`);
    }
    if (stockCols.length && !stockCols.includes('supply_number')) {
      db.exec(`ALTER TABLE stock_docs ADD COLUMN supply_number TEXT NOT NULL DEFAULT ''`);
    }
    if (stockCols.length && !stockCols.includes('inbound_baseline_json')) {
      db.exec(`ALTER TABLE stock_docs ADD COLUMN inbound_baseline_json TEXT NOT NULL DEFAULT ''`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_docs_supply ON stock_docs(supply_number)`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_discrepancy_acts (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        inbound_doc_id TEXT NOT NULL DEFAULT '',
        supplier_order_id TEXT NOT NULL DEFAULT '',
        supply_number TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        comment TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pda_inbound ON purchase_discrepancy_acts(inbound_doc_id);
      CREATE INDEX IF NOT EXISTS idx_pda_supply ON purchase_discrepancy_acts(supply_number);

      CREATE TABLE IF NOT EXISTS purchase_discrepancy_lines (
        id TEXT PRIMARY KEY,
        act_id TEXT NOT NULL,
        product_id TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'qty_diff',
        qty_supply REAL NOT NULL DEFAULT 0,
        qty_inbound REAL NOT NULL DEFAULT 0,
        qty_diff REAL NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (act_id) REFERENCES purchase_discrepancy_acts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pdl_act ON purchase_discrepancy_lines(act_id);
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS barcode_sequences (
        prefix TEXT PRIMARY KEY,
        last_n INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS supplier_orders (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        counterparty_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        eta_date TEXT NOT NULL DEFAULT '',
        paid_at TEXT NOT NULL DEFAULT '',
        mismatch INTEGER NOT NULL DEFAULT 0,
        mismatch_note TEXT NOT NULL DEFAULT '',
        comment TEXT NOT NULL DEFAULT '',
        stock_doc_id TEXT NOT NULL DEFAULT '',
        organization_id TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_supplier_orders_status ON supplier_orders(status);
      CREATE INDEX IF NOT EXISTS idx_supplier_orders_cp ON supplier_orders(counterparty_id);

      CREATE TABLE IF NOT EXISTS supplier_order_lines (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        qty REAL NOT NULL DEFAULT 1,
        price REAL NOT NULL DEFAULT 0,
        comment TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (order_id) REFERENCES supplier_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
      CREATE INDEX IF NOT EXISTS idx_supplier_order_lines_order ON supplier_order_lines(order_id);

      CREATE TABLE IF NOT EXISTS supplier_order_units (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        line_id TEXT NOT NULL DEFAULT '',
        product_id TEXT NOT NULL,
        serial TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'in_transit',
        product_unit_id TEXT NOT NULL DEFAULT '',
        received_at TEXT NOT NULL DEFAULT '',
        stock_doc_id TEXT NOT NULL DEFAULT '',
        is_extra INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (order_id) REFERENCES supplier_orders(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_order_units_serial
        ON supplier_order_units(serial COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_supplier_order_units_order ON supplier_order_units(order_id, status);

      CREATE TABLE IF NOT EXISTS sto_transfer_requests (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        deal_id TEXT NOT NULL DEFAULT '',
        warehouse_task_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'new',
        comment TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sto_xfer_status ON sto_transfer_requests(status);
      CREATE INDEX IF NOT EXISTS idx_sto_xfer_deal ON sto_transfer_requests(deal_id);

      CREATE TABLE IF NOT EXISTS sto_transfer_request_lines (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        qty REAL NOT NULL DEFAULT 1,
        serial TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'new',
        transferred_at TEXT NOT NULL DEFAULT '',
        stock_doc_id TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (request_id) REFERENCES sto_transfer_requests(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sto_xfer_lines_req ON sto_transfer_request_lines(request_id);
    `);

    const ensureWh = (code: string, name: string) => {
      const row = get<{ id: string }>(
        `SELECT id FROM warehouses WHERE code = ? OR name = ? LIMIT 1`,
        [code, name]
      );
      if (row?.id) return row.id;
      const id = cryptoRandomId();
      run(`INSERT INTO warehouses (id, name, code, is_active) VALUES (?, ?, ?, 1)`, [id, name, code]);
      return id;
    };
    ensureWh('MAIN', 'Основной');
    ensureWh('STO', 'СТО');
    ensureWh('IN-TRANSIT', 'В пути');
    // Виртуальные (не 1С · Подвеска): пол СТО, «Отложено» и отдельно «Резерв СТО» (сделки Amo)
    ensureWh('STO-RES-MSK', 'Отложено под СТО');
    ensureWh('STO-RES-STRELA', 'Отложено под СТО · Стрела');
    ensureWh('STO-RSV-MSK', 'Резерв СТО');
  }

  // Операции по картам ↔ заказ / расходная
  {
    const cardCols = all<{ name: string }>('PRAGMA table_info(card_ops)').map((c) => c.name);
    if (cardCols.length) {
      if (!cardCols.includes('deal_id')) {
        db.exec(`ALTER TABLE card_ops ADD COLUMN deal_id TEXT NOT NULL DEFAULT ''`);
      }
      if (!cardCols.includes('stock_doc_id')) {
        db.exec(`ALTER TABLE card_ops ADD COLUMN stock_doc_id TEXT NOT NULL DEFAULT ''`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_card_ops_deal ON card_ops(deal_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_card_ops_stock ON card_ops(stock_doc_id)`);
    }
  }

  // Гараж авто контрагента (несколько машин на клиента)
  db.exec(`
    CREATE TABLE IF NOT EXISTS counterparty_vehicles (
      id TEXT PRIMARY KEY,
      counterparty_id TEXT NOT NULL,
      car_plate TEXT NOT NULL DEFAULT '',
      car_vin TEXT NOT NULL DEFAULT '',
      car_year TEXT NOT NULL DEFAULT '',
      car_brand TEXT NOT NULL DEFAULT '',
      car_model TEXT NOT NULL DEFAULT '',
      car_color TEXT NOT NULL DEFAULT '',
      car_category TEXT NOT NULL DEFAULT '',
      car_pts TEXT NOT NULL DEFAULT '',
      car_owner TEXT NOT NULL DEFAULT '',
      car_owner_street TEXT NOT NULL DEFAULT '',
      car_owner_house TEXT NOT NULL DEFAULT '',
      car_owner_flat TEXT NOT NULL DEFAULT '',
      car_sts_date TEXT NOT NULL DEFAULT '',
      car_sts_number TEXT NOT NULL DEFAULT '',
      car_mileage TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (counterparty_id) REFERENCES counterparties(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cp_vehicles_cp ON counterparty_vehicles(counterparty_id);
    CREATE INDEX IF NOT EXISTS idx_cp_vehicles_plate ON counterparty_vehicles(car_plate);
  `);

  {
    const cpVehCols = all<{ name: string }>('PRAGMA table_info(counterparty_vehicles)').map((c) => c.name);
    if (cpVehCols.length && !cpVehCols.includes('car_mileage')) {
      db.exec(`ALTER TABLE counterparty_vehicles ADD COLUMN car_mileage TEXT NOT NULL DEFAULT ''`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_price_imports (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL DEFAULT '',
      supplier_name TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL DEFAULT '',
      sheet_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'uploaded',
      column_map_json TEXT NOT NULL DEFAULT '{}',
      header_row INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      parsed_at TEXT NOT NULL DEFAULT '',
      row_count INTEGER NOT NULL DEFAULT 0,
      new_count INTEGER NOT NULL DEFAULT 0,
      changed_count INTEGER NOT NULL DEFAULT 0,
      matched_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ppi_created ON purchase_price_imports(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ppi_supplier ON purchase_price_imports(supplier_id);

    CREATE TABLE IF NOT EXISTS purchase_price_rows (
      id TEXT PRIMARY KEY,
      import_id TEXT NOT NULL,
      row_no INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL DEFAULT '[]',
      article TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'RUB',
      barcode TEXT NOT NULL DEFAULT '',
      oem TEXT NOT NULL DEFAULT '',
      crosses TEXT NOT NULL DEFAULT '',
      applicability TEXT NOT NULL DEFAULT '',
      qty REAL NOT NULL DEFAULT 0,
      match_status TEXT NOT NULL DEFAULT 'pending',
      match_product_id TEXT NOT NULL DEFAULT '',
      match_sku TEXT NOT NULL DEFAULT '',
      old_price REAL,
      price_delta REAL,
      picture_path TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (import_id) REFERENCES purchase_price_imports(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ppr_import ON purchase_price_rows(import_id);
    CREATE INDEX IF NOT EXISTS idx_ppr_status ON purchase_price_rows(import_id, match_status);

    CREATE TABLE IF NOT EXISTS purchase_baskets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      supplier_id TEXT NOT NULL DEFAULT '',
      supplier_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pb_updated ON purchase_baskets(updated_at DESC);

    CREATE TABLE IF NOT EXISTS purchase_basket_lines (
      id TEXT PRIMARY KEY,
      basket_id TEXT NOT NULL,
      import_row_id TEXT NOT NULL DEFAULT '',
      product_id TEXT NOT NULL DEFAULT '',
      article TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'RUB',
      qty REAL NOT NULL DEFAULT 1,
      barcode TEXT NOT NULL DEFAULT '',
      oem TEXT NOT NULL DEFAULT '',
      crosses TEXT NOT NULL DEFAULT '',
      applicability TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (basket_id) REFERENCES purchase_baskets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pbl_basket ON purchase_basket_lines(basket_id);
  `);

  // Дедуп номенклатуры: мастер / алиас (из Google Sheet «Закупка ТОП MRA…»)
  {
    const pcols = all<{ name: string }>('PRAGMA table_info(products)').map((c) => c.name);
    const addP = (name: string, ddl: string) => {
      if (!pcols.includes(name)) db.exec(`ALTER TABLE products ADD COLUMN ${ddl}`);
    };
    addP('dedup_role', `dedup_role TEXT NOT NULL DEFAULT ''`);
    addP('master_product_id', `master_product_id TEXT NOT NULL DEFAULT ''`);
    addP('dedup_group', `dedup_group TEXT NOT NULL DEFAULT ''`);
    addP('sheet_supplier', `sheet_supplier TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_dedup_groups (
      group_no TEXT PRIMARY KEY,
      master_product_id TEXT NOT NULL DEFAULT '',
      master_sku TEXT NOT NULL DEFAULT '',
      master_nf TEXT NOT NULL DEFAULT '',
      master_article TEXT NOT NULL DEFAULT '',
      merged_oe TEXT NOT NULL DEFAULT '',
      member_count INTEGER NOT NULL DEFAULT 0,
      matched_count INTEGER NOT NULL DEFAULT 0,
      missing_count INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'sheet',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS product_dedup_members (
      id TEXT PRIMARY KEY,
      group_no TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      article TEXT NOT NULL DEFAULT '',
      nf_code TEXT NOT NULL DEFAULT '',
      supplier TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      oe_card TEXT NOT NULL DEFAULT '',
      merged_oe TEXT NOT NULL DEFAULT '',
      attrs_json TEXT NOT NULL DEFAULT '',
      product_id TEXT NOT NULL DEFAULT '',
      match_status TEXT NOT NULL DEFAULT 'pending',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pdm_group ON product_dedup_members(group_no);
    CREATE INDEX IF NOT EXISTS idx_pdm_product ON product_dedup_members(product_id);
    CREATE INDEX IF NOT EXISTS idx_pdm_status ON product_dedup_members(match_status);
    CREATE INDEX IF NOT EXISTS idx_prod_master ON products(master_product_id);
    CREATE INDEX IF NOT EXISTS idx_prod_dedup_group ON products(dedup_group);

    CREATE TABLE IF NOT EXISTS product_code_masters (
      code TEXT PRIMARY KEY,
      code_type TEXT NOT NULL DEFAULT '',
      master_mraer TEXT NOT NULL DEFAULT '',
      master_nf TEXT NOT NULL DEFAULT '',
      master_name TEXT NOT NULL DEFAULT '',
      master_product_id TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      conflict TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS nomen_catalog_sheet (
      id TEXT PRIMARY KEY,
      group_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      mraer TEXT NOT NULL DEFAULT '',
      oem TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      articles TEXT NOT NULL DEFAULT '',
      models TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      supplier TEXT NOT NULL DEFAULT '',
      attrs_json TEXT NOT NULL DEFAULT '',
      product_id TEXT NOT NULL DEFAULT '',
      match_status TEXT NOT NULL DEFAULT 'pending',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ncs_code ON nomen_catalog_sheet(code);
    CREATE INDEX IF NOT EXISTS idx_ncs_status ON nomen_catalog_sheet(match_status);

    CREATE TABLE IF NOT EXISTS integration_api_keys (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL DEFAULT '',
      key_hint TEXT NOT NULL DEFAULT '',
      scopes TEXT NOT NULL DEFAULT 'all',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT NOT NULL DEFAULT '',
      revoked_at TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_iapik_active ON integration_api_keys(is_active);
    CREATE INDEX IF NOT EXISTS idx_iapik_hash ON integration_api_keys(key_hash);
  `);
  {
    const iak = all<{ name: string }>('PRAGMA table_info(integration_api_keys)').map((c) => c.name);
    if (iak.length && !iak.includes('staff_id')) {
      db.exec(`ALTER TABLE integration_api_keys ADD COLUMN staff_id TEXT NOT NULL DEFAULT ''`);
    }
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_iapik_staff ON integration_api_keys(staff_id)`);
    } catch {
      /* ignore */
    }
  }
  {
    const ncs = all<{ name: string }>('PRAGMA table_info(nomen_catalog_sheet)').map((c) => c.name);
    if (!ncs.includes('supplier')) {
      db.exec(`ALTER TABLE nomen_catalog_sheet ADD COLUMN supplier TEXT NOT NULL DEFAULT ''`);
    }
    if (!ncs.includes('attrs_json')) {
      db.exec(`ALTER TABLE nomen_catalog_sheet ADD COLUMN attrs_json TEXT NOT NULL DEFAULT ''`);
    }
  }
  {
    const pdm = all<{ name: string }>('PRAGMA table_info(product_dedup_members)').map((c) => c.name);
    if (!pdm.includes('attrs_json')) {
      db.exec(`ALTER TABLE product_dedup_members ADD COLUMN attrs_json TEXT NOT NULL DEFAULT ''`);
    }
  }

  // Единица «услуга» для item_kind=service (не «шт»)
  {
    let svcUnit = get<{ id: string }>(
      `SELECT id FROM units
       WHERE lower(trim(short_name)) IN ('услуга', 'усл')
          OR lower(trim(name)) IN ('услуга', 'услуги')
       LIMIT 1`
    )?.id;
    if (!svcUnit) {
      svcUnit = cryptoRandomId();
      run(`INSERT INTO units (id, name, short_name) VALUES (?, 'Услуга', 'услуга')`, [
        svcUnit,
      ]);
    }
    run(
      `UPDATE products SET unit_id = ?
       WHERE IFNULL(item_kind, 'product') = 'service' AND IFNULL(unit_id, '') != ?`,
      [svcUnit, svcUnit]
    );
  }

  // Не копить огромный WAL (на проде бывало 20+ МБ → тормоза SQLite)
  try {
    get('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    /* ignore */
  }

  // ПДн SMS-подпись (pdn.uchetn1.ru)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pdn_sign_sessions (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        deal_id TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        buyer_name TEXT NOT NULL DEFAULT '',
        org_name TEXT NOT NULL DEFAULT '',
        org_inn TEXT NOT NULL DEFAULT '',
        sender TEXT NOT NULL DEFAULT 'Pnevmo1',
        status TEXT NOT NULL DEFAULT 'pending',
        consent_text TEXT NOT NULL DEFAULT '',
        consent_sha256 TEXT NOT NULL DEFAULT '',
        link_url TEXT NOT NULL DEFAULT '',
        link_sms_id TEXT NOT NULL DEFAULT '',
        code_hash TEXT NOT NULL DEFAULT '',
        code_salt TEXT NOT NULL DEFAULT '',
        code_sms_id TEXT NOT NULL DEFAULT '',
        code_sent_at TEXT NOT NULL DEFAULT '',
        code_attempts INTEGER NOT NULL DEFAULT 0,
        signed_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_by TEXT NOT NULL DEFAULT '',
        expires_at TEXT NOT NULL DEFAULT '',
        meta_json TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_pdn_sign_deal ON pdn_sign_sessions(deal_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_pdn_sign_token ON pdn_sign_sessions(token);

      CREATE TABLE IF NOT EXISTS pdn_sign_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        deal_id TEXT NOT NULL DEFAULT '',
        event TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        ip TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        os TEXT NOT NULL DEFAULT '',
        browser TEXT NOT NULL DEFAULT '',
        device TEXT NOT NULL DEFAULT '',
        region TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT '',
        accept_language TEXT NOT NULL DEFAULT '',
        meta_json TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_pdn_sign_events_session ON pdn_sign_events(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_pdn_sign_events_deal ON pdn_sign_events(deal_id, created_at);
    `);
  } catch {
    /* ignore */
  }

  // Производство: заказы сборки/разборки + склад PROD-WIP
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS production_jobs (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        doc_date TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'assemble',
        status TEXT NOT NULL DEFAULT 'draft',
        deal_id TEXT NOT NULL DEFAULT '',
        warehouse_id TEXT NOT NULL DEFAULT '',
        prod_warehouse_id TEXT NOT NULL DEFAULT '',
        comment TEXT NOT NULL DEFAULT '',
        send_transfer_id TEXT NOT NULL DEFAULT '',
        receive_out_id TEXT NOT NULL DEFAULT '',
        receive_in_id TEXT NOT NULL DEFAULT '',
        send_task_id TEXT NOT NULL DEFAULT '',
        receive_task_id TEXT NOT NULL DEFAULT '',
        done_at TEXT NOT NULL DEFAULT '',
        received_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_prod_jobs_status ON production_jobs(status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_prod_jobs_deal ON production_jobs(deal_id);

      CREATE TABLE IF NOT EXISTS production_job_lines (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        line_no INTEGER NOT NULL DEFAULT 1,
        direction TEXT NOT NULL CHECK(direction IN ('consume','produce')),
        product_id TEXT NOT NULL,
        sku TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        qty REAL NOT NULL DEFAULT 1,
        FOREIGN KEY (job_id) REFERENCES production_jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_prod_job_lines_job ON production_job_lines(job_id);

      CREATE TABLE IF NOT EXISTS production_job_events (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        event TEXT NOT NULL,
        actor_id TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_prod_job_events ON production_job_events(job_id, created_at);
    `);
    const ensureWh = (code: string, name: string) => {
      const row = get<{ id: string }>(
        `SELECT id FROM warehouses WHERE code = ? OR name = ? LIMIT 1`,
        [code, name]
      );
      if (row?.id) return row.id;
      const id = cryptoRandomId();
      run(`INSERT INTO warehouses (id, name, code, is_active) VALUES (?, ?, ?, 1)`, [id, name, code]);
      return id;
    };
    ensureWh('PROD-WIP', 'Производство (сборка/разбор)');
  } catch {
    /* ignore */
  }

  // Снять дедуп-мастера/алиасы — номенклатура только из 1С
  try {
    const purged = get<{ value: string }>(`SELECT value FROM meta WHERE key = 'dedup_purged_v1'`);
    if (!purged?.value) {
      run(
        `UPDATE products SET is_active = 1
         WHERE IFNULL(dedup_role,'') = 'alias'
           AND NOT (
             IFNULL(item_kind,'product') = 'service'
             AND lower(IFNULL(sku,'')) NOT LIKE 'se-%'
             AND lower(IFNULL(code,'')) NOT LIKE 'se-%'
           )`
      );
      run(
        `UPDATE products SET dedup_role = '', master_product_id = '', dedup_group = '', is_main = 1
         WHERE IFNULL(dedup_role,'') != '' OR IFNULL(master_product_id,'') != '' OR IFNULL(dedup_group,'') != ''`
      );
      run(`DELETE FROM product_dedup_members`);
      run(`DELETE FROM product_dedup_groups`);
      run(`DELETE FROM product_code_masters`);
      run(`DELETE FROM nomen_catalog_sheet`);
      run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('dedup_purged_v1', datetime('now'))`);
    }
  } catch {
    /* ignore */
  }

  // Коррекции остатков (документы admin_only, журнал stock_adjustments)
  try {
    const docCols = all<{ name: string }>('PRAGMA table_info(stock_docs)').map((c) => c.name);
    if (!docCols.includes('admin_only')) {
      run(`ALTER TABLE stock_docs ADD COLUMN admin_only INTEGER NOT NULL DEFAULT 0`);
    }
    run(`
      CREATE TABLE IF NOT EXISTS stock_adjustments (
        id TEXT PRIMARY KEY,
        warehouse_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        qty_before REAL NOT NULL,
        qty_delta REAL NOT NULL,
        qty_after REAL NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        doc_id TEXT NOT NULL,
        doc_number TEXT NOT NULL DEFAULT '',
        doc_type TEXT NOT NULL DEFAULT '',
        created_by_id TEXT NOT NULL DEFAULT '',
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    run(`CREATE INDEX IF NOT EXISTS idx_stock_adj_wh ON stock_adjustments(warehouse_id, created_at)`);
    run(`CREATE INDEX IF NOT EXISTS idx_stock_adj_doc ON stock_adjustments(doc_id)`);
  } catch {
    /* ignore */
  }
}

function cryptoRandomId(): string {
  // lightweight guid without importing ids (migrate runs early)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
