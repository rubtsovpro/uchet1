<?php
/**
 * Shared: push markdown (НАЧАЛО/КОНЕЦ ВКЛАДКИ) into a Google Doc tab via Docs API (SA).
 *
 * Caller must set before require:
 *   $docId, $tabTitle, $preferredTabId, $credPath, $autoload, $textPath
 * Optional: $appName (string), $tabTitleAliases (list<string> substrings to match)
 */
declare(strict_types=1);

foreach (['docId', 'tabTitle', 'preferredTabId', 'credPath', 'autoload', 'textPath'] as $req) {
    if (!isset($$req) || $$req === '') {
        fwrite(STDERR, "Missing config \${$req} before require of _push_markdown_tab_lib.php\n");
        exit(1);
    }
}
$appName = $appName ?? ('Uchet1 Doc tab: ' . $tabTitle);
$tabTitleAliases = $tabTitleAliases ?? [];

require $autoload;

$raw = file_get_contents($textPath);
if ($raw === false) {
    fwrite(STDERR, "Cannot read $textPath\n");
    exit(1);
}
if (!preg_match('/НАЧАЛО ВКЛАДКИ\s*(.*?)\s*КОНЕЦ ВКЛАДКИ/su', $raw, $m)) {
    fwrite(STDERR, "Markers НАЧАЛО/КОНЕЦ ВКЛАДКИ not found\n");
    exit(1);
}
$md = trim($m[1]);

/* ── helpers ─────────────────────────────────────────────────────────── */

function docsLen(string $s): int
{
    return (int) (strlen(mb_convert_encoding($s, 'UTF-16LE', 'UTF-8')) / 2);
}

function ghttp(string $method, string $url, string $token, ?array $json = null): array
{
    $ch = curl_init($url);
    $headers = ['Authorization: Bearer ' . $token, 'Accept: application/json'];
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 180,
    ];
    if ($json !== null) {
        $headers[] = 'Content-Type: application/json';
        $opts[CURLOPT_HTTPHEADER] = $headers;
        $opts[CURLOPT_POSTFIELDS] = json_encode($json, JSON_UNESCAPED_UNICODE);
    }
    curl_setopt_array($ch, $opts);
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $code, 'json' => json_decode((string) $resp, true), 'raw' => (string) $resp];
}

/**
 * Strip markdown inline: **bold**, `code`, [text](url) → text.
 * Returns plain text + list of bold ranges relative to start of this string.
 *
 * @return array{0: string, 1: list<array{0:int,1:int}>}
 */
function stripInline(string $s): array
{
    $s = preg_replace('~https?://github\.com/\S+~u', '', $s) ?? $s;
    $s = preg_replace('~\[([^\]]+)\]\((https?://[^)]+)\)~u', '$1', $s) ?? $s;
    $s = str_replace(["\r\n", "\r"], "\n", $s);

    $boldRanges = [];
    $out = '';
    $pos = 0;
    $len = mb_strlen($s, 'UTF-8');
    while ($pos < $len) {
        $ch = mb_substr($s, $pos, 1, 'UTF-8');
        if ($ch === '`' ) {
            $end = mb_strpos($s, '`', $pos + 1, 'UTF-8');
            if ($end !== false) {
                $inner = mb_substr($s, $pos + 1, $end - $pos - 1, 'UTF-8');
                $out .= $inner;
                $pos = $end + 1;
                continue;
            }
        }
        if ($ch === '*' && mb_substr($s, $pos, 2, 'UTF-8') === '**') {
            $end = mb_strpos($s, '**', $pos + 2, 'UTF-8');
            if ($end !== false) {
                $inner = mb_substr($s, $pos + 2, $end - $pos - 2, 'UTF-8');
                $startIdx = docsLen($out);
                $out .= $inner;
                $boldRanges[] = [$startIdx, $startIdx + docsLen($inner)];
                $pos = $end + 2;
                continue;
            }
        }
        $out .= $ch;
        $pos++;
    }

    // Typography
    $out = preg_replace('/\s{2,}/u', ' ', $out) ?? $out;
    $out = str_replace([' - ', ' – '], ' — ', $out);
    $out = trim($out);
    return [$out, $boldRanges];
}

