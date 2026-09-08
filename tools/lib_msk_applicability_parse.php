<?php
/**
 * Общий разбор колонок применимости номенклатуры Москвы (лист → product_applicability).
 */
declare(strict_types=1);

if (!function_exists('normalizeCarMark')) {
    function normalizeCarMark(string $mark): string
    {
        $mark = trim(preg_replace('/\s+/u', ' ', $mark) ?? $mark);
        $mark = rtrim($mark, ':：');
        if ($mark === '') {
            return '';
        }
        $low = mb_strtolower($mark, 'UTF-8');
        static $map = [
            'mercedes-benz' => 'Mercedes-Benz',
            'mercedes benz' => 'Mercedes-Benz',
            'mercedesbenz' => 'Mercedes-Benz',
            'mercedes' => 'Mercedes-Benz',
            'mb' => 'Mercedes-Benz',
            'bmw' => 'BMW',
            'vw' => 'Volkswagen',
            'landrover' => 'Land Rover',
            'range rover' => 'Land Rover',
            'li xiang' => 'LiXiang',
            'lixiang' => 'LiXiang',
        ];
        if (isset($map[$low])) {
            return $map[$low];
        }
        if (preg_match('/^[a-z]/u', $mark)) {
            return mb_strtoupper(mb_substr($mark, 0, 1, 'UTF-8'), 'UTF-8')
                . mb_substr($mark, 1, null, 'UTF-8');
        }

        return $mark;
    }
}

if (!function_exists('looksLikeCarModelNotMark')) {
    /** Модели/кузова, которые ошибочно попали в «марку» без префикса бренда. */
    function looksLikeCarModelNotMark(string $token): bool
    {
        $t = trim($token);
        if ($t === '') {
            return false;
        }
        if (preg_match('/^(C|E|S|G|GL|GLA|GLB|GLC|GLE|GLS|CLS|CLA|ML|SL|SLK|CLK)-?Class\b/ui', $t)) {
            return true;
        }
        if (preg_match('/^(X\d|M\d|\d[\s-]?Series|7 Series|5-Series|3 Series)\b/ui', $t)) {
            return true;
        }
        if (preg_match('/^(A\d|Q\d|RS\d|TT|R8)\b/ui', $t)) {
            return true;
        }

        return false;
    }
}

