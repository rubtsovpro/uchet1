/**
 * Единый PDF «полный пакет СТО» по заказу.
 * Физлицо: договор 01 + ЗН 03ф — по 2 экз.; согласие ПДн — 1 экз.
 * Юрлицо / ИП: договор 02 + ЗН 03ю — без согласия ПДн.
 */
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getDeal,
  formatCarAuthorityBasisLabel,
  formatCarAuthorityLine,
} from './deals.js';
import { listSalesDocs, getSalesDoc, resolveContractBuyerFromDeal } from './sales-docs.js';
import { getOrgProfile, resolveOrganizationId, type OrgProfile } from './organizations.js';
import { garageForDeal } from './counterparty-vehicles.js';
import { looksLikePersonFio, resolvePersonDocFio } from './person-fio.js';
import { getLatestPdnSignForDeal } from './pdn-sms-sign.js';
import { clientPartsToFillLines, loadClientParts } from './client-parts.js';
import { dealCarPhotosFirstAt } from './deal-car-photos.js';
import {
  formatCompletenessLine,
  formatKeysDocsLine,
  intakeActFromDeal,
} from './intake-act.js';
import {
  drawOrgSignPdf,
  drawOrgStampPdf,
  runWithOrgFacsimileAsync,
  type FacsimileFlags,
} from './org-stamp.js';
import {
  fillStoTemplateText,
  getStoDocTemplate,
  suggestStoContractTemplateId,
  suggestStoWorkorderTemplateId,
  splitStoWorkPartLines,
  vehiclesFromDealOrGarage,
  STO_PDN_CONSENT,
  paymentFieldsFromDeal,
  contactFieldsFromDeal,
  staffFieldsFromDeal,
  handoverFieldsFromDeal,
  stoTemplatePrintCopies,
  type StoFillContext,
} from './sto-doc-templates.js';
import {
  loadStoTemplateText,
  STO_EXTRA_DEAL_DOCS,
  stoTemplateSourceLabel,
  isStoExtraDealTemplateId,
} from './sto-drive-load.js';
import { resolveBuyerForm, resolveIsSto } from './deal-sale-rules.js';
import { stoPrintCopyLabel } from './sto-doc-style.js';
import { markSalesDocPrinted } from './deal-workorder-gate.js';
import { buildStoDocxPdf } from './sto-docx-pdf.js';
import { workorderPrintNumber } from './doc-numbering.js';
import { resolveAmoClientComplaintForDeal } from './amo-client-complaint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function copiesForPart(partId: string): number {
  return stoTemplatePrintCopies(partId);
}

