/**
 * Настройки AmoCRM в meta: сопоставление этапов воронки с событиями Учёта.
 * Credentials Amo живут в amo1c — здесь только маппинг и статус моста.
 */
import { all, get, run } from './db.js';
import { dealsMeta, listPipelines, rawStatusId } from './deals.js';
import { amoCounterpartiesMeta } from './amo-counterparties.js';
import { staffMeta, getAmoUserDirectory } from './staff.js';
import { listCompanies } from './companies.js';
import { amoIntegrationStatusPublic } from './amo-webhook.js';
import {
  countActiveIntegrationApiKeys,
  hasAnyMachineApiKey,
} from './api-keys.js';
import {
  amoSaleFieldOptions,
  amoSaleRulesPublic,
  listUnmappedAmoUsers,
} from './amo-sale-config.js';

const META_AMO = 'integration_amo';

/**
 * Пуш Учёт → Amo (этап / CF / покупатель).
 * По умолчанию ВЫКЛ. Включить только явно: AMO_PUSH_TO_AMO=1
 */
export function amoPushToAmoEnabled(): boolean {
  const v = String(process.env.AMO_PUSH_TO_AMO || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Событие Учёта → этап Amo (по воронке). */
export type AmoStageEventKey = 'success_after_handed';

export type AmoStageMap = {
  /** pipeline_id → status_id (сырой amo id или composite pipeline:status) */
  success_after_handed: Record<string, string>;
};

export type AmoIntegrationSettings = {
  stages: AmoStageMap;
  /** pipeline_id → companies.id (контур: Пневмоподвеска / Фогель) */
  pipeline_company: Record<string, string>;
  /** значение CF «Филиал» → companies.id */
  branch_company: Record<string, string>;
};

const EMPTY_STAGES: AmoStageMap = {
  success_after_handed: {},
};

function readMeta(): Partial<AmoIntegrationSettings> {
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [META_AMO]);
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value) as Partial<AmoIntegrationSettings>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMeta(value: AmoIntegrationSettings): void {
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [META_AMO, JSON.stringify(value)]);
}

function cleanIdMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const pipe = String(k || '').trim();
    const st = String(v || '').trim();
    if (!pipe) continue;
    if (!st) continue;
    out[pipe] = st;
  }
  return out;
}

/** Подсказка контура по тексту филиала Amo (если маппинг ещё не сохранён). */
function guessCompanyIdForBranchLabel(label: string, companies: ReturnType<typeof listCompanies>): string {
  const n = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (!n || !companies.length) return '';
  const byCode = (re: RegExp) =>
    companies.find((c) => re.test(String(c.code || '').toLowerCase()) || re.test(String(c.name || '').toLowerCase()));
  if (/стрела/.test(n)) {
    const c = byCode(/strela|стрела/);
    if (c) return String(c.id);
  }
  if (/фогель|fogel/.test(n)) {
    const c = byCode(/фогель|fogel/);
    if (c) return String(c.id);
  }
  if (/можайск|москва|пневмо|fadeev|фадеев/.test(n)) {
    const c = byCode(/pnevmo|пневмо/) || companies.find((x) => Number(x.is_default) === 1);
    if (c) return String(c.id);
  }
  return '';
}

/** Дефолтный маппинг филиалов Amo → контуры (по названиям). */
export function defaultBranchCompanyMap(): Record<string, string> {
  const companies = listCompanies({ activeOnly: true });
  const out: Record<string, string> = {};
  for (const label of amoSaleFieldOptions('amo_branch')) {
    const id = guessCompanyIdForBranchLabel(label, companies);
    if (id) out[label] = id;
  }
  return out;
}