if (!function_exists('parseApplicabilityAllCars')) {
    /**
     * Разбор «Mercedes-Benz S-Class (W220) 1998-2005 | …»
     * и склеек вида «BMW: X5 …; X6 …» (марка наследуется).
     *
     * @return list<array{mark:string,model:string,generation:string,years:string}>
     */
    function parseApplicabilityAllCars(string $text): array
    {
        $text = trim($text);
        if ($text === '') {
            return [];
        }
        $out = [];
        $seen = [];
        $lastMark = '';
        $multiMark = 'Mercedes-Benz|Land Rover|Alfa Romeo|Rolls-Royce|Great Wall|Li Xiang|LiXiang|Aston Martin|Range Rover';

        foreach (preg_split('/\s*[|;]\s*/u', $text) ?: [] as $chunk) {
            $chunk = trim((string) $chunk);
            if ($chunk === '') {
                continue;
            }
            $years = '';
            if (preg_match(
                '/^(.*?)[\s,]+(\d{4}(?:\s*[-–—]\s*(?:\d{4}|н\.?\s*в\.?)?)?)\s*$/ui',
                $chunk,
                $ym
            )) {
                $chunk = trim($ym[1]);
                $years = trim(preg_replace('/\s+/u', '', str_replace(['–', '—'], '-', $ym[2])) ?? $ym[2]);
                $years = preg_replace('/н\.?в\.?/ui', 'н.в.', $years) ?? $years;
            }

            $generation = '';
            if (preg_match('/\(([^)]+)\)/u', $chunk, $gm)) {
                $generation = trim(preg_replace('/\s*,\s*/u', ', ', $gm[1]) ?? $gm[1]);
                $chunk = trim(preg_replace('/\s*\([^)]+\)\s*/u', ' ', $chunk) ?? $chunk);
            }
            if ($generation === '' && preg_match(
                '/\s+((?:[A-ZА-Я]\d{2,4}|[A-Z]{1,3}\d{2,3})(?:\s*\/\s*(?:[A-ZА-Я]\d{2,4}|[A-Z]{1,3}\d{2,3})*)*)\s*$/u',
                $chunk,
                $bm
            )) {
                $generation = preg_replace('/\s+/u', '', $bm[1]) ?? $bm[1];
                $chunk = trim(mb_substr($chunk, 0, -mb_strlen($bm[0], 'UTF-8'), 'UTF-8'));
            }

            $chunk = trim(preg_replace('/\s+/u', ' ', $chunk) ?? $chunk);
            if ($chunk === '') {
                continue;
            }

            $mark = '';
            $model = '';
            if (preg_match('/^(' . $multiMark . '|[A-Za-zА-Яа-я][A-Za-zА-Яа-я0-9-]*)\s*:\s*(.+)$/ui', $chunk, $mm)) {
                $mark = normalizeCarMark($mm[1]);
                $model = trim($mm[2]);
            } elseif (preg_match('/^(' . $multiMark . ')\s+(.+)$/ui', $chunk, $mm)) {
                $mark = normalizeCarMark($mm[1]);
                $model = trim($mm[2]);
            } else {
                $parts = preg_split('/\s+/u', $chunk, 2) ?: [];
                $maybeMark = normalizeCarMark((string) ($parts[0] ?? ''));
                $rest = trim((string) ($parts[1] ?? ''));
                if ($rest !== '' && !looksLikeCarModelNotMark($maybeMark)) {
                    $mark = $maybeMark;
                    $model = $rest;
                } elseif ($lastMark !== '') {
                    $mark = $lastMark;
                    $model = $chunk;
                } else {
                    $mark = $maybeMark;
                    $model = $rest;
                }
            }

            if ($mark !== '' && looksLikeCarModelNotMark($mark) && $lastMark !== '') {
                $model = trim($mark . ($model !== '' ? ' ' . $model : ''));
                $mark = $lastMark;
            }

            $model = trim(preg_replace('/\s+и\s+др\.?$/ui', '', $model) ?? $model);
            if ($mark === '' && $model === '') {
                continue;
            }
            if ($mark !== '') {
                $lastMark = $mark;
            }
            $key = mb_strtolower($mark . '|' . $model . '|' . $generation . '|' . $years, 'UTF-8');
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $out[] = [
                'mark' => $mark,
                'model' => $model,
                'generation' => $generation,
                'years' => $years,
            ];
        }

        return $out;
    }
}

if (!function_exists('parseMarksModelBodyYears')) {
    /**
     * Запасной разбор грубых колонок Марки / Модель / Кузова / Годы.
     *
     * @return list<array{mark:string,model:string,generation:string,years:string}>
     */
    function parseMarksModelBodyYears(string $marks, string $model, string $body, string $years): array
    {
        $markParts = [];
        foreach (preg_split('/[,;]/u', $marks) ?: [] as $p) {
            $p = normalizeCarMark(trim((string) $p));
            if ($p !== '') {
                $markParts[] = $p;
            }
        }
        $modelParts = [];
        foreach (preg_split('/\s*\/\s*/u', $model) ?: [] as $p) {
            $p = trim(preg_replace('/\s+и\s+др\.?$/ui', '', trim((string) $p)) ?? '');
            if ($p === '' || preg_match('/^\d{1,3}$/', $p)) {
                continue;
            }
            $modelParts[] = $p;
        }
        $bodyParts = [];
        foreach (preg_split('/[,;\/]+/u', $body) ?: [] as $p) {
            $p = trim((string) $p);
            if ($p !== '') {
                $bodyParts[] = $p;
            }
        }
        if ($markParts === [] && $modelParts === []) {
            return [];
        }
        if ($markParts === []) {
            $markParts = [''];
        }
        if ($modelParts === []) {
            $modelParts = [''];
        }
        $out = [];
        $seen = [];
        $gen = implode(', ', $bodyParts);
        if (count($markParts) === count($modelParts) && count($markParts) > 1) {
            foreach ($markParts as $i => $mark) {
                $row = [
                    'mark' => $mark,
                    'model' => $modelParts[$i],
                    'generation' => $gen,
                    'years' => $years,
                ];
                $key = mb_strtolower(implode('|', $row), 'UTF-8');
                if (!isset($seen[$key])) {
                    $seen[$key] = true;
                    $out[] = $row;
                }
            }

            return $out;
        }
        foreach ($markParts as $mark) {
            foreach ($modelParts as $mod) {
                $row = [
                    'mark' => $mark,
                    'model' => $mod,
                    'generation' => $gen,
                    'years' => $years,
                ];
                $key = mb_strtolower(implode('|', $row), 'UTF-8');
                if (!isset($seen[$key])) {
                    $seen[$key] = true;
                    $out[] = $row;
                }
            }
        }

        return $out;
    }
}

