/**
 * Swagger UI + OpenAPI JSON for WMS.
 *
 * Auth model:
 * - Off unless SWAGGER_ENABLED=1
 * - Allow if admin session (wms_sid / legacy admin cookie)
 *   OR HTTP Basic when SWAGGER_BASIC_USER + SWAGGER_BASIC_PASS are set
 * - Try-it-out: GET only (mutations via app UI / curl with session)
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

function isAdminSession(c: Context): boolean {
  const sid = getCookie(c, COOKIE_SID);
  const actor = actorFromSession(sid);
  if (actor && (actor.isSystemAdmin || actor.role === 'admin')) return true;
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

export const swaggerGate: MiddlewareHandler = async (c, next) => {
  if (!swaggerEnabled()) {
    return c.json({ error: 'swagger disabled' }, 404);
  }
  if (isAdminSession(c) || basicOk(c)) {
    return next();
  }
  if (basicConfigured()) {
    return c.text('Unauthorized', 401, {
      'WWW-Authenticate': 'Basic realm="WMS Swagger"',
    });
  }
  return c.json({ error: 'admin session or swagger basic auth required' }, 403);
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
