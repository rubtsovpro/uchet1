import { get, run } from '../db.js';
import { ensureTaxSchema } from './schema.js';
import { getOrganization, resolveOrganizationId } from '../organizations.js';

export type TaxOrgSettings = {
  organization_id: string;
  tax_system: string;
  usn_rate: number;
  vat_rate: number;
  vat_payer: number;
  ifns_code: string;
  sfr_reg_number: string;
  trade_fee: number;
  kontur_account_id: string;
  cert_thumbprint: string;
  notes: string;
};

const DEFAULTS: Omit<TaxOrgSettings, 'organization_id'> = {
  tax_system: 'usn_income',
  usn_rate: 6,
  vat_rate: 20,
  vat_payer: 1,
  ifns_code: '',
  sfr_reg_number: '',
  trade_fee: 0,
  kontur_account_id: '',
  cert_thumbprint: '',
  notes: '',
};

export function getTaxSettings(organizationId?: string | null): TaxOrgSettings {
  ensureTaxSchema();
  const oid = resolveOrganizationId(organizationId);
  const row = get<TaxOrgSettings>(`SELECT * FROM tax_org_settings WHERE organization_id = ?`, [oid]);
  if (row) return row;
  const org = getOrganization(oid);
  const seeded: TaxOrgSettings = {
    organization_id: oid,
    ...DEFAULTS,
    vat_rate: Number(org?.vat_rate) > 0 ? Number(org?.vat_rate) : 20,
  };
  run(
    `INSERT INTO tax_org_settings (
       organization_id, tax_system, usn_rate, vat_rate, vat_payer, ifns_code, sfr_reg_number,
       trade_fee, kontur_account_id, cert_thumbprint, notes
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      seeded.organization_id,
      seeded.tax_system,
      seeded.usn_rate,
      seeded.vat_rate,
      seeded.vat_payer,
      seeded.ifns_code,
      seeded.sfr_reg_number,
      seeded.trade_fee,
      seeded.kontur_account_id,
      seeded.cert_thumbprint,
      seeded.notes,
    ]
  );
  return seeded;
}

export function patchTaxSettings(
  organizationId: string | null | undefined,
  patch: Partial<TaxOrgSettings>
): TaxOrgSettings {
  const cur = getTaxSettings(organizationId);
  const next: TaxOrgSettings = {
    ...cur,
    tax_system: patch.tax_system != null ? String(patch.tax_system) : cur.tax_system,
    usn_rate: patch.usn_rate != null ? Number(patch.usn_rate) || 0 : cur.usn_rate,
    vat_rate: patch.vat_rate != null ? Number(patch.vat_rate) || 0 : cur.vat_rate,
    vat_payer: patch.vat_payer != null ? (patch.vat_payer ? 1 : 0) : cur.vat_payer,
    ifns_code: patch.ifns_code != null ? String(patch.ifns_code).trim() : cur.ifns_code,
    sfr_reg_number:
      patch.sfr_reg_number != null ? String(patch.sfr_reg_number).trim() : cur.sfr_reg_number,
    trade_fee: patch.trade_fee != null ? (patch.trade_fee ? 1 : 0) : cur.trade_fee,
    kontur_account_id:
      patch.kontur_account_id != null
        ? String(patch.kontur_account_id).trim()
        : cur.kontur_account_id,
    cert_thumbprint:
      patch.cert_thumbprint != null ? String(patch.cert_thumbprint).trim() : cur.cert_thumbprint,
    notes: patch.notes != null ? String(patch.notes) : cur.notes,
  };
  run(
    `UPDATE tax_org_settings SET
       tax_system=?, usn_rate=?, vat_rate=?, vat_payer=?, ifns_code=?, sfr_reg_number=?,
       trade_fee=?, kontur_account_id=?, cert_thumbprint=?, notes=?, updated_at=datetime('now')
     WHERE organization_id=?`,
    [
      next.tax_system,
      next.usn_rate,
      next.vat_rate,
      next.vat_payer,
      next.ifns_code,
      next.sfr_reg_number,
      next.trade_fee,
      next.kontur_account_id,
      next.cert_thumbprint,
      next.notes,
      next.organization_id,
    ]
  );
  return next;
}