function findFont(file: string): string {
  const candidates = [
    path.resolve(__dirname, '..', 'assets', 'fonts', file),
    `/usr/share/fonts/truetype/dejavu/${file}`,
    `/usr/share/fonts/dejavu/${file}`,
    `/usr/local/share/fonts/${file}`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Не найден шрифт ${file}`);
}

/** Авто заказа: сначала совпадение VIN/госномер/СТС, иначе самое заполненное. */
function pickPrimaryGarageVehicle(
  deal: Record<string, unknown>,
  vehicles: Array<Record<string, unknown>>
): Record<string, unknown> | undefined {
  if (!vehicles.length) return undefined;
  const dealVin = String(deal.car_vin || '')
    .replace(/\s/g, '')
    .toUpperCase();
  const dealPlate = String(deal.car_plate || '')
    .replace(/\s/g, '')
    .toUpperCase();
  const dealSts = String(deal.car_sts_number || '').replace(/\s/g, '');
  const score = (v: Record<string, unknown>) => {
    const vin = String(v.car_vin || v.vin || '')
      .replace(/\s/g, '')
      .toUpperCase();
    const plate = String(v.car_plate || v.plate || '')
      .replace(/\s/g, '')
      .toUpperCase();
    const sts = String(v.car_sts_number || '').replace(/\s/g, '');
    let s = 0;
    if (dealVin && vin && dealVin === vin) s += 100;
    if (dealPlate && plate && dealPlate === plate) s += 80;
    if (dealSts && sts && dealSts === sts) s += 60;
    if (String(v.car_owner || '').trim()) s += 10;
    if (String(v.car_brand || v.brand || '').trim()) s += 5;
    if (String(v.car_plate || v.plate || '').trim()) s += 3;
    if (String(v.car_vin || v.vin || '').trim()) s += 2;
    return s;
  };
  return [...vehicles].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Город места приёма для бланка: филиал заказа (amo_branch), иначе контур ИП.
 * Не «угадывать» только по ИНН, если в Amo уже стоит пост.
 */
function cityForStoPack(deal: Record<string, unknown>, org?: OrgProfile | null): string {
  const branch = String(deal.amo_branch || '').trim();
  if (/москв|можай|пневмо/i.test(branch)) return 'Москва';
  if (/краснодар|стрел|фогел/i.test(branch)) return 'Краснодар';
  const inn = String(org?.inn || '').replace(/\D/g, '');
  if (inn === '231215603728') return 'Москва';
  return 'Краснодар';
}

/** Адрес ≠ телефон: в ЗН раньше попадало «тел.: +7…» из sales_docs. */
function sanitizeStoBuyerAddress(raw: string): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (/^тел\.?\s*:?/i.test(t)) return '';
  const digits = t.replace(/\D/g, '');
  const nonPhone = t.replace(/[\d\s+\-().]/g, '');
  if (digits.length >= 10 && digits.length <= 15 && nonPhone.length <= 2) return '';
  return t;
}

function fioFromPdnSession(dealId: string): string {
  const id = String(dealId || '').trim();
  if (!id) return '';
  try {
    const s = getLatestPdnSignForDeal(id);
    const fromId = String(s?.identity?.fio || '').trim();
    if (looksLikePersonFio(fromId)) return fromId;
    const fromBuyer = String(s?.buyer_name || '').trim();
    if (looksLikePersonFio(fromBuyer)) return fromBuyer;
  } catch {
    /* ignore */
  }
  return '';
}

function dealFillCtx(
  deal: Record<string, unknown>,
  org: OrgProfile,
  number: string,
  extra?: Partial<StoFillContext>
): StoFillContext {
  const garage = garageForDeal(String(deal.id || ''), { ensure: false });
  const garageVehicles = (garage.vehicles || []) as Array<Record<string, unknown>>;
  const v = pickPrimaryGarageVehicle(deal, garageVehicles);
  const extraName = String(extra?.buyerName || '').trim();
  const personFio =
    (looksLikePersonFio(extraName) ? extraName : '') ||
    resolvePersonDocFio(deal, garageVehicles) ||
    fioFromPdnSession(String(deal.id || ''));
  const legalBuyer = resolveContractBuyerFromDeal(deal as never, {
    name: personFio || undefined,
    inn: String(extra?.buyerInn || '').trim() || undefined,
    phone: String(extra?.buyerPhone || '').trim() || undefined,
    address: String(extra?.buyerAddress || '').trim() || undefined,
    email: String(extra?.buyerEmail || '').trim() || undefined,
    passport: String(extra?.buyerPassport || '').trim() || undefined,
    kpp: String(extra?.buyerKpp || '').trim() || undefined,
    ogrn: String(extra?.buyerOgrn || '').trim() || undefined,
    director: String(extra?.buyerDirector || '').trim() || undefined,
    bank: String(extra?.buyerBank || '').trim() || undefined,
    bik: String(extra?.buyerBik || '').trim() || undefined,
    rs: String(extra?.buyerRs || '').trim() || undefined,
    ks: String(extra?.buyerKs || '').trim() || undefined,
  });
  const dealItems = Array.isArray((deal as { items?: unknown[] }).items)
    ? ((deal as { items: Array<Record<string, unknown>> }).items as Array<Record<string, unknown>>)
    : [];
  const fromDeal = splitStoWorkPartLines(dealItems);
  const workLines = extra?.workLines?.length ? extra.workLines : fromDeal.workLines;
  const partLines = extra?.partLines?.length ? extra.partLines : fromDeal.partLines;
  const buyerName = String(
    personFio ||
      (looksLikePersonFio(String(legalBuyer.name || '')) ? legalBuyer.name : '') ||
      deal.company_name ||
      ''
  ).trim();
  return {
    number: number || String(deal.id || '').trim() || '____',
    docDate: new Date().toISOString().slice(0, 10),
    org,
    buyerName,
    buyerInn: String(legalBuyer.inn || extra?.buyerInn || deal.buyer_inn || '').trim(),
    buyerPhone: String(legalBuyer.phone || extra?.buyerPhone || deal.buyer_phone || '').trim(),
    // Не подставлять «тел.: +7…» в адрес (так раньше писали в sales_docs при пустом адресе)
    buyerAddress: sanitizeStoBuyerAddress(
      String(legalBuyer.address || extra?.buyerAddress || deal.buyer_address || '').trim()
    ),
    buyerEmail: String(legalBuyer.email || extra?.buyerEmail || deal.buyer_email || '').trim(),
    buyerPassport: String(
      legalBuyer.passport || extra?.buyerPassport || deal.buyer_passport || ''
    ).trim(),
    buyerKpp: String(
      legalBuyer.kpp || extra?.buyerKpp || (deal as { buyer_kpp?: string }).buyer_kpp || ''
    ).trim(),
    buyerOgrn: String(
      legalBuyer.ogrn || extra?.buyerOgrn || (deal as { buyer_ogrn?: string }).buyer_ogrn || ''
    ).trim(),
    buyerDirector: String(
      legalBuyer.director ||
        extra?.buyerDirector ||
        (deal as { buyer_director?: string }).buyer_director ||
        ''
    ).trim(),
    buyerBank: String(
      legalBuyer.bank || extra?.buyerBank || (deal as { buyer_bank?: string }).buyer_bank || ''
    ).trim(),
    buyerBik: String(
      legalBuyer.bik || extra?.buyerBik || (deal as { buyer_bik?: string }).buyer_bik || ''
    ).trim(),
    buyerRs: String(
      legalBuyer.rs || extra?.buyerRs || (deal as { buyer_rs?: string }).buyer_rs || ''
    ).trim(),
    buyerKs: String(
      legalBuyer.ks || extra?.buyerKs || (deal as { buyer_ks?: string }).buyer_ks || ''
    ).trim(),
    carStsNumber: String(
      extra?.carStsNumber || deal.car_sts_number || v?.car_sts_number || ''
    ).trim(),
    carBrand: String(extra?.carBrand || deal.car_brand || v?.car_brand || v?.brand || '').trim(),
    carModel: String(extra?.carModel || deal.car_model || v?.car_model || v?.model || '').trim(),
    carPlate: String(extra?.carPlate || deal.car_plate || v?.car_plate || v?.plate || '').trim(),
    carVin: String(extra?.carVin || deal.car_vin || v?.car_vin || v?.vin || '').trim(),
    carYear: String(extra?.carYear || deal.car_year || v?.car_year || v?.year || '').trim(),
    carColor: String(extra?.carColor || deal.car_color || v?.car_color || v?.color || '').trim(),
    carMileage: String(extra?.carMileage || deal.car_mileage || '').trim(),
    carFuelLevel: String(
      (extra as { carFuelLevel?: string })?.carFuelLevel ||
        (deal as { car_fuel_level?: string }).car_fuel_level ||
        ''
    ).trim(),
    completenessLine: (() => {
      const fromExtra = String((extra as { completenessLine?: string })?.completenessLine || '').trim();
      if (fromExtra) return fromExtra;
      const act = intakeActFromDeal(deal as Record<string, unknown>);
      if (!act.completeness.length && !act.completeness_other) return '';
      return formatCompletenessLine(act, { withTachograph: true });
    })(),
    keysDocsLine: (() => {
      const fromExtra = String((extra as { keysDocsLine?: string })?.keysDocsLine || '').trim();
      if (fromExtra) return fromExtra;
      const act = intakeActFromDeal(deal as Record<string, unknown>);
      if (!act.keys_count && !act.docs_left) return '';
      const form = resolveBuyerForm(deal as Record<string, unknown>);
      const legal = form === 'legal' || form === 'ip';
      return formatKeysDocsLine(act, legal ? 'legal' : 'person');
    })(),
    damageNotes: String(
      (extra as { damageNotes?: string })?.damageNotes ||
        (deal as { car_damage_notes?: string }).car_damage_notes ||
        ''
    ).trim(),
    ...(() => {
      const act = intakeActFromDeal(deal as Record<string, unknown>);
      return {
        completenessChecked: act.completeness,
        completenessOther: act.completeness_other,
        keysCount: act.keys_count,
        docsLeft: act.docs_left,
        docsNote: act.docs_note,
      };
    })(),
    intakeAt: String(
      (extra as { intakeAt?: string })?.intakeAt ||
        dealCarPhotosFirstAt(String(deal.id || '')) ||
        ''
    ).trim() || undefined,
    carBroughtBy: String(
      (extra as { carBroughtBy?: string })?.carBroughtBy ||
        (deal as { car_brought_by?: string }).car_brought_by ||
        ''
    ).trim(),
    carAuthorityBasis: formatCarAuthorityBasisLabel(
      String(
        (extra as { carAuthorityBasis?: string })?.carAuthorityBasis ||
          (deal as { car_authority_basis?: string }).car_authority_basis ||
          ''
      )
    ),
    carAuthorityDetails: String(
      (extra as { carAuthorityDetails?: string })?.carAuthorityDetails ||
        (deal as { car_authority_details?: string }).car_authority_details ||
        ''
    ).trim(),
    carAuthorityLine: formatCarAuthorityLine(
      String((deal as { car_authority_basis?: string }).car_authority_basis || ''),
      String((deal as { car_authority_details?: string }).car_authority_details || '')
    ),
    vehicles: vehiclesFromDealOrGarage(
      deal,
      (garage.vehicles || []) as Array<Record<string, unknown>>
    ),
    city: cityForStoPack(deal, org),
    faults: resolveAmoClientComplaintForDeal(deal),
    workLines,
    partLines,
    clientPartLines:
      extra?.clientPartLines ||
      clientPartsToFillLines(loadClientParts(String(deal.id || '')).items),
    ...paymentFieldsFromDeal(deal),
    ...contactFieldsFromDeal(deal, {
      docDate: new Date().toISOString().slice(0, 10),
    }),
    ...staffFieldsFromDeal(deal, {
      staffName: extra?.staffName,
      actorOnly: !!String(extra?.staffName || '').trim(),
    }),
    ...handoverFieldsFromDeal(deal),
    ...(extra?.handover104
      ? {
          handover104: extra.handover104,
          handover104Legal: extra.handover104Legal,
          intakePhotoCount: extra.intakePhotoCount,
        }
      : {}),
  };
}

type PackPart = { id: string; code: string; title: string; text: string; source?: string };

async function templatePartAsync(
  id: string,
  ctx: StoFillContext,
  sellerInn?: string | null
): Promise<PackPart | null> {
  const meta = getStoDocTemplate(id);
  if (!meta) return null;
  const loaded = await loadStoTemplateText(id, sellerInn || ctx.org?.inn);
  if (!loaded?.text) return null;
  return {
    id,
    code: meta.code,
    title: meta.title,
    text: fillStoTemplateText(loaded.text, ctx),
    source: loaded.source,
  };
}

/**
 * Состав полного пакета приёма для заказа.
 * Физ: договор + ЗН + ПДн. Юр/ИП: договор + приложения + ЗН (без ПДн).
 */
export function resolveStoFullPackTemplateIds(
  deal: Record<string, unknown>,
  opts?: { organizationId?: string }
): string[] {
  const contractId = suggestStoContractTemplateId(deal, {
    organizationId: opts?.organizationId,
  });
  const woId = suggestStoWorkorderTemplateId(deal);
  const ids = [contractId];
  ids.push(woId);
  if (resolveBuyerForm(deal) === 'person') ids.push(STO_PDN_CONSENT);
  return [...new Set(ids.filter(Boolean))];
}

function writeTextBlock(
  pdf: PDFKit.PDFDocument,
  font: string,
  fontBold: string,
  title: string,
  code: string,
  body: string,
  copyLabel: string | undefined,
  org: OrgProfile,
  facsimile: FacsimileFlags
): void {
  pdf.addPage();
  if (copyLabel) {
    pdf.font(font).fontSize(11).fillColor('#555').text(copyLabel, { align: 'right' });
    pdf.fillColor('#000');
    pdf.moveDown(0.25);
  }
  pdf.font(fontBold).fontSize(13).fillColor('#000').text(`${code}. ${title}`, { align: 'center' });
  pdf.moveDown(0.6);
  pdf.font(font).fontSize(11);
  const paras = body
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, '\n').trim())
    .filter(Boolean);
  for (const p of paras) {
    if (pdf.y > pdf.page.height - 72) pdf.addPage();
    pdf.text(p, {
      align: 'justify',
      paragraphGap: 5,
      lineGap: 1.2,
    });
    pdf.moveDown(0.2);
  }

  if (!facsimile.stamp && !facsimile.sign) return;
  const needH = 130;
  if (pdf.y > pdf.page.height - needH) pdf.addPage();
  pdf.moveDown(1.1);
  const left = pdf.page.margins.left;
  const who = String(org.director || org.short_name || '').trim() || '____________________';
  const labelY = pdf.y;
  pdf.font(font).fontSize(11).fillColor('#000').text('Исполнитель:', left, labelY, { width: 400 });
  // Линия подписи ниже ярлыка; росчерк на линии, печать справа — не поверх «Исполнитель:»
  const lineY = labelY + 30;
  pdf.text(`_______________ / ${who} /`, left + 8, lineY, { width: 300 });
  pdf
    .fontSize(9)
    .fillColor('#444')
    .text('(подпись)                              (Ф. И. О.)', left + 8, lineY + 13, { width: 300 });
  pdf.fillColor('#000').fontSize(11);
  if (facsimile.sign) {
    drawOrgSignPdf(pdf, org.inn, { x: left + 6, y: lineY - 24, width: 115, height: 34 });
  }
  if (facsimile.stamp) {
    drawOrgStampPdf(pdf, org.inn, { x: left + 210, y: lineY - 8, size: 68 });
  }
  pdf.y = Math.max(pdf.y, lineY + 78);
}

function dealLooksLegalPack(deal: Record<string, unknown>): boolean {
  const form = resolveBuyerForm(deal);
  return form === 'legal' || form === 'ip';
}

/** Авто / СТС в бланках — только СТО/автосервис (самовывоз / отправка — без авто). */
function dealNeedsCarForPack(deal: Record<string, unknown>): boolean {
  return resolveIsSto(deal);
}

/** Поля, которые в PDF уйдут в «________», если не заполнены в заказе / ЗН / гараже. */
export function listStoPackBlankFields(
  ctx: StoFillContext,
  deal: Record<string, unknown>
): Array<{ key: string; label: string }> {
  const legal = dealLooksLegalPack(deal);
  const needCar = dealNeedsCarForPack(deal);
  const out: Array<{ key: string; label: string }> = [];
  const push = (key: string, label: string, ok: boolean) => {
    if (!ok) out.push({ key, label });
  };
  push(
    'buyerName',
    legal ? 'Наименование покупателя' : 'ФИО как в паспорте',
    legal ? !!ctx.buyerName : looksLikePersonFio(String(ctx.buyerName || ''))
  );
  push('buyerPhone', 'Телефон', !!ctx.buyerPhone);
  if (legal) {
    push('buyerInn', 'ИНН покупателя', !!ctx.buyerInn);
    push('buyerAddress', 'Адрес покупателя', !!ctx.buyerAddress);
    push('buyerDirector', 'В лице (руководитель)', !!ctx.buyerDirector);
    const innDigits = String(ctx.buyerInn || '').replace(/\D/g, '');
    if (innDigits.length === 10) {
      push('buyerKpp', 'КПП', !!ctx.buyerKpp);
    }
    push('buyerOgrn', innDigits.length === 12 ? 'ОГРНИП' : 'ОГРН', !!ctx.buyerOgrn);
    push('buyerBank', 'Банк', !!ctx.buyerBank);
    push('buyerBik', 'БИК', !!ctx.buyerBik);
    push('buyerRs', 'Р/с', !!ctx.buyerRs);
    const dealVat = String((deal as { buyer_vat?: string }).buyer_vat || '').trim();
    push(
      'buyerVat',
      'НДС для счёта/УПД (нет или ставка %)',
      dealVat === 'no' || dealVat === 'yes'
    );
  } else if (needCar) {
    // СТО + физлицо: номер СТС или фото СТС (OCR)
    const stsPh = deal.sts_photos as { front?: string; back?: string } | undefined;
    const hasStsPhoto = !!(stsPh && (stsPh.front || stsPh.back));
    if (!ctx.carStsNumber && !hasStsPhoto) {
      push('carStsNumber', 'СТС / документ на авто', false);
    }
  }
  if (needCar) {
    push('carBrand', 'Марка авто', !!ctx.carBrand);
    push('carModel', 'Модель авто', !!ctx.carModel);
    push('carPlate', 'Гос. номер', !!ctx.carPlate);
    push('carVin', 'VIN', !!ctx.carVin);
    push('carMileage', 'Пробег', !!ctx.carMileage);
    if (legal) {
      push(
        'carBroughtBy',
        'Кто пригнал (представитель)',
        !!String(ctx.carBroughtBy || '').trim()
      );
      push(
        'carAuthorityLine',
        'Основание полномочий (доверенность / путевой / приказ)',
        !!String(ctx.carAuthorityLine || '').trim()
      );
    }
  }
  // Email орг. для бланка ПДн — только СТО (на отправке/самовывозе согласия нет)
  if (!legal && needCar) {
    push('orgEmail', 'Email организации (отзыв ПДн)', !!String(ctx.org?.email || '').trim());
  }
  // Мастер на бланках ЗН / актов — желательно до печати
  if (needCar) {
    push('staffName', 'Мастер-приёмщик', !!String(ctx.staffName || '').trim());
  }
  return out;
}

type StoPackPrepared = {
  deal: Record<string, unknown>;
  org: OrgProfile;
  parts: PackPart[];
  blanks: Array<{ key: string; label: string }>;
  dealLabel: string;
  fillCtx: StoFillContext;
};

async function prepareStoFullPack(
  dealId: string,
  opts?: { organizationId?: string; staffName?: string; forceDrive?: boolean }
): Promise<StoPackPrepared | null> {
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  if (!deal) return null;

  const orgId = resolveOrganizationId(
    opts?.organizationId ||
      String(deal.organization_id || '') ||
      String(deal.org_company_id || '')
  );
  const org = getOrgProfile(orgId);
  const sales = listSalesDocs({ dealId, limit: 100 }).items as Array<{
    id: string;
    doc_type?: string;
    number?: string;
  }>;
  const contractDoc = sales.find((d) => String(d.doc_type) === 'contract');
  const woDoc = sales.find((d) => String(d.doc_type) === 'workorder');

  const enrich: Partial<StoFillContext> = {};
  const actorStaff = String(opts?.staffName || '').trim();
  if (actorStaff) {
    enrich.staffName = actorStaff;
    // не подменять ответственным Amo — в ЗН «оформивший» = кто скачал
  }
  for (const sid of [woDoc?.id, contractDoc?.id].filter(Boolean) as string[]) {
    const full = getSalesDoc(sid) as Record<string, unknown> | null;
    if (!full) continue;
    if (!enrich.buyerName && full.counterparty_name) enrich.buyerName = String(full.counterparty_name);
    if (!enrich.buyerInn && full.counterparty_inn) enrich.buyerInn = String(full.counterparty_inn);
    if (!enrich.buyerPhone && full.buyer_phone) enrich.buyerPhone = String(full.buyer_phone);
    if (!enrich.buyerAddress && full.buyer_address) enrich.buyerAddress = String(full.buyer_address);
    if (!enrich.buyerEmail && full.buyer_email) enrich.buyerEmail = String(full.buyer_email);
    if (!enrich.buyerPassport && full.buyer_passport) {
      enrich.buyerPassport = String(full.buyer_passport);
    }
    if (!enrich.buyerKpp && full.buyer_kpp) enrich.buyerKpp = String(full.buyer_kpp);
    if (!enrich.buyerOgrn && full.buyer_ogrn) enrich.buyerOgrn = String(full.buyer_ogrn);
    if (!enrich.buyerDirector && full.buyer_director) {
      enrich.buyerDirector = String(full.buyer_director);
    }
    if (!enrich.buyerBank && full.buyer_bank) enrich.buyerBank = String(full.buyer_bank);
    if (!enrich.buyerBik && full.buyer_bik) enrich.buyerBik = String(full.buyer_bik);
    if (!enrich.buyerRs && full.buyer_rs) enrich.buyerRs = String(full.buyer_rs);
    if (!enrich.buyerKs && full.buyer_ks) enrich.buyerKs = String(full.buyer_ks);
    if (!enrich.carPlate && full.car_plate) enrich.carPlate = String(full.car_plate);
    if (!enrich.carVin && full.car_vin) enrich.carVin = String(full.car_vin);
    if (!enrich.carBrand && full.car_brand) enrich.carBrand = String(full.car_brand);
    if (!enrich.carModel && full.car_model) enrich.carModel = String(full.car_model);
    if (!enrich.carYear && full.car_year) enrich.carYear = String(full.car_year);
    if (!enrich.carColor && full.car_color) enrich.carColor = String(full.car_color);
    if (!enrich.carMileage && full.car_mileage) enrich.carMileage = String(full.car_mileage);
    if (!enrich.carStsNumber && (full as { car_sts_number?: string }).car_sts_number) {
      enrich.carStsNumber = String((full as { car_sts_number?: string }).car_sts_number);
    }
    // Позиции для таблиц ЗН: сначала актуальный заказ (как на экране).
    // sales_docs workorder — запасной, если в сделке пусто (и суммы там с НДС через toStoFillLine).
    if (sid === woDoc?.id && Array.isArray((full as { lines?: unknown[] }).lines)) {
      const dealSplit = splitStoWorkPartLines(
        Array.isArray((deal as { items?: unknown[] }).items)
          ? ((deal as { items: Array<Record<string, unknown>> }).items as Array<
              Record<string, unknown>
            >)
          : []
      );
      const dealHasLines = dealSplit.workLines.length > 0 || dealSplit.partLines.length > 0;
      if (dealHasLines) {
        if (dealSplit.workLines.length) enrich.workLines = dealSplit.workLines;
        if (dealSplit.partLines.length) enrich.partLines = dealSplit.partLines;
      } else {
        const rawLines = ((full as { lines: Array<Record<string, unknown>> }).lines || []).map(
          (l) => ({
            ...l,
            item_kind: String(l.line_kind) === 'work' ? 'service' : 'product',
            line_kind: l.line_kind,
          })
        );
        const split = splitStoWorkPartLines(rawLines);
        if (split.workLines.length) enrich.workLines = split.workLines;
        if (split.partLines.length) enrich.partLines = split.partLines;
      }
    }
  }
  Object.assign(
    enrich,
    handoverFieldsFromDeal(deal, { workorderId: woDoc?.id ? String(woDoc.id) : undefined })
  );

  const baseCtx = dealFillCtx(
    deal,
    org,
    workorderPrintNumber(dealId, String(woDoc?.number || '')) ||
      String(contractDoc?.number || deal.id || dealId),
    enrich
  );
  const templateIds = resolveStoFullPackTemplateIds(deal, { organizationId: orgId });
  const parts: PackPart[] = [];
  const sellerInn = String(org.inn || '');

  for (const tid of templateIds) {
    const isContract = tid.startsWith('sto-contract');
    const isWo = tid.startsWith('sto-workorder');
    const num =
      (isContract && contractDoc && String(contractDoc.number || '')) ||
      (isWo ? workorderPrintNumber(dealId, woDoc?.number) : '') ||
      String(baseCtx.number || '');
    const part = await templatePartAsync(
      tid,
      dealFillCtx(deal, org, num, enrich),
      sellerInn
    );
    if (part) parts.push(part);
  }

  return {
    deal,
    org,
    parts,
    blanks: listStoPackBlankFields(baseCtx, deal),
    dealLabel: String(deal.number || deal.name || dealId).trim(),
    fillCtx: baseCtx,
  };
}

/** Мета пакета без генерации PDF — пустые поля + состав бланков + реквизиты покупателя. */
export async function inspectDealStoFullPack(
  dealId: string,
  opts?: { organizationId?: string }
): Promise<{
  blanks: Array<{ key: string; label: string }>;
  parts: string[];
  buyer: {
    name: string;
    inn: string;
    kpp: string;
    ogrn: string;
    address: string;
    phone: string;
    email: string;
    passport: string;
    director: string;
    bank: string;
    bik: string;
    rs: string;
    ks: string;
  };
  template_source?: string;
  template_source_label?: string;
  seller_inn?: string;
  extra_docs?: typeof STO_EXTRA_DEAL_DOCS;
} | null> {
  const prep = await prepareStoFullPack(dealId, opts);
  if (!prep) return null;
  const ctx = prep.fillCtx;
  const sources = [...new Set(prep.parts.map((p) => p.source).filter(Boolean))] as string[];
  const joined = sources.join(',') || undefined;
  return {
    blanks: prep.blanks,
    parts: prep.parts.map((p) => `${p.code} ${p.title}`),
    buyer: {
      name: String(ctx.buyerName || ''),
      inn: String(ctx.buyerInn || ''),
      kpp: String(ctx.buyerKpp || ''),
      ogrn: String(ctx.buyerOgrn || ''),
      address: String(ctx.buyerAddress || ''),
      phone: String(ctx.buyerPhone || ''),
      email: String(ctx.buyerEmail || ''),
      passport: String(ctx.buyerPassport || ''),
      director: String(ctx.buyerDirector || ''),
      bank: String(ctx.buyerBank || ''),
      bik: String(ctx.buyerBik || ''),
      rs: String(ctx.buyerRs || ''),
      ks: String(ctx.buyerKs || ''),
    },
    template_source: joined,
    template_source_label: stoTemplateSourceLabel(joined),
    seller_inn: String(prep.org.inn || ''),
    extra_docs: STO_EXTRA_DEAL_DOCS,
  };
}

export async function buildDealStoFullPackPdf(
  dealId: string,
  opts?: {
    organizationId?: string;
    facsimile?: FacsimileFlags;
    staffName?: string;
    actor?: import('./auth.js').Actor | null;
  }
): Promise<{ buffer: Buffer; filename: string; parts: string[]; blanks: Array<{ key: string; label: string }> } | null> {
  const prep = await prepareStoFullPack(dealId, opts);
  if (!prep) return null;

  const facsimile: FacsimileFlags = opts?.facsimile ?? { stamp: true, sign: true };
  const font = findFont('DejaVuSans.ttf');
  const fontBold = findFont('DejaVuSans-Bold.ttf');
  const { org, parts, blanks, dealLabel } = prep;

  const buffer = await runWithOrgFacsimileAsync(facsimile, async () =>
    new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({
        size: 'A4',
        margin: 48,
        autoFirstPage: false,
        info: { Title: `Пакет СТО · заказ ${dealLabel}` },
      });
      const chunks: Buffer[] = [];
      pdf.on('data', (c) => chunks.push(c as Buffer));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);

      for (const p of parts) {
        if (!p.text) continue;
        const copies = copiesForPart(p.id);
        for (let copy = 0; copy < copies; copy++) {
          writeTextBlock(
            pdf,
            font,
            fontBold,
            p.title,
            p.code,
            p.text,
            copies > 1 ? stoPrintCopyLabel(copy) : undefined,
            org,
            facsimile
          );
        }
      }

      pdf.end();
    })
  );

  // Печать полного пакета = ЗН считается распечатанным (гейт оплаты)
  try {
    const wo = listSalesDocs({ dealId, limit: 50 }).items.find(
      (d) => String(d.doc_type) === 'workorder'
    );
    if (wo?.id) {
      markSalesDocPrinted(String(wo.id), { actor: opts?.actor ?? null, via: 'sto-pack.pdf' });
    }
  } catch {
    /* non-fatal */
  }

  const safe = String(dealLabel)
    .replace(/[^\w.\-]+/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  const asciiSafe = safe.replace(/[^\x20-\x7E]+/g, '_') || String(dealId).replace(/[^\w.-]+/g, '_');
  return {
    buffer,
    filename: `Paket_STO_${asciiSafe || 'deal'}.pdf`,
    parts: parts.map((p) => `${p.code} ${p.title}`),
    blanks,
  };
}

/** PDF только согласия ПДн (физлицо) — 1 экз. Вёрстка из DOCX (Drive), без пересборки. */
export async function buildDealStoPdnPdf(
  dealId: string,
  opts?: { organizationId?: string; facsimile?: FacsimileFlags }
): Promise<{ buffer: Buffer; filename: string } | null> {
  const prep = await prepareStoFullPack(dealId, opts);
  if (!prep) return null;
  if (resolveBuyerForm(prep.deal) !== 'person') {
    throw new Error('Согласие ПДн только для физлица');
  }
  const dealNumber = String(
    prep.deal.number || prep.deal.amo_id || prep.deal.id || dealId
  ).trim();
  const fioCtx = dealFillCtx(prep.deal, prep.org, dealNumber);
  if (!looksLikePersonFio(String(fioCtx.buyerName || ''))) {
    throw new Error(
      'Для согласия ПДн укажите ФИО как в паспорте (фамилия имя отчество) во вкладке «Документы»'
    );
  }

  const asciiSafe =
    String(prep.dealLabel)
      .replace(/[^\x20-\x7E]+/g, '_')
      .replace(/[^\w.\-]+/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || String(dealId).replace(/[^\w.-]+/g, '_');
  const filename = `Soglasie_PDn_${asciiSafe}.pdf`;

  try {
    const docxPdf = await buildStoDocxPdf(STO_PDN_CONSENT, fioCtx, prep.org.inn);
    if (docxPdf?.buffer?.length) {
      return { buffer: docxPdf.buffer, filename };
    }
  } catch (e) {
    console.warn(
      `[sto-pdn] DOCX PDF: ${e instanceof Error ? e.message : e} — fallback PDFKit`
    );
  }

  let pdn = prep.parts.find((p) => p.id === STO_PDN_CONSENT) || null;
  if (!pdn) {
    pdn = await templatePartAsync(
      STO_PDN_CONSENT,
      dealFillCtx(prep.deal, prep.org, dealNumber),
      prep.org.inn
    );
  }
  if (!pdn || !pdn.text) throw new Error('Шаблон согласия ПДн не найден');

  const facsimile: FacsimileFlags = opts?.facsimile ?? { stamp: true, sign: true };
  const font = findFont('DejaVuSans.ttf');
  const fontBold = findFont('DejaVuSans-Bold.ttf');
  const { org, dealLabel } = prep;

  const buffer = await runWithOrgFacsimileAsync(facsimile, async () =>
    new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({
        size: 'A4',
        margin: 48,
        autoFirstPage: false,
        info: { Title: `Согласие ПДн · заказ ${dealLabel}` },
      });
      const chunks: Buffer[] = [];
      pdf.on('data', (c) => chunks.push(c as Buffer));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);

      writeTextBlock(
        pdf,
        font,
        fontBold,
        pdn!.title,
        pdn!.code,
        pdn!.text,
        undefined,
        org,
        facsimile
      );
      pdf.end();
    })
  );

  return { buffer, filename };
}

/** Текст согласия ПДн для SMS-подписи (снимок для доказательства). */
export async function buildDealPdnConsentSnapshot(dealId: string): Promise<{
  dealId: string;
  dealLabel: string;
  buyerName: string;
  phone: string;
  orgInn: string;
  orgName: string;
  consentText: string;
} | null> {
  const prep = await prepareStoFullPack(dealId);
  if (!prep) return null;
  if (resolveBuyerForm(prep.deal) !== 'person') {
    throw new Error('Согласие ПДн только для физлица');
  }
  const dealNumber = String(
    prep.deal.number || prep.deal.amo_id || prep.deal.id || dealId
  ).trim();
  const fioCtx = dealFillCtx(prep.deal, prep.org, dealNumber);
  const buyerName = String(fioCtx.buyerName || '').trim();
  const phone = String(fioCtx.buyerPhone || prep.deal.buyer_phone || '').trim();
  let part = prep.parts.find((p) => p.id === STO_PDN_CONSENT) || null;
  if (!part?.text) {
    part = await templatePartAsync(STO_PDN_CONSENT, fioCtx, prep.org.inn);
  }
  if (!part?.text) throw new Error('Шаблон согласия ПДн не найден');
  return {
    dealId,
    dealLabel: prep.dealLabel,
    buyerName,
    phone,
    orgInn: String(prep.org.inn || '').trim(),
    orgName: String(prep.org.name || prep.org.short_name || '').trim(),
    consentText: String(part.text).trim(),
  };
}

/** PDF доп. бланка по сделке (неявка, чек-лист и т.п.) — текст с Drive. */
export async function buildDealStoExtraPdf(
  dealId: string,
  templateId: string,
  opts?: { organizationId?: string; facsimile?: FacsimileFlags; staffName?: string }
): Promise<{ buffer: Buffer; filename: string; title: string; source?: string } | null> {
  const tid = String(templateId || '').trim();
  if (!isStoExtraDealTemplateId(tid)) {
    throw new Error('Этот бланк не в доп. документах заказа');
  }
  return buildDealStoTemplatePdf(dealId, tid, opts);
}

/**
 * PDF одного бланка СТО по сделке: Drive → макросы → печать/подпись.
 * Договор, ЗН, ПДн, доп. бланки — один пайплайн.
 */
export async function buildDealStoTemplatePdf(
  dealId: string,
  templateId: string,
  opts?: { organizationId?: string; facsimile?: FacsimileFlags; staffName?: string }
): Promise<{ buffer: Buffer; filename: string; title: string; source?: string } | null> {
  const tid = String(templateId || '').trim();
  if (!getStoDocTemplate(tid)) throw new Error('Неизвестный бланк СТО');
  const prep = await prepareStoFullPack(dealId, opts);
  if (!prep) return null;

  // Номер документа: договор / ЗН из sales-docs, иначе контекст пакета
  const sales = listSalesDocs({ dealId, limit: 100 }).items as Array<{
    id: string;
    doc_type?: string;
    number?: string;
  }>;
  const contractDoc = sales.find((d) => String(d.doc_type) === 'contract');
  const woDoc = sales.find((d) => String(d.doc_type) === 'workorder');
  const isContract = tid.startsWith('sto-contract');
  const isWo = tid.startsWith('sto-workorder');
  const num =
    (isContract && contractDoc && String(contractDoc.number || '')) ||
    (isWo ? workorderPrintNumber(dealId, woDoc?.number) : '') ||
    String(prep.fillCtx.number || '');
  const fillCtx = {
    ...prep.fillCtx,
    number: num || prep.fillCtx.number,
    ...(opts?.staffName ? { staffName: opts.staffName } : {}),
  };

  const { org, dealLabel } = prep;
  const asciiSafe =
    String(dealLabel)
      .replace(/[^\x20-\x7E]+/g, '_')
      .replace(/[^\w.\-]+/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || String(dealId).replace(/[^\w.-]+/g, '_');

  // ЗН / договоры / ПДн / акт неявки / чек-лист — из DOCX (вёрстка Drive)
  if (
    tid.startsWith('sto-workorder') ||
    tid.startsWith('sto-contract') ||
    tid === STO_PDN_CONSENT ||
    tid === 'sto-no-show' ||
    tid === 'sto-checklist'
  ) {
    try {
      const docxPdf = await buildStoDocxPdf(tid, fillCtx, org.inn);
      if (docxPdf?.buffer?.length) {
        const fileSlug = tid.startsWith('sto-workorder')
          ? 'Zakaz_naryad'
          : tid.startsWith('sto-contract')
            ? 'Dogovor'
            : tid === 'sto-no-show'
              ? 'Akt_neyavka'
              : tid === 'sto-checklist'
                ? 'Checklist'
                : 'Soglasie_PDn';
        return {
          buffer: docxPdf.buffer,
          filename: `${fileSlug}_${asciiSafe}.pdf`,
          title: getStoDocTemplate(tid)?.title || tid,
          source: docxPdf.source,
        };
      }
    } catch (e) {
      console.warn(
        `[sto-template] DOCX PDF ${tid}: ${e instanceof Error ? e.message : e} — fallback PDFKit`
      );
    }
  }

  const part = await templatePartAsync(tid, fillCtx, prep.org.inn);
  if (!part?.text) throw new Error('Шаблон не найден или пуст');

  const facsimile: FacsimileFlags = opts?.facsimile ?? { stamp: true, sign: true };
  const font = findFont('DejaVuSans.ttf');
  const fontBold = findFont('DejaVuSans-Bold.ttf');
  const copies = copiesForPart(tid);

  const buffer = await runWithOrgFacsimileAsync(facsimile, async () =>
    new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({
        size: 'A4',
        margin: 48,
        autoFirstPage: false,
        info: { Title: `${part.title} · заказ ${dealLabel}` },
      });
      const chunks: Buffer[] = [];
      pdf.on('data', (c) => chunks.push(c as Buffer));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);

      for (let copy = 0; copy < copies; copy++) {
        writeTextBlock(
          pdf,
          font,
          fontBold,
          part.title,
          part.code,
          part.text,
          copies > 1 ? stoPrintCopyLabel(copy) : undefined,
          org,
          facsimile
        );
      }
      pdf.end();
    })
  );

  const fileSlug =
    tid === 'sto-no-show'
      ? 'Akt_neyavka'
      : tid === 'sto-checklist'
        ? 'Checklist'
        : tid === STO_PDN_CONSENT
          ? 'Soglasie_PDn'
          : tid.startsWith('sto-workorder')
            ? 'Zakaz_naryad'
            : tid.startsWith('sto-contract')
              ? 'Dogovor'
              : 'STO';

  return {
    buffer,
    filename: `${fileSlug}_${asciiSafe}.pdf`,
    title: part.title,
    source: part.source,
  };
}
