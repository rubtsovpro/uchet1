<?php

declare(strict_types=1);

/**
 * Единый шлюз AmoCRM API для всего VPS (amo1c / widget / bank / partner / sto).
 *
 * — глобальный throttle (~2–3 req/s) через общий lock-файл
 * — 429: мягкий backoff (медленнее), без полной блокировки UI
 * — 403: жёсткая пауза (circuit breaker)
 *
 * Состояние: glue/data/api_pause.json + api_throttle.lock + api_soft_backoff.json
 *
 * Важно: файл может подключаться из разных путей (widget + amo1c access) —
 * поэтому ниже ранний выход, если уже загружен.
 */

if (function_exists('amo_api_request')) {
    return;
}

/** Мягкий backoff при 429 (сек) — только ужесточает интервал, не стопорит всё. */
if (!defined('AMO_API_BACKOFF_429_DEFAULT')) {
    define('AMO_API_BACKOFF_429_DEFAULT', 45);
}
if (!defined('AMO_API_BACKOFF_INTERVAL')) {
    define('AMO_API_BACKOFF_INTERVAL', 0.9);
}
/** Пауза при блокировке 403 (сек) — час по умолчанию. */
if (!defined('AMO_API_PAUSE_403_DEFAULT')) {
    define('AMO_API_PAUSE_403_DEFAULT', 3600);
}
/** Мин. интервал между любыми запросами (сек). ~2.5 rps. */
if (!defined('AMO_API_MIN_INTERVAL')) {
    define('AMO_API_MIN_INTERVAL', 0.45);
}

function amo_rate_limit_data_dir(): string
{
    static $resolved = null;
    if (is_string($resolved)) {
        return $resolved;
    }

    $candidates = [
        '/root/widget_pnevmopodveska1_ru/public_html/glue/data',
        '/root/shared/amo/data',
        dirname(__DIR__, 3) . '/widget_pnevmopodveska1_ru/public_html/glue/data',
        dirname(__DIR__, 2) . '/widget_pnevmopodveska1_ru/public_html/glue/data',
        dirname(__DIR__) . '/glue/data',
        sys_get_temp_dir() . '/amo_api_gateway',
    ];
    foreach ($candidates as $dir) {
        if (is_dir($dir) || @mkdir($dir, 0755, true)) {
            $resolved = $dir;

            return $resolved;
        }
    }

    $resolved = sys_get_temp_dir();

    return $resolved;
}

function amo_api_pause_path(): string
{
    return amo_rate_limit_data_dir() . '/api_pause.json';
}

function amo_api_throttle_path(): string
{
    return amo_rate_limit_data_dir() . '/api_throttle.lock';
}

function amo_api_backoff_path(): string
{
    return amo_rate_limit_data_dir() . '/api_soft_backoff.json';
}

function amo_api_log_path(): string
{
    return amo_rate_limit_data_dir() . '/api_gateway.log';
}

function amo_api_gateway_log(string $event, array $ctx = []): void
{
    $line = date('Y-m-d H:i:s') . ' | ' . $event;
    if ($ctx !== []) {
        $line .= ' | ' . json_encode($ctx, JSON_UNESCAPED_UNICODE);
    }
    $line .= "\n";
    @file_put_contents(amo_api_log_path(), $line, FILE_APPEND | LOCK_EX);
}

/** @return array{until:int,reason:string,set_at:int}|null */
function amo_api_pause_info(): ?array
{
    $path = amo_api_pause_path();
    if (!is_readable($path)) {
        return null;
    }
    $data = json_decode((string) file_get_contents($path), true);
    if (!is_array($data)) {
        return null;
    }
    $until = (int) ($data['until'] ?? 0);
    if ($until <= time()) {
        return null;
    }

    return [
        'until' => $until,
        'reason' => (string) ($data['reason'] ?? ''),
        'set_at' => (int) ($data['set_at'] ?? 0),
    ];
}

function amo_api_is_paused(): bool
{
    return amo_api_pause_info() !== null;
}

function amo_api_pause_seconds(int $seconds, string $reason = ''): void
{
    $seconds = max(15, min(86400, $seconds));
    $until = time() + $seconds;
    $existing = amo_api_pause_info();
    if ($existing !== null && $existing['until'] > $until) {
        $until = $existing['until'];
    }

    $dir = amo_rate_limit_data_dir();
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }

    @file_put_contents(amo_api_pause_path(), json_encode([
        'until' => $until,
        'reason' => $reason,
        'set_at' => time(),
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), LOCK_EX);

    amo_api_gateway_log('pause', [
        'seconds' => $seconds,
        'until' => date('c', $until),
        'reason' => $reason,
    ]);
}

