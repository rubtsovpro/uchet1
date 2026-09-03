/**
 * Онлайн-присутствие: кто в системе и в каком разделе + клиентские метаданные.
 */
import { all, run } from './db.js';
import type { Actor } from './auth.js';
import type { ClientMeta } from './client-meta.js';

const ONLINE_SEC = 120;

export function touchPresence(input: {
  actor: Actor;
  path?: string;
  title?: string;
  section?: string;
  client?: Partial<ClientMeta>;
}): void {
  const actor = input.actor;
  if (!actor?.id) return;
  const path = String(input.path || '').slice(0, 300);
  const title = String(input.title || '').slice(0, 200);
  const section = String(input.section || '').slice(0, 80);
  const c = input.client || {};
  const clientIp = String(c.ip || '').slice(0, 64);
  const userAgent = String(c.ua || '').slice(0, 400);
  const os = String(c.os || '').slice(0, 80);
  const browser = String(c.browser || '').slice(0, 80);
  const device = String(c.device || '').slice(0, 40);
  const region = String(c.region || '').slice(0, 200);
  const country = String(c.country || '').slice(0, 80);
  run(
    `INSERT INTO user_presence (
       actor_id, actor_name, role, path, title, section, last_seen,
       client_ip, user_agent, os, browser, device, region, country
     ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(actor_id) DO UPDATE SET
       actor_name = excluded.actor_name,
       role = excluded.role,
       path = excluded.path,
       title = excluded.title,
       section = excluded.section,
       last_seen = datetime('now'),
       client_ip = CASE WHEN excluded.client_ip != '' THEN excluded.client_ip ELSE user_presence.client_ip END,
       user_agent = CASE WHEN excluded.user_agent != '' THEN excluded.user_agent ELSE user_presence.user_agent END,
       os = CASE WHEN excluded.os != '' AND excluded.os != '—' THEN excluded.os ELSE user_presence.os END,
       browser = CASE WHEN excluded.browser != '' AND excluded.browser != '—' THEN excluded.browser ELSE user_presence.browser END,
       device = CASE WHEN excluded.device != '' THEN excluded.device ELSE user_presence.device END,
       region = CASE WHEN excluded.region != '' THEN excluded.region ELSE user_presence.region END,
       country = CASE WHEN excluded.country != '' THEN excluded.country ELSE user_presence.country END`,
    [
      actor.id,
      actor.name || actor.login || '',
      actor.role || '',
      path,
      title,
      section,
      clientIp,
      userAgent,
      os,
      browser,
      device,
      region,
      country,
    ]
  );
}

export type PresenceRow = {
  actor_id: string;
  actor_name: string;
  role: string;
  path: string;
  title: string;
  section: string;
  last_seen: string;
  seconds_ago: number;
  client_ip: string;
  user_agent: string;
  os: string;
  browser: string;
  device: string;
  region: string;
  country: string;
};

export function listOnlinePresence(): PresenceRow[] {
  run(
    `DELETE FROM user_presence
     WHERE datetime(last_seen) < datetime('now', ?)`,
    [`-${ONLINE_SEC * 3} seconds`]
  );
  const rows = all<PresenceRow>(
    `SELECT actor_id, actor_name, role, path, title, section, last_seen,
            CAST((julianday('now') - julianday(last_seen)) * 86400 AS INTEGER) AS seconds_ago,
            COALESCE(client_ip, '') AS client_ip,
            COALESCE(user_agent, '') AS user_agent,
            COALESCE(os, '') AS os,
            COALESCE(browser, '') AS browser,
            COALESCE(device, '') AS device,
            COALESCE(region, '') AS region,
            COALESCE(country, '') AS country
     FROM user_presence
     WHERE datetime(last_seen) >= datetime('now', ?)
     ORDER BY datetime(last_seen) DESC`,
    [`-${ONLINE_SEC} seconds`]
  );
  return rows.map((r) => ({
    ...r,
    seconds_ago: Number(r.seconds_ago) || 0,
    client_ip: r.client_ip || '',
    user_agent: r.user_agent || '',
    os: r.os || '',
    browser: r.browser || '',
    device: r.device || '',
    region: r.region || '',
    country: r.country || '',
  }));
}

export function clearPresence(actorId: string): void {
  const id = String(actorId || '').trim();
  if (!id) return;
  run('DELETE FROM user_presence WHERE actor_id = ?', [id]);
}