export function getAmoIntegrationSettings(): AmoIntegrationSettings {
  const stored = readMeta();
  const stages = stored.stages && typeof stored.stages === 'object' ? stored.stages : {};
  const storedBranch = cleanIdMap(stored.branch_company);
  const branch_company = Object.keys(storedBranch).length
    ? storedBranch
    : defaultBranchCompanyMap();
  return {
    stages: {
      success_after_handed: cleanIdMap(
        (stages as AmoStageMap).success_after_handed ?? EMPTY_STAGES.success_after_handed
      ),
    },
    pipeline_company: cleanIdMap(stored.pipeline_company),
    branch_company,
  };
}

/** Проставить org_company_id на сделках по маппингу воронок. */
export function applyPipelineCompanyToDeals(
  map: Record<string, string> = getAmoIntegrationSettings().pipeline_company
): { updated: number } {
  ensureDealOrgCompanyColumn();
  let updated = 0;
  for (const [pipeId, companyId] of Object.entries(map || {})) {
    const p = String(pipeId || '').trim();
    const c = String(companyId || '').trim();
    if (!p || !c) continue;
    const before =
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM crm_deals WHERE pipeline_id = ? AND IFNULL(org_company_id,'') != ?`,
        [p, c]
      )?.c ?? 0;
    run(`UPDATE crm_deals SET org_company_id = ? WHERE pipeline_id = ?`, [c, p]);
    updated += before;
  }
  return { updated };
}

/** Проставить org_company_id по филиалу (источник истины — CF «Филиал», не воронка). */
export function applyBranchCompanyToDeals(
  map: Record<string, string> = getAmoIntegrationSettings().branch_company
): { updated: number } {
  ensureDealOrgCompanyColumn();
  ensureDealAmoBranchColumn();
  let updated = 0;
  for (const [branch, companyId] of Object.entries(map || {})) {
    const b = String(branch || '').trim();
    const c = String(companyId || '').trim();
    if (!b || !c) continue;
    const before =
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM crm_deals
         WHERE IFNULL(amo_branch,'') = ? AND IFNULL(org_company_id,'') != ?`,
        [b, c]
      )?.c ?? 0;
    if (!before) continue;
    run(
      `UPDATE crm_deals
       SET org_company_id = ?
       WHERE IFNULL(amo_branch,'') = ?`,
      [c, b]
    );
    updated += before;
  }
  return { updated };
}

function ensureDealOrgCompanyColumn(): void {
  const cols = all<{ name: string }>('PRAGMA table_info(crm_deals)').map((c) => c.name);
  if (cols.length && !cols.includes('org_company_id')) {
    run(`ALTER TABLE crm_deals ADD COLUMN org_company_id TEXT NOT NULL DEFAULT ''`);
  }
  run(`CREATE INDEX IF NOT EXISTS idx_crm_deals_org_co ON crm_deals(org_company_id)`);
}

function ensureDealAmoBranchColumn(): void {
  const cols = all<{ name: string }>('PRAGMA table_info(crm_deals)').map((c) => c.name);
  if (cols.length && !cols.includes('amo_branch')) {
    run(`ALTER TABLE crm_deals ADD COLUMN amo_branch TEXT NOT NULL DEFAULT ''`);
  }
}

export function saveAmoIntegrationSettings(
  patch: Partial<{
    stages: Partial<AmoStageMap>;
    pipeline_company: Record<string, string>;
    branch_company: Record<string, string>;
  }>
): AmoIntegrationSettings {
  const cur = getAmoIntegrationSettings();
  const next: AmoIntegrationSettings = {
    stages: {
      success_after_handed:
        patch.stages && patch.stages.success_after_handed !== undefined
          ? cleanIdMap(patch.stages.success_after_handed)
          : cur.stages.success_after_handed,
    },
    pipeline_company:
      patch.pipeline_company !== undefined
        ? cleanIdMap(patch.pipeline_company)
        : cur.pipeline_company,
    branch_company:
      patch.branch_company !== undefined
        ? cleanIdMap(patch.branch_company)
        : cur.branch_company,
  };
  writeMeta(next);
  // Воронки больше не привязывают к организации — только филиал
  if (patch.branch_company !== undefined) {
    applyBranchCompanyToDeals(next.branch_company);
  }
  return next;
}

