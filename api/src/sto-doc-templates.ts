/**
 * Пакет документов СТО (ТО и ремонт АМТС) — Правила № 780.
 * Оригиналы DOCX + текст: api/assets/sto-templates/
 * Регламент: docs/STO-DOCUMENTS.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OrgProfile } from './organizations.js';
import { getOrgProfile, resolveOrganizationId } from './organizations.js';
import {
  INN_BMP,
  INN_BRP,
  mikhailBothSitesBlurb,
  resolveStoSiteId,
  stoSiteById,
} from './sto-sites.js';
import { orgFacsimileCss, orgFacsimileSignBlockHtml } from './org-stamp.js';
import {
  dealIsLegalBuyerForm,
  resolveDealMethodKey,
  resolveDealPayKey,
  resolveIsSto,
  resolvePaymentScheme,
} from './deal-sale-rules.js';
import { CONTRACT_TEMPLATE_ID } from './sale-contract.js';
import {
  renderStoWorkorderLegalHtml,
  renderStoWorkorderPersonHtml,
} from './sto-workorder-html.js';
import { stoDocPrintCss, duplicateStoHtmlForPrint } from './sto-doc-style.js';
import { amoUserDisplayName } from './staff.js';
import { get } from './db.js';
import { parseStoChecklistJson } from './sto-intake-checklist.js';
import { woIntakePhotosSummary } from './wo-intake-photos.js';
import {
  formatSteeringRackLegalClause,
  formatSteeringRackTableBlock,
  formatWarrantyGoodsSummary,
  formatWarrantyTableText,
  formatWarrantyWorksTerm,
} from './warranty-settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STO_TEMPLATES_ROOT = path.resolve(__dirname, '../assets/sto-templates');

export const STO_CONTRACT_PERSON = 'sto-contract-person';
export const STO_CONTRACT_LEGAL = 'sto-contract-legal';
/** Рамочный юр. договор Романа (МСК): поставка + ремонт, текст юриста. */
export const STO_CONTRACT_LEGAL_MSK = 'sto-contract-legal-msk';
/** ИНН ИП Безматерных Роман Павлович — Пневмоподвеска · Москва. */
export const STO_SELLER_INN_ROMAN = '231215603728';

/** Только клиентские бланки из загруженных DOCX (6 шт.). */
export const STO_CLIENT_PACK_IDS = [
  'sto-contract-person',
  'sto-contract-legal',
  'sto-workorder-person',
  'sto-workorder-legal',
  'sto-pdn-consent',
] as const;

export type StoDocAudience = 'client' | 'internal';
export type StoDocStage =
  | 'fork'
  | 'intake'
  | 'diagnosis'
  | 'in_progress'
  | 'handover'
  | 'special'
  | 'internal';

export type StoDocTemplate = {
  id: string;
  code: string;
  title: string;
  stage: StoDocStage;
  stageLabel: string;
  audience: StoDocAudience;
  required: boolean;
  when: string;
  txtFile: string;
  docxFile: string;
  /** Если шаблон — договор: id для sales_docs.template_id */
  isContract?: boolean;
  /** Связан с существующим типом sales_docs */
  salesDocType?: 'contract' | 'workorder';
  /**
   * Сколько экземпляров при печати / в полном PDF-пакете.
   * Договор и ЗН — 2 (заказчик + исполнитель); ПДн и служебные — 1.
   */
  printCopies?: number;
};

const STAGE_LABEL: Record<StoDocStage, string> = {
  fork: '1. Развилка — кто клиент',
  intake: '2. Приём автомобиля',
  diagnosis: '3. Диагностика',
  in_progress: '4. В процессе ремонта',
  handover: '5. Выдача автомобиля',
  special: '6. Отдельные ситуации',
  internal: 'Служебные (не для клиента)',
};

export const STO_DOC_TEMPLATES: StoDocTemplate[] = [
  {
    id: STO_CONTRACT_PERSON,
    code: '01',
    title: 'Договор-оферта для физлица',
    stage: 'fork',
    stageLabel: STAGE_LABEL.fork,
    audience: 'client',
    required: true,
    when:
      'Клиент — физлицо (личные нужды): публичная оферта + акцепт заказ-нарядом (ЗоЗПП + Правила № 780).',
    txtFile: '01-contract-person.txt',
    docxFile: '01-contract-person.docx',
    isContract: true,
    salesDocType: 'contract',
    printCopies: 2,
  },
  {
    id: STO_CONTRACT_LEGAL,
    code: '02',
    title: 'Договор для юрлица и ИП',
    stage: 'fork',
    stageLabel: STAGE_LABEL.fork,
    audience: 'client',
    required: true,
    when:
      'Клиент — юрлицо/ИП (Михаил / СТО). Рамочный договор ТО + заказ-наряды + приложения.',
    txtFile: '02-contract-legal.txt',
    docxFile: '02-contract-legal.docx',
    isContract: true,
    salesDocType: 'contract',
    printCopies: 2,
  },
  {
    id: STO_CONTRACT_LEGAL_MSK,
    code: '02',
    title: 'Договор для юрлица и ИП (Москва)',
    stage: 'fork',
    stageLabel: STAGE_LABEL.fork,
    audience: 'client',
    required: true,
    when:
      'Роман (Москва): рамочный договор поставки товара и услуг по ремонту (текст юриста).',
    txtFile: '02-contract-legal-msk.txt',
    docxFile: '02-contract-legal-msk.docx',
    isContract: true,
    salesDocType: 'contract',
    printCopies: 2,
  },
  {
    id: 'sto-workorder',
    code: '03',
    title: 'Заказ-наряд (общий)',
    stage: 'intake',
    stageLabel: STAGE_LABEL.intake,
    audience: 'client',
    required: true,
    when: 'Всегда на каждое обращение. Фактически печатается форма для физлица или юрлица — см. 03ф / 03ю.',
    txtFile: '03-workorder.txt',
    docxFile: '03-workorder.docx',
    salesDocType: 'workorder',
    printCopies: 2,
  },
  {
    id: 'sto-workorder-person',
    code: '03ф',
    title: 'Заказ-наряд для физлица',
    stage: 'intake',
    stageLabel: STAGE_LABEL.intake,
    audience: 'client',
    required: true,
    when: 'Физлицо: единый бланк ЗН + приём/осмотр/сдача/гарантия; акцепт договора-оферты.',
    txtFile: '03-workorder-person.txt',
    docxFile: '03-workorder-person.docx',
    salesDocType: 'workorder',
    printCopies: 2,
  },
  {
    id: 'sto-workorder-legal',
    code: '03ю',
    title: 'Заказ-наряд для юрлица и ИП',
    stage: 'intake',
    stageLabel: STAGE_LABEL.intake,
    audience: 'client',
    required: true,
    when: 'Юрлицо/ИП: приложение № 1 к рамочному договору 02.',
    txtFile: '03-workorder-legal.txt',
    docxFile: '03-workorder-legal.docx',
    salesDocType: 'workorder',
    printCopies: 2,
  },
  {
    id: 'sto-no-show',
    code: '10',
    title: 'Акт о неявке заказчика',
    stage: 'special',
    stageLabel: STAGE_LABEL.special,
    audience: 'client',
    required: false,
    when: 'Клиент не забирает авто после уведомления о готовности.',
    txtFile: '10-no-show.txt',
    docxFile: '10-no-show.docx',
  },
  {
    id: 'sto-pdn-consent',
    code: '11',
    title: 'Согласие на обработку персональных данных',
    stage: 'special',
    stageLabel: STAGE_LABEL.special,
    audience: 'client',
    required: true,
    when:
      'Только физлицо на СТО отдельным документом (152-ФЗ). Не вшивать в договор/ЗН. У юрлица / ИП не берём.',
    txtFile: '11-pdn-consent.txt',
    docxFile: '11-pdn-consent.docx',
    printCopies: 1,
  },
  {
    id: 'sto-legal-note',
    code: '12',
    title: 'Правовая справка (нормативка и практика)',
    stage: 'internal',
    stageLabel: STAGE_LABEL.internal,
    audience: 'internal',
    required: false,
    when: 'Для владельца / юриста. Не для клиента.',
    txtFile: '12-legal-note.txt',
    docxFile: '12-legal-note.docx',
  },
  {
    id: 'sto-order',
    code: '13',
    title: 'Приказ об утверждении форм документов',
    stage: 'internal',
    stageLabel: STAGE_LABEL.internal,
    audience: 'internal',
    required: true,
    when: 'Один раз при запуске пакета.',
    txtFile: '13-order.txt',
    docxFile: '13-order.docx',
  },
  {
    id: 'sto-reception-reglament',
    code: '14',
    title: 'Регламент мастера-приёмщика',
    stage: 'internal',
    stageLabel: STAGE_LABEL.internal,
    audience: 'internal',
    required: true,
    when: 'Пошаговая инструкция персонала на приём, доп. работы, выдачу, претензии.',
    txtFile: '14-reception-reglament.txt',
    docxFile: '14-reception-reglament.docx',
  },
  {
    id: 'sto-checklist',
    code: '15',
    title: 'Чек-лист приёма и выдачи автомобиля',
    stage: 'internal',
    stageLabel: STAGE_LABEL.internal,
    audience: 'internal',
    required: true,
    when: 'Контроль по каждому заказ-наряду.',
    txtFile: '15-checklist.txt',
    docxFile: '15-checklist.docx',
  },
  {
    id: 'sto-cheat-sheet',
    code: '00',
    title: 'Шпаргалка: какой документ когда оформлять',
    stage: 'internal',
    stageLabel: STAGE_LABEL.internal,
    audience: 'internal',
    required: false,
    when: 'Краткая карта пакета для персонала.',
    txtFile: '00-cheat-sheet.txt',
    docxFile: '00-cheat-sheet.docx',
  },
  {
    id: 'sto-how-apply',
    code: '00б',
    title: 'Как применяется пакет документов',
    stage: 'internal',
    stageLabel: STAGE_LABEL.internal,
    audience: 'internal',
    required: false,
    when: 'Пояснение к применению форм.',
    txtFile: '00-how-apply.txt',
    docxFile: '00-how-apply.docx',
  },
];

export function listStoDocTemplates(opts?: { audience?: StoDocAudience | 'all' }) {
  const aud = opts?.audience || 'all';
  const allow = new Set<string>(STO_CLIENT_PACK_IDS);
  return STO_DOC_TEMPLATES.filter(
    (t) => allow.has(t.id) && (aud === 'all' || t.audience === aud)
  ).map((t) => ({
    ...t,
    key_rule: 'Нет подписанного документа — нет работ.',
  }));
}

export function getStoDocTemplate(id: string): StoDocTemplate | null {
  return STO_DOC_TEMPLATES.find((t) => t.id === id) || null;
}

/** Сколько экземпляров печатать / класть в PDF-пакет (по умолчанию 1). */
export function stoTemplatePrintCopies(id: string): number {
  const n = getStoDocTemplate(id)?.printCopies;
  if (typeof n === 'number' && Number.isFinite(n) && n >= 1) return Math.min(10, Math.floor(n));
  return 1;
}

export function isStoContractTemplateId(id: string | null | undefined): boolean {
  const s = String(id || '').trim();
  return (
    s === STO_CONTRACT_PERSON || s === STO_CONTRACT_LEGAL || s === STO_CONTRACT_LEGAL_MSK
  );
}

export function isStoLegalContractTemplateId(id: string | null | undefined): boolean {
  const s = String(id || '').trim();
  return s === STO_CONTRACT_LEGAL || s === STO_CONTRACT_LEGAL_MSK;
}

/** БМП (товар / услуги) или бланки СТО (01/02). */
export function isSaleContractTemplateId(id: string | null | undefined): boolean {
  const s = String(id || '').trim();
  return isStoContractTemplateId(s) || s === CONTRACT_TEMPLATE_ID;
}

export function dealHasBuyerCompany(deal: Record<string, unknown> | null | undefined): boolean {
  if (!deal) return false;
  if (String(deal.company_id || '').trim()) return true;
  return Number(deal.amo_company_id || 0) > 0;
}

function mergeDealBuyerInn(
  deal: Record<string, unknown> | null | undefined,
  opts?: { buyerInn?: string; partyKind?: string; companyId?: string | number }
): Record<string, unknown> {
  const base: Record<string, unknown> = deal ? { ...deal } : {};
  const inn =
    String(opts?.buyerInn || '').replace(/\D/g, '') ||
    String(base.buyer_inn || '').replace(/\D/g, '');
  if (inn) base.buyer_inn = inn;
  const pk = String(opts?.partyKind || base.party_kind || '').toLowerCase();
  if (pk === 'ip' || pk === 'legal') base.party_kind = pk;
  const co = opts?.companyId ?? base.company_id ?? base.amo_company_id;
  if (co != null && String(co).trim() !== '') {
    base.company_id = String(co).trim();
  }
  return base;
}

function contractBuyerLooksLegal(
  deal: Record<string, unknown> | null | undefined,
  opts?: { buyerInn?: string; partyKind?: string; companyId?: string | number }
): boolean {
  const ctx = mergeDealBuyerInn(deal, opts);
  const pk = String(ctx.party_kind || '').toLowerCase();
  if (pk === 'ip' || pk === 'legal') return true;
  return dealIsLegalBuyerForm(ctx);
}

export function isStoWorkorderTemplateId(id: string | null | undefined): boolean {
  const s = String(id || '').trim();
  return (
    s === 'sto-workorder-person' ||
    s === 'sto-workorder-legal' ||
    s === 'sto-workorder'
  );
}

export const STO_PDN_CONSENT = 'sto-pdn-consent';

function dealLooksLegal(deal: Record<string, unknown>): boolean {
  return dealIsLegalBuyerForm(deal);
}

/** Выбор договора ТО (01/02) по типу покупателя — всегда, не только для СТО.
 *  Юр + продавец Роман (МСК) → рамочный юриста (поставка и ремонт). */
