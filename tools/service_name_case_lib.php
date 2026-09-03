<?php
declare(strict_types=1);

/** Нормальный регистр названия услуги: предложение + аббревиатуры/коды моделей. */
function normName(string $s): string
{
    $s = mb_strtolower($s);
    $s = str_replace('ё', 'е', $s);
    $s = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $s) ?? $s;
    $s = preg_replace('/\s+/u', ' ', $s) ?? $s;

    return trim($s);
}

function normCode(string $s): string
{
    $s = mb_strtoupper(trim($s));
    $s = preg_replace('/\s+/u', '', $s) ?? $s;

    return $s;
}

function normSkuKey(string $s): string
{
    $s = mb_strtolower(trim($s));
    if ($s === '') {
        return '';
    }
    if (str_contains($s, '@')) {
        $s = explode('@', $s, 2)[0];
    }

    return trim($s);
}

function normalizeServiceName(string $name): string
{
    $name = trim($name);
    if ($name === '') {
        return $name;
    }

    $lower = mb_strtolower($name, 'UTF-8');
    $result = mb_strtoupper(mb_substr($lower, 0, 1), 'UTF-8') . mb_substr($lower, 1);

    $acronyms = [
        'гур', 'акпп', 'мкпп', 'грм', 'гбц', 'абс', 'эбу', 'двс', 'кпп', 'сто', 'эур',
        'atf', 'dpf', 'egr', 'esp', 'edc', 'oem', 'abs', 'suv', 'cvvt', 'vvt', 'pcv', 'srs',
        'ads', 'abc', 'dsg', 'cvt', 'hid', 'led', 'vvti', '4wd', '4x4', 'awd', 'bmw', 'mb',
    ];
    foreach ($acronyms as $acr) {
        $up = mb_strtoupper($acr, 'UTF-8');
        $result = preg_replace(
            '/(?<![\p{L}\p{N}])' . preg_quote($acr, '/') . '(?![\p{L}\p{N}])/ui',
            $up,
            $result
        ) ?? $result;
    }

    // Коды кузова/модели: w221, cl216, e70
    $result = preg_replace_callback(
        '/(?<![\p{L}\p{N}])([a-z]{1,3})(\d{2,4}[a-z]?)(?![\p{L}\p{N}])/u',
        static fn(array $m): string => mb_strtoupper($m[1], 'UTF-8') . mb_strtolower($m[2], 'UTF-8'),
        $result
    ) ?? $result;

    // Серии MR*, NF codes in text — не трогаем если уже в lower

    return $result;
}

function isAllCapsName(string $name): bool
{
    $name = trim($name);
    if ($name === '') {
        return false;
    }
    $letters = preg_replace('/[^\p{L}]/u', '', $name) ?? '';
    if ($letters === '' || mb_strlen($letters) < 4) {
        return false;
    }

    return mb_strtoupper($letters, 'UTF-8') === $letters;
}

/** @deprecated use normalizeServiceName */
function fixServiceNameCase(string $name): string
{
    return normalizeServiceName($name);
}

function servicesToolBankPaths(): array
{
    $candidates = [
        dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html',
        dirname(__DIR__) . '/../bank_pnevmopodveska1_ru/public_html',
        '/root/bank_pnevmopodveska1_ru/public_html',
    ];
    foreach ($candidates as $base) {
        $cred = $base . '/pnevmopodveska1-677b14845bb0.json';
        $auto = $base . '/vendor/autoload.php';
        if (is_file($cred) && is_file($auto)) {
            return [$cred, $auto];
        }
    }

    return ['', ''];
}

function wmsSqlitePath(): string
{
    $env = trim((string) (getenv('WMS_SQLITE') ?: ''));
    if ($env !== '' && is_file($env)) {
        return $env;
    }
    $candidates = [
        dirname(__DIR__) . '/data/warehouse.sqlite',
        '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite',
    ];
    foreach ($candidates as $p) {
        if (is_file($p)) {
            return $p;
        }
    }

    return '';
}

function findCol(array $header, array $names): int
{
    $low = array_map(static fn($c) => mb_strtolower(trim((string) $c)), $header);
    foreach ($names as $n) {
        $i = array_search(mb_strtolower($n), $low, true);
        if ($i !== false) {
            return (int) $i;
        }
    }

    return -1;
}

function colLetter(int $index): string
{
    $n = $index + 1;
    $s = '';
    while ($n > 0) {
        $n--;
        $s = chr(65 + ($n % 26)) . $s;
        $n = intdiv($n, 26);
    }

    return $s;
}

/** левая/правая, перед/зад и т.п. — разные услуги, не дубли. */
function servicePositionTag(string $name): string
{
    $n = ' ' . normName($name) . ' ';
    $rules = [
        'left' => '/\b(левая|левый|лев\b|л\/|слева|left)\b/u',
        'right' => '/\b(правая|правый|прав\b|п\/|справа|right)\b/u',
        'front' => '/\b(передняя|передний|перед\b|пер\.|front)\b/u',
        'rear' => '/\b(задняя|задний|зад\b|зад\.|rear)\b/u',
        'upper' => '/\b(верхняя|верхний|верх\b|upper)\b/u',
        'lower' => '/\b(нижняя|нижний|низ\b|lower)\b/u',
        'inner' => '/\b(внутренн|inner)\b/u',
        'outer' => '/\b(наружн|outer)\b/u',
    ];
    $tags = [];
    foreach ($rules as $tag => $re) {
        if (preg_match($re, $n)) {
            $tags[] = $tag;
        }
    }
    sort($tags);

    return $tags ? implode('+', $tags) : '';
}

function servicesDistinctByPosition(string $nameA, string $nameB): bool
{
    $a = servicePositionTag($nameA);
    $b = servicePositionTag($nameB);
    if ($a === '' && $b === '') {
        return false;
    }

    return $a !== $b;
}

/** Один код НФ, но разные стороны/оси — обе карточки нужны. */
function sameCodeButDistinctService(string $code, string $nameA, string $nameB): bool
{
    if ($code === '' || normCode($nameA) === '') {
        return false;
    }

    return normCode($code) !== '' && servicesDistinctByPosition($nameA, $nameB);
}
