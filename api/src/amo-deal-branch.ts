/**
 * Amo CF 855167 «Филиал» → crm_deals.amo_branch (склад /pick, УПД, контур).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { get, run } from './db.js';

export const AMO_CF_BRANCH = '855167';

function cfBranchJoin(field: Record<string, unknown>): string {
  const vals = Array.isArray(field.values) ? field.values : [];
  for (const v of vals) {
    if (v == null) continue;
    if (typeof v === 'string' || typeof v === 'number') {
      const t = String(v).trim();
      if (t) return t;
      continue;
    }
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const t = String(o.value ?? o.enum ?? '').trim();
      if (t) return t;
    }
  }
  return '';
}

/** Достать филиал из payload сделки / custom_fields. */
export function extractAmoBranch(d: Record<string, unknown> | null | undefined): string {
  if (!d) return '';
  const direct = String((d as { amo_branch?: string }).amo_branch || '').trim();
  if (direct) return direct;

  const lists = [d.custom_fields, d.custom_fields_values];
  for (const raw of lists) {
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const f = item as Record<string, unknown>;
      const id = String(f.id ?? f.field_id ?? '').trim();
      const name = String(f.name ?? f.field_name ?? '').trim().toLowerCase();
      if (id !== AMO_CF_BRANCH && name !== 'филиал') continue;
      const joined = cfBranchJoin(f);
      if (joined) return joined;
    }
  }
  return '';
}

const AMO_ACCESS_CANDIDATES = [
  process.env.AMO_ACCESS_PHP || '',
  '/root/bank_pnevmopodveska1_ru/public_html/amo/access.php',
  '/root/amo1c_pnevmopodveska1_ru/public_html/amo/access.php',
  '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/amo/access.php',
].filter(Boolean);

function resolveAmoAccessPhp(): string | null {
  for (const p of AMO_ACCESS_CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/** Живой запрос в Amo (CF 855167). */
export function fetchAmoBranchLive(dealId: string): string {
  const id = String(dealId || '').replace(/\D/g, '');
  if (!id) return '';
  const access = resolveAmoAccessPhp();
  if (!access) return '';
  const rateLimit = access.replace(/access\.php$/, 'rate_limit.php');
  const php = `
require ${JSON.stringify(access)};
if (is_file(${JSON.stringify(rateLimit)})) require ${JSON.stringify(rateLimit)};
$res = amo_api_http_request($subdomain, $headers, 'GET', '/api/v4/leads/${id}', null, [], 'wms_branch');
if (empty($res['ok']) || !is_array($res['body'])) { echo ''; exit; }
foreach (($res['body']['custom_fields_values'] ?? []) as $f) {
  if ((int)($f['field_id'] ?? 0) !== ${AMO_CF_BRANCH}) continue;
  $vals = $f['values'] ?? [];
  if (!is_array($vals) || $vals === []) { echo ''; exit; }
  $first = $vals[0];
  if (is_array($first)) echo trim((string)($first['value'] ?? ''));
  else echo trim((string)$first);
  break;
}
`;
  try {
    const out = execFileSync('php', ['-d', 'display_errors=0', '-r', php], {
      timeout: 12_000,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    });
    return String(out || '').trim();
  } catch {
    return '';
  }
}

function orgCompanyIdForBranch(branch: string): string {
  const b = String(branch || '').trim();
  if (!b) return '';
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['integration_amo']);
  if (!row?.value) return '';
  try {
    const parsed = JSON.parse(row.value) as { branch_company?: Record<string, string> };
    const m = parsed?.branch_company;
    if (!m || typeof m !== 'object') return '';
    if (m[b]) return String(m[b] || '').trim();
    const hit = Object.entries(m).find(([k]) => k.trim().toLowerCase() === b.toLowerCase());
    return hit ? String(hit[1] || '').trim() : '';
  } catch {
    return '';
  }
}

export function persistAmoBranch(dealId: string, branch: string): void {
  const id = String(dealId || '').trim();
  const b = String(branch || '').trim();
  if (!id || !b) return;
  const orgCo = orgCompanyIdForBranch(b);
  if (orgCo) {
    run(
      `UPDATE crm_deals SET amo_branch = ?, org_company_id = ?, updated_at = datetime('now') WHERE id = ?`,
      [b, orgCo, id]
    );
  } else {
    run(`UPDATE crm_deals SET amo_branch = ?, updated_at = datetime('now') WHERE id = ?`, [b, id]);
  }
}

/** Колонка БД → payload → live Amo; при live — сохраняем в crm_deals. */
export function resolveAmoBranchForDeal(
  deal: Record<string, unknown> | null | undefined
): string {
  const fromDb = String((deal as { amo_branch?: string } | null)?.amo_branch || '').trim();
  if (fromDb) return fromDb;
  const fromPayload = extractAmoBranch(deal);
  if (fromPayload) return fromPayload;
  const id = String(deal?.id || (deal as { deal_id?: string })?.deal_id || '').trim();
  if (!id) return '';
  const live = fetchAmoBranchLive(id);
  if (live) {
    try {
      persistAmoBranch(id, live);
    } catch {
      /* колонка может ещё не быть на старом процессе */
    }
  }
  return live;
}
