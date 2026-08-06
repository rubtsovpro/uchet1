export type StaffMe = {
  id?: string;
  login?: string;
  name?: string;
  email?: string;
  role?: string;
  isSystemAdmin?: boolean;
  rights?: {
    sections?: string[];
    can_sync?: boolean;
    can_edit_products?: boolean;
    can_edit_prices?: boolean;
    can_edit_docs?: boolean;
    [key: string]: unknown;
  };
};

export type OrgProfile = {
  name: string;
  short_name: string;
  inn: string;
  kpp: string;
  ogrnip: string;
  address: string;
  phone: string;
  bank: string;
  bik: string;
  rs: string;
  ks: string;
  director: string;
  accountant: string;
  master_title: string;
  vat_rate: number;
  stamp_url?: string | null;
  signature_url?: string | null;
  has_stamp?: boolean;
  has_signature?: boolean;
  stamp_source?: 'upload' | 'bundled' | null;
};

export type DocNumbering = {
  last_out_1c: string | null;
  last_in_1c: string | null;
  next_out: string;
  next_in: string;
  next_invoice: string;
  seq_out: number;
  seq_in: number;
  seq_invoice: number;
  synced_at: string | null;
  note: string;
};

export type TochkaAccountRow = {
  rs: string;
  rs_masked: string;
  name: string;
  customer_code: string;
  status: string;
  currency: string;
  own: number | null;
  available: number | null;
  reserve: number | null;
  owner_label?: string;
  owner_inn?: string;
  brand?: string;
  book_label?: string;
  card_name?: string;
  is_funds?: number;
  local_owner?: string;
};

export type TochkaOperationRow = {
  id: number;
  date: string;
  amount: number | null;
  purpose: string;
  payer: string;
  account: string;
  document_number: string;
  payment_id: string;
  type: string;
  status: unknown;
};

export type TochkaOverview = {
  ok: boolean;
  at?: string;
  totals?: { own: number; available: number; reserve: number; accounts: number };
  customers?: Array<{
    customer_code: string;
    inn: string;
    ogrn?: string;
    label: string;
    full_name?: string;
    short_name?: string;
  }>;
  accounts?: TochkaAccountRow[];
  operations?: TochkaOperationRow[];
  for_sign?: {
    ok: boolean;
    items: Array<Record<string, unknown>>;
    error?: string | null;
    hint?: string | null;
  };
  accounts_error?: string | null;
  sign_hint?: string;
  sign_url?: string;
  error?: string;
};

export type SalesDocType = 'invoice' | 'upd' | 'sf' | 'workorder' | 'contract';

export type SalesDocRow = {
  id: string;
  doc_type: SalesDocType;
  number: string;
  doc_date: string;
  deal_id?: string;
  counterparty_name?: string;
  total?: number;
  status?: string;
  created_at?: string;
};

export type Stats = {
  products?: number;
  warehouses?: number;
  docs?: number;
  skuQty?: number;
  media?: {
    images?: number;
    files?: number;
    empty?: number;
  };
  disk?: {
    free_human?: string;
    free_pct?: number;
    media_human?: string;
  };
};
