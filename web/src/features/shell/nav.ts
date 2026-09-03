export type NavSection = {
  id: string;
  label: string;
  icon: 'home' | 'crm' | 'sales' | 'documents' | 'purchases' | 'warehouse' | 'works' | 'production' | 'money' | 'kassa' | 'tax' | 'staff' | 'chats' | 'company' | 'settings' | 'ideas' | 'help';
  /** Чистый URL раздела (классический UI или React) */
  href?: string;
};

export const NAV_SECTIONS: NavSection[] = [
  { id: 'home', label: 'Главное', icon: 'home', href: '/' },
  { id: 'crm', label: 'CRM', icon: 'crm', href: '/crm' },
  { id: 'sales', label: 'Продажи', icon: 'sales', href: '/sales' },
  { id: 'documents', label: 'Документы', icon: 'documents', href: '/documents' },
  { id: 'purchases', label: 'Закупки', icon: 'purchases', href: '/purchases' },
  { id: 'warehouse', label: 'Склад', icon: 'warehouse', href: '/warehouse' },
  { id: 'works', label: 'Работы', icon: 'works', href: '/works' },
  { id: 'production', label: 'Производство', icon: 'production', href: '/production' },
  { id: 'money', label: 'Деньги', icon: 'money', href: '/money' },
  { id: 'tax', label: 'Налоги', icon: 'tax', href: '/tax' },
  { id: 'kassa', label: 'Касса', icon: 'kassa', href: '/kassa' },
  { id: 'staff', label: 'Персонал', icon: 'staff', href: '/staff' },
  { id: 'chats', label: 'Чаты', icon: 'chats', href: '/chats' },
  { id: 'company', label: 'Компания', icon: 'company', href: '/company' },
  { id: 'settings', label: 'Настройки', icon: 'settings', href: '/settings' },
  { id: 'ideas', label: 'Идеи и ошибки', icon: 'ideas', href: '/ideas' },
  { id: 'help', label: 'Помощь', icon: 'help', href: '/help' },
];

/**
 * Разделы меню «сейчас» по ТЗ / VISION (Э0–Э1: склад, продажи, деньги).
 * Скрыты: CRM (глубина позже), Работы/СТО, Производство, «Идеи».
 */
export const NAV_SECTIONS_NOW_IDS = new Set([
  'home',
  'sales',
  'documents',
  'purchases',
  'warehouse',
  'money',
  'tax',
  'kassa',
  'staff',
  'chats',
  'company',
  'settings',
  'help',
]);

export const NAV_SECTIONS_NOW = NAV_SECTIONS.filter((s) => NAV_SECTIONS_NOW_IDS.has(s.id));

export type SectionLink = { to?: string; label: string; disabled?: boolean };

export const SECTION_LINKS: Record<string, SectionLink[][]> = {
  crm: [
    [
      { to: '/counterparties', label: 'Контрагенты' },
      { to: '/crm/deals', label: 'Заказы покупателей' },
      { to: '/pipelines', label: 'Воронки Amo' },
    ],
  ],
  sales: [
    [
      { to: '/buyers', label: 'Покупатели' },
      { to: '/crm/deals', label: 'Заказы покупателей' },
      { to: '/products', label: 'Номенклатура' },
      { to: '/prices', label: 'Типы цен' },
    ],
  ],
  documents: [
    [
      { to: '/docs', label: 'Списания' },
      { to: '/in', label: 'Приходные накладные' },
      { to: '/in/new', label: 'Создать приходную' },
      { to: '/sales/invoices', label: 'Счета на оплату' },
      { to: '/sales/workorders', label: 'Заказ-наряды' },
      { to: '/sales/upd', label: 'УПД' },
      { to: '/sales/sf', label: 'Счета-фактуры' },
      { to: '/contracts', label: 'Договоры' },
      { to: '/contracts/new', label: 'Создать договор' },
      { to: '/sto-templates', label: 'Шаблоны СТО' },
    ],
  ],
  purchases: [
    [
      { to: '/suppliers', label: 'Поставщики' },
      { to: '/purchases/price-intake', label: 'Прайсы и корзины' },
      { to: '/in', label: 'Приходные накладные' },
      { to: '/in/new', label: 'Создать приходную' },
      { to: '/supply?v=dm10', label: 'Заказы · марки / штрихкод' },
      { to: '/purchases/supplier-orders', label: 'Заказы поставщикам (журнал)' },
      { to: '/in/scan?v=dm5', label: 'Скан Data Matrix' },
    ],
  ],
  warehouse: [
    [
      { to: '/warehouses', label: 'Склады' },
      { to: '/warehouse/cells', label: 'Адресные ячейки' },
    ],
  ],
  company: [
    [
      { to: '/organizations', label: 'Организации' },
      { to: '/counterparties', label: 'Контрагенты' },
      { to: '/suppliers', label: 'Поставщики' },
      { to: '/buyers', label: 'Покупатели' },
      { to: '/currencies', label: 'Валюты' },
    ],
  ],
  money: [
    [
      { to: '/sales/invoices', label: 'Счета на оплату' },
      { to: '/settings/payment-link', label: 'Ссылка на оплату' },
      { to: '/payment-orders', label: 'Платежные поручения' },
      { to: '/kassa', label: 'Касса' },
      { to: '/income', label: 'Доход (зеркало)' },
      { to: '/currencies', label: 'Валюты и курсы' },
      { to: '/money/reports', label: 'Отчёты по деньгам' },
    ],
  ],
  tax: [
    [
      { to: '/tax/calendar', label: 'Календарь' },
      { to: '/tax/vat', label: 'НДС' },
      { to: '/tax/usn', label: 'УСН / КУДиР' },
      { to: '/tax/payroll', label: 'Зарплата' },
      { to: '/tax/reports', label: 'Отчёты' },
      { to: '/tax/filings', label: 'Отправки (Контур)' },
      { to: '/tax/archive', label: 'Архив эталонов' },
      { to: '/tax/settings', label: 'Настройки' },
    ],
  ],
  kassa: [
    [
      { to: '/kassa', label: 'Кассы (остатки)' },
      { to: '/cash-registers', label: 'Справочник касс' },
      { to: '/cash', label: 'Документы по кассе' },
      { to: '/cash-book', label: 'Кассовая книга' },
      { to: '/cash-articles', label: 'Статьи движения денег' },
      { to: '/settings/atol', label: 'АТОЛ' },
    ],
  ],
  settings: [
    [
      { to: '/settings/my', label: 'Мои настройки' },
      { to: '/settings/stats', label: 'Состояние и синк' },
      { to: '/delivery/cdek/settings', label: 'СДЭК' },
      { to: '/settings/atol', label: 'АТОЛ' },
      { to: '/settings/tochka', label: 'Точка Банк' },
      { to: '/settings/doc-templates', label: 'Шаблоны документов' },
      { to: '/settings/warranty', label: 'Гарантии' },
      { to: '/staff', label: 'Сотрудники' },
      { to: '/audit', label: 'История / логи' },
      { to: '/settings/equipment', label: 'Оборудование' },
    ],
  ],
};