if (!function_exists('deriveApplicabilityOnlyModel')) {
    /**
     * Из «A6 allroad III (C7)» + gen «III (C7)» → only_model «A6 allroad» (как в 1С).
     */
    function deriveApplicabilityOnlyModel(string $model, string $generation): string
    {
        $model = trim(preg_replace('/\s+/u', ' ', $model) ?? $model);
        $generation = trim(preg_replace('/\s+/u', ' ', $generation) ?? $generation);
        if ($model === '') {
            return '';
        }
        if ($generation !== '') {
            $foldM = mb_strtolower(str_replace('ё', 'е', $model), 'UTF-8');
            $foldG = mb_strtolower(str_replace('ё', 'е', $generation), 'UTF-8');
            if ($foldG !== '' && str_ends_with($foldM, $foldG)) {
                $cut = mb_substr($model, 0, mb_strlen($model, 'UTF-8') - mb_strlen($generation, 'UTF-8'), 'UTF-8');

                return trim($cut);
            }
        }
        if (preg_match('/^(.+?)\s+\(([^)]+)\)\s*$/u', $model, $m)) {
            $base = trim($m[1]);
            if (preg_match('/^(.*?)\s+(I{1,3}|IV|V|VI{0,3}|IX|X)\s*$/u', $base, $rm)) {
                return trim($rm[1]);
            }

            return $base;
        }

        return '';
    }
}

if (!function_exists('enrichApplicabilityOnlyModel')) {
    /**
     * @param list<array{mark:string,model:string,generation?:string,years?:string,gen?:string}> $rows
     * @return list<array{mark:string,model:string,only_model:string,generation:string,years:string}>
     */
    function enrichApplicabilityOnlyModel(array $rows): array
    {
        $out = [];
        foreach ($rows as $row) {
            $model = trim((string) ($row['model'] ?? ''));
            $gen = trim((string) ($row['generation'] ?? $row['gen'] ?? ''));
            $only = deriveApplicabilityOnlyModel($model, $gen);
            $out[] = [
                'mark' => trim((string) ($row['mark'] ?? '')),
                'model' => $model,
                'only_model' => $only,
                'generation' => $gen,
                'years' => trim((string) ($row['years'] ?? '')),
            ];
        }

        return $out;
    }
}

if (!function_exists('parseProgrammaticApplicability')) {
    /**
     * Разбор «Применимость программная»:
     *   марка | модель | поколение | годы ‖ марка | модель | поколение | годы
     *
     * @return list<array{mark:string,model:string,generation:string,years:string}>
     */
    function parseProgrammaticApplicability(string $text): array
    {
        $text = trim($text);
        if ($text === '') {
            return [];
        }
        $out = [];
        $seen = [];
        // ‖ / || / вертикальная линия двойная
        $chunks = preg_split('/\s*(?:‖|\|\|)\s*/u', $text) ?: [];
        foreach ($chunks as $chunk) {
            $chunk = trim((string) $chunk);
            if ($chunk === '') {
                continue;
            }
            $parts = array_map(
                static fn ($p) => trim((string) $p),
                preg_split('/\s*\|\s*/u', $chunk) ?: []
            );
            // допускаем 2–4 поля
            $mark = normalizeCarMark((string) ($parts[0] ?? ''));
            $model = (string) ($parts[1] ?? '');
            $generation = (string) ($parts[2] ?? '');
            $years = (string) ($parts[3] ?? '');
            if ($mark === '' && $model === '') {
                continue;
            }
            $key = mb_strtolower($mark . '|' . $model . '|' . $generation . '|' . $years, 'UTF-8');
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $out[] = [
                'mark' => $mark,
                'model' => $model,
                'generation' => $generation,
                'years' => $years,
            ];
        }

        return $out;
    }
}
