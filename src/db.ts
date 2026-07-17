import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.WMS_DATA_DIR
  || path.resolve(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'warehouse.sqlite');

fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

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
      actor_name TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      before_json TEXT NOT NULL DEFAULT '',
      after_json TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT ''
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
      actor_name TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      before_json TEXT NOT NULL DEFAULT '',
      after_json TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
  `);

  // Колонки пароля у уже существующей staff (индексы — только после ALTER)
  const staffCols = all<{ name: string }>('PRAGMA table_info(staff)').map((c) => c.name);
  const addStaffCol = (name: string, ddl: string) => {
    if (!staffCols.includes(name)) db.exec(`ALTER TABLE staff ADD COLUMN ${ddl}`);
  };
  addStaffCol('login', `login TEXT NOT NULL DEFAULT ''`);
  addStaffCol('password_hash', `password_hash TEXT NOT NULL DEFAULT ''`);
  addStaffCol('password_set_at', `password_set_at TEXT NOT NULL DEFAULT ''`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_staff_login ON staff(login)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_staff_email ON staff(email)`);

  const docCols = all<{ name: string }>('PRAGMA table_info(stock_docs)').map((c) => c.name);
  if (!docCols.includes('amount')) db.exec(`ALTER TABLE stock_docs ADD COLUMN amount REAL NOT NULL DEFAULT 0`);
  if (!docCols.includes('source')) db.exec(`ALTER TABLE stock_docs ADD COLUMN source TEXT NOT NULL DEFAULT 'local'`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_docs_source ON stock_docs(source)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_docs_type_date ON stock_docs(doc_type, doc_date)`);

  const lineCols = all<{ name: string }>('PRAGMA table_info(stock_doc_lines)').map((c) => c.name);
  if (!lineCols.includes('price')) db.exec(`ALTER TABLE stock_doc_lines ADD COLUMN price REAL NOT NULL DEFAULT 0`);
  if (!lineCols.includes('amount')) db.exec(`ALTER TABLE stock_doc_lines ADD COLUMN amount REAL NOT NULL DEFAULT 0`);
  if (!lineCols.includes('line_no')) db.exec(`ALTER TABLE stock_doc_lines ADD COLUMN line_no INTEGER NOT NULL DEFAULT 0`);

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
}

export type Row = Record<string, unknown>;
type SqlParam = string | number | bigint | null | Uint8Array;

export function all<T extends Row = Row>(sql: string, params: SqlParam[] = []): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T extends Row = Row>(sql: string, params: SqlParam[] = []): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, params: SqlParam[] = []): void {
  db.prepare(sql).run(...params);
}
