/**
 * Пуш канала реализации / СТО / способа отправки из Учёта → CF сделки Amo.
 * CLI: update_deal_sale_fields_for_wms.php
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { amoPushToAmoEnabled } from './amo-settings.js';

const execFileAsync = promisify(execFile);

const DEFAULT_SCRIPT =
  process.env.AMO1C_DEAL_SALE_FIELDS_PUSH ||
  '/root/amo1c_pnevmopodveska1_ru/public_html/bin/update_deal_sale_fields_for_wms.php';

export type AmoDealSaleFieldsPatch = {
  amo_channel?: string;
  amo_sto?: string;
  amo_shipment?: string;
  amo_branch?: string;
  amo_payment_type?: string;
  amo_pay_method?: string;
};

export type AmoDealSaleFieldsPushResult =
  | {
      ok: true;
      deal_id?: number;
      changed?: boolean;
      filled?: string[];
      warnings?: string[] | null;
      skipped?: boolean;
    }
  | { ok: false; error: string; http?: number; deal_id?: number };

export async function pushDealSaleFieldsToAmo(opts: {
  dealId: string;
  fields: AmoDealSaleFieldsPatch;
}): Promise<AmoDealSaleFieldsPushResult> {
  if (!amoPushToAmoEnabled()) {
    return { ok: true, skipped: true, changed: false, filled: [] };
  }
  const dealId = String(opts.dealId || '').replace(/\D/g, '');
  if (!dealId) return { ok: false, error: 'deal_id required' };

  const payload: Record<string, string> = {};
  if (opts.fields.amo_channel !== undefined) {
    payload.amo_channel = String(opts.fields.amo_channel ?? '').trim();
  }
  if (opts.fields.amo_sto !== undefined) {
    payload.amo_sto = String(opts.fields.amo_sto ?? '').trim();
  }
  if (opts.fields.amo_shipment !== undefined) {
    payload.amo_shipment = String(opts.fields.amo_shipment ?? '').trim();
  }
  if (opts.fields.amo_branch !== undefined) {
    payload.amo_branch = String(opts.fields.amo_branch ?? '').trim();
  }
  if (opts.fields.amo_payment_type !== undefined) {
    payload.amo_payment_type = String(opts.fields.amo_payment_type ?? '').trim();
  }
  if (opts.fields.amo_pay_method !== undefined) {
    payload.amo_pay_method = String(opts.fields.amo_pay_method ?? '').trim();
  }
  if (!Object.keys(payload).length) {
    return { ok: true, changed: false, filled: [] };
  }

  const args = [`--deal=${dealId}`, `--json=${JSON.stringify(payload)}`];
  try {
    const { stdout } = await execFileAsync('php', [DEFAULT_SCRIPT, ...args], {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60_000,
    });
    const parsed = JSON.parse(String(stdout || '{}')) as AmoDealSaleFieldsPushResult & {
      error?: string;
    };
    if (!parsed || (parsed as { ok?: boolean }).ok === false) {
      return {
        ok: false,
        error: String((parsed as { error?: string }).error || 'Amo update failed'),
        http: (parsed as { http?: number }).http,
        deal_id: Number(dealId) || undefined,
      };
    }
    return parsed as AmoDealSaleFieldsPushResult;
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