/**
 * Convert a markdown table block into readable lines.
 *
 * @param list<string> $rows
 * @return list<array{type:string,text:string,bold?:list<array{0:int,1:int}>}>
 */
function tableToBlocks(array $rows): array
{
    $parsed = [];
    foreach ($rows as $row) {
        $row = trim($row);
        if ($row === '' || preg_match('/^\|[\s|:\-]+\|$/u', $row) || preg_match('/^\|?\s*:?-{3,}/u', $row)) {
            continue;
        }
        $cells = array_map('trim', explode('|', trim($row, '|')));
        $parsed[] = $cells;
    }
    if ($parsed === []) {
        return [];
    }
    $blocks = [];
    $header = array_shift($parsed);
    foreach ($parsed as $cells) {
        $parts = [];
        foreach ($cells as $i => $cell) {
            $label = $header[$i] ?? '';
            [$cellPlain] = stripInline($cell);
            [$labelPlain] = stripInline($label);
            if ($labelPlain === '#' || $labelPlain === '№') {
                // leading index without " #: "
                if ($cellPlain !== '') {
                    array_unshift($parts, $cellPlain . '.');
                }
                continue;
            }
            if ($labelPlain !== '' && $cellPlain !== '') {
                $parts[] = $cellPlain;
            } elseif ($cellPlain !== '') {
                $parts[] = $cellPlain;
            }
        }
        if ($parts === []) {
            continue;
        }
        // "1. Title — where" when first part ends with "."
        $line = implode(' — ', $parts);
        $line = preg_replace('/^(\d+)\.\s*—\s*/u', '$1. ', $line) ?? $line;
        [$plain, $bold] = stripInline($line);
        $blocks[] = ['type' => 'bullet', 'text' => $plain, 'bold' => $bold];
    }
    return $blocks;
}

/**
 * Parse markdown body into structured blocks.
 *
 * @return list<array{type:string,text?:string,style?:string,bold?:list<array{0:int,1:int}>,level?:int}>
 */
function parseMarkdown(string $md): array
{
    $lines = preg_split('/\n/u', str_replace(["\r\n", "\r"], "\n", $md)) ?: [];
    $blocks = [];
    $i = 0;
    $n = count($lines);
    $paraBuf = [];

    $flushPara = static function () use (&$paraBuf, &$blocks): void {
        if ($paraBuf === []) {
            return;
        }
        $joined = trim(implode(' ', $paraBuf));
        $paraBuf = [];
        if ($joined === '') {
            return;
        }
        [$plain, $bold] = stripInline($joined);
        if ($plain === '') {
            return;
        }
        $blocks[] = ['type' => 'p', 'text' => $plain, 'bold' => $bold];
    };

    while ($i < $n) {
        $line = $lines[$i];
        $trim = trim($line);

        if ($trim === '' || $trim === '---' || $trim === '***') {
            $flushPara();
            $i++;
            continue;
        }

        // Heading
        if (preg_match('/^(#{1,3})\s+(.+)$/u', $trim, $hm)) {
            $flushPara();
            $level = strlen($hm[1]);
            [$plain, $bold] = stripInline($hm[2]);
            $style = match ($level) {
                1 => 'HEADING_1',
                2 => 'HEADING_2',
                default => 'HEADING_3',
            };
            $blocks[] = ['type' => 'h', 'text' => $plain, 'style' => $style, 'bold' => $bold];
            $i++;
            continue;
        }

        // Table
        if (str_starts_with($trim, '|')) {
            $flushPara();
            $tableRows = [];
            while ($i < $n && str_starts_with(trim($lines[$i]), '|')) {
                $tableRows[] = trim($lines[$i]);
                $i++;
            }
            foreach (tableToBlocks($tableRows) as $tb) {
                $blocks[] = $tb;
            }
            continue;
        }

        // Checklist — plain lines with ☐ (avoid double marker with Docs bullets)
        if (preg_match('/^[-*]\s+\[([ xX])\]\s+(.+)$/u', $trim, $cm)) {
            $flushPara();
            $mark = strtolower($cm[1]) === 'x' ? '☑' : '☐';
            [$plain, $bold] = stripInline($mark . ' ' . $cm[2]);
            $blocks[] = ['type' => 'check', 'text' => $plain, 'bold' => $bold];
            $i++;
            continue;
        }
        if (preg_match('/^[-*]\s+(.+)$/u', $trim, $bm)) {
            $flushPara();
            [$plain, $bold] = stripInline($bm[1]);
            $blocks[] = ['type' => 'bullet', 'text' => $plain, 'bold' => $bold];
            $i++;
            continue;
        }

        // Numbered
        if (preg_match('/^(\d+)\.\s+(.+)$/u', $trim, $nm)) {
            $flushPara();
            [$plain, $bold] = stripInline($nm[2]);
            $blocks[] = ['type' => 'number', 'text' => $plain, 'bold' => $bold];
            $i++;
            continue;
        }

        // Bold-only subhead like **A. UI-kit…**
        if (preg_match('/^\*\*(.+)\*\*\s*$/u', $trim, $shm)) {
            $flushPara();
            [$plain, $bold] = stripInline($shm[1]);
            $blocks[] = ['type' => 'h', 'text' => $plain, 'style' => 'HEADING_3', 'bold' => $bold];
            $i++;
            continue;
        }

        // Meta / labeled lines (**Проект:** …) — keep as own paragraph
        if (preg_match('/^\*\*[^*]+:\*\*/u', $trim)) {
            $flushPara();
            [$plain, $bold] = stripInline($trim);
            $blocks[] = ['type' => 'p', 'text' => $plain, 'bold' => $bold];
            $i++;
            continue;
        }

        $paraBuf[] = $trim;
        $i++;
    }
    $flushPara();
    return $blocks;
}

