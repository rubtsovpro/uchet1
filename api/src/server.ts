import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './api.js';
import { get, migrate, run } from './db.js';
import { repairPodveskaMskWarehouses } from './hs.js';
import { deactivateLegacyServices, purgeServiceLinesFromOutDocs, reclassifyAllProductKinds } from './product-kind.js';
import {
  actorFromSession,
  authenticatePassword,
  authenticatePin,
  COOKIE_SID,
  createSession,
  destroySession,
  staffHasPinPublic,
  type Actor,
} from './auth.js';
import {
  admin2faRequired,
  actorSnapshotForChallenge,
  startAdmin2faChallenge,
  verifyAdmin2faChallenge,
} from './auth-2fa.js';
import { writeAudit } from './audit.js';
import { clientIpFromHeaders, parseUserAgent } from './client-meta.js';
import { homePathForLogin, listHostScreens, screenForHost } from './host-screens.js';
import { touchPresence } from './presence.js';
import { ensureOrgProfileSeeded } from './sales-docs.js';
import { ensureClientOrgContours } from './ensure-client-orgs.js';
import { ensureStaffRoleDefaults } from './staff.js';
import { ensureDevPlanSchema } from './dev-plan.js';
import { telegram2faConfigStatus } from './telegram.js';
import { syncRatesFromCbr } from './currencies.js';
import { expireDuePaymentLinks } from './payment-links.js';
import { runStoSaleWriteoffCron } from './deal-stock-flow.js';
import { ensureStoPartsSchema } from './sto-parts-flow.js';
import { ensureStaffNotificationsSchema } from './staff-notifications.js';
import { ensureWebPushSchema } from './web-push.js';
import { startPurchaseDrivePoller } from './purchase-drive.js';
import { ensureProductServiceLinksSchema } from './product-service-links.js';
import { ensureTaxSchema } from './tax/schema.js';
import { machineApiKeyOkForPath } from './api-keys.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Собранный UI: web/dist (legacy + React). Переходный период — API раздаёт статику. */
const publicDir = path.resolve(__dirname, '..', '..', 'web', 'dist');
/** Операционные HTML (pick, courier…) — правим в web/public, без полной сборки Vite. */
const webPublicDir = path.resolve(__dirname, '..', '..', 'web', 'public');

/** legacy.js ~1.7MB — readFileSync на каждый запрос блокировал event loop и вешал WMS. */
const publicHtmlCache = new Map<string, { mtimeMs: number; content: string }>();

function readPublicHtml(file: string): string | null {
  const full = path.join(webPublicDir, file);
  if (!existsSync(full)) return null;
  const mtimeMs = statSync(full).mtimeMs;
  const cached = publicHtmlCache.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.content;
  const content = readFileSync(full, 'utf8');
  publicHtmlCache.set(file, { mtimeMs, content });
  return content;
}

function sendLegacyHtml(c: Context) {
  const html = readPublicHtml('legacy.html');
  if (!html) return c.text('legacy.html missing', 404);
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  c.header('Pragma', 'no-cache');
  c.header('Content-Type', 'text/html; charset=utf-8');
  return c.body(html);
}

function sendLegacyJs(c: Context) {
  const js = readPublicHtml('legacy.js');
  if (!js) return c.text('legacy.js missing', 404);
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  c.header('Pragma', 'no-cache');
  c.header('Content-Type', 'application/javascript; charset=utf-8');
  return c.body(js);
}

function sendLegacyCss(c: Context) {
  const css = readPublicHtml('styles.css');
  if (!css) return c.text('styles.css missing', 404);
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  c.header('Pragma', 'no-cache');
  c.header('Content-Type', 'text/css; charset=utf-8');
  return c.body(css);
}

