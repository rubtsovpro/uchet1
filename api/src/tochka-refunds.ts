/**
 * Возвраты через Точку: ПП «на подпись» и возврат по исх. СБП/эквайрингу.
 */
import {
  createTochkaPaymentForSign,
  createTochkaRefund,
  bankApiUrlFromOverview,
} from './bank-tochka.js';
import { all, get, run } from './db.js';
import { getDeal } from './deals.js';
import { getOrganization, getDefaultOrganization } from './organizations.js';
import { markDealMoneyRefunded } from './return-money.js';

export type RefundChannelOption = {
  channel: 'sbp' | 'acquiring';
  label: string;
  amount: number;
  qrc_id?: string;
  operation_id?: string;
  account?: string;
  trx_id?: string;
  payment_id?: string;
  payment_link_id?: string;
  ready: boolean;
  hint?: string;
};

export type RefundOptions = {
  deal_id: string;
  amount_suggest: number;
  channels: RefundChannelOption[];
  preferred: 'sbp' | 'acquiring' | 'payment_for_sign' | '';
  for_sign: {
    ready: boolean;
    missing: string[];
    counterparty_name: string;
    counterparty_inn: string;
    counterparty_bik: string;
    counterparty_rs: string;
    payer_rs: string;
    payer_bik: string;
    customer_code: string;
  };
};

function digits(s: unknown): string {
  return String(s || '').replace(/\D+/g, '');
}

