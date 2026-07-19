export type NavSection = {
  id: string;
  label: string;
  icon: 'home' | 'crm' | 'sales' | 'purchases' | 'warehouse' | 'works' | 'production' | 'money' | 'staff' | 'company' | 'settings' | 'ideas' | 'help';
  /** Чистый URL раздела (классический UI или React) */
  href?: string;
};

export const NAV_SECTIONS: NavSection[] = [
  { id: 'home', label: 'Главное', icon: 'home', href: '/' },
  { id: 'crm', label: 'CRM', icon: 'crm', href: '/crm' },
  { id: 'sales', label: 'Продажи', icon: 'sales', href: '/sales' },
  { id: 'purchases', label: 'Закупки', icon: 'purchases', href: '/purchases' },
  { id: 'warehouse', label: 'Склад', icon: 'warehouse', href: '/warehouse' },
  { id: 'works', label: 'Работы', icon: 'works', href: '/works' },
  { id: 'production', label: 'Производство', icon: 'production', href: '/production' },
  { id: 'money', label: 'Деньги', icon: 'money', href: '/money/tochka' },
  { id: 'staff', label: 'Персонал', icon: 'staff', href: '/staff' },
  { id: 'company', label: 'Компания', icon: 'company', href: '/company' },
  { id: 'settings', label: 'Настройки', icon: 'settings', href: '/settings' },
  { id: 'ideas', label: 'Идеи и ошибки', icon: 'ideas', href: '/ideas' },
  { id: 'help', label: 'Помощь', icon: 'help', href: '/help' },
];

export type SectionLink = { to?: string; label: string; disabled?: boolean };

export const SECTION_LINKS: Record<string, SectionLink[][]> = {
  crm: [
    [
      { to: '/counterparties', label: 'Контрагенты' },
      { to: '/crm/deals', label: 'Сделки Amo' },
      { to: '/pipelines', label: 'Воронки Amo' },
    ],
  ],
  sales: [
    [
      { to: '/sales/invoices', label: 'Счета на оплату' },
      { to: '/sales/workorders', label: 'Заказ-наряды' },
      { to: '/sales/upd', label: 'УПД' },
      { to: '/sales/sf', label: 'Счета-фактуры' },
      { to: '/crm/deals', label: 'Заказы (сделки)' },
      { to: '/docs', label: 'Расходные накладные' },
      { to: '/products', label: 'Номенклатура' },
    ],
  ],
  purchases: [
    [
      { to: '/suppliers', label: 'Поставщики' },
      { to: '/in', label: 'Приходные накладные' },
      { to: '/docs', label: 'Документы' },
      { to: '/products', label: 'Номенклатура' },
    ],
  ],
  warehouse: [
    [
      { to: '/warehouses', label: 'Склады' },
      { to: '/balances', label: 'Остатки' },
      { to: '/docs', label: 'Документы' },
      { to: '/products', label: 'Номенклатура' },
      { to: '/props', label: 'Характеристики' },
      { to: '/marks', label: 'Марки / модели' },
    ],
  ],
  company: [
    [
      { to: '/company/org', label: 'Реквизиты для печати (счёт / УПД)' },
      { to: '/org', label: 'Реквизиты организации' },
    ],
  ],
  money: [
    [
      { to: '/money/tochka', label: 'Точка: балансы и операции' },
      { to: '/sales/invoices', label: 'Счета на оплату (Учёт №1)' },
    ],
  ],
  settings: [
    [
      { to: '/staff', label: 'Сотрудники' },
      { to: '/audit', label: 'История / логи' },
    ],
  ],
};
