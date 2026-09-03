<?php
/**
 * ИНН из Amo часто мусор («я», телефон, обрезки).
 * В Учёт берём только 10 (юр) / 12 (ИП) с контрольной суммой.
 */
declare(strict_types=1);

function wms_inn_control_digit(array $digits, array $coeffs): int
{
    $sum = 0;
    foreach ($coeffs as $i => $c) {
        $sum += ((int) ($digits[$i] ?? 0)) * $c;
    }
    return ($sum % 11) % 10;
}

function wms_sanitize_buyer_inn(string $raw): string
{
    $inn = preg_replace('/\D/', '', $raw) ?: '';
    if (strlen($inn) !== 10 && strlen($inn) !== 12) {
        return '';
    }
    if (preg_match('/^0+$/', $inn)) {
        return '';
    }
    $d = array_map('intval', str_split($inn));
    if (strlen($inn) === 10) {
        if (wms_inn_control_digit($d, [2, 4, 10, 3, 5, 9, 4, 6, 8]) !== $d[9]) {
            return '';
        }
    } else {
        if (wms_inn_control_digit($d, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) !== $d[10]) {
            return '';
        }
        if (wms_inn_control_digit($d, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) !== $d[11]) {
            return '';
        }
    }
    return $inn;
}

function wms_buyer_kind_from_inn(string $inn): string
{
    $n = strlen($inn);
    if ($n === 10) {
        return 'legal';
    }
    if ($n === 12) {
        return 'ip';
    }
    return 'person';
}

function wms_cf_is_checked(string $raw): bool
{
    $v = trim($raw);
    return $v === '1' || strcasecmp($v, 'true') === 0 || strcasecmp($v, 'да') === 0;
}