export const STO_WORKORDER_PERSON = 'sto-workorder-person';
export const STO_WORKORDER_LEGAL = 'sto-workorder-legal';

/** Заказ-наряд: физ / юр по покупателю. */
export function suggestStoWorkorderTemplateId(deal: Record<string, unknown> | null | undefined): string {
  if (!deal) return STO_WORKORDER_PERSON;
  return dealLooksLegal(deal) ? STO_WORKORDER_LEGAL : STO_WORKORDER_PERSON;
}

/**
 * Договор по сделке:
 * — товар / отправка / самовывоз + юр/ИП → рамочный БМП (Google / bmp-goods-services);
 * — автосервис + физлицо без компании → оферта СТО (01);
 * — автосервис + юр/ИП → договор СТО (02).
 */
export function suggestContractTemplateId(
  deal: Record<string, unknown> | null | undefined,
  opts?: {
    organizationId?: string;
    sellerInn?: string;
    buyerInn?: string;
    partyKind?: string;
    companyId?: string | number;
  }
): string {
  const ctx = mergeDealBuyerInn(deal, opts);
  const legal = contractBuyerLooksLegal(deal, opts);
  const isSto = resolveIsSto(ctx);
  if (!isSto) return legal ? CONTRACT_TEMPLATE_ID : STO_CONTRACT_PERSON;
  if (legal) return suggestStoContractTemplateId(ctx, opts);
  if (!dealHasBuyerCompany(ctx)) return STO_CONTRACT_PERSON;
  return STO_CONTRACT_PERSON;
}

export function suggestStoContractTemplateId(
  deal: Record<string, unknown> | null | undefined,
  opts?: { organizationId?: string; sellerInn?: string }
): string {
  if (!deal) return STO_CONTRACT_PERSON;
  if (!dealLooksLegal(deal)) return STO_CONTRACT_PERSON;
  let inn = String(opts?.sellerInn || '')
    .replace(/\D/g, '')
    .trim();
  if (!inn) {
    try {
      const orgId = resolveOrganizationId(
        opts?.organizationId ||
          String(deal.organization_id || deal.org_id || '').trim() ||
          undefined
      );
      inn = String(getOrgProfile(orgId)?.inn || '')
        .replace(/\D/g, '')
        .trim();
    } catch {
      /* нет орг — общий юр-бланк СТО */
    }
  }
  if (inn === STO_SELLER_INN_ROMAN) return STO_CONTRACT_LEGAL;
  return STO_CONTRACT_LEGAL;
}

function safeJoin(root: string, file: string): string {
  const base = path.basename(file);
  const full = path.resolve(root, base);
  if (!full.startsWith(path.resolve(root) + path.sep) && full !== path.resolve(root)) {
    throw new Error('bad path');
  }
  return full;
}

