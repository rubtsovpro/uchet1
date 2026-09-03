/**
 * Эталонная матрица сценариев продаж (F1a…P0).
 * Колонки dog/apps/dover/pas/sts/zn/pdn/inv/upd/xfer/wh/checks = что показывать в заказе покупателя.
 *
 * Склад (wh):
 * — →СТО — перемещение основной → СТО (не WAIT-PAY);
 * — →доставка — перемещение основной → доставка / курьер (наложка и отгрузка);
 * — →выдача — зона/склад самовывоза.
 * Резерв WAIT-PAY при предоплате больше не используем.
 *
 * Юр (L*): по рамочному «Договору поставки товара и оказания услуг по ремонту» —
 * договор + приложения (гарантия / форма заявки / акт недостатков) + счёт/заявка + УПД;
 * доверенность при получении товара (отправка/самовывоз); на СТО ещё СТС + ЗН.
 */
export type SaleScenarioChannel = 'ship' | 'pickup' | 'sto' | '';
export type SaleScenarioBuyer =
  | 'person'
  | 'legal'
  | 'ip'
  | 'partner'
  | 'partner_person'
  | '';
export type SaleScenarioPayK = 'prepay' | 'postpay' | 'onsite' | 'credit' | '';
export type SaleScenarioMethod = 'card' | 'cash' | 'bank' | 'cod' | 'delay' | '';

/** Маршрут склада в матрице ЖЦ. */
export type SaleScenarioStock =
  | '—'
  | '→СТО'
  | '→доставка'
  | '→выдача'
  | '→доставка'
  | '→выдача';

export type SaleScenarioRow = {
  id: string;
  title: string;
  channel: SaleScenarioChannel;
  buyer: SaleScenarioBuyer;
  payK: SaleScenarioPayK;
  method: SaleScenarioMethod;
  dog: 0 | 1;
  /** Приложения к рамочному договору (гарантия, форма заявки, акт недостатков / перечень ТС) */
  apps: 0 | 1;
  /** Доверенность / полномочия при получении · не обязательно (директор/ИП сам — без доверенности) */
  dover: 0 | 1;
  pas: 0 | 1;
  /** СТС / документ на авто — автосервис */
  sts: 0 | 1;
  zn: 0 | 1;
  pdn: 0 | 1;
  inv: 0 | 1;
  upd: 0 | 1;
  xfer: 0 | 1;
  /** Маршрут склада: →СТО / →доставка / →выдача */
  wh: SaleScenarioStock;
  checks: string;
};

/** Полный пакет документов/разделов по сценарию. */
export type ScenarioDocs = {
  scenario_id: string;
  scenario_title: string;
  contract: boolean;
  /** Приложения к договору (юр/ИП) */
  apps: boolean;
  /** Полномочия при выдаче (доверенность или директор/ИП) · подсказка, не блокер */
  power_of_attorney: boolean;
  passport: boolean;
  /** СТС / авто на СТО */
  sts: boolean;
  workorder: boolean;
  pdn: boolean;
  invoice: boolean;
  upd: boolean;
  transfer: boolean;
  /** Маршрут склада из матрицы */
  stock_route: SaleScenarioStock;
  /** '0' | '1' | '2' | '0/1' — как в матрице «Чеки» */
  checks: string;
};

/** Вычислить маршрут склада по каналу / оплате (если wh в строке не задан). */
export function scenarioStockRoute(
  row: Pick<SaleScenarioRow, 'channel' | 'payK' | 'method' | 'xfer'> & { wh?: SaleScenarioStock }
): SaleScenarioStock {
  if (row.wh && !String(row.wh).startsWith('WAIT-PAY')) return row.wh;
  if (!row.xfer) return '—';
  if (row.channel === 'sto') return '→СТО';
  if (row.method === 'cod') return '→доставка';
  if (row.channel === 'pickup') return '→выдача';
  if (row.channel === 'ship') return '→доставка';
  return '→доставка';
}

