/**
 * Следим за задержкой event loop. При «залипании» (тяжёлый sync/SQL) лаг растёт —
 * логируем в health и при длительном пороге выходим: systemd Restart= поднимает процесс.
 *
 * Env:
 *   WMS_EVENT_LOOP_WARN_MS=500
 *   WMS_EVENT_LOOP_KILL_MS=5000   (0 = не убивать)
 *   WMS_EVENT_LOOP_KILL_AFTER_MS=20000
 */

let lastLagMs = 0;
let peakLagMs = 0;
let samples = 0;
let overSince = 0;
let started = false;

export type EventLoopLagStats = {
  lag_ms: number;
  peak_lag_ms: number;
  samples: number;
  kill_ms: number;
  kill_after_ms: number;
};

function envInt(name: string, fallback: number): number {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function eventLoopLagStats(): EventLoopLagStats {
  return {
    lag_ms: lastLagMs,
    peak_lag_ms: peakLagMs,
    samples,
    kill_ms: envInt('WMS_EVENT_LOOP_KILL_MS', 5000),
    kill_after_ms: envInt('WMS_EVENT_LOOP_KILL_AFTER_MS', 20_000),
  };
}

/** Запускать один раз после listen. */
export function startEventLoopWatchdog(): void {
  if (started) return;
  started = true;

  const intervalMs = envInt('WMS_EVENT_LOOP_INTERVAL_MS', 500);
  const warnMs = envInt('WMS_EVENT_LOOP_WARN_MS', 500);
  const killMs = envInt('WMS_EVENT_LOOP_KILL_MS', 5000);
  const killAfterMs = envInt('WMS_EVENT_LOOP_KILL_AFTER_MS', 20_000);

  let expected = Date.now() + intervalMs;
  const timer = setInterval(() => {
    const now = Date.now();
    const lag = Math.max(0, now - expected);
    expected = now + intervalMs;
    lastLagMs = lag;
    samples += 1;
    if (lag > peakLagMs) peakLagMs = lag;

    if (lag >= warnMs) {
      console.warn(`[watchdog] event-loop lag ${lag}ms (warn≥${warnMs})`);
    }

    if (killMs > 0 && lag >= killMs) {
      if (!overSince) overSince = now;
      const sustained = now - overSince;
      if (sustained >= killAfterMs) {
        console.error(
          `[watchdog] event-loop lag sustained ${lag}ms ≥ ${killMs}ms for ${sustained}ms — exit for systemd restart`
        );
        process.exit(78);
      }
    } else {
      overSince = 0;
    }
  }, intervalMs);

  // Не держим процесс только из‑за таймера при ручном stop.
  if (typeof timer.unref === 'function') timer.unref();

  console.log(
    `[watchdog] event-loop: interval=${intervalMs}ms warn=${warnMs}ms kill=${killMs}ms after=${killAfterMs}ms`
  );
}