function amo_api_pause_left_seconds(): int
{
    $info = amo_api_pause_info();

    return $info === null ? 0 : max(0, $info['until'] - time());
}

/** Рекомендуемый интервал poll для виджета (мс). */
function amo_api_poll_after_ms(): int
{
    $left = amo_api_pause_left_seconds();
    if ($left <= 0) {
        return 0;
    }

    return min(3_600_000, max(15_000, $left * 1000));
}

function amo_api_clear_pause(): void
{
    $path = amo_api_pause_path();
    if (is_file($path)) {
        @unlink($path);
    }
    amo_api_gateway_log('pause_cleared');
}

/** Мягкий backoff после 429: не блокирует, только замедляет. */
function amo_api_soft_backoff(int $seconds = AMO_API_BACKOFF_429_DEFAULT, float $minInterval = AMO_API_BACKOFF_INTERVAL, string $reason = ''): void
{
    $seconds = max(10, min(600, $seconds));
    $until = time() + $seconds;
    $path = amo_api_backoff_path();
    $existing = null;
    if (is_readable($path)) {
        $existing = json_decode((string) file_get_contents($path), true);
    }
    if (is_array($existing) && (int) ($existing['until'] ?? 0) > $until) {
        $until = (int) $existing['until'];
        $minInterval = max($minInterval, (float) ($existing['min_interval'] ?? 0));
    }

    @file_put_contents($path, json_encode([
        'until' => $until,
        'min_interval' => $minInterval,
        'reason' => $reason,
        'set_at' => time(),
    ], JSON_UNESCAPED_UNICODE), LOCK_EX);

    amo_api_gateway_log('soft_backoff', [
        'seconds' => $seconds,
        'min_interval' => $minInterval,
        'reason' => $reason,
    ]);
}

function amo_api_effective_min_interval(): float
{
    $base = (float) AMO_API_MIN_INTERVAL;
    $path = amo_api_backoff_path();
    if (!is_readable($path)) {
        return $base;
    }
    $data = json_decode((string) file_get_contents($path), true);
    if (!is_array($data) || (int) ($data['until'] ?? 0) <= time()) {
        return $base;
    }

    return max($base, (float) ($data['min_interval'] ?? $base));
}

/** Идёт мягкий backoff после 429 — опциональные запросы (field_gate и т.п.) лучше не слать в Amo. */
function amo_api_is_backing_off(): bool
{
    $path = amo_api_backoff_path();
    if (!is_readable($path)) {
        return false;
    }
    $data = json_decode((string) file_get_contents($path), true);

    return is_array($data) && (int) ($data['until'] ?? 0) > time();
}

/** Глобальный семафор: слоты без удержания lock на время sleep. */
function amo_api_global_throttle(float $minIntervalSec = 0.0): void
{
    if ($minIntervalSec <= 0) {
        $minIntervalSec = amo_api_effective_min_interval();
    }
    $path = amo_api_throttle_path();
    $fp = @fopen($path, 'c+');
    if ($fp === false) {
        return;
    }
    if (!flock($fp, LOCK_EX)) {
        fclose($fp);

        return;
    }

    $raw = stream_get_contents($fp);
    $last = is_string($raw) && $raw !== '' ? (float) $raw : 0.0;
    $now = microtime(true);
    $slot = ($last > 0) ? max($now, $last + $minIntervalSec) : $now;
    if (($slot - $now) > 2.0) {
        $slot = $now + $minIntervalSec;
    }
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, (string) $slot);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    $wait = $slot - microtime(true);
    if ($wait > 0.001) {
        usleep((int) round(min($wait, 2.0) * 1_000_000));
    }
}

/** @param array<string, string> $headers */
function amo_api_handle_rate_response(int $code, array $headers, string $raw, string $context = ''): void
{
    $retryAfter = (int) ($headers['retry-after'] ?? 0);
    $bodyLower = mb_strtolower($raw, 'UTF-8');
    $looksBlocked = str_contains($bodyLower, 'too many requests')
        || str_contains($bodyLower, 'rate limit')
        || str_contains($bodyLower, 'превыш')
        || str_contains($bodyLower, 'blocked by')
        || str_contains($bodyLower, 'api request limits');

    // 429 — только замедление, без стопа всего VPS (иначе заказ в amo1c «не открывается»).
    if ($code === 429) {
        $sec = $retryAfter > 0 ? min(max($retryAfter, 15), 90) : AMO_API_BACKOFF_429_DEFAULT;
        amo_api_soft_backoff($sec, AMO_API_BACKOFF_INTERVAL, '429 ' . $context);

        return;
    }

    if ($code === 403 || ($code === 401 && $looksBlocked)) {
        $pause = $retryAfter > 0 ? min($retryAfter, 14_400) : AMO_API_PAUSE_403_DEFAULT;
        amo_api_pause_seconds($pause, 'AmoCRM blocked (' . $code . ')' . ($context !== '' ? ' ' . $context : ''));

        return;
    }

    if ($code === 503 || $code === 502) {
        $pause = $retryAfter > 0 ? min($retryAfter, 120) : 60;
        amo_api_pause_seconds($pause, 'AmoCRM unavailable (' . $code . ')' . ($context !== '' ? ' ' . $context : ''));
    }
}