/**
 * Build TOC from H2 headings, prepend after title/intro meta.
 *
 * @param list<array{type:string,text?:string,style?:string}> $blocks
 * @return list<array>
 */
function injectToc(array $blocks): array
{
    $tocTitles = [];
    foreach ($blocks as $b) {
        if (($b['type'] ?? '') === 'h' && ($b['style'] ?? '') === 'HEADING_2' && !empty($b['text'])) {
            $tocTitles[] = $b['text'];
        }
    }
    if ($tocTitles === []) {
        return $blocks;
    }

    // Insert TOC after first HEADING_1 + following meta paragraphs (until next heading)
    $out = [];
    $inserted = false;
    $afterTitle = false;
    foreach ($blocks as $idx => $b) {
        $out[] = $b;
        if (!$inserted && ($b['type'] ?? '') === 'h' && ($b['style'] ?? '') === 'HEADING_1') {
            $afterTitle = true;
            continue;
        }
        if ($afterTitle && !$inserted) {
            $next = $blocks[$idx + 1] ?? null;
            $nextIsH = $next && ($next['type'] ?? '') === 'h';
            // After meta lines (p) that follow title, before first H2 — or right before next h
            if ($nextIsH) {
                $out[] = ['type' => 'h', 'text' => 'Оглавление', 'style' => 'HEADING_2', 'bold' => []];
                foreach ($tocTitles as $t) {
                    // Prefix so TOC lines are not confused with real H2 titles when scanning
                    $out[] = ['type' => 'bullet', 'text' => $t, 'bold' => [], 'toc' => true];
                }
                $inserted = true;
            }
        }
    }
    // Remove empty paragraphs
    return array_values(array_filter($out, static function ($b) {
        if (($b['type'] ?? '') === 'p' && trim((string) ($b['text'] ?? '')) === '') {
            return false;
        }
        return true;
    }));
}

/**
 * Assemble plain text + style plan from blocks.
 * Ranges are 0-based UTF-16 offsets into returned text; Docs index = 1 + offset.
 * No post-hoc collapse — spacing is built once so ranges stay exact.
 *
 * @param list<array> $blocks
 * @return array{text:string, headings:list<array{start:int,end:int,style:string}>, bullets:list<array{start:int,end:int}>, numbers:list<array{start:int,end:int}>, normals:list<array{start:int,end:int}>, bold:list<array{start:int,end:int}>}
 */
