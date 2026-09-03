<?php
declare(strict_types=1);
/**
 * Подключает единый шлюз Amo API. Сначала /root/shared, потом соседний rate_limit.php.
 */
$candidates = [
    '/root/shared/amo/rate_limit.php',
    dirname(__DIR__, 2) . '/shared/amo/rate_limit.php',
    dirname(__DIR__) . '/rate_limit.php',
    __DIR__ . '/rate_limit.php',
];
foreach ($candidates as $f) {
    if (is_readable($f)) {
        require_once $f;
        return;
    }
}
throw new RuntimeException('amo rate_limit.php not found');
