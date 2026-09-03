/**
 * Календарь налоговых сроков (РФ, ориентир 2026) по выбранной организации.
 */
import { getTaxSettings } from './settings.js';
import { resolveOrganizationId } from '../organizations.js';

export type CalendarItem = {
  id: string;
  title: string;
  kind: 'report' | 'payment';
  report_type: string;
  due_date: string;
  period_label: string;
  amount_hint: string;
};

function lastDay(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay(y, m))).padStart(2, '0')}`;
}

/** Ближайшие события от «сегодня» на 12 месяцев вперёд + незакрытый прошлый квартал. */
export function buildTaxCalendar(organizationId?: string | null, now = new Date()): CalendarItem[] {
  const oid = resolveOrganizationId(organizationId);
  const settings = getTaxSettings(oid);
  const y = now.getFullYear();
  const items: CalendarItem[] = [];

  const push = (it: Omit<CalendarItem, 'id'> & { id?: string }) => {
    items.push({ ...it, id: it.id || `${it.report_type}-${it.due_date}` });
  };

  for (let yy = y - 1; yy <= y + 1; yy++) {
    for (const q of [1, 2, 3, 4]) {
      // НДС: 25 число месяца после квартала
      const vatMonth = q * 3 + 1 > 12 ? 1 : q * 3 + 1;
      const vatYear = q * 3 + 1 > 12 ? yy + 1 : yy;
      if (settings.vat_payer) {
        push({
          title: `Декларация НДС · ${q} кв. ${yy}`,
          kind: 'report',
          report_type: 'NDS',
          due_date: iso(vatYear, vatMonth, 25),
          period_label: `${q} кв. ${yy}`,
          amount_hint: 'к уплате / возмещению',
        });
        push({
          title: `Уплата НДС · ${q} кв. ${yy}`,
          kind: 'payment',
          report_type: 'NDS_PAY',
          due_date: iso(vatYear, vatMonth, 28),
          period_label: `${q} кв. ${yy}`,
          amount_hint: '1/3 или полная сумма',
        });
      }

      // УСН аванс: 28 число месяца после квартала (годовая — 28 апреля / для ИП)
      const usnMonth = vatMonth;
      const usnYear = vatYear;
      push({
        title: q === 4 ? `Декларация УСН · ${yy}` : `Аванс УСН · ${q} кв. ${yy}`,
        kind: q === 4 ? 'report' : 'payment',
        report_type: q === 4 ? 'USN' : 'USN_ADV',
        due_date: iso(usnYear, usnMonth === 1 && q === 4 ? 4 : usnMonth, q === 4 ? 28 : 28),
        period_label: q === 4 ? `год ${yy}` : `${q} кв. ${yy}`,
        amount_hint: `${settings.usn_rate}% УСН`,
      });
    }

    for (const m of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const dueM = m === 12 ? 1 : m + 1;
      const dueY = m === 12 ? yy + 1 : yy;
      push({
        title: `Перс. сведения · ${String(m).padStart(2, '0')}.${yy}`,
        kind: 'report',
        report_type: 'PERS',
        due_date: iso(dueY, dueM, 25),
        period_label: `${m}.${yy}`,
        amount_hint: '',
      });
      if (m % 3 === 0) {
        const q = m / 3;
        push({
          title: `6‑НДФЛ · ${q} кв. ${yy}`,
          kind: 'report',
          report_type: '6NDFL',
          due_date: iso(dueY, dueM, 25),
          period_label: `${q} кв. ${yy}`,
          amount_hint: '',
        });
        push({
          title: `РСВ · ${q === 4 ? 'год' : q + ' кв.'} ${yy}`,
          kind: 'report',
          report_type: 'RSV',
          due_date: iso(dueY, dueM, 25),
          period_label: `${q} кв. ${yy}`,
          amount_hint: '',
        });
        push({
          title: `ЕФС‑1 · ${q} кв. ${yy}`,
          kind: 'report',
          report_type: 'EFS1',
          due_date: iso(dueY, dueM, 25),
          period_label: `${q} кв. ${yy}`,
          amount_hint: '',
        });
      }
      // Уведомления ЕНС — 25 число месяца
      push({
        title: `Уведомление об исчисленных суммах · ${String(m).padStart(2, '0')}.${yy}`,
        kind: 'report',
        report_type: 'NOTICE',
        due_date: iso(yy, m, 25),
        period_label: `${m}.${yy}`,
        amount_hint: 'ЕНС',
      });
    }
  }

  const today = iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const horizon = new Date(now);
  horizon.setMonth(horizon.getMonth() + 12);
  const horizonIso = iso(horizon.getFullYear(), horizon.getMonth() + 1, horizon.getDate());

  return items
    .filter((x) => x.due_date >= today && x.due_date <= horizonIso)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 80);
}
