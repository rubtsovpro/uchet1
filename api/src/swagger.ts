/**
 * Swagger UI + OpenAPI JSON for WMS.
 *
 * Auth model:
 * - Off unless SWAGGER_ENABLED=1
 * - Admin session only (wms_sid: system admin или role=admin; legacy admin cookie)
 * - Optional HTTP Basic when SWAGGER_BASIC_* set (для curl/CI)
 * - Неавторизованный браузер → /login?next=…
 * - Авторизован, но не админ → 403
 * - Try-it-out: GET only
 */
import type { Context, MiddlewareHandler } from 'hono';
import type { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { swaggerUI } from '@hono/swagger-ui';
import { actorFromSession, COOKIE_SID } from './auth.js';
import { openApiSpec } from './openapi.js';

const LEGACY_COOKIE = 'wms_auth';
const LEGACY_OK = 'wms_ok';

export function swaggerEnabled(): boolean {
  return String(process.env.SWAGGER_ENABLED || '').trim() === '1';
}

function sessionActor(c: Context) {
  return actorFromSession(getCookie(c, COOKIE_SID));
}

function isAdminSession(c: Context): boolean {
  const actor = sessionActor(c);
  if (actor && (actor.isSystemAdmin || actor.role === 'admin')) return true;
  return getCookie(c, LEGACY_COOKIE) === LEGACY_OK;
}

function isLoggedIn(c: Context): boolean {
  if (sessionActor(c)) return true;
  return getCookie(c, LEGACY_COOKIE) === LEGACY_OK;
}

function basicConfigured(): { user: string; pass: string } | null {
  const user = String(process.env.SWAGGER_BASIC_USER || '').trim();
  const pass = String(process.env.SWAGGER_BASIC_PASS || '');
  if (!user || !pass) return null;
  return { user, pass };
}

function basicOk(c: Context): boolean {
  const cfg = basicConfigured();
  if (!cfg) return false;
  const hdr = c.req.header('authorization') || '';
  if (!hdr.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i < 0) return false;
    const u = decoded.slice(0, i);
    const p = decoded.slice(i + 1);
    return u === cfg.user && p === cfg.pass;
  } catch {
    return false;
  }
}

function wantsHtml(c: Context): boolean {
  const accept = (c.req.header('accept') || '').toLowerCase();
  if (accept.includes('text/html')) return true;
  // Прямой заход в адресной строке часто без Accept
  const p = c.req.path;
  return p === '/swagger' || p.endsWith('/swagger');
}

function nextDest(c: Context): string {
  const url = new URL(c.req.url);
  const dest = url.pathname + url.search;
  return dest || '/api/swagger';
}

function forbidHtml(): Response {
  return new Response(
    `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Доступ запрещён</title><link rel="stylesheet" href="/styles.css"/></head><body class="auth-body"><div class="auth-wrap"><div class="auth-card"><h1>Доступ только для администраторов</h1><p class="muted">Swagger / OpenAPI доступен сотрудникам с ролью admin (или системному администратору). Войдите под админом или откройте основной Учёт №1.</p><p><a href="/login?next=${encodeURIComponent('/api/swagger')}">Войти как админ</a> · <a href="https://uchetn1.ru/">Учёт №1</a></p></div></div></body></html>`,
    { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export const swaggerGate: MiddlewareHandler = async (c, next) => {
  if (!swaggerEnabled()) {
    return c.json({ error: 'swagger disabled' }, 404);
  }
  if (isAdminSession(c) || basicOk(c)) {
    return next();
  }
  if (isLoggedIn(c)) {
    if (wantsHtml(c)) return forbidHtml();
    return c.json({ error: 'доступ только администраторам' }, 403);
  }
  if (basicConfigured() && (c.req.header('authorization') || '').startsWith('Basic ')) {
    return c.text('Unauthorized', 401, {
      'WWW-Authenticate': 'Basic realm="WMS Swagger"',
    });
  }
  if (wantsHtml(c)) {
    return c.redirect('/login?next=' + encodeURIComponent(nextDest(c)));
  }
  if (basicConfigured()) {
    return c.text('Unauthorized', 401, {
      'WWW-Authenticate': 'Basic realm="WMS Swagger"',
    });
  }
  return c.json({ error: 'нужна сессия администратора' }, 401);
};

/** Register on the /api Hono app — exact paths only, no catch-all. */
export function mountSwagger(api: Hono): void {
  api.get('/openapi.json', swaggerGate, (c) => c.json(openApiSpec));
  api.get(
    '/swagger',
    swaggerGate,
    swaggerUI({
      url: '/api/openapi.json',
      title: 'Учёт №1 — WMS API',
      persistAuthorization: true,
      withCredentials: true,
      supportedSubmitMethods: ['get'],
      tryItOutEnabled: true,
      docExpansion: 'list',
      filter: true,
    })
  );
}