export function readStoTemplateText(id: string): string | null {
  const t = getStoDocTemplate(id);
  if (!t) return null;
  const p = safeJoin(path.join(STO_TEMPLATES_ROOT, 'txt'), t.txtFile);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

export function stoTemplateDocxPath(id: string): string | null {
  const t = getStoDocTemplate(id);
  if (!t) return null;
  const p = safeJoin(path.join(STO_TEMPLATES_ROOT, 'docx'), t.docxFile);
  return fs.existsSync(p) ? p : null;
}

/** Строка работ / ЗЧ для разделов 4–5 заказ-наряда. */
export type StoFillLine = {
  name: string;
  sku?: string;
  qty: number;
  price: number;
  amount: number;
};

/** Строка перечня ТС (прил. к договору юр) — из СТС / гаража. */
export type StoVehicleLine = {
  brand?: string;
  model?: string;
  plate?: string;
  vin?: string;
  year?: string;
  /** Основание владения, напр. «СТС 99 АА 123456» */
  ownership?: string;
  stsNumber?: string;
};

export type StoFillContext = {
  number?: string;
  docDate?: string;
  org?: OrgProfile;
  buyerName?: string;
  buyerInn?: string;
  buyerAddress?: string;
  buyerPhone?: string;
  buyerEmail?: string;
  buyerPassport?: string;
  buyerKpp?: string;
  buyerOgrn?: string;
  buyerDirector?: string;
  buyerBank?: string;
  buyerBik?: string;
  buyerRs?: string;
  buyerKs?: string;
  /** Серия/номер СТС (свидетельство о регистрации ТС) */
  carStsNumber?: string;
  carBrand?: string;
  carModel?: string;
  carPlate?: string;
  carVin?: string;
  carYear?: string;
  carColor?: string;
  carMileage?: string;
  /** Приёмка: уровень топлива, строки 3.2–3.4 */
  carFuelLevel?: string;
  completenessLine?: string;
  keysDocsLine?: string;
  damageNotes?: string;
  completenessChecked?: string[];
  completenessOther?: string;
  keysCount?: string;
  docsLeft?: string;
  docsNote?: string;
  city?: string;
  /** Перечень ТС для {{ТаблицаТС}} (из гаража / СТС) */
  vehicles?: StoVehicleLine[];
  /** Раздел 4 — услуги / работы */
  workLines?: StoFillLine[];
  /** Раздел 5 — запасные части Исполнителя */
  partLines?: StoFillLine[];
  /** Раздел 6 — ЗЧ Заказчика; если пусто — в DOCX/PDF фраза «не предоставлялись» */
  clientPartLines?: StoFillLine[];
  /** П. 7.2 физлицо — уже с ☑/☐ из сделки (amo_payment_type / amo_pay_method) */
  paymentOrder?: string;
  paymentForm?: string;
  /** П. 7.2 юрлицо / ИП */
  paymentOrderLegal?: string;
  paymentFormLegal?: string;
  /** Срок передачи товара / оказания услуг (заявка, ЗН) — текст или длинная дата */
  deliveryDue?: string;
  /** П. 10.3 — факт оплаты при выдаче */
  payment103?: string;
  payment103Legal?: string;
  /** П. 10.4 — комплектность / фото при выдаче */
  handover104?: string;
  handover104Legal?: string;
  /** Кол-во фото в деле ЗН (приём) — для п. 3.5 */
  intakePhotoCount?: number;
  /** П. 9.4 — обращение к заказчику (дата/время + способ со сделки) */
  contact94?: string;
  contact94Legal?: string;
  /** Заявленные неисправности = Amo «Жалоба клиента»; пусто — ничего не писать */
  faults?: string;
  /** Мастер-приёмщик / {{Сотрудник}} */
  staffName?: string;
  /** Кто пригнал ТС на СТО (представитель) */
  carBroughtBy?: string;
  /** Основание полномочий: доверенность / приказ / … */
  carAuthorityBasis?: string;
  carAuthorityDetails?: string;
  /** Готовая строка для §1.5 ЗН */
  carAuthorityLine?: string;
  /** Момент приёмки = дата/время первого фото авто (ISO) */
  intakeAt?: string;
};

function moneyRu(n: number): string {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

function qtyRu(n: number): string {
  const v = Number(n) || 0;
  if (Number.isInteger(v)) return String(v);
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

function toStoFillLine(it: Record<string, unknown>): StoFillLine {
  const qty = Math.round(Number(it.qty) || 0);
  const price = Math.round(Number(it.price) || 0);
  const amountRaw = Number(it.amount);
  const vatRaw = Number(it.vat_amount);
  // sales_docs: amount = без НДС, vat_amount = НДС; в бланке ЗН клиенту — как в заказе (с НДС)
  const hasVatSplit = Number.isFinite(vatRaw) && Math.abs(vatRaw) > 0.0001;
  let amount: number;
  if (hasVatSplit && Number.isFinite(amountRaw)) {
    amount = Math.round(amountRaw + vatRaw);
  } else if (Number.isFinite(amountRaw) && Math.abs(amountRaw) > 0.0001) {
    amount = Math.round(amountRaw);
  } else {
    amount = Math.round(qty * price);
  }
  // Цена за ед.: если в sales_docs price=0, а сумма есть — восстановить из валовой суммы
  const unit =
    price > 0
      ? price
      : qty > 0 && amount > 0
        ? Math.round(amount / qty)
        : price;
  const name = String(it.display_name || it.name || '').trim();
  const sku = String(it.sku || it.code || '').trim();
  return { name, sku: sku || undefined, qty, price: unit, amount };
}

function isWorkItem(it: Record<string, unknown>): boolean {
  const kind = String(it.item_kind || it.line_kind || '').toLowerCase();
  if (kind === 'service' || kind === 'work') return true;
  if (kind === 'product' || kind === 'goods') return false;
  const unit = String(it.unit || '').toLowerCase().replace(/\./g, '');
  if (unit === 'усл' || unit === 'услуга' || unit === 'услуг' || unit === 'н/ч' || unit === 'нч') return true;
  return false;
}

/** Разделить позиции заказа / документа на работы и ЗЧ. */
export function splitStoWorkPartLines(
  items: Array<Record<string, unknown>> | undefined | null
): { workLines: StoFillLine[]; partLines: StoFillLine[] } {
  const list = Array.isArray(items) ? items : [];
  const workLines: StoFillLine[] = [];
  const partLines: StoFillLine[] = [];
  for (const it of list) {
    const line = toStoFillLine(it as Record<string, unknown>);
    if (!line.name && !line.amount) continue;
    if (isWorkItem(it as Record<string, unknown>)) workLines.push(line);
    else partLines.push(line);
  }
  // Нет разметки вида — если все «product», но есть только услуги по имени, уже в isWorkItem;
  // если всё попало в parts и работ 0, а позиции есть — не тащим товары в работы.
  return { workLines, partLines };
}

/** Текстовая таблица работ для {{ТаблицаРабот}}. Без строк — фраза вместо пустой таблицы. */
export const STO_WORKS_NONE_TEXT =
  'Работы (услуги) по настоящему заказ-наряду не заказывались и не оказывались.';

export function formatStoWorksTableText(lines: StoFillLine[] | undefined, minRows = 4): string {
  const filled = (lines || []).filter((l) => String(l.name || '').trim());
  if (!filled.length) return STO_WORKS_NONE_TEXT;
  const rows = [...filled];
  while (rows.length < minRows) {
    rows.push({ name: '', qty: 0, price: 0, amount: 0 });
  }
  return rows
    .map((l, i) => {
      if (!l.name) return `${i + 1}\t\t\t\t`;
      return `${i + 1}\t${l.name}\t${qtyRu(l.qty)}\t${moneyRu(l.price)}\t${moneyRu(l.amount)}`;
    })
    .join('\n');
}

/** Текстовая таблица ЗЧ для {{ТаблицаЗЧИсполнителя}}. */
export function formatStoPartsTableText(lines: StoFillLine[] | undefined, minRows = 3): string {
  const rows = [...(lines || [])];
  while (rows.length < minRows) {
    rows.push({ name: '', qty: 0, price: 0, amount: 0 });
  }
  return rows
    .map((l, i) => {
      if (!l.name) return `${i + 1}\t\t\t\t`;
      const title = l.sku ? `${l.name}, арт. ${l.sku}` : l.name;
      return `${i + 1}\t${title}\t${qtyRu(l.qty)}\t${moneyRu(l.price)}\t${moneyRu(l.amount)}`;
    })
    .join('\n');
}

/** ЗЧ клиента в ЗН — простой нумерованный список без цен/кол-ва. */
export function formatStoClientPartsListText(lines: StoFillLine[] | undefined): string {
  const filled = (lines || []).filter((l) => String(l.name || '').trim());
  if (!filled.length) return '';
  return filled
    .map((l, i) => {
      const title = l.sku ? `${String(l.name).trim()}, арт. ${l.sku}` : String(l.name).trim();
      return `${i + 1}. ${title}`;
    })
    .join('\n');
}

/** Объект ремонта для колонки заявки / ЗН (марка, госномер, VIN). */
export function formatStoRepairObject(ctx: Pick<StoFillContext, 'carBrand' | 'carModel' | 'carPlate' | 'carVin'>): string {
  const brandModel = [ctx.carBrand, ctx.carModel].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
  const plate = String(ctx.carPlate || '').trim();
  const vin = String(ctx.carVin || '').trim();
  const bits = [
    brandModel,
    plate ? `гос. № ${plate}` : '',
    vin ? `VIN ${vin}` : '',
  ].filter(Boolean);
  return bits.join(', ');
}

/**
 * Прил. № 2 (форма заявки) — товары:
 * № | Наименование | Артикул | Кол-во | Цена | Сумма
 */
export function formatStoApplicationGoodsTableText(
  lines: StoFillLine[] | undefined,
  minRows = 3
): string {
  const rows = [...(lines || [])];
  while (rows.length < minRows) {
    rows.push({ name: '', qty: 0, price: 0, amount: 0 });
  }
  return rows
    .map((l, i) => {
      if (!l.name) return `${i + 1}\t\t\t\t\t`;
      return `${i + 1}\t${l.name}\t${l.sku || ''}\t${qtyRu(l.qty)}\t${moneyRu(l.price)}\t${moneyRu(l.amount)}`;
    })
    .join('\n');
}

/**
 * Прил. № 2 (форма заявки) — услуги:
 * № | Наименование | Объект ремонта | Кол-во | Стоимость | Сумма
 */
export function formatStoApplicationServicesTableText(
  lines: StoFillLine[] | undefined,
  repairObject: string,
  minRows = 3
): string {
  const rows = [...(lines || [])];
  while (rows.length < minRows) {
    rows.push({ name: '', qty: 0, price: 0, amount: 0 });
  }
  const obj = String(repairObject || '').trim();
  return rows
    .map((l, i) => {
      if (!l.name) return `${i + 1}\t\t\t\t\t`;
      return `${i + 1}\t${l.name}\t${obj}\t${qtyRu(l.qty)}\t${moneyRu(l.price)}\t${moneyRu(l.amount)}`;
    })
    .join('\n');
}

/** Перечень ТС (прил. к юр. договору) из гаража / СТС: № марка гос.№ VIN год основание. */
export function formatStoVehiclesTableText(
  vehicles: StoVehicleLine[] | undefined,
  minRows = 8
): string {
  const rows = [...(vehicles || [])];
  while (rows.length < minRows) {
    rows.push({});
  }
  return rows
    .map((v, i) => {
      const brand = [v.brand, v.model].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
      const plate = String(v.plate || '').trim();
      const vin = String(v.vin || '').trim();
      const year = String(v.year || '').trim();
      const ownership =
        String(v.ownership || '').trim() ||
        (String(v.stsNumber || '').trim() ? `СТС ${String(v.stsNumber).trim()}` : '');
      if (!brand && !plate && !vin && !year && !ownership) return `${i + 1}\t\t\t\t\t`;
      return `${i + 1}\t${brand}\t${plate}\t${vin}\t${year}\t${ownership}`;
    })
    .join('\n');
}

/** Собрать перечень ТС из гаража сделки или снимка car_* / СТС на заказе. */
export function vehiclesFromDealOrGarage(
  deal?: Record<string, unknown> | null,
  garageVehicles?: Array<Record<string, unknown>> | null
): StoVehicleLine[] {
  const fromGarage = Array.isArray(garageVehicles)
    ? garageVehicles
        .map((v): StoVehicleLine | null => {
          const brand = String(v.car_brand || v.brand || '').trim();
          const model = String(v.car_model || v.model || '').trim();
          const plate = String(v.car_plate || v.plate || '').trim();
          const vin = String(v.car_vin || v.vin || '').trim();
          const year = String(v.car_year || v.year || '').trim();
          const stsNumber = String(v.car_sts_number || v.sts_number || '').trim();
          if (!brand && !model && !plate && !vin) return null;
          return {
            brand,
            model,
            plate,
            vin,
            year,
            stsNumber,
            ownership: stsNumber ? `СТС ${stsNumber}` : '',
          };
        })
        .filter((x): x is StoVehicleLine => x != null)
    : [];
  if (fromGarage.length) return fromGarage;
  if (!deal) return [];
  const brand = String(deal.car_brand || '').trim();
  const model = String(deal.car_model || '').trim();
  const plate = String(deal.car_plate || '').trim();
  const vin = String(deal.car_vin || '').trim();
  const year = String(deal.car_year || '').trim();
  const stsNumber = String(deal.car_sts_number || '').trim();
  if (!brand && !model && !plate && !vin) return [];
  return [
    {
      brand,
      model,
      plate,
      vin,
      year,
      stsNumber,
      ownership: stsNumber ? `СТС ${stsNumber}` : '',
    },
  ];
}

/** П. 10.2 — работы + ЗЧ (№ / наименование / кол-во / стоимость). */
export function formatStoDoneTableText(
  workLines?: StoFillLine[],
  partLines?: StoFillLine[],
  minRows = 3
): string {
  const rows = [...(workLines || []), ...(partLines || [])];
  while (rows.length < minRows) {
    rows.push({ name: '', qty: 0, price: 0, amount: 0 });
  }
  return rows
    .map((l, i) => {
      if (!l.name) return `${i + 1}\t\t\t`;
      const title = l.sku ? `${l.name}, арт. ${l.sku}` : l.name;
      return `${i + 1}\t${title}\t${qtyRu(l.qty)}\t${moneyRu(l.amount)}`;
    })
    .join('\n');
}

export function sumStoLines(lines: StoFillLine[] | undefined): number {
  return (lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
}

function markBox(on: boolean): string {
  return on ? '☑' : '☐';
}

function prepaidAmountFromDeal(deal: Record<string, unknown> | null | undefined): number {
  if (!deal) return 0;
  const payments = Array.isArray(deal.payments) ? deal.payments : [];
  let sum = 0;
  for (const p of payments) {
    const row = p as Record<string, unknown>;
    const st = String(row.status || '')
      .toLowerCase()
      .trim();
    if (!['paid', 'confirmed', 'success', 'accepted'].includes(st)) continue;
    sum += Number(row.amount) || 0;
  }
  if (sum > 0) return sum;
  // запасной: оплаченная часть split
  const split = deal.payment_split as { paid?: number } | undefined;
  if (split && Number(split.paid) > 0) return Number(split.paid);
  return 0;
}

/**
 * П. 7.2 заказ-наряда (физлицо): порядок оплаты со сделки.
 * Источник: amo_payment_type (+ СТО/самовывоз → «на месте» = после приёмки).
 */
export function formatStoPaymentOrder(deal?: Record<string, unknown> | null): string {
  const payK = resolveDealPayKey(deal ?? null);
  const scheme = resolvePaymentScheme(deal ?? null);
  const prepaid = prepaidAmountFromDeal(deal);
  const prepaidStr = prepaid > 0 ? moneyRu(prepaid) : '________';
  const afterAccept = (payK === 'postpay' || payK === 'onsite') && scheme !== 'cod';
  const prepay = payK === 'prepay';
  const other = payK === 'credit' || scheme === 'cod';
  let otherText = '__________________';
  if (scheme === 'cod') {
    const ship = String(deal?.amo_shipment || '').toLowerCase();
    otherText = /авито/.test(ship)
      ? 'оплата при получении (Авито доставка)'
      : 'наложенный платёж (СДЭК / агент)';
  }
  if (payK === 'credit') otherText = 'отсрочка платежа';
  return (
    `${markBox(afterAccept)} после приёмки результата работ  ` +
    `${markBox(prepay)} предварительная оплата ${prepaidStr} руб.  ` +
    `${markBox(other)} иное: ${otherText}`
  );
}

/**
 * П. 7.2 физлицо: форма оплаты (Amo «Наличка» / карта / р/с).
 */
export function formatStoPaymentForm(deal?: Record<string, unknown> | null): string {
  const method = resolveDealMethodKey(deal ?? null);
  const cash = method === 'cash';
  const card = method === 'card' || method === 'cod';
  const bank = method === 'bank' || method === 'delay';
  return (
    `${markBox(cash)} наличными  ` +
    `${markBox(card && !bank)} по карте  ` +
    `${markBox(bank)} безналичный расчёт`
  );
}

/** Полная строка после «7.2. » для физлица */
export function formatStoPaymentClause72(deal?: Record<string, unknown> | null): string {
  return `Порядок оплаты: ${formatStoPaymentOrder(deal)}. Форма оплаты: ${formatStoPaymentForm(deal)}.`;
}

/** П. 7.2 юрлицо / ИП — формулировки бланка 03ю */
export function formatStoPaymentOrderLegal(deal?: Record<string, unknown> | null): string {
  const payK = resolveDealPayKey(deal ?? null);
  const scheme = resolvePaymentScheme(deal ?? null);
  const prepaid = prepaidAmountFromDeal(deal);
  const total =
    Number((deal as { amount?: number } | null | undefined)?.amount) ||
    Number((deal as { total?: number } | null | undefined)?.total) ||
    0;
  let pct = '________';
  if (prepaid > 0 && total > 0) {
    pct = String(Math.min(100, Math.round((prepaid / total) * 100)));
  } else if (payK === 'prepay') {
    pct = '100';
  }
  const prepay = payK === 'prepay';
  const afterFact = (payK === 'postpay' || payK === 'onsite' || scheme === 'cod') && payK !== 'credit';
  const delay = payK === 'credit';
  const delayDays = delay ? '______' : '______';
  return (
    `${markBox(prepay)} предварительная оплата ${pct} %  ` +
    `${markBox(afterFact)} по факту приёмки работ  ` +
    `${markBox(delay)} с отсрочкой ${delayDays} рабочих дней`
  );
}

export function formatStoPaymentFormLegal(deal?: Record<string, unknown> | null): string {
  const method = resolveDealMethodKey(deal ?? null);
  const cash = method === 'cash';
  const bank = !cash; // карта / р/с / отсрочка / COD → безнал в юр. бланке
  return (
    `${markBox(bank)} безналичный расчёт  ` +
    `${markBox(cash)} наличными (в пределах 100 000 руб. по одному договору)`
  );
}

export function formatStoPaymentClause72Legal(deal?: Record<string, unknown> | null): string {
  return `Порядок оплаты: ${formatStoPaymentOrderLegal(deal)}. Форма: ${formatStoPaymentFormLegal(deal)}.`;
}

function paidAndDueFromDeal(deal: Record<string, unknown>): {
  paid: number;
  due: number;
  total: number;
  fully: boolean;
  partial: boolean;
} {
  const split = deal.payment_split as
    | {
        paid_total?: number;
        due_total?: number;
        total?: number;
        fully_paid?: boolean;
        partial?: boolean;
      }
    | undefined;
  const paid =
    Number(split?.paid_total) > 0 ? Number(split!.paid_total) : prepaidAmountFromDeal(deal);
  const total =
    Number(split?.total) > 0
      ? Number(split!.total)
      : Number(deal.price) || Number(deal.amount) || 0;
  const due =
    Number(split?.due_total) >= 0 && split
      ? Number(split.due_total)
      : Math.max(0, total - paid);
  const fully =
    Boolean(split?.fully_paid) ||
    Number(deal.paid) === 1 ||
    (total > 0 && paid + 0.009 >= total);
  const partial = Boolean(split?.partial) || (!fully && paid > 0);
  return { paid, due, total, fully, partial };
}

function dealHasFiscalReceipt(deal: Record<string, unknown>): boolean {
  const receipts = Array.isArray(deal.fiscal_receipts) ? deal.fiscal_receipts : [];
  return receipts.some((r) => {
    const row = r as Record<string, unknown>;
    const st = String(row.status || '')
      .toLowerCase()
      .trim();
    if (['done', 'success', 'printed', 'sent', 'fiscal', 'ok'].includes(st)) return true;
    if (st && !['error', 'fail', 'failed', 'canceled', 'cancelled'].includes(st) && Number(row.amount) > 0) {
      return true;
    }
    return false;
  });
}

function dealSalesDocTypes(deal: Record<string, unknown>): Set<string> {
  const docs = Array.isArray(deal.sales_docs) ? deal.sales_docs : [];
  return new Set(
    docs.map((d) =>
      String((d as { doc_type?: string }).doc_type || '')
        .toLowerCase()
        .trim()
    )
  );
}

/**
 * П. 10.3 физлицо: факт оплаты + форма + кассовый чек.
 */
export function formatStoPaymentClause103(deal?: Record<string, unknown> | null): string {
  if (!deal) return '';
  const { paid, fully, partial } = paidAndDueFromDeal(deal);
  const partialStr = partial && paid > 0 ? moneyRu(paid) : '________';
  const form = formatStoPaymentForm(deal);
  const fiscal = dealHasFiscalReceipt(deal);
  const emailed = fiscal && /@/.test(String(deal.buyer_email || '').trim());
  return (
    `Оплата произведена: ${markBox(fully)} полностью  ${markBox(partial)} частично (${partialStr} руб.). ` +
    `Форма: ${form}. ` +
    `Кассовый чек: ${markBox(fiscal && !emailed)} выдан  ${markBox(emailed)} направлен в электронной форме.`
  );
}

/** П. 10.3 юрлицо: оплачено / к доплате + переданные документы. */
export function formatStoPaymentClause103Legal(deal?: Record<string, unknown> | null): string {
  if (!deal) return '';
  const { paid, due } = paidAndDueFromDeal(deal);
  const types = dealSalesDocTypes(deal);
  const fiscal = dealHasFiscalReceipt(deal);
  return (
    `Расчёты: оплачено ${paid > 0 ? moneyRu(paid) : '________'} руб.; ` +
    `к доплате ${due > 0 ? moneyRu(due) : paid > 0 ? '0,00' : '________'} руб.; ` +
    `срок доплаты: «____» _______ 20____ г. ` +
    `Документы переданы: ${markBox(types.has('invoice'))} счёт  ` +
    `${markBox(types.has('upd'))} универсальный передаточный документ  ` +
    `${markBox(types.has('sf'))} счёт-фактура  ` +
    `${markBox(fiscal)} кассовый чек.`
  );
}

/** Заполнить поля п. 7.2 и 10.3 в StoFillContext из сделки. Без сделки — пусто (бланк с ☐). */
export function paymentFieldsFromDeal(
  deal?: Record<string, unknown> | null
): Pick<
  StoFillContext,
  | 'paymentOrder'
  | 'paymentForm'
  | 'paymentOrderLegal'
  | 'paymentFormLegal'
  | 'payment103'
  | 'payment103Legal'
> {
  if (!deal) return {};
  return {
    paymentOrder: formatStoPaymentOrder(deal),
    paymentForm: formatStoPaymentForm(deal),
    paymentOrderLegal: formatStoPaymentOrderLegal(deal),
    paymentFormLegal: formatStoPaymentFormLegal(deal),
    payment103: formatStoPaymentClause103(deal),
    payment103Legal: formatStoPaymentClause103Legal(deal),
  };
}

function workorderRowForDeal(dealId: string): { id: string; checklist_json: string } | null {
  const id = String(dealId || '').trim();
  if (!id) return null;
  return (
    get<{ id: string; checklist_json: string }>(
      `SELECT id, IFNULL(checklist_json,'') AS checklist_json
       FROM sales_docs
       WHERE deal_id = ? AND doc_type = 'workorder'
       ORDER BY datetime(created_at) DESC
       LIMIT 1`,
      [id]
    ) || null
  );
}

/**
 * П. 10.4: комплектность = чек-лист выдачи (qc_done / handover_act);
 * фото = число снимков в деле ЗН.
 */
export function formatStoHandover104(
  opts?: {
    matchOk?: boolean | null;
    photoCount?: number;
    vehicleWord?: 'АМТС' | 'транспортного средства';
  }
): string {
  const yes = opts?.matchOk === true;
  const no = opts?.matchOk === false;
  const n =
    opts?.photoCount != null && Number(opts.photoCount) > 0
      ? String(Math.floor(Number(opts.photoCount)))
      : '____';
  const vehicle = opts?.vehicleWord || 'АМТС';
  return (
    `Комплектность и внешнее состояние ${vehicle} при выдаче соответствуют зафиксированным при приёме: ` +
    `${markBox(yes)} да  ${markBox(no)} нет (замечания ниже). ` +
    `Фотофиксация при выдаче: ${n} снимков.`
  );
}

/** П. 10.4 (+ опционально счётчик фото для 3.5) из сделки / ЗН. */
export function handoverFieldsFromDeal(
  deal?: Record<string, unknown> | null,
  opts?: { workorderId?: string }
): Pick<StoFillContext, 'handover104' | 'handover104Legal' | 'intakePhotoCount'> {
  if (!deal) return {};
  const dealId = String(deal.id || '').trim();
  let woId = String(opts?.workorderId || '').trim();
  let checklistRaw = '';
  if (woId) {
    const row = get<{ checklist_json: string }>(
      `SELECT IFNULL(checklist_json,'') AS checklist_json FROM sales_docs WHERE id = ? AND doc_type = 'workorder'`,
      [woId]
    );
    checklistRaw = String(row?.checklist_json || '');
  } else if (dealId) {
    const row = workorderRowForDeal(dealId);
    if (row) {
      woId = row.id;
      checklistRaw = row.checklist_json;
    }
  }
  const checks = parseStoChecklistJson(checklistRaw).checks || {};
  let matchOk: boolean | null = null;
  if (checks.qc_done || checks.handover_act || checks.folder_complete) {
    matchOk = true;
  }
  const photoCount = woId ? woIntakePhotosSummary(woId).count : 0;
  // если фото есть, а чек-лист ещё пуст — не ставим «нет», оставляем бланк по комплектности,
  // но число снимков подставляем (дело уже содержит фото)
  return {
    handover104: formatStoHandover104({
      matchOk,
      photoCount,
      vehicleWord: 'АМТС',
    }),
    handover104Legal: formatStoHandover104({
      matchOk,
      photoCount,
      vehicleWord: 'транспортного средства',
    }),
    intakePhotoCount: photoCount > 0 ? photoCount : undefined,
  };
}

/** Часы/минуты в Europe/Moscow. */
function formatRuTimeHm(at: Date): { h: string; m: string } {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const h = parts.find((p) => p.type === 'hour')?.value || '____';
  const m = parts.find((p) => p.type === 'minute')?.value || '____';
  return { h, m };
}

function moscowDateIso(at: Date): string {
  // en-CA → YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function dealHasPhone(deal: Record<string, unknown>): boolean {
  return String(deal.buyer_phone || '')
    .replace(/\D/g, '')
    .replace(/^8/, '7').length >= 10;
}

function dealHasEmail(deal: Record<string, unknown>): boolean {
  return /@/.test(String(deal.buyer_email || '').trim());
}

/**
 * Способ обращения п. 9.4 (физлицо) — по контактам сделки.
 * Телефон → звонок; иначе e-mail; иначе бланк ☐.
 */
export function formatStoContactMethodPerson(deal?: Record<string, unknown> | null): string {
  const phone = deal ? dealHasPhone(deal) : false;
  const email = deal ? dealHasEmail(deal) : false;
  const call = phone;
  const mail = !phone && email;
  return (
    `${markBox(false)} лично  ` +
    `${markBox(call)} телефонный звонок (запись разговора сохранена)  ` +
    `${markBox(false)} СМС  ` +
    `${markBox(false)} мессенджер  ` +
    `${markBox(mail)} электронная почта`
  );
}

/** Способ обращения п. 9.4 (юрлицо) + адресат. */
export function formatStoContactMethodLegal(deal?: Record<string, unknown> | null): string {
  const phone = deal ? dealHasPhone(deal) : false;
  const email = deal ? dealHasEmail(deal) : false;
  const call = phone;
  const mail = !phone && email;
  const addressee =
    String(deal?.buyer_director || deal?.buyer_name || '').trim() ||
    '________________________';
  return (
    `${markBox(false)} лично  ` +
    `${markBox(mail)} электронная почта  ` +
    `${markBox(call)} телефонный звонок  ` +
    `${markBox(false)} мессенджер; адресат (Ф. И. О., должность): ${addressee}`
  );
}

/**
 * П. 9.4: дата/время (момент печати, МСК) + способ по контактам сделки.
 */
export function formatStoContact94(
  deal?: Record<string, unknown> | null,
  opts?: { at?: Date; docDate?: string }
): string {
  if (!deal) return '';
  const at = opts?.at || new Date();
  const dateIso = String(opts?.docDate || '').trim().slice(0, 10) || moscowDateIso(at);
  const dateStr = formatRuLongDate(dateIso);
  const { h, m } = formatRuTimeHm(at);
  return `дата ${dateStr}, время ${h} ч ${m} мин; способ: ${formatStoContactMethodPerson(deal)}`;
}

export function formatStoContact94Legal(
  deal?: Record<string, unknown> | null,
  opts?: { at?: Date; docDate?: string }
): string {
  if (!deal) return '';
  const at = opts?.at || new Date();
  const dateIso = String(opts?.docDate || '').trim().slice(0, 10) || moscowDateIso(at);
  const dateStr = formatRuLongDate(dateIso);
  const { h, m } = formatRuTimeHm(at);
  return `дата ${dateStr}, время ${h} ч ${m} мин; способ: ${formatStoContactMethodLegal(deal)}`;
}

/** П. 9.4 в StoFillContext из сделки. */
export function contactFieldsFromDeal(
  deal?: Record<string, unknown> | null,
  opts?: { at?: Date; docDate?: string }
): Pick<StoFillContext, 'contact94' | 'contact94Legal'> {
  if (!deal) return {};
  return {
    contact94: formatStoContact94(deal, opts),
    contact94Legal: formatStoContact94Legal(deal, opts),
  };
}

/**
 * ФИО мастера-приёмщика / {{Сотрудник}}.
 * Приоритет: явный staffName (кто скачал/оформил) → ответственный сделки (Amo → staff).
 */
/** Тех. id, которые нельзя показывать клиенту как «кто». */
function isTechActorToken(s: string): boolean {
  const t = String(s || '').trim().toLowerCase();
  return !t || t === '__admin__' || t === 'система' || t === 'system';
}

export function resolveStaffDisplayName(raw?: string | null): string {
  const s = String(raw || '').trim();
  if (!s || isTechActorToken(s)) return '';
  const byId = get<{ name: string }>(
    `SELECT name FROM staff WHERE id = ? AND IFNULL(name,'') != '' LIMIT 1`,
    [s]
  );
  if (byId?.name) return String(byId.name).trim();
  const byLogin = get<{ name: string }>(
    `SELECT name FROM staff WHERE lower(login) = lower(?) AND IFNULL(name,'') != '' LIMIT 1`,
    [s]
  );
  if (byLogin?.name) return String(byLogin.name).trim();
  const byAuth = get<{ name: string }>(
    `SELECT name FROM staff WHERE lower(auth_login) = lower(?) AND IFNULL(name,'') != '' LIMIT 1`,
    [s]
  );
  if (byAuth?.name) return String(byAuth.name).trim();
  const fromAmo = amoUserDisplayName(s);
  if (fromAmo) return fromAmo;
  return s;
}

/** ФИО из сессии: имя → login → id в staff (не тех. `__admin__`). */
export function actorDisplayName(
  actor?: { id?: string; name?: string; login?: string; isSystemAdmin?: boolean } | null
): string {
  if (!actor) return '';
  const id = String(actor.id || '').trim();
  // Системный админ: всегда человеческое имя из сессии, не id.
  if (id === '__admin__' || actor.isSystemAdmin) {
    const n = String(actor.name || '').trim();
    if (n && !isTechActorToken(n)) return n;
    return 'Админ';
  }
  const fromId = id ? resolveStaffDisplayName(id) : '';
  if (fromId) return fromId;
  const fromName = resolveStaffDisplayName(actor.name);
  if (fromName) return fromName;
  const fromLogin = resolveStaffDisplayName(actor.login);
  if (fromLogin) return fromLogin;
  const name = String(actor.name || '').trim();
  if (name && !isTechActorToken(name)) return name;
  const login = String(actor.login || '').trim();
  if (login && !isTechActorToken(login)) return login;
  return '';
}

export function staffNameFromDeal(deal?: Record<string, unknown> | null): string {
  if (!deal) return '';
  const named = String(deal.responsible_name || '').trim();
  if (named) return named;
  return amoUserDisplayName(String(deal.responsible_user_id || ''));
}

export function staffFieldsFromDeal(
  deal?: Record<string, unknown> | null,
  opts?: { staffName?: string; /** только кто в сессии — без ответственного Amo */ actorOnly?: boolean }
): Pick<StoFillContext, 'staffName'> {
  const fromActor = resolveStaffDisplayName(opts?.staffName);
  if (fromActor) return { staffName: fromActor };
  if (opts?.actorOnly) return {};
  const fromDeal = staffNameFromDeal(deal);
  return fromDeal ? { staffName: fromDeal } : {};
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRuLongDate(iso: string): string {
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return '«____» ______________ 20____ г.';
  const months = [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ];
  return `«${d.getDate()}» ${months[d.getMonth()]} ${d.getFullYear()} г.`;
}

/** ФИО / наименование без префикса «ИП» / «Индивидуальный предприниматель» (для «…предпринимателю {{Организация}}»). */
function orgNameBare(org: { name?: string; short_name?: string; director?: string } | null | undefined): string {
  let n = String(org?.name || org?.short_name || org?.director || '').trim();
  n = n
    .replace(/^Индивидуальный\s+предприниматель\s+/i, '')
    .replace(/^ИП\s+/i, '')
    .trim();
  return n;
}

/** Подстановка реквизитов в текст бланка ({{макросы}} + эвристика по пропускам). */
export function fillStoTemplateText(raw: string, ctx: StoFillContext): string {
  let text = raw
    .replace(/\u2028/g, '\n')
    .replace(/\r\n/g, '\n')
    // TAB в «г. Город ↔ дата» в PDF/DOCX часто рисуется как ☐
    .replace(/\t+/g, '  ');
  const org = ctx.org;
  const dateLine = ctx.docDate ? formatRuLongDate(ctx.docDate) : '';
  const city = (ctx.city || 'Краснодар').trim();
  const brandModel = [ctx.carBrand, ctx.carModel].map((x) => String(x || '').trim()).filter(Boolean).join(' ');

  const orgInn = String(org?.inn || '').replace(/\D/g, '');
  const orgRs = String(org?.rs || '').replace(/\s/g, '');
  let companyCode = '';
  const companyId = org ? String((org as { company_id?: string }).company_id || '').trim() : '';
  if (companyId) {
    const crow = get<{ code?: string }>(`SELECT code FROM companies WHERE id = ? LIMIT 1`, [companyId]);
    companyCode = String(crow?.code || '');
  }
  const siteId = resolveStoSiteId({
    inn: orgInn,
    rs: orgRs,
    companyCode,
    masterTitle: org ? String(org.master_title || '') : '',
  });
  const site = stoSiteById(siteId);
  const bothMp = orgInn === INN_BMP && !orgRs ? mikhailBothSitesBlurb() : null;
  const siteFromOrg = String((org as { site_address?: string })?.site_address || '').trim();
  const hoursFromOrg = String((org as { work_hours?: string })?.work_hours || '').trim();
  const stoAddress =
    siteFromOrg ||
    site?.address ||
    bothMp?.address ||
    (orgInn === INN_BRP ? stoSiteById('mozhayka')!.address : '') ||
    (org ? String(org.address || '') : '') ||
    city;
  const stoPhone =
    site?.phone || bothMp?.phone || (org ? String(org.phone || '') : '');
  const stoEmail =
    site?.email || bothMp?.email || (org ? String((org as { email?: string }).email || '') : '');
  const stoHours =
    hoursFromOrg ||
    site?.hours ||
    bothMp?.hours ||
    (orgInn === INN_BRP ? stoSiteById('mozhayka')!.hours : '') ||
    '';
  const fallbackSite =
    site ||
    (orgInn === INN_BRP ? stoSiteById('mozhayka') : null) ||
    (orgInn === INN_BMP ? stoSiteById('fogel') : null);
  const stoRospotrebnadzor =
    site?.rospotrebnadzor ||
    bothMp?.rospotrebnadzor ||
    fallbackSite?.rospotrebnadzor ||
    '';
  const stoRospotrebnadzorPhone =
    site?.rospotrebnadzor_phone ||
    bothMp?.rospotrebnadzor_phone ||
    fallbackSite?.rospotrebnadzor_phone ||
    '';

  const workLines = ctx.workLines || [];
  const partLines = ctx.partLines || [];
  const worksSum = sumStoLines(workLines);
  const partsSum = sumStoLines(partLines);
  const totalSum = worksSum + partsSum;
  const vehicleLines: StoVehicleLine[] =
    ctx.vehicles && ctx.vehicles.length
      ? ctx.vehicles
      : ctx.carBrand || ctx.carPlate || ctx.carVin
        ? [
            {
              brand: ctx.carBrand,
              model: ctx.carModel,
              plate: ctx.carPlate,
              vin: ctx.carVin,
              year: ctx.carYear,
              stsNumber: ctx.carStsNumber,
              ownership: ctx.carStsNumber ? `СТС ${String(ctx.carStsNumber).trim()}` : '',
            },
          ]
        : [];

  const intakeAtRaw = String(ctx.intakeAt || '').trim();
  const intakeDate = intakeAtRaw ? new Date(intakeAtRaw) : null;
  const intakeOk = !!(intakeDate && !Number.isNaN(intakeDate.getTime()));
  const intakeDateIso = intakeOk ? moscowDateIso(intakeDate!) : '';
  const intakeDateLong = intakeDateIso ? formatRuLongDate(intakeDateIso) : '';
  const intakeDateShort = intakeOk
    ? (() => {
        const parts = new Intl.DateTimeFormat('ru-RU', {
          timeZone: 'Europe/Moscow',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).formatToParts(intakeDate!);
        const dd = parts.find((p) => p.type === 'day')?.value || '';
        const mm = parts.find((p) => p.type === 'month')?.value || '';
        const yy = parts.find((p) => p.type === 'year')?.value || '';
        return dd && mm && yy ? `${dd}.${mm}.${yy}` : '';
      })()
    : '';
  const intakeTime = intakeOk
    ? (() => {
        const { h, m } = formatRuTimeHm(intakeDate!);
        if (h === '____' || m === '____') return '';
        return `${h} ч ${m} мин`;
      })()
    : '';
  const intakeDateTime =
    intakeDateLong && intakeTime
      ? `${intakeDateLong}, ${intakeTime}`
      : intakeDateShort && intakeTime
        ? `${intakeDateShort}, ${intakeTime}`
        : intakeDateLong || intakeDateShort || intakeTime || '';

  const macros: Record<string, string> = {
    '{{Номер}}': String(ctx.number || ''),
    '{{НомерЗаказа}}': String(ctx.number || ''),
    '{{НомерДоговора}}': String(ctx.number || ''),
    '{{Филиал}}': String(ctx.city || ''),
    '{{СТО}}': stoAddress,
    '{{МестоПередачи}}': stoAddress,
    '{{АдресСТО}}': stoAddress,
    '{{РежимРаботы}}': stoHours,
    '{{Роспотребнадзор}}': stoRospotrebnadzor,
    '{{ТелефонРоспотребнадзора}}': stoRospotrebnadzorPhone,
    '{{Канал}}': '',
    '{{СпособОтправки}}': '',
    '{{СрокПередачи}}': (() => {
      const due = String(ctx.deliveryDue || '').trim();
      if (due) return due;
      return dateLine ? `не позднее ${dateLine}` : '';
    })(),
    '{{СрокОкончания}}': (() => {
      const due = String(ctx.deliveryDue || '').trim();
      if (due) return due;
      return dateLine || '';
    })(),
    '{{Дата}}': ctx.docDate
      ? (() => {
          const d = new Date(String(ctx.docDate).slice(0, 10) + 'T12:00:00');
          if (Number.isNaN(d.getTime())) return '';
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          return `${dd}.${mm}.${d.getFullYear()}`;
        })()
      : '',
    '{{ДатаДлинная}}': dateLine,
    '{{ДатаДоговора}}': dateLine,
    '{{Время}}': intakeTime,
    '{{ДатаПриёмки}}': intakeDateLong || intakeDateShort,
    '{{ДатаПриемки}}': intakeDateLong || intakeDateShort,
    '{{ВремяПриёмки}}': intakeTime,
    '{{ВремяПриемки}}': intakeTime,
    '{{ДатаВремяПриёмки}}': intakeDateTime,
    '{{ДатаВремяПриемки}}': intakeDateTime,
    '{{ВремяВыдачи}}': (() => {
      const { h, m } = formatRuTimeHm(new Date());
      if (h === '____' || m === '____') return '____ ч ____ мин';
      return `${h} ч ${m} мин`;
    })(),
    '{{Город}}': city,
    '{{Организация}}': org ? orgNameBare(org) : '',
    '{{ОрганизацияКратко}}': org
      ? (() => {
          const inn = String(org.inn || '').replace(/\D/g, '');
          if (inn === INN_BMP) return 'ИП Безматерных М.П.';
          if (inn === INN_BRP) return 'ИП Безматерных Р.П.';
          const short = String(org.short_name || '').trim();
          if (short) return short.startsWith('ИП') ? short : `ИП ${short}`;
          const bare = orgNameBare(org);
          return bare ? `ИП ${bare}` : '';
        })()
      : '',
    '{{ДатаПриказа}}': formatRuLongDate(ctx.docDate || '2026-08-15'),
    '{{ДатаРедакции}}': formatRuLongDate(ctx.docDate || '2026-08-15'),
    '{{НомерПриказа}}': '1',
    '{{ДатаРегистрацииИП}}': (() => {
      const inn = String(org?.inn || '').replace(/\D/g, '');
      if (inn === INN_BMP) return formatRuLongDate('2021-01-26');
      if (inn === INN_BRP) return formatRuLongDate('2022-04-18');
      return '«____» __________ 20____ г.';
    })(),
    '{{ОГРНОрганизации}}': org ? String(org.ogrnip || '') : '',
    '{{ИННОрганизации}}': org ? String(org.inn || '') : '',
    '{{КППОрганизации}}': org ? String(org.kpp || '') : '',
    '{{АдресОрганизации}}': org ? String(org.address || '') : '',
    '{{ТелефонОрганизации}}': stoPhone,
    '{{EmailОрганизации}}': stoEmail,
    '{{СайтОрганизации}}': org
      ? String(
          (org as { site?: string; website?: string; url?: string }).site ||
            (org as { website?: string }).website ||
            (org as { url?: string }).url ||
            ''
        )
      : '',
    '{{РСОрганизации}}': org ? String(org.rs || '') : '',
    '{{БанкОрганизации}}': org ? String(org.bank || '') : '',
    '{{БИКОрганизации}}': org ? String(org.bik || '') : '',
    '{{КСОрганизации}}': org ? String(org.ks || '') : '',
    '{{Директор}}': org ? String(org.director || '') : '',
    '{{Покупатель}}': String(ctx.buyerName || ''),
    '{{Заказчик}}': String(ctx.buyerName || ''),
    '{{Клиент}}': String(ctx.buyerName || ''),
    '{{ЭкземплярыЗН}}': String(stoTemplatePrintCopies('sto-workorder-person') || 2),
    '{{ФИО}}': String(ctx.buyerName || ''),
    '{{Адрес}}': (() => {
      const a = String(ctx.buyerAddress || '').trim();
      if (!a) return '';
      if (/^тел\.?\s*:?/i.test(a)) return '';
      const digits = a.replace(/\D/g, '');
      const nonPhone = a.replace(/[\d\s+\-().]/g, '');
      if (digits.length >= 10 && digits.length <= 15 && nonPhone.length <= 2) return '';
      return a;
    })(),
    '{{Телефон}}': String(ctx.buyerPhone || ''),
    '{{Email}}': '',
    '{{ИНН}}': String(ctx.buyerInn || ''),
    '{{КПП}}': String(ctx.buyerKpp || ''),
    '{{ОГРН}}': String(ctx.buyerOgrn || ''),
    '{{ВЛице}}': String(ctx.buyerDirector || ''),
    '{{Представитель}}':
      String(ctx.carBroughtBy || '').trim() || String(ctx.buyerDirector || ''),
    '{{ОснованиеПолномочий}}':
      String(ctx.carAuthorityLine || '').trim() ||
      (() => {
        const label = String(ctx.carAuthorityBasis || '').trim();
        const det = String(ctx.carAuthorityDetails || '').trim();
        if (!label && !det) return '';
        return det ? `${label}: ${det}` : label;
      })(),
    '{{Банк}}': String(ctx.buyerBank || ''),
    '{{БИК}}': String(ctx.buyerBik || ''),
    '{{РС}}': String(ctx.buyerRs || ''),
    '{{КС}}': String(ctx.buyerKs || ''),
    // Личность заказчика — только паспорт из ПДн / OCR; СТС сюда не подставляем.
    '{{ДокументЗаказчика}}': String(ctx.buyerPassport || ''),
    '{{ДокументНаАвто}}': String(ctx.carStsNumber || ''),
    '{{Марка}}': String(ctx.carBrand || ''),
    '{{Модель}}': String(ctx.carModel || ''),
    '{{Год}}': String(ctx.carYear || ''),
    '{{VIN}}': String(ctx.carVin || ''),
    '{{Госномер}}': String(ctx.carPlate || ''),
    '{{Цвет}}': String(ctx.carColor || ''),
    '{{Пробег}}': String(ctx.carMileage || ''),
    '{{УровеньТоплива}}': String(ctx.carFuelLevel || ''),
    '{{Комплектность32}}': String(ctx.completenessLine || ''),
    '{{Ключи33}}': String(ctx.keysDocsLine || ''),
    '{{Повреждения34}}': String(ctx.damageNotes || ''),
    '{{Неисправности}}': String(ctx.faults || '').trim(),
    '{{Сотрудник}}': String(ctx.staffName || ''),
    '{{Сумма}}': totalSum > 0 ? moneyRu(totalSum) : '',
    '{{СуммаПрописью}}': '',
    '{{СрокНачала}}': dateLine,
    '{{ГарантияРаботы}}': formatWarrantyWorksTerm(),
    '{{ГарантияЗЧ}}': formatWarrantyGoodsSummary(org?.inn),
    '{{ТаблицаГарантии}}': formatWarrantyTableText({ sellerInn: org?.inn }),
    '{{ГарантияРейки}}': formatSteeringRackLegalClause(org?.inn),
    '{{ТаблицаГарантииРейки}}': formatSteeringRackTableBlock(org?.inn, 'с даты выдачи АМТС'),
    '{{ТаблицаГарантииРейкиЮр}}': formatSteeringRackTableBlock(org?.inn, 'с даты подписания раздела 10'),
    '{{ТаблицаРабот}}': formatStoWorksTableText(workLines),
    '{{ТаблицаЗЧИсполнителя}}': formatStoPartsTableText(partLines),
    '{{ТаблицаЗЧ}}': formatStoPartsTableText(partLines),
    '{{ТаблицаЗЧЗаказчика}}': formatStoClientPartsListText(ctx.clientPartLines),
    '{{ЕстьЗЧЗаказчика}}': (ctx.clientPartLines || []).some((l) => String(l.name || '').trim())
      ? '1'
      : '',
    '{{ТаблицаТоваров}}': formatStoApplicationGoodsTableText(partLines),
    '{{ТаблицаУслуг}}': formatStoApplicationServicesTableText(
      workLines,
      formatStoRepairObject(ctx)
    ),
    '{{ТаблицаУслугЗаявки}}': formatStoApplicationServicesTableText(
      workLines,
      formatStoRepairObject(ctx)
    ),
    '{{ОбъектРемонта}}': formatStoRepairObject(ctx),
    '{{ТаблицаТС}}': formatStoVehiclesTableText(vehicleLines),
    '{{ТаблицаПредставителей}}': (() => {
      const fio =
        String(ctx.carBroughtBy || '').trim() || String(ctx.buyerDirector || '').trim();
      const phone = String(ctx.buyerPhone || '').trim();
      const email = String(ctx.buyerEmail || '').trim();
      const contact = [phone, email].filter(Boolean).join(', ');
      const authority = String(ctx.carAuthorityLine || '').trim();
      const scope = authority
        ? `сдача/получение ТС · ${authority}`
        : 'подача заявок, сдача/получение ТС, согласование работ, подписание заказ-нарядов';
      const rows: string[] = [];
      if (fio || contact) {
        rows.push(`1\t${fio}\t\t${contact}\t${scope}\t`);
      }
      while (rows.length < 5) {
        rows.push(`${rows.length + 1}\t\t\t\t\t`);
      }
      return rows.join('\n');
    })(),
    '{{ТаблицаФакт}}': formatStoDoneTableText(workLines, partLines),
    '{{ТаблицаВыполненных}}': formatStoDoneTableText(workLines, partLines),
    '{{ИтогоРаботы}}': worksSum > 0 ? moneyRu(worksSum) : '',
    '{{ИтогоЗЧ}}': partsSum > 0 ? moneyRu(partsSum) : '',
    '{{НДССтавка}}': org && Number((org as { vat_rate?: number }).vat_rate) > 0
      ? String(Number((org as { vat_rate?: number }).vat_rate))
      : '',
    '{{ПорядокОплаты}}': String(ctx.paymentOrder || ''),
    '{{ФормаОплаты}}': String(ctx.paymentForm || ''),
    '{{УсловияОплаты}}':
      ctx.paymentOrder || ctx.paymentForm
        ? `Порядок оплаты: ${ctx.paymentOrder || ''}. Форма оплаты: ${ctx.paymentForm || ''}.`
        : 'Порядок оплаты: ☐ после приёмки результата работ  ☐ предварительная оплата __________ руб.  ☐ иное: __________________. Форма оплаты: ☐ наличными  ☐ по карте  ☐ безналичный расчёт.',
    '{{ПорядокОплатыЮр}}':
      String(ctx.paymentOrderLegal || '').trim() ||
      '☐ предварительная оплата ________ %  ☐ по факту приёмки работ  ☐ с отсрочкой ______ рабочих дней',
    '{{ФормаОплатыЮр}}':
      String(ctx.paymentFormLegal || '').trim() ||
      '☐ безналичный расчёт  ☐ наличными (в пределах 100 000 руб. по одному договору)',
    '{{УсловияОплатыЮр}}':
      ctx.paymentOrderLegal || ctx.paymentFormLegal
        ? `Порядок оплаты: ${ctx.paymentOrderLegal || ''}. Форма: ${ctx.paymentFormLegal || ''}.`
        : 'Порядок оплаты: ☐ предварительная оплата ________ %  ☐ по факту приёмки работ  ☐ с отсрочкой ______ рабочих дней. Форма: ☐ безналичный расчёт  ☐ наличными (в пределах 100 000 руб. по одному договору).',
    '{{ОбращениеКЗаказчику}}': String(
      ctx.contact94 ||
        'дата «____» _______ 20____ г., время ____ ч ____ мин; способ: ☐ лично  ☐ телефонный звонок (запись разговора сохранена)  ☐ СМС  ☐ мессенджер  ☐ электронная почта'
    ),
    '{{ОбращениеКЗаказчикуЮр}}': String(
      ctx.contact94Legal ||
        'дата «____» _______ 20____ г., время ____ ч ____ мин; способ: ☐ лично  ☐ электронная почта  ☐ телефонный звонок  ☐ мессенджер; адресат (Ф. И. О., должность): ________________________'
    ),
    '{{Оплата103}}': String(
      ctx.payment103 ||
        'Оплата произведена: ☐ полностью  ☐ частично (__________ руб.). Форма: ☐ наличными  ☐ по карте  ☐ безналичный расчёт. Кассовый чек: ☐ выдан  ☐ направлен в электронной форме.'
    ),
    '{{Оплата103Юр}}': String(
      ctx.payment103Legal ||
        'Расчёты: оплачено __________ руб.; к доплате __________ руб.; срок доплаты: «____» _______ 20____ г. Документы переданы: ☐ счёт  ☐ универсальный передаточный документ  ☐ счёт-фактура  ☐ кассовый чек.'
    ),
    '{{Комплектность104}}': String(
      ctx.handover104 ||
        'Комплектность и внешнее состояние АМТС при выдаче соответствуют зафиксированным при приёме: ☐ да  ☐ нет (замечания ниже). Фотофиксация при выдаче: ____ снимков.'
    ),
    '{{Комплектность104Юр}}': String(
      ctx.handover104Legal ||
        'Комплектность и внешнее состояние транспортного средства при выдаче соответствуют зафиксированным при приёме: ☐ да  ☐ нет (замечания ниже). Фотофиксация при выдаче: ____ снимков.'
    ),
    // пусто → ____ (не общий ________), число — из дела ЗН (фото приёмщика)
    '{{ФотоПриема}}':
      ctx.intakePhotoCount != null && ctx.intakePhotoCount > 0
        ? String(Math.floor(Number(ctx.intakePhotoCount)))
        : '____',
    '{{ФотоВыдачи}}':
      ctx.intakePhotoCount != null && ctx.intakePhotoCount > 0
        ? String(Math.floor(Number(ctx.intakePhotoCount)))
        : '____',
  };
  // составные
  if (brandModel) {
    text = text.replace(/\{\{Марка\}\}\s*\{\{Модель\}\}/g, brandModel);
  }
  const allowEmptyMacro = new Set([
    '{{ГарантияРейки}}',
    '{{ТаблицаГарантииРейки}}',
    '{{ТаблицаГарантииРейкиЮр}}',
    '{{Неисправности}}',
  ]);
  for (const [key, val] of Object.entries(macros)) {
    if (!key) continue; // пустой ключ → split('').join(…) ломает весь текст
    // пустое → прочерк бланка; для реек у Романа — просто убрать
    const fill = val || (allowEmptyMacro.has(key) ? '' : '________');
    text = text.split(key).join(fill);
  }
  // убрать пустые хвосты после вырезания реек
  text = text.replace(/\{\{ГарантияРейки\}\}/g, '');
  text = text.replace(/\. {2,}На запчасти/g, '. На запчасти');
  text = text.replace(/отдельно; {2,}/g, 'отдельно; ');
  text = text.replace(/\n{3,}/g, '\n\n');

  if (ctx.number) {
    text = text.replace(/ДОГОВОР № ______/g, `Договор № ${ctx.number}`);
    text = text.replace(/Заказ-наряд № ______/g, `Заказ-наряд № ${ctx.number}`);
    text = text.replace(/ЗАКАЗ-НАРЯД № ______/g, `Заказ-наряд № ${ctx.number}`);
    text = text.replace(/АКТ № ______/g, `Акт № ${ctx.number}`);
    text = text.replace(/Договору № ______/g, `Договору № ${ctx.number}`);
    // Не трогаем «паспорт … № ______» и прочие случайные № ______
    text = text.replace(/(Договор(?:-оферта)?\s+№\s*)_{3,}/gi, `$1${ctx.number}`);
    text = text.replace(/(Заказ-наряд\s+№\s*)_{3,}/gi, `$1${ctx.number}`);
    text = text.replace(/(Акт\s+№\s*)_{3,}/gi, `$1${ctx.number}`);
  }
  if (dateLine) {
    text = text.replace(/«____» ______________ 20____ г\./g, dateLine);
    text = text.replace(/от «____» ______________ 20____ г\./g, `от ${dateLine}`);
    text = text.replace(/«____»\s*_{5,}\s*20_{3,4}\s*г\./g, dateLine);
    text = text.replace(/от «____»\s*_{5,}\s*20_{3,4}\s*г\./g, `от ${dateLine}`);
    // 9.1 выдача — дата/время печати ЗН
    const { h, m } = formatRuTimeHm(new Date());
    const issueTime = h !== '____' && m !== '____' ? `${h} ч ${m} мин` : '____ ч ____ мин';
    text = text.replace(
      /9\.1\.\s*Дата и время выдачи АМТС:\s*«_{3,}»\s*_{5,}\s*20_{3,4}\s*г\.,\s*_{3,}\s*ч\s*_{3,}\s*мин\.?/gi,
      `9.1. Дата и время выдачи АМТС: ${dateLine}, ${issueTime}.`
    );
  }
  if (city) {
    text = text.replace(/г\.\s*_{6,}/g, `г. ${city}`);
  }
  // п. 7.2 — подстановка из сделки, даже если в бланке ещё стоят пустые ☐
  if (ctx.paymentOrder && ctx.paymentForm) {
    text = text.replace(
      /Порядок оплаты:\s*☐\s*после приёмки результата работ\s*☐\s*предварительная оплата\s*_{3,}\s*руб\.\s*☐\s*иное:\s*_{3,}\.?\s*Форма оплаты:\s*☐\s*наличными\s*☐\s*по карте\s*☐\s*безналичный расчёт\.?/gi,
      `Порядок оплаты: ${ctx.paymentOrder}. Форма оплаты: ${ctx.paymentForm}.`
    );
  }
  if (ctx.paymentOrderLegal && ctx.paymentFormLegal) {
    text = text.replace(
      /Порядок оплаты:\s*☐\s*предварительная оплата\s*_{3,}\s*%\s*☐\s*по факту приёмки работ\s*☐\s*с отсрочкой\s*_{3,}\s*рабочих дней\.\s*Форма:\s*☐\s*безналичный расчёт\s*☐\s*наличными\s*\(в пределах 100 000 руб\. по одному договору\)\.?/gi,
      `Порядок оплаты: ${ctx.paymentOrderLegal}. Форма: ${ctx.paymentFormLegal}.`
    );
  }
  if (ctx.contact94) {
    text = text.replace(
      /Обращение к Заказчику:\s*дата\s*«_{3,}»\s*_{3,}\s*20_{3,4}\s*г\.,\s*время\s*_{3,}\s*ч\s*_{3,}\s*мин;\s*способ:\s*☐\s*лично\s*☐\s*телефонный звонок\s*\(запись разговора сохранена\)\s*☐\s*СМС\s*☐\s*мессенджер\s*☐\s*электронная почта\.?/gi,
      `Обращение к Заказчику: ${ctx.contact94}.`
    );
  }
  if (ctx.contact94Legal) {
    text = text.replace(
      /Обращение к Заказчику:\s*дата\s*«_{3,}»\s*_{3,}\s*20_{3,4}\s*г\.,\s*время\s*_{3,}\s*ч\s*_{3,}\s*мин;\s*способ:\s*☐\s*лично\s*☐\s*электронная почта\s*☐\s*телефонный звонок\s*☐\s*мессенджер;\s*адресат\s*\(Ф\.\s*И\.\s*О\.,\s*должность\):\s*_{3,}\.?/gi,
      `Обращение к Заказчику: ${ctx.contact94Legal}.`
    );
  }
  if (ctx.staffName) {
    text = text.replace(
      /Мастер-приёмщик:\s*_{5,}\s*\/\s*(?:_{3,}|________)\s*\//gi,
      `Мастер-приёмщик: ______________________ / ${ctx.staffName} /`
    );
    text = text.replace(
      /(Должность,\s*Ф\.\s*И\.\s*О\.\s*лица,\s*оформившего\s*договор:\s*)_{5,}/gi,
      `$1${ctx.staffName}`
    );
    text = text.replace(
      /(Должность,\s*Ф\.\s*И\.\s*О\.\s*лица,\s*оформившего\s*договор:\s*\n)_{5,}/gi,
      `$1${ctx.staffName}`
    );
    text = text.replace(
      /(Должность,\s*Ф\.\s*И\.\s*О\.:\s*\n)_{5,}/gi,
      `$1${ctx.staffName}`
    );
    text = text.replace(
      /(Должность,\s*Ф\.\s*И\.\s*О\.:\s*)_{5,}(?!\s*представителя)/gi,
      `$1${ctx.staffName}`
    );
  }
  if (ctx.payment103) {
    text = text.replace(
      /Оплата произведена:\s*☐\s*полностью\s*☐\s*частично\s*\(_{3,}\s*руб\.\)\.\s*Форма:\s*☐\s*наличными\s*☐\s*по карте\s*☐\s*безналичный расчёт\.\s*Кассовый чек:\s*☐\s*выдан\s*☐\s*направлен в электронной форме\.?/gi,
      ctx.payment103.endsWith('.') ? ctx.payment103 : `${ctx.payment103}.`
    );
  }
  if (ctx.payment103Legal) {
    text = text.replace(
      /Расчёты:\s*оплачено\s*_{3,}\s*руб\.;\s*к доплате\s*_{3,}\s*руб\.;\s*срок доплаты:\s*«_{3,}»\s*_{3,}\s*20_{3,4}\s*г\.\s*Документы переданы:\s*☐\s*счёт\s*☐\s*универсальный передаточный документ\s*☐\s*счёт-фактура\s*☐\s*кассовый чек\.?/gi,
      ctx.payment103Legal.endsWith('.') ? ctx.payment103Legal : `${ctx.payment103Legal}.`
    );
  }
  if (ctx.handover104) {
    text = text.replace(
      /Комплектность и внешнее состояние АМТС при выдаче соответствуют зафиксированным при приёме:\s*☐\s*да\s*☐\s*нет\s*\(замечания ниже\)\.\s*Фотофиксация при выдаче:\s*_{3,}\s*снимков\.?/gi,
      ctx.handover104.endsWith('.') ? ctx.handover104 : `${ctx.handover104}.`
    );
  }
  if (ctx.handover104Legal) {
    text = text.replace(
      /Комплектность и внешнее состояние транспортного средства при выдаче соответствуют зафиксированным при приёме:\s*☐\s*да\s*☐\s*нет\s*\(замечания ниже\)\.\s*Фотофиксация при выдаче:\s*_{3,}\s*снимков\.?/gi,
      ctx.handover104Legal.endsWith('.') ? ctx.handover104Legal : `${ctx.handover104Legal}.`
    );
  }
  if (ctx.intakePhotoCount != null && ctx.intakePhotoCount > 0) {
    const n = String(ctx.intakePhotoCount);
    text = text.replace(
      /Фотофиксация состояния при приёме выполнена:\s*_{3,}\s*снимков/gi,
      `Фотофиксация состояния при приёме выполнена: ${n} снимков`
    );
  }
  if (org) {
    const name = String(org.name || org.short_name || '').trim();
    const nameBare = name
      .replace(/^Индивидуальный\s+предприниматель\s+/i, '')
      .replace(/^ИП\s+/i, '')
      .trim() || name;
    const inn = String(org.inn || '').trim();
    const ogrnip = String(org.ogrnip || '').trim();
    const addr = String(org.address || '').trim();
    const phone = String(org.phone || '').trim();
    const email = String((org as { email?: string }).email || '').trim();
    if (name) {
      text = text.replace(
        /ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ\s*_{6,}/gi,
        `ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ ${nameBare}`
      );
      text = text.replace(
        /индивидуальному предпринимателю\s*_{6,}/gi,
        `индивидуальному предпринимателю ${nameBare}`
      );
      text = text.replace(
        /Индивидуальный предприниматель\s*_{6,}/g,
        `Индивидуальный предприниматель ${nameBare}`
      );
      text = text.replace(
        /индивидуальный предприниматель\s*_{6,}/gi,
        `индивидуальный предприниматель ${nameBare}`
      );
      text = text.replace(
        /Исполнитель:\s*индивидуальный предприниматель\s*_{6,}/gi,
        `Исполнитель: индивидуальный предприниматель ${nameBare}`
      );
      text = text.replace(/Исполнитель:\s*ИП\s*_{6,}/gi, `Исполнитель: ИП ${nameBare}`);
      text = text.replace(/(^|\n)ИП\s*_{6,}/g, `$1ИП ${nameBare}`);
    }
    if (ogrnip) text = text.replace(/ОГРНИП\s*_{5,}/gi, `ОГРНИП ${ogrnip}`);
    if (inn) {
      // ИНН исполнителя рядом с ОГРНИП / в реквизитах ИП — не путать с ИНН заказчика
      text = text.replace(/(ОГРНИП\s+\S+[,)\s]+ИНН\s*)_{5,}/gi, `$1${inn}`);
      text = text.replace(
        /(ОГРНИП\s*_{5,}[,)\s]+ИНН\s*)_{5,}/gi,
        `ОГРНИП ${ogrnip || '______________________'}, ИНН ${inn}`
      );
      text = text.replace(/(Исполнитель[^\n]{0,120}ИНН\s*)_{5,}/gi, `$1${inn}`);
      text = text.replace(/(1\.3\.[^\n]*ИНН\s*)_{5,}/gi, `$1${inn}`);
      text = text.replace(/ИНН\s*_{12,}/g, `ИНН ${inn}`); // длинные бланки ИП
    }
    if (addr) {
      text = text.replace(
        /адрес регистрации по месту жительства:\s*_{6,}/gi,
        `адрес регистрации по месту жительства: ${addr}`
      );
      text = text.replace(
        /Адрес регистрации по месту жительства:\s*_{6,}/gi,
        `Адрес регистрации по месту жительства: ${addr}`
      );
      text = text.replace(
        /место оказания услуг:\s*_{6,}/gi,
        `место оказания услуг: ${addr}`
      );
      text = text.replace(
        /адрес места оказания услуг:\s*_{6,}/gi,
        `адрес места оказания услуг: ${addr}`
      );
      text = text.replace(
        /Адрес места оказания услуг[^:\n]*:\s*_{6,}/gi,
        `Адрес места оказания услуг (станция технического обслуживания): ${addr}`
      );
      // не трогаем «адрес:» у заказчика — только у исполнителя / в скобках оператора
      text = text.replace(/(\(адрес:\s*)_{6,}/gi, `$1${addr}`);
      text = text.replace(/(Исполнитель[^\n]{0,200}адрес:\s*)_{6,}/gi, `$1${addr}`);
    }
    if (phone) {
      text = text.replace(/1\.5\.\s*Телефон\s*_{5,}/gi, `1.5. Телефон ${phone}`);
      text = text.replace(/(Исполнитель[^\n]{0,160})тел\.\s*_{5,}/gi, `$1тел. ${phone}`);
      text = text.replace(/(Исполнитель[^\n]{0,80})Телефон\s*_{5,}/gi, `$1Телефон ${phone}`);
    }
    if (email) {
      text = text.replace(/адрес электронной почты\s*_{5,}/gi, `адрес электронной почты ${email}`);
    }
  }
  if (ctx.buyerName) {
    const fio = String(ctx.buyerName).trim();
    // рамочный МСК (юрист): преамбула «ООО «____» …»
    if (/^(ООО|АО|ПАО|ИП|Общество|ЗАО)/i.test(fio) || /[«"]/.test(fio)) {
      text = text.replace(
        /Общество с ограниченной ответственностью «_{5,}»/g,
        fio
      );
    } else {
      text = text.replace(
        /Общество с ограниченной ответственностью «_{5,}»/g,
        `Общество с ограниченной ответственностью «${fio}»`
      );
    }
    text = text.replace(
      /Гражданин\(ка\)\s*_{6,}/g,
      `Гражданин(ка) ${fio}`
    );
    text = text.replace(
      /_{10,}\s*\(фамилия, имя, отчество\)/g,
      `${fio} (фамилия, имя, отчество)`
    );
    text = text.replace(/Я,\s*_{6,}\s*\(/g, `Я, ${fio} (`);
    text = text.replace(/Заказчик:\s*_{6,}\s*\(Ф\.\s*И\.\s*О/gi, `Заказчик: ${fio} (Ф. И. О`);
    text = text.replace(/Заказчик:\s*_{6,}/gi, `Заказчик: ${fio}`);
    text = text.replace(
      /Заказчик \(Ф\.\s*И\.\s*О\.\):\s*_{6,}/gi,
      `Заказчик (Ф. И. О.): ${fio}`
    );
    text = text.replace(/1\.1\.\s*Заказчик[^:\n]*:\s*_{6,}/gi, `1.1. Заказчик (Ф. И. О.): ${fio}`);
    // подпись внизу согласия
    text = text.replace(
      /(\(подпись\)\s+)(_{6,}|_{3,}\s*\/\s*_{6,})/gi,
      `$1/ ${fio}`
    );
    text = text.replace(
      /\/\s*_{8,}\s*\n\s*\(подпись\)\s+\(Ф\.\s*И\.\s*О\.\)/gi,
      `/ ${fio}\n(подпись)                              (Ф. И. О.)`
    );
    text = text.replace(
      /_{8,}\s*\/\s*_{8,}\s*\n\s*\(подпись\)/gi,
      `_________________________ / ${fio}\n(подпись)`
    );
  }
  if (ctx.buyerPhone) {
    text = text.replace(/телефон:?\s*_{5,}/gi, `телефон: ${ctx.buyerPhone}`);
    text = text.replace(/Телефон:\s*_{5,}/g, `Телефон: ${ctx.buyerPhone}`);
    text = text.replace(/1\.2\.\s*Телефон:\s*_{5,}/gi, `1.2. Телефон: ${ctx.buyerPhone}`);
    text = text.replace(/1\.3\.\s*Телефон:\s*_{5,}/gi, `1.3. Телефон: ${ctx.buyerPhone}`);
    text = text.replace(/(Заказчик[^\n]{0,200})тел\.\s*_{5,}/gi, `$1тел. ${ctx.buyerPhone}`);
    // не трогать строку «Адрес: тел. ___» — телефон только в 1.3
    text = text.replace(/(?<!Адрес:\s*)тел\.\s*_{5,}/gi, `тел. ${ctx.buyerPhone}`);
  }
  // e-mail в ЗН физлица убран из бланка — не подставляем
  if (ctx.buyerEmail && !/заказ-наряд/i.test(text.slice(0, 400))) {
    text = text.replace(
      /адрес электронной почты:?\s*_{5,}/gi,
      `адрес электронной почты: ${ctx.buyerEmail}`
    );
    text = text.replace(/e-mail:\s*_{5,}/gi, `e-mail: ${ctx.buyerEmail}`);
  }
  // Адрес заказчика-физлица: не подставлять телефон вместо адреса
  if (ctx.buyerAddress && !/^тел\.?\s*:?/i.test(String(ctx.buyerAddress).trim())) {
    text = text.replace(
      /зарегистрирован\(а\) по адресу:\s*_{6,}/gi,
      `зарегистрирован(а) по адресу: ${ctx.buyerAddress}`
    );
    text = text.replace(/(Заказчик[^\n]{0,220}адрес:\s*)_{6,}/gi, `$1${ctx.buyerAddress}`);
    // только юр-бланки с «1.3. Адрес»
    text = text.replace(/1\.3\.\s*Адрес:\s*_{6,}/gi, `1.3. Адрес: ${ctx.buyerAddress}`);
  }
  if (ctx.buyerOgrn) {
    text = text.replace(/,\s*ОГРН\s*_{6,}/g, `, ОГРН ${ctx.buyerOgrn}`);
  }
  if (ctx.buyerInn) {
    text = text.replace(/ИНН Заказчика[:\s]*_{5,}/gi, `ИНН Заказчика: ${ctx.buyerInn}`);
    text = text.replace(/(ОГРН\s+\S+,\s*ИНН\s*)_{6,}/g, `$1${ctx.buyerInn}`);
    text = text.replace(/(ОГРН\s*_{6,},\s*ИНН\s*)_{6,}/g, (_m, p1) =>
      ctx.buyerOgrn ? `ОГРН ${ctx.buyerOgrn}, ИНН ${ctx.buyerInn}` : `${p1}${ctx.buyerInn}`
    );
  }
  if (ctx.buyerDirector) {
    text = text.replace(/в лице\s*_{8,}/gi, `в лице ${ctx.buyerDirector}`);
  }
  if (ctx.buyerPassport) {
    const pas = String(ctx.buyerPassport).trim();
    // П. 1.3 ЗН: личность только из ПДн (паспорт), не из СТС.
    text = text.replace(
      /1\.(3|4)\.\s*Документ, удостоверяющий личность \(предъявлен, не изымается\):[^\n]*/gi,
      (_m, n) =>
        `1.${n}. Документ, удостоверяющий личность (предъявлен, не изымается): ☑ паспорт гражданина РФ  ☐ иной: ________________; серия и номер ${pas}.`
    );
    text = text.replace(/паспорт[^\n]{0,40}/i, (chunk) => {
      if (/_{3,}/.test(chunk) && !chunk.includes(pas)) {
        return chunk.replace(/_{3,}/, pas);
      }
      return chunk;
    });
  }
  if (ctx.carStsNumber) {
    // СТС — только право на АМТС / реквизиты, не «документ, удостоверяющий личность».
    const sts = String(ctx.carStsNumber).trim();
    text = text.replace(
      /(1\.(4|5)\.\s*Право на АМТС:\s*)☐(\s*собственник)/gi,
      '$1☑$3'
    );
    text = text.replace(
      /(реквизиты документа:\s*)_{6,}/gi,
      `$1СТС ${sts}`
    );
  }
  if (ctx.number) {
    text = text.replace(/ПРИЁМО-СДАТОЧНЫЙ АКТ №\s*_{3,}/gi, `Приёмо-сдаточный акт № ${ctx.number}`);
    text = text.replace(/Приёмо-сдаточный акт №\s*_{3,}/gi, `Приёмо-сдаточный акт № ${ctx.number}`);
    text = text.replace(/(к Договору \(заказ-наряду\) №\s*)_{3,}/gi, `$1${ctx.number}`);
    text = text.replace(/(Приложение № \d+ к Договору №\s*)_{3,}/gi, `$1${ctx.number}`);
  }
  // Авто — частые пустые строки после заголовков полей
  const carSubs: Array<[RegExp, string]> = [
    [/Марка, модель\n\n/g, `Марка, модель\n${brandModel || '____________________'}\n\n`],
    [/Год выпуска\n\n/g, `Год выпуска\n${ctx.carYear || '________'}\n\n`],
    [
      /Идентификационный номер \(VIN\)\n\n/g,
      `Идентификационный номер (VIN)\n${ctx.carVin || '____________________'}\n\n`,
    ],
    [
      /VIN \(идентификационный номер\)\n\n/g,
      `VIN (идентификационный номер)\n${ctx.carVin || '____________________'}\n\n`,
    ],
    [/Гос\. рег\. знак\n\n/g, `Гос. рег. знак\n${ctx.carPlate || '________'}\n\n`],
    [/Цвет\n\n/g, `Цвет\n${ctx.carColor || '________'}\n\n`],
    [
      /Пробег по одометру на дату приёма, км\n\n/g,
      `Пробег по одометру на дату приёма, км\n${ctx.carMileage || '________'}\n\n`,
    ],
    [/Пробег по одометру, км\n\n/g, `Пробег по одометру, км\n${ctx.carMileage || '________'}\n\n`],
    [
      /Пробег при выдаче:\s*_{3,}\s*км/g,
      `Пробег при выдаче: ${ctx.carMileage || '________'} км`,
    ],
  ];
  for (const [re, rep] of carSubs) text = text.replace(re, rep);

  return text;
}

/** Экранирование HTML. */
function escStoHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Блок с табами (шапка + строки) → HTML-таблица; иначе абзац.
 * Нужно для Прил. № 2 заявки, таблицы гарантий и т.п. в договорах.
 */
function stoFilledChunkToHtml(chunk: string): string {
  const lines = chunk
    .split(/\n/)
    .map((l) => l.replace(/\r$/, ''))
    .filter((l, i, arr) => !(l.trim() === '' && (i === 0 || i === arr.length - 1)));
  const tabby = lines.filter((l) => l.includes('\t'));
  if (lines.length >= 2 && tabby.length >= Math.ceil(lines.length * 0.6)) {
    const rows = lines.map((l) => l.split('\t'));
    const colCount = Math.max(...rows.map((r) => r.length), 1);
    const norm = rows.map((r) => {
      const cells = [...r];
      while (cells.length < colCount) cells.push('');
      return cells.slice(0, colCount);
    });
    const head = norm[0];
    const body = norm.slice(1);
    const th = head.map((c) => `<th>${escStoHtml(c.trim() || ' ')}</th>`).join('');
    const trs = body
      .map((r) => `<tr>${r.map((c) => `<td>${escStoHtml(c.trim() || ' ')}</td>`).join('')}</tr>`)
      .join('');
    return `<table class="sto-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
  }
  return `<p class="para">${escStoHtml(chunk).replace(/\n/g, '<br/>')}</p>`;
}

function stoFilledTextToHtmlBody(bodyText: string): string {
  return bodyText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(stoFilledChunkToHtml)
    .join('\n');
}

export function renderStoTemplateHtml(
  id: string,
  ctx: StoFillContext = {},
  opts?: { title?: string }
): string | null {
  const meta = getStoDocTemplate(id);
  const raw = readStoTemplateText(id);
  if (!meta || raw == null) return null;
  if (id === STO_WORKORDER_PERSON) {
    return renderStoWorkorderPersonHtml(meta, ctx, opts);
  }
  if (id === STO_WORKORDER_LEGAL) {
    return renderStoWorkorderLegalHtml(meta, ctx, opts);
  }
  const filled = fillStoTemplateText(raw, ctx);
  // ПДн: вёрстка только в DOCX → PDF; HTML-превью — простой текст, без старой таблицы.
  if (id === STO_PDN_CONSENT) {
    const title = opts?.title || meta.title;
    const body = stoFilledTextToHtmlBody(filled);
    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <style>
    ${stoDocPrintCss()}
  </style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Печать / PDF</button>
    <a href="/api/sto-doc-templates/${encodeURIComponent(STO_PDN_CONSENT)}/source">Скачать DOCX</a>
  </div>
  <div class="sto-doc-title">${esc(title)}</div>
  <p class="muted" style="font-size:12px">Для печати с вёрсткой бланка откройте PDF согласия в заказе (DOCX → PDF).</p>
  ${body}
</body>
</html>`;
  }
  const isContract =
    !!meta.isContract ||
    id === STO_CONTRACT_PERSON ||
    id === STO_CONTRACT_LEGAL ||
    id === STO_CONTRACT_LEGAL_MSK;
  const { bodyText, partiesHtml } = isContract
    ? splitStoContractBodyAndParties(filled, ctx)
    : { bodyText: filled, partiesHtml: '' };
  const body = stoFilledTextToHtmlBody(bodyText);
  const title = opts?.title || meta.title;
  const facsimileTail =
    !isContract && ctx.org
      ? `<div class="parties-sign" style="margin-top:18px;max-width:48%">
    <div style="font-weight:700;margin-bottom:6px">Исполнитель</div>
    ${orgFacsimileSignBlockHtml(ctx.org.inn, {
      name: ctx.org.short_name || ctx.org.director || ctx.org.name || '',
    })}
  </div>`
      : '';
  const docInner = `
  <div class="sto-letterhead">
    <div class="org-name">${esc(meta.code)}. ${esc(meta.title)}</div>
    <div class="org-addr">${esc(meta.when)}</div>
    <div class="org-ids"><i>Ключевое правило: нет подписанного документа — нет работ.</i></div>
  </div>
  <div class="sto-doc-title">${esc(title)}</div>
  ${body}
  <div class="sto-sign-block">${partiesHtml}</div>
  ${facsimileTail ? `<div class="sto-sign-block">${facsimileTail}</div>` : ''}`;
  const copies = stoTemplatePrintCopies(id);
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <style>
    ${stoDocPrintCss()}
    ${orgFacsimileCss()}
  </style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Печать / PDF</button>
    <a href="/api/sto-doc-templates/${encodeURIComponent(id)}/source">Скачать DOCX</a>
  </div>
  ${duplicateStoHtmlForPrint(docInner, copies)}
</body>
</html>`;
}

/** Вёрстка согласия ПДн как в бланке: сноска справа, заголовок по центру, город/дата, разделы + таблицы. */
function renderStoPdnConsentHtml(
  _meta: StoDocTemplate,
  filled: string,
  title: string,
  ctx: StoFillContext = {}
): string {
  const lines = filled
    .replace(/\u2028/g, '\n')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd());

  const blocks: string[] = [];
  let i = 0;
  const take = () => (i < lines.length ? lines[i++] : undefined);
  const peek = () => (i < lines.length ? lines[i] : undefined);

  // опциональная служебная сноска (если есть) — иначе сразу заголовок
  let note = '';
  while (peek() === '') take();
  const first = peek() || '';
  if (first.startsWith('Оформляется отдельным') || first.startsWith('[служебное]')) {
    note = take() || '';
    while (peek() === '') take();
  }
  // Согласие + подзаголовок
  const h1 = take() || 'Согласие';
  const h2 = take() || 'на обработку персональных данных';
  while (peek() === '') take();
  let city = take() || '';
  let date = '';
  // город и дата могут быть в одной строке (через tab) или в двух
  if (city.includes('\t') || /\{\{ДатаДлинная\}\}|«\d/.test(city.split(/\s{2,}/).slice(-1)[0] || '')) {
    const parts = city.split(/\t+/);
    if (parts.length >= 2) {
      city = parts[0].trim();
      date = parts.slice(1).join(' ').trim();
    } else {
      const m = city.match(/^(г\.\s*.+?)\s{2,}(.+)$/);
      if (m) {
        city = m[1].trim();
        date = m[2].trim();
      }
    }
  } else {
    date = take() || '';
  }
  while (peek() === '') take();

  if (note) blocks.push(`<p class="pdn-note">${esc(note)}</p>`);
  blocks.push(`<h1 class="pdn-title">${esc(h1)}</h1>`);
  blocks.push(`<p class="pdn-sub">${esc(h2)}</p>`);
  blocks.push(
    `<div class="pdn-place"><span>${esc(city)}</span><span class="pdn-date">${esc(date)}</span></div>`
  );

  // Карточка субъекта / АМТС — таблица реквизитов
  const brandModel = [ctx.carBrand, ctx.carModel]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(' ');
  const dash = (x: unknown) => {
    const t = String(x || '').trim();
    return esc(t || '________');
  };
  blocks.push(`<table class="pdn-fields">
  <tr><th>Ф. И. О.</th><td colspan="3">${dash(ctx.buyerName)}</td></tr>
  <tr><th>Телефон</th><td>${dash(ctx.buyerPhone)}</td><th>СТС</th><td>${dash(ctx.carStsNumber)}</td></tr>
  <tr><th>Марка, модель</th><td>${dash(brandModel)}</td><th>Гос. номер</th><td>${dash(ctx.carPlate)}</td></tr>
  <tr><th>VIN</th><td colspan="3">${dash(ctx.carVin)}</td></tr>
</table>`);

  const bodyBuf: string[] = [];
  const flushPara = () => {
    const t = bodyBuf.join(' ').replace(/\s+/g, ' ').trim();
    bodyBuf.length = 0;
    if (!t) return;
    if (/^\d+\.\s/.test(t)) {
      blocks.push(`<h2 class="pdn-h">${esc(t)}</h2>`);
    } else if (t.startsWith('☐')) {
      blocks.push(`<p class="pdn-check">${esc(t)}</p>`);
    } else if (/^_{5,}\s*\/\s*/.test(t) || t.includes('(подпись)')) {
      blocks.push(`<p class="pdn-sign">${esc(t).replace(/\n/g, '<br/>')}</p>`);
    } else if (t.startsWith('С 1 сентября') || t.startsWith('Оформляется отдельным документом')) {
      blocks.push(`<p class="pdn-service">${esc(t)}</p>`);
    } else {
      blocks.push(`<p class="pdn-p">${esc(t)}</p>`);
    }
  };

  while (i < lines.length) {
    const line = take()!;
    if (line.trim() === '') {
      flushPara();
      continue;
    }
    // подпись — две строки подряд
    if (/^_{5,}\s*\//.test(line.trim()) || /^\s*\(подпись\)/.test(line)) {
      flushPara();
      const next = peek() && /^\s*\(подпись\)/.test(peek()!) ? take()! : '';
      blocks.push(
        `<p class="pdn-sign">${esc(line)}${next ? `<br/>${esc(next)}` : ''}</p>`
      );
      continue;
    }
    if (/^\d+\.\s/.test(line.trim()) || line.trim().startsWith('☐') || line.trim().startsWith('С 1 сентября') || line.trim().startsWith('Оформляется отдельным')) {
      flushPara();
      bodyBuf.push(line.trim());
      flushPara();
      continue;
    }
    bodyBuf.push(line.trim());
  }
  flushPara();

  // Цели — таблица чекбоксов из уже добавленных pdn-check после «1. Цели»
  // (оставляем как абзацы — читаемее при печати)

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <style>
    @page { size: A4; margin: 10mm 12mm; }
    body { font-family: "Times New Roman", Times, serif; font-size: 11pt; line-height: 1.25; color: #111; max-width: 190mm; margin: 0 auto; }
    .toolbar { position: sticky; top: 0; background: #f5f5f5; padding: 8px 12px; margin: 0 0 10px; display: flex; gap: 8px; flex-wrap: wrap; }
    .toolbar button, .toolbar a { font: 13px system-ui, sans-serif; padding: 6px 12px; cursor: pointer; text-decoration: none; color: #111; border: 1px solid #bbb; background: #fff; border-radius: 4px; }
    .pdn-note { text-align: right; font-size: 11pt; font-style: italic; margin: 0 0 4px; line-height: 1.05; }
    .pdn-title { text-align: center; font-size: 13pt; font-weight: 700; margin: 0 0 1px; letter-spacing: 0.02em; line-height: 1.1; }
    .pdn-sub { text-align: center; font-size: 12pt; font-weight: 700; margin: 0 0 6px; line-height: 1.1; }
    .pdn-place { display: flex; justify-content: space-between; gap: 12px; margin: 0 0 6px; font-size: 11pt; line-height: 1.05; }
    .pdn-date { text-align: right; white-space: nowrap; }
    .pdn-fields { width: 100%; border-collapse: collapse; margin: 0 0 8px; table-layout: fixed; }
    .pdn-fields th, .pdn-fields td { border: 1px solid #333; padding: 2px 5px; font-size: 11pt; vertical-align: top; line-height: 1.05; }
    .pdn-fields th { width: 18%; background: #f3f3f3; font-weight: 600; text-align: left; }
    .pdn-fields td { width: 32%; }
    .pdn-h { font-size: 11pt; font-weight: 700; margin: 5px 0 2px; line-height: 1.05; }
    .pdn-p { margin: 0 0 3px; text-align: justify; font-size: 11pt; line-height: 1.05; }
    .pdn-check { margin: 0 0 1px; text-align: justify; padding-left: 0; font-size: 11pt; line-height: 1.05; }
    .pdn-sign { margin: 8px 0 2px; white-space: pre-wrap; font-family: "Times New Roman", Times, serif; font-size: 11pt; line-height: 1.05; }
    .pdn-service { margin: 6px 0 0; font-size: 11pt; font-style: italic; text-align: justify; line-height: 1.05; }
    @media print {
      .toolbar { display: none; }
      body { max-width: none; }
      .pdn-note, .pdn-service { font-style: italic; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Печать / PDF</button>
    <a href="/api/sto-doc-templates/${encodeURIComponent(STO_PDN_CONSENT)}/source">Скачать DOCX</a>
  </div>
  ${blocks.join('\n')}
</body>
</html>`;
}

/** Вырезать хвост «реквизиты/подписи» из текста и собрать двухколоночный блок с факсимиле. */
function splitStoContractBodyAndParties(
  filled: string,
  ctx: StoFillContext
): { bodyText: string; partiesHtml: string } {
  const text = filled.replace(/\u2028/g, '\n');
  const artMatch = text.match(
    /\n\s*((?:12|13))\.\s*АДРЕСА,\s*РЕКВИЗИТЫ\s*И\s*ПОДПИСИ\s*СТОРОН/i
  );
  const artNo = artMatch?.[1] || '12';
  const org = ctx.org;
  const sellerName = org?.name || org?.short_name || 'Исполнитель';
  const sellerShort = org?.short_name || org?.director || sellerName;
  const buyerName = String(ctx.buyerName || '').trim() || '____________________';

  const reLegal =
    /\n\s*(?:12|13)\.\s*АДРЕСА,\s*РЕКВИЗИТЫ\s*И\s*ПОДПИСИ\s*СТОРОН[\s\S]*$/i;
  const rePersonTail =
    /\n\s*Индивидуальный\s+предприниматель\s+[_\s./А-Яа-яA-Za-zЁё]*\n\s*\(подпись\)[\s\S]*$/i;

  let bodyText = text;
  let kind: 'legal' | 'person' | null = null;
  if (reLegal.test(text)) {
    bodyText = text.replace(reLegal, '').trimEnd();
    kind = 'legal';
  } else if (rePersonTail.test(text)) {
    bodyText = text.replace(rePersonTail, '').trimEnd();
    kind = 'person';
  }

  if (!kind || !org) {
    // запасной хвост — всё же факсимиле у исполнителя
    return {
      bodyText: text,
      partiesHtml: `<div style="margin-top:18px;max-width:48%">
        <div class="party-title">Исполнитель</div>
        ${orgFacsimileSignBlockHtml(org?.inn, { name: sellerShort })}
      </div>`,
    };
  }

  if (kind === 'person') {
    return {
      bodyText,
      partiesHtml: `<div style="margin-top:16px;max-width:55%;page-break-inside:avoid">
  <div class="party-title">Исполнитель</div>
  <div>${esc(sellerName)}</div>
  ${org?.inn ? `<div>ИНН ${esc(org.inn)}</div>` : ''}
  ${org?.ogrnip ? `<div>ОГРНИП ${esc(org.ogrnip)}</div>` : ''}
  ${orgFacsimileSignBlockHtml(org.inn, { name: sellerShort })}
</div>`,
    };
  }

  const sellerLines = [
    sellerName,
    org.ogrnip ? `ОГРНИП ${org.ogrnip}` : '',
    org.inn ? `ИНН ${org.inn}` : '',
    org.address ? `Адрес: ${org.address}` : '',
    org.phone ? `Тел.: ${org.phone}` : '',
    org.rs ? `Р/с ${org.rs}` : '',
    org.bank ? `Банк ${org.bank}` : '',
    org.bik || org.ks
      ? `БИК ${org.bik || '—'}${org.ks ? `  К/с ${org.ks}` : ''}`
      : '',
  ]
    .filter(Boolean)
    .map((l) => `<div>${esc(l)}</div>`)
    .join('');

  const buyerLines = [
    buyerName,
    ctx.buyerDirector ? `в лице ${ctx.buyerDirector}` : '',
    ctx.buyerInn ? `ИНН ${ctx.buyerInn}` : 'ИНН ______________',
    ctx.buyerKpp ? `КПП ${ctx.buyerKpp}` : '',
    ctx.buyerOgrn ? `ОГРН ${ctx.buyerOgrn}` : '',
    ctx.buyerAddress ? `Адрес: ${ctx.buyerAddress}` : 'Адрес: _________________________________',
    ctx.buyerPhone ? `Тел.: ${ctx.buyerPhone}` : '',
    ctx.buyerEmail ? `e-mail: ${ctx.buyerEmail}` : '',
    ctx.buyerBank ? `Банк: ${ctx.buyerBank}` : '',
    ctx.buyerBik || ctx.buyerRs || ctx.buyerKs
      ? [
          ctx.buyerBik ? `БИК ${ctx.buyerBik}` : '',
          ctx.buyerRs ? `Р/с ${ctx.buyerRs}` : '',
          ctx.buyerKs ? `К/с ${ctx.buyerKs}` : '',
        ]
          .filter(Boolean)
          .join('  ')
      : '',
  ]
    .filter(Boolean)
    .map((l) => `<div>${esc(l)}</div>`)
    .join('');

  return {
    bodyText,
    partiesHtml: `<h2 class="sto-h" style="text-align:center;font-size:12pt;margin:18px 0 8px">${artNo}. АДРЕСА, РЕКВИЗИТЫ И ПОДПИСИ СТОРОН</h2>
<table class="parties">
  <tr>
    <td>
      <div class="party-title">ИСПОЛНИТЕЛЬ</div>
      ${sellerLines}
      ${orgFacsimileSignBlockHtml(org.inn, { name: sellerShort, mpLabel: 'М.П. (при наличии печати)' })}
    </td>
    <td>
      <div class="party-title">ЗАКАЗЧИК</div>
      ${buyerLines}
      <div class="org-facsimile">
        <div class="org-facsimile-line">_______________ / ____________________ /</div>
        <div class="org-facsimile-mp">М.П. (при наличии печати)</div>
      </div>
    </td>
  </tr>
</table>`,
  };
}

export function stoPackFlowSummary() {
  return {
    key_rule: 'Нет подписанного документа — нет работ.',
    pdn_required_on_sto: 'person_only',
    stages: [
      {
        id: 'fork',
        label: STAGE_LABEL.fork,
        by_buyer: {
          person: ['sto-contract-person'],
          legal: ['sto-contract-legal'],
        },
      },
      {
        id: 'intake',
        label: STAGE_LABEL.intake,
        by_buyer: {
          person: ['sto-workorder-person', 'sto-pdn-consent'],
          legal: ['sto-workorder-legal'],
        },
      },
    ],
  };
}
