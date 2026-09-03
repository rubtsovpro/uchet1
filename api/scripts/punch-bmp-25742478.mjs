#!/usr/bin/env node
/**
 * One-shot: cancel wrong BRP full (already refunded) + punch BMP full for deal 25742478 + TG.
 */
import { run, get } from '../dist/db.js';
import { prepareOrSendFiscalReceipt } from '../dist/atol.js';
import { organizationIdForDealRecord, getDeal } from '../dist/deals.js';
import { getAtolSettingsForDeal, resolveAtolProfileKey } from '../dist/integration-settings.js';
import { spawnSync } from 'child_process';

const dealId = '25742478';
const OLD_FULL = 'd0dc47f0-7c8a-4c2d-b5b5-0a8faf0b4955';

async function atolGetToken(cfg) {
  const base = String(cfg.api_url || '').replace(/\/$/, '');
  const res = await fetch(`${base}/getToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: cfg.login, pass: cfg.pass }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(data.error?.text || 'no token');
  return data.token;
}

async function pollAtol(uuid, cfg) {
  const base = String(cfg.api_url || '').replace(/\/$/, '');
  const token = await atolGetToken(cfg);
  const group = cfg.group_code;
  const res = await fetch(`${base}/${encodeURIComponent(group)}/report/${encodeURIComponent(uuid)}`, {
    headers: { Token: token },
  });
  return await res.json();
}

const deal = getDeal(dealId);
if (!deal) {
  console.error('deal not found');
  process.exit(1);
}
const orgId = organizationIdForDealRecord(deal);
const key = resolveAtolProfileKey({ organization_id: orgId });
const cfg = getAtolSettingsForDeal({ ...deal, organization_id: orgId });
console.log('precheck', { orgId, key, group: cfg.group_code, inn: cfg.inn, api: cfg.api_url });

if (key !== 'mp' || cfg.inn !== '231295963240' || !String(cfg.group_code).includes('79513')) {
  console.error('REFUSE: would not use BMP kassa', { key, inn: cfg.inn, group: cfg.group_code });
  process.exit(2);
}

const old = get(`SELECT id, kind, status, amount FROM fiscal_receipts WHERE id = ?`, [OLD_FULL]);
if (old && String(old.status) !== 'cancelled') {
  run(
    `UPDATE fiscal_receipts SET status = 'cancelled', error = ?, updated_at = datetime('now')
     WHERE id = ? AND kind = 'full'`,
    [
      'cancelled: ошибочно пробит на БРП, был возврат; перепробитие на БМП 2026-08-28',
      OLD_FULL,
    ]
  );
  console.log('cancelled old full', OLD_FULL, 'was', old.status);
} else {
  console.log('old full already cancelled or missing', old);
}

const receipt = await prepareOrSendFiscalReceipt({ dealId, kind: 'full', send: true });
console.log('punch', {
  id: receipt?.id,
  status: receipt?.status,
  amount: receipt?.amount,
  atol_uuid: receipt?.atol_uuid,
  error: receipt?.error,
});

const row0 = get(`SELECT payload_json, status, atol_uuid FROM fiscal_receipts WHERE id = ?`, [
  String(receipt?.id || ''),
]);
let payloadInn = '';
try {
  const pj = JSON.parse(String(row0?.payload_json || '{}'));
  payloadInn = String(pj?.receipt?.company?.inn || '');
} catch {
  /* ignore */
}
console.log('payload_inn', payloadInn, 'atol_uuid', row0?.atol_uuid);

if (payloadInn && payloadInn !== '231295963240') {
  console.error('WRONG INN IN PAYLOAD', payloadInn);
  process.exit(3);
}
if (String(receipt?.status) === 'error') {
  console.error('punch error', receipt?.error);
  process.exit(4);
}

const uuid = String(receipt?.atol_uuid || '');
if (uuid) {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const report = await pollAtol(uuid, cfg);
      console.log('atol_report', i, report?.status, report?.error || null);
      const st = String(report?.status || '').toLowerCase();
      if (['done', 'fail', 'error'].includes(st) || report?.error) {
        const newStatus = st === 'done' ? 'done' : st === 'fail' || report?.error ? 'error' : st;
        run(
          `UPDATE fiscal_receipts SET status = ?, result_json = ?, error = ?, updated_at = datetime('now') WHERE id = ?`,
          [
            newStatus,
            JSON.stringify(report),
            report?.error ? JSON.stringify(report.error) : '',
            String(receipt.id),
          ]
        );
        break;
      }
    } catch (e) {
      console.log('poll err', e instanceof Error ? e.message : e);
    }
  }
}

const st = get(
  `SELECT id, kind, status, amount, atol_uuid, result_json FROM fiscal_receipts WHERE id = ?`,
  [String(receipt?.id || '')]
);
console.log(
  'final',
  JSON.stringify(
    {
      id: st?.id,
      status: st?.status,
      amount: st?.amount,
      atol_uuid: st?.atol_uuid,
      result: String(st?.result_json || '').slice(0, 500),
    },
    null,
    2
  )
);

const amount = Number(st?.amount || 29900);
const status = String(st?.status || '');
let fn = '';
let fd = '';
try {
  const rj = JSON.parse(String(st?.result_json || '{}'));
  fn = String(rj.fn_number || '');
  fd = String(rj.fiscal_document_number || '');
} catch {
  /* ignore */
}
const lines = [
  '✅ БМП · полный чек (перепробитие)',
  `Сделка ${dealId} - ИП Безматерных Михаил`,
  `Сумма: ${amount.toLocaleString('ru-RU')} ₽`,
  'Способ: СБП / QR · р/с …9020',
  `Статус: ${status}`,
  uuid ? `АТОЛ uuid: ${uuid}` : '',
  fn ? `ФН: ${fn}` : '',
  fd ? `ФД: ${fd}` : '',
  'Касса: group_code_79513 · ИНН 231295963240 (v4)',
  'Было: ошибочный чек БРП возвращён; пробито заново на БМП',
  `https://pnevmopodveska.amocrm.ru/leads/detail/${dealId}`,
].filter(Boolean);

const php = `
require "/root/bank_pnevmopodveska1_ru/public_html/includes/fiscal_tg_flow_lib.php";
\$msg = ${JSON.stringify(lines.join('\n'))};
\$r = fiscal_tg_flow_send(\$msg);
echo json_encode(\$r, JSON_UNESCAPED_UNICODE), "\\n";
require "/root/bank_pnevmopodveska1_ru/public_html/includes/fiscal_automation_lib.php";
fiscal_automation_mark_checks_cache(${Number(dealId)}, "full", ${JSON.stringify(status || 'sent')});
echo "cache_ok\\n";
`;
const tg = spawnSync('php', ['-r', php], { encoding: 'utf8' });
console.log('tg_out', tg.stdout);
if (tg.stderr) console.log('tg_err', tg.stderr.slice(0, 500));
console.log('done');
