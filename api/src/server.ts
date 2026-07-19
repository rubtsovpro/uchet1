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
import { clientIpFromHeaders, parseUserAgent } from './client-meta.js';
import { touchPresence } from './presence.js';
import { ensureOrgProfileSeeded } from './sales-docs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Собранный UI: web/dist (legacy + React). Переходный период — API раздаёт статику. */
const publicDir = path.resolve(__dirname, '..', '..', 'web', 'dist');

migrate();
ensureOrgProfileSeeded();

const PORT = Number(process.env.WMS_PORT || 3101);
const LEGACY_COOKIE = 'wms_auth';
const LEGACY_OK = 'wms_ok';

const app = new Hono();

function clientMeta(c: { req: { header: (n: string) => string | undefined } }) {
  return {
    ip: clientIpFromHeaders((n) => c.req.header(n)),
    ua: c.req.header('user-agent') || '',
  };
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
    || p.startsWith('/api/public/')
    // Swagger gate handles admin/basic itself (allows Basic without session)
    || p === '/api/swagger'
    || p === '/api/openapi.json'
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
    const next = p && p !== '/login' ? p : '/';
    const q = c.req.query();
    const qs = new URLSearchParams(q as Record<string, string>).toString();
    const dest = qs ? `${next}?${qs}` : next;
    return c.redirect('/login?next=' + encodeURIComponent(dest));
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
  // Сразу фиксируем presence с IP/UA (гео догонит на heartbeat).
  const parsed = parseUserAgent(meta.ua);
  touchPresence({
    actor: result.actor,
    path: '/',
    title: 'Вход',
    section: 'home',
    client: { ip: meta.ip, ua: meta.ua, ...parsed },
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

/** React SPA — только перенесённые экраны; остальное — UI с чистыми URL (legacy.html) */
const REACT_PATH_RE =
  /^\/(money|crm\/deals|sales\/(invoices|upd|sf|workorders|doc)|company\/org)(\/|$)/;

function sendPublicHtml(file: string) {
  return serveStatic({ path: path.join(publicDir, file) });
}

app.get('/legacy.html', (c) => {
  const q = c.req.query('to');
  if (q && q.startsWith('/')) return c.redirect(q, 302);
  return c.redirect('/', 302);
});

// Главная — классический UI (не React index.html)
app.get('/', sendPublicHtml('legacy.html'));

app.use('/*', async (c, next) => {
  await next();
  const p = c.req.path;
  if (/\.(js|css)$/i.test(p) || p.startsWith('/legacy')) {
    c.header('Cache-Control', 'no-store, max-age=0');
  }
});

app.use('/*', serveStatic({ root: publicDir }));

app.get('*', async (c, next) => {
  const p = c.req.path;
  if (p.startsWith('/api')) return next();
  // Missing assets must 404 — never serve HTML as .js/.css (breaks the whole UI).
  if (/\.[a-z0-9]{1,8}$/i.test(p) && !/\.html?$/i.test(p)) {
    return c.text('Not Found', 404);
  }
  if (REACT_PATH_RE.test(p)) {
    return sendPublicHtml('index.html')(c, next);
  }
  return sendPublicHtml('legacy.html')(c, next);
});

console.log(`WMS listening on :${PORT}`);
serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' });
