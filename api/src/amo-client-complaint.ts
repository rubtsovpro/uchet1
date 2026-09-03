/**
 * Amo CF 816977 «Жалоба клиента» → п. 3.3 ЗН {{Неисправности}}.
 * Пусто → в бланк ничего не пишем (без прочерков).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { run } from './db.js';

/** field_id в amoCRM */
export const AMO_CF_CLIENT_COMPLAINT = '816977';

function cfValuesJoin(field: Record<string, unknown>): string {
  const vals = Array.isArray(field.values) ? field.values : [];
  const parts: string[] = [];
  for (const v of vals) {
    if (v == null) continue;
    if (typeof v === 'string' || typeof v === 'number') {
      const t = String(v).trim();
      if (t) parts.push(t);
      continue;
    }
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const t = String(o.value ?? o.enum ?? '').trim();
      if (t) parts.push(t);
    }
  }
  return parts.join(', ');
}

/** Достать жалобу из payload сделки / custom_fields. */
export function extractAmoClientComplaint(d: Record<string, unknown> | null | undefined): string {
  if (!d) return '';
  const direct = String(
    (d as { amo_client_complaint?: string }).amo_client_complaint ||
      (d as { client_complaint?: string }).client_complaint ||
      ''
  ).trim();
  if (direct) return direct;

  const lists = [d.custom_fields, d.custom_fields_values];
  for (const raw of lists) {
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const f = item as Record<string, unknown>;
      const id = String(f.id ?? f.field_id ?? '').trim();
      const name = String(f.name ?? f.field_name ?? '').trim().toLowerCase();
      const hit =
        id === AMO_CF_CLIENT_COMPLAINT ||
        name === 'жалоба клиента' ||
        name.includes('жалоб') ||
        name.includes('нарекан') ||
        (name.includes('причин') && name.includes('обращ'));
      if (!hit) continue;
      const joined = cfValuesJoin(f);
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

/**
 * Живой запрос в Amo (если в БД ещё пусто). На проде — через access.php банка.
 */
export function fetchAmoClientComplaintLive(dealId: string): string {
  const id = String(dealId || '').replace(/\D/g, '');
  if (!id) return '';
  const access = resolveAmoAccessPhp();
  if (!access) return '';
  const rateLimit = access.replace(/access\.php$/, 'rate_limit.php');
  const php = `
require ${JSON.stringify(access)};
if (is_file(${JSON.stringify(rateLimit)})) require ${JSON.stringify(rateLimit)};
$res = amo_api_http_request($subdomain, $headers, 'GET', '/api/v4/leads/${id}', null, [], 'wms_zn_complaint');
if (empty($res['ok']) || !is_array($res['body'])) { echo ''; exit; }
foreach (($res['body']['custom_fields_values'] ?? []) as $f) {
  if ((string)($f['field_id'] ?? '') !== '${AMO_CF_CLIENT_COMPLAINT}') continue;
  $parts = [];
  foreach ($f['values'] ?? [] as $v) {
    $t = trim((string)($v['value'] ?? ''));
    if ($t !== '') $parts[] = $t;
  }
  echo implode(', ', $parts);
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

/** Для ЗН: колонка БД → CF payload → live Amo. */
export function resolveAmoClientComplaintForDeal(
  deal: Record<string, unknown> | null | undefined
): string {
  const fromDeal = extractAmoClientComplaint(deal);
  if (fromDeal) return fromDeal;
  const id = String(deal?.id || '').trim();
  if (!id) return '';
  const live = fetchAmoClientComplaintLive(id);
  if (live) {
    try {
      run(`UPDATE crm_deals SET amo_client_complaint = ? WHERE id = ?`, [live, id]);
    } catch {
      /* колонка может ещё не быть на старом процессе */
    }
  }
  return live;
}

/** Сохранить жалобу при ingest, если пришла. */
export function persistAmoClientComplaint(dealId: string, dealPayload: Record<string, unknown>): void {
  const id = String(dealId || '').trim();
  if (!id) return;
  const v = extractAmoClientComplaint(dealPayload);
  if (!v) return;
  try {
    run(`UPDATE crm_deals SET amo_client_complaint = ? WHERE id = ?`, [v, id]);
  } catch {
    /* ignore */
  }
}
