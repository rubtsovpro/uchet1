/**
 * Акт приёма: комплектность / ключи / топливо — с телефона приёмщика → в ЗН.
 */

export type IntakeCompletenessId =
  | 'spare'
  | 'jack'
  | 'tools'
  | 'aid'
  | 'extinguisher'
  | 'triangle'
  | 'mats'
  | 'radio'
  | 'dashcam'
  | 'tachograph';

export const INTAKE_COMPLETENESS_ITEMS: Array<{ id: IntakeCompletenessId; label: string }> = [
  { id: 'spare', label: 'запасное колесо' },
  { id: 'jack', label: 'домкрат' },
  { id: 'tools', label: 'набор инструмента' },
  { id: 'aid', label: 'аптечка' },
  { id: 'extinguisher', label: 'огнетушитель' },
  { id: 'triangle', label: 'знак аварийной остановки' },
  { id: 'mats', label: 'коврики' },
  { id: 'radio', label: 'автомагнитола' },
  { id: 'dashcam', label: 'видеорегистратор' },
  { id: 'tachograph', label: 'тахограф' },
];

export type DealIntakeAct = {
  fuel_level: string;
  keys_count: string;
  /** '' | 'no' | 'yes' */
  docs_left: string;
  docs_note: string;
  damage_notes: string;
  completeness: IntakeCompletenessId[];
  completeness_other: string;
};

export function parseCompletenessJson(raw: unknown): IntakeCompletenessId[] {
  const allowed = new Set(INTAKE_COMPLETENESS_ITEMS.map((x) => x.id));
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) arr = j;
    } catch {
      arr = [];
    }
  }
  return arr
    .map((x) => String(x || '').trim())
    .filter((id): id is IntakeCompletenessId => allowed.has(id as IntakeCompletenessId));
}

export function intakeActFromDeal(deal: Record<string, unknown> | null | undefined): DealIntakeAct {
  const d = deal || {};
  return {
    fuel_level: String(d.car_fuel_level || '').trim(),
    keys_count: String(d.car_keys_count || '').trim(),
    docs_left: String(d.car_docs_left || '').trim(),
    docs_note: String(d.car_docs_note || '').trim(),
    damage_notes: String(d.car_damage_notes || '').trim(),
    completeness: parseCompletenessJson(d.car_completeness),
    completeness_other: String(d.car_completeness_other || '').trim(),
  };
}

function mark(on: boolean): string {
  return on ? '☑' : '☐';
}

/** Строка 3.2 для бланка (юр / физ). */
export function formatCompletenessLine(
  act: DealIntakeAct,
  opts?: { withTachograph?: boolean }
): string {
  const withTacho = opts?.withTachograph !== false;
  const set = new Set(act.completeness);
  const bits = INTAKE_COMPLETENESS_ITEMS.filter((x) => withTacho || x.id !== 'tachograph').map(
    (x) => `${mark(set.has(x.id))} ${x.label}`
  );
  const other = act.completeness_other
    ? `${mark(true)} иное: ${act.completeness_other}`
    : `${mark(false)} иное: __________________`;
  return `3.2. Комплектность: ${[...bits, other].join(' ')}`;
}

/** Строка 3.3 ключи + документы. */
export function formatKeysDocsLine(act: DealIntakeAct, mode: 'legal' | 'person'): string {
  const keys = act.keys_count ? String(act.keys_count) : '____';
  const docsLabel =
    mode === 'legal'
      ? 'Документы, переданные с транспортным средством'
      : 'Документы, оставленные в салоне';
  const no = act.docs_left === 'no';
  const yes = act.docs_left === 'yes';
  const note = yes && act.docs_note ? act.docs_note : '__________________________';
  return `3.3. Ключи и брелоки переданы: ${keys} шт. ${docsLabel}: ${mark(no)} нет ${mark(yes)} да: ${note}`;
}

export function formatDamageLines(act: DealIntakeAct): string {
  const t = act.damage_notes.trim();
  if (!t) {
    return '______________________________________________________________________________________\n______________________________________________________________________________________';
  }
  return t;
}
