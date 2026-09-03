/**
 * Чек-лист приёма / выдачи авто для СТО (мастер-приёмщик) — к заказ-наряду.
 * Источник: бланк 15 + регламент приёмщика (Правила № 780).
 */
export type StoChecklistPhase = 'intake' | 'repair' | 'handover';

export type StoChecklistItem = {
  id: string;
  phase: StoChecklistPhase;
  label: string;
  /** Подсказка: что сделать и зачем */
  hint: string;
  /** Опциональный бланк для печати */
  templateId?: string;
  /** Только по ситуации — можно пропустить */
  optional?: boolean;
  /** Только для юрлица / ИП */
  legalOnly?: boolean;
  /** Только для физлица (согласие ПДн и т.п.) */
  personOnly?: boolean;
  /** Нужна загрузка фото в дело ЗН */
  needsPhotos?: boolean;
  /** Минимум фото (для needsPhotos) */
  photosMin?: number;
};

export const STO_CHECKLIST_PHASES: Array<{ id: StoChecklistPhase; title: string; tip: string }> = [
  {
    id: 'intake',
    title: 'А. Приём автомобиля',
    tip: 'Нет подписанного ЗН и акта приёма — нет работ. Документы клиента не изымать.',
  },
  {
    id: 'repair',
    title: 'Б. В процессе ремонта',
    tip: 'Доп. работы без письменного согласия клиент не обязан оплачивать.',
  },
  {
    id: 'handover',
    title: 'В. Выдача автомобиля',
    tip: 'Выдача после полной оплаты: акт сдачи + гарантийный талон + чек.',
  },
];

export const STO_CHECKLIST_ITEMS: StoChecklistItem[] = [
  {
    id: 'id_doc',
    phase: 'intake',
    label: 'Документ, удостоверяющий личность: данные в договоре, документ возвращён',
    hint: 'Паспорт / иной документ. Переписать в договор и сразу вернуть клиенту (п. 8 Правил № 780). Изымать нельзя.',
    templateId: 'sto-contract-person',
  },
  {
    id: 'vehicle_docs',
    phase: 'intake',
    label: 'Документ на авто (СТС / ПТС / доверенность); для юрлица — полномочия проверены',
    hint: 'На ЗН заполните авто и СТС (блок «Автомобиль»). Если сдаёт не собственник — основание в договоре. Для юрлица — доверенность.',
  },
  {
    id: 'price_info',
    phase: 'intake',
    label: 'Клиенту показаны прейскурант, сроки и гарантии; вопросы сняты',
    hint: 'До подписи: цены, сроки, гарантийные сроки, порядок оплаты. Стенд / прейскурант в программе должны совпадать.',
  },
  {
    id: 'workorder_filled',
    phase: 'intake',
    label:
      'Заказ-наряд заполнен; подпись 1 получена в количестве 2 шт.; экземпляр выдан Заказчику',
    hint: 'ЗН печатается в 2 экз. (заказчик + исполнитель). Подпись 1 — в обоих; экземпляр заказчика выдать при приёме.',
    templateId: 'sto-workorder',
  },
  {
    id: 'extra_works_rules',
    phase: 'intake',
    label: 'Порядок согласования доп. работ и контакт клиента для связи',
    hint: 'Пустой раздел о доп. работах — грубое нарушение. Зафиксируйте телефон / мессенджер для согласований.',
  },
  {
    id: 'acceptance_act',
    phase: 'intake',
    label: 'Приёмо-сдаточный акт: комплектность, повреждения, пробег, топливо',
    hint: 'Осмотр вместе с клиентом. Без подписанного акта автомобиль в работу не принимается.',
  },
  {
    id: 'photos',
    phase: 'intake',
    label: 'Фотофиксация ≥ 12 кадров (дата/время), файлы в деле ЗН',
    hint: '4 угла, крыша, стёкла, салон, багажник, панель с пробегом и топливом + каждое повреждение. Загрузите сюда — сохранятся в заказ-наряд.',
    needsPhotos: true,
    photosMin: 12,
  },
  {
    id: 'valuables',
    phase: 'intake',
    label: 'Личные вещи / ценности изъяты клиентом или внесены в акт',
    hint: 'Предложите забрать документы и ценности из салона. Оставленное — в акт.',
  },
  {
    id: 'client_parts',
    phase: 'intake',
    label: 'Запчасти клиента приняты по акту с предупреждением об особых свойствах',
    hint: 'Только если клиент привёз свои детали. Без акта и предупреждения — риск ответственности СТО.',
    optional: true,
  },
  {
    id: 'safety_defects',
    phase: 'intake',
    label: 'Неисправности, угрожающие безопасности, записаны во все экземпляры акта',
    hint: 'Если клиент отказался устранять — запись во ВСЕ экземпляры акта + подпись клиента (п. 21 Правил № 780).',
    optional: true,
  },
  {
    id: 'pdn',
    phase: 'intake',
    label: 'Согласие на обработку ПДн подписано отдельным документом',
    hint: 'Только физлицо на СТО (152-ФЗ). Отдельным бланком — не вшивать в договор/ЗН. У юрлица / ИП не берём.',
    templateId: 'sto-pdn-consent',
    personOnly: true,
  },
  {
    id: 'client_copies',
    phase: 'intake',
    label: 'Экземпляр ЗН (1 из 2) выдан Заказчику; подпись о выдаче получена',
    hint: 'Всего 2 экземпляра ЗН. Экземпляр Заказчика — ему на руки; экземпляр Исполнителя — в дело.',
  },
  {
    id: 'legal_checks',
    phase: 'intake',
    label: 'Юрлицо / ИП: ЕГРЮЛ/ЕГРИП, доверенность; лимит наличных ≤ 100 000 ₽ по договору',
    hint: 'Копия доверенности к ЗН. Наличные по одному договору — не больше 100 000 ₽ за весь срок. Отсрочка — только с разрешения ИП.',
    templateId: 'sto-contract-legal',
    legalOnly: true,
  },
  {
    id: 'extra_agreed',
    phase: 'repair',
    label: 'Доп. работы согласованы письменно ДО выполнения; согласие в деле',
    hint: 'Устного «по телефону» мало — акт доп. работ или сообщение «согласен» с номера клиента. Иначе клиент может не платить.',
    optional: true,
  },
  {
    id: 'deadline_notice',
    phase: 'repair',
    label: 'Клиент уведомлён о переносе срока (если был); уведомление сохранено',
    hint: 'Скрин переписки / SMS в дело ЗН.',
    optional: true,
  },
  {
    id: 'old_parts_kept',
    phase: 'repair',
    label: 'Заменённые детали сохранены для предъявления клиенту',
    hint: 'При выдаче передать клиенту или оформить отказ в акте сдачи.',
  },
  {
    id: 'qc_done',
    phase: 'handover',
    label: 'Внутренний контроль качества и комплектности; авто вымыто / убрано',
    hint: 'До вызова клиента: узлы после ремонта, комплектность, товарный вид (п. 24 Правил № 780).',
  },
  {
    id: 'ready_notice',
    phase: 'handover',
    label: 'Клиент уведомлён о готовности; способ и дата зафиксированы',
    hint: 'Зафиксируйте канал и время уведомления в деле.',
  },
  {
    id: 'paid_fiscal',
    phase: 'handover',
    label: 'Расчёт полный; кассовый чек пробит и передан',
    hint: 'Выдача после полной оплаты. Чек на каждый расчёт (аванс / доплата / возврат) — 54-ФЗ.',
  },
  {
    id: 'handover_act',
    phase: 'handover',
    label: 'Акт сдачи-приёмки подписан; недостатки и сроки устранения внесены',
    hint: 'Приёмка вместе с клиентом. Недостатки при выдаче — в акт со сроком безвозмездного устранения.',
  },
  {
    id: 'old_parts_given',
    phase: 'handover',
    label: 'Заменённые детали переданы или оформлен отказ',
    hint: 'Отметка в акте сдачи-приёмки.',
  },
  {
    id: 'warranty',
    phase: 'handover',
    label: 'Выдан гарантийный талон; разъяснены правила эксплуатации',
    hint: 'Всегда вместе с актом 08. Обкатка / протяжка / контрольный визит — в акте.',
  },
  {
    id: 'folder_complete',
    phase: 'handover',
    label: 'Дело ЗН укомплектовано (договор, акты, фото, переписка, чек) и сдано',
    hint: 'Незаполненный чек-лист = нарушение регламента. Хранение ≥ 5 лет.',
  },
];