migrate();
try {
  const repaired = repairPodveskaMskWarehouses();
  if (repaired.fixed > 0) {
    console.log('[startup] repair podveska MSK warehouses:', repaired.fixed);
  }
} catch (e) {
  console.warn('[startup] repair podveska warehouses:', e instanceof Error ? e.message : e);
}
try {
  ensureStoPartsSchema();
} catch (e) {
  console.warn('[migrate] sto-parts schema:', e instanceof Error ? e.message : e);
}
try {
  ensureStaffNotificationsSchema();
} catch (e) {
  console.warn('[migrate] staff-notifications:', e instanceof Error ? e.message : e);
}
try {
  ensureWebPushSchema();
} catch (e) {
  console.warn('[migrate] web-push:', e instanceof Error ? e.message : e);
}
try {
  ensureProductServiceLinksSchema();
} catch (e) {
  console.warn('[migrate] product-service-links:', e instanceof Error ? e.message : e);
}
try {
  ensureTaxSchema();
} catch (e) {
  console.warn('[migrate] tax schema:', e instanceof Error ? e.message : e);
}
ensureStaffRoleDefaults();
ensureOrgProfileSeeded();
try {
  ensureDevPlanSchema();
} catch (e) {
  console.warn('[ensureDevPlanSchema]', e instanceof Error ? e.message : e);
}
try {
  ensureClientOrgContours();
} catch (e) {
  console.warn('[ensureClientOrgContours]', e instanceof Error ? e.message : e);
}
// Разово: починить «Диагностика» и т.п. в расходных (\b не ловил кириллицу)
try {
  const done = get<{ value: string }>(
    `SELECT value FROM meta WHERE key = 'out_services_purge_v2'`
  );
  if (!done) {
    const kind = reclassifyAllProductKinds();
    const purged = purgeServiceLinesFromOutDocs();
    run(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [
        'out_services_purge_v2',
        JSON.stringify({
          at: new Date().toISOString(),
          changed: kind.changed,
          service: kind.service,
          purged: purged.deleted,
        }),
      ]
    );
    console.log(
      `[migrate] out services purge: changed=${kind.changed} services=${kind.service} purged_lines=${purged.deleted}`
    );
  }
} catch (e) {
  console.warn('[migrate] out services purge failed:', e instanceof Error ? e.message : e);
}
try {
  const hidden = deactivateLegacyServices();
  if (hidden > 0) {
    console.log(`[startup] legacy services hidden (not se-*): ${hidden}`);
  }
} catch (e) {
  console.warn('[startup] deactivateLegacyServices failed:', e instanceof Error ? e.message : e);
}

/** Фоновые задачи внутри процесса (курсы ЦБ + истечение резервов оплаты). */
function startBackgroundJobs() {
  const runCbr = async (reason: string) => {
    try {
      const r = await syncRatesFromCbr({ force: false });
      const codes = Array.isArray(r.updated)
        ? r.updated.map((u) => (typeof u === 'string' ? u : u.code)).filter(Boolean).join(',')
        : '';
      console.log(
        `[cron] cbr ${reason}:`,
        r.cached ? `cached ${r.rate_date}` : `ok ${r.rate_date}${codes ? ' · ' + codes : ''}`
      );
    } catch (e) {
      console.warn('[cron] cbr failed', e instanceof Error ? e.message : e);
    }
  };
  const runExpire = () => {
    try {
      const r = expireDuePaymentLinks(100);
      if (r.expired > 0) console.log(`[cron] expire-payment: ${r.expired}`);
    } catch (e) {
      console.warn('[cron] expire-payment failed', e instanceof Error ? e.message : e);
    }
  };

  // Старт: курсы через 20с (не блокировать boot), потом раз в 6ч
  setTimeout(() => {
    void runCbr('boot');
  }, 20_000);
  setInterval(() => {
    void runCbr('interval');
  }, 6 * 60 * 60 * 1000);

  // Резервы оплаты: каждую минуту
  setInterval(runExpire, 60_000);
  setTimeout(runExpire, 45_000);

  // Списание СТО по успешным сделкам — раз в сутки ~21:00 МСК (подстраховка)
  let lastStoWriteoffDay = '';
  const runStoWriteoffIfEvening = () => {
    try {
      const msk = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Moscow' });
      const [day, hourStr] = [msk.slice(0, 10), msk.slice(11, 13)];
      const hour = Number(hourStr);
      if (hour !== 21 || day === lastStoWriteoffDay) return;
      lastStoWriteoffDay = day;
      const r = runStoSaleWriteoffCron(120);
      if (r.written > 0 || r.errors.length) {
        console.log(
          `[cron] sto-sale-writeoffs: written=${r.written} skipped=${r.skipped} errors=${r.errors.length}`
        );
      }
    } catch (e) {
      console.warn('[cron] sto-sale-writeoffs failed', e instanceof Error ? e.message : e);
    }
  };
  setInterval(runStoWriteoffIfEvening, 15 * 60 * 1000);
  setTimeout(runStoWriteoffIfEvening, 120_000);

  // Google Drive прайсы Жени → purchase-intake (раз в 3 мин)
  try {
    startPurchaseDrivePoller();
  } catch (e) {
    console.warn('[cron] purchase-drive init:', e instanceof Error ? e.message : e);
  }

  // Примечания Amo после /pick: при лимите — очередь, слив по 1 шт. ~раз в 45с
  const runAmoNoteQueue = async () => {
    try {
      const { drainAmoLeadNoteQueue, amoLeadNoteQueueSize } = await import('./amo-note-queue.js');
      if (amoLeadNoteQueueSize() <= 0) return;
      const { sendAmoLeadNoteOnce, sendAmoLeadTaskOnce } = await import('./amo-pick-handoff.js');
      const r = await drainAmoLeadNoteQueue({
        max: 1,
        sendNote: (item) => sendAmoLeadNoteOnce({ dealId: item.deal_id, text: item.text }),
        sendTask: (item) => sendAmoLeadTaskOnce({ dealId: item.deal_id, text: item.text }),
      });
      if (r.sent || r.dropped || r.deferred) {
        console.log(
          `[cron] amo-note-queue: sent=${r.sent} deferred=${r.deferred} dropped=${r.dropped} left=${r.left}`
        );
      }
    } catch (e) {
      console.warn('[cron] amo-note-queue failed', e instanceof Error ? e.message : e);
    }
  };
  setInterval(() => {
    void runAmoNoteQueue();
  }, 45_000);
  setTimeout(() => {
    void runAmoNoteQueue();
  }, 25_000);
}

