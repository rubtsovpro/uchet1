/**
 * Поддомены Учёт №1 → рабочий экран (landing + home_path после входа).
 * Пути 1c.pnevmopodveska1.ru не трогаем — там полный WMS по URL.
 */
export type ScreenId = 'wms' | 'pick' | 'photo' | 'lift' | 'reception' | 'swagger';

export type HostScreen = {
  id: ScreenId;
  home_path: string;
  title: string;
  subtitle: string;
};

const SCREENS: Record<ScreenId, HostScreen> = {
  wms: {
    id: 'wms',
    home_path: '/',
    title: 'Учёт №1',
    subtitle: 'Склад и продажи — полный доступ',
  },
  pick: {
    id: 'pick',
    home_path: '/pick',
    title: 'Сборка',
    subtitle: 'Экран кладовщика',
  },
  photo: {
    id: 'photo',
    home_path: '/photo',
    title: 'Фотограф',
    subtitle: 'Съёмка товаров без фото',
  },
  lift: {
    id: 'lift',
    home_path: '/lift',
    title: 'Подъёмник',
    subtitle: 'Мастер СТО — авто на подъёмнике',
  },
  reception: {
    id: 'reception',
    home_path: '/reception',
    title: 'Приёмщик',
    subtitle: 'Ожидания на СТО сегодня',
  },
  swagger: {
    id: 'swagger',
    home_path: '/api/swagger',
    title: 'Swagger API',
    subtitle: 'OpenAPI — только администраторам',
  },
};

/** hostname (без порта) → экран */
const HOST_MAP: Record<string, ScreenId> = {
  'uchetn1.ru': 'wms',
  'www.uchetn1.ru': 'wms',
  'api.uchetn1.ru': 'wms',
  'www.api.uchetn1.ru': 'wms',
  'pick.uchetn1.ru': 'pick',
  'www.pick.uchetn1.ru': 'pick',
  'photo.uchetn1.ru': 'photo',
  'www.photo.uchetn1.ru': 'photo',
  'lift.uchetn1.ru': 'lift',
  'www.lift.uchetn1.ru': 'lift',
  'in.uchetn1.ru': 'reception',
  'www.in.uchetn1.ru': 'reception',
  'reception.uchetn1.ru': 'reception',
  'www.reception.uchetn1.ru': 'reception',
  'swagger.uchetn1.ru': 'swagger',
  'www.swagger.uchetn1.ru': 'swagger',
};

export function normalizeHost(raw: string | undefined | null): string {
  const h = String(raw || '')
    .trim()
    .toLowerCase()
    .split(':')[0]!;
  return h;
}

export function screenForHost(hostHeader: string | undefined | null): HostScreen {
  const host = normalizeHost(hostHeader);
  const id = HOST_MAP[host] || 'wms';
  return SCREENS[id];
}

/** Ролевой home_path по роли сотрудника (когда хост — полный WMS). */
export function roleHomePath(actor: {
  isSystemAdmin?: boolean;
  role?: string;
  rights?: { sections?: string[] };
}): string {
  if (actor.isSystemAdmin || actor.role === 'admin') return '/';
  const secs = actor.rights?.sections || [];
  const hasPick = secs.includes('pick');
  const hasPhoto = secs.includes('photo') || secs.includes('media');
  const mainUi = secs.some((s) =>
    ['crm', 'sales', 'purchases', 'money', 'staff', 'company', 'settings', 'reports'].includes(s)
  );
  const photographerOnly =
    actor.role === 'photographer' ||
    (hasPhoto && !mainUi && !hasPick && actor.role !== 'warehouse');
  if (photographerOnly) return '/photo';
  const pickerOnly =
    actor.role === 'warehouse' ||
    actor.role === 'courier' ||
    (hasPick && !mainUi && !hasPhoto);
  if (pickerOnly) return '/pick';
  if (actor.role === 'sto') {
    // мастер СТО — подъёмник; приёмщик часто тоже sto с разделом works
    if (secs.includes('lift') || secs.includes('works')) return '/lift';
  }
  return '/';
}

/**
 * После логина: на ролевом поддомене всегда его экран;
 * на полном WMS — по роли.
 */
export function homePathForLogin(
  hostHeader: string | undefined | null,
  actor: {
    isSystemAdmin?: boolean;
    role?: string;
    rights?: { sections?: string[] };
  }
): string {
  const screen = screenForHost(hostHeader);
  if (screen.id !== 'wms') return screen.home_path;
  return roleHomePath(actor);
}

export function listHostScreens(): Array<HostScreen & { hosts: string[] }> {
  const byId = new Map<ScreenId, string[]>();
  for (const [host, id] of Object.entries(HOST_MAP)) {
    const list = byId.get(id) || [];
    list.push(host);
    byId.set(id, list);
  }
  return (Object.keys(SCREENS) as ScreenId[]).map((id) => ({
    ...SCREENS[id],
    hosts: byId.get(id) || [],
  }));
}