function parseMeta(raw: unknown): Record<string, unknown> {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function paidStatus(st: string): boolean {
  return ['paid', 'confirmed', 'success', 'accepted'].includes(String(st || '').toLowerCase());
}

function dealAmountSuggest(dealId: string): number {
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  if (!deal) return 0;
  const fromDeal = Number(deal.amount || deal.price || 0) || 0;
  const tvd = get<{ amount: number }>(
    `SELECT IFNULL(amount,0) AS amount FROM thin_journal_docs
     WHERE journal_key = 'money_refund_requests'
       AND IFNULL(status,'') IN ('','draft','open','new')
       AND IFNULL(payload_json,'') LIKE ?
     ORDER BY datetime(created_at) DESC LIMIT 1`,
    [`%"deal_id":"${dealId.replace(/"/g, '')}"%`]
  );
  const fromTvd = Number(tvd?.amount || 0) || 0;
  if (fromTvd > 0) return Math.round(fromTvd * 100) / 100;
  return Math.round(fromDeal * 100) / 100;
}

function resolvePayerOrg(dealId: string): {
  rs: string;
  bik: string;
  customer_code: string;
  organization_id: string;
  name: string;
} {
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  const orgId = String(
    (deal as { organization_id?: string } | null)?.organization_id ||
      get<{ organization_id?: string }>(
        `SELECT organization_id FROM payment_links WHERE deal_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`,
        [dealId]
      )?.organization_id ||
      ''
  ).trim();
  const org = (orgId ? getOrganization(orgId) : null) || getDefaultOrganization();
  return {
    rs: digits(org?.rs),
    bik: digits(org?.bik) || '044525104',
    customer_code: String(org?.code || '').trim(),
    organization_id: String(org?.id || ''),
    name: String(org?.name || ''),
  };
}

function resolveCounterpartyBank(dealId: string): {
  name: string;
  inn: string;
  kpp: string;
  bik: string;
  rs: string;
  ks: string;
  counterparty_id: string;
} {
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  const cpId = String(
    deal?.counterparty_id || deal?.buyer_counterparty_id || deal?.contact_counterparty_id || ''
  ).trim();
  let cp: Record<string, unknown> | null = null;
  if (cpId) {
    cp =
      (get(`SELECT * FROM counterparties WHERE id = ?`, [cpId]) as Record<string, unknown> | null) ||
      null;
  }
  if (!cp) {
    const inn = digits(deal?.buyer_inn);
    if (inn) {
      cp =
        (get(
          `SELECT * FROM counterparties WHERE replace(IFNULL(inn,''), ' ', '') = ? LIMIT 1`,
          [inn]
        ) as Record<string, unknown> | null) || null;
    }
  }
  const name = String(
    deal?.buyer_name || deal?.company_name || deal?.name || cp?.name || ''
  ).trim();
  return {
    name,
    inn: digits(deal?.buyer_inn || cp?.inn),
    kpp: digits(deal?.buyer_kpp || cp?.kpp),
    bik: digits(deal?.buyer_bik || cp?.bik),
    rs: digits(deal?.buyer_rs || cp?.rs),
    ks: digits(deal?.buyer_ks || cp?.ks),
    counterparty_id: cpId || String(cp?.id || ''),
  };
}

function listSbpChannels(dealId: string): RefundChannelOption[] {
  const rows = all<{
    id: string;
    amount: number;
    status: string;
    qrc_id: string;
    account: string;
    meta_json: string;
  }>(
    `SELECT id, IFNULL(amount,0) AS amount, IFNULL(status,'') AS status,
            IFNULL(qrc_id,'') AS qrc_id, IFNULL(account,'') AS account,
            IFNULL(meta_json,'') AS meta_json
     FROM deal_payments
     WHERE deal_id = ? AND kind = 'sbp_qr' AND IFNULL(qrc_id,'') != ''
     ORDER BY datetime(created_at) DESC`,
    [dealId]
  );
  const out: RefundChannelOption[] = [];
  for (const r of rows) {
    if (!paidStatus(r.status) && String(r.status).toLowerCase() !== 'accepted') continue;
    const meta = parseMeta(r.meta_json);
    const trx = String(meta.trx_id || meta.trxId || '').trim();
    const account = digits(r.account) || digits(meta.account) || '';
    out.push({
      channel: 'sbp',
      label: 'СБП',
      amount: Number(r.amount) || 0,
      qrc_id: r.qrc_id,
      account: account || undefined,
      trx_id: trx || undefined,
      payment_id: r.id,
      ready: Boolean(r.qrc_id && account.length === 20),
      hint: account.length === 20 ? undefined : 'Нет р/с QR в платеже — укажите account_code',
    });
  }
  return out;
}

function listAcquiringChannels(dealId: string): RefundChannelOption[] {
  const links = all<{
    id: string;
    amount: number;
    status: string;
    acquiring_url: string;
    meta_json: string;
  }>(
    `SELECT id, IFNULL(amount,0) AS amount, IFNULL(status,'') AS status,
            IFNULL(acquiring_url,'') AS acquiring_url, IFNULL(meta_json,'') AS meta_json
     FROM payment_links WHERE deal_id = ?
     ORDER BY datetime(created_at) DESC`,
    [dealId]
  );
  const out: RefundChannelOption[] = [];
  for (const l of links) {
    const meta = parseMeta(l.meta_json);
    const op = String(meta.acquiring_operation_id || meta.operation_id || '').trim();
    if (!op) continue;
    const paid =
      paidStatus(l.status) ||
      Boolean(meta.acquiring_paid) ||
      String(l.status).toLowerCase() === 'paid';
    if (!paid && String(l.status) === 'pending') {
      // ссылка могла быть оплачена картой при статусе pending — всё равно даём попытку
    }
    out.push({
      channel: 'acquiring',
      label: 'Карта / эквайринг',
      amount: Number(l.amount) || 0,
      operation_id: op,
      payment_link_id: l.id,
      ready: Boolean(op),
    });
  }
  return out;
}

export function getDealRefundOptions(dealId: string): RefundOptions {
  const id = String(dealId || '').trim();
  if (!id) throw new Error('Нет заказа');
  const deal = getDeal(id);
  if (!deal) throw new Error('Заказ не найден');

  const sbp = listSbpChannels(id);
  const acq = listAcquiringChannels(id);
  const channels = [...sbp, ...acq];
  const amount_suggest = dealAmountSuggest(id);
  const payer = resolvePayerOrg(id);
  const cp = resolveCounterpartyBank(id);
  const missing: string[] = [];
  if (payer.rs.length !== 20) missing.push('р/с организации-плательщика');
  if (cp.name === '') missing.push('название получателя');
  if (cp.bik.length !== 9) missing.push('БИК получателя');
  if (cp.rs.length !== 20) missing.push('р/с получателя');

  let preferred: RefundOptions['preferred'] = '';
  if (sbp.some((c) => c.ready)) preferred = 'sbp';
  else if (acq.some((c) => c.ready)) preferred = 'acquiring';
  else if (missing.length === 0) preferred = 'payment_for_sign';

  return {
    deal_id: id,
    amount_suggest,
    channels,
    preferred,
    for_sign: {
      ready: missing.length === 0 && amount_suggest > 0,
      missing,
      counterparty_name: cp.name,
      counterparty_inn: cp.inn,
      counterparty_bik: cp.bik,
      counterparty_rs: cp.rs,
      payer_rs: payer.rs,
      payer_bik: payer.bik,
      customer_code: payer.customer_code,
    },
  };
}

async function resolveSbpTrxId(opts: {
  qrcId: string;
  customerCode?: string;
}): Promise<string> {
  const key = (await import('./integration-settings.js')).getTochkaBridgeSettings().bank_sbp_key;
  const statusUrl = (await import('./integration-settings.js')).getTochkaBridgeSettings()
    .sbp_status_url;
  if (!key) return '';
  try {
    const res = await fetch(statusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Wms-Key': key },
      body: JSON.stringify({
        qrc_ids: [opts.qrcId],
        customer_code: opts.customerCode || '',
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const data = (await res.json()) as {
      items?: Array<{ qrc_id?: string; trx_id?: string; raw?: Record<string, unknown> }>;
    };
    const it = (data.items || []).find((x) => String(x.qrc_id) === opts.qrcId) || data.items?.[0];
    if (!it) return '';
    const fromTop = String(it.trx_id || '').trim();
    if (fromTop) return fromTop;
    const raw = it.raw || {};
    return String(
      raw.trxId || raw.trx_id || raw.transactionId || raw.refTransactionId || ''
    ).trim();
  } catch {
    return '';
  }
}

export async function refundDealOriginal(opts: {
  dealId: string;
  channel?: 'auto' | 'sbp' | 'acquiring';
  amount?: number;
  purpose?: string;
  accountCode?: string;
  markDone?: boolean;
  actor?: { id?: string; name?: string } | null;
}): Promise<Record<string, unknown>> {
  const dealId = String(opts.dealId || '').trim();
  const options = getDealRefundOptions(dealId);
  const want = opts.channel || 'auto';
  let pick: RefundChannelOption | undefined;
  if (want === 'sbp' || (want === 'auto' && options.preferred === 'sbp')) {
    pick = options.channels.find((c) => c.channel === 'sbp' && c.ready) ||
      options.channels.find((c) => c.channel === 'sbp');
  } else if (want === 'acquiring' || (want === 'auto' && options.preferred === 'acquiring')) {
    pick = options.channels.find((c) => c.channel === 'acquiring' && c.ready);
  } else if (want === 'auto') {
    pick =
      options.channels.find((c) => c.channel === 'sbp' && c.ready) ||
      options.channels.find((c) => c.channel === 'acquiring' && c.ready);
  }
  if (!pick) {
    throw new Error(
      'Нет исходной оплаты СБП/карты с сохранённым id. Для безнала — «ПП на подпись».'
    );
  }

  const amount =
    opts.amount != null && Number(opts.amount) > 0
      ? Math.round(Number(opts.amount) * 100) / 100
      : pick.amount || options.amount_suggest;
  if (!(amount > 0)) throw new Error('Сумма возврата > 0');

  const purpose =
    String(opts.purpose || '').trim() || `Возврат по заказу ${dealId}`;
  const payer = resolvePayerOrg(dealId);

  if (pick.channel === 'sbp') {
    let account = digits(opts.accountCode) || digits(pick.account);
    if (account.length !== 20) account = payer.rs;
    if (account.length !== 20) {
      throw new Error('Для возврата СБП нужен р/с (account_code) организации QR');
    }
    let trxId = String(pick.trx_id || '').trim();
    if (!trxId && pick.qrc_id) {
      trxId = await resolveSbpTrxId({
        qrcId: pick.qrc_id,
        customerCode: payer.customer_code,
      });
    }
    const r = await createTochkaRefund({
      channel: 'sbp',
      qrc_id: pick.qrc_id,
      amount,
      account_code: account,
      bank_code: payer.bik,
      trx_id: trxId || undefined,
      purpose,
      customer_code: payer.customer_code || undefined,
    });
    if (!r.ok) throw new Error(String(r.error || 'СБП возврат не прошёл'));
    let marked: unknown = null;
    if (opts.markDone !== false) {
      marked = markDealMoneyRefunded(dealId, opts.actor);
    }
    rememberRefundMeta(dealId, {
      channel: 'sbp',
      amount,
      qrc_id: pick.qrc_id,
      at: new Date().toISOString(),
      raw: r.raw,
    });
    return { ok: true, channel: 'sbp', amount, bank: r, marked };
  }

  const r = await createTochkaRefund({
    channel: 'acquiring',
    operation_id: pick.operation_id,
    amount,
    purpose,
    customer_code: payer.customer_code || undefined,
  });
  if (!r.ok) throw new Error(String(r.error || 'Возврат эквайринга не прошёл'));
  let marked: unknown = null;
  if (opts.markDone !== false) {
    marked = markDealMoneyRefunded(dealId, opts.actor);
  }
  rememberRefundMeta(dealId, {
    channel: 'acquiring',
    amount,
    operation_id: pick.operation_id,
    at: new Date().toISOString(),
    raw: r.raw,
  });
  return { ok: true, channel: 'acquiring', amount, bank: r, marked };
}

function rememberRefundMeta(dealId: string, patch: Record<string, unknown>) {
  try {
    const row = get<{ id: string; meta_json: string }>(
      `SELECT id, IFNULL(meta_json,'') AS meta_json FROM payment_links
       WHERE deal_id = ? ORDER BY datetime(created_at) DESC LIMIT 1`,
      [dealId]
    );
    if (!row) return;
    const meta = parseMeta(row.meta_json);
    const prev = Array.isArray(meta.tochka_refunds) ? meta.tochka_refunds : [];
    prev.push(patch);
    meta.tochka_refunds = prev.slice(-20);
    run(`UPDATE payment_links SET meta_json = ? WHERE id = ?`, [
      JSON.stringify(meta),
      row.id,
    ]);
  } catch {
    /* ignore */
  }
}

export async function createDealPaymentForSign(opts: {
  dealId: string;
  amount?: number;
  purpose?: string;
  tvdId?: string;
  counterpartyName?: string;
  counterpartyInn?: string;
  counterpartyBik?: string;
  counterpartyRs?: string;
  counterpartyKpp?: string;
  counterpartyKs?: string;
  accountCode?: string;
  bankCode?: string;
  customerCode?: string;
  actor?: { id?: string; name?: string } | null;
}): Promise<Record<string, unknown>> {
  const dealId = String(opts.dealId || '').trim();
  const options = getDealRefundOptions(dealId);
  const payer = resolvePayerOrg(dealId);
  const cp = resolveCounterpartyBank(dealId);

  const amount =
    opts.amount != null && Number(opts.amount) > 0
      ? Math.round(Number(opts.amount) * 100) / 100
      : options.amount_suggest;
  if (!(amount > 0)) throw new Error('Сумма ПП > 0');

  const accountCode = digits(opts.accountCode) || payer.rs;
  const bankCode = digits(opts.bankCode) || payer.bik || '044525104';
  const cpName = String(opts.counterpartyName || cp.name || '').trim();
  const cpBik = digits(opts.counterpartyBik) || cp.bik;
  const cpRs = digits(opts.counterpartyRs) || cp.rs;
  const cpInn = digits(opts.counterpartyInn) || cp.inn;
  const cpKpp = digits(opts.counterpartyKpp) || cp.kpp;
  const cpKs = digits(opts.counterpartyKs) || cp.ks;

  const missing: string[] = [];
  if (accountCode.length !== 20) missing.push('р/с плательщика');
  if (bankCode.length !== 9) missing.push('БИК плательщика');
  if (!cpName) missing.push('получатель');
  if (cpBik.length !== 9) missing.push('БИК получателя');
  if (cpRs.length !== 20) missing.push('р/с получателя');
  if (missing.length) {
    throw new Error('Для ПП на подпись укажите: ' + missing.join(', '));
  }

  const purpose =
    String(opts.purpose || '').trim() ||
    `Возврат денежных средств по заказу ${dealId}` +
      (opts.tvdId ? ` · ТВД` : '');

  const r = await createTochkaPaymentForSign({
    account_code: accountCode,
    bank_code: bankCode,
    counterparty_bank_bic: cpBik,
    counterparty_account_number: cpRs,
    counterparty_name: cpName,
    counterparty_inn: cpInn || undefined,
    counterparty_kpp: cpKpp || undefined,
    counterparty_bank_corr_account: cpKs.length === 20 ? cpKs : undefined,
    payment_amount: amount,
    payment_purpose: purpose,
    customer_code: String(opts.customerCode || payer.customer_code || '').trim() || undefined,
  });
  if (!r.ok) throw new Error(String(r.error || 'Не удалось создать ПП на подпись'));

  if (opts.tvdId) {
    try {
      const doc = get<{ payload_json: string; comment: string }>(
        `SELECT IFNULL(payload_json,'') AS payload_json, IFNULL(comment,'') AS comment
         FROM thin_journal_docs WHERE id = ? AND journal_key = 'money_refund_requests'`,
        [String(opts.tvdId)]
      );
      if (doc) {
        const payload = parseMeta(doc.payload_json);
        payload.tochka_for_sign = {
          at: new Date().toISOString(),
          request_id: r.request_id,
          redirect_url: r.redirect_url,
          amount,
          purpose,
        };
        const comment =
          doc.comment && !doc.comment.includes('ПП на подпись')
            ? `${doc.comment} · ПП на подпись`
            : doc.comment || 'ПП на подпись в Точке';
        run(
          `UPDATE thin_journal_docs SET payload_json = ?, comment = ?, updated_at = datetime('now') WHERE id = ?`,
          [JSON.stringify(payload), comment, String(opts.tvdId)]
        );
      }
    } catch {
      /* ignore */
    }
  }

  rememberRefundMeta(dealId, {
    channel: 'payment_for_sign',
    amount,
    request_id: r.request_id,
    redirect_url: r.redirect_url,
    at: new Date().toISOString(),
  });

  return {
    ok: true,
    channel: 'payment_for_sign',
    amount,
    redirect_url: r.redirect_url,
    request_id: r.request_id,
    bank: r,
  };
}

export function loadTvdDealId(tvdId: string): { deal_id: string; amount: number; number: string } {
  const row = get<{
    id: string;
    number: string;
    amount: number;
    payload_json: string;
  }>(
    `SELECT id, IFNULL(number,'') AS number, IFNULL(amount,0) AS amount,
            IFNULL(payload_json,'') AS payload_json
     FROM thin_journal_docs WHERE id = ? AND journal_key = 'money_refund_requests'`,
    [String(tvdId)]
  );
  if (!row) throw new Error('ТВД не найдено');
  const payload = parseMeta(row.payload_json);
  const dealId = String(payload.deal_id || '').trim();
  if (!dealId) throw new Error('В ТВД нет deal_id — привяжите заказ');
  return { deal_id: dealId, amount: Number(row.amount) || 0, number: row.number };
}

/** Не используется напрямую — оставляем для отладки URL моста. */
export function tochkaRefundBridgeUrl(): string {
  return bankApiUrlFromOverview('tochka_refund.php');
}
