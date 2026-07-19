/**
 * Клиентские метаданные для presence / audit / login.
 * IP за прокси: CF-Connecting-IP → X-Forwarded-For → X-Real-IP.
 * Geo: кэш в SQLite + ip-api.com (без ключа, HTTP; при офлайне — пусто).
 */
import type { Context } from 'hono';
import { get, run } from './db.js';

export type ClientMeta = {
  ip: string;
  ua: string;
  os: string;
  browser: string;
  device: string;
  region: string;
  country: string;
};

const GEO_TTL_SEC = 7 * 86400;
const GEO_TIMEOUT_MS = 1200;
const privateIpRe =
  /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i;

export function clientIpFromHeaders(header: (n: string) => string | undefined): string {
  const cf = header('cf-connecting-ip')?.trim();
  if (cf) return cf.slice(0, 64);
  const xff = header('x-forwarded-for')?.split(',')[0]?.trim();
  if (xff) return xff.slice(0, 64);
  const real = header('x-real-ip')?.trim();
  if (real) return real.slice(0, 64);
  return '';
}

export function clientMetaFromContext(c: Context): Pick<ClientMeta, 'ip' | 'ua'> {
  return {
    ip: clientIpFromHeaders((n) => c.req.header(n)),
    ua: (c.req.header('user-agent') || '').slice(0, 400),
  };
}

export function parseUserAgent(ua: string): Pick<ClientMeta, 'os' | 'browser' | 'device'> {
  const s = ua || '';
  let os = '';
  if (/Windows NT 10/i.test(s)) os = 'Windows 10/11';
  else if (/Windows NT 6\.3/i.test(s)) os = 'Windows 8.1';
  else if (/Windows NT 6\.1/i.test(s)) os = 'Windows 7';
  else if (/Windows/i.test(s)) os = 'Windows';
  else if (/Mac OS X(?:\s|_)?([\d_]+)?/i.test(s)) {
    const m = s.match(/Mac OS X(?:\s|_)?([\d_]+)/i);
    os = m?.[1] ? `macOS ${m[1].replace(/_/g, '.')}` : 'macOS';
  } else if (/Android\s([\d.]+)/i.test(s)) {
    const m = s.match(/Android\s([\d.]+)/i);
    os = m?.[1] ? `Android ${m[1]}` : 'Android';
  } else if (/iPhone|iPad|iPod/i.test(s)) {
    const m = s.match(/OS ([\d_]+)/i);
    os = m?.[1] ? `iOS ${m[1].replace(/_/g, '.')}` : 'iOS';
  } else if (/Linux/i.test(s)) os = 'Linux';
  else if (/CrOS/i.test(s)) os = 'ChromeOS';

  let browser = '';
  const ver = (re: RegExp) => {
    const m = s.match(re);
    return m?.[1] ? m[1].split('.')[0] : '';
  };
  if (/YaBrowser\/([\d.]+)/i.test(s)) {
    const v = ver(/YaBrowser\/([\d.]+)/i);
    browser = v ? `Яндекс ${v}` : 'Яндекс';
  } else if (/Edg\/([\d.]+)/i.test(s)) {
    const v = ver(/Edg\/([\d.]+)/i);
    browser = v ? `Edge ${v}` : 'Edge';
  } else if (/OPR\/([\d.]+)/i.test(s)) {
    const v = ver(/OPR\/([\d.]+)/i);
    browser = v ? `Opera ${v}` : 'Opera';
  } else if (/Firefox\/([\d.]+)/i.test(s)) {
    const v = ver(/Firefox\/([\d.]+)/i);
    browser = v ? `Firefox ${v}` : 'Firefox';
  } else if (/Chrome\/([\d.]+)/i.test(s) && !/Chromium/i.test(s)) {
    const v = ver(/Chrome\/([\d.]+)/i);
    browser = v ? `Chrome ${v}` : 'Chrome';
  } else if (/Safari\/([\d.]+)/i.test(s) && !/Chrome|Chromium|Edg/i.test(s)) {
    const v = ver(/Version\/([\d.]+)/i) || ver(/Safari\/([\d.]+)/i);
    browser = v ? `Safari ${v}` : 'Safari';
  }

  let device = 'ПК';
  if (/iPad|Tablet|(Android(?!.*Mobile))/i.test(s)) device = 'Планшет';
  else if (/Mobile|iPhone|Android.*Mobile|Opera Mini|IEMobile/i.test(s)) device = 'Мобильный';

  return {
    os: os || '—',
    browser: browser || '—',
    device,
  };
}

function formatRegion(city: string, regionName: string, country: string): string {
  const parts = [city, regionName].filter(Boolean);
  const place = parts.filter((p, i, a) => a.indexOf(p) === i).join(', ');
  if (place && country) return `${place} (${country})`;
  return place || country || '';
}

function readGeoCache(ip: string): { region: string; country: string } | null {
  const row = get<{ region: string; country: string }>(
    `SELECT region, country FROM ip_geo_cache
     WHERE ip = ? AND datetime(fetched_at) >= datetime('now', ?)`,
    [ip, `-${GEO_TTL_SEC} seconds`]
  );
  if (!row) return null;
  return { region: row.region || '', country: row.country || '' };
}

function writeGeoCache(ip: string, region: string, country: string): void {
  run(
    `INSERT INTO ip_geo_cache (ip, region, country, fetched_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(ip) DO UPDATE SET
       region = excluded.region,
       country = excluded.country,
       fetched_at = datetime('now')`,
    [ip, region.slice(0, 200), country.slice(0, 80)]
  );
}

async function lookupGeoRemote(ip: string): Promise<{ region: string; country: string }> {
  if (!ip || privateIpRe.test(ip) || ip === 'unknown') {
    return { region: privateIpRe.test(ip) ? 'локальная сеть' : '', country: '' };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), GEO_TIMEOUT_MS);
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,message`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { region: '', country: '' };
    const data = (await res.json()) as {
      status?: string;
      country?: string;
      countryCode?: string;
      regionName?: string;
      city?: string;
    };
    if (data.status !== 'success') return { region: '', country: '' };
    const country = String(data.country || data.countryCode || '').slice(0, 80);
    const region = formatRegion(
      String(data.city || ''),
      String(data.regionName || ''),
      country
    ).slice(0, 200);
    writeGeoCache(ip, region, country);
    return { region, country };
  } catch {
    return { region: '', country: '' };
  }
}

/** Geo с кэшем; сеть не блокирует дольше ~1.2 с. */
export async function resolveGeo(ip: string): Promise<{ region: string; country: string }> {
  if (!ip) return { region: '', country: '' };
  if (privateIpRe.test(ip)) return { region: 'локальная сеть', country: '' };
  const cached = readGeoCache(ip);
  if (cached) return cached;
  return lookupGeoRemote(ip);
}

export async function enrichClientMeta(c: Context): Promise<ClientMeta> {
  const { ip, ua } = clientMetaFromContext(c);
  const parsed = parseUserAgent(ua);
  const geo = await resolveGeo(ip);
  return {
    ip,
    ua,
    os: parsed.os,
    browser: parsed.browser,
    device: parsed.device,
    region: geo.region,
    country: geo.country,
  };
}