function assemble(array $blocks): array
{
    $text = '';
    $headings = [];
    $bullets = [];
    $numbers = [];
    $normals = [];
    $bold = [];
    $bulletRunStart = null;
    $bulletRunEnd = null;
    $numberRunStart = null;
    $numberRunEnd = null;

    $flushBulletRun = static function () use (&$bulletRunStart, &$bulletRunEnd, &$bullets): void {
        if ($bulletRunStart !== null && $bulletRunEnd !== null && $bulletRunEnd > $bulletRunStart) {
            $bullets[] = ['start' => $bulletRunStart, 'end' => $bulletRunEnd];
        }
        $bulletRunStart = null;
        $bulletRunEnd = null;
    };
    $flushNumberRun = static function () use (&$numberRunStart, &$numberRunEnd, &$numbers): void {
        if ($numberRunStart !== null && $numberRunEnd !== null && $numberRunEnd > $numberRunStart) {
            $numbers[] = ['start' => $numberRunStart, 'end' => $numberRunEnd];
        }
        $numberRunStart = null;
        $numberRunEnd = null;
    };

    $nBlocks = count($blocks);
    for ($i = 0; $i < $nBlocks; $i++) {
        $b = $blocks[$i];
        $type = $b['type'] ?? 'p';
        $line = (string) ($b['text'] ?? '');
        $para = $line . "\n";
        $start = docsLen($text);
        $end = $start + docsLen($para);
        $nextType = $blocks[$i + 1]['type'] ?? null;

        foreach ($b['bold'] ?? [] as [$bs, $be]) {
            if ($be > $bs) {
                $bold[] = ['start' => $start + $bs, 'end' => $start + $be];
            }
        }

        if ($type === 'h') {
            $flushBulletRun();
            $flushNumberRun();
            $headings[] = ['start' => $start, 'end' => $end, 'style' => $b['style'] ?? 'HEADING_2'];
            $text .= $para;
            // blank line after heading (breathing room)
            $text .= "\n";
            continue;
        }

        if ($type === 'bullet') {
            $flushNumberRun();
            if ($bulletRunStart === null) {
                $bulletRunStart = $start;
            }
            $bulletRunEnd = $end;
            $text .= $para;
            if ($nextType !== 'bullet') {
                $flushBulletRun();
                $text .= "\n";
            }
            continue;
        }

        if ($type === 'check') {
            $flushBulletRun();
            $flushNumberRun();
            $normals[] = ['start' => $start, 'end' => $end];
            $text .= $para;
            if ($nextType !== 'check') {
                $text .= "\n";
            }
            continue;
        }

        if ($type === 'number') {
            $flushBulletRun();
            if ($numberRunStart === null) {
                $numberRunStart = $start;
            }
            $numberRunEnd = $end;
            $text .= $para;
            if ($nextType !== 'number') {
                $flushNumberRun();
                $text .= "\n";
            }
            continue;
        }

        // paragraph
        $flushBulletRun();
        $flushNumberRun();
        $normals[] = ['start' => $start, 'end' => $end];
        $text .= $para . "\n";
    }
    $flushBulletRun();
    $flushNumberRun();

    if ($text === '' || !str_ends_with($text, "\n")) {
        $text .= "\n";
    }

    return [
        'text' => $text,
        'headings' => $headings,
        'bullets' => $bullets,
        'numbers' => $numbers,
        'normals' => $normals,
        'bold' => $bold,
    ];
}

/* ── parse & assemble ────────────────────────────────────────────────── */

$blocks = parseMarkdown($md);
$blocks = injectToc($blocks);
$docBody = assemble($blocks);
$bodyText = $docBody['text'];

echo 'Blocks: ' . count($blocks) . "\n";
echo 'Text UTF-16 len: ' . docsLen($bodyText) . "\n";
echo 'Headings: ' . count($docBody['headings']) . ', bullet runs: ' . count($docBody['bullets'])
    . ', number runs: ' . count($docBody['numbers']) . ', bold spans: ' . count($docBody['bold']) . "\n";

/* ── auth ────────────────────────────────────────────────────────────── */

$client = new Google_Client();
$client->setApplicationName($appName);
$client->setAuthConfig($credPath);
$client->setScopes([
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive',
]);
$client->fetchAccessTokenWithAssertion();
$token = $client->getAccessToken()['access_token'] ?? '';
if ($token === '') {
    fwrite(STDERR, "No token\n");
    exit(1);
}

/* ── find / create tab ───────────────────────────────────────────────── */