export function listStoChecklistItems(opts?: { legal?: boolean }) {
  const legal = opts?.legal !== false;
  return STO_CHECKLIST_ITEMS.filter((it) => {
    if (it.legalOnly && !legal) return false;
    if (it.personOnly && legal) return false;
    return true;
  });
}

export type StoChecklistState = {
  checks: Record<string, boolean>;
  master_name?: string;
  admin_name?: string;
  updated_at?: string;
};

export function parseStoChecklistJson(raw: unknown): StoChecklistState {
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    return { checks: {} };
  }
  try {
    const j = JSON.parse(raw) as StoChecklistState;
    return {
      checks: j && typeof j.checks === 'object' && j.checks ? { ...j.checks } : {},
      master_name: String(j.master_name || '').trim() || undefined,
      admin_name: String(j.admin_name || '').trim() || undefined,
      updated_at: String(j.updated_at || '').trim() || undefined,
    };
  } catch {
    return { checks: {} };
  }
}

export function stoChecklistProgress(
  state: StoChecklistState,
  opts?: { legal?: boolean }
): { done: number; total: number; requiredDone: number; requiredTotal: number } {
  const items = listStoChecklistItems(opts);
  const required = items.filter((i) => !i.optional);
  const done = items.filter((i) => state.checks[i.id]).length;
  const requiredDone = required.filter((i) => state.checks[i.id]).length;
  return {
    done,
    total: items.length,
    requiredDone,
    requiredTotal: required.length,
  };
}

/** JSON для UI хаба «Доп. документы» (пункты + галочки по ЗН сделки). */
export function dealStoChecklistPayload(
  deal: Record<string, unknown> | null | undefined,
  workorder: { id: string; checklist_json?: string; number?: string } | null | undefined
) {
  const kind = String(deal?.buyer_kind || '').toLowerCase();
  const legal =
    Number(deal?.is_legal_entity) === 1 || kind === 'legal' || kind === 'ip';
  const state = parseStoChecklistJson(workorder?.checklist_json);
  const items = listStoChecklistItems({ legal });
  const progress = stoChecklistProgress(state, { legal });
  return {
    workorder_id: workorder?.id ? String(workorder.id) : null,
    workorder_number: workorder?.number ? String(workorder.number) : null,
    legal,
    phases: STO_CHECKLIST_PHASES,
    items: items.map((it) => ({
      id: it.id,
      phase: it.phase,
      label: it.label,
      hint: it.hint,
      optional: !!it.optional,
    })),
    state,
    progress,
  };
}
