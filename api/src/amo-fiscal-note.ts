/**
 * Примечание в AmoCRM после пробития чека (АТОЛ).
 * CLI: fiscal_amo_note_for_wms.php
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

const DEFAULT_SCRIPT =
  process.env.AMO1C_FISCAL_NOTE ||
  '/root/amo1c_pnevmopodveska1_ru/public_html/bin/fiscal_amo_note_for_wms.php';

export type FiscalAmoNoteResult =
  | { ok: true; skipped?: boolean; reason?: string; deal_id?: number; receipt_id?: string }
  | { ok: false; error: string; deal_id?: number; receipt_id?: string };

export async function pushFiscalNoteToAmo(opts: {
  dealId: string;
  kind: string;
  receipt: Record<string, unknown>;
  source?: string;
}): Promise<FiscalAmoNoteResult> {
  const dealId = String(opts.dealId || '').replace(/\D/g, '');
  const kind = String(opts.kind || '').trim();
  if (!dealId || !kind) return { ok: false, error: 'deal_id and kind required' };
  if (!opts.receipt || typeof opts.receipt !== 'object') {
    return { ok: false, error: 'receipt required' };
  }

  const tmp = join(tmpdir(), `fiscal-note-${dealId}-${Date.now()}.json`);
  try {
    await writeFile(tmp, JSON.stringify(opts.receipt), 'utf8');
    const args = [`--deal=${dealId}`, `--kind=${kind}`, `--receipt_file=${tmp}`];
    const source = String(opts.source || '').trim();
    if (source !== '') args.push(`--source=${source}`);

    const { stdout } = await execFileAsync('php', [DEFAULT_SCRIPT, ...args], {
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60_000,
    });
    const parsed = JSON.parse(String(stdout || '{}')) as FiscalAmoNoteResult & { error?: string };
    if (!parsed || parsed.ok === false) {
      return {
        ok: false,
        error: String((parsed as { error?: string }).error || 'Amo fiscal note failed'),
        deal_id: Number(dealId) || undefined,
      };
    }
    return parsed;
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
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}