export const SALE_SCENARIO_MATRIX: SaleScenarioRow[] = [
  { id: 'F1a', title: 'Физлицо · отправка · предоплата (карта/СБП)', channel: 'ship', buyer: 'person', payK: 'prepay', method: 'card', dog: 0, apps: 0, dover: 0, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 0, xfer: 1, wh: '→доставка', checks: '2' },
  { id: 'F1b', title: 'Физлицо · отправка · постоплата (карта/СБП)', channel: 'ship', buyer: 'person', payK: 'postpay', method: 'card', dog: 0, apps: 0, dover: 0, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 0, xfer: 1, wh: '→доставка', checks: '1' },
  { id: 'F1c', title: 'Физлицо · отправка · наложка (СДЭК / Авито)', channel: 'ship', buyer: 'person', payK: 'postpay', method: 'cod', dog: 0, apps: 0, dover: 0, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 0, xfer: 1, wh: '→доставка', checks: '0' },
  { id: 'F2a', title: 'Физлицо · самовывоз · предоплата заранее', channel: 'pickup', buyer: 'person', payK: 'prepay', method: 'card', dog: 0, apps: 0, dover: 0, pas: 0, sts: 0, zn: 1, pdn: 0, inv: 0, upd: 0, xfer: 1, wh: '→выдача', checks: '2' },
  { id: 'F2b', title: 'Физлицо · самовывоз · оплата на месте', channel: 'pickup', buyer: 'person', payK: 'onsite', method: 'cash', dog: 0, apps: 0, dover: 0, pas: 0, sts: 0, zn: 1, pdn: 0, inv: 0, upd: 0, xfer: 1, wh: '→выдача', checks: '1' },
  { id: 'F3a', title: 'Физлицо · автосервис · предоплата заранее', channel: 'sto', buyer: 'person', payK: 'prepay', method: 'card', dog: 1, apps: 0, dover: 0, pas: 0, sts: 1, zn: 1, pdn: 1, inv: 0, upd: 0, xfer: 1, wh: '→СТО', checks: '2' },
  { id: 'F3b', title: 'Физлицо · автосервис · оплата на месте', channel: 'sto', buyer: 'person', payK: 'onsite', method: 'cash', dog: 1, apps: 0, dover: 0, pas: 0, sts: 1, zn: 1, pdn: 1, inv: 0, upd: 0, xfer: 1, wh: '→СТО', checks: '1' },
  { id: 'F3s', title: 'Физлицо · автосервис · ТОЛЬКО услуги (без запчастей)', channel: 'sto', buyer: 'person', payK: 'onsite', method: 'cash', dog: 1, apps: 0, dover: 0, pas: 0, sts: 1, zn: 1, pdn: 1, inv: 0, upd: 0, xfer: 0, wh: '—', checks: '1' },
  /* Юр: рамочный договор поставки/ремонта + прил. + счёт + УПД; довер. при получении товара */
  { id: 'L1a', title: 'Юрлицо · отправка · предоплата по р/с', channel: 'ship', buyer: 'legal', payK: 'prepay', method: 'bank', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→доставка', checks: '0' },
  { id: 'L1b', title: 'Юрлицо · отправка · постоплата / отсрочка', channel: 'ship', buyer: 'legal', payK: 'postpay', method: 'bank', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→доставка', checks: '0' },
  { id: 'L1c', title: 'Юрлицо · отправка · карта/СБП', channel: 'ship', buyer: 'legal', payK: 'prepay', method: 'card', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→доставка', checks: '1' },
  { id: 'L2a', title: 'Юрлицо · самовывоз · предоплата по р/с', channel: 'pickup', buyer: 'legal', payK: 'prepay', method: 'bank', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→выдача', checks: '0' },
  { id: 'L2b', title: 'Юрлицо · самовывоз · оплата на месте', channel: 'pickup', buyer: 'legal', payK: 'onsite', method: 'card', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→выдача', checks: '0/1' },
  { id: 'L3a', title: 'Юрлицо · автосервис · предоплата по р/с', channel: 'sto', buyer: 'legal', payK: 'prepay', method: 'bank', dog: 1, apps: 1, dover: 0, pas: 0, sts: 1, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→СТО', checks: '0' },
  { id: 'L3b', title: 'Юрлицо · автосервис · постоплата / отсрочка', channel: 'sto', buyer: 'legal', payK: 'postpay', method: 'bank', dog: 1, apps: 1, dover: 0, pas: 0, sts: 1, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→СТО', checks: '0' },
  { id: 'L3c', title: 'Юрлицо · автосервис · оплата на месте', channel: 'sto', buyer: 'legal', payK: 'onsite', method: 'card', dog: 1, apps: 1, dover: 0, pas: 0, sts: 1, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→СТО', checks: '1' },
  /* ИП — тот же пакет, что юр */
  { id: 'I1a', title: 'ИП · отправка · предоплата по р/с', channel: 'ship', buyer: 'ip', payK: 'prepay', method: 'bank', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→доставка', checks: '0' },
  { id: 'I1b', title: 'ИП · отправка · постоплата', channel: 'ship', buyer: 'ip', payK: 'postpay', method: 'bank', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→доставка', checks: '0' },
  { id: 'I2a', title: 'ИП · самовывоз · предоплата по р/с', channel: 'pickup', buyer: 'ip', payK: 'prepay', method: 'bank', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→выдача', checks: '0' },
  { id: 'I2b', title: 'ИП · самовывоз · оплата на месте', channel: 'pickup', buyer: 'ip', payK: 'onsite', method: 'card', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→выдача', checks: '1' },
  { id: 'I3a', title: 'ИП · автосервис · предоплата по р/с', channel: 'sto', buyer: 'ip', payK: 'prepay', method: 'bank', dog: 1, apps: 1, dover: 0, pas: 0, sts: 1, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→СТО', checks: '0' },
  { id: 'I3b', title: 'ИП · автосервис · оплата на месте', channel: 'sto', buyer: 'ip', payK: 'onsite', method: 'card', dog: 1, apps: 1, dover: 0, pas: 0, sts: 1, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→СТО', checks: '1' },
  { id: 'P1a', title: 'Партнёр · отправка · отсрочка', channel: 'ship', buyer: 'partner', payK: 'credit', method: 'delay', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→доставка', checks: '0' },
  { id: 'P2a', title: 'Партнёр · самовывоз · отсрочка', channel: 'pickup', buyer: 'partner', payK: 'credit', method: 'delay', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→выдача', checks: '0' },
  { id: 'P3a', title: 'Партнёр · автосервис · отсрочка', channel: 'sto', buyer: 'partner', payK: 'credit', method: 'delay', dog: 1, apps: 1, dover: 0, pas: 0, sts: 1, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→СТО', checks: '0' },
  { id: 'P0', title: 'Партнёр · любой канал · редкая оплата картой/СБП', channel: '', buyer: 'partner', payK: '', method: 'card', dog: 0, apps: 0, dover: 0, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 0, xfer: 1, wh: '→доставка', checks: '1' },
  /* Партнёр юр/ИП без авто-отсрочки: счёт/УПД, отгрузка без WAIT-PAY */
  { id: 'W1a', title: 'Партнёр · отправка · предоплата по р/с (без отсрочки)', channel: 'ship', buyer: 'partner', payK: 'prepay', method: 'bank', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→доставка', checks: '0' },
  { id: 'W1b', title: 'Партнёр · отправка · постоплата (без отсрочки)', channel: 'ship', buyer: 'partner', payK: 'postpay', method: 'bank', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→доставка', checks: '0' },
  { id: 'W2a', title: 'Партнёр · самовывоз · предоплата по р/с (без отсрочки)', channel: 'pickup', buyer: 'partner', payK: 'prepay', method: 'bank', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→выдача', checks: '0' },
  { id: 'W2b', title: 'Партнёр · самовывоз · оплата на месте (без отсрочки)', channel: 'pickup', buyer: 'partner', payK: 'onsite', method: 'card', dog: 1, apps: 1, dover: 1, pas: 0, sts: 0, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→выдача', checks: '0/1' },
  { id: 'W3a', title: 'Партнёр · автосервис · предоплата по р/с (без отсрочки)', channel: 'sto', buyer: 'partner', payK: 'prepay', method: 'bank', dog: 1, apps: 1, dover: 0, pas: 0, sts: 1, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→СТО', checks: '0' },
  { id: 'W3b', title: 'Партнёр · автосервис · оплата на месте (без отсрочки)', channel: 'sto', buyer: 'partner', payK: 'onsite', method: 'card', dog: 1, apps: 1, dover: 0, pas: 0, sts: 1, zn: 1, pdn: 0, inv: 1, upd: 1, xfer: 1, wh: '→СТО', checks: '1' },
  /* Партнёр-физлицо: ПДн/паспорт как у физ + счёт; не юршаблоны 02 */
  { id: 'Pp1a', title: 'Партнёр-физ · отправка · отсрочка', channel: 'ship', buyer: 'partner_person', payK: 'credit', method: 'delay', dog: 0, apps: 0, dover: 0, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 0, xfer: 1, wh: '→доставка', checks: '0' },
  { id: 'Pp2a', title: 'Партнёр-физ · самовывоз · отсрочка', channel: 'pickup', buyer: 'partner_person', payK: 'credit', method: 'delay', dog: 0, apps: 0, dover: 0, pas: 0, sts: 0, zn: 1, pdn: 0, inv: 1, upd: 0, xfer: 1, wh: '→выдача', checks: '0' },
  { id: 'Pp3a', title: 'Партнёр-физ · автосервис · отсрочка', channel: 'sto', buyer: 'partner_person', payK: 'credit', method: 'delay', dog: 1, apps: 0, dover: 0, pas: 0, sts: 1, zn: 1, pdn: 1, inv: 1, upd: 0, xfer: 1, wh: '→СТО', checks: '0' },
  { id: 'Wp1a', title: 'Партнёр-физ · отправка · счёт (без отсрочки)', channel: 'ship', buyer: 'partner_person', payK: 'prepay', method: 'bank', dog: 0, apps: 0, dover: 0, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 0, xfer: 1, wh: '→доставка', checks: '0' },
  { id: 'Wp1b', title: 'Партнёр-физ · отправка · постоплата', channel: 'ship', buyer: 'partner_person', payK: 'postpay', method: 'bank', dog: 0, apps: 0, dover: 0, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 0, xfer: 1, wh: '→доставка', checks: '0' },
  { id: 'Wp2a', title: 'Партнёр-физ · самовывоз · счёт (без отсрочки)', channel: 'pickup', buyer: 'partner_person', payK: 'prepay', method: 'bank', dog: 0, apps: 0, dover: 0, pas: 0, sts: 0, zn: 1, pdn: 0, inv: 1, upd: 0, xfer: 1, wh: '→выдача', checks: '0' },
  { id: 'Wp2b', title: 'Партнёр-физ · самовывоз · оплата на месте', channel: 'pickup', buyer: 'partner_person', payK: 'onsite', method: 'card', dog: 0, apps: 0, dover: 0, pas: 0, sts: 0, zn: 1, pdn: 0, inv: 1, upd: 0, xfer: 1, wh: '→выдача', checks: '1' },
  { id: 'Wp3a', title: 'Партнёр-физ · автосервис · счёт (без отсрочки)', channel: 'sto', buyer: 'partner_person', payK: 'prepay', method: 'bank', dog: 1, apps: 0, dover: 0, pas: 0, sts: 1, zn: 1, pdn: 1, inv: 1, upd: 0, xfer: 1, wh: '→СТО', checks: '0' },
  { id: 'Wp3b', title: 'Партнёр-физ · автосервис · оплата на месте', channel: 'sto', buyer: 'partner_person', payK: 'onsite', method: 'card', dog: 1, apps: 0, dover: 0, pas: 0, sts: 1, zn: 1, pdn: 1, inv: 1, upd: 0, xfer: 1, wh: '→СТО', checks: '1' },
  { id: 'Wp0', title: 'Партнёр-физ · любой канал · карта/СБП', channel: '', buyer: 'partner_person', payK: '', method: 'card', dog: 0, apps: 0, dover: 0, pas: 0, sts: 0, zn: 0, pdn: 0, inv: 1, upd: 0, xfer: 1, wh: '→доставка', checks: '1' },
];

export function scenarioDocsFromRow(row: SaleScenarioRow): ScenarioDocs {
  return {
    scenario_id: row.id,
    scenario_title: row.title,
    contract: !!row.dog,
    apps: !!row.apps,
    power_of_attorney: !!row.dover,
    passport: !!row.pas,
    sts: !!row.sts,
    workorder: !!row.zn,
    pdn: !!row.pdn,
    invoice: !!row.inv,
    upd: !!row.upd,
    transfer: !!row.xfer,
    stock_route: scenarioStockRoute(row),
    checks: String(row.checks || '0'),
  };
}

export function docPackFromScenarioDocs(
  docs: ScenarioDocs
): Array<'invoice' | 'workorder' | 'upd'> {
  const pack: Array<'invoice' | 'workorder' | 'upd'> = [];
  if (docs.invoice) pack.push('invoice');
  if (docs.workorder) pack.push('workorder');
  if (docs.upd) pack.push('upd');
  return pack;
}
