/**
 * Контуры и юрлица по файлу «Реквизиты 3шт»:
 * Фогель + Стрела — ИП Безматерных М.П. (один ИНН, разные р/с);
 * Пневмоподвеска — ИП Безматерных Р.П.
 */
import { all, get } from './db.js';
import { upsertCompany, type CompanyRow } from './companies.js';
import { upsertOrganization, type OrganizationRow } from './organizations.js';

const ADDR_MP =
  '350075, Краснодарский край, г. Краснодар, ул. им. Селезнева, 84, кв. 73';
const BANK = 'ООО "Банк Точка"';
const BIK = '044525104';
const KS = '30101810745374525104';

function companyByCode(code: string): CompanyRow | undefined {
  return get(`SELECT * FROM companies WHERE code = ? COLLATE NOCASE LIMIT 1`, [code]) as
    | CompanyRow
    | undefined;
}

function findOrg(opts: { companyId: string; inn: string; rs?: string }): OrganizationRow | undefined {
  if (opts.rs) {
    const byRs = get(
      `SELECT * FROM organizations
       WHERE company_id = ? AND inn = ? AND rs = ?
       LIMIT 1`,
      [opts.companyId, opts.inn, opts.rs]
    ) as OrganizationRow | undefined;
    if (byRs) return byRs;
  }
  return get(
    `SELECT * FROM organizations
     WHERE company_id = ? AND inn = ?
     ORDER BY is_default DESC, is_active DESC
     LIMIT 1`,
    [opts.companyId, opts.inn]
  ) as OrganizationRow | undefined;
}

/** Идемпотентно поднимает 3 контура и карточки юрлиц по реквизитам БМП/БРП. */
export function ensureClientOrgContours(): {
  companies: CompanyRow[];
  organizations: OrganizationRow[];
} {
  const pnevmo =
    companyByCode('PNEVMO') ||
    upsertCompany({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Пневмоподвеска',
      code: 'PNEVMO',
      is_default: true,
      is_active: true,
    });

  const fogel =
    companyByCode('ФОГЕЛЬ') ||
    companyByCode('FOGEL') ||
    upsertCompany({
      name: 'Фогель',
      code: 'ФОГЕЛЬ',
      is_default: false,
      is_active: true,
    });

  const strela =
    companyByCode('STRELA') ||
    companyByCode('СТРЕЛА') ||
    upsertCompany({
      name: 'Стрела',
      code: 'STRELA',
      is_default: false,
      is_active: true,
    });

  const fogelOrgExisting = findOrg({
    companyId: fogel.id,
    inn: '231295963240',
    rs: '40802810420000909020',
  }) || findOrg({ companyId: fogel.id, inn: '231295963240' });

  const fogelOrg = upsertOrganization({
    id: fogelOrgExisting?.id,
    company_id: fogel.id,
    code: fogelOrgExisting?.code || 'BMP-FOGEL',
    name: 'Индивидуальный предприниматель Безматерных Михаил Павлович',
    short_name: 'Безматерных М.П.',
    inn: '231295963240',
    kpp: '',
    ogrnip: '321237500020104',
    address: ADDR_MP,
    phone: '',
    bank: BANK,
    bik: BIK,
    rs: '40802810420000909020',
    ks: KS,
    director: 'Безматерных М.П.',
    accountant: '',
    master_title: 'Мастер-приемщик Фогель',
    vat_rate: 5,
    is_default: false,
    is_active: true,
  });

  const strelaOrgExisting = findOrg({
    companyId: strela.id,
    inn: '231295963240',
    rs: '40802810720000909005',
  }) || findOrg({ companyId: strela.id, inn: '231295963240' });

  const strelaOrg = upsertOrganization({
    id: strelaOrgExisting?.id,
    company_id: strela.id,
    code: strelaOrgExisting?.code || 'BMP-STRELA',
    name: 'Индивидуальный предприниматель Безматерных Михаил Павлович',
    short_name: 'Безматерных М.П.',
    inn: '231295963240',
    kpp: '',
    ogrnip: '321237500020104',
    address: ADDR_MP,
    phone: '',
    bank: BANK,
    bik: BIK,
    rs: '40802810720000909005',
    ks: KS,
    director: 'Безматерных М.П.',
    accountant: '',
    master_title: 'Мастер-приемщик Стрела',
    vat_rate: 5,
    is_default: false,
    is_active: true,
  });

  const rpExisting = findOrg({
    companyId: pnevmo.id,
    inn: '231215603728',
    rs: '40802810109500030587',
  }) || findOrg({ companyId: pnevmo.id, inn: '231215603728' });

  const rpOrg = upsertOrganization({
    id: rpExisting?.id,
    company_id: pnevmo.id,
    code: rpExisting?.code || 'BRP-MSK',
    name: 'Индивидуальный предприниматель Безматерных Роман Павлович',
    short_name: 'Безматерных Р.П.',
    inn: '231215603728',
    kpp: '',
    ogrnip: '322237500133521',
    address: ADDR_MP,
    phone: '',
    bank: BANK,
    bik: BIK,
    rs: '40802810109500030587',
    ks: KS,
    director: 'Безматерных Р.П.',
    accountant: '',
    master_title: 'Мастер-приемщик Пневмоподвеска №1',
    vat_rate: 5,
    is_default: true,
    is_active: true,
  });

  return {
    companies: [pnevmo, fogel, strela],
    organizations: [fogelOrg, strelaOrg, rpOrg],
  };
}

export function listClientOrgSnapshot() {
  const companies = all(
    `SELECT id, code, name, is_active FROM companies WHERE is_active = 1 ORDER BY name COLLATE NOCASE`
  );
  const organizations = all(
    `SELECT id, code, company_id, name, inn, ogrnip, rs, is_default, is_active
     FROM organizations
     WHERE is_active = 1
     ORDER BY name COLLATE NOCASE, rs`
  );
  return { companies, organizations };
}