const PORT = Number(process.env.WMS_PORT || 3101);
const LEGACY_COOKIE = 'wms_auth';
const LEGACY_OK = 'wms_ok';

/** Origins ролевых UI + api (absolute API host / credentials). */
const CORS_ORIGINS = new Set([
  'https://uchetn1.ru',
  'https://www.uchetn1.ru',
  'https://api.uchetn1.ru',
  'https://www.api.uchetn1.ru',
  'https://pick.uchetn1.ru',
  'https://www.pick.uchetn1.ru',
  'https://photo.uchetn1.ru',
  'https://www.photo.uchetn1.ru',
  'https://lift.uchetn1.ru',
  'https://www.lift.uchetn1.ru',
  'https://reception.uchetn1.ru',
  'https://www.reception.uchetn1.ru',
  'https://in.uchetn1.ru',
  'https://www.in.uchetn1.ru',
  'https://swagger.uchetn1.ru',
  'https://www.swagger.uchetn1.ru',
  'https://pdn.uchetn1.ru',
  'https://www.pdn.uchetn1.ru',
  'https://pdn.fogel.com.ru',
  'https://www.pdn.fogel.com.ru',
  'https://pdn.pnevmopodveska1.ru',
  'https://www.pdn.pnevmopodveska1.ru',
  'http://localhost:3101',
  'http://127.0.0.1:3101',
]);

function isPdnPublicHost(host: string): boolean {
  const h = String(host || '')
    .toLowerCase()
    .split(':')[0]!;
  return (
    h === 'pdn.uchetn1.ru' ||
    h === 'www.pdn.uchetn1.ru' ||
    h === 'pdn.fogel.com.ru' ||
    h === 'www.pdn.fogel.com.ru' ||
    h === 'pdn.pnevmopodveska1.ru' ||
    h === 'www.pdn.pnevmopodveska1.ru'
  );
}

const app = new Hono();

