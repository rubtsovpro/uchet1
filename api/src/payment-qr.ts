/**
 * QR для оплаты счёта (ГОСТ Р 56042-2014, ST00012) — автозаполнение в банковском приложении.
 */
import bwipjs from 'bwip-js';
import type { OrgProfile } from './organizations.js';

function formatRuMoneyLocal(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const [r, k] = v.toFixed(2).split('.');
  return `${r.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${k}`;
}

function formatDocDateShort(iso: string): string {
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}.${m}.${y}`;
}

/** Текст назначения платежа для счёта (и в QR, и в примечании). */
export function buildInvoicePaymentPurpose(opts: {
  number: string;
  docDate: string;
  amountNoVat: number;
  vatAmount: number;
  vatRate: number;
  total: number;
}): string {
  const num = String(opts.number || '').trim() || '—';
  const dateShort = formatDocDateShort(opts.docDate);
  const total = Number(opts.total) || 0;
  const vatRate = Number(opts.vatRate) || 0;
  const vatAmt = Number(opts.vatAmount) || 0;
  const amountNoVat = Number(opts.amountNoVat) || 0;
  const parts = [`Оплата счета № ${num} от ${dateShort}`];
  if (vatRate > 0 && vatAmt > 0) {
    parts.push(`Сумма ${formatRuMoneyLocal(total)} руб.`);
    parts.push(`в т.ч. НДС ${vatRate}% — ${formatRuMoneyLocal(vatAmt)}`);
    if (amountNoVat > 0) parts.push(`без НДС ${formatRuMoneyLocal(amountNoVat)}`);
  } else {
    parts.push(`Сумма ${formatRuMoneyLocal(total)} руб., без НДС`);
  }
  return parts.join('. ') + '.';
}

function cleanField(v: string, max = 160): string {
  return String(v || '')
    .replace(/\|/g, '/')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Полезная нагрузка QR ST00012 для перевода на расчётный счёт. */
export function buildGostPaymentQrPayload(
  org: OrgProfile,
  opts: { sum: number; purpose: string }
): string {
  const sumKop = Math.max(0, Math.round(Number(opts.sum) * 100));
  const fields: Array<[string, string]> = [
    ['Name', cleanField(org.name || org.short_name || '', 160)],
    ['PersonalAcc', cleanField(org.rs || '', 20)],
    ['BankName', cleanField(org.bank || '', 160)],
    ['BIC', cleanField(org.bik || '', 9)],
    ['CorrespAcc', cleanField(org.ks || '', 20)],
    ['PayeeINN', cleanField(String(org.inn || '').replace(/\D/g, ''), 12)],
    ['Purpose', cleanField(opts.purpose, 210)],
    ['Sum', String(sumKop)],
  ];
  const kpp = String(org.kpp || '').replace(/\D/g, '');
  if (kpp) fields.push(['KPP', kpp.slice(0, 9)]);
  return 'ST00012|' + fields.map(([k, v]) => `${k}=${v}`).join('|');
}

export async function renderPaymentQrPng(
  org: OrgProfile,
  opts: { sum: number; purpose: string; scale?: number }
): Promise<Buffer> {
  const text = buildGostPaymentQrPayload(org, opts);
  if (!org.rs || !org.bik) {
    throw new Error('Для QR оплаты нужны р/с и БИК юрлица');
  }
  const scale = Math.min(8, Math.max(2, Number(opts.scale) || 4));
  const png = await bwipjs.toBuffer({
    bcid: 'qrcode',
    text,
    scale,
    paddingwidth: 4,
    paddingheight: 4,
    backgroundcolor: 'FFFFFF',
    includetext: false,
  });
  return png;
}