/**
 * Универсальный запрос (полный URL). Единая точка для всего проекта.
 *
 * @param list<string> $httpHeaders
 * @param array<string,mixed>|string|null $body
 * @return array{ok:bool,code:int,body:mixed,raw:string,headers:array<string,string>,paused:bool}
 */
function amo_api_request(
    string $method,
    string $url,
    array $httpHeaders = [],
    $body = null,
    string $context = ''
): array {
    if (amo_api_is_paused()) {
        $left = amo_api_pause_left_seconds();
        amo_api_gateway_log('blocked_call', ['context' => $context, 'left' => $left, 'url' => $url]);

        return [
            'ok' => false,
            'code' => 429,
            'body' => ['message' => 'API paused locally', 'left_sec' => $left],
            'raw' => '',
            'headers' => [],
            'paused' => true,
        ];
    }

    amo_api_global_throttle();

    $responseHeaders = [];
    $curl = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
        CURLOPT_HTTPHEADER => $httpHeaders,
        CURLOPT_USERAGENT => 'amoCRM-API-gateway/1.0',
        CURLOPT_SSL_VERIFYPEER => 0,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $headerLine) use (&$responseHeaders): int {
            $len = strlen($headerLine);
            if (str_contains($headerLine, ':')) {
                [$name, $value] = explode(':', $headerLine, 2);
                $responseHeaders[strtolower(trim($name))] = trim($value);
            }

            return $len;
        },
    ];
    if ($body !== null) {
        $opts[CURLOPT_POSTFIELDS] = is_string($body)
            ? $body
            : json_encode($body, JSON_UNESCAPED_UNICODE);
    }
    curl_setopt_array($curl, $opts);
    $raw = (string) curl_exec($curl);
    $code = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $err = curl_error($curl);
    curl_close($curl);

    if ($raw === '' && $err !== '') {
        amo_api_gateway_log('curl_error', ['context' => $context, 'err' => $err, 'url' => $url]);
    }

    amo_api_handle_rate_response($code, $responseHeaders, $raw, $context);
    if ($code === 403 || $code === 429) {
        amo_api_gateway_log('amo_deny', ['code' => $code, 'context' => $context, 'url' => $url]);
    }

    $decoded = json_decode($raw, true);

    return [
        'ok' => $code >= 200 && $code < 300,
        'code' => $code,
        'body' => $decoded,
        'raw' => $raw,
        'headers' => $responseHeaders,
        'paused' => false,
    ];
}

/**
 * @param list<string> $httpHeaders
 * @return array{ok:bool,code:int,body:mixed,raw:string,headers:array<string,string>,paused:bool}
 */
function amo_api_http_request(
    string $subdomain,
    array $httpHeaders,
    string $method,
    string $path,
    ?array $body = null,
    array $query = [],
    string $context = ''
): array {
    $url = 'https://' . $subdomain . '.amocrm.ru' . $path;
    if ($query !== []) {
        $url .= (str_contains($path, '?') ? '&' : '?') . http_build_query($query);
    }

    return amo_api_request($method, $url, $httpHeaders, $body, $context);
}

/** Статус шлюза для мониторинга. */
function amo_api_gateway_status(): array
{
    $info = amo_api_pause_info();
    $backoff = null;
    $bp = amo_api_backoff_path();
    if (is_readable($bp)) {
        $b = json_decode((string) file_get_contents($bp), true);
        if (is_array($b) && (int) ($b['until'] ?? 0) > time()) {
            $backoff = $b;
        }
    }

    return [
        'ok' => true,
        'paused' => $info !== null,
        'pause' => $info,
        'left_sec' => amo_api_pause_left_seconds(),
        'soft_backoff' => $backoff,
        'data_dir' => amo_rate_limit_data_dir(),
        'min_interval' => amo_api_effective_min_interval(),
    ];
}