/** @deprecated Воронка не определяет контур — используйте mappedOrgCompanyIdForBranch. */
export function mappedOrgCompanyId(_pipelineId: string): string {
  return '';
}

/** Контур по значению CF «Филиал». */
export function mappedOrgCompanyIdForBranch(branch: string): string {
  const b = String(branch || '').trim();
  if (!b) return '';
  const map = getAmoIntegrationSettings().branch_company;
  if (map[b]) return String(map[b]).trim();
  const hit = Object.entries(map).find(
    ([k]) => k.trim().toLowerCase() === b.toLowerCase()
  );
  return hit ? String(hit[1] || '').trim() : '';
}

/** Резолв этапа «успех после отгрузки» для воронки (маппинг → fallback null). */
export function mappedSuccessStatus(
  pipelineId: string
): { statusId: string; statusName: string; pipelineId: string } | null {
  const pipe = String(pipelineId || '').trim();
  if (!pipe) return null;
  const mapped = getAmoIntegrationSettings().stages.success_after_handed[pipe];
  if (!mapped) return null;
  const raw = rawStatusId(mapped);
  const composite = mapped.includes(':') ? mapped : `${pipe}:${raw}`;
  const row = get<{ id: string; name: string; pipeline_id: string }>(
    `SELECT id, name, pipeline_id FROM crm_pipeline_statuses
     WHERE pipeline_id = ? AND (id = ? OR id = ? OR id LIKE ?)
     LIMIT 1`,
    [pipe, composite, `${pipe}:${raw}`, `%:${raw}`]
  );
  if (!row) {
    // маппинг задан, но статус ещё не синкнут — вернём сырой id
    return { statusId: raw, statusName: '', pipelineId: pipe };
  }
  return {
    statusId: rawStatusId(String(row.id)),
    statusName: String(row.name || ''),
    pipelineId: String(row.pipeline_id || pipe),
  };
}

function envPathSet(name: string): boolean {
  return Boolean(String(process.env[name] || '').trim());
}

/** Публичная ссылка OAuth: админ Amo жмёт и выдаёт доступ интеграции (client_id не секрет). */
function amoOauthSharePublic(): {
  client_id: string;
  share_url: string;
  portal_url: string;
  redirect_uri: string;
} {
  const clientId = String(
    process.env.AMO_OAUTH_CLIENT_ID || '9b3ca7a0-0a9f-4dfa-83f9-a3717570fdac'
  ).trim();
  // В UI показываем бренд Учёт №1; OAuth redirect остаётся на хосте amo1c (как в приложении Amo).
  const portalUrl = String(
    process.env.UCHET_PUBLIC_URL || process.env.WMS_PUBLIC_URL || 'https://uchetn1.ru'
  )
    .trim()
    .replace(/\/+$/, '');
  const amo1cHost = String(
    process.env.AMO1C_PUBLIC_URL || 'https://amo1c.pnevmopodveska1.ru'
  )
    .trim()
    .replace(/\/+$/, '');
  const redirectUri = String(
    process.env.AMO_OAUTH_REDIRECT_URI || `${amo1cHost}/amo/amo.php`
  ).trim();
  const shareUrl = String(
    process.env.AMO_OAUTH_SHARE_URL ||
      `https://www.amocrm.ru/oauth?client_id=${encodeURIComponent(clientId)}&mode=post_message`
  ).trim();
  return {
    client_id: clientId,
    share_url: shareUrl,
    portal_url: portalUrl,
    redirect_uri: redirectUri,
  };
}