app.use(
  '*',
  cors({
    origin: (origin) => (origin && CORS_ORIGINS.has(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    maxAge: 86400,
  })
);

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

/** Киоск-экраны: HTML отдаём без редиректа на /login; 401 ловит JS → login?next=… */
function isKioskHtmlPath(p: string): boolean {
  return (
    p === '/pick'
    || p === '/pick.html'
    || p === '/pick-sw.js'
    || p === '/pick-new-task.mp3'
    || p === '/courier'
    || p === '/courier.html'
    || p === '/photo'
    || p === '/photo.html'
    || p === '/lift'
    || p === '/lift.html'
    || p === '/reception'
    || p === '/reception.html'
    || p === '/production'
    || p === '/production.html'
    || p === '/warehouse/ops'
    || p === '/warehouse/today'
    || p === '/warehouse/pick'
  );
}

app.use('*', async (c, next) => {
  const p = c.req.path;
  const hostRaw = c.req.header('x-forwarded-host') || c.req.header('host') || '';
  const host = String(hostRaw).toLowerCase().split(':')[0]!;
  // pdn.* — публичная подпись согласия, без логина
  if (isPdnPublicHost(host)) {
    return next();
  }
  // Unpublished: keep only Google Doc + local docs/VISION-uchet1.md
  if (p === '/vision.html') {
    return c.text('Not Found', 404);
  }
  if (
    p.startsWith('/api/health')
    || p === '/login'
    || p === '/api/login'
    || p === '/api/login/2fa'
    || p === '/api/auth/2fa-status'
    || p === '/api/auth/screen'
    || p.startsWith('/api/crm/deals/ingest')
    || p.startsWith('/api/crm/production/jobs')
    || p.startsWith('/api/webhooks/')
    || p.startsWith('/api/cron/')
    || p.startsWith('/api/public/')
    // Swagger gate: admin session / optional Basic; redirect to login
    || p === '/api/swagger'
    || p === '/api/openapi.json'
    || p === '/styles.css'
    || p === '/brandbook.html'
    || p === '/sto-templates-pack.json'
    || p === '/pay'
    || p.startsWith('/pay/')
    || p === '/pay-demo'
    || p === '/pay-demo.html'
    || p === '/pdn'
    || p === '/pdn.html'
    || p.startsWith('/pdn/')
    || p.endsWith('.css')
    || p.endsWith('.js')
    || p.endsWith('.svg')
    || p.endsWith('.png')
    || p.endsWith('.mp3')
    || p.endsWith('.pdf')
    || p.endsWith('.ico')
    || p.endsWith('.woff2')
    || isKioskHtmlPath(p)
  ) {
    return next();
  }
  if (!isAuthed(c) && p.startsWith('/api/')) {
    if (machineApiKeyOkForPath(c)) return next();
    return c.json({ error: 'unauthorized' }, 401);
  }
  if (!isAuthed(c)) {
    const hostHdr = c.req.header('x-forwarded-host') || c.req.header('host');
    const screen = screenForHost(hostHdr);
    let nextPath = p && p !== '/login' ? p : '/';
    // На ролевом поддомене «/» → экран роли (для next= после логина)
    if (nextPath === '/' && screen.id !== 'wms') nextPath = screen.home_path;
    const q = c.req.query();
    const qs = new URLSearchParams(q as Record<string, string>).toString();
    const dest = qs ? `${nextPath}?${qs}` : nextPath;
    return c.redirect('/login?next=' + encodeURIComponent(dest));
  }
  return next();
});

function requestIsHttps(c: Parameters<typeof setCookie>[0]): boolean {
  // TEMP: на части сетей HTTPS/TLS нестабилен, клиенты скачут http↔https.
  // Secure-cookie тогда «теряется» и мобилка снова просит PIN. Пока — без Secure.
  const mode = String(process.env.COOKIE_SECURE || '0').trim().toLowerCase();
  if (mode === '0' || mode === 'false' || mode === 'off') return false;
  if (mode === '1' || mode === 'true' || mode === 'on') return true;
  const xfProto = String(c.req.header('x-forwarded-proto') || '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  if (xfProto === 'https') return true;
  if (xfProto === 'http') return false;
  try {
    return String(c.req.url || '').startsWith('https:');
  } catch {
    return false;
  }
}

/** Clear must match Secure/SameSite used at set, иначе браузер не удалит cookie. */
function clearSessionCookies(c: Parameters<typeof setCookie>[0]) {
  // Сносим оба варианта — после смены Secure могли остаться «прилипшие» cookie.
  for (const secure of [true, false]) {
    const opts = { path: '/', secure, sameSite: 'Lax' as const };
    deleteCookie(c, COOKIE_SID, opts);
    deleteCookie(c, LEGACY_COOKIE, opts);
  }
}

function finishLogin(
  c: Parameters<typeof setCookie>[0],
  actor: Actor,
  sid: string,
  meta: { ip: string; ua: string }
) {
  const https = requestIsHttps(c);
  const host = String(c.req.header('x-forwarded-host') || c.req.header('host') || '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  setCookie(c, COOKIE_SID, sid, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: https,
    maxAge: 60 * 60 * 24 * 14,
  });
  deleteCookie(c, LEGACY_COOKIE, { path: '/', secure: https, sameSite: 'Lax' });
  writeAudit({
    action: 'auth.login',
    entity: 'session',
    entityId: actor.id,
    summary: `Вход: ${actor.name}`,
    actor,
    ip: meta.ip,
  });
  const parsed = parseUserAgent(meta.ua);
  const homePath = homePathForLogin(host, actor);
  const screen = screenForHost(host);
  touchPresence({
    actor,
    path: homePath,
    title: 'Вход',
    section: screen.id === 'wms' ? 'home' : screen.id,
    client: { ip: meta.ip, ua: meta.ua, ...parsed },
  });
  const pickerOnly = !actor.isSystemAdmin && (actor.role === 'warehouse' || actor.role === 'courier');
  const photographerOnly = !actor.isSystemAdmin && actor.role === 'photographer';
  return {
    ok: true as const,
    user: {
      id: actor.id,
      name: actor.name,
      email: actor.email,
      login: actor.login,
      role: actor.role,
      has_pin: staffHasPinPublic(actor.id),
    },
    home_path: homePath,
    screen: screen.id,
    picker_only: pickerOnly,
    photographer_only: photographerOnly,
  };
}

app.get('/api/auth/2fa-status', (c) => {
  return c.json(telegram2faConfigStatus());
});

app.get('/api/auth/screen', (c) => {
  const host = c.req.header('x-forwarded-host') || c.req.header('host');
  const screen = screenForHost(host);
  return c.json({
    host: String(host || '').split(':')[0] || '',
    ...screen,
    hosts: listHostScreens(),
  });
});

app.post('/api/login', async (c) => {
  const body = await c.req.json<{ username?: string; password?: string; pin?: string }>();
  const meta = clientMeta(c);
  const username = String(body.username || '');
  const pin = String(body.pin || '').replace(/\D/g, '');
  const password = String(body.password || '');

  const result = pin
    ? authenticatePin(username, pin)
    : authenticatePassword(username, password);
  if (!result.ok) {
    writeAudit({
      action: 'auth.login_failed',
      entity: 'session',
      summary: `Неудачный вход: ${username}${pin ? ' (PIN)' : ''}`,
      ip: meta.ip,
    });
    return c.json({ error: result.error }, 401);
  }

  // PIN-вход на планшете — без Telegram 2FA (короткий код уже фактор)
  if (!pin && admin2faRequired(result.actor)) {
    const challenge = await startAdmin2faChallenge(result.actor, meta);
    if (!challenge.ok) {
      writeAudit({
        action: 'auth.login_2fa_failed',
        entity: 'session',
        entityId: result.actor.id,
        summary: `2FA не отправлен: ${challenge.error}`,
        actor: result.actor,
        ip: meta.ip,
      });
      return c.json(
        { error: challenge.error, ask: challenge.ask, channel: 'telegram' },
        503
      );
    }
    writeAudit({
      action: 'auth.login_2fa_sent',
      entity: 'session',
      entityId: result.actor.id,
      summary: `2FA код отправлен в Telegram: ${result.actor.name}`,
      actor: result.actor,
      ip: meta.ip,
    });
    return c.json({
      ok: true,
      need_2fa: true,
      challenge_id: challenge.challenge_id,
      channel: challenge.channel,
      expires_in_sec: challenge.expires_in_sec,
      hint: challenge.hint,
      user: actorSnapshotForChallenge(result.actor),
    });
  }

  const sid = createSession(result.actor.id, meta);
  return c.json(finishLogin(c, result.actor, sid, meta));
});

app.post('/api/login/2fa', async (c) => {
  const body = await c.req.json<{ challenge_id?: string; code?: string }>();
  const meta = clientMeta(c);
  const verified = verifyAdmin2faChallenge(
    String(body.challenge_id || ''),
    String(body.code || ''),
    meta
  );
  if (!verified.ok) {
    writeAudit({
      action: 'auth.login_2fa_failed',
      entity: 'session',
      summary: `2FA отказ: ${verified.error}`,
      ip: meta.ip,
    });
    return c.json({ error: verified.error }, 401);
  }
  const actor = actorFromSession(verified.sid);
  if (!actor) return c.json({ error: 'Сессия не создана' }, 500);
  writeAudit({
    action: 'auth.login_2fa_ok',
    entity: 'session',
    entityId: actor.id,
    summary: `2FA OK: ${actor.name}`,
    actor,
    ip: meta.ip,
  });
  return c.json(finishLogin(c, actor, verified.sid, meta));
});

app.post('/api/logout', (c) => {
  const sid = getCookie(c, COOKIE_SID);
  const actor = actorFromSession(sid);
  destroySession(sid);
  clearSessionCookies(c);
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

/** React SPA — только перенесённые экраны; /money/* кроме tochka — legacy меню Денег */
const REACT_PATH_RE =
  /^\/(chats|money\/tochka|crm\/deals|sales\/(invoices|upd|sf|workorders|doc)|company\/org)(\/|$)/;

function sendPublicHtml(file: string) {
  return serveStatic({ path: path.join(publicDir, file) });
}

async function sendScreenHtml(c: Context, file: string, title: string, pathHint: string) {
  const full = path.join(publicDir, file);
  if (existsSync(full)) {
    return sendPublicHtml(file)(c, async () => {});
  }
  return c.html(
    `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title><link rel="stylesheet" href="/styles.css"/></head><body class="auth-body"><div class="auth-wrap"><div class="auth-card"><h1>${title}</h1><p class="muted">Экран готовится. Обновите страницу через минуту или откройте <code>${pathHint}</code> на основном домене.</p><p><a href="/login?next=${encodeURIComponent(pathHint)}">Войти</a></p></div></div></body></html>`
  );
}

app.get('/legacy.html', (c) => {
  const q = c.req.query('to');
  if (q && q.startsWith('/')) return c.redirect(q, 302);
  return c.redirect('/', 302);
});

// Главная: на ролевых поддоменах — сразу на экран; иначе legacy WMS
app.get('/', async (c, next) => {
  const host = c.req.header('x-forwarded-host') || c.req.header('host');
  const h = String(host || '')
    .toLowerCase()
    .split(':')[0]!;
  if (isPdnPublicHost(h)) {
    return sendPublicHtml('pdn.html')(c, next);
  }
  const screen = screenForHost(host);
  if (screen.id !== 'wms' && screen.home_path !== '/') {
    return c.redirect(screen.home_path, 302);
  }
  return sendLegacyHtml(c);
});
app.get('/legacy.js', (c) => sendLegacyJs(c));
app.get('/styles.css', (c) => sendLegacyCss(c));
const PICK_UI_REV = 'pc57';
const PICK_UI_SIG = 'pick-production-incremental-20260903';

function sendPickHtml(c: Context, opts?: { screen?: 'pick' | 'production' }) {
  const screen = opts?.screen === 'production' ? 'production' : 'pick';
  const basePath = screen === 'production' ? '/production' : '/pick';
  if (c.req.query('v') !== PICK_UI_REV) {
    const q = new URLSearchParams();
    const raw = c.req.query();
    for (const [k, val] of Object.entries(raw)) {
      if (k === 'v') continue;
      if (Array.isArray(val)) val.forEach((x) => q.append(k, String(x)));
      else if (val != null) q.set(k, String(val));
    }
    q.set('v', PICK_UI_REV);
    return c.redirect(basePath + '?' + q.toString(), 302);
  }
  const pickPath = path.join(webPublicDir, 'pick.html');
  let html = readPublicHtml('pick.html');
  if (!html) return c.text('pick.html missing', 404);
  if (screen === 'production') {
    html = html
      .replace(
        '<head>',
        `<head><script>window.__PICK_SCREEN='production';</script>`
      )
      .replace(
        /<title>[^<]*<\/title>/,
        '<title>Производство · Учёт №1</title>'
      );
  }
  const mtime = statSync(pickPath).mtimeMs;
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');
  c.header('ETag', `"${screen}-${PICK_UI_REV}-${Math.floor(mtime)}"`);
  c.header('Content-Type', 'text/html; charset=utf-8');
  return c.body(html);
}

// Примитивный экран сборщика (замена Ани) — отдельный UI без clutter
app.get('/pick', (c) => sendPickHtml(c));
app.get('/pick.html', (c) => sendPickHtml(c));
app.get('/warehouse/ops', (c) => sendPickHtml(c));
app.get('/warehouse/today', (c) => sendPickHtml(c));
app.get('/warehouse/pick', (c) => sendPickHtml(c));
/** Звук новой задачи на /pick — из web/public (не web/dist). */
app.get('/pick-new-task.mp3', (c) => {
  const full = path.join(webPublicDir, 'pick-new-task.mp3');
  if (!existsSync(full)) return c.text('Not Found', 404);
  c.header('Content-Type', 'audio/mpeg');
  c.header('Cache-Control', 'public, max-age=86400');
  return c.body(readFileSync(full));
});
/** Экран курьера — HTML из файла, без кэша (serveStatic иногда кэшируется nginx/браузером) */
function sendCourierHtml(c: Context) {
  const html = readPublicHtml('courier.html');
  if (!html) return c.text('courier.html missing', 404);
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');
  c.header('Content-Type', 'text/html; charset=utf-8');
  return c.body(html);
}
app.get('/courier', (c) => sendCourierHtml(c));
app.get('/courier.html', (c) => sendCourierHtml(c));
/** Экран производства — тот же chrome, что /pick (режим production) */
app.get('/production', (c) => sendPickHtml(c, { screen: 'production' }));
app.get('/production.html', (c) => sendPickHtml(c, { screen: 'production' }));
/** Приёмка поставок по Data Matrix */
app.get('/in/scan', async (c) => {
  // Сброс кэша старой страницы «ШК»
  if (c.req.query('v') !== 'dm11') {
    return c.redirect('/in/scan?v=dm11', 302);
  }
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  c.header('Pragma', 'no-cache');
  return sendPublicHtml('in-scan.html')(c, async () => {});
});
app.get('/in/scan.html', async (c) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  return sendPublicHtml('in-scan.html')(c, async () => {});
});
app.get('/supply', async (c) => {
  if (c.req.query('v') !== 'dm9') {
    return c.redirect('/supply?v=dm9', 302);
  }
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  c.header('Pragma', 'no-cache');
  return sendPublicHtml('supply.html')(c, async () => {});
});
app.get('/supply.html', async (c) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  return sendPublicHtml('supply.html')(c, async () => {});
});
app.get('/purchases/supply', async (c) => {
  return c.redirect('/supply?v=dm9', 302);
});
/** Экран фотографа временно отключён — на главную */
app.get('/photo', (c) => c.redirect('/', 302));
app.get('/photo.html', (c) => c.redirect('/', 302));
app.get('/media/photo', (c) => c.redirect('/media/photos', 302));
app.get('/photo/report', (c) => c.redirect('/', 302));
app.get('/photo/report.html', (c) => c.redirect('/', 302));
/** Мобильное фото авто при приёме + Web Push — без кэша (старый flat header иначе залипает в PWA) */
app.get('/reception-photo', async (c) => {
  if (c.req.query('v') !== 'rp7') {
    const q = new URLSearchParams();
    const raw = c.req.query();
    for (const [k, val] of Object.entries(raw)) {
      if (val != null && val !== '') q.set(k, String(val));
    }
    q.set('v', 'rp7');
    return c.redirect(`/reception-photo?${q.toString()}`, 302);
  }
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  c.header('Pragma', 'no-cache');
  return sendPublicHtml('reception-photo.html')(c, async () => {});
});
app.get('/reception-photo.html', async (c) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  c.header('Pragma', 'no-cache');
  return sendPublicHtml('reception-photo.html')(c, async () => {});
});
app.get('/reception-photo.webmanifest', (c, next) => {
  c.header('Cache-Control', 'no-store, max-age=0');
  return sendPublicHtml('reception-photo.webmanifest')(c, next);
});
app.get('/reception-photo-sw.js', (c, next) => {
  c.header('Cache-Control', 'no-store, max-age=0');
  c.header('Service-Worker-Allowed', '/');
  return sendPublicHtml('reception-photo-sw.js')(c, next);
});
/** СТО: подъёмник / приёмщик (HTML может появиться от параллельной задачи) */
app.get('/lift', (c) => sendScreenHtml(c, 'lift.html', 'Подъёмник', '/lift'));
app.get('/lift.html', (c) => sendScreenHtml(c, 'lift.html', 'Подъёмник', '/lift'));
app.get('/sto/lift', (c) => sendScreenHtml(c, 'lift.html', 'Подъёмник', '/lift'));
app.get('/reception', (c) => sendScreenHtml(c, 'reception.html', 'Приёмщик', '/reception'));
app.get('/reception.html', (c) => sendScreenHtml(c, 'reception.html', 'Приёмщик', '/reception'));
app.get('/sto/reception', (c) => sendScreenHtml(c, 'reception.html', 'Приёмщик', '/reception'));
/** Промежуточная страница оплаты (СБП + карта + таймер) — публичная, по токену */
app.get('/pay', sendPublicHtml('pay.html'));
app.get('/pay/*', sendPublicHtml('pay.html'));
app.get('/pay.html', sendPublicHtml('pay.html'));
/** Демо экрана оплаты для дизайна/маркетинга (без боевой сделки) */
app.get('/pay-demo', sendPublicHtml('pay-demo.html'));
app.get('/pay-demo.html', sendPublicHtml('pay-demo.html'));
/** Публичная подпись согласия ПДн (SMS-код) */
app.get('/pdn', sendPublicHtml('pdn.html'));
app.get('/pdn.html', sendPublicHtml('pdn.html'));
app.get('/pdn/*', sendPublicHtml('pdn.html'));
/** Короткий путь /{token} на брендовых pdn-хостах и pdn.uchetn1.ru */
app.get('/:token', async (c, next) => {
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || '';
  const h = String(host).toLowerCase().split(':')[0]!;
  const token = c.req.param('token');
  if (isPdnPublicHost(h) && /^[A-Za-z0-9_-]{6,24}$/.test(token)) {
    return sendPublicHtml('pdn.html')(c, async () => {});
  }
  return next();
});
/** Разовая панель: чек коррекции АТОЛ (по предписанию ФНС) */
app.get('/fiscal/correction', (c, next) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  c.header('Pragma', 'no-cache');
  return sendPublicHtml('fiscal-correction.html')(c, next);
});
app.get('/fiscal/correction.html', (c, next) => {
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  return sendPublicHtml('fiscal-correction.html')(c, next);
});

