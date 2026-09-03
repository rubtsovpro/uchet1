/**
 * Правила продажи из полей AmoCRM.
 *
 * Компания:
 *   820517 ИНН, 862897 Партнёр (checkbox)
 *
 * Сделка:
 *   860300 Тип оплаты — Предоплата | Постоплата
 *   816975 Способ оплаты — Отсрочка, Карта, Наличка, Р/с, СДЭК Наложка…
 *   858983 Канал реализации — Автосервис | Самовывоз | Отправка
 *   860492 Способ отправки — СДЭК наложка | ТК СДЭК | Озон БРП | Авито доставка | …
 *   853005 СТО — точка сервиса
 */

import {
  SALE_SCENARIO_MATRIX,
  docPackFromScenarioDocs,
  scenarioDocsFromRow,
  scenarioStockRoute,
  type SaleScenarioBuyer,
  type SaleScenarioChannel,
  type SaleScenarioMethod,
  type SaleScenarioPayK,
  type SaleScenarioRow,
  type ScenarioDocs,
} from './sale-scenarios.js';
import { looksLikePersonFio } from './person-fio.js';

/** Форма покупателя (физ / ИП / юр) — не коммерческая роль. */
export type BuyerForm = 'person' | 'ip' | 'legal';
/** Коммерческая роль: розница / опт / опт с отсрочкой. */
export type ClientRole = 'client' | 'partner' | 'partner_delay';
/** Совмещённая метка для UI / матрицы (роль или форма розницы). */
export type BuyerRole = BuyerForm | 'partner' | 'partner_delay';

export type PaymentScheme = 'prepay' | 'postpay' | 'cod' | 'credit';

export type FiscalNeed = 'none' | 'advance_then_full' | 'full_only';

export type DealSaleRules = {
  buyer_role: BuyerRole;
  buyer_form: BuyerForm;
  client_role: ClientRole;
  is_partner: boolean;
  is_partner_delay: boolean;
  is_legal: boolean;
  is_sto: boolean;
  payment_scheme: PaymentScheme;
  credit_allowed: boolean;
  /** Склад может отгружать без полной оплаты */
  payment_required_for_ship: boolean;
  /** Нужны ли чеки АТОЛ */
  fiscal_need: FiscalNeed;
  /** Можно принять нал на месте (СТО / самовывоз / способ=Наличка) */
  cash_on_site: boolean;
  /** В Учёте уже есть оплата kind=cash */
  cash_received: boolean;
  /** Пакет документов продаж */
  doc_pack: Array<'invoice' | 'workorder' | 'upd'>;
  /** Матч матрицы F1a…P0 */
  scenario_id: string;
  /** Документы/разделы заказа по матрице (договор, ПДн, УПД, перемещение…) */
  scenario_docs: ScenarioDocs;
  /** Коротко для UI */
  labels: {
    buyer: string;
    payment: string;
    ship: string;
    fiscal: string;
    scenario?: string;
  };
  source: {
    amo_payment_type: string;
    amo_pay_method: string;
    amo_channel: string;
    amo_shipment: string;
    amo_sto: string;
  };
};

function norm(v: unknown): string {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function innControlDigit(digits: number[], coeffs: number[]): number {
  let sum = 0;
  for (let i = 0; i < coeffs.length; i++) sum += digits[i] * coeffs[i];
  return (sum % 11) % 10;
}

/**
 * ИНН из Amo часто мусор: «я», телефон, обрезки.
 * Принимаем только 10 (юр) или 12 (ИП) цифр с контрольной суммой.
 */
export function sanitizeBuyerInn(raw: unknown): string {
  const inn = String(raw || '').replace(/\D/g, '');
  if (inn.length !== 10 && inn.length !== 12) return '';
  if (/^0+$/.test(inn)) return '';
  const d = inn.split('').map((ch) => Number(ch));
  if (d.some((n) => !Number.isFinite(n))) return '';
  if (inn.length === 10) {
    if (innControlDigit(d, [2, 4, 10, 3, 5, 9, 4, 6, 8]) !== d[9]) return '';
  } else {
    if (innControlDigit(d, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) !== d[10]) return '';
    if (innControlDigit(d, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) !== d[11]) return '';
  }
  return inn;
}

/**
 * Оплата при получении через агента (не наша касса):
 * — СДЭК наложка;
 * — Авито доставка (агент Авито принимает деньги и сам бьёт чеки).
 */
export function isAgentCodShipment(deal: Record<string, unknown> | null | undefined): boolean {
  if (!deal) return false;
  const ship = norm(deal.amo_shipment) || norm(deal.ship_channel);
  const payMethod = norm(deal.amo_pay_method);
  if (/налож/.test(ship) || payMethod.includes('сдэк наложка') || ship === 'cdek_cod') {
    return true;
  }
  if (ship === 'avito_cod' || ship === 'avito') return true;
  // «Авито доставка» — постоплата/агент; чеки у Авито
  if (/авито/.test(ship) && /доставк/.test(ship)) return true;
  return false;
}

export function dealIsPartner(deal: Record<string, unknown> | null | undefined): boolean {
  if (!deal) return false;
  const role = String(deal.client_role || '')
    .trim()
    .toLowerCase();
  if (role === 'partner' || role === 'partner_delay' || role === 'partner-delay') return true;
  if (Number(deal.is_partner) === 1) return true;
  const kind = String(deal.buyer_kind || '').toLowerCase();
  if (kind === 'partner' || kind === 'partner_delay') return true;
  const pipe = norm(deal.pipeline_name);
  if (/партнер|партнёр/.test(pipe) && !/переда/.test(pipe)) return true;
  return false;
}

export function payMethodIsDelay(deal: Record<string, unknown> | null | undefined): boolean {
  const pay = norm(deal?.amo_pay_method);
  return pay === 'отсрочка' || /отсроч/.test(pay);
}

export function inferBuyerFormFromInn(deal: Record<string, unknown> | null | undefined): BuyerForm {
  const inn = sanitizeBuyerInn(deal?.buyer_inn || deal?.company_inn || deal?.inn);
  if (inn.length === 10) return 'legal';
  if (inn.length === 12) return 'ip';
  return 'person';
}

/** Форма: физ / ИП / юр. Партнёр больше не форма. Компания в Amo ≠ юрлицо. */
export function resolveBuyerForm(deal: Record<string, unknown> | null | undefined): BuyerForm {
  if (!deal) return 'person';
  const innForm = inferBuyerFormFromInn(deal);
  const kind = String(deal.buyer_kind || '').toLowerCase();
  if (kind === 'ip') return innForm === 'legal' ? 'legal' : 'ip';
  if (kind === 'legal' || kind === 'ooo' || kind === 'юрлицо') {
    return innForm === 'ip' ? 'ip' : 'legal';
  }
  if (kind === 'partner' || kind === 'partner_delay') return innForm;
  // ИНН ИП/юрлица важнее ярлыка «физлицо» в Amo (компания в сделке ≠ автоматически юр, но ИНН — да)
  if (innForm === 'legal' || innForm === 'ip') return innForm;
  if (kind === 'person' || kind === 'individual' || kind === 'физлицо') return 'person';
  if (innForm !== 'person') return innForm;
  return 'person';
}

export function dealIsLegalBuyerForm(deal: Record<string, unknown> | null | undefined): boolean {
  const form = resolveBuyerForm(deal);
  return form === 'legal' || form === 'ip';
}

export function resolveClientRole(deal: Record<string, unknown> | null | undefined): ClientRole {
  if (!deal) return 'client';
  const raw = String(deal.client_role || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (raw === 'partner_delay' || raw === 'partner-delay') return 'partner_delay';
  if (raw === 'partner') {
    return payMethodIsDelay(deal) ? 'partner_delay' : 'partner';
  }
  if (dealIsPartner(deal)) {
    return payMethodIsDelay(deal) ? 'partner_delay' : 'partner';
  }
  return 'client';
}

export function dealIsPartnerDelay(deal: Record<string, unknown> | null | undefined): boolean {
  return resolveClientRole(deal) === 'partner_delay';
}

export function resolveBuyerRole(deal: Record<string, unknown> | null | undefined): BuyerRole {
  if (!deal) return 'person';
  const role = resolveClientRole(deal);
  if (role === 'partner_delay') return 'partner_delay';
  if (role === 'partner') return 'partner';
  return resolveBuyerForm(deal);
}

/** Ключ покупателя для матрицы сценариев (физ / юр / партнёр / партнёр-физ). */
export function scenarioBuyerKey(
  deal: Record<string, unknown> | null | undefined
): SaleScenarioBuyer {
  const form = resolveBuyerForm(deal);
  const role = resolveClientRole(deal);
  if (role === 'client') return form;
  if (form === 'person') return 'partner_person';
  return 'partner';
}

export function resolvePaymentScheme(deal: Record<string, unknown> | null | undefined): PaymentScheme {
  if (!deal) return 'prepay';
  const payMethod = norm(deal.amo_pay_method);
  const payType = norm(deal.amo_payment_type);

  // СДЭК наложка / Авито доставка — оплата у агента при получении
  if (isAgentCodShipment(deal)) {
    return 'cod';
  }
  if (payMethod === 'отсрочка' || /отсроч/.test(payMethod) || dealIsPartnerDelay(deal)) {
    return 'credit';
  }
  if (payType.includes('постоплат')) {
    return 'postpay';
  }
  if (payType.includes('предоплат')) {
    return 'prepay';
  }
  // По умолчанию розница — предоплата
  return 'prepay';
}

export function resolveIsSto(deal: Record<string, unknown> | null | undefined): boolean {
  if (!deal) return false;
  if (Number(deal.is_sto_manual) === 1) return Number(deal.is_sto) === 1;
  const channel = norm(deal.amo_channel);
  // Явный канал важнее эвристик: самовывоз / отправка — только товар, без СТО-услуг
  if (channel.includes('самовывоз') || channel.includes('отправк')) return false;
  if (Number(deal.is_sto) === 1) return true;
  if (String(deal.amo_sto || '').trim()) return true;
  if (channel.includes('автосервис')) return true;
  const blob = [deal.pipeline_name, deal.department, deal.name, deal.status_name]
    .map((x) => norm(x))
    .join(' ');
  return /сто|сервис|подъём|подъем|ремонт|слесар|заказ.?наряд|маст[её]р/.test(blob);
}

/** Нужна ли полная оплата до отгрузки / передачи на сборку. */
export function paymentRequiredForShip(deal: Record<string, unknown> | null | undefined): boolean {
  // Опт: можно отгружать без 100% оплаты (не путать с отсрочкой / без кассы).
  if (dealIsPartner(deal)) return false;
  const scheme = resolvePaymentScheme(deal);
  if (scheme === 'credit' || scheme === 'postpay' || scheme === 'cod') return false;
  // СТО / самовывоз / автобус — часто платят на месте (в т.ч. налом)
  if (resolveIsSto(deal)) return false;
  const amoChannel = norm(deal?.amo_channel);
  if (amoChannel.includes('автосервис') || amoChannel.includes('самовывоз')) return false;
  const channel = String(deal?.ship_channel || '').trim();
  if (channel === 'pickup' || channel === 'bus') return false;
  if (isCashPayMethod(deal)) return false;
  return true;
}

/** Оплата по р/с / отсрочке — без кассы АТОЛ. */
export function isBankOrCreditPayMethod(deal: Record<string, unknown> | null | undefined): boolean {
  const scheme = resolvePaymentScheme(deal);
  if (scheme === 'credit') return true;
  const pay = norm(deal?.amo_pay_method);
  if (!pay) return false;
  if (pay === 'отсрочка') return true;
  if (pay.includes('расчетн') || pay.includes('расчётн') || pay.includes('р.с') || pay.includes('рс ')) {
    return true;
  }
  return false;
}

/** Оплата «в кассу»: QR / карта / нал / терминал — нужен чек АТОЛ (в т.ч. у юрлица). */
export function isRetailFiscalPayMethod(deal: Record<string, unknown> | null | undefined): boolean {
  if (isBankOrCreditPayMethod(deal)) return false;
  if (isCashPayMethod(deal)) return true;
  const pay = norm(deal?.amo_pay_method);
  if (
    /qr|сбп|карта|карточ|терминал|яндекс|card/.test(pay) ||
    pay.includes('сдэк наложка')
  ) {
    return true;
  }
  // Факт оплаты в Учёте: QR / ссылка / карта / нал
  const payments = Array.isArray(deal?.payments) ? deal!.payments : [];
  for (const p of payments) {
    const row = p as Record<string, unknown>;
    const kind = norm(row.kind);
    const st = norm(row.status);
    if (!['paid', 'confirmed', 'success', 'accepted'].includes(st) && st !== 'created') continue;
    if (/sbp|qr|yandex|card|link|pay|cash|налич/.test(kind)) return true;
  }
  return false;
}

/** Способ оплаты — наличные (Amo «Наличка» и т.п.). */
export function isCashPayMethod(deal: Record<string, unknown> | null | undefined): boolean {
  const pay = norm(deal?.amo_pay_method);
  if (/налич|нал\b|cash/.test(pay)) return true;
  const payments = Array.isArray(deal?.payments) ? deal!.payments : [];
  return payments.some((p) => {
    const row = p as Record<string, unknown>;
    return (
      norm(row.kind) === 'cash' &&
      ['paid', 'confirmed', 'success', 'accepted'].includes(norm(row.status))
    );
  });
}

/** На СТО / самовывозе можно принять нал на месте. */
export function cashAcceptedOnSite(deal: Record<string, unknown> | null | undefined): boolean {
  if (resolveIsSto(deal)) return true;
  const channel = norm(deal?.amo_channel);
  if (channel.includes('автосервис') || channel.includes('самовывоз')) return true;
  const ship = String(deal?.ship_channel || '').trim();
  if (ship === 'pickup') return true;
  return isCashPayMethod(deal);
}

export function dealCashReceived(deal: Record<string, unknown> | null | undefined): boolean {
  if (!deal) return false;
  const payments = Array.isArray(deal.payments) ? deal.payments : [];
  return payments.some((p) => {
    const row = p as Record<string, unknown>;
    return (
      norm(row.kind) === 'cash' &&
      ['paid', 'confirmed', 'success', 'accepted'].includes(norm(row.status))
    );
  });
}

/**
 * Уже была удалённая предоплата (QR / СБП / карта / ссылка) — не только нал на месте.
 * Тогда на СТО: чек аванса сегодня, полный — когда клиент приедет.
 */
export function dealHasRemotePrepayment(deal: Record<string, unknown> | null | undefined): boolean {
  if (!deal) return false;
  const payments = Array.isArray(deal.payments) ? deal.payments : [];
  for (const p of payments) {
    const row = p as Record<string, unknown>;
    const st = norm(row.status);
    if (!['paid', 'confirmed', 'success', 'accepted'].includes(st)) continue;
    const kind = norm(row.kind);
    if (kind === 'cash' || kind === 'наличка' || kind === 'нал') continue;
    if (/sbp|qr|yandex|card|link|pay|tochka/.test(kind) || kind) return true;
  }
  const scheme = resolvePaymentScheme(deal);
  if (scheme === 'prepay' && isRetailFiscalPayMethod(deal) && !isCashPayMethod(deal)) return true;
  return false;
}

/**
 * Чеки АТОЛ:
 * 1) способ денег — р/с / отсрочка / партнёрский кредит → без чека
 * 2) наложка СДЭК / Авито доставка → без чека (деньги и чек у агента)
 * 3) юр/ИП платит QR или картой → 1 полный чек при/после выдачи
 * 4) физ: канал + тип оплаты → 1 или 2 чека
 * 5) СТО: всё на месте → 1 чек при выдаче;
 *    предоплата сегодня (QR), визит через N дней → аванс сейчас + полный при выдаче
 *
 *   none              — без АТОЛ
 *   full_only         — 1 чек (полный) при/после выдачи
 *   advance_then_full — 2 чека (предоплата → полный)
 */
export function resolveFiscalNeed(deal: Record<string, unknown> | null | undefined): FiscalNeed {
  const role = resolveBuyerRole(deal);
  const form = resolveBuyerForm(deal);
  const scheme = resolvePaymentScheme(deal);

  // Отсрочка / р/с — без кассы (партнёр без отсрочки сюда не попадает)
  if (role === 'partner_delay' || scheme === 'credit' || isBankOrCreditPayMethod(deal)) return 'none';
  // Наложка / Авито: оплату и чек принимает агент — свой АТОЛ не бьём
  if (scheme === 'cod') return 'none';

  // Юр / ИП (в т.ч. партнёр-юр): QR или карта → один полный чек при/после выдачи
  if (form === 'legal' || form === 'ip') {
    if (isRetailFiscalPayMethod(deal)) return 'full_only';
    return 'none';
  }

  // Партнёр-физ + карта/СБП — 1 чек (как P0 / Wp0), не два аванса розницы
  // (partner_delay уже отсечён выше → 'none')
  if (role === 'partner') {
    if (isRetailFiscalPayMethod(deal)) return 'full_only';
    return 'none';
  }

  // Физлицо

  const channel = norm(deal?.amo_channel);
  const isAutoservice = channel.includes('автосервис') || resolveIsSto(deal);
  const isPickup = channel.includes('самовывоз');
  const isShip = channel.includes('отправ');

  if (isShip && scheme === 'prepay') return 'advance_then_full';

  // СТО / самовывоз / Автосервис:
  // — уже была удалённая QR-предоплата → 2 чека (аванс + полный при выдаче)
  // — оплата на месте (нал / QR при визите) → 1 полный чек после оплаты / при выдаче
  if (isAutoservice || isPickup) {
    if (dealHasRemotePrepayment(deal)) return 'advance_then_full';
    if (cashAcceptedOnSite(deal)) return 'full_only';
    if (scheme === 'prepay' && !dealCashReceived(deal)) return 'advance_then_full';
    return 'full_only';
  }

  if (scheme === 'prepay') return 'advance_then_full';
  // постоплата + карта → чек после выдачи
  if (scheme === 'postpay') return 'full_only';
  return 'full_only';
}

export function resolveDealChannelKey(
  deal: Record<string, unknown> | null | undefined
): SaleScenarioChannel {
  if (!deal) return '';
  if (resolveIsSto(deal)) return 'sto';
  const ch = norm(deal.amo_channel);
  if (ch.includes('самовывоз')) return 'pickup';
  if (ch.includes('отправк')) return 'ship';
  const ship = String(deal.ship_channel || '').trim();
  if (ship === 'pickup' || ship === 'bus') return 'pickup';
  if (ship === 'cdek' || ship === 'tk' || ship === 'post') return 'ship';
  return 'ship';
}

export function resolveDealPayKey(
  deal: Record<string, unknown> | null | undefined
): SaleScenarioPayK {
  if (!deal) return 'prepay';
  const scheme = resolvePaymentScheme(deal);
  if (scheme === 'credit') return 'credit';
  if (scheme === 'cod') return 'postpay';
  if (scheme === 'postpay') return 'postpay';
  const channel = resolveDealChannelKey(deal);
  const payType = norm(deal.amo_payment_type);
  if (payType.includes('предоплат')) return 'prepay';
  if (
    (channel === 'sto' || channel === 'pickup') &&
    (!payType || /на месте|при выдач|при получ|постоплат/.test(payType) === false) &&
    !payType.includes('предоплат')
  ) {
    // СТО/самовывоз без явной предоплаты в типе → на месте
    if (!payType || scheme === 'prepay') {
      // если тип пустой и канал onsite-like — onsite
      if (!payType) return 'onsite';
    }
  }
  if ((channel === 'sto' || channel === 'pickup') && !payType.includes('предоплат')) {
    return 'onsite';
  }
  return 'prepay';
}

export function resolveDealMethodKey(
  deal: Record<string, unknown> | null | undefined
): SaleScenarioMethod {
  if (!deal) return 'card';
  if (isAgentCodShipment(deal)) return 'cod';
  if (isBankOrCreditPayMethod(deal)) {
    if (resolvePaymentScheme(deal) === 'credit' || norm(deal.amo_pay_method) === 'отсрочка') {
      return 'delay';
    }
    return 'bank';
  }
  if (isCashPayMethod(deal)) return 'cash';
  if (isRetailFiscalPayMethod(deal)) return 'card';
  const pay = norm(deal.amo_pay_method);
  if (/р\/с|рс |расчетн|расчётн/.test(pay)) return 'bank';
  if (/отсроч/.test(pay)) return 'delay';
  if (/налич|нал\b/.test(pay)) return 'cash';
  return 'card';
}

export function dealHasWarehouseGoods(
  deal: Record<string, unknown> | null | undefined
): boolean {
  const items = Array.isArray(deal?.items) ? deal!.items : [];
  if (!items.length) return true;
  return items.some((it) => {
    const row = it as Record<string, unknown>;
    const kind = String(row.item_kind || row.kind || '').toLowerCase();
    if (kind === 'service' || kind === 'услуга') return false;
    return true;
  });
}

function scoreScenario(
  row: SaleScenarioRow,
  keys: {
    channel: SaleScenarioChannel;
    buyer: SaleScenarioBuyer;
    payK: SaleScenarioPayK;
    method: SaleScenarioMethod;
    servicesOnly: boolean;
  }
): number {
  if (row.buyer && row.buyer !== keys.buyer) return -1;
  if (row.channel && row.channel !== keys.channel) return -1;

  if (row.id === 'F3s') {
    if (!keys.servicesOnly) return -1;
  } else if (row.channel === 'sto' && row.buyer === 'person' && keys.servicesOnly) {
    if (row.id === 'F3a' || row.id === 'F3b') return -1;
  }

  let score = 10;
  if (row.channel && row.channel === keys.channel) score += 20;
  if (row.buyer && row.buyer === keys.buyer) score += 20;

  if (row.payK) {
    if (row.payK === keys.payK) score += 15;
    else if (row.payK === 'credit' && (keys.payK === 'credit' || keys.method === 'delay'))
      score += 12;
    else if (row.payK === 'postpay' && keys.method === 'cod') score += 8;
    else return -1;
  }

  if (row.method) {
    if (row.method === keys.method) score += 15;
    else if (row.method === 'card' && (keys.method === 'card' || keys.method === 'cash'))
      score += 8;
    else if (row.method === 'cash' && (keys.method === 'cash' || keys.method === 'card'))
      score += 8;
    else if (row.method === 'bank' && keys.method === 'delay') score += 5;
    else if (!row.payK && row.method === 'card' && keys.method === 'card') score += 10;
    else return -1;
  }

  return score;
}

export function matchSaleScenario(
  deal: Record<string, unknown> | null | undefined
): SaleScenarioRow | null {
  if (!deal) return null;
  const buyer = scenarioBuyerKey(deal);
  const channel = resolveDealChannelKey(deal);
  const payK = resolveDealPayKey(deal);
  const method = resolveDealMethodKey(deal);
  const servicesOnly = channel === 'sto' && !dealHasWarehouseGoods(deal);

  let best: SaleScenarioRow | null = null;
  let bestScore = -1;
  for (const row of SALE_SCENARIO_MATRIX) {
    const s = scoreScenario(row, { channel, buyer, payK, method, servicesOnly });
    if (s > bestScore) {
      bestScore = s;
      best = row;
    }
  }
  return bestScore >= 0 ? best : null;
}

export function resolveScenarioDocs(
  deal: Record<string, unknown> | null | undefined
): ScenarioDocs {
  const matched = matchSaleScenario(deal);
  if (matched) return scenarioDocsFromRow(matched);

  const sto = resolveIsSto(deal);
  const form = resolveBuyerForm(deal);
  const legal = form === 'legal' || form === 'ip';
  const partnerPerson = dealIsPartner(deal) && form === 'person';
  const channel = resolveDealChannelKey(deal);
  const scheme = resolvePaymentScheme(deal);
  const stock_route = scenarioStockRoute({
    channel: channel === 'sto' ? 'sto' : channel === 'pickup' ? 'pickup' : channel === 'ship' ? 'ship' : '',
    payK:
      scheme === 'prepay'
        ? 'prepay'
        : scheme === 'cod'
          ? 'postpay'
          : scheme === 'credit'
            ? 'credit'
            : scheme === 'postpay'
              ? 'postpay'
              : 'onsite',
    method: scheme === 'cod' ? 'cod' : 'card',
    xfer: 1,
  });
  return {
    scenario_id: '',
    scenario_title: '',
    contract: sto || legal,
    apps: legal,
    power_of_attorney: legal && (channel === 'ship' || channel === 'pickup'), /* опционально, не блокер */
    passport: false,
    sts: sto,
    workorder: sto || channel === 'pickup',
    pdn: sto && form === 'person',
    invoice: legal || partnerPerson || channel === 'ship' || !sto,
    upd: legal,
    transfer: true,
    stock_route,
    checks: '1',
  };
}

export function resolveDocPack(
  deal: Record<string, unknown> | null | undefined
): Array<'invoice' | 'workorder' | 'upd'> {
  return docPackFromScenarioDocs(resolveScenarioDocs(deal));
}

const ROLE_LABEL: Record<BuyerRole, string> = {
  person: 'Физлицо',
  ip: 'ИП',
  legal: 'Юрлицо',
  partner: 'Партнёр',
  partner_delay: 'Партнёр · отсрочка',
};

/** Роль из текста сценария Amo («Физлицо», «Юрлицо / ИП»…). */
export function parseBuyerRoleFromWho(who: unknown): BuyerRole {
  const w = String(who || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (w.includes('отсроч')) return 'partner_delay';
  if (w.includes('партн')) return 'partner';
  if (/\bип\b/.test(w) || w.startsWith('ип')) return 'ip';
  if (w.includes('юр')) return 'legal';
  if (
    w === 'person' ||
    w === 'ip' ||
    w === 'legal' ||
    w === 'partner' ||
    w === 'partner_delay'
  ) {
    return w as BuyerRole;
  }
  return 'person';
}

export type SaleDocPackDescription = {
  buyer_role: BuyerRole;
  who: string;
  channel: string;
  items: string[];
  docs: string;
  note: string;
};

/**
 * Человекочитаемый пакет документов по роли и каналу (единая матрица для UI).
 * Runtime на заказе по-прежнему через resolveDocPack + бланки СТО.
 */
export function describeSaleDocPack(opts: {
  buyerRole?: BuyerRole | string;
  channel?: string;
  who?: string;
}): SaleDocPackDescription {
  const roleRaw = String(opts.buyerRole || '').trim().toLowerCase();
  const buyer_role: BuyerRole =
    roleRaw === 'person' ||
    roleRaw === 'ip' ||
    roleRaw === 'legal' ||
    roleRaw === 'partner' ||
    roleRaw === 'partner_delay'
      ? (roleRaw as BuyerRole)
      : parseBuyerRoleFromWho(opts.who);
  const channelRaw = String(opts.channel || '').trim();
  const channel = channelRaw || 'любой';
  const channelForDeal =
    /^люб/i.test(channel) || channel === '—' || channel === '-' ? '' : channel;
  const isPartnerRole = buyer_role === 'partner' || buyer_role === 'partner_delay';
  const form: BuyerForm =
    buyer_role === 'ip' || buyer_role === 'legal' || buyer_role === 'person'
      ? buyer_role
      : 'legal';
  const fakeDeal: Record<string, unknown> = {
    buyer_kind: form,
    client_role: buyer_role === 'partner_delay' ? 'partner_delay' : isPartnerRole ? 'partner' : 'client',
    amo_channel: channelForDeal,
    amo_pay_method: buyer_role === 'partner_delay' ? 'Отсрочка' : '',
    is_partner: isPartnerRole ? 1 : 0,
    is_legal_entity: form === 'legal' || form === 'ip' ? 1 : 0,
  };
  const sto = resolveIsSto(fakeDeal);
  const legal = form === 'legal' || form === 'ip';
  const pack = resolveDocPack(fakeDeal);
  const sd = resolveScenarioDocs(fakeDeal);
  const items: string[] = [];
  const push = (label: string) => {
    if (!items.includes(label)) items.push(label);
  };
  if (sd.contract) {
    push(legal ? 'Договор 02' : 'Договор 01');
  }
  if (sd.apps) push('Приложения');
  if (sd.power_of_attorney) push('Полномочия (по ситуации)');
  if (sto) {
    if (legal) {
      push('ЗН 03ю');
    } else {
      push('ЗН 03ф');
      if (sd.pdn) push('ПДн');
    }
  }
  for (const t of pack) {
    if (t === 'invoice') push('Счёт');
    if (t === 'workorder' && !sto) push('Заказ-наряд');
    if (t === 'upd') push('УПД');
  }
  let note = '';
  if (sto && !legal) {
    note = 'СТО · физлицо: ФИО как в паспорте для ПДн; СТС на авто; без копии паспорта / e-mail / адреса';
  } else if (sto && legal) {
    note = 'СТО · юр/ИП: рамочный договор + приложения + ЗН; без согласия ПДн';
  } else if (legal) {
    note = 'Юр/ИП: рамочный договор + приложения + счёт + УПД';
  }
  return {
    buyer_role,
    who: ROLE_LABEL[buyer_role],
    channel,
    items,
    docs: items.join(' · ') || '—',
    note,
  };
}

/** Матрица роль × канал для экрана «Шаблоны документов». */
export function buildSaleDocPackMatrix(): SaleDocPackDescription[] {
  const roles: BuyerRole[] = ['person', 'ip', 'legal', 'partner', 'partner_delay'];
  const channels = ['Автосервис', 'Самовывоз', 'Отправка'];
  const out: SaleDocPackDescription[] = [];
  for (const buyerRole of roles) {
    for (const channel of channels) {
      out.push(describeSaleDocPack({ buyerRole, channel }));
    }
  }
  return out;
}

export function buildDealSaleRules(
  deal: Record<string, unknown> | null | undefined
): DealSaleRules {
  const buyer_role = resolveBuyerRole(deal);
  const buyer_form = resolveBuyerForm(deal);
  const client_role = resolveClientRole(deal);
  const is_partner = client_role !== 'client' || dealIsPartner(deal);
  const is_partner_delay = client_role === 'partner_delay';
  const is_legal = buyer_form === 'legal' || buyer_form === 'ip';
  const is_sto = resolveIsSto(deal);
  const payment_scheme = resolvePaymentScheme(deal);
  const credit_allowed =
    is_partner_delay || payment_scheme === 'credit' || payment_scheme === 'postpay';
  const payment_required_for_ship = paymentRequiredForShip(deal);
  const fiscal_need = resolveFiscalNeed(deal);
  const scenario_docs = resolveScenarioDocs(deal);
  const doc_pack = docPackFromScenarioDocs(scenario_docs);
  const cash_on_site = cashAcceptedOnSite(deal);
  const cash_received = dealCashReceived(deal);

  const schemeLabel: Record<PaymentScheme, string> = {
    prepay: 'Предоплата',
    postpay: 'Постоплата',
    cod: 'Оплата при получении',
    credit: 'Кредит / отсрочка',
  };
  const roleLabel: Record<BuyerRole, string> = {
    person: 'Физлицо',
    ip: 'ИП',
    legal: 'Юрлицо',
    partner: 'Партнёр',
    partner_delay: 'Партнёр · отсрочка',
  };

  let paymentLabel = schemeLabel[payment_scheme];
  const channelNorm = norm(deal?.amo_channel);
  const autoserviceChannel =
    channelNorm.includes('автосервис') || is_sto || cash_on_site;
  if (isCashPayMethod(deal) || cash_received) {
    paymentLabel = cash_received
      ? `${paymentLabel} · принято налом`
      : `${paymentLabel} · нал`;
  } else if (cash_on_site && !isBankOrCreditPayMethod(deal)) {
    paymentLabel = autoserviceChannel
      ? `${paymentLabel} · карта / Сплит / QR или нал (можно смешанно)`
      : `${paymentLabel} · можно налом на СТО`;
  }

  return {
    buyer_role,
    buyer_form,
    client_role,
    is_partner,
    is_partner_delay,
    is_legal,
    is_sto,
    payment_scheme,
    credit_allowed,
    payment_required_for_ship,
    fiscal_need,
    cash_on_site,
    cash_received,
    doc_pack,
    scenario_id: scenario_docs.scenario_id,
    scenario_docs,
    labels: {
      buyer: roleLabel[buyer_role],
      payment: paymentLabel,
      ship: String(deal?.amo_shipment || deal?.ship_channel || '').trim() || '—',
      fiscal:
        fiscal_need === 'advance_then_full'
          ? is_sto || cash_on_site
            ? '2 чека: аванс при предоплате → полный при выдаче на СТО'
            : '2 чека (предоплата → полный)'
          : fiscal_need === 'full_only'
            ? payment_scheme === 'postpay'
              ? '1 чек после выдачи'
              : isCashPayMethod(deal) || (cash_on_site && !dealHasRemotePrepayment(deal))
                ? '1 чек при выдаче (нал/карта на месте)'
                : '1 чек при выдаче'
            : 'без чека АТОЛ',
      scenario: scenario_docs.scenario_id
        ? `${scenario_docs.scenario_id} · ${scenario_docs.scenario_title}`
        : '',
    },
    source: {
      amo_payment_type: String(deal?.amo_payment_type || ''),
      amo_pay_method: String(deal?.amo_pay_method || ''),
      amo_channel: String(deal?.amo_channel || ''),
      amo_shipment: String(deal?.amo_shipment || ''),
      amo_sto: String(deal?.amo_sto || ''),
    },
  };
}

export type DealHintStep = {
  id: string;
  title: string;
  detail: string;
  /** done = уже сделано; active = следующий шаг; todo = позже */
  status: 'done' | 'active' | 'todo' | 'skip';
  action?: string;
};

export type DealNextHints = {
  /** Коротко: сценарий по листу правил */
  scenario: string;
  /** Главный следующий шаг */
  next: string;
  next_detail: string;
  next_action?: string;
  steps: DealHintStep[];
};

function hasDocType(
  docs: Array<Record<string, unknown>> | undefined,
  typ: string
): boolean {
  return (docs || []).some((d) => String(d.doc_type || '') === typ && d.id);
}

function fiscalOk(
  receipts: Array<Record<string, unknown>> | undefined,
  kinds: string[]
): boolean {
  const bad = new Set(['error', 'cancelled', 'canceled']);
  return (receipts || []).some((f) => {
    const kind = String(f.kind || '');
    const st = String(f.status || '').toLowerCase();
    return kinds.includes(kind) && !bad.has(st);
  });
}

/**
 * Подсказки следующего шага по правилам чеки/доки Amo (лист Google).
 * Учитывает роль, канал, оплату, СТО и уже созданные доки/чеки.
 */
export function buildDealNextHints(
  deal: Record<string, unknown> | null | undefined,
  ctx?: {
    sales_docs?: Array<Record<string, unknown>>;
    fiscal_receipts?: Array<Record<string, unknown>>;
    stock_outs?: Array<Record<string, unknown>>;
    paid?: boolean;
    due_total?: number;
    /** Есть товары к списанию (не услуги) — нужно списание */
    need_stock_out?: boolean;
    has_goods?: boolean;
    /** Уже есть заказ на перемещение / заявка СТО */
    has_transfer_order?: boolean;
  }
): DealNextHints {
  const rules = buildDealSaleRules(deal);
  const docs = ctx?.sales_docs || (Array.isArray(deal?.sales_docs) ? (deal!.sales_docs as Array<Record<string, unknown>>) : []);
  const fiscal = ctx?.fiscal_receipts || (Array.isArray(deal?.fiscal_receipts) ? (deal!.fiscal_receipts as Array<Record<string, unknown>>) : []);
  const outs = ctx?.stock_outs || [];
  const paid =
    ctx?.paid === true ||
    Number(deal?.paid) === 1 ||
    String(deal?.payment_status || '').toLowerCase() === 'paid';
  const due = ctx?.due_total != null ? Number(ctx.due_total) : 0;
  const hasOut = outs.some((o) => o && o.id);
  const hasGoods = ctx?.has_goods === true;
  const needStockOut =
    ctx?.need_stock_out != null
      ? !!ctx.need_stock_out
      : ctx?.has_goods != null
        ? !!ctx.has_goods
        : true;
  const channel = String(rules.source.amo_channel || '').trim() || '—';
  const isAutoservice = /автосервис/i.test(channel) || rules.is_sto;
  const isShipChannel = /отправ/i.test(channel);
  /** Автосервис / СТО: ЗН → оплата; расходная накладная = списание со склада. */
  const stoFlow = isAutoservice || (rules.cash_on_site && !isShipChannel);
  const shipMethod = String(rules.source.amo_shipment || '').trim();
  const payTypeLabel = String(rules.source.amo_payment_type || '').trim();
  const shipFieldsMissing: string[] = [];
  if (isShipChannel && !shipMethod) shipFieldsMissing.push('Способ отправки');
  if (isShipChannel && !payTypeLabel) shipFieldsMissing.push('Тип оплаты');

  const shipLabel = rules.is_sto
    ? 'СТО / выдача'
    : /самовывоз/i.test(channel)
      ? 'Самовывоз'
      : isShipChannel
        ? shipMethod
          ? `Отправка · ${shipMethod}`
          : 'Отправка'
        : 'Склад / выдача';
  /** Колонки матрицы ЖЦ в том же порядке, что в «Документы». */
  const sd = rules.scenario_docs;
  const matrixBits: string[] = [];
  if (sd.contract) matrixBits.push('Договор');
  if (sd.apps) matrixBits.push('Прилож.');
  if (sd.power_of_attorney) matrixBits.push('Полн.·опц.');
  if (sd.passport) matrixBits.push('Паспорт');
  if (sd.sts) matrixBits.push('СТС');
  if (sd.workorder) matrixBits.push('ЗН');
  if (sd.pdn) matrixBits.push('ПДн');
  if (sd.invoice) matrixBits.push('Счёт');
  if (sd.upd) matrixBits.push('УПД');
  if (sd.transfer) {
    const route = String(sd.stock_route || '').trim();
    matrixBits.push(route && route !== '—' ? `Склад ${route}` : 'Перемещ.');
  }
  {
    const ch = String(sd.checks || '0');
    matrixBits.push(
      ch === '2'
        ? '2 чека (аванс→полный)'
        : ch === '1'
          ? '1 чек'
          : ch === '0/1'
            ? 'чеки 0/1'
            : 'без чека'
    );
  }
  const scenarioParts = [
    sd.scenario_id || '',
    rules.labels.buyer,
    channel !== '—' ? channel : '',
    isShipChannel && shipMethod ? shipMethod : '',
    payTypeLabel || rules.labels.payment,
    matrixBits.join(' · '),
  ].filter(Boolean);
  const scenario = scenarioParts.join(' · ');

  const setupSteps: DealHintStep[] = [];
  if (isShipChannel) {
    setupSteps.push({
      id: 'ship_method',
      title: 'Способ отправки',
      detail: shipMethod
        ? `Указан: ${shipMethod}`
        : 'Обязательно при канале «Отправка» — СДЭК / автобус / курьер…',
      status: shipMethod ? 'done' : 'todo',
      action: shipMethod ? undefined : 'fill:amo_shipment',
    });
    setupSteps.push({
      id: 'pay_type',
      title: 'Тип оплаты',
      detail: payTypeLabel
        ? `Указан: ${payTypeLabel}`
        : 'Обязательно при «Отправка» — Предоплата или Постоплата',
      status: payTypeLabel ? 'done' : 'todo',
      action: payTypeLabel ? undefined : 'fill:amo_payment_type',
    });
  }

  const paySteps: DealHintStep[] = [];
  if (shipFieldsMissing.length) {
    paySteps.push({
      id: 'pay',
      title: 'Оплата',
      detail: `Сначала заполните: ${shipFieldsMissing.join(' и ')}`,
      status: 'todo',
      action: !shipMethod ? 'fill:amo_shipment' : 'fill:amo_payment_type',
    });
  } else if (
    rules.payment_scheme === 'credit' ||
    (rules.credit_allowed && isBankOrCreditPayMethod(deal))
  ) {
    paySteps.push({
      id: 'pay',
      title: 'Оплата',
      detail: 'Кредит / отсрочка / р/с — склад можно без предоплаты, чек АТОЛ не нужен',
      status: 'skip',
    });
  } else if (rules.payment_scheme === 'cod') {
    const isAvito = /авито/i.test(shipMethod);
    const agent = isAvito ? 'Авито' : /сдэк|cdek|налож/i.test(shipMethod) ? 'СДЭК' : 'агент доставки';
    paySteps.push({
      id: 'pay',
      title: isAvito
        ? 'Оплата при получении (Авито доставка)'
        : 'Оплата при получении (наложка)',
      detail: shipMethod
        ? `${shipMethod}: перемещение основной → доставка (не WAIT-PAY); деньги и чек у ${agent}, наш АТОЛ не нужен.`
        : `Перемещение основной → доставка (не WAIT-PAY); деньги и чек у агента — АТОЛ не бьём.`,
      status: paid ? 'done' : 'todo',
      action: paid ? undefined : isAvito ? 'wait_avito' : 'wait_cdek',
    });
  } else if (rules.cash_on_site && due > 0.009) {
    paySteps.push({
      id: 'pay',
      title: stoFlow ? 'Оплата: карта / Сплит / QR или нал' : 'Принять оплату на месте',
      detail: stoFlow
        ? `К доплате ${Math.round(due).toLocaleString('ru-RU')} ₽ — ссылка (карта · Сплит · QR) или «Принято налом». Можно часть так, часть так.`
        : `Доплата ${Math.round(due).toLocaleString('ru-RU')} ₽ — кнопка «Принято налом» (услуги / товар / всё) или ссылка/QR`,
      status: 'todo',
      action: stoFlow ? 'pay_sto' : 'accept_cash',
    });
  } else if (isShipChannel && rules.payment_scheme === 'prepay' && !paid) {
    paySteps.push({
      id: 'pay',
      title: 'Предоплата по отправке',
      detail: `Тип «${payTypeLabel || 'Предоплата'}» · ${shipMethod || 'отправка'}: сначала оплата (ссылка / QR / карта), потом склад.`,
      status: 'todo',
      action: 'pay_link',
    });
  } else if (isShipChannel && rules.payment_scheme === 'postpay' && !paid) {
    paySteps.push({
      id: 'pay',
      title: 'Постоплата по отправке',
      detail: `Тип «Постоплата» · ${shipMethod || 'отправка'}: можно готовить отгрузку; оплату ждать после.`,
      status: 'skip',
    });
  } else if (rules.payment_required_for_ship && !paid) {
    paySteps.push({
      id: 'pay',
      title: 'Дождаться / взять предоплату',
      detail: 'Физ + отправка: сначала оплата (ссылка / QR), потом склад. Выбейте чек аванса после оплаты.',
      status: 'todo',
      action: 'pay_link',
    });
  } else if (paid || rules.cash_received) {
    paySteps.push({
      id: 'pay',
      title: 'Оплата',
      detail: rules.cash_received
        ? 'Принято налом'
        : isShipChannel
          ? `Оплачено · ${shipMethod || 'отправка'} · ${payTypeLabel || rules.labels.payment}`
          : 'Оплачено',
      status: 'done',
    });
  } else if (!rules.payment_required_for_ship) {
    paySteps.push({
      id: 'pay',
      title: 'Оплата',
      detail: 'Можно отгружать / выдавать до полной оплаты (постоплата / СТО / самовывоз)',
      status: 'skip',
    });
  }

  const fiscalSteps: DealHintStep[] = [];
  if (rules.fiscal_need === 'none') {
    fiscalSteps.push({
      id: 'fiscal',
      title: 'Чеки АТОЛ',
      detail:
        sd.invoice || sd.upd
          ? `Не нужны по матрице (чеки ${sd.checks}) — достаточно ${[
              sd.invoice ? 'счёта' : '',
              sd.upd ? 'УПД' : '',
            ]
              .filter(Boolean)
              .join(' и ')}`
          : `Не нужны по матрице (чеки ${sd.checks})`,
      status: 'skip',
    });
  } else if (rules.fiscal_need === 'advance_then_full') {
    const hasAdv = fiscalOk(fiscal, ['advance']);
    const hasFull = fiscalOk(fiscal, ['full']);
    if (!hasAdv && !paid && !rules.cash_received) {
      fiscalSteps.push({
        id: 'fiscal_adv',
        title: 'Чек 1 — аванс',
        detail: 'После предоплаты (QR) выбейте чек аванса. Полный — при выдаче / отгрузке',
        status: 'todo',
        action: 'fiscal:advance',
      });
    } else if (!hasAdv && (paid || rules.cash_received)) {
      fiscalSteps.push({
        id: 'fiscal_adv',
        title: 'Чек 1 — аванс',
        detail: 'Оплата есть — выбейте чек аванса сейчас',
        status: 'todo',
        action: 'fiscal:advance',
      });
    } else {
      fiscalSteps.push({
        id: 'fiscal_adv',
        title: 'Чек 1 — аванс',
        detail: 'Выбит',
        status: 'done',
      });
    }
    fiscalSteps.push({
      id: 'fiscal_full',
      title: 'Чек 2 — полный',
      detail: hasFull
        ? 'Выбит'
        : rules.is_sto
          ? 'При выдаче клиенту на СТО (после работ)'
          : 'При отгрузке / списании',
      status: hasFull ? 'done' : 'todo',
      action: hasFull ? undefined : 'fiscal:full',
    });
  } else {
    const hasFull = fiscalOk(fiscal, ['full', 'advance']);
    const moneyIn = paid || rules.cash_received;
    fiscalSteps.push({
      id: 'fiscal_full',
      title: 'Чек АТОЛ (полный)',
      detail: hasFull
        ? 'Выбит'
        : rules.payment_scheme === 'postpay'
          ? 'После выдачи'
          : moneyIn && (rules.is_sto || rules.cash_on_site)
            ? 'Деньги приняты — выбейте полный чек'
            : rules.is_sto || rules.cash_on_site
              ? 'После «Принято налом» или оплаты QR'
              : 'При выдаче / отгрузке',
      status: hasFull ? 'done' : moneyIn || !stoFlow ? 'todo' : 'todo',
      action: hasFull ? undefined : 'fiscal:full',
    });
  }

  const docSteps: DealHintStep[] = [];
  if (sd.sts || rules.is_sto) {
    const plate = String(deal?.car_plate || '').trim();
    const stsOk = Boolean(
      plate ||
        String(deal?.car_sts_number || '').trim() ||
        (deal?.sts_photos &&
          typeof deal.sts_photos === 'object' &&
          (Boolean((deal.sts_photos as { front?: string }).front) ||
            Boolean((deal.sts_photos as { back?: string }).back)))
    );
    if (sd.sts) {
      docSteps.push({
        id: 'sts',
        title: 'СТС / авто',
        detail: stsOk
          ? plate
            ? `Госномер: ${plate}`
            : 'Данные СТС есть'
          : 'Вкладка «Документы» — фото СТС / госномер / VIN',
        status: stsOk ? 'done' : 'todo',
        action: stsOk ? undefined : 'sto_auto',
      });
    } else if (rules.is_sto) {
      docSteps.push({
        id: 'car_plate',
        title: 'Гос. номер автомобиля',
        detail: plate
          ? `Указан: ${plate}`
          : 'Откройте «Документы» — заполните авто или распознайте СТС',
        status: plate ? 'done' : 'todo',
        action: plate ? undefined : 'sto_auto',
      });
    }
  }
  if (sd.passport) {
    const pas = String(deal?.buyer_passport || '').trim();
    docSteps.push({
      id: 'passport',
      title: 'Паспорт',
      detail: pas ? 'Заполнен' : 'Нужен по матрице ЖЦ — вкладка «Документы»',
      status: pas ? 'done' : 'todo',
      action: pas ? undefined : 'sto_auto',
    });
  }
  if (sd.contract) {
    const personOffer = rules.buyer_form === 'person';
    const exists = hasDocType(docs, 'contract');
    docSteps.push({
      id: 'doc_contract',
      title: personOffer ? 'Договор-оферта' : 'Договор',
      detail: personOffer
        ? 'Публичная оферта на сайте СТО — отдельно не печатаем'
        : exists
          ? 'Уже создан'
          : 'Нужен по матрице ЖЦ — создайте во вкладке «Документы»',
      status: personOffer || exists ? 'done' : 'todo',
      action: personOffer || exists ? undefined : 'create:contract',
    });
  }
  if (sd.workorder) {
    const exists = hasDocType(docs, 'workorder');
    const woRow = (docs || []).find((d) => String(d.doc_type || '') === 'workorder' && d.id);
    const woPrinted = Boolean(String(woRow?.printed_at || '').trim());
    const plateOk = Boolean(
      String(deal?.car_plate || '').trim() || String(woRow?.car_plate || '').trim()
    );
    let detail = '';
    if (!exists) {
      detail = 'Создайте ЗН во вкладке «Документы» (оплату не блокирует)';
    } else if (sd.sts && !plateOk) {
      detail = 'Откройте «Документы» — заполните авто / СТС, затем печать';
    } else if (!woPrinted) {
      detail = 'Можно распечатать; оплата уже доступна без печати';
    } else {
      detail = 'Создан и распечатан';
    }
    const woNeedPrint = exists && plateOk && !woPrinted && sd.sts;
    docSteps.push({
      id: 'doc_workorder',
      title: 'Заказ-наряд',
      detail,
      status: exists ? (woPrinted || !sd.sts ? 'done' : 'todo') : 'todo',
      action: exists
        ? woNeedPrint
          ? 'print:workorder'
          : sd.sts && !plateOk
            ? 'sto_auto'
            : !woPrinted
              ? 'print:workorder'
              : undefined
        : 'create:workorder',
    });
  }
  if (sd.pdn) {
    const fio = String(deal?.buyer_name || '').trim();
    const fioOk = looksLikePersonFio(fio);
    docSteps.push({
      id: 'doc_pdn',
      title: 'Согласие ПДн',
      detail: fioOk
        ? 'PDF во вкладке «Документы»'
        : 'Сначала ФИО как в паспорте во вкладке «Документы»',
      status: fioOk ? 'todo' : 'todo',
      action: 'sto_auto',
    });
  }
  if (sd.invoice) {
    const exists = hasDocType(docs, 'invoice');
    docSteps.push({
      id: 'doc_invoice',
      title: 'Счёт',
      detail: exists ? 'Уже создан' : 'Создайте счёт во вкладке «Документы»',
      status: exists ? 'done' : 'todo',
      action: exists ? undefined : 'create:invoice',
    });
  }
  if (sd.upd) {
    const exists = hasDocType(docs, 'upd');
    docSteps.push({
      id: 'doc_upd',
      title: 'УПД',
      detail: exists ? 'Уже создан' : 'Создайте УПД после выдачи / отгрузки',
      status: exists ? 'done' : 'todo',
      action: exists ? undefined : 'create:upd',
    });
  }

  // Перемещение запасов (в т.ч. СТО / отправка) — не WAIT-PAY
  const transferSteps: DealHintStep[] = [];
  if (sd.transfer) {
    const hasXfer = !!ctx?.has_transfer_order;
    const xferDetail = hasXfer
      ? 'Есть по заказу'
      : stoFlow
        ? 'По матрице ЖЦ: перемещение склада → СТО (не резерв WAIT-PAY)'
        : isShipChannel
          ? rules.payment_scheme === 'cod'
            ? 'По матрице ЖЦ: перемещение основной → доставка (наложка, не WAIT-PAY)'
            : 'По матрице ЖЦ: подготовка отгрузки / перемещение на склад отправки'
          : 'По матрице ЖЦ нужно перемещение';
    transferSteps.push({
      id: 'xfer',
      title: 'Перемещение',
      detail: xferDetail,
      status: hasXfer ? 'done' : 'todo',
      action: hasXfer ? undefined : 'create:transfer',
    });
  }
  const shipSteps: DealHintStep[] = [];
  const isCdek =
    isShipChannel &&
    /сдэк|cdek/i.test(shipMethod || String(rules.labels.ship || ''));
  if (isCdek) {
    shipSteps.push({
      id: 'cdek',
      title: 'СДЭК: трек и габариты',
      detail:
        'Виджет: ПВЗ/тариф, габариты упаковки, трек-номер. Кнопка во вкладке «Документы» (не на строке «Счёт»).',
      status: 'skip',
      action: 'open:cdek',
    });
  }
  const moneyIn = paid || rules.cash_received || due <= 0.009;
  const movementDone = hasOut;
  if (!needStockOut && !hasGoods && !rules.is_sto) {
    shipSteps.push({
      id: 'ship',
      title: shipLabel,
      detail:
        rules.buyer_role === 'person'
          ? 'Физлицо · в заказе нет товаров к списанию — списание не нужно'
          : 'Нет товаров к списанию — списание не нужно',
      status: 'skip',
    });
  } else if (!needStockOut && rules.is_sto && !hasGoods) {
    shipSteps.push({
      id: 'ship',
      title: shipLabel,
      detail: 'Только услуги / работы — списание не нужно. Выдача по заказ-наряду и чеку (если нужен)',
      status: 'skip',
    });
  } else if (rules.payment_required_for_ship && !moneyIn) {
    shipSteps.push({
      id: 'ship',
      title: 'Расходная накладная',
      detail: 'После оплаты — расходная (списание товаров со склада)',
      status: 'todo',
      action: 'create:upd-ship',
    });
  } else {
    shipSteps.push({
      id: 'ship',
      title: 'Расходная накладная',
      detail: movementDone
        ? 'Расходная есть — товары списаны / выданы'
        : moneyIn
          ? 'Оплата есть — оформите расходную накладную (списание со склада)'
          : stoFlow || rules.cash_on_site
            ? 'Можно до оплаты · вкладка «Расходная накладная». Заказ не закрывать без оплаты'
            : 'Нужна расходная накладная для списания товаров со склада',
      status: movementDone ? 'done' : 'todo',
      action: movementDone
        ? undefined
        : moneyIn || !rules.payment_required_for_ship || stoFlow || rules.cash_on_site
          ? 'create:upd-ship'
          : undefined,
    });
  }

  // Матрица ЖЦ: отправка — способ/тип → документы → оплата → чеки → перемещ./СДЭК → расходная
  // СТО/самовывоз — документы (ЗН…) → оплата → чеки → перемещ. → расходная
  const onSiteDocsFirst = stoFlow || (rules.cash_on_site && !isShipChannel);
  const steps: DealHintStep[] = isShipChannel
    ? [...setupSteps, ...docSteps, ...paySteps, ...fiscalSteps, ...transferSteps, ...shipSteps]
    : onSiteDocsFirst
      ? [...docSteps, ...paySteps, ...fiscalSteps, ...transferSteps, ...shipSteps]
      : [...docSteps, ...paySteps, ...fiscalSteps, ...transferSteps, ...shipSteps];

  let foundActive = false;
  for (const s of steps) {
    if (s.status === 'done' || s.status === 'skip') continue;
    if (!foundActive) {
      s.status = 'active';
      foundActive = true;
    } else {
      s.status = 'todo';
    }
  }

  const active = steps.find((s) => s.status === 'active');
  const allDone = !active && steps.every((s) => s.status === 'done' || s.status === 'skip');

  return {
    scenario,
    next: allDone ? 'Готово' : active?.title || 'Проверьте заказ',
    next_detail: allDone
      ? 'Документы и оплаты по сценарию закрыты'
      : active?.detail || '',
    next_action: active?.action,
    steps,
  };
}
