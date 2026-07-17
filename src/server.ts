import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './api.js';
import { migrate } from './db.js';
import {
  actorFromSession,
  COOKIE_SID,
  destroySession,
  loginWithPassword,
  registerStaff,
} from './auth.js';
import { writeAudit } from './audit.js';
import { ensureOrgProfileSeeded } from './sales-docs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');

migrate();
ensureOrgProfileSeeded();

const PORT = Number(process.env.WMS_PORT || 3101);
const LEGACY_COOKIE = 'wms_auth';
const LEGACY_OK = 'wms_ok';

const app = new Hono();

function clientMeta(c: { req: { header: (n: string) => string | undefined } }) {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || '';
  return { ip, ua: c.req.header('user-agent') || '' };
}

function isAuthed(c: Parameters<typeof getCookie>[0]): boolean {
  const sid = getCookie(c, COOKIE_SID);
  if (actorFromSession(sid)) return true;
  // переходный период: старый cookie системного admin
  return getCookie(c, LEGACY_COOKIE) === LEGACY_OK;
}

app.use('*', async (c, next) => {
  const p = c.req.path;
  if (
    p.startsWith('/api/health')
    || p === '/login'
    || p === '/api/login'
    || p === '/api/register'
    || p.startsWith('/api/crm/deals/ingest')
    || p === '/styles.css'
    || p.endsWith('.css')
    || p.endsWith('.js')
    || p.endsWith('.svg')
    || p.endsWith('.png')
    || p.endsWith('.pdf')
    || p.endsWith('.ico')
    || p.endsWith('.woff2')
  ) {
    return next();
  }
  if (!isAuthed(c) && p.startsWith('/api/')) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  if (!isAuthed(c)) {
    return c.redirect('/login');
  }
  return next();
});

app.post('/api/login', async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const meta = clientMeta(c);
  const result = loginWithPassword(String(body.username || ''), String(body.password || ''), meta);
  if (!result.ok) {
    writeAudit({
      action: 'auth.login_failed',
      entity: 'session',
      summary: `Неудачный вход: ${body.username || ''}`,
      ip: meta.ip,
    });
    return c.json({ error: result.error }, 401);
  }
  setCookie(c, COOKIE_SID, result.sid, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 14,
  });
  deleteCookie(c, LEGACY_COOKIE, { path: '/' });
  writeAudit({
    action: 'auth.login',
    entity: 'session',
    entityId: result.actor.id,
    summary: `Вход: ${result.actor.name}`,
    actor: result.actor,
    ip: meta.ip,
  });
  return c.json({
    ok: true,
    user: {
      id: result.actor.id,
      name: result.actor.name,
      email: result.actor.email,
      login: result.actor.login,
      role: result.actor.role,
    },
  });
});

app.post('/api/register', async (c) => {
  const body = await c.req.json<{
    email?: string;
    password?: string;
    password2?: string;
    login?: string;
  }>();
  if (body.password !== body.password2) {
    return c.json({ error: 'Пароли не совпадают' }, 400);
  }
  const meta = clientMeta(c);
  const result = registerStaff(String(body.email || ''), String(body.password || ''), {
    ...meta,
    login: body.login,
  });
  if (!result.ok) return c.json({ error: result.error }, 400);
  setCookie(c, COOKIE_SID, result.sid, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 14,
  });
  deleteCookie(c, LEGACY_COOKIE, { path: '/' });
  writeAudit({
    action: 'auth.register',
    entity: 'staff',
    entityId: result.actor.id,
    summary: `Регистрация пароля: ${result.actor.name} (${result.actor.email})`,
    actor: result.actor,
    ip: meta.ip,
  });
  return c.json({
    ok: true,
    user: {
      id: result.actor.id,
      name: result.actor.name,
      email: result.actor.email,
      login: result.actor.login,
      role: result.actor.role,
    },
  });
});

app.post('/api/logout', (c) => {
  const sid = getCookie(c, COOKIE_SID);
  const actor = actorFromSession(sid);
  destroySession(sid);
  deleteCookie(c, COOKIE_SID, { path: '/' });
  deleteCookie(c, LEGACY_COOKIE, { path: '/' });
  if (actor) {
    writeAudit({
      action: 'auth.logout',
      entity: 'session',
      entityId: actor.id,
      summary: `Выход: ${actor.name}`,
      actor,
      ip: clientMeta(c).ip,
    });
  }
  return c.json({ ok: true });
});

app.route('/api', api);

app.get('/login', serveStatic({ path: path.join(publicDir, 'login.html') }));
app.use('/*', serveStatic({ root: publicDir }));

console.log(`WMS listening on :${PORT}`);
serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' });