$getUrl = 'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . '?includeTabsContent=true';
$get = ghttp('GET', $getUrl, $token);
if ($get['code'] !== 200) {
    fwrite(STDERR, "GET failed {$get['code']}\n{$get['raw']}\n");
    exit(1);
}

$tabs = $get['json']['tabs'] ?? [];
$targetTabId = null;
$aliasMatchId = null;
foreach ($tabs as $tab) {
    $title = (string) ($tab['tabProperties']['title'] ?? '');
    $id = (string) ($tab['tabProperties']['tabId'] ?? '');
    echo "tab [$id] $title\n";
    if ($id === $preferredTabId) {
        $targetTabId = $id;
    }
    if ($title === $tabTitle && $aliasMatchId === null) {
        $aliasMatchId = $id;
    }
    foreach ($tabTitleAliases as $alias) {
        if ($alias !== '' && str_contains($title, (string) $alias) && $aliasMatchId === null) {
            $aliasMatchId = $id;
            break;
        }
    }
}
if ($targetTabId === null) {
    $targetTabId = $aliasMatchId;
}

if ($targetTabId === null) {
    $create = ghttp(
        'POST',
        'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . ':batchUpdate',
        $token,
        [
            'requests' => [
                [
                    'addDocumentTab' => [
                        'tabProperties' => ['title' => $tabTitle],
                    ],
                ],
            ],
        ]
    );
    if ($create['code'] !== 200) {
        fwrite(STDERR, "create tab failed {$create['code']}\n{$create['raw']}\n");
        exit(1);
    }
    foreach ($create['json']['replies'] ?? [] as $r) {
        if (!empty($r['addDocumentTab']['tabProperties']['tabId'])) {
            $targetTabId = (string) $r['addDocumentTab']['tabProperties']['tabId'];
        }
    }
    echo "Created tab $targetTabId\n";
    $get = ghttp('GET', $getUrl, $token);
    $tabs = $get['json']['tabs'] ?? [];
}

$useTab = null;
foreach ($tabs as $tab) {
    if ((string) ($tab['tabProperties']['tabId'] ?? '') === $targetTabId) {
        $useTab = $tab;
        break;
    }
}
if (!$useTab) {
    fwrite(STDERR, "Tab not found\n");
    exit(1);
}

$endIndex = 1;
foreach ($useTab['documentTab']['body']['content'] ?? [] as $el) {
    if (isset($el['endIndex'])) {
        $endIndex = max($endIndex, (int) $el['endIndex']);
    }
}

/* ── batch 1: clear + insert plain text ──────────────────────────────── */

$requests = [];
if ($endIndex > 2) {
    $requests[] = [
        'deleteContentRange' => [
            'range' => [
                'startIndex' => 1,
                'endIndex' => $endIndex - 1,
                'tabId' => $targetTabId,
            ],
        ],
    ];
}
$requests[] = [
    'insertText' => [
        'location' => [
            'index' => 1,
            'tabId' => $targetTabId,
        ],
        'text' => $bodyText,
    ],
];

$upd = ghttp(
    'POST',
    'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . ':batchUpdate',
    $token,
    ['requests' => $requests]
);
if ($upd['code'] !== 200) {
    fwrite(STDERR, "insert failed {$upd['code']}\n{$upd['raw']}\n");
    exit(1);
}
echo "Inserted plain text\n";

/* ── Styles from assemble ranges (Docs index = 1 + UTF-16 offset) ───── */

