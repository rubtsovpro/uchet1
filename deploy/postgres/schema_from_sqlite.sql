-- AUTO-GENERATED from SQLite — review before apply
-- Source: /private/tmp/wms-schema-only.sqlite
BEGIN;

-- table audit_log
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" TEXT PRIMARY KEY,
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "actor_id" TEXT NOT NULL DEFAULT '',
  "actor_name" TEXT NOT NULL DEFAULT '',
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL DEFAULT '',
  "entity_id" TEXT NOT NULL DEFAULT '',
  "summary" TEXT NOT NULL DEFAULT '',
  "before_json" TEXT NOT NULL DEFAULT '',
  "after_json" TEXT NOT NULL DEFAULT '',
  "ip" TEXT NOT NULL DEFAULT '',
  "actor_login" TEXT NOT NULL DEFAULT '',
  "user_agent" TEXT NOT NULL DEFAULT '',
  "path" TEXT NOT NULL DEFAULT '',
  "meta_json" TEXT NOT NULL DEFAULT ''
);


-- table auth_2fa_challenges
CREATE TABLE IF NOT EXISTS "auth_2fa_challenges" (
  "id" TEXT PRIMARY KEY,
  "actor_id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "attempts" BIGINT NOT NULL DEFAULT 0,
  "ip" TEXT NOT NULL DEFAULT '',
  "user_agent" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table bank_docs_local
CREATE TABLE IF NOT EXISTS "bank_docs_local" (
  "id" TEXT PRIMARY KEY,
  "doc_type" TEXT NOT NULL DEFAULT 'in',
  "number" TEXT NOT NULL,
  "doc_date" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "counterparty" TEXT NOT NULL DEFAULT '',
  "purpose" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT 'local',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table barcode_sequences
CREATE TABLE IF NOT EXISTS "barcode_sequences" (
  "prefix" TEXT PRIMARY KEY,
  "last_n" BIGINT NOT NULL DEFAULT 0
);


-- table car_photo_tasks
CREATE TABLE IF NOT EXISTS "car_photo_tasks" (
  "id" TEXT PRIMARY KEY,
  "deal_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "note" TEXT NOT NULL DEFAULT '',
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_by_name" TEXT NOT NULL DEFAULT '',
  "claimed_by" TEXT NOT NULL DEFAULT '',
  "completed_at" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "kind" TEXT NOT NULL DEFAULT 'car'
);


-- table card_ops
CREATE TABLE IF NOT EXISTS "card_ops" (
  "id" TEXT PRIMARY KEY,
  "number" TEXT NOT NULL,
  "doc_date" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "card_mask" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'ok',
  "comment" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "deal_id" TEXT NOT NULL DEFAULT '',
  "stock_doc_id" TEXT NOT NULL DEFAULT ''
);


-- table cash_articles
CREATE TABLE IF NOT EXISTS "cash_articles" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'both',
  "is_active" BIGINT NOT NULL DEFAULT 1
);


-- table cash_docs
CREATE TABLE IF NOT EXISTS "cash_docs" (
  "id" TEXT PRIMARY KEY,
  "doc_type" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "doc_date" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "article_id" TEXT,
  "counterparty_id" TEXT,
  "comment" TEXT NOT NULL DEFAULT '',
  "posted" BIGINT NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "cash_register_id" TEXT NOT NULL DEFAULT ''
);


-- table cash_registers
CREATE TABLE IF NOT EXISTS "cash_registers" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'cash',
  "is_active" BIGINT NOT NULL DEFAULT 1,
  "organization_id" TEXT NOT NULL DEFAULT ''
);


-- table catalog_idempotency
CREATE TABLE IF NOT EXISTS "catalog_idempotency" (
  "idempotency_key" TEXT PRIMARY KEY,
  "operation" TEXT NOT NULL DEFAULT '',
  "response_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table catalog_snapshots
CREATE TABLE IF NOT EXISTS "catalog_snapshots" (
  "id" TEXT PRIMARY KEY,
  "label" TEXT NOT NULL DEFAULT '',
  "payload_json" TEXT NOT NULL,
  "product_count" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table categories
CREATE TABLE IF NOT EXISTS "categories" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "parent_id" TEXT,
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table chat_attachments
CREATE TABLE IF NOT EXISTS "chat_attachments" (
  "id" TEXT PRIMARY KEY,
  "message_id" TEXT NOT NULL,
  "s3_key" TEXT NOT NULL DEFAULT '',
  "mime" TEXT NOT NULL DEFAULT '',
  "size" BIGINT NOT NULL DEFAULT 0,
  "name" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT 'file',
  FOREIGN KEY (message_id) REFERENCES chat_messages(id)
);


-- table chat_members
CREATE TABLE IF NOT EXISTS "chat_members" (
  "chat_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "joined_at" TEXT NOT NULL DEFAULT NOW(),
  "last_read_at" TEXT NOT NULL DEFAULT '',
  "muted" BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, actor_id),
  FOREIGN KEY (chat_id) REFERENCES chats(id)
);


-- table chat_messages
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" TEXT PRIMARY KEY,
  "chat_id" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL DEFAULT '',
  "body" TEXT NOT NULL DEFAULT '',
  "reply_to_id" TEXT NOT NULL DEFAULT '',
  "forwarded_from_id" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "deleted_at" TEXT NOT NULL DEFAULT '',
  "ref_type" TEXT NOT NULL DEFAULT '',
  "ref_id" TEXT NOT NULL DEFAULT '',
  "ref_label" TEXT NOT NULL DEFAULT '',
  "ref_href" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (chat_id) REFERENCES chats(id)
);


-- table chats
CREATE TABLE IF NOT EXISTS "chats" (
  "id" TEXT PRIMARY KEY,
  "type" TEXT NOT NULL CHECK (type IN ('dm', 'group')),
  "title" TEXT NOT NULL DEFAULT '',
  "dm_key" TEXT NOT NULL DEFAULT '',
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table companies
CREATE TABLE IF NOT EXISTS "companies" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL DEFAULT '',
  "is_default" BIGINT NOT NULL DEFAULT 0,
  "is_active" BIGINT NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table company_bank_accounts
CREATE TABLE IF NOT EXISTS "company_bank_accounts" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "bank_name" TEXT NOT NULL DEFAULT '',
  "bik" TEXT NOT NULL DEFAULT '',
  "account" TEXT NOT NULL DEFAULT '',
  "currency" TEXT NOT NULL DEFAULT 'RUB',
  "is_active" BIGINT NOT NULL DEFAULT 1
);


-- table contracts
CREATE TABLE IF NOT EXISTS "contracts" (
  "id" TEXT PRIMARY KEY,
  "counterparty_id" TEXT,
  "code" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT '',
  "is_active" BIGINT NOT NULL DEFAULT 1,
  "source" TEXT NOT NULL DEFAULT 'local'
);


-- table counterparties
CREATE TABLE IF NOT EXISTS "counterparties" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "inn" TEXT DEFAULT '',
  "phone" TEXT DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT 'supplier',
  "lead_time_days" BIGINT NOT NULL DEFAULT 0,
  "is_active" BIGINT NOT NULL DEFAULT 1,
  "email" TEXT NOT NULL DEFAULT '',
  "amo_company_id" TEXT NOT NULL DEFAULT '',
  "amo_contact_id" TEXT NOT NULL DEFAULT '',
  "amo_url" TEXT NOT NULL DEFAULT '',
  "amo_entity" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT '',
  "synced_at" TEXT NOT NULL DEFAULT '',
  "kpp" TEXT NOT NULL DEFAULT '',
  "ogrn" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '',
  "name_full" TEXT NOT NULL DEFAULT '',
  "dadata_synced_at" TEXT NOT NULL DEFAULT '',
  "party_kind" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT '',
  "barcode_prefix" TEXT NOT NULL DEFAULT '',
  "director" TEXT NOT NULL DEFAULT '',
  "bank" TEXT NOT NULL DEFAULT '',
  "bik" TEXT NOT NULL DEFAULT '',
  "rs" TEXT NOT NULL DEFAULT '',
  "ks" TEXT NOT NULL DEFAULT '',
  "is_partner" BIGINT NOT NULL DEFAULT 0,
  "is_main" BIGINT NOT NULL DEFAULT 0,
  "sign_basis" TEXT NOT NULL DEFAULT ''
);


-- table counterparty_amo_links
CREATE TABLE IF NOT EXISTS "counterparty_amo_links" (
  "company_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "synced_at" TEXT NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, contact_id)
);


-- table counterparty_product_doc_names
CREATE TABLE IF NOT EXISTS "counterparty_product_doc_names" (
  "id" TEXT PRIMARY KEY,
  "counterparty_id" TEXT NOT NULL,
  "product_guid" TEXT NOT NULL DEFAULT '',
  "product_sku" TEXT NOT NULL DEFAULT '',
  "client_name" TEXT NOT NULL DEFAULT '',
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_by" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (counterparty_id) REFERENCES counterparties(id) ON DELETE CASCADE
);


-- table counterparty_vehicles
CREATE TABLE IF NOT EXISTS "counterparty_vehicles" (
  "id" TEXT PRIMARY KEY,
  "counterparty_id" TEXT NOT NULL,
  "car_plate" TEXT NOT NULL DEFAULT '',
  "car_vin" TEXT NOT NULL DEFAULT '',
  "car_year" TEXT NOT NULL DEFAULT '',
  "car_brand" TEXT NOT NULL DEFAULT '',
  "car_model" TEXT NOT NULL DEFAULT '',
  "car_color" TEXT NOT NULL DEFAULT '',
  "car_category" TEXT NOT NULL DEFAULT '',
  "car_pts" TEXT NOT NULL DEFAULT '',
  "car_owner" TEXT NOT NULL DEFAULT '',
  "car_owner_street" TEXT NOT NULL DEFAULT '',
  "car_owner_house" TEXT NOT NULL DEFAULT '',
  "car_owner_flat" TEXT NOT NULL DEFAULT '',
  "car_sts_date" TEXT NOT NULL DEFAULT '',
  "car_sts_number" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  "car_mileage" TEXT NOT NULL DEFAULT '',
  "car_generation" TEXT NOT NULL DEFAULT '',
  "last_diag_at" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (counterparty_id) REFERENCES counterparties(id) ON DELETE CASCADE
);


-- table courier_runs
CREATE TABLE IF NOT EXISTS "courier_runs" (
  "id" TEXT PRIMARY KEY,
  "sto_request_id" TEXT NOT NULL DEFAULT '',
  "warehouse_task_id" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'new',
  "title" TEXT NOT NULL DEFAULT '',
  "comment" TEXT NOT NULL DEFAULT '',
  "courier_staff_id" TEXT NOT NULL DEFAULT '',
  "created_by" TEXT NOT NULL DEFAULT '',
  "accepted_at" TEXT NOT NULL DEFAULT '',
  "picked_up_at" TEXT NOT NULL DEFAULT '',
  "delivered_at" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  "kind" TEXT NOT NULL DEFAULT 'pickup',
  "deal_id" TEXT NOT NULL DEFAULT '',
  "stock_doc_id" TEXT NOT NULL DEFAULT ''
);


-- table crm_deal_items
CREATE TABLE IF NOT EXISTS "crm_deal_items" (
  "id" TEXT PRIMARY KEY,
  "deal_id" TEXT NOT NULL,
  "product_guid" TEXT NOT NULL DEFAULT '',
  "sku" TEXT NOT NULL DEFAULT '',
  "code" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT '',
  "brand" TEXT NOT NULL DEFAULT '',
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unit" TEXT NOT NULL DEFAULT '',
  "department" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "line_no" BIGINT NOT NULL DEFAULT 0,
  "warehouse_id" TEXT NOT NULL DEFAULT '',
  "supplier_id" TEXT NOT NULL DEFAULT '',
  "in_doc_id" TEXT NOT NULL DEFAULT '',
  "mark" TEXT NOT NULL DEFAULT '',
  "model" TEXT NOT NULL DEFAULT '',
  "generation" TEXT NOT NULL DEFAULT '',
  "serials_json" TEXT NOT NULL DEFAULT '[]',
  "parent_item_id" TEXT NOT NULL DEFAULT '',
  "auto_service" BIGINT NOT NULL DEFAULT 0,
  "name_1c" TEXT NOT NULL DEFAULT '',
  "applicability_key" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (deal_id) REFERENCES crm_deals(id)
);


