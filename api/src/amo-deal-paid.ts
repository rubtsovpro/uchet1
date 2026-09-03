/**
 * Пуш «оплачено» в AmoCRM (имя [оплачено] + CF 817191/817193).
 * CLI: mark_deal_paid_for_wms.php
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_SCRIPT =
  process.env.AMO1C_DEAL_PAID_PUSH ||
  '/root/amo1c_pnevmopodveska1_ru/public_html/bin/mark_deal_paid_for_wms.php';

export type PushDealPaidResult = {
  ok: boolean;
  error?: string;
  http?: number;
  deal_id?: number;
  [key: string]: unknown;
};

export async function pushDealPaidToAmo(opts: {
  dealId: string | number;
  source?: string;
}): Promise<PushDealPaidResult> {
  const dealId = String(opts.dealId || '').replace(/\D/g, '');
  if (!dealId) return { ok: false, error: 'deal_id required' };
  const args = [`--deal=${dealId}`];
  const source = String(opts.source || '').trim();
  if (source !== '') {
    args.push(`--source=${source}`);
  }
  try {
    const { stdout } = await execFileAsync('php', [DEFAULT_SCRIPT, ...args], {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60_000,
    });
    const parsed = JSON.parse(String(stdout || '{}')) as PushDealPaidResult;
    if (!parsed || parsed.ok === false) {
      return {
        ok: false,
        error: String(parsed.error || 'Amo paid update failed'),
        http: parsed.http,
        deal_id: Number(dealId) || undefined,
      };
    }
    return parsed;
  } catch (e) {
    const err = e as { message?: string; stdout?: string };
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
