/**
 * Волна B: CRM / Работы(СТО) / Производство / боковое —
 * тонкие журналы для закрытия оставшихся «нет» карты УНФ.
 * Append-only в parity-batch-a; UI — sections-parity-wave-b.js (merge-меню).
 * Не перезаписывает sections-crm-ops / parity-a / money.
 */

export type WaveBSection =
  | 'crm'
  | 'works'
  | 'production'
  | 'home'
  | 'settings';

type WaveMeta = {
  key: string;
  title: string;
  prefix: string;
  note: string;
  section: WaveBSection;
  map_ids: string[];
};

export const WAVE_B_THIN_JOURNALS: WaveMeta[] = [
  // ——— CRM ———
  {
    key: 'crm_leads',
    title: 'Лиды',
    prefix: 'ЛД',
    note: 'Локальный журнал лидов. Живой поток — в Amo CRM; здесь заготовка / ручной ввод. Пусто OK.',
    section: 'crm',
    map_ids: ['crm.leads'],
  },
  {
    key: 'crm_contracts',
    title: 'Договоры',
    prefix: 'ДГ',
    note: 'Журнал договоров с контрагентами. Полные шаблоны/печатные формы — в 1С или позже. Пусто OK.',
    section: 'crm',
    map_ids: ['crm.contracts'],
  },
  {
    key: 'crm_mail',
    title: 'Почта',
    prefix: 'ПЧ',
    note: 'Журнал почтовых событий (локально). Полноценный почтовый клиент остаётся во внешнем контуре / 1С.',
    section: 'crm',
    map_ids: ['crm.mail'],
  },
  {
    key: 'crm_calls',
    title: 'Звонки',
    prefix: 'ЗВ',
    note: 'Журнал звонков. МегаФон → Amo; сюда — ручные записи и будущий §16 синк. Пусто OK.',
    section: 'crm',
    map_ids: ['crm.calls'],
  },
  {
    key: 'crm_sms',
    title: 'SMS',
    prefix: 'SMS',
    note: 'Журнал SMS. Массовые рассылки и шлюз — отдельно; здесь журнал. Пусто OK.',
    section: 'crm',
    map_ids: ['crm.sms'],
  },
  {
    key: 'crm_contact_center',
    title: 'Контакт-центр',
    prefix: 'КЦ',
    note: 'Заготовка контакт-центра (очередь обращений). Пусто OK.',
    section: 'crm',
    map_ids: ['crm.contact_center'],
  },
  {
    key: 'crm_pnevmopro_export',
    title: 'Настройки выгрузки для сайта ПневмоПро',
    prefix: 'ППВ',
    note: 'Параметры/журнал выгрузки каталога на сайт ПневмоПро. Без live-пуша ключей. Пусто OK.',
    section: 'crm',
    map_ids: ['crm.pnevmopro_export'],
  },
  {
    key: 'crm_income_users',
    title: 'Пользователи для дохода',
    prefix: 'ПДХ',
    note: 'Справочник пользователей, учитываемых в доходе. Связь с /income. Пусто OK.',
    section: 'crm',
    map_ids: ['crm.income_users'],
  },
  {
    key: 'crm_webshop',
    title: 'Интернет-магазин',
    prefix: 'ИМ',
    note: 'Журнал заказов/настроек интернет-магазина (локально). Live storefront — отдельно.',
    section: 'crm',
    map_ids: ['crm.webshop'],
  },
  {
    key: 'crm_contact_forms',
    title: 'Контактные формы',
    prefix: 'КФ',
    note: 'Заявки с контактных форм сайта. Пусто OK до вебхука.',
    section: 'crm',
    map_ids: ['crm.contact_forms'],
  },
  {
    key: 'crm_mag1c',
    title: 'Веб-витрина mag1c',
    prefix: 'MAG',
    note: 'Заготовка витрины mag1c. Вне scope v1; журнал напоминаний. Пусто OK.',
    section: 'crm',
    map_ids: ['crm.mag1c'],
  },
  {
    key: 'crm_mass_mailings',
    title: 'Массовые рассылки (E-mail, SMS)',
    prefix: 'МР',
    note: 'Планы/журналы массовых рассылок. Отправка — через внешний сервис. Пусто OK.',
    section: 'crm',
    map_ids: ['crm.mass_mailings'],
  },
  {
    key: 'crm_lead_sources',
    title: 'Источники привлечения',
    prefix: 'ИП',
    note: 'Справочник источников (Roistat/Amo/сайт). Пусто OK.',
    section: 'crm',
    map_ids: ['crm.lead_sources'],
  },
  {
    key: 'crm_unf_assistant',
    title: 'Ассистент управления нашей фирмой',
    prefix: 'АСС',
    note: 'Заметки/подсказки ассистента УНФ в Учёте №1. Полный ассистент 1С не переносится.',
    section: 'crm',
    map_ids: ['crm.unf_assistant'],
  },
  {
    key: 'crm_workflow_rules',
    title: 'Правила рабочего процесса',
    prefix: 'ПРП',
    note: 'Реестр правил/роботов. Роботы 1С остаются в 1С; здесь — перечень для паритета меню.',
    section: 'crm',
    map_ids: ['crm.workflow_rules'],
  },
  {
    key: 'crm_templates_kp',
    title: 'Шаблоны КП и договоров',
    prefix: 'ШКП',
    note: 'Каталог шаблонов КП/договоров. Шаблон БМП (купля-продажа + услуги) — встроен, печать из сделки или отсюда.',
    section: 'crm',
    map_ids: ['crm.templates_kp'],
  },
  {
    key: 'crm_templates_mail',
    title: 'Шаблоны писем, SMS',
    prefix: 'ШПС',
    note: 'Шаблоны исходящих писем и SMS. Пусто OK.',
    section: 'crm',
    map_ids: ['crm.templates_mail'],
  },
  {
    key: 'crm_spark',
    title: '1СПАРК Риски',
    prefix: 'СПР',
    note: 'Заготовка проверки контрагентов (СПАРК). Live API 1СПАРК не подключён. Пусто OK.',
    section: 'crm',
    map_ids: ['crm.spark'],
  },

  // ——— Работы / СТО ———
  {
    key: 'works_time',
    title: 'Учет времени (СТО)',
    prefix: 'УВС',
    note: 'Журнал учёта времени по заказ-нарядам СТО. Пусто OK.',
    section: 'works',
    map_ids: ['works.time'],
  },
  {
    key: 'works_resource_planner',
    title: 'Планировщик ресурсов (СТО)',
    prefix: 'ПРС',
    note: 'Планирование постов/подъёмников. Связь с /works/resources. Пусто OK.',
    section: 'works',
    map_ids: ['works.resource_planner'],
  },
  {
    key: 'works_schedules',
    title: 'Графики работы (СТО)',
    prefix: 'ГРС',
    note: 'Графики смен СТО. Пусто OK.',
    section: 'works',
    map_ids: ['works.schedules'],
  },
  {
    key: 'works_brigades',
    title: 'Бригады (СТО)',
    prefix: 'БРС',
    note: 'Справочник бригад СТО. Пусто OK.',
    section: 'works',
    map_ids: ['works.brigades'],
  },
  {
    key: 'works_executors',
    title: 'Исполнители работ',
    prefix: 'ИСП',
    note: 'Исполнители заказ-нарядов / ЗП исполнителей (журнал). Пусто OK.',
    section: 'works',
    map_ids: ['works.executors'],
  },
  {
    key: 'works_executor_pct',
    title: 'Процент работ исполнителя',
    prefix: 'ПИР',
    note: 'Доли/проценты исполнителей по работам. Пусто OK.',
    section: 'works',
    map_ids: ['works.executor_pct'],
  },
  {
    key: 'works_executor_jobs',
    title: 'Работы исполнителей',
    prefix: 'РИС',
    note: 'Журнал выполненных работ по исполнителям. Пусто OK.',
    section: 'works',
    map_ids: ['works.executor_jobs'],
  },
  {
    key: 'works_executor_report',
    title: 'Отчет по работам исполнителей',
    prefix: 'ОРИ',
    note: 'Сводка/журнал отчёта по работам исполнителей. Пусто OK.',
    section: 'works',
    map_ids: ['works.executor_report'],
  },
  {
    key: 'works_reports',
    title: 'Отчеты (СТО)',
    prefix: 'ОТС',
    note: 'Хаб отчётов раздела Работы/СТО. Пусто OK.',
    section: 'works',
    map_ids: ['works.reports'],
  },
  {
    key: 'works_extra',
    title: 'Дополнительные обработки (СТО)',
    prefix: 'ДОС',
    note: 'Реестр доп. обработок раздела Работы. Пусто OK.',
    section: 'works',
    map_ids: ['works.extra'],
  },

  // ——— Производство ———
  {
    key: 'prod_cost_alloc',
    title: 'Распределения затрат',
    prefix: 'РЗТ',
    note: 'Журнал распределений затрат производства. Пусто OK.',
    section: 'production',
    map_ids: ['production.cost_alloc'],
  },
  {
    key: 'prod_transfers',
    title: 'Перемещения (производство)',
    prefix: 'ПМП',
    note: 'Перемещения в контуре производства. Пусто OK.',
    section: 'production',
    map_ids: ['production.transfers'],
  },
  {
    key: 'prod_rework',
    title: 'Документы переработки',
    prefix: 'ДПР',
    note: 'Журнал документов переработки. Пусто OK.',
    section: 'production',
    map_ids: ['production.rework'],
  },
  {
    key: 'prod_piecework',
    title: 'Сдельные наряды',
    prefix: 'СН',
    note: 'Сдельные наряды производства. Пусто OK.',
    section: 'production',
    map_ids: ['production.piecework'],
  },
  {
    key: 'prod_time',
    title: 'Учет времени (производство)',
    prefix: 'УВП',
    note: 'Учёт времени по производственным заказам. Пусто OK.',
    section: 'production',
    map_ids: ['production.time'],
  },
  {
    key: 'prod_resource_planner',
    title: 'Планировщик ресурсов (производство)',
    prefix: 'ПРП',
    note: 'Планирование ресурсов производства. Пусто OK.',
    section: 'production',
    map_ids: ['production.resource_planner'],
  },
  {
    key: 'prod_mrp',
    title: 'Расчет потребностей',
    prefix: 'РПТ',
    note: 'Расчёт потребностей (MRP-заготовка). Пусто OK.',
    section: 'production',
    map_ids: ['production.mrp'],
  },
  {
    key: 'prod_specs',
    title: 'Спецификации',
    prefix: 'СПЦ',
    note: 'Спецификации изделий (BOM). Пусто OK.',
    section: 'production',
    map_ids: ['production.specs'],
  },
  {
    key: 'prod_schedules',
    title: 'Графики работы (производство)',
    prefix: 'ГРП',
    note: 'Графики смен производства. Пусто OK.',
    section: 'production',
    map_ids: ['production.schedules'],
  },
  {
    key: 'prod_resources',
    title: 'Ресурсы (производство)',
    prefix: 'РЕС',
    note: 'Справочник ресурсов производства. Пусто OK.',
    section: 'production',
    map_ids: ['production.resources'],
  },
  {
    key: 'prod_brigades',
    title: 'Бригады (производство)',
    prefix: 'БРП',
    note: 'Бригады производства. Пусто OK.',
    section: 'production',
    map_ids: ['production.brigades'],
  },
  {
    key: 'prod_purchase_analysis',
    title: 'Анализ заявок на закупку',
    prefix: 'АЗЗ',
    note: 'Анализ заявок на закупку под производство. Пусто OK.',
    section: 'production',
    map_ids: ['production.purchase_analysis'],
  },
  {
    key: 'prod_ops_docs_report',
    title: 'Отчет по документам заказов, производства и продаж',
    prefix: 'ОДП',
    note: 'Сводный отчёт/журнал документов пр-ва и продаж. Пусто OK.',
    section: 'production',
    map_ids: ['production.ops_docs_report'],
  },
  {
    key: 'prod_extra',
    title: 'Отчеты / Доп. обработки (производство)',
    prefix: 'ДОП',
    note: 'Хабы отчётов и доп. обработок производства. Пусто OK.',
    section: 'production',
    map_ids: ['production.extra'],
  },

  // ——— Боковое ———
  {
    key: 'sidebar_diadoc',
    title: 'Контур.Диадок',
    prefix: 'ДДК',
    note: 'ЭДО Диадок остаётся у 1С. Здесь — напоминания/ссылки статуса обмена. Пусто OK.',
    section: 'home',
    map_ids: ['sidebar.diadoc'],
  },
];