export function amoBridgePublic() {
  const settings = getAmoIntegrationSettings();
  const pipes = listPipelines().filter((p) => !p.is_archive);
  const oauth = amoOauthSharePublic();
  const integration = amoIntegrationStatusPublic();
  const unmappedUsers = (() => {
    // Маппинг менеджеров Amo→staff не используем — алерты не поднимаем.
    return listUnmappedAmoUsers();
  })();
  return {
    bridge: {
      deals_export: envPathSet('AMO1C_DEALS_EXPORT'),
      staff_export: envPathSet('AMO1C_STAFF_EXPORT'),
      counterparties_export: envPathSet('AMO1C_COUNTERPARTIES_EXPORT'),
      stage_push: envPathSet('AMO1C_DEAL_STAGE_PUSH'),
      sale_fields_push: envPathSet('AMO1C_DEAL_SALE_FIELDS_PUSH'),
      push_to_amo_enabled: amoPushToAmoEnabled(),
      ingest_key: hasAnyMachineApiKey(),
      api_keys_active: countActiveIntegrationApiKeys(),
      note: 'Ключи Amo хранятся в amo1c. Внешним клиентам — свой ключ в Помощь → Интеграции и API. Env WMS_INGEST_KEY — fallback.',
      oauth_client_id: oauth.client_id,
      oauth_share_url: oauth.share_url,
      portal_url: oauth.portal_url,
      /** @deprecated alias portal_url — для старых клиентов */
      amo1c_url: oauth.portal_url,
      oauth_redirect_uri: oauth.redirect_uri,
      status: integration.status,
      status_label: integration.status_label,
      last_received_at: integration.last_received_at,
      webhook_enabled: integration.webhook_enabled,
      webhook_key_set: integration.webhook_key_set,
      webhook_hint: integration.webhook_hint,
      webhook_entities: integration.webhook_entities,
      products_source: integration.products_source,
      last_webhook_at: integration.last_webhook_at,
      last_webhook_entities: integration.last_webhook_entities,
      deals_count: integration.deals_count,
    },
    meta: {
      deals: dealsMeta(),
      counterparties: amoCounterpartiesMeta(),
      staff: staffMeta(),
    },
    stages: settings.stages,
    pipeline_company: settings.pipeline_company,
    branch_company: settings.branch_company,
    branches: amoSaleFieldOptions('amo_branch').map((label) => ({
      value: label,
      org_company_id: settings.branch_company[label] || '',
    })),
    companies: listCompanies({ activeOnly: true }).map((c) => ({
      id: String(c.id),
      name: String(c.name),
      is_default: Number(c.is_default) === 1,
    })),
    stage_events: [
      {
        id: 'success_after_handed' as AmoStageEventKey,
        label: 'Успех после отгрузки',
        hint: 'После статуса задания «Сдал» и оплаты — перевести сделку в этот этап Amo',
      },
    ],
    sale_rules: amoSaleRulesPublic({
      unmapped_users_count: unmappedUsers.length,
      unmapped_amo_users: unmappedUsers,
    }),
    pipelines: pipes.map((p) => ({
      id: p.id,
      name: p.name,
      deals_count: p.deals_count,
      org_company_id: '',
      statuses: (p.statuses || []).map((s) => ({
        id: String(s.id),
        raw_id: rawStatusId(String(s.id)),
        name: String(s.name),
        sort: Number(s.sort) || 0,
      })),
    })),
    staff: all<{
      id: string;
      name: string;
      email: string;
      login: string;
      role: string;
      amo_id: string;
      is_active: number;
      can_login: number;
    }>(
      `SELECT id, name, IFNULL(email,'') AS email, IFNULL(login,'') AS login,
              role, IFNULL(amo_id,'') AS amo_id, is_active, can_login
       FROM staff
       WHERE is_active = 1
       ORDER BY name COLLATE NOCASE`
    ).map((r) => ({
      id: String(r.id),
      name: String(r.name || ''),
      email: String(r.email || ''),
      login: String(r.login || ''),
      role: String(r.role || ''),
      amo_id: String(r.amo_id || ''),
      is_active: Number(r.is_active) !== 0,
      can_login: Number(r.can_login) !== 0,
    })),
    /** Все известные Amo user id (из staff + ответственные в сделках) — для select. */
    amo_users: (() => {
      const byId = new Map<
        string,
        { amo_id: string; name: string; deals: number; staff_id: string; staff_name: string }
      >();
      const dir = getAmoUserDirectory();
      const dealRows = all<{ amo_id: string; c: number }>(
        `SELECT responsible_user_id AS amo_id, COUNT(*) AS c
         FROM crm_deals
         WHERE IFNULL(responsible_user_id,'') != ''
         GROUP BY responsible_user_id
         ORDER BY c DESC
         LIMIT 500`
      );
      for (const r of dealRows) {
        const id = String(r.amo_id || '').trim();
        if (!id) continue;
        byId.set(id, {
          amo_id: id,
          name: String(dir[id]?.name || ''),
          deals: Number(r.c) || 0,
          staff_id: '',
          staff_name: '',
        });
      }
      // имена: любой staff с amo_id (в т.ч. архив) + весь справочник Amo
      const staffRows = all<{ id: string; name: string; amo_id: string; is_active: number }>(
        `SELECT id, name, IFNULL(amo_id,'') AS amo_id, is_active FROM staff
         WHERE IFNULL(amo_id,'') != ''`
      );
      for (const r of staffRows) {
        const id = String(r.amo_id || '').trim();
        if (!id) continue;
        const prev = byId.get(id) || {
          amo_id: id,
          name: '',
          deals: 0,
          staff_id: '',
          staff_name: '',
        };
        if (!prev.name) prev.name = String(r.name || '') || String(dir[id]?.name || '');
        // привязка к UI — только активный
        if (Number(r.is_active) !== 0) {
          prev.staff_id = String(r.id);
          prev.staff_name = String(r.name || '');
          if (!prev.name) prev.name = String(r.name || '');
        }
        byId.set(id, prev);
      }
      for (const [id, info] of Object.entries(dir)) {
        if (!id || byId.has(id)) {
          const cur = byId.get(id);
          if (cur && !cur.name && info.name) cur.name = info.name;
          continue;
        }
        byId.set(id, {
          amo_id: id,
          name: String(info.name || ''),
          deals: 0,
          staff_id: '',
          staff_name: '',
        });
      }
      return [...byId.values()]
        .map((u) => ({
          ...u,
          name: u.name || String(dir[u.amo_id]?.name || '') || '',
        }))
        .sort((a, b) => {
          if (b.deals !== a.deals) return b.deals - a.deals;
          return (a.name || a.staff_name || a.amo_id).localeCompare(
            b.name || b.staff_name || b.amo_id,
            'ru'
          );
        });
    })(),
    /** amo user id из сделок, которых нет у активного staff */
    unmapped_amo_users: unmappedUsers,
  };
}

export function saveStaffAmoMappings(
  mappings: Array<{ staff_id: string; amo_id: string }>
): { updated: number } {
  let updated = 0;
  for (const m of mappings || []) {
    const staffId = String(m.staff_id || '').trim();
    if (!staffId) continue;
    const amoId = String(m.amo_id || '').trim().replace(/[^\d]/g, '').slice(0, 32);
    const row = get<{ id: string }>('SELECT id FROM staff WHERE id = ?', [staffId]);
    if (!row) continue;
    // уникальность: если amo_id занят другим — снимаем у того
    if (amoId) {
      const other = get<{ id: string }>(
        `SELECT id FROM staff WHERE amo_id = ? AND id != ? LIMIT 1`,
        [amoId, staffId]
      );
      if (other) {
        run(`UPDATE staff SET amo_id = '' WHERE id = ?`, [other.id]);
      }
    }
    run(`UPDATE staff SET amo_id = ? WHERE id = ?`, [amoId, staffId]);
    updated += 1;
  }
  return { updated };
}