app.use('/*', async (c, next) => {
  await next();
  const p = c.req.path;
  // Версионированные ассеты (?v=) можно кэшировать — иначе Simple Browser/слабый канал
  // каждый раз тянут legacy.js (~400KB) и главная остаётся белой.
  if (/\.(js|css)$/i.test(p)) {
    const ver = c.req.query('v');
    if (ver) {
      c.header('Cache-Control', 'public, max-age=86400, immutable');
    } else {
      c.header('Cache-Control', 'public, max-age=300');
    }
    return;
  }
  if (
    /\.html$/i.test(p) ||
    p.startsWith('/legacy') ||
    p === '/pick' ||
    p === '/courier' ||
    p === '/photo' ||
    p === '/production' ||
    p === '/reception-photo' ||
    p === '/lift' ||
    p === '/reception' ||
    p === '/supply' ||
    p.startsWith('/in/scan') ||
    p.startsWith('/photo/') ||
    p.startsWith('/reception-photo') ||
    p.startsWith('/sto/') ||
    p.startsWith('/media/photo') ||
    p.startsWith('/pay') ||
    p.startsWith('/fiscal/correction') ||
    p.startsWith('/warehouse/ops') ||
    p.startsWith('/warehouse/today') ||
    p.startsWith('/warehouse/pick') ||
    p === '/'
  ) {
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
  return sendLegacyHtml(c);
});

console.log(`WMS listening on :${PORT}`);
startBackgroundJobs();
serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' });