$styleReqs = [];
foreach ($docBody['headings'] as $h) {
    $styleReqs[] = [
        'updateParagraphStyle' => [
            'range' => [
                'startIndex' => 1 + $h['start'],
                'endIndex' => 1 + $h['end'],
                'tabId' => $targetTabId,
            ],
            'paragraphStyle' => [
                'namedStyleType' => $h['style'],
                'spaceAbove' => ['magnitude' => 12, 'unit' => 'PT'],
                'spaceBelow' => ['magnitude' => 6, 'unit' => 'PT'],
            ],
            'fields' => 'namedStyleType,spaceAbove,spaceBelow',
        ],
    ];
}
foreach ($docBody['normals'] as $n) {
    $styleReqs[] = [
        'updateParagraphStyle' => [
            'range' => [
                'startIndex' => 1 + $n['start'],
                'endIndex' => 1 + $n['end'],
                'tabId' => $targetTabId,
            ],
            'paragraphStyle' => [
                'namedStyleType' => 'NORMAL_TEXT',
                'spaceBelow' => ['magnitude' => 6, 'unit' => 'PT'],
            ],
            'fields' => 'namedStyleType,spaceBelow',
        ],
    ];
}
foreach ($docBody['bullets'] as $r) {
    $styleReqs[] = [
        'createParagraphBullets' => [
            'range' => [
                'startIndex' => 1 + $r['start'],
                'endIndex' => 1 + $r['end'],
                'tabId' => $targetTabId,
            ],
            'bulletPreset' => 'BULLET_DISC_CIRCLE_SQUARE',
        ],
    ];
}
foreach ($docBody['numbers'] as $r) {
    $styleReqs[] = [
        'createParagraphBullets' => [
            'range' => [
                'startIndex' => 1 + $r['start'],
                'endIndex' => 1 + $r['end'],
                'tabId' => $targetTabId,
            ],
            'bulletPreset' => 'NUMBERED_DECIMAL_ALPHA_ROMAN',
        ],
    ];
}
foreach ($docBody['bold'] as $r) {
    $styleReqs[] = [
        'updateTextStyle' => [
            'range' => [
                'startIndex' => 1 + $r['start'],
                'endIndex' => 1 + $r['end'],
                'tabId' => $targetTabId,
            ],
            'textStyle' => ['bold' => true],
            'fields' => 'bold',
        ],
    ];
}

$allStyle = $styleReqs;

// Docs API batchUpdate limit ~500 requests; chunk if needed
$chunks = array_chunk($allStyle, 400);
foreach ($chunks as $ci => $chunk) {
    if ($chunk === []) {
        continue;
    }
    $upd2 = ghttp(
        'POST',
        'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . ':batchUpdate',
        $token,
        ['requests' => $chunk]
    );
    if ($upd2['code'] !== 200) {
        fwrite(STDERR, "style batch {$ci} failed {$upd2['code']}\n{$upd2['raw']}\n");
        exit(1);
    }
    echo 'Style batch ' . $ci . ' OK (' . count($chunk) . " reqs)\n";
}

/* ── verify structure ────────────────────────────────────────────────── */

$verify = ghttp('GET', $getUrl, $token);
$vTab = null;
foreach ($verify['json']['tabs'] ?? [] as $tab) {
    if ((string) ($tab['tabProperties']['tabId'] ?? '') === $targetTabId) {
        $vTab = $tab;
        break;
    }
}

$h1 = $h2 = $h3 = $bulletParas = $numberedParas = 0;
$contentPreview = [];
foreach ($vTab['documentTab']['body']['content'] ?? [] as $el) {
    $p = $el['paragraph'] ?? null;
    if (!$p) {
        continue;
    }
    $ns = (string) ($p['paragraphStyle']['namedStyleType'] ?? 'NORMAL_TEXT');
    if ($ns === 'HEADING_1') {
        $h1++;
    } elseif ($ns === 'HEADING_2') {
        $h2++;
    } elseif ($ns === 'HEADING_3') {
        $h3++;
    }
    if (!empty($p['bullet'])) {
        $nest = (int) ($p['bullet']['nestingLevel'] ?? 0);
        // Detect numbered vs bullet via list properties is hard; count all
        $bulletParas++;
        $listed = true;
    } else {
        $listed = false;
    }
    $t = '';
    foreach ($p['elements'] ?? [] as $e) {
        $t .= (string) ($e['textRun']['content'] ?? '');
    }
    $t = trim(str_replace("\n", '', $t));
    if ($t !== '' && count($contentPreview) < 20) {
        $contentPreview[] = ($listed ? '[•] ' : '') . "[{$ns}] " . mb_substr($t, 0, 90, 'UTF-8');
    }
}

echo "OK\n";
echo "Tab id: {$targetTabId}\n";
echo "Headings H1={$h1} H2={$h2} H3={$h3}; list paragraphs={$bulletParas}\n";
echo "Preview:\n";
foreach ($contentPreview as $line) {
    echo "  $line\n";
}
echo "https://docs.google.com/document/d/{$docId}/edit?tab={$targetTabId}\n";
