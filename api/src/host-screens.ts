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
    home_path: '/',
    title: 'Фотограф',
    subtitle: 'Главная Учёта (отдельный экран /photo отключён)',
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
  // На основном домене всех ведём в полный Учёт; экраны сборки/фото — на поддоменах.
  if (actor.isSystemAdmin || actor.role === 'admin') return '/';
  return '/';
}

function wmsPublicOrigin(): string {
  const raw = String(process.env.WMS_PUBLIC_URL || 'https://uchetn1.ru').trim();
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return u.origin;
  } catch {
    return 'https://uchetn1.ru';
  }
}

/**
 * После логина:
 * — админы всегда в полный Учёт (на ролевом поддомене — абсолютный URL основного сайта);
 * — на основном домене всем — `/` (не уводим на /pick через next);
 * — на ролевом поддомене не-админы — экран роли.
 */
export function homePathForLogin(
  hostHeader: string | undefined | null,
  actor: {
    isSystemAdmin?: boolean;
    role?: string;
    rights?: { sections?: string[] };
  }
): string {
  const isAdmin = !!(actor.isSystemAdmin || actor.role === 'admin');
  const screen = screenForHost(hostHeader);
  if (isAdmin) {
    if (screen.id !== 'wms') return wmsPublicOrigin() + '/';
    return '/';
  }
  if (screen.id !== 'wms') return screen.home_path;
  if (actor.role === 'courier') return '/courier';
  if (actor.role === 'warehouse') return '/pick';
  // Фотограф — главная Учёта (отдельный киоск /photo отключён)
  if (actor.role === 'photographer') return '/';
  if (actor.role === 'sto') return '/lift';
  return '/';
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