-- table crm_deals
CREATE TABLE IF NOT EXISTS "crm_deals" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL DEFAULT '',
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "pipeline_id" TEXT NOT NULL DEFAULT '',
  "pipeline_name" TEXT NOT NULL DEFAULT '',
  "status_id" TEXT NOT NULL DEFAULT '',
  "status_name" TEXT NOT NULL DEFAULT '',
  "responsible_user_id" TEXT NOT NULL DEFAULT '',
  "department" TEXT NOT NULL DEFAULT '',
  "queued_to_1c" BIGINT NOT NULL DEFAULT 0,
  "queue_status" TEXT NOT NULL DEFAULT '',
  "queued_by" TEXT NOT NULL DEFAULT '',
  "queued_at" TEXT,
  "amo_url" TEXT NOT NULL DEFAULT '',
  "print_url" TEXT NOT NULL DEFAULT '',
  "items_count" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT,
  "updated_at" TEXT,
  "synced_at" TEXT NOT NULL DEFAULT NOW(),
  "company_id" TEXT NOT NULL DEFAULT '',
  "company_name" TEXT NOT NULL DEFAULT '',
  "buyer_name" TEXT NOT NULL DEFAULT '',
  "buyer_inn" TEXT NOT NULL DEFAULT '',
  "buyer_phone" TEXT NOT NULL DEFAULT '',
  "buyer_kind" TEXT NOT NULL DEFAULT 'person',
  "is_legal_entity" BIGINT NOT NULL DEFAULT 0,
  "amount_locked" BIGINT NOT NULL DEFAULT 0,
  "amount_locked_at" TEXT NOT NULL DEFAULT '',
  "payment_status" TEXT NOT NULL DEFAULT '',
  "paid" BIGINT NOT NULL DEFAULT 0,
  "ship_channel" TEXT NOT NULL DEFAULT '',
  "amo_channel" TEXT NOT NULL DEFAULT '',
  "amo_shipment" TEXT NOT NULL DEFAULT '',
  "is_sto" BIGINT NOT NULL DEFAULT 0,
  "is_sto_manual" BIGINT NOT NULL DEFAULT 0,
  "car_plate" TEXT NOT NULL DEFAULT '',
  "car_vin" TEXT NOT NULL DEFAULT '',
  "car_year" TEXT NOT NULL DEFAULT '',
  "car_mileage" TEXT NOT NULL DEFAULT '',
  "org_company_id" TEXT NOT NULL DEFAULT '',
  "is_partner" BIGINT NOT NULL DEFAULT 0,
  "amo_payment_type" TEXT NOT NULL DEFAULT '',
  "amo_pay_method" TEXT NOT NULL DEFAULT '',
  "amo_sto" TEXT NOT NULL DEFAULT '',
  "car_brand" TEXT NOT NULL DEFAULT '',
  "car_model" TEXT NOT NULL DEFAULT '',
  "car_color" TEXT NOT NULL DEFAULT '',
  "car_category" TEXT NOT NULL DEFAULT '',
  "car_pts" TEXT NOT NULL DEFAULT '',
  "car_owner" TEXT NOT NULL DEFAULT '',
  "car_owner_street" TEXT NOT NULL DEFAULT '',
  "car_owner_house" TEXT NOT NULL DEFAULT '',
  "car_owner_flat" TEXT NOT NULL DEFAULT '',
  "car_sts_date" TEXT NOT NULL DEFAULT '',
  "car_sts_number" TEXT NOT NULL DEFAULT '',
  "amo_branch" TEXT NOT NULL DEFAULT '',
  "buyer_email" TEXT NOT NULL DEFAULT '',
  "buyer_address" TEXT NOT NULL DEFAULT '',
  "buyer_passport" TEXT NOT NULL DEFAULT '',
  "buyer_kpp" TEXT NOT NULL DEFAULT '',
  "buyer_ogrn" TEXT NOT NULL DEFAULT '',
  "buyer_director" TEXT NOT NULL DEFAULT '',
  "buyer_bank" TEXT NOT NULL DEFAULT '',
  "buyer_bik" TEXT NOT NULL DEFAULT '',
  "buyer_rs" TEXT NOT NULL DEFAULT '',
  "buyer_ks" TEXT NOT NULL DEFAULT '',
  "money_refunded_at" TEXT NOT NULL DEFAULT '',
  "money_refunded_by" TEXT NOT NULL DEFAULT '',
  "money_refunded_by_name" TEXT NOT NULL DEFAULT '',
  "amo_client_complaint" TEXT NOT NULL DEFAULT '',
  "car_brought_by" TEXT NOT NULL DEFAULT '',
  "car_authority_basis" TEXT NOT NULL DEFAULT '',
  "car_authority_details" TEXT NOT NULL DEFAULT '',
  "buyer_vat" TEXT NOT NULL DEFAULT '',
  "buyer_vat_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "car_fuel_level" TEXT NOT NULL DEFAULT '',
  "car_keys_count" TEXT NOT NULL DEFAULT '',
  "car_docs_left" TEXT NOT NULL DEFAULT '',
  "car_docs_note" TEXT NOT NULL DEFAULT '',
  "car_damage_notes" TEXT NOT NULL DEFAULT '',
  "car_completeness" TEXT NOT NULL DEFAULT '',
  "car_completeness_other" TEXT NOT NULL DEFAULT '',
  "client_role" TEXT NOT NULL DEFAULT 'client',
  "amo_contact_id" TEXT NOT NULL DEFAULT '',
  "amo_contact_ids" TEXT NOT NULL DEFAULT ''
);


-- table crm_events
CREATE TABLE IF NOT EXISTS "crm_events" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL DEFAULT 'note',
  "title" TEXT NOT NULL,
  "deal_id" TEXT,
  "counterparty_id" TEXT,
  "event_at" TEXT NOT NULL,
  "comment" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table crm_pipeline_statuses
CREATE TABLE IF NOT EXISTS "crm_pipeline_statuses" (
  "id" TEXT PRIMARY KEY,
  "pipeline_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sort" BIGINT NOT NULL DEFAULT 0,
  "color" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (pipeline_id) REFERENCES crm_pipelines(id)
);


-- table crm_pipelines
CREATE TABLE IF NOT EXISTS "crm_pipelines" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "sort" BIGINT NOT NULL DEFAULT 0,
  "is_archive" BIGINT NOT NULL DEFAULT 0
);


-- table crm_tasks
CREATE TABLE IF NOT EXISTS "crm_tasks" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "due_at" TEXT,
  "deal_id" TEXT,
  "comment" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "assignee_amo_id" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT '',
  "payment_link_id" TEXT NOT NULL DEFAULT ''
);


-- table crpt_outbox
CREATE TABLE IF NOT EXISTS "crpt_outbox" (
  "id" TEXT PRIMARY KEY,
  "code_id" TEXT NOT NULL DEFAULT '',
  "operation" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "payload_json" TEXT NOT NULL DEFAULT '{}',
  "error" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "sent_at" TEXT NOT NULL DEFAULT ''
);


-- table currencies
CREATE TABLE IF NOT EXISTS "currencies" (
  "code" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL DEFAULT '',
  "symbol" TEXT NOT NULL DEFAULT '',
  "numeric_code" TEXT NOT NULL DEFAULT '',
  "is_active" BIGINT NOT NULL DEFAULT 1,
  "sort_order" BIGINT NOT NULL DEFAULT 100,
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  "alt_code" TEXT NOT NULL DEFAULT '',
  "rate_mode" TEXT NOT NULL DEFAULT 'manual',
  "linked_code" TEXT NOT NULL DEFAULT '',
  "linked_markup_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "formula" TEXT NOT NULL DEFAULT '',
  "spell_unit_1" TEXT NOT NULL DEFAULT '',
  "spell_unit_2" TEXT NOT NULL DEFAULT '',
  "spell_unit_5" TEXT NOT NULL DEFAULT '',
  "spell_frac_1" TEXT NOT NULL DEFAULT '',
  "spell_frac_2" TEXT NOT NULL DEFAULT '',
  "spell_frac_5" TEXT NOT NULL DEFAULT ''
);


-- table currency_rates
CREATE TABLE IF NOT EXISTS "currency_rates" (
  "id" TEXT PRIMARY KEY,
  "base_code" TEXT NOT NULL DEFAULT 'RUB',
  "quote_code" TEXT NOT NULL,
  "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rate_date" TEXT NOT NULL DEFAULT (date('now')),
  "source" TEXT NOT NULL DEFAULT 'manual',
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table datamatrix_aggregates
CREATE TABLE IF NOT EXISTS "datamatrix_aggregates" (
  "id" TEXT PRIMARY KEY,
  "parent_code" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'active',
  "codes_count" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table datamatrix_codes
CREATE TABLE IF NOT EXISTS "datamatrix_codes" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "product_id" TEXT NOT NULL,
  "lot_id" TEXT NOT NULL DEFAULT '',
  "gtin" TEXT NOT NULL DEFAULT '',
  "serial" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'received',
  "aggregate_id" TEXT NOT NULL DEFAULT '',
  "warehouse_id" TEXT NOT NULL DEFAULT '',
  "deal_id" TEXT NOT NULL DEFAULT '',
  "stock_doc_id" TEXT NOT NULL DEFAULT '',
  "scanned_at" TEXT NOT NULL DEFAULT '',
  "withdrawn_at" TEXT NOT NULL DEFAULT '',
  "meta_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  FOREIGN KEY (product_id) REFERENCES products(id)
);


-- table deal_payments
CREATE TABLE IF NOT EXISTS "deal_payments" (
  "id" TEXT PRIMARY KEY,
  "deal_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'sbp_qr',
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'created',
  "qrc_id" TEXT NOT NULL DEFAULT '',
  "payload" TEXT NOT NULL DEFAULT '',
  "image_png_base64" TEXT NOT NULL DEFAULT '',
  "account" TEXT NOT NULL DEFAULT '',
  "purpose" TEXT NOT NULL DEFAULT '',
  "meta_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  FOREIGN KEY (deal_id) REFERENCES crm_deals(id)
);


-- table dev_plan_comments
CREATE TABLE IF NOT EXISTS "dev_plan_comments" (
  "id" TEXT PRIMARY KEY,
  "item_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'note',
  "body" TEXT NOT NULL DEFAULT '',
  "old_start" TEXT NOT NULL DEFAULT '',
  "old_end" TEXT NOT NULL DEFAULT '',
  "new_start" TEXT NOT NULL DEFAULT '',
  "new_end" TEXT NOT NULL DEFAULT '',
  "author_staff_id" TEXT NOT NULL DEFAULT '',
  "author_name" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table dev_plan_deps
CREATE TABLE IF NOT EXISTS "dev_plan_deps" (
  "id" TEXT PRIMARY KEY,
  "item_id" TEXT NOT NULL,
  "depends_on_id" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  UNIQUE(item_id, depends_on_id)
);


-- table dev_plan_items
CREATE TABLE IF NOT EXISTS "dev_plan_items" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "result_plan" TEXT NOT NULL DEFAULT '',
  "result_fact" TEXT NOT NULL DEFAULT '',
  constraint_text TEXT NOT NULL DEFAULT '',
  "start_date" TEXT NOT NULL DEFAULT '',
  "end_date" TEXT NOT NULL DEFAULT '',
  "responsible_staff_id" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'planned',
  "sort_order" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  "block_key" TEXT NOT NULL DEFAULT 'sales',
  "block_title" TEXT NOT NULL DEFAULT 'Продажи',
  "block_sort" BIGINT NOT NULL DEFAULT 10
);


-- table dict_brands
CREATE TABLE IF NOT EXISTS "dict_brands" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "products_count" BIGINT NOT NULL DEFAULT 0
);


-- table dict_generations
CREATE TABLE IF NOT EXISTS "dict_generations" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "products_count" BIGINT NOT NULL DEFAULT 0
);


-- table dict_marks
CREATE TABLE IF NOT EXISTS "dict_marks" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "products_count" BIGINT NOT NULL DEFAULT 0
);


-- table dict_models
CREATE TABLE IF NOT EXISTS "dict_models" (
  "id" TEXT PRIMARY KEY,
  "mark_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "only_model" TEXT DEFAULT '',
  "products_count" BIGINT NOT NULL DEFAULT 0,
  FOREIGN KEY (mark_id) REFERENCES dict_marks(id)
);


-- table dict_price_types
CREATE TABLE IF NOT EXISTS "dict_price_types" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "products_count" BIGINT NOT NULL DEFAULT 0
);


-- table dict_properties
CREATE TABLE IF NOT EXISTS "dict_properties" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "products_count" BIGINT NOT NULL DEFAULT 0
);


-- table dict_property_values
CREATE TABLE IF NOT EXISTS "dict_property_values" (
  "id" TEXT PRIMARY KEY,
  "property_id" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "products_count" BIGINT NOT NULL DEFAULT 0,
  FOREIGN KEY (property_id) REFERENCES dict_properties(id)
);


-- table employees
CREATE TABLE IF NOT EXISTS "employees" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT DEFAULT '',
  "name" TEXT NOT NULL
);


-- table feedback_items
CREATE TABLE IF NOT EXISTS "feedback_items" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL DEFAULT 'idea',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "author" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'new',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table fiscal_receipts
CREATE TABLE IF NOT EXISTS "fiscal_receipts" (
  "id" TEXT PRIMARY KEY,
  "deal_id" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL,
  "external_id" TEXT NOT NULL DEFAULT '',
  "atol_uuid" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'prepared',
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "payload_json" TEXT NOT NULL DEFAULT '{}',
  "result_json" TEXT NOT NULL DEFAULT '{}',
  "error" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  "parent_receipt_id" TEXT NOT NULL DEFAULT ''
);


