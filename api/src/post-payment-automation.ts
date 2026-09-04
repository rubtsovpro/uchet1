/**
 * После оплаты: очередь 1С + «доход», если ещё не отправлено.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_SCRIPT =
  process.env.AMO1C_POST_PAYMENT_AUTOMATION ||
  '/root/amo1c_pnevmopodveska1_ru/public_html/bin/post_payment_automation_for_wms.php';

export type PostPaymentAutomationResult = {
  ok: boolean;
  deal_id?: number;
  one_c?: Record<string, unknown>;
  income?: Record<string, unknown>;
  error?: string;
};

export async function runPostPaymentAutomation(opts: {
  dealId: string;
  source?: string;
  username?: string;
  amount?: number;
  chatId?: string;
  replyToMessageId?: number;
  webhookType?: string;
  channel?: string;
  paymentId?: string;
  account?: string;
  amoAlreadyPaid?: boolean;
}): Promise<PostPaymentAutomationResult> {
  const dealId = String(opts.dealId || '').replace(/\D/g, '');
  if (!dealId) return { ok: false, error: 'deal_id required' };

  const args = [`--deal=${dealId}`];
  const source = String(opts.source || 'pay').trim();
  if (source !== '') args.push(`--source=${source}`);
  const username = String(opts.username || 'auto_payment').trim();
  if (username !== '') args.push(`--username=${username}`);
  const amount = Number(opts.amount);
  if (Number.isFinite(amount) && amount > 0) {
    args.push(`--amount=${amount}`);
  }
  const chatId = String(opts.chatId || '').trim();
  if (chatId !== '') {
    args.push(`--chat_id=${chatId}`);
  }
  const replyTo = Number(opts.replyToMessageId);
  if (Number.isFinite(replyTo) && replyTo > 0) {
    args.push(`--reply_to=${Math.trunc(replyTo)}`);
  }
  const webhookType = String(opts.webhookType || '').trim();
  if (webhookType !== '') {
    args.push(`--webhook_type=${webhookType}`);
  }
  const channel = String(opts.channel || '').trim();
  if (channel !== '') {
    args.push(`--channel=${channel}`);
  }
  const paymentId = String(opts.paymentId || '').trim();
  if (paymentId !== '') {
    args.push(`--payment_id=${paymentId}`);
  }
  const account = String(opts.account || '').trim();
  if (account !== '') {
    args.push(`--account=${account}`);
  }
  if (opts.amoAlreadyPaid) {
    args.push('--amo_already_paid=1');
  }

  try {
    const { stdout } = await execFileAsync('php', [DEFAULT_SCRIPT, ...args], {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      timeout: 90_000,
    });
    const parsed = JSON.parse(String(stdout || '{}')) as PostPaymentAutomationResult;
    return parsed && typeof parsed === 'object' ? parsed : { ok: false, error: 'invalid response' };
  } catch (e) {
    const err = e as { stdout?: string; message?: string };
    let detail = String(err.message || e);
    try {
      const parsed = JSON.parse(String(err.stdout || '{}')) as { error?: string };
      if (parsed.error) detail = String(parsed.error);
    } catch {
      /* keep */
    }
    return { ok: false, error: detail, deal_id: Number(dealId) || undefined };
  }
}
