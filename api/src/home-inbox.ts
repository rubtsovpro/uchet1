/**
 * Очередь задач на начальной странице — по роли сотрудника.
 * Админ видит всё; приёмщик — фото; склад — перемещения/задания; курьер — свои рейсы.
 */
import { listOpenCarPhotoTasks, canUseCarPhotoReception } from './web-push.js';
import { listTasks } from './warehouse-tasks.js';
import { listCourierRuns } from './sto-parts-flow.js';
import { canAccessSection, type StaffRights } from './staff.js';
import { resolvePersonDocFio } from './person-fio.js';
import { getDeal } from './deals.js';
import { get } from './db.js';

export type HomeInboxActor = {
  id?: string;
  role?: string;
  isSystemAdmin?: boolean;
  rights?: StaffRights;
} | null;

export type HomeInboxItem = {
  id: string;
  kind: 'photo' | 'warehouse' | 'courier';
  title: string;
  subtitle: string;
  meta: string;
  href: string;
  status: string;
  created_at?: string;
  deal_id?: string;
  org_company_id?: string;
};

export type HomeInboxGroup = {
  id: 'photo' | 'warehouse' | 'courier';
  title: string;
  items: HomeInboxItem[];
};

function isAdmin(actor: HomeInboxActor): boolean {
  return !!(actor?.isSystemAdmin || actor?.role === 'admin');
}

function canSeePhoto(actor: HomeInboxActor): boolean {
  return isAdmin(actor) || canUseCarPhotoReception(actor);
}

function canSeeWarehouse(actor: HomeInboxActor): boolean {
  if (isAdmin(actor)) return true;
  if (actor?.role === 'courier') return false;
  return (
    canAccessSection(actor, 'warehouse') ||
    canAccessSection(actor, 'pick') ||
    canAccessSection(actor, 'works')
  );
}

function canSeeCourier(actor: HomeInboxActor): boolean {
  if (isAdmin(actor)) return true;
  if (actor?.role === 'courier') return true;
  return canAccessSection(actor, 'delivery');
}

async function dealOrgCompanyId(dealId: string): Promise<string> {
  const id = String(dealId || '').trim();
  if (!id) return '';
  const row = await get<{ org_company_id?: string }>(
    `SELECT IFNULL(org_company_id,'') AS org_company_id FROM crm_deals WHERE id = ?`,
    [id]
  );
  return String(row?.org_company_id || '').trim();
}

/** Филиал выбран в шапке — оставляем только задачи сделок этого контура. */
async function matchesCompany(dealId: string | undefined, companyId: string): Promise<boolean> {
  const co = String(companyId || '').trim();
  if (!co) return true;
  const did = String(dealId || '').trim();
  if (!did) return false;
  return await dealOrgCompanyId(did) === co;
}

function kindTitlePhoto(kind: string): string {
  if (kind === 'sts') return 'Фото СТС';
  if (kind === 'both') return 'Фото СТС + авто';
  return 'Фото авто · приёмка';
}

function whStatusRu(s: string): string {
  const m: Record<string, string> = {
    new: 'новое',
    picking: 'сборка',
    packed: 'упаковано',
    ready: 'готово к выдаче',
    handed: 'отдано',
  };
  return m[s] || s || '';
}

function courierStatusRu(s: string): string {
  const m: Record<string, string> = {
    new: 'ждёт курьера',
    accepted: 'принято',
    picked_up: 'в работе',
    delivered: 'выполнено',
    cancelled: 'отмена',
  };
  return m[s] || s || '';
}

export async function buildHomeInbox(
  actor: HomeInboxActor,
  opts?: { companyId?: string }
): Promise<{
  groups: HomeInboxGroup[];
  total: number;
  company_id: string;
}> {
  const companyId = String(opts?.companyId || '').trim();
  const groups: HomeInboxGroup[] = [];

  // «Фото приёмки» на главной не показываем — отдельное приложение /reception-photo.

  if (canSeeWarehouse(actor)) {
    const openRaw = await listTasks({ limit: 100 });
    const open: Awaited<ReturnType<typeof listTasks>> = [];
    for (const r of openRaw) {
      const st = String((r as { status?: string }).status || '');
      // На главной только новые задания; «отдано» / сборка / упаковано — не тянем.
      if (st !== 'new') continue;
      const dealId = String((r as { deal_id?: string }).deal_id || '').trim();
      if (!(await matchesCompany(dealId, companyId))) continue;
      open.push(r);
    }
    const items: HomeInboxItem[] = await Promise.all(open.slice(0, 40).map(async (r) => {
      const row = r as Record<string, unknown>;
      const num = String(row.number || row.id || '');
      const buyer = String(row.buyer_name || '').trim();
      const city = String(row.city || '').trim();
      const comment = String(row.comment || '').trim();
      const st = String(row.status || '');
      const dealId = String(row.deal_id || '').trim();
      return {
        id: String(row.id || ''),
        kind: 'warehouse',
        title: `Склад · ${num}`,
        subtitle: [buyer, city, comment].filter(Boolean).join(' · ').slice(0, 160),
        meta: `${whStatusRu(st)}${
          row.created_at
            ? ' · ' + String(row.created_at).replace('T', ' ').slice(0, 16)
            : ''
        }`,
        href: dealId
          ? `/deals/${encodeURIComponent(dealId)}`
          : '/warehouse/tasks',
        status: st,
        created_at: String(row.created_at || ''),
        deal_id: dealId || undefined,
        org_company_id: dealId ? await dealOrgCompanyId(dealId) : '',
      };
    }));
    groups.push({
      id: 'warehouse',
      title: 'Склад · перемещения / задания',
      items,
    });
  }

  if (canSeeCourier(actor)) {
    const runs = (await listCourierRuns({
      scope: 'active',
      limit: 80,
      courier_staff_id: isAdmin(actor) ? undefined : String(actor?.id || ''),
    })).items.filter(async (r) => {
      const dealId = String((r as { deal_id?: string }).deal_id || '').trim();
      return await matchesCompany(dealId, companyId);
    });
    const items: HomeInboxItem[] = await Promise.all(runs.slice(0, 40).map(async (r) => {
      const row = r as Record<string, unknown>;
      const st = String(row.status || 'new');
      const buyer = String(row.buyer_name || row.deal_name || '').trim();
      const dealId = String(row.deal_id || '').trim();
      const sto = String(row.sto_number || row.task_number || '').trim();
      const kind = String(row.kind || 'pickup');
      return {
        id: String(row.id || ''),
        kind: 'courier',
        title: `Курьер · ${kind === 'pickup' ? 'забор' : kind}`,
        subtitle: [buyer, sto ? '№' + sto : ''].filter(Boolean).join(' · '),
        meta: `${courierStatusRu(st)}${
          row.created_at
            ? ' · ' + String(row.created_at).replace('T', ' ').slice(0, 16)
            : ''
        }`,
        href: '/courier',
        status: st,
        created_at: String(row.created_at || ''),
        deal_id: dealId || undefined,
        org_company_id: dealId ? await dealOrgCompanyId(dealId) : '',
      };
    }));
    groups.push({
      id: 'courier',
      title: 'Курьер',
      items,
    });
  }

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  return { groups, total, company_id: companyId };
}