-- table gtd_numbers
CREATE TABLE IF NOT EXISTS "gtd_numbers" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT 'local',
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table hr_docs
CREATE TABLE IF NOT EXISTS "hr_docs" (
  "id" TEXT PRIMARY KEY,
  "doc_type" TEXT NOT NULL DEFAULT 'hire',
  "number" TEXT NOT NULL,
  "doc_date" TEXT NOT NULL,
  "person_name" TEXT NOT NULL DEFAULT '',
  "comment" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table income_mirror
CREATE TABLE IF NOT EXISTS "income_mirror" (
  "id" TEXT PRIMARY KEY,
  "task_id" TEXT NOT NULL DEFAULT '',
  "deal_id" TEXT NOT NULL DEFAULT '',
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "channel" TEXT NOT NULL DEFAULT '',
  "city" TEXT NOT NULL DEFAULT '',
  "buyer_name" TEXT NOT NULL DEFAULT '',
  "track_number" TEXT NOT NULL DEFAULT '',
  "source" TEXT NOT NULL DEFAULT '',
  "actor_id" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table integration_api_keys
CREATE TABLE IF NOT EXISTS "integration_api_keys" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL DEFAULT '',
  "key_hash" TEXT NOT NULL UNIQUE,
  "key_prefix" TEXT NOT NULL DEFAULT '',
  "key_hint" TEXT NOT NULL DEFAULT '',
  "scopes" TEXT NOT NULL DEFAULT 'all',
  "is_active" BIGINT NOT NULL DEFAULT 1,
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "last_used_at" TEXT NOT NULL DEFAULT '',
  "revoked_at" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "staff_id" TEXT NOT NULL DEFAULT ''
);


-- table inventory_sheet_lines
CREATE TABLE IF NOT EXISTS "inventory_sheet_lines" (
  "id" TEXT PRIMARY KEY,
  "sheet_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "system_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "counted_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  FOREIGN KEY (sheet_id) REFERENCES inventory_sheets(id) ON DELETE CASCADE
);


-- table inventory_sheets
CREATE TABLE IF NOT EXISTS "inventory_sheets" (
  "id" TEXT PRIMARY KEY,
  "number" TEXT NOT NULL,
  "doc_date" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "comment" TEXT NOT NULL DEFAULT '',
  "posted" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table ip_geo_cache
CREATE TABLE IF NOT EXISTS "ip_geo_cache" (
  "ip" TEXT PRIMARY KEY,
  "region" TEXT NOT NULL DEFAULT '',
  "country" TEXT NOT NULL DEFAULT '',
  "fetched_at" TEXT NOT NULL DEFAULT NOW()
);


-- table job_titles
CREATE TABLE IF NOT EXISTS "job_titles" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "is_active" BIGINT NOT NULL DEFAULT 1
);


-- table marketplace_orders
CREATE TABLE IF NOT EXISTS "marketplace_orders" (
  "id" TEXT PRIMARY KEY,
  "channel" TEXT NOT NULL,
  "external_id" TEXT NOT NULL DEFAULT '',
  "number" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'new',
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ordered_at" TEXT NOT NULL DEFAULT '',
  "comment" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table marking_events
CREATE TABLE IF NOT EXISTS "marking_events" (
  "id" TEXT PRIMARY KEY,
  "code_id" TEXT,
  "lot_id" TEXT,
  "event" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL DEFAULT '',
  "payload_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table meta
CREATE TABLE IF NOT EXISTS "meta" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);


-- table money_transfers
CREATE TABLE IF NOT EXISTS "money_transfers" (
  "id" TEXT PRIMARY KEY,
  "number" TEXT NOT NULL,
  "doc_date" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "from_name" TEXT NOT NULL DEFAULT '',
  "to_name" TEXT NOT NULL DEFAULT '',
  "comment" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table nomen_catalog_sheet
CREATE TABLE IF NOT EXISTS "nomen_catalog_sheet" (
  "id" TEXT PRIMARY KEY,
  "group_name" TEXT NOT NULL DEFAULT '',
  "category" TEXT NOT NULL DEFAULT '',
  "mraer" TEXT NOT NULL DEFAULT '',
  "oem" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT '',
  "code" TEXT NOT NULL DEFAULT '',
  "articles" TEXT NOT NULL DEFAULT '',
  "models" TEXT NOT NULL DEFAULT '',
  "brand" TEXT NOT NULL DEFAULT '',
  "product_id" TEXT NOT NULL DEFAULT '',
  "match_status" TEXT NOT NULL DEFAULT 'pending',
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  "supplier" TEXT NOT NULL DEFAULT '',
  "attrs_json" TEXT NOT NULL DEFAULT ''
);


-- table order_status_types
CREATE TABLE IF NOT EXISTS "order_status_types" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'sales',
  "sort_order" BIGINT NOT NULL DEFAULT 0,
  "is_active" BIGINT NOT NULL DEFAULT 1
);


-- table organizations
CREATE TABLE IF NOT EXISTS "organizations" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL,
  "short_name" TEXT NOT NULL DEFAULT '',
  "inn" TEXT NOT NULL DEFAULT '',
  "kpp" TEXT NOT NULL DEFAULT '',
  "ogrnip" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "bank" TEXT NOT NULL DEFAULT '',
  "bik" TEXT NOT NULL DEFAULT '',
  "rs" TEXT NOT NULL DEFAULT '',
  "ks" TEXT NOT NULL DEFAULT '',
  "director" TEXT NOT NULL DEFAULT '',
  "accountant" TEXT NOT NULL DEFAULT '',
  "master_title" TEXT NOT NULL DEFAULT '',
  "vat_rate" DOUBLE PRECISION NOT NULL DEFAULT 5,
  "is_default" BIGINT NOT NULL DEFAULT 0,
  "is_active" BIGINT NOT NULL DEFAULT 1,
  "source" TEXT NOT NULL DEFAULT 'local',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  "company_id" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "site_address" TEXT NOT NULL DEFAULT '',
  "work_hours" TEXT NOT NULL DEFAULT ''
);


-- table payment_links
CREATE TABLE IF NOT EXISTS "payment_links" (
  "id" TEXT PRIMARY KEY,
  "token" TEXT NOT NULL UNIQUE,
  "deal_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expires_at" TEXT NOT NULL,
  "timer_minutes" BIGINT NOT NULL DEFAULT 30,
  "payment_id" TEXT NOT NULL DEFAULT '',
  "acquiring_url" TEXT NOT NULL DEFAULT '',
  "acquiring_error" TEXT NOT NULL DEFAULT '',
  "meta_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "paid_at" TEXT,
  "expired_at" TEXT,
  "organization_id" TEXT NOT NULL DEFAULT '',
  "yandex_pay_url" TEXT NOT NULL DEFAULT '',
  "yandex_order_id" TEXT NOT NULL DEFAULT '',
  "yandex_pay_error" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (deal_id) REFERENCES crm_deals(id)
);


-- table payment_orders
CREATE TABLE IF NOT EXISTS "payment_orders" (
  "id" TEXT PRIMARY KEY,
  "number" TEXT NOT NULL,
  "doc_date" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "payee" TEXT NOT NULL DEFAULT '',
  "purpose" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table payment_plan
CREATE TABLE IF NOT EXISTS "payment_plan" (
  "id" TEXT PRIMARY KEY,
  "plan_date" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'out',
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "counterparty" TEXT NOT NULL DEFAULT '',
  "comment" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'planned',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table payroll_lines
CREATE TABLE IF NOT EXISTS "payroll_lines" (
  "id" TEXT PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "staff_id" TEXT NOT NULL DEFAULT '',
  "person_name" TEXT NOT NULL DEFAULT '',
  "position" TEXT NOT NULL DEFAULT '',
  "salary_base" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "days_worked" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "days_norm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "accrued" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ndfl" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "contrib_pfr" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "contrib_foms" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "contrib_fss" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "contrib_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "net_pay" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "notes" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE
);


-- table payroll_runs
CREATE TABLE IF NOT EXISTS "payroll_runs" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "year" BIGINT NOT NULL,
  "month" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "accrued_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ndfl_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "contrib_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "net_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "notes" TEXT NOT NULL DEFAULT '',
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "posted_at" TEXT NOT NULL DEFAULT '',
  UNIQUE(organization_id, year, month)
);


-- table pdn_sign_events
CREATE TABLE IF NOT EXISTS "pdn_sign_events" (
  "id" TEXT PRIMARY KEY,
  "session_id" TEXT NOT NULL,
  "deal_id" TEXT NOT NULL DEFAULT '',
  "event" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "ip" TEXT NOT NULL DEFAULT '',
  "user_agent" TEXT NOT NULL DEFAULT '',
  "os" TEXT NOT NULL DEFAULT '',
  "browser" TEXT NOT NULL DEFAULT '',
  "device" TEXT NOT NULL DEFAULT '',
  "region" TEXT NOT NULL DEFAULT '',
  "country" TEXT NOT NULL DEFAULT '',
  "accept_language" TEXT NOT NULL DEFAULT '',
  "meta_json" TEXT NOT NULL DEFAULT ''
);


-- table pdn_sign_sessions
CREATE TABLE IF NOT EXISTS "pdn_sign_sessions" (
  "id" TEXT PRIMARY KEY,
  "token" TEXT NOT NULL UNIQUE,
  "deal_id" TEXT NOT NULL,
  "phone" TEXT NOT NULL DEFAULT '',
  "buyer_name" TEXT NOT NULL DEFAULT '',
  "org_name" TEXT NOT NULL DEFAULT '',
  "org_inn" TEXT NOT NULL DEFAULT '',
  "sender" TEXT NOT NULL DEFAULT 'Pnevmo1',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "consent_text" TEXT NOT NULL DEFAULT '',
  "consent_sha256" TEXT NOT NULL DEFAULT '',
  "link_url" TEXT NOT NULL DEFAULT '',
  "link_sms_id" TEXT NOT NULL DEFAULT '',
  "code_hash" TEXT NOT NULL DEFAULT '',
  "code_salt" TEXT NOT NULL DEFAULT '',
  "code_sms_id" TEXT NOT NULL DEFAULT '',
  "code_sent_at" TEXT NOT NULL DEFAULT '',
  "code_attempts" BIGINT NOT NULL DEFAULT 0,
  "signed_at" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "created_by" TEXT NOT NULL DEFAULT '',
  "expires_at" TEXT NOT NULL DEFAULT '',
  "meta_json" TEXT NOT NULL DEFAULT '',
  "identity_json" TEXT NOT NULL DEFAULT ''
);


-- table photo_shifts
CREATE TABLE IF NOT EXISTS "photo_shifts" (
  "id" TEXT PRIMARY KEY,
  "staff_id" TEXT NOT NULL,
  "staff_name" TEXT NOT NULL DEFAULT '',
  "staff_login" TEXT NOT NULL DEFAULT '',
  "day" TEXT NOT NULL DEFAULT '',
  "started_at" TEXT NOT NULL,
  "ended_at" TEXT NOT NULL DEFAULT '',
  "products_done" BIGINT NOT NULL DEFAULT 0,
  "photos_uploaded" BIGINT NOT NULL DEFAULT 0,
  "files_uploaded" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table pick_shifts
CREATE TABLE IF NOT EXISTS "pick_shifts" (
  "id" TEXT PRIMARY KEY,
  "staff_id" TEXT NOT NULL,
  "staff_name" TEXT NOT NULL DEFAULT '',
  "staff_login" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT 'day',
  "day" TEXT NOT NULL DEFAULT '',
  "started_at" TEXT NOT NULL,
  "ended_at" TEXT NOT NULL DEFAULT '',
  "pin_verified_at" TEXT NOT NULL DEFAULT '',
  "last_activity_at" TEXT NOT NULL DEFAULT '',
  "auto_started" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table product_alt_codes
CREATE TABLE IF NOT EXISTS "product_alt_codes" (
  "id" TEXT PRIMARY KEY,
  "product_id" TEXT NOT NULL,
  "code_type" TEXT NOT NULL DEFAULT 'other',
  "value" TEXT NOT NULL,
  "supplier" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "source_product_id" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  FOREIGN KEY (product_id) REFERENCES products(id)
);


-- table product_applicability
CREATE TABLE IF NOT EXISTS "product_applicability" (
  "id" TEXT PRIMARY KEY,
  "product_id" TEXT NOT NULL,
  "mark" TEXT DEFAULT '',
  "model" TEXT DEFAULT '',
  "only_model" TEXT DEFAULT '',
  "generation" TEXT DEFAULT '',
  "years" TEXT DEFAULT '',
  FOREIGN KEY (product_id) REFERENCES products(id)
);


-- table product_code_masters
CREATE TABLE IF NOT EXISTS "product_code_masters" (
  "code" TEXT PRIMARY KEY,
  "code_type" TEXT NOT NULL DEFAULT '',
  "master_mraer" TEXT NOT NULL DEFAULT '',
  "master_nf" TEXT NOT NULL DEFAULT '',
  "master_name" TEXT NOT NULL DEFAULT '',
  "master_product_id" TEXT NOT NULL DEFAULT '',
  "category" TEXT NOT NULL DEFAULT '',
  "conflict" TEXT NOT NULL DEFAULT '',
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table product_dedup_groups
CREATE TABLE IF NOT EXISTS "product_dedup_groups" (
  "group_no" TEXT PRIMARY KEY,
  "master_product_id" TEXT NOT NULL DEFAULT '',
  "master_sku" TEXT NOT NULL DEFAULT '',
  "master_nf" TEXT NOT NULL DEFAULT '',
  "master_article" TEXT NOT NULL DEFAULT '',
  "merged_oe" TEXT NOT NULL DEFAULT '',
  "member_count" BIGINT NOT NULL DEFAULT 0,
  "matched_count" BIGINT NOT NULL DEFAULT 0,
  "missing_count" BIGINT NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'sheet',
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table product_dedup_members
CREATE TABLE IF NOT EXISTS "product_dedup_members" (
  "id" TEXT PRIMARY KEY,
  "group_no" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT '',
  "article" TEXT NOT NULL DEFAULT '',
  "nf_code" TEXT NOT NULL DEFAULT '',
  "supplier" TEXT NOT NULL DEFAULT '',
  "category" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT '',
  "oe_card" TEXT NOT NULL DEFAULT '',
  "merged_oe" TEXT NOT NULL DEFAULT '',
  "product_id" TEXT NOT NULL DEFAULT '',
  "match_status" TEXT NOT NULL DEFAULT 'pending',
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  "attrs_json" TEXT NOT NULL DEFAULT ''
);


-- table product_lots
CREATE TABLE IF NOT EXISTS "product_lots" (
  "id" TEXT PRIMARY KEY,
  "product_id" TEXT NOT NULL,
  "lot_number" TEXT NOT NULL,
  "factory" TEXT NOT NULL DEFAULT '',
  "production_date" TEXT NOT NULL DEFAULT '',
  "arrived_at" TEXT NOT NULL DEFAULT '',
  "warehouse_id" TEXT NOT NULL DEFAULT '',
  "gtin" TEXT NOT NULL DEFAULT '',
  "qty_planned" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "qty_received" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "comment" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  FOREIGN KEY (product_id) REFERENCES products(id)
);


-- table product_media
CREATE TABLE IF NOT EXISTS "product_media" (
  "id" TEXT PRIMARY KEY,
  "product_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'image',
  "mime" TEXT NOT NULL DEFAULT '',
  "ext" TEXT NOT NULL DEFAULT '',
  "s3_key" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "size" BIGINT NOT NULL DEFAULT 0,
  "sha256" TEXT NOT NULL DEFAULT '',
  "sort_order" BIGINT NOT NULL DEFAULT 0,
  "synced_at" TEXT NOT NULL DEFAULT NOW(),
  "width" BIGINT NOT NULL DEFAULT 0,
  "height" BIGINT NOT NULL DEFAULT 0,
  "orientation" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (product_id) REFERENCES products(id)
);


-- table product_merge_map
CREATE TABLE IF NOT EXISTS "product_merge_map" (
  "master_product_id" TEXT NOT NULL,
  "source_product_id" TEXT NOT NULL,
  "merged_at" TEXT NOT NULL DEFAULT NOW(),
  "comment" TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (master_product_id, source_product_id)
);


-- table product_price_merge_log
CREATE TABLE IF NOT EXISTS "product_price_merge_log" (
  "id" TEXT PRIMARY KEY,
  "master_product_id" TEXT NOT NULL,
  "source_product_id" TEXT NOT NULL,
  "price_type" TEXT NOT NULL,
  "master_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "source_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "action" TEXT NOT NULL DEFAULT 'kept_master',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table product_prices
CREATE TABLE IF NOT EXISTS "product_prices" (
  "id" TEXT PRIMARY KEY,
  "product_id" TEXT NOT NULL,
  "price_type" TEXT NOT NULL,
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES products(id)
);


-- table product_properties
CREATE TABLE IF NOT EXISTS "product_properties" (
  "id" TEXT PRIMARY KEY,
  "product_id" TEXT NOT NULL,
  "property" TEXT NOT NULL,
  "value" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (product_id) REFERENCES products(id)
);


-- table product_related
CREATE TABLE IF NOT EXISTS "product_related" (
  "product_id" TEXT NOT NULL,
  "related_id" TEXT NOT NULL,
  PRIMARY KEY (product_id, related_id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);


-- table product_service_links
CREATE TABLE IF NOT EXISTS "product_service_links" (
  "id" TEXT PRIMARY KEY,
  "product_id" TEXT NOT NULL,
  "service_product_id" TEXT NOT NULL DEFAULT '',
  "role" TEXT NOT NULL DEFAULT 'install',
  "price_override" DOUBLE PRECISION,
  "qty_mode" TEXT NOT NULL DEFAULT 'same',
  "auto_add" BIGINT NOT NULL DEFAULT 1,
  "sort_order" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, service_product_id, role)
);


-- table product_store_rests
CREATE TABLE IF NOT EXISTS "product_store_rests" (
  "product_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, warehouse_id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);


-- table product_supplier_lots
CREATE TABLE IF NOT EXISTS "product_supplier_lots" (
  "id" TEXT PRIMARY KEY,
  "product_id" TEXT NOT NULL,
  "master_sku" TEXT NOT NULL,
  "fact_sku" TEXT NOT NULL,
  "supplier" TEXT NOT NULL DEFAULT '',
  "warehouse_id" TEXT NOT NULL DEFAULT '',
  "warehouse_name" TEXT NOT NULL DEFAULT '',
  "cell_code" TEXT NOT NULL DEFAULT '',
  "supply" TEXT NOT NULL DEFAULT '',
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "oe" TEXT NOT NULL DEFAULT '',
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "how_found" TEXT NOT NULL DEFAULT '',
  "sheet_row" BIGINT NOT NULL DEFAULT 0,
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table product_units
CREATE TABLE IF NOT EXISTS "product_units" (
  "id" TEXT PRIMARY KEY,
  "product_id" TEXT NOT NULL,
  "serial" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'in_stock',
  "in_doc_id" TEXT NOT NULL DEFAULT '',
  "in_line_id" TEXT NOT NULL DEFAULT '',
  "out_doc_id" TEXT NOT NULL DEFAULT '',
  "out_line_id" TEXT NOT NULL DEFAULT '',
  "comment" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  "apps_json" TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (product_id) REFERENCES products(id)
);


-- table production_job_events
CREATE TABLE IF NOT EXISTS "production_job_events" (
  "id" TEXT PRIMARY KEY,
  "job_id" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL DEFAULT '',
  "payload_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table production_job_lines
CREATE TABLE IF NOT EXISTS "production_job_lines" (
  "id" TEXT PRIMARY KEY,
  "job_id" TEXT NOT NULL,
  "line_no" BIGINT NOT NULL DEFAULT 1,
  "direction" TEXT NOT NULL CHECK(direction IN ('consume','produce')),
  "product_id" TEXT NOT NULL,
  "sku" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT '',
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "cell_code" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (job_id) REFERENCES production_jobs(id) ON DELETE CASCADE
);


-- table production_jobs
CREATE TABLE IF NOT EXISTS "production_jobs" (
  "id" TEXT PRIMARY KEY,
  "number" TEXT NOT NULL UNIQUE,
  "doc_date" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'assemble',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "deal_id" TEXT NOT NULL DEFAULT '',
  "warehouse_id" TEXT NOT NULL DEFAULT '',
  "prod_warehouse_id" TEXT NOT NULL DEFAULT '',
  "comment" TEXT NOT NULL DEFAULT '',
  "send_transfer_id" TEXT NOT NULL DEFAULT '',
  "receive_out_id" TEXT NOT NULL DEFAULT '',
  "receive_in_id" TEXT NOT NULL DEFAULT '',
  "send_task_id" TEXT NOT NULL DEFAULT '',
  "receive_task_id" TEXT NOT NULL DEFAULT '',
  "done_at" TEXT NOT NULL DEFAULT '',
  "received_at" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table production_orders
CREATE TABLE IF NOT EXISTS "production_orders" (
  "id" TEXT PRIMARY KEY,
  "number" TEXT NOT NULL,
  "doc_date" TEXT NOT NULL,
  "product_name" TEXT NOT NULL DEFAULT '',
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "comment" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table products
CREATE TABLE IF NOT EXISTS "products" (
  "id" TEXT PRIMARY KEY,
  "sku" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "category_id" TEXT,
  "unit_id" TEXT NOT NULL,
  "barcode" TEXT DEFAULT '',
  "is_active" BIGINT NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "brand" TEXT DEFAULT '',
  "code" TEXT DEFAULT '',
  "array_sku" TEXT DEFAULT '',
  "notupload" BIGINT NOT NULL DEFAULT 0,
  "package_width_cm" DOUBLE PRECISION,
  "package_height_cm" DOUBLE PRECISION,
  "package_length_cm" DOUBLE PRECISION,
  "package_weight_g" DOUBLE PRECISION,
  "hs_category_id" TEXT DEFAULT '',
  "measurement_unit" TEXT DEFAULT '',
  "gtin" TEXT NOT NULL DEFAULT '',
  "requires_marking" BIGINT NOT NULL DEFAULT 0,
  "min_stock" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "serial_tracked" BIGINT NOT NULL DEFAULT 0,
  "item_kind" TEXT NOT NULL DEFAULT 'product',
  "install_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "price_min" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "price_max" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "dedup_role" TEXT NOT NULL DEFAULT '',
  "master_product_id" TEXT NOT NULL DEFAULT '',
  "dedup_group" TEXT NOT NULL DEFAULT '',
  "sheet_supplier" TEXT NOT NULL DEFAULT '',
  "is_main" BIGINT NOT NULL DEFAULT 0,
  "warehouse_sku" TEXT NOT NULL DEFAULT '',
  "source_department" TEXT NOT NULL DEFAULT '',
  "catalog_guid" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (unit_id) REFERENCES units(id)
);


-- table purchase_basket_lines
CREATE TABLE IF NOT EXISTS "purchase_basket_lines" (
  "id" TEXT PRIMARY KEY,
  "basket_id" TEXT NOT NULL,
  "import_row_id" TEXT NOT NULL DEFAULT '',
  "product_id" TEXT NOT NULL DEFAULT '',
  "article" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT '',
  "brand" TEXT NOT NULL DEFAULT '',
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'RUB',
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "barcode" TEXT NOT NULL DEFAULT '',
  "oem" TEXT NOT NULL DEFAULT '',
  "crosses" TEXT NOT NULL DEFAULT '',
  "applicability" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  FOREIGN KEY (basket_id) REFERENCES purchase_baskets(id) ON DELETE CASCADE
);


-- table purchase_baskets
CREATE TABLE IF NOT EXISTS "purchase_baskets" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL DEFAULT '',
  "supplier_id" TEXT NOT NULL DEFAULT '',
  "supplier_name" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'open',
  "notes" TEXT NOT NULL DEFAULT '',
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table purchase_discrepancy_acts
CREATE TABLE IF NOT EXISTS "purchase_discrepancy_acts" (
  "id" TEXT PRIMARY KEY,
  "number" TEXT NOT NULL UNIQUE,
  "inbound_doc_id" TEXT NOT NULL DEFAULT '',
  "supplier_order_id" TEXT NOT NULL DEFAULT '',
  "supply_number" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "comment" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table purchase_discrepancy_lines
CREATE TABLE IF NOT EXISTS "purchase_discrepancy_lines" (
  "id" TEXT PRIMARY KEY,
  "act_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT 'qty_diff',
  "qty_supply" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "qty_inbound" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "qty_diff" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "note" TEXT NOT NULL DEFAULT '',
  "sort_order" BIGINT NOT NULL DEFAULT 0,
  FOREIGN KEY (act_id) REFERENCES purchase_discrepancy_acts(id) ON DELETE CASCADE
);


-- table purchase_drive_files
CREATE TABLE IF NOT EXISTS "purchase_drive_files" (
  "id" TEXT PRIMARY KEY,
  "drive_file_id" TEXT NOT NULL UNIQUE,
  "drive_folder_id" TEXT NOT NULL DEFAULT '',
  "folder_row_id" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT '',
  "mime_type" TEXT NOT NULL DEFAULT '',
  "md5" TEXT NOT NULL DEFAULT '',
  "modified_at" TEXT NOT NULL DEFAULT '',
  "size_bytes" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'seen',
  "import_id" TEXT NOT NULL DEFAULT '',
  "error" TEXT NOT NULL DEFAULT '',
  "first_seen_at" TEXT NOT NULL DEFAULT NOW(),
  "imported_at" TEXT NOT NULL DEFAULT ''
);


-- table purchase_drive_folders
CREATE TABLE IF NOT EXISTS "purchase_drive_folders" (
  "id" TEXT PRIMARY KEY,
  "drive_folder_id" TEXT NOT NULL UNIQUE,
  "folder_name" TEXT NOT NULL DEFAULT '',
  "supplier_id" TEXT NOT NULL DEFAULT '',
  "supplier_name" TEXT NOT NULL DEFAULT '',
  "is_active" BIGINT NOT NULL DEFAULT 1,
  "notes" TEXT NOT NULL DEFAULT '',
  "last_seen_at" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table purchase_price_history
CREATE TABLE IF NOT EXISTS "purchase_price_history" (
  "id" TEXT PRIMARY KEY,
  "supplier_id" TEXT NOT NULL DEFAULT '',
  "article" TEXT NOT NULL DEFAULT '',
  "brand" TEXT NOT NULL DEFAULT '',
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'RUB',
  "observed_at" TEXT NOT NULL DEFAULT NOW(),
  "import_id" TEXT NOT NULL DEFAULT '',
  "source_file" TEXT NOT NULL DEFAULT ''
);


-- table purchase_price_imports
CREATE TABLE IF NOT EXISTS "purchase_price_imports" (
  "id" TEXT PRIMARY KEY,
  "supplier_id" TEXT NOT NULL DEFAULT '',
  "supplier_name" TEXT NOT NULL DEFAULT '',
  "filename" TEXT NOT NULL DEFAULT '',
  "sheet_name" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'uploaded',
  "column_map_json" TEXT NOT NULL DEFAULT '{}',
  "header_row" BIGINT NOT NULL DEFAULT 1,
  "notes" TEXT NOT NULL DEFAULT '',
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "parsed_at" TEXT NOT NULL DEFAULT '',
  "row_count" BIGINT NOT NULL DEFAULT 0,
  "new_count" BIGINT NOT NULL DEFAULT 0,
  "changed_count" BIGINT NOT NULL DEFAULT 0,
  "matched_count" BIGINT NOT NULL DEFAULT 0,
  "drive_file_id" TEXT NOT NULL DEFAULT '',
  "drive_folder_id" TEXT NOT NULL DEFAULT ''
);


-- table purchase_price_rows
CREATE TABLE IF NOT EXISTS "purchase_price_rows" (
  "id" TEXT PRIMARY KEY,
  "import_id" TEXT NOT NULL,
  "row_no" BIGINT NOT NULL DEFAULT 0,
  "raw_json" TEXT NOT NULL DEFAULT '[]',
  "article" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT '',
  "brand" TEXT NOT NULL DEFAULT '',
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'RUB',
  "barcode" TEXT NOT NULL DEFAULT '',
  "oem" TEXT NOT NULL DEFAULT '',
  "crosses" TEXT NOT NULL DEFAULT '',
  "applicability" TEXT NOT NULL DEFAULT '',
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "match_status" TEXT NOT NULL DEFAULT 'pending',
  "match_product_id" TEXT NOT NULL DEFAULT '',
  "match_sku" TEXT NOT NULL DEFAULT '',
  "old_price" DOUBLE PRECISION,
  "price_delta" DOUBLE PRECISION,
  "picture_path" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (import_id) REFERENCES purchase_price_imports(id) ON DELETE CASCADE
);


-- table sales_doc_lines
CREATE TABLE IF NOT EXISTS "sales_doc_lines" (
  "id" TEXT PRIMARY KEY,
  "doc_id" TEXT NOT NULL,
  "line_no" BIGINT NOT NULL DEFAULT 0,
  "product_guid" TEXT NOT NULL DEFAULT '',
  "sku" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT '',
  "unit" TEXT NOT NULL DEFAULT '',
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "vat_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "line_kind" TEXT NOT NULL DEFAULT 'goods',
  FOREIGN KEY (doc_id) REFERENCES sales_docs(id)
);


-- table sales_docs
CREATE TABLE IF NOT EXISTS "sales_docs" (
  "id" TEXT PRIMARY KEY,
  "doc_type" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "doc_date" TEXT NOT NULL,
  "deal_id" TEXT NOT NULL DEFAULT '',
  "counterparty_name" TEXT NOT NULL DEFAULT '',
  "counterparty_inn" TEXT NOT NULL DEFAULT '',
  "buyer_address" TEXT NOT NULL DEFAULT '',
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "vat_rate" DOUBLE PRECISION NOT NULL DEFAULT 20,
  "vat_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "comment" TEXT NOT NULL DEFAULT '',
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "organization_id" TEXT NOT NULL DEFAULT '',
  "car_plate" TEXT NOT NULL DEFAULT '',
  "car_vin" TEXT NOT NULL DEFAULT '',
  "car_year" TEXT NOT NULL DEFAULT '',
  "car_mileage" TEXT NOT NULL DEFAULT '',
  "buyer_phone" TEXT NOT NULL DEFAULT '',
  "buyer_email" TEXT NOT NULL DEFAULT '',
  "buyer_kpp" TEXT NOT NULL DEFAULT '',
  "buyer_ogrn" TEXT NOT NULL DEFAULT '',
  "buyer_director" TEXT NOT NULL DEFAULT '',
  "buyer_bank" TEXT NOT NULL DEFAULT '',
  "buyer_bik" TEXT NOT NULL DEFAULT '',
  "buyer_rs" TEXT NOT NULL DEFAULT '',
  "buyer_ks" TEXT NOT NULL DEFAULT '',
  "car_brand" TEXT NOT NULL DEFAULT '',
  "car_model" TEXT NOT NULL DEFAULT '',
  "car_color" TEXT NOT NULL DEFAULT '',
  "car_category" TEXT NOT NULL DEFAULT '',
  "car_pts" TEXT NOT NULL DEFAULT '',
  "car_owner" TEXT NOT NULL DEFAULT '',
  "car_owner_street" TEXT NOT NULL DEFAULT '',
  "car_owner_house" TEXT NOT NULL DEFAULT '',
  "car_owner_flat" TEXT NOT NULL DEFAULT '',
  "car_sts_date" TEXT NOT NULL DEFAULT '',
  "car_sts_number" TEXT NOT NULL DEFAULT '',
  "template_id" TEXT NOT NULL DEFAULT '',
  checklist_json TEXT NOT NULL DEFAULT '',
  "printed_at" TEXT NOT NULL DEFAULT '',
  "buyer_passport" TEXT NOT NULL DEFAULT ''
);


-- table sessions
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" TEXT PRIMARY KEY,
  "actor_id" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "ip" TEXT NOT NULL DEFAULT '',
  "user_agent" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table staff
CREATE TABLE IF NOT EXISTS "staff" (
  "id" TEXT PRIMARY KEY,
  "amo_id" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL,
  "is_active" BIGINT NOT NULL DEFAULT 1,
  "group_id" TEXT NOT NULL DEFAULT '',
  "one_c_guid" TEXT NOT NULL DEFAULT '',
  "one_c_code" TEXT NOT NULL DEFAULT '',
  "one_c_name" TEXT NOT NULL DEFAULT '',
  "department" TEXT NOT NULL DEFAULT '',
  "auth_login" TEXT NOT NULL DEFAULT '',
  "sto_location" TEXT NOT NULL DEFAULT '',
  "is_admin_amo" BIGINT NOT NULL DEFAULT 0,
  "role" TEXT NOT NULL DEFAULT 'none',
  "rights_json" TEXT NOT NULL DEFAULT '{}',
  "can_login" BIGINT NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "synced_at" TEXT NOT NULL DEFAULT NOW(),
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "login" TEXT NOT NULL DEFAULT '',
  "password_hash" TEXT NOT NULL DEFAULT '',
  "password_set_at" TEXT NOT NULL DEFAULT '',
  "telegram_chat_id" TEXT NOT NULL DEFAULT '',
  "pin_hash" TEXT NOT NULL DEFAULT '',
  "pin_set_at" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "avatar_url" TEXT NOT NULL DEFAULT '',
  "salary" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "organization_id" TEXT NOT NULL DEFAULT ''
);


-- table staff_departments
CREATE TABLE IF NOT EXISTS "staff_departments" (
  "name" TEXT PRIMARY KEY,
  "rights_json" TEXT NOT NULL DEFAULT '{}',
  "notes" TEXT NOT NULL DEFAULT '',
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table staff_notifications
CREATE TABLE IF NOT EXISTS "staff_notifications" (
  "id" TEXT PRIMARY KEY,
  "staff_id" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT '',
  "title" TEXT NOT NULL DEFAULT '',
  "body" TEXT NOT NULL DEFAULT '',
  "deal_id" TEXT NOT NULL DEFAULT '',
  "href" TEXT NOT NULL DEFAULT '',
  "meta_json" TEXT NOT NULL DEFAULT '{}',
  "read_at" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table sto_appointments
CREATE TABLE IF NOT EXISTS "sto_appointments" (
  "id" TEXT PRIMARY KEY,
  "day" TEXT NOT NULL,
  "time_hm" TEXT NOT NULL DEFAULT '',
  "plate" TEXT NOT NULL DEFAULT '',
  "vin" TEXT NOT NULL DEFAULT '',
  "model" TEXT NOT NULL DEFAULT '',
  "client_name" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'expected',
  "work_order_id" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table sto_lift_shifts
CREATE TABLE IF NOT EXISTS "sto_lift_shifts" (
  "id" TEXT PRIMARY KEY,
  "staff_id" TEXT NOT NULL,
  "staff_name" TEXT NOT NULL DEFAULT '',
  "staff_login" TEXT NOT NULL DEFAULT '',
  "day" TEXT NOT NULL DEFAULT '',
  "started_at" TEXT NOT NULL,
  "ended_at" TEXT NOT NULL DEFAULT '',
  "pin_verified_at" TEXT NOT NULL DEFAULT '',
  "last_activity_at" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table sto_resources
CREATE TABLE IF NOT EXISTS "sto_resources" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'lift',
  "is_active" BIGINT NOT NULL DEFAULT 1
);


-- table sto_transfer_request_events
CREATE TABLE IF NOT EXISTS "sto_transfer_request_events" (
  "id" TEXT PRIMARY KEY,
  "request_id" TEXT NOT NULL,
  "event" TEXT NOT NULL DEFAULT '',
  "actor_id" TEXT NOT NULL DEFAULT '',
  "actor_name" TEXT NOT NULL DEFAULT '',
  "summary" TEXT NOT NULL DEFAULT '',
  "payload_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table sto_transfer_request_lines
CREATE TABLE IF NOT EXISTS "sto_transfer_request_lines" (
  "id" TEXT PRIMARY KEY,
  "request_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "serial" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'new',
  "transferred_at" TEXT NOT NULL DEFAULT '',
  "stock_doc_id" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (request_id) REFERENCES sto_transfer_requests(id) ON DELETE CASCADE
);


-- table sto_transfer_requests
CREATE TABLE IF NOT EXISTS "sto_transfer_requests" (
  "id" TEXT PRIMARY KEY,
  "number" TEXT NOT NULL UNIQUE,
  "deal_id" TEXT NOT NULL DEFAULT '',
  "warehouse_task_id" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'new',
  "comment" TEXT NOT NULL DEFAULT '',
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  "source" TEXT NOT NULL DEFAULT 'warehouse',
  "needs_rebrand" BIGINT NOT NULL DEFAULT 0,
  "telegram_notified_at" TEXT NOT NULL DEFAULT '',
  "courier_status" TEXT NOT NULL DEFAULT '',
  "courier_staff_id" TEXT NOT NULL DEFAULT '',
  "market_cash_doc_id" TEXT NOT NULL DEFAULT '',
  "market_stock_doc_id" TEXT NOT NULL DEFAULT '',
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "transfer_doc_id" TEXT NOT NULL DEFAULT '',
  "out_doc_id" TEXT NOT NULL DEFAULT '',
  "rebrand_done" BIGINT NOT NULL DEFAULT 0,
  "approve_status" TEXT NOT NULL DEFAULT '',
  "approve_mgr_at" TEXT NOT NULL DEFAULT '',
  "approve_dir_at" TEXT NOT NULL DEFAULT '',
  "approve_by" TEXT NOT NULL DEFAULT '',
  "dest_warehouse_id" TEXT NOT NULL DEFAULT '',
  "courier_drop_warehouse_id" TEXT NOT NULL DEFAULT ''
);


-- table sto_wo_materials
CREATE TABLE IF NOT EXISTS "sto_wo_materials" (
  "id" TEXT PRIMARY KEY,
  "work_order_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL DEFAULT '',
  "sku" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT '',
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "unit" TEXT NOT NULL DEFAULT '',
  "staff_id" TEXT NOT NULL DEFAULT '',
  "staff_name" TEXT NOT NULL DEFAULT '',
  "work_log_id" TEXT NOT NULL DEFAULT '',
  "stock_doc_id" TEXT NOT NULL DEFAULT '',
  "wrote_off" BIGINT NOT NULL DEFAULT 0,
  "stock_note" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table sto_wo_works
CREATE TABLE IF NOT EXISTS "sto_wo_works" (
  "id" TEXT PRIMARY KEY,
  "work_order_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "sort_order" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table sto_work_catalog
CREATE TABLE IF NOT EXISTS "sto_work_catalog" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "hours_default" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "is_active" BIGINT NOT NULL DEFAULT 1,
  "sort_order" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table sto_work_logs
CREATE TABLE IF NOT EXISTS "sto_work_logs" (
  "id" TEXT PRIMARY KEY,
  "work_order_id" TEXT NOT NULL DEFAULT '',
  "lift_id" TEXT NOT NULL DEFAULT '',
  "appointment_id" TEXT NOT NULL DEFAULT '',
  "staff_id" TEXT NOT NULL,
  "staff_name" TEXT NOT NULL DEFAULT '',
  "work_name" TEXT NOT NULL,
  "catalog_id" TEXT NOT NULL DEFAULT '',
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'done',
  "note" TEXT NOT NULL DEFAULT '',
  "started_at" TEXT NOT NULL DEFAULT '',
  "finished_at" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table sto_work_orders
CREATE TABLE IF NOT EXISTS "sto_work_orders" (
  "id" TEXT PRIMARY KEY,
  "number" TEXT NOT NULL,
  "doc_date" TEXT NOT NULL,
  "customer_name" TEXT NOT NULL DEFAULT '',
  "vehicle" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "comment" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "plate" TEXT NOT NULL DEFAULT '',
  "vin" TEXT NOT NULL DEFAULT '',
  "model" TEXT NOT NULL DEFAULT '',
  "lift_id" TEXT NOT NULL DEFAULT '',
  "lift_started_at" TEXT NOT NULL DEFAULT '',
  "master_staff_id" TEXT NOT NULL DEFAULT '',
  "master_staff_name" TEXT NOT NULL DEFAULT '',
  "car_year" TEXT NOT NULL DEFAULT '',
  "car_mileage" TEXT NOT NULL DEFAULT ''
);


-- table stock_adjustments
CREATE TABLE IF NOT EXISTS "stock_adjustments" (
  "id" TEXT PRIMARY KEY,
  "warehouse_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "qty_before" DOUBLE PRECISION NOT NULL,
  "qty_delta" DOUBLE PRECISION NOT NULL,
  "qty_after" DOUBLE PRECISION NOT NULL,
  "comment" TEXT NOT NULL DEFAULT '',
  "doc_id" TEXT NOT NULL,
  "doc_number" TEXT NOT NULL DEFAULT '',
  "doc_type" TEXT NOT NULL DEFAULT '',
  "created_by_id" TEXT NOT NULL DEFAULT '',
  "created_by_name" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "cells_json" TEXT NOT NULL DEFAULT '[]'
);


-- table stock_balances
CREATE TABLE IF NOT EXISTS "stock_balances" (
  "warehouse_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (warehouse_id, product_id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);


-- table stock_cell_balances
CREATE TABLE IF NOT EXISTS "stock_cell_balances" (
  "warehouse_id" TEXT NOT NULL,
  "cell_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL DEFAULT '',
  "sku" TEXT NOT NULL DEFAULT '',
  "product_name" TEXT NOT NULL DEFAULT '',
  "supply" TEXT NOT NULL DEFAULT '',
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  PRIMARY KEY (warehouse_id, cell_id, sku),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (cell_id) REFERENCES warehouse_cells(id)
);


-- table stock_doc_line_placements
CREATE TABLE IF NOT EXISTS "stock_doc_line_placements" (
  "id" TEXT PRIMARY KEY,
  "doc_id" TEXT NOT NULL,
  "line_id" TEXT NOT NULL,
  "cell_id" TEXT NOT NULL,
  "cell_code" TEXT NOT NULL DEFAULT '',
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "warehouse_id" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (doc_id) REFERENCES stock_docs(id),
  FOREIGN KEY (line_id) REFERENCES stock_doc_lines(id),
  FOREIGN KEY (cell_id) REFERENCES warehouse_cells(id)
);


-- table stock_doc_lines
CREATE TABLE IF NOT EXISTS "stock_doc_lines" (
  "id" TEXT PRIMARY KEY,
  "doc_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL,
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "line_no" BIGINT NOT NULL DEFAULT 0,
  "gtd_key" TEXT NOT NULL DEFAULT '',
  "gtd_code" TEXT NOT NULL DEFAULT '',
  "country_key" TEXT NOT NULL DEFAULT '',
  "serials_json" TEXT NOT NULL DEFAULT '[]',
  "warehouse_id" TEXT NOT NULL DEFAULT '',
  "apps_json" TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (doc_id) REFERENCES stock_docs(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);


-- table stock_docs
CREATE TABLE IF NOT EXISTS "stock_docs" (
  "id" TEXT PRIMARY KEY,
  "doc_type" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "doc_date" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "warehouse_to_id" TEXT,
  "counterparty_id" TEXT,
  "comment" TEXT DEFAULT '',
  "posted" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'local',
  "organization_id" TEXT NOT NULL DEFAULT '',
  "deal_id" TEXT NOT NULL DEFAULT '',
  "basis_order_id" TEXT NOT NULL DEFAULT '',
  "source_supplier_order_id" TEXT NOT NULL DEFAULT '',
  "mismatch" BIGINT NOT NULL DEFAULT 0,
  "supply_number" TEXT NOT NULL DEFAULT '',
  "inbound_baseline_json" TEXT NOT NULL DEFAULT '',
  "admin_only" BIGINT NOT NULL DEFAULT 0,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (warehouse_to_id) REFERENCES warehouses(id),
  FOREIGN KEY (counterparty_id) REFERENCES counterparties(id)
);


-- table stock_reserves
CREATE TABLE IF NOT EXISTS "stock_reserves" (
  "id" TEXT PRIMARY KEY,
  "payment_link_id" TEXT NOT NULL DEFAULT '',
  "sales_doc_id" TEXT NOT NULL DEFAULT '',
  "deal_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL,
  "source_warehouse_id" TEXT NOT NULL,
  "reserve_warehouse_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "stock_doc_id" TEXT NOT NULL DEFAULT '',
  "return_doc_id" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "released_at" TEXT
);


-- table supplier_order_lines
CREATE TABLE IF NOT EXISTS "supplier_order_lines" (
  "id" TEXT PRIMARY KEY,
  "order_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "comment" TEXT NOT NULL DEFAULT '',
  "sort_order" BIGINT NOT NULL DEFAULT 0,
  FOREIGN KEY (order_id) REFERENCES supplier_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);


-- table supplier_order_units
CREATE TABLE IF NOT EXISTS "supplier_order_units" (
  "id" TEXT PRIMARY KEY,
  "order_id" TEXT NOT NULL,
  "line_id" TEXT NOT NULL DEFAULT '',
  "product_id" TEXT NOT NULL,
  "serial" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'in_transit',
  "product_unit_id" TEXT NOT NULL DEFAULT '',
  "received_at" TEXT NOT NULL DEFAULT '',
  "stock_doc_id" TEXT NOT NULL DEFAULT '',
  "is_extra" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  FOREIGN KEY (order_id) REFERENCES supplier_orders(id) ON DELETE CASCADE
);


-- table supplier_orders
CREATE TABLE IF NOT EXISTS "supplier_orders" (
  "id" TEXT PRIMARY KEY,
  "number" TEXT NOT NULL UNIQUE,
  "counterparty_id" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "eta_date" TEXT NOT NULL DEFAULT '',
  "paid_at" TEXT NOT NULL DEFAULT '',
  "mismatch" BIGINT NOT NULL DEFAULT 0,
  "mismatch_note" TEXT NOT NULL DEFAULT '',
  "comment" TEXT NOT NULL DEFAULT '',
  "stock_doc_id" TEXT NOT NULL DEFAULT '',
  "organization_id" TEXT NOT NULL DEFAULT '',
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table supplier_product_apps
CREATE TABLE IF NOT EXISTS "supplier_product_apps" (
  "id" TEXT PRIMARY KEY,
  "product_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "apps_json" TEXT NOT NULL DEFAULT '[]',
  "comment" TEXT NOT NULL DEFAULT '',
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, supplier_id)
);


-- table tax_archive
CREATE TABLE IF NOT EXISTS "tax_archive" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT '',
  "period_label" TEXT NOT NULL DEFAULT '',
  "filename" TEXT NOT NULL DEFAULT '',
  "mime" TEXT NOT NULL DEFAULT '',
  "size_bytes" BIGINT NOT NULL DEFAULT 0,
  "stored_path" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "uploaded_by" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table tax_filings
CREATE TABLE IF NOT EXISTS "tax_filings" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "report_id" TEXT NOT NULL DEFAULT '',
  "report_type" TEXT NOT NULL DEFAULT '',
  "kontur_draft_id" TEXT NOT NULL DEFAULT '',
  "kontur_docflow_id" TEXT NOT NULL DEFAULT '',
  "kontur_task_id" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "errors_json" TEXT NOT NULL DEFAULT '[]',
  "sent_at" TEXT NOT NULL DEFAULT '',
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table tax_kontur_accounts
CREATE TABLE IF NOT EXISTS "tax_kontur_accounts" (
  "id" TEXT PRIMARY KEY,
  "label" TEXT NOT NULL DEFAULT '',
  "api_key_env" TEXT NOT NULL DEFAULT 'KONTUR_EXTERN_API_KEY',
  "client_id_env" TEXT NOT NULL DEFAULT 'KONTUR_EXTERN_CLIENT_ID',
  "account_id" TEXT NOT NULL DEFAULT '',
  "is_test" BIGINT NOT NULL DEFAULT 1,
  "notes" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table tax_kudir_lines
CREATE TABLE IF NOT EXISTS "tax_kudir_lines" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "period_year" BIGINT NOT NULL,
  "period_quarter" BIGINT NOT NULL DEFAULT 0,
  "section" TEXT NOT NULL DEFAULT 'I',
  "line_no" BIGINT NOT NULL DEFAULT 0,
  "op_date" TEXT NOT NULL DEFAULT '',
  "doc_no" TEXT NOT NULL DEFAULT '',
  "content" TEXT NOT NULL DEFAULT '',
  "income" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expense" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "trade_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "source_ref" TEXT NOT NULL DEFAULT '',
  "manual" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table tax_org_settings
CREATE TABLE IF NOT EXISTS "tax_org_settings" (
  "organization_id" TEXT PRIMARY KEY,
  "tax_system" TEXT NOT NULL DEFAULT 'usn_income',
  "usn_rate" DOUBLE PRECISION NOT NULL DEFAULT 6,
  "vat_rate" DOUBLE PRECISION NOT NULL DEFAULT 20,
  "vat_payer" BIGINT NOT NULL DEFAULT 1,
  "ifns_code" TEXT NOT NULL DEFAULT '',
  "sfr_reg_number" TEXT NOT NULL DEFAULT '',
  "trade_fee" BIGINT NOT NULL DEFAULT 0,
  "kontur_account_id" TEXT NOT NULL DEFAULT '',
  "cert_thumbprint" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table tax_periods
CREATE TABLE IF NOT EXISTS "tax_periods" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "year" BIGINT NOT NULL,
  "quarter" BIGINT NOT NULL DEFAULT 0,
  "month" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'open',
  "closed_at" TEXT NOT NULL DEFAULT '',
  UNIQUE(organization_id, kind, year, quarter, month)
);


-- table tax_reports
CREATE TABLE IF NOT EXISTS "tax_reports" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "report_type" TEXT NOT NULL,
  "period_year" BIGINT NOT NULL,
  "period_quarter" BIGINT NOT NULL DEFAULT 0,
  "period_month" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "xml_path" TEXT NOT NULL DEFAULT '',
  "pdf_path" TEXT NOT NULL DEFAULT '',
  "meta_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "built_at" TEXT NOT NULL DEFAULT ''
);


-- table tax_vat_ledger_purchases
CREATE TABLE IF NOT EXISTS "tax_vat_ledger_purchases" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "period_year" BIGINT NOT NULL,
  "period_quarter" BIGINT NOT NULL,
  "line_no" BIGINT NOT NULL DEFAULT 0,
  "op_date" TEXT NOT NULL DEFAULT '',
  "invoice_no" TEXT NOT NULL DEFAULT '',
  "invoice_date" TEXT NOT NULL DEFAULT '',
  "seller_name" TEXT NOT NULL DEFAULT '',
  "seller_inn" TEXT NOT NULL DEFAULT '',
  "amount_wo_vat" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "vat_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "vat_rate" DOUBLE PRECISION NOT NULL DEFAULT 20,
  "source_doc_id" TEXT NOT NULL DEFAULT '',
  "source_doc_type" TEXT NOT NULL DEFAULT '',
  "manual" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table tax_vat_ledger_sales
CREATE TABLE IF NOT EXISTS "tax_vat_ledger_sales" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "period_year" BIGINT NOT NULL,
  "period_quarter" BIGINT NOT NULL,
  "line_no" BIGINT NOT NULL DEFAULT 0,
  "op_date" TEXT NOT NULL DEFAULT '',
  "invoice_no" TEXT NOT NULL DEFAULT '',
  "invoice_date" TEXT NOT NULL DEFAULT '',
  "buyer_name" TEXT NOT NULL DEFAULT '',
  "buyer_inn" TEXT NOT NULL DEFAULT '',
  "amount_wo_vat" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "vat_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "vat_rate" DOUBLE PRECISION NOT NULL DEFAULT 20,
  "source_doc_id" TEXT NOT NULL DEFAULT '',
  "source_doc_type" TEXT NOT NULL DEFAULT '',
  "manual" BIGINT NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table thin_journal_docs
CREATE TABLE IF NOT EXISTS "thin_journal_docs" (
  "id" TEXT PRIMARY KEY,
  "journal_key" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "doc_date" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "counterparty_name" TEXT NOT NULL DEFAULT '',
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "comment" TEXT NOT NULL DEFAULT '',
  "payload_json" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table time_kinds
CREATE TABLE IF NOT EXISTS "time_kinds" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_active" BIGINT NOT NULL DEFAULT 1
);


-- table units
CREATE TABLE IF NOT EXISTS "units" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "short_name" TEXT NOT NULL
);


-- table user_bookmarks
CREATE TABLE IF NOT EXISTS "user_bookmarks" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "path" TEXT NOT NULL DEFAULT '',
  "tab_id" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table user_presence
CREATE TABLE IF NOT EXISTS "user_presence" (
  "actor_id" TEXT PRIMARY KEY,
  "actor_name" TEXT NOT NULL DEFAULT '',
  "role" TEXT NOT NULL DEFAULT '',
  "path" TEXT NOT NULL DEFAULT '',
  "title" TEXT NOT NULL DEFAULT '',
  "section" TEXT NOT NULL DEFAULT '',
  "last_seen" TEXT NOT NULL DEFAULT NOW(),
  "client_ip" TEXT NOT NULL DEFAULT '',
  "user_agent" TEXT NOT NULL DEFAULT '',
  "os" TEXT NOT NULL DEFAULT '',
  "browser" TEXT NOT NULL DEFAULT '',
  "device" TEXT NOT NULL DEFAULT '',
  "region" TEXT NOT NULL DEFAULT '',
  "country" TEXT NOT NULL DEFAULT ''
);


-- table warehouse_cells
CREATE TABLE IF NOT EXISTS "warehouse_cells" (
  "id" TEXT PRIMARY KEY,
  "warehouse_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "rack" TEXT NOT NULL DEFAULT '',
  "bay" BIGINT NOT NULL DEFAULT 0,
  "level" BIGINT NOT NULL DEFAULT 0,
  "kind" TEXT NOT NULL DEFAULT 'shelf',
  "is_active" BIGINT NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  UNIQUE (warehouse_id, code),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);


-- table warehouse_cells_meta
CREATE TABLE IF NOT EXISTS "warehouse_cells_meta" (
  "warehouse_id" TEXT PRIMARY KEY,
  "source" TEXT NOT NULL DEFAULT '',
  "sheet_title" TEXT NOT NULL DEFAULT '',
  "fetched_at" TEXT NOT NULL DEFAULT '',
  "imported_at" TEXT NOT NULL DEFAULT '',
  "row_count" BIGINT NOT NULL DEFAULT 0,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);


-- table warehouse_task_events
CREATE TABLE IF NOT EXISTS "warehouse_task_events" (
  "id" TEXT PRIMARY KEY,
  "task_id" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL DEFAULT '',
  "payload_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" TEXT NOT NULL DEFAULT NOW()
);


-- table warehouse_task_lines
CREATE TABLE IF NOT EXISTS "warehouse_task_lines" (
  "id" TEXT PRIMARY KEY,
  "task_id" TEXT NOT NULL,
  "line_no" BIGINT NOT NULL DEFAULT 1,
  "product_id" TEXT NOT NULL DEFAULT '',
  "sku" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT '',
  "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "weight_g" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "dims_json" TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (task_id) REFERENCES warehouse_tasks(id)
);


-- table warehouse_tasks
CREATE TABLE IF NOT EXISTS "warehouse_tasks" (
  "id" TEXT PRIMARY KEY,
  "number" TEXT NOT NULL UNIQUE,
  "barcode" TEXT NOT NULL DEFAULT '',
  "deal_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'new',
  "channel" TEXT NOT NULL DEFAULT 'cdek_prepaid',
  "city" TEXT NOT NULL DEFAULT '',
  "buyer_name" TEXT NOT NULL DEFAULT '',
  "amount_locked" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "payment_required" BIGINT NOT NULL DEFAULT 1,
  "track_number" TEXT NOT NULL DEFAULT '',
  "comment" TEXT NOT NULL DEFAULT '',
  "handed_at" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW(),
  "picked_at" TEXT NOT NULL DEFAULT '',
  "packed_at" TEXT NOT NULL DEFAULT '',
  "ready_at" TEXT NOT NULL DEFAULT '',
  "block_reason" TEXT NOT NULL DEFAULT '',
  "stock_doc_id" TEXT NOT NULL DEFAULT ''
);


-- table warehouses
CREATE TABLE IF NOT EXISTS "warehouses" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL UNIQUE,
  "is_active" BIGINT NOT NULL DEFAULT 1,
  "company_id" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT '',
  "created_by" TEXT NOT NULL DEFAULT '',
  "updated_at" TEXT NOT NULL DEFAULT '',
  "show_in_widget" BIGINT NOT NULL DEFAULT 0,
  "allow_inbound" BIGINT NOT NULL DEFAULT 0
);


-- table web_push_subscriptions
CREATE TABLE IF NOT EXISTS "web_push_subscriptions" (
  "id" TEXT PRIMARY KEY,
  "staff_id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL UNIQUE,
  "p256dh" TEXT NOT NULL DEFAULT '',
  "auth" TEXT NOT NULL DEFAULT '',
  "user_agent" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL DEFAULT NOW(),
  "updated_at" TEXT NOT NULL DEFAULT NOW()
);


-- table work_schedules
CREATE TABLE IF NOT EXISTS "work_schedules" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "hours_json" TEXT NOT NULL DEFAULT '',
  "is_active" BIGINT NOT NULL DEFAULT 1
);


-- table work_shifts
CREATE TABLE IF NOT EXISTS "work_shifts" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "hours_from" TEXT NOT NULL DEFAULT '09:00',
  "hours_to" TEXT NOT NULL DEFAULT '18:00',
  "is_active" BIGINT NOT NULL DEFAULT 1
);


-- index idx_2fa_actor
CREATE INDEX IF NOT EXISTS idx_2fa_actor ON auth_2fa_challenges(actor_id);

-- index idx_2fa_exp
CREATE INDEX IF NOT EXISTS idx_2fa_exp ON auth_2fa_challenges(expires_at);

-- index idx_app_generation
CREATE INDEX IF NOT EXISTS idx_app_generation ON product_applicability(generation);

-- index idx_app_mark
CREATE INDEX IF NOT EXISTS idx_app_mark ON product_applicability(mark);

-- index idx_app_mark_model_gen
CREATE INDEX IF NOT EXISTS idx_app_mark_model_gen ON product_applicability(mark, only_model, generation);

-- index idx_app_model
CREATE INDEX IF NOT EXISTS idx_app_model ON product_applicability(model);

-- index idx_app_only_model
CREATE INDEX IF NOT EXISTS idx_app_only_model ON product_applicability(only_model);

-- index idx_app_product
CREATE INDEX IF NOT EXISTS idx_app_product ON product_applicability(product_id);

-- index idx_audit_action
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

-- index idx_audit_actor
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);

-- index idx_audit_created
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- index idx_audit_day_actor
CREATE INDEX IF NOT EXISTS idx_audit_day_actor ON audit_log(created_at, actor_id);

-- index idx_audit_entity
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

-- index idx_balances_product
CREATE INDEX IF NOT EXISTS idx_balances_product ON stock_balances(product_id);

-- index idx_balances_wh
CREATE INDEX IF NOT EXISTS idx_balances_wh ON stock_balances(warehouse_id);

-- index idx_bank_docs_date
CREATE INDEX IF NOT EXISTS idx_bank_docs_date ON bank_docs_local(doc_date);

-- index idx_card_ops_deal
CREATE INDEX IF NOT EXISTS idx_card_ops_deal ON card_ops(deal_id);

-- index idx_card_ops_stock
CREATE INDEX IF NOT EXISTS idx_card_ops_stock ON card_ops(stock_doc_id);

-- index idx_cash_docs_date
CREATE INDEX IF NOT EXISTS idx_cash_docs_date ON cash_docs(doc_date);

-- index idx_cash_docs_register
CREATE INDEX IF NOT EXISTS idx_cash_docs_register ON cash_docs(cash_register_id);

-- index idx_cash_registers_org
CREATE INDEX IF NOT EXISTS idx_cash_registers_org ON cash_registers(organization_id);

-- index idx_chat_attachments_msg
CREATE INDEX IF NOT EXISTS idx_chat_attachments_msg ON chat_attachments(message_id);

-- index idx_chat_members_actor
CREATE INDEX IF NOT EXISTS idx_chat_members_actor ON chat_members(actor_id);

-- index idx_chat_messages_chat
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, created_at);

-- index idx_chat_messages_created
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

-- index idx_chats_dm_key
CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_dm_key ON chats(dm_key) WHERE dm_key != '';

-- index idx_chats_updated
CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at);

-- index idx_companies_active
CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(is_active, is_default);

-- index idx_contracts_code
CREATE INDEX IF NOT EXISTS idx_contracts_code ON contracts(code);

-- index idx_contracts_cp
CREATE INDEX IF NOT EXISTS idx_contracts_cp ON contracts(counterparty_id);

-- index idx_counterparties_amo_company
CREATE INDEX IF NOT EXISTS idx_counterparties_amo_company ON counterparties(amo_company_id);

-- index idx_counterparties_amo_contact
CREATE INDEX IF NOT EXISTS idx_counterparties_amo_contact ON counterparties(amo_contact_id);

-- index idx_counterparties_created
CREATE INDEX IF NOT EXISTS idx_counterparties_created ON counterparties(created_at);

-- index idx_counterparties_inn
CREATE INDEX IF NOT EXISTS idx_counterparties_inn ON counterparties(inn);

-- index idx_counterparties_is_main
CREATE INDEX IF NOT EXISTS idx_counterparties_is_main ON counterparties(is_main);

-- index idx_counterparties_name
CREATE INDEX IF NOT EXISTS idx_counterparties_name ON counterparties(name);

-- index idx_courier_runs_deal
CREATE INDEX IF NOT EXISTS idx_courier_runs_deal ON courier_runs(deal_id);

-- index idx_cp_amo_links_contact
CREATE INDEX IF NOT EXISTS idx_cp_amo_links_contact ON counterparty_amo_links(contact_id);

-- index idx_cp_doc_names_cp
CREATE INDEX IF NOT EXISTS idx_cp_doc_names_cp ON counterparty_product_doc_names(counterparty_id);

-- index idx_cp_doc_names_guid
CREATE INDEX IF NOT EXISTS idx_cp_doc_names_guid ON counterparty_product_doc_names(counterparty_id, product_guid);

-- index idx_cp_vehicles_cp
CREATE INDEX IF NOT EXISTS idx_cp_vehicles_cp ON counterparty_vehicles(counterparty_id);

-- index idx_cp_vehicles_plate
CREATE INDEX IF NOT EXISTS idx_cp_vehicles_plate ON counterparty_vehicles(car_plate);

-- index idx_crm_deal_items_deal
CREATE INDEX IF NOT EXISTS idx_crm_deal_items_deal ON crm_deal_items(deal_id);

-- index idx_crm_deals_org_co
CREATE INDEX IF NOT EXISTS idx_crm_deals_org_co ON crm_deals(org_company_id);

-- index idx_crm_deals_pipe
CREATE INDEX IF NOT EXISTS idx_crm_deals_pipe ON crm_deals(pipeline_id, status_id);

-- index idx_crm_deals_queued
CREATE INDEX IF NOT EXISTS idx_crm_deals_queued ON crm_deals(queued_to_1c, queued_at);

-- index idx_crm_events_at
CREATE INDEX IF NOT EXISTS idx_crm_events_at ON crm_events(event_at);

-- index idx_crm_statuses_pipe
CREATE INDEX IF NOT EXISTS idx_crm_statuses_pipe ON crm_pipeline_statuses(pipeline_id);

-- index idx_crm_tasks_assignee
CREATE INDEX IF NOT EXISTS idx_crm_tasks_assignee ON crm_tasks(assignee_amo_id, status);

-- index idx_crm_tasks_deal
CREATE INDEX IF NOT EXISTS idx_crm_tasks_deal ON crm_tasks(deal_id);

-- index idx_crpt_outbox_status
CREATE INDEX IF NOT EXISTS idx_crpt_outbox_status ON crpt_outbox(status, created_at);

-- index idx_currency_rates_pair
CREATE INDEX IF NOT EXISTS idx_currency_rates_pair ON currency_rates(base_code, quote_code, rate_date);

-- index idx_deal_payments_deal
CREATE INDEX IF NOT EXISTS idx_deal_payments_deal ON deal_payments(deal_id, created_at);

-- index idx_dev_plan_block
CREATE INDEX IF NOT EXISTS idx_dev_plan_block ON dev_plan_items(block_sort, sort_order);

-- index idx_dev_plan_comments_item
CREATE INDEX IF NOT EXISTS idx_dev_plan_comments_item ON dev_plan_comments(item_id, created_at);

-- index idx_dev_plan_dates
CREATE INDEX IF NOT EXISTS idx_dev_plan_dates ON dev_plan_items(start_date, end_date);

-- index idx_dev_plan_deps_item
CREATE INDEX IF NOT EXISTS idx_dev_plan_deps_item ON dev_plan_deps(item_id);

-- index idx_dev_plan_deps_on
CREATE INDEX IF NOT EXISTS idx_dev_plan_deps_on ON dev_plan_deps(depends_on_id);

-- index idx_dev_plan_staff
CREATE INDEX IF NOT EXISTS idx_dev_plan_staff ON dev_plan_items(responsible_staff_id);

-- index idx_dict_models_mark
CREATE INDEX IF NOT EXISTS idx_dict_models_mark ON dict_models(mark_id);

-- index idx_dict_pval_prop
CREATE INDEX IF NOT EXISTS idx_dict_pval_prop ON dict_property_values(property_id);

-- index idx_dm_agg
CREATE INDEX IF NOT EXISTS idx_dm_agg ON datamatrix_codes(aggregate_id);

-- index idx_dm_deal
CREATE INDEX IF NOT EXISTS idx_dm_deal ON datamatrix_codes(deal_id);

-- index idx_dm_lot
CREATE INDEX IF NOT EXISTS idx_dm_lot ON datamatrix_codes(lot_id);

-- index idx_dm_product
CREATE INDEX IF NOT EXISTS idx_dm_product ON datamatrix_codes(product_id);

-- index idx_dm_status
CREATE INDEX IF NOT EXISTS idx_dm_status ON datamatrix_codes(status);

-- index idx_doc_lines_gtd
CREATE INDEX IF NOT EXISTS idx_doc_lines_gtd ON stock_doc_lines(gtd_key);

-- index idx_doc_lines_product
CREATE INDEX IF NOT EXISTS idx_doc_lines_product ON stock_doc_lines(product_id);

-- index idx_doc_lines_wh
CREATE INDEX IF NOT EXISTS idx_doc_lines_wh ON stock_doc_lines(warehouse_id);

-- index idx_docs_source
CREATE INDEX IF NOT EXISTS idx_docs_source ON stock_docs(source);

-- index idx_docs_type_date
CREATE INDEX IF NOT EXISTS idx_docs_type_date ON stock_docs(doc_type, doc_date);

-- index idx_docs_type_product_date
CREATE INDEX IF NOT EXISTS idx_docs_type_product_date ON stock_docs(doc_type, doc_date);

-- index idx_feedback_created
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback_items(created_at);

-- index idx_feedback_status
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_items(status);

-- index idx_fiscal_receipts_deal
CREATE INDEX IF NOT EXISTS idx_fiscal_receipts_deal ON fiscal_receipts(deal_id, created_at);

-- index idx_gtd_code
CREATE INDEX IF NOT EXISTS idx_gtd_code ON gtd_numbers(code);

-- index idx_iapik_active
CREATE INDEX IF NOT EXISTS idx_iapik_active ON integration_api_keys(is_active);

-- index idx_iapik_hash
CREATE INDEX IF NOT EXISTS idx_iapik_hash ON integration_api_keys(key_hash);

-- index idx_iapik_staff
CREATE INDEX IF NOT EXISTS idx_iapik_staff ON integration_api_keys(staff_id);

-- index idx_income_mirror_created
CREATE INDEX IF NOT EXISTS idx_income_mirror_created ON income_mirror(created_at);

-- index idx_income_mirror_deal
CREATE INDEX IF NOT EXISTS idx_income_mirror_deal ON income_mirror(deal_id);

-- index idx_income_mirror_task
CREATE INDEX IF NOT EXISTS idx_income_mirror_task ON income_mirror(task_id);

-- index idx_kudir_org
CREATE INDEX IF NOT EXISTS idx_kudir_org ON tax_kudir_lines(organization_id, period_year, period_quarter);

-- index idx_lots_number
CREATE INDEX IF NOT EXISTS idx_lots_number ON product_lots(lot_number);

-- index idx_lots_product
CREATE INDEX IF NOT EXISTS idx_lots_product ON product_lots(product_id);

-- index idx_lots_status
CREATE INDEX IF NOT EXISTS idx_lots_status ON product_lots(status);

-- index idx_mark_ev_code
CREATE INDEX IF NOT EXISTS idx_mark_ev_code ON marking_events(code_id, created_at);

-- index idx_mark_ev_lot
CREATE INDEX IF NOT EXISTS idx_mark_ev_lot ON marking_events(lot_id, created_at);

-- index idx_media_orient
CREATE INDEX IF NOT EXISTS idx_media_orient ON product_media(orientation);

-- index idx_media_product
CREATE INDEX IF NOT EXISTS idx_media_product ON product_media(product_id);

-- index idx_media_sha
CREATE INDEX IF NOT EXISTS idx_media_sha ON product_media(product_id, sha256);

-- index idx_mp_orders_ch
CREATE INDEX IF NOT EXISTS idx_mp_orders_ch ON marketplace_orders(channel);

-- index idx_ncs_code
CREATE INDEX IF NOT EXISTS idx_ncs_code ON nomen_catalog_sheet(code);

-- index idx_ncs_status
CREATE INDEX IF NOT EXISTS idx_ncs_status ON nomen_catalog_sheet(match_status);

-- index idx_organizations_active
CREATE INDEX IF NOT EXISTS idx_organizations_active ON organizations(is_active, is_default);

-- index idx_organizations_company
CREATE INDEX IF NOT EXISTS idx_organizations_company ON organizations(company_id);

-- index idx_organizations_inn
CREATE INDEX IF NOT EXISTS idx_organizations_inn ON organizations(inn);

-- index idx_pac_product
CREATE INDEX IF NOT EXISTS idx_pac_product ON product_alt_codes(product_id);

-- index idx_pac_unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_pac_unique ON product_alt_codes(product_id, code_type, value);

-- index idx_pac_value
CREATE INDEX IF NOT EXISTS idx_pac_value ON product_alt_codes(value);

-- index idx_payment_links_deal
CREATE INDEX IF NOT EXISTS idx_payment_links_deal ON payment_links(deal_id, created_at);

-- index idx_payment_links_expire
CREATE INDEX IF NOT EXISTS idx_payment_links_expire ON payment_links(status, expires_at);

-- index idx_payment_links_token
CREATE INDEX IF NOT EXISTS idx_payment_links_token ON payment_links(token);

-- index idx_payment_plan_date
CREATE INDEX IF NOT EXISTS idx_payment_plan_date ON payment_plan(plan_date);

-- index idx_payroll_lines_run
CREATE INDEX IF NOT EXISTS idx_payroll_lines_run ON payroll_lines(run_id);

-- index idx_payroll_runs_org
CREATE INDEX IF NOT EXISTS idx_payroll_runs_org ON payroll_runs(organization_id, year, month);

-- index idx_pb_updated
CREATE INDEX IF NOT EXISTS idx_pb_updated ON purchase_baskets(updated_at DESC);

-- index idx_pbl_basket
CREATE INDEX IF NOT EXISTS idx_pbl_basket ON purchase_basket_lines(basket_id);

-- index idx_pda_inbound
CREATE INDEX IF NOT EXISTS idx_pda_inbound ON purchase_discrepancy_acts(inbound_doc_id);

-- index idx_pda_supply
CREATE INDEX IF NOT EXISTS idx_pda_supply ON purchase_discrepancy_acts(supply_number);

-- index idx_pdf_supplier
CREATE INDEX IF NOT EXISTS idx_pdf_supplier ON purchase_drive_folders(supplier_id);

-- index idx_pdfile_folder
CREATE INDEX IF NOT EXISTS idx_pdfile_folder ON purchase_drive_files(drive_folder_id);

-- index idx_pdfile_status
CREATE INDEX IF NOT EXISTS idx_pdfile_status ON purchase_drive_files(status);

-- index idx_pdl_act
CREATE INDEX IF NOT EXISTS idx_pdl_act ON purchase_discrepancy_lines(act_id);

-- index idx_pdm_group
CREATE INDEX IF NOT EXISTS idx_pdm_group ON product_dedup_members(group_no);

-- index idx_pdm_product
CREATE INDEX IF NOT EXISTS idx_pdm_product ON product_dedup_members(product_id);

-- index idx_pdm_status
CREATE INDEX IF NOT EXISTS idx_pdm_status ON product_dedup_members(match_status);

-- index idx_pdn_sign_deal
CREATE INDEX IF NOT EXISTS idx_pdn_sign_deal ON pdn_sign_sessions(deal_id, created_at);

-- index idx_pdn_sign_events_deal
CREATE INDEX IF NOT EXISTS idx_pdn_sign_events_deal ON pdn_sign_events(deal_id, created_at);

-- index idx_pdn_sign_events_session
CREATE INDEX IF NOT EXISTS idx_pdn_sign_events_session ON pdn_sign_events(session_id, created_at);

-- index idx_pdn_sign_token
CREATE INDEX IF NOT EXISTS idx_pdn_sign_token ON pdn_sign_sessions(token);

-- index idx_photo_shifts_day
CREATE INDEX IF NOT EXISTS idx_photo_shifts_day ON photo_shifts(day);

-- index idx_photo_shifts_staff
CREATE INDEX IF NOT EXISTS idx_photo_shifts_staff ON photo_shifts(staff_id, ended_at);

-- index idx_pick_shifts_day
CREATE INDEX IF NOT EXISTS idx_pick_shifts_day ON pick_shifts(day);

-- index idx_pick_shifts_staff
CREATE INDEX IF NOT EXISTS idx_pick_shifts_staff ON pick_shifts(staff_id, ended_at);

-- index idx_placements_doc
CREATE INDEX IF NOT EXISTS idx_placements_doc ON stock_doc_line_placements(doc_id);

-- index idx_placements_line
CREATE INDEX IF NOT EXISTS idx_placements_line ON stock_doc_line_placements(line_id);

-- index idx_pmm_source
CREATE INDEX IF NOT EXISTS idx_pmm_source ON product_merge_map(source_product_id);

-- index idx_pph_article
CREATE INDEX IF NOT EXISTS idx_pph_article ON purchase_price_history(supplier_id, article, observed_at DESC);

-- index idx_ppi_created
CREATE INDEX IF NOT EXISTS idx_ppi_created ON purchase_price_imports(created_at DESC);

-- index idx_ppi_supplier
CREATE INDEX IF NOT EXISTS idx_ppi_supplier ON purchase_price_imports(supplier_id);

-- index idx_ppr_import
CREATE INDEX IF NOT EXISTS idx_ppr_import ON purchase_price_rows(import_id);

-- index idx_ppr_status
CREATE INDEX IF NOT EXISTS idx_ppr_status ON purchase_price_rows(import_id, match_status);

-- index idx_presence_seen
CREATE INDEX IF NOT EXISTS idx_presence_seen ON user_presence(last_seen);

-- index idx_prices_product
CREATE INDEX IF NOT EXISTS idx_prices_product ON product_prices(product_id);

-- index idx_prices_type
CREATE INDEX IF NOT EXISTS idx_prices_type ON product_prices(price_type);

-- index idx_prod_dedup_group
CREATE INDEX IF NOT EXISTS idx_prod_dedup_group ON products(dedup_group);

-- index idx_prod_job_events
CREATE INDEX IF NOT EXISTS idx_prod_job_events ON production_job_events(job_id, created_at);

-- index idx_prod_job_lines_job
CREATE INDEX IF NOT EXISTS idx_prod_job_lines_job ON production_job_lines(job_id);

-- index idx_prod_jobs_deal
CREATE INDEX IF NOT EXISTS idx_prod_jobs_deal ON production_jobs(deal_id);

-- index idx_prod_jobs_status
CREATE INDEX IF NOT EXISTS idx_prod_jobs_status ON production_jobs(status, updated_at);

-- index idx_prod_master
CREATE INDEX IF NOT EXISTS idx_prod_master ON products(master_product_id);

-- index idx_product_units_in_doc
CREATE INDEX IF NOT EXISTS idx_product_units_in_doc ON product_units(in_doc_id);

-- index idx_product_units_out_doc
CREATE INDEX IF NOT EXISTS idx_product_units_out_doc ON product_units(out_doc_id);

-- index idx_product_units_serial
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_units_serial
      ON product_units(product_id, serial COLLATE NOCASE);

-- index idx_product_units_status
CREATE INDEX IF NOT EXISTS idx_product_units_status ON product_units(status);

-- index idx_product_units_wh
CREATE INDEX IF NOT EXISTS idx_product_units_wh ON product_units(warehouse_id, status);

-- index idx_products_active_name
CREATE INDEX IF NOT EXISTS idx_products_active_name ON products(is_active, name);

-- index idx_products_brand
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);

-- index idx_products_created
CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at DESC);

-- index idx_products_dept_catalog
CREATE INDEX IF NOT EXISTS idx_products_dept_catalog ON products(source_department, catalog_guid);

-- index idx_products_is_main
CREATE INDEX IF NOT EXISTS idx_products_is_main ON products(is_main);

-- index idx_products_name
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

-- index idx_products_sku
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

-- index idx_products_source_department
CREATE INDEX IF NOT EXISTS idx_products_source_department ON products(source_department);

-- index idx_prop_product
CREATE INDEX IF NOT EXISTS idx_prop_product ON product_properties(product_id);

-- index idx_psl_fact
CREATE INDEX IF NOT EXISTS idx_psl_fact ON product_supplier_lots(fact_sku);

-- index idx_psl_master
CREATE INDEX IF NOT EXISTS idx_psl_master ON product_supplier_lots(master_sku);

-- index idx_psl_product
CREATE INDEX IF NOT EXISTS idx_psl_product ON product_service_links(product_id);

-- index idx_rests_product
CREATE INDEX IF NOT EXISTS idx_rests_product ON product_store_rests(product_id);

-- index idx_rests_wh
CREATE INDEX IF NOT EXISTS idx_rests_wh ON product_store_rests(warehouse_id);

-- index idx_sales_docs_deal
CREATE INDEX IF NOT EXISTS idx_sales_docs_deal ON sales_docs(deal_id);

-- index idx_sales_docs_number
CREATE INDEX IF NOT EXISTS idx_sales_docs_number ON sales_docs(number);

-- index idx_sales_docs_type
CREATE INDEX IF NOT EXISTS idx_sales_docs_type ON sales_docs(doc_type, doc_date);

-- index idx_sales_lines_doc
CREATE INDEX IF NOT EXISTS idx_sales_lines_doc ON sales_doc_lines(doc_id);

-- index idx_sessions_actor
CREATE INDEX IF NOT EXISTS idx_sessions_actor ON sessions(actor_id);

-- index idx_sessions_exp
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

-- index idx_spa_product
CREATE INDEX IF NOT EXISTS idx_spa_product ON supplier_product_apps(product_id);

-- index idx_spa_supplier
CREATE INDEX IF NOT EXISTS idx_spa_supplier ON supplier_product_apps(supplier_id);

-- index idx_staff_1c
CREATE INDEX IF NOT EXISTS idx_staff_1c ON staff(one_c_guid);

-- index idx_staff_amo
CREATE INDEX IF NOT EXISTS idx_staff_amo ON staff(amo_id);

-- index idx_staff_email
CREATE INDEX IF NOT EXISTS idx_staff_email ON staff(email);

-- index idx_staff_login
CREATE INDEX IF NOT EXISTS idx_staff_login ON staff(login);

-- index idx_staff_name
CREATE INDEX IF NOT EXISTS idx_staff_name ON staff(name);

-- index idx_staff_role
CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role);

-- index idx_sto_appt_day
CREATE INDEX IF NOT EXISTS idx_sto_appt_day ON sto_appointments(day, status);

-- index idx_sto_appt_plate
CREATE INDEX IF NOT EXISTS idx_sto_appt_plate ON sto_appointments(plate);

-- index idx_sto_lift_shifts_day
CREATE INDEX IF NOT EXISTS idx_sto_lift_shifts_day ON sto_lift_shifts(day);

-- index idx_sto_lift_shifts_staff
CREATE INDEX IF NOT EXISTS idx_sto_lift_shifts_staff ON sto_lift_shifts(staff_id, ended_at);

-- index idx_sto_wo_date
CREATE INDEX IF NOT EXISTS idx_sto_wo_date ON sto_work_orders(doc_date);

-- index idx_sto_wo_mat_wo
CREATE INDEX IF NOT EXISTS idx_sto_wo_mat_wo ON sto_wo_materials(work_order_id);

-- index idx_sto_wo_works_wo
CREATE INDEX IF NOT EXISTS idx_sto_wo_works_wo ON sto_wo_works(work_order_id);

-- index idx_sto_work_logs_lift
CREATE INDEX IF NOT EXISTS idx_sto_work_logs_lift ON sto_work_logs(lift_id);

-- index idx_sto_work_logs_staff_day
CREATE INDEX IF NOT EXISTS idx_sto_work_logs_staff_day
      ON sto_work_logs(staff_id, created_at);

-- index idx_sto_work_logs_wo
CREATE INDEX IF NOT EXISTS idx_sto_work_logs_wo ON sto_work_logs(work_order_id);

-- index idx_sto_xfer_deal
CREATE INDEX IF NOT EXISTS idx_sto_xfer_deal ON sto_transfer_requests(deal_id);

-- index idx_sto_xfer_lines_req
CREATE INDEX IF NOT EXISTS idx_sto_xfer_lines_req ON sto_transfer_request_lines(request_id);

-- index idx_sto_xfer_status
CREATE INDEX IF NOT EXISTS idx_sto_xfer_status ON sto_transfer_requests(status);

-- index idx_stock_adj_doc
CREATE INDEX IF NOT EXISTS idx_stock_adj_doc ON stock_adjustments(doc_id);

-- index idx_stock_adj_wh
CREATE INDEX IF NOT EXISTS idx_stock_adj_wh ON stock_adjustments(warehouse_id, created_at);

-- index idx_stock_cell_cell
CREATE INDEX IF NOT EXISTS idx_stock_cell_cell ON stock_cell_balances(cell_id);

-- index idx_stock_cell_sku
CREATE INDEX IF NOT EXISTS idx_stock_cell_sku ON stock_cell_balances(sku);

-- index idx_stock_docs_deal
CREATE INDEX IF NOT EXISTS idx_stock_docs_deal ON stock_docs(deal_id);

-- index idx_stock_docs_supply
CREATE INDEX IF NOT EXISTS idx_stock_docs_supply ON stock_docs(supply_number);

-- index idx_stock_reserves_deal
CREATE INDEX IF NOT EXISTS idx_stock_reserves_deal ON stock_reserves(deal_id, status);

-- index idx_stock_reserves_doc
CREATE INDEX IF NOT EXISTS idx_stock_reserves_doc ON stock_reserves(sales_doc_id, status);

-- index idx_stock_reserves_link
CREATE INDEX IF NOT EXISTS idx_stock_reserves_link ON stock_reserves(payment_link_id, status);

-- index idx_stock_reserves_product
CREATE INDEX IF NOT EXISTS idx_stock_reserves_product ON stock_reserves(product_id, status);

-- index idx_supplier_order_lines_order
CREATE INDEX IF NOT EXISTS idx_supplier_order_lines_order ON supplier_order_lines(order_id);

-- index idx_supplier_order_units_order
CREATE INDEX IF NOT EXISTS idx_supplier_order_units_order ON supplier_order_units(order_id, status);

-- index idx_supplier_order_units_serial
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_order_units_serial
        ON supplier_order_units(serial COLLATE NOCASE);

-- index idx_supplier_orders_cp
CREATE INDEX IF NOT EXISTS idx_supplier_orders_cp ON supplier_orders(counterparty_id);

-- index idx_supplier_orders_status
CREATE INDEX IF NOT EXISTS idx_supplier_orders_status ON supplier_orders(status);

-- index idx_tax_archive_org
CREATE INDEX IF NOT EXISTS idx_tax_archive_org ON tax_archive(organization_id, created_at DESC);

-- index idx_tax_filings_org
CREATE INDEX IF NOT EXISTS idx_tax_filings_org ON tax_filings(organization_id, status);

-- index idx_tax_periods_org
CREATE INDEX IF NOT EXISTS idx_tax_periods_org ON tax_periods(organization_id, year);

-- index idx_tax_reports_org
CREATE INDEX IF NOT EXISTS idx_tax_reports_org ON tax_reports(organization_id, report_type, period_year);

-- index idx_thin_journal_key_date
CREATE INDEX IF NOT EXISTS idx_thin_journal_key_date
      ON thin_journal_docs(journal_key, doc_date);

-- index idx_user_bookmarks_user
CREATE INDEX IF NOT EXISTS idx_user_bookmarks_user ON user_bookmarks(user_id, created_at);

-- index idx_user_bookmarks_user_path
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_bookmarks_user_path ON user_bookmarks(user_id, path);

-- index idx_vat_purch_org
CREATE INDEX IF NOT EXISTS idx_vat_purch_org ON tax_vat_ledger_purchases(organization_id, period_year, period_quarter);

-- index idx_vat_sales_org
CREATE INDEX IF NOT EXISTS idx_vat_sales_org ON tax_vat_ledger_sales(organization_id, period_year, period_quarter);

-- index idx_warehouses_company
CREATE INDEX IF NOT EXISTS idx_warehouses_company ON warehouses(company_id);

-- index idx_wh_cells_rack
CREATE INDEX IF NOT EXISTS idx_wh_cells_rack ON warehouse_cells(warehouse_id, rack, bay, level);

-- index idx_wh_cells_wh
CREATE INDEX IF NOT EXISTS idx_wh_cells_wh ON warehouse_cells(warehouse_id);

-- index idx_wt_barcode
CREATE INDEX IF NOT EXISTS idx_wt_barcode ON warehouse_tasks(barcode);

-- index idx_wt_deal
CREATE INDEX IF NOT EXISTS idx_wt_deal ON warehouse_tasks(deal_id);

-- index idx_wt_status
CREATE INDEX IF NOT EXISTS idx_wt_status ON warehouse_tasks(status, created_at);

-- index idx_wt_stock_doc
CREATE INDEX IF NOT EXISTS idx_wt_stock_doc ON warehouse_tasks(stock_doc_id);

-- index idx_wte_task
CREATE INDEX IF NOT EXISTS idx_wte_task ON warehouse_task_events(task_id, created_at);

-- index idx_wtl_task
CREATE INDEX IF NOT EXISTS idx_wtl_task ON warehouse_task_lines(task_id);

COMMIT;