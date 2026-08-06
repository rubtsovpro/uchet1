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
 *   860492 Способ отправки — СДЭК наложка | ТК СДЭК | …
 *   853005 СТО — точка сервиса
 */

export type BuyerRole = 'person' | 'ip' | 'legal' | 'partner';

export type PaymentScheme = 'prepay' | 'postpay' | 'cod' | 'credit';

export type FiscalNeed = 'none' | 'advance_then_full' | 'full_only';

export type DealSaleRules = {
  buyer_role: BuyerRole;
  is_partner: boolean;
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
  /** Коротко для UI */
  labels: {
    buyer: string;
    payment: string;
    ship: string;
    fiscal: string;
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

export function dealIsPartner(deal: Record<string, unknown> | null | undefined): boolean {
  if (!deal) return false;
  if (Number(deal.is_partner) === 1) return true;
  if (String(deal.buyer_kind || '').toLowerCase() === 'partner') return true;
  const pipe = norm(deal.pipeline_name);
  if (/партнер|партнёр/.test(pipe) && !/переда/.test(pipe)) return true;
  return false;
}

export function resolveBuyerRole(deal: Record<string, unknown> | null | undefined): BuyerRole {
  if (!deal) return 'person';
  if (dealIsPartner(deal)) return 'partner';
  const kind = String(deal.buyer_kind || '').toLowerCase();
  if (kind === 'partner') return 'partner';
  if (kind === 'ip') return 'ip';
  if (kind === 'legal' || Number(deal.is_legal_entity) === 1) return 'legal';
  if (String(deal.company_id || '').trim() || String(deal.company_name || '').trim()) return 'legal';
  const inn = String(deal.buyer_inn || '').replace(/\D/g, '');
  if (inn.length === 10) return 'legal';
  if (inn.length === 12) return 'ip';
  return 'person';
}

export function resolvePaymentScheme(deal: Record<string, unknown> | null | undefined): PaymentScheme {
  if (!deal) return 'prepay';
  const ship = norm(deal.amo_shipment) || norm(deal.ship_channel);
  const payMethod = norm(deal.amo_pay_method);
  const payType = norm(deal.amo_payment_type);

  if (/налож/.test(ship) || payMethod.includes('сдэк наложка') || ship === 'cdek_cod') {
    return 'cod';
  }
  if (payMethod === 'отсрочка' || dealIsPartner(deal) || Number(deal?.is_partner) === 1) {
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
  if (Number(deal.is_sto) === 1) return true;
  if (String(deal.amo_sto || '').trim()) return true;
  const channel = norm(deal.amo_channel);
  if (channel.includes('автосервис')) return true;
  const blob = [deal.pipeline_name, deal.department, deal.name, deal.status_name]
    .map((x) => norm(x))
    .join(' ');
  return /сто|сервис|подъём|подъем|ремонт|слесар|заказ.?наряд|маст[её]р/.test(blob);
}

/** Нужна ли полная оплата до отгрузки / передачи на сборку. */
export function paymentRequiredForShip(deal: Record<string, unknown> | null | undefined): boolean {
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
 * 2) юр/ИП платит QR или картой → 1 полный чек при/после выдачи
 * 3) физ: канал + тип оплаты → 1 или 2 чека
 * 4) СТО: всё на месте → 1 чек при выдаче;
 *    предоплата сегодня (QR), визит через N дней → аванс сейчас + полный при выдаче
 *
 *   none              — без АТОЛ
 *   full_only         — 1 чек (полный) при/после выдачи
 *   advance_then_full — 2 чека (предоплата → полный)
 */
export function resolveFiscalNeed(deal: Record<string, unknown> | null | undefined): FiscalNeed {
  const role = resolveBuyerRole(deal);
  const scheme = resolvePaymentScheme(deal);

  // Партнёр в кредит / отсрочка / р/с — без кассы
  if (role === 'partner' && (scheme === 'credit' || isBankOrCreditPayMethod(deal))) return 'none';
  if (isBankOrCreditPayMethod(deal)) return 'none';
  if (scheme === 'credit') return 'none';

  // Юр / ИП: QR или карта → один полный чек при/после выдачи (не два)
  if (role === 'legal' || role === 'ip') {
    if (isRetailFiscalPayMethod(deal) || scheme === 'cod') return 'full_only';
    // только счёт на р/с, без розничной оплаты
    return 'none';
  }

  // Партнёр, но заплатил QR/картой (редко) — тоже 1 чек
  if (role === 'partner') {
    if (isRetailFiscalPayMethod(deal)) return 'full_only';
    return 'none';
  }

  // Физлицо
  if (scheme === 'cod') return 'full_only';

  const channel = norm(deal?.amo_channel);
  const isAutoservice = channel.includes('автосервис') || resolveIsSto(deal);
  const isPickup = channel.includes('самовывоз');
  const isShip = channel.includes('отправ');

  if (isShip && scheme === 'prepay') return 'advance_then_full';

  // СТО / самовывоз:
  // — QR-предоплата сегодня, клиент через неделю → 2 чека (аванс сейчас + полный при выдаче)
  // — всё платит на месте (нал/карта при визите) → 1 чек при выдаче
  if (isAutoservice || isPickup) {
    if (dealHasRemotePrepayment(deal)) return 'advance_then_full';
    if (scheme === 'prepay' && !dealCashReceived(deal)) return 'advance_then_full';
    return 'full_only';
  }

  if (scheme === 'prepay') return 'advance_then_full';
  // постоплата + карта → чек после выдачи
  if (scheme === 'postpay') return 'full_only';
  return 'full_only';
}

export function resolveDocPack(
  deal: Record<string, unknown> | null | undefined
): Array<'invoice' | 'workorder' | 'upd'> {
  const sto = resolveIsSto(deal);
  const role = resolveBuyerRole(deal);
  const legal = role === 'legal' || role === 'partner' || role === 'ip';
  if (sto && legal) return ['invoice', 'workorder', 'upd'];
  if (sto) return ['workorder'];
  if (legal) return ['invoice', 'upd'];
  return ['invoice'];
}

export function buildDealSaleRules(
  deal: Record<string, unknown> | null | undefined
): DealSaleRules {
  const buyer_role = resolveBuyerRole(deal);
  const is_partner = buyer_role === 'partner' || dealIsPartner(deal);
  const is_legal = buyer_role === 'legal' || buyer_role === 'partner' || buyer_role === 'ip';
  const is_sto = resolveIsSto(deal);
  const payment_scheme = resolvePaymentScheme(deal);
  const credit_allowed =
    is_partner || payment_scheme === 'credit' || payment_scheme === 'postpay';
  const payment_required_for_ship = paymentRequiredForShip(deal);
  const fiscal_need = resolveFiscalNeed(deal);
  const doc_pack = resolveDocPack(deal);
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
  };

  let paymentLabel = schemeLabel[payment_scheme];
  if (isCashPayMethod(deal) || cash_received) {
    paymentLabel = cash_received
      ? `${paymentLabel} · принято налом`
      : `${paymentLabel} · нал`;
  } else if (cash_on_site && !isBankOrCreditPayMethod(deal)) {
    paymentLabel = `${paymentLabel} · можно налом на СТО`;
  }

  return {
    buyer_role,
    is_partner,
    is_legal,
    is_sto,
    payment_scheme,
    credit_allowed,
    payment_required_for_ship,
    fiscal_need,
    cash_on_site,
    cash_received,
    doc_pack,
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

  const channel = String(rules.source.amo_channel || '').trim() || '—';
  const scenarioParts = [
    rules.labels.buyer,
    channel !== '—' ? channel : '',
    rules.labels.payment,
    rules.labels.fiscal,
    rules.doc_pack
      .map((t) => (t === 'workorder' ? 'ЗН' : t === 'invoice' ? 'Счёт' : 'УПД'))
      .join('+'),
  ].filter(Boolean);
  const scenario = scenarioParts.join(' · ');

  const steps: DealHintStep[] = [];

  // 1. Авто для СТО
  if (rules.is_sto) {
    const plate = String(deal?.car_plate || '').trim();
    steps.push({
      id: 'car_plate',
      title: 'Гос. номер автомобиля',
      detail: plate
        ? `Указан: ${plate}`
        : 'Откройте заказ-наряд — заполните авто или распознайте СТС',
      status: plate ? 'done' : 'todo',
      action: plate ? undefined : 'sto_auto',
    });
  }

  // 2. Документы из пакета
  for (const t of rules.doc_pack) {
    const labels: Record<string, string> = {
      invoice: 'Счёт',
      workorder: 'Заказ-наряд',
      upd: 'УПД',
    };
    const exists = hasDocType(docs, t);
    let detail = '';
    if (t === 'workorder' && !String(deal?.car_plate || '').trim()) {
      detail = exists
        ? 'Откройте ЗН и заполните авто — затем PDF'
        : 'Создайте ЗН и заполните авто на карточке';
    } else if (exists) {
      detail = 'Уже создан';
    } else {
      detail =
        t === 'invoice'
          ? 'Создайте счёт (вкладка «Счета»)'
          : t === 'workorder'
            ? 'Создайте заказ-наряд → заполните авто → PDF'
            : 'Создайте УПД после выдачи / отгрузки';
    }
    steps.push({
      id: `doc_${t}`,
      title: labels[t] || t,
      detail,
      status: exists ? 'done' : 'todo',
      action: exists ? undefined : `create:${t}`,
    });
  }

  // 3. Оплата
  if (
    rules.payment_scheme === 'credit' ||
    (rules.credit_allowed && isBankOrCreditPayMethod(deal))
  ) {
    steps.push({
      id: 'pay',
      title: 'Оплата',
      detail: 'Кредит / отсрочка / р/с — склад можно без предоплаты, чек АТОЛ не нужен',
      status: 'skip',
    });
  } else if (rules.payment_scheme === 'cod') {
    steps.push({
      id: 'pay',
      title: 'Оплата при получении (наложка)',
      detail: 'Чек — когда статус СДЭК «получен/вручен». Отгрузка без предоплаты.',
      status: paid ? 'done' : 'todo',
      action: paid ? undefined : 'wait_cdek',
    });
  } else if (rules.cash_on_site && due > 0.009) {
    steps.push({
      id: 'pay',
      title: 'Принять оплату на месте',
      detail: `Доплата ${due.toFixed(2)} ₽ — кнопка «Принято налом» (услуги / товар / всё) или ссылка/QR`,
      status: 'todo',
      action: 'accept_cash',
    });
  } else if (rules.payment_required_for_ship && !paid) {
    steps.push({
      id: 'pay',
      title: 'Дождаться / взять предоплату',
      detail: 'Физ + отправка: сначала оплата (ссылка / QR), потом склад. Выбейте чек аванса после оплаты.',
      status: 'todo',
      action: 'pay_link',
    });
  } else if (paid || rules.cash_received) {
    steps.push({
      id: 'pay',
      title: 'Оплата',
      detail: rules.cash_received ? 'Принято налом' : 'Оплачено',
      status: 'done',
    });
  } else if (!rules.payment_required_for_ship) {
    steps.push({
      id: 'pay',
      title: 'Оплата',
      detail: 'Можно отгружать / выдавать до полной оплаты (постоплата / СТО / самовывоз)',
      status: 'skip',
    });
  }

  // 4. Чеки АТОЛ
  if (rules.fiscal_need === 'none') {
    steps.push({
      id: 'fiscal',
      title: 'Чеки АТОЛ',
      detail: 'Не нужны — счёт и УПД',
      status: 'skip',
    });
  } else if (rules.fiscal_need === 'advance_then_full') {
    const hasAdv = fiscalOk(fiscal, ['advance']);
    const hasFull = fiscalOk(fiscal, ['full']);
    if (!hasAdv && !paid && !rules.cash_received) {
      steps.push({
        id: 'fiscal_adv',
        title: 'Чек 1 — аванс',
        detail: 'После предоплаты (QR) выбейте чек аванса. Полный — при выдаче / отгрузке',
        status: 'todo',
        action: 'fiscal:advance',
      });
    } else if (!hasAdv && (paid || rules.cash_received)) {
      steps.push({
        id: 'fiscal_adv',
        title: 'Чек 1 — аванс',
        detail: 'Оплата есть — выбейте чек аванса сейчас',
        status: 'todo',
        action: 'fiscal:advance',
      });
    } else {
      steps.push({
        id: 'fiscal_adv',
        title: 'Чек 1 — аванс',
        detail: 'Выбит',
        status: 'done',
      });
    }
    steps.push({
      id: 'fiscal_full',
      title: 'Чек 2 — полный',
      detail: hasFull
        ? 'Выбит'
        : rules.is_sto
          ? 'При выдаче клиенту на СТО (после работ)'
          : 'При отгрузке / расходной',
      status: hasFull ? 'done' : hasAdv || paid ? 'todo' : 'todo',
      action: hasFull ? undefined : 'fiscal:full',
    });
  } else {
    // full_only
    const hasFull = fiscalOk(fiscal, ['full', 'advance']);
    steps.push({
      id: 'fiscal_full',
      title: 'Чек АТОЛ (полный)',
      detail: hasFull
        ? 'Выбит'
        : rules.payment_scheme === 'postpay'
          ? 'После выдачи'
          : rules.is_sto || rules.cash_on_site
            ? 'При выдаче на СТО / самовывозе (после «Принято налом» или оплаты)'
            : 'При выдаче / отгрузке',
      status: hasFull ? 'done' : 'todo',
      action: hasFull ? undefined : 'fiscal:full',
    });
  }

  // 5. Склад / выдача
  if (rules.payment_required_for_ship && !paid && !rules.cash_received) {
    steps.push({
      id: 'ship',
      title: 'Склад / отгрузка',
      detail: 'После оплаты — задание на склад / расходная',
      status: 'todo',
      action: 'warehouse',
    });
  } else {
    steps.push({
      id: 'ship',
      title: hasOut ? 'Отгрузка / расходная' : 'Склад / выдача',
      detail: hasOut
        ? 'Расходная есть'
        : rules.is_sto
          ? 'Выдача на СТО после работ; при необходимости — «На склад»'
          : 'Задание на склад или УПД + расходная',
      status: hasOut ? 'done' : 'todo',
      action: hasOut ? undefined : 'warehouse',
    });
  }

  // Отметить active = первый не-done/skip
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
