<?php
/**
 * Редактор шаблонов СТО в Google Doc с макросами {{…}}.
 *
 * Один Google Doc → вкладки (00 · Макросы + бланки 01…15).
 * Канон печати: api/assets/sto-templates/txt/*.txt
 *
 * Usage:
 *   php tools/sto_templates_gdoc.php status
 *   php tools/sto_templates_gdoc.php push  [--doc=ID] [--id=sto-contract-person]
 *   php tools/sto_templates_gdoc.php pull  [--doc=ID] [--id=sto-contract-person] [--dry-run]
 *   php tools/sto_templates_gdoc.php bind  --doc=ID   # записать id в манифест
 *
 * Env:
 *   STO_TEMPLATES_GDOC_ID   — id Google Doc (если нет в манифесте)
 *   GOOGLE_SA_JSON
 *   GOOGLE_PHP_AUTOLOAD
 *
 * Первый запуск:
 *   1) В Drive-папке «Шаблоны» создайте пустой Doc: «Шаблоны СТО · редактор»
 *   2) Расшарьте на SA редактором: pnevmopodveska1-bank@pnevmopodveska1.iam.gserviceaccount.com
 *   3) php tools/sto_templates_gdoc.php bind --doc=ID_ИЗ_URL
 *   4) php tools/sto_templates_gdoc.php push
 *   5) Правите макросы в Doc → php tools/sto_templates_gdoc.php pull
 */
declare(strict_types=1);

$root = dirname(__DIR__);
$credPath = getenv('GOOGLE_SA_JSON')
    ?: '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = getenv('GOOGLE_PHP_AUTOLOAD')
    ?: '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$txtDir = $root . '/api/assets/sto-templates/txt';
$macrosPath = $root . '/docs/sto-templates/MACROS.txt';
$manifestPath = $root . '/docs/sto-templates/gdrive-sto-edit.json';

/** @var list<array{id:string,code:string,title:string,txt:string}> */
$TEMPLATES = [
    ['id' => 'sto-cheat-sheet', 'code' => '00', 'title' => 'Шпаргалка', 'txt' => '00-cheat-sheet.txt'],
    ['id' => 'sto-how-apply', 'code' => '00б', 'title' => 'Как применять', 'txt' => '00-how-apply.txt'],
    ['id' => 'sto-contract-person', 'code' => '01', 'title' => 'Договор физлицо', 'txt' => '01-contract-person.txt'],
    ['id' => 'sto-contract-legal', 'code' => '02', 'title' => 'Договор юр/ИП', 'txt' => '02-contract-legal.txt'],
    ['id' => 'sto-workorder', 'code' => '03', 'title' => 'ЗН общий', 'txt' => '03-workorder.txt'],
    ['id' => 'sto-workorder-person', 'code' => '03ф', 'title' => 'ЗН физлицо', 'txt' => '03-workorder-person.txt'],
    ['id' => 'sto-workorder-legal', 'code' => '03ю', 'title' => 'ЗН юр/ИП', 'txt' => '03-workorder-legal.txt'],
    ['id' => 'sto-acceptance-in', 'code' => '04', 'title' => 'Акт приёма', 'txt' => '04-acceptance-in.txt'],
    ['id' => 'sto-inspection', 'code' => '05', 'title' => 'Акт осмотра', 'txt' => '05-inspection.txt'],
    ['id' => 'sto-extra-works', 'code' => '06', 'title' => 'Доп. работы', 'txt' => '06-extra-works.txt'],
    ['id' => 'sto-parts-from-client', 'code' => '07', 'title' => 'ЗЧ заказчика', 'txt' => '07-parts-from-client.txt'],
    ['id' => 'sto-works-done', 'code' => '08', 'title' => 'Акт сдачи', 'txt' => '08-works-done.txt'],
    ['id' => 'sto-warranty', 'code' => '09', 'title' => 'Гарантия', 'txt' => '09-warranty.txt'],
    ['id' => 'sto-no-show', 'code' => '10', 'title' => 'Неявка', 'txt' => '10-no-show.txt'],
    ['id' => 'sto-pdn-consent', 'code' => '11', 'title' => 'Согласие ПДн', 'txt' => '11-pdn-consent.txt'],
    ['id' => 'sto-legal-note', 'code' => '12', 'title' => 'Правовая справка', 'txt' => '12-legal-note.txt'],
    ['id' => 'sto-order', 'code' => '13', 'title' => 'Приказ', 'txt' => '13-order.txt'],
    ['id' => 'sto-reception-reglament', 'code' => '14', 'title' => 'Регламент', 'txt' => '14-reception-reglament.txt'],
    ['id' => 'sto-checklist', 'code' => '15', 'title' => 'Чек-лист', 'txt' => '15-checklist.txt'],
];

$KNOWN_MACROS = [
    '{{Покупатель}}', '{{ФИО}}', '{{Телефон}}', '{{Email}}', '{{ИНН}}', '{{КПП}}', '{{ОГРН}}',
    '{{Адрес}}', '{{ВЛице}}', '{{Банк}}', '{{БИК}}', '{{РС}}', '{{КС}}', '{{ДокументЗаказчика}}',
    '{{Организация}}', '{{ИННОрганизации}}', '{{КППОрганизации}}', '{{ОГРНОрганизации}}',
    '{{АдресОрганизации}}', '{{ТелефонОрганизации}}', '{{Директор}}', '{{РСОрганизации}}', '{{БанкОрганизации}}',
    '{{Номер}}', '{{НомерДоговора}}', '{{НомерЗаказа}}', '{{Дата}}', '{{ДатаДлинная}}', '{{ДатаДоговора}}',
    '{{Время}}', '{{Город}}', '{{Сумма}}', '{{СуммаПрописью}}',
    '{{Госномер}}', '{{VIN}}', '{{Марка}}', '{{Модель}}', '{{Год}}', '{{Цвет}}', '{{Пробег}}',
    '{{ДокументНаАвто}}', '{{НомерДвигателя}}', '{{УровеньТоплива}}',
    '{{Филиал}}', '{{СТО}}', '{{Канал}}', '{{СпособОтправки}}', '{{Неисправности}}', '{{Сотрудник}}',
    '{{СрокНачала}}', '{{СрокОкончания}}', '{{ГарантияРаботы}}', '{{ГарантияЗЧ}}',
];

/* ── argv ─────────────────────────────────────────────────────────────── */

$cmd = $argv[1] ?? 'status';
$onlyId = null;
$docIdArg = null;
$dryRun = false;
foreach (array_slice($argv, 2) as $a) {
    if ($a === '--dry-run') {
        $dryRun = true;
        continue;
    }
    if (str_starts_with($a, '--id=')) {
        $onlyId = substr($a, 5);
        continue;
    }
    if (str_starts_with($a, '--doc=')) {
        $docIdArg = substr($a, 6);
        continue;
    }
}

function loadManifest(string $path): array
{
    if (!is_file($path)) {
        return [
            'google_doc_id' => '',
            'google_doc_url' => '',
            'folder_url' => 'https://drive.google.com/drive/folders/1jjmTeuMnTxH5V9I-WPSR97m43nMFBsY1',
            'updated_at' => '',
            'tabs' => [],
        ];
    }
    $j = json_decode((string) file_get_contents($path), true);
    return is_array($j) ? $j : [];
}

function saveManifest(string $path, array $man): void
{
    $man['updated_at'] = gmdate('c');
    @mkdir(dirname($path), 0775, true);
    file_put_contents($path, json_encode($man, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n");
}

function tabTitleFor(array $t): string
{
    return $t['code'] . ' · ' . $t['title'];
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
    $err = curl_error($ch);
    curl_close($ch);
    if ($resp === false) {
        return ['code' => 0, 'error' => $err, 'json' => null, 'raw' => ''];
    }
    return ['code' => $code, 'error' => '', 'json' => json_decode($resp, true), 'raw' => $resp];
}

function extractTabPlainText(array $tab): string
{
    $out = '';
    $body = $tab['documentTab']['body']['content'] ?? [];
    foreach ($body as $el) {
        if (empty($el['paragraph']['elements'])) {
            continue;
        }
        foreach ($el['paragraph']['elements'] as $run) {
            if (isset($run['textRun']['content'])) {
                $out .= (string) $run['textRun']['content'];
            }
        }
    }
    // Docs всегда держит завершающий \n сегмента — нормализуем
    $out = str_replace(["\r\n", "\r"], "\n", $out);
    return rtrim($out, "\n") . "\n";
}

function findTabIdByTitle(array $tabs, string $wantTitle): ?string
{
    foreach ($tabs as $tab) {
        $title = (string) ($tab['tabProperties']['title'] ?? '');
        $id = (string) ($tab['tabProperties']['tabId'] ?? '');
        if ($title === $wantTitle) {
            return $id;
        }
    }
    // мягкое: начинается с «01 ·» / «код ·»
    foreach ($tabs as $tab) {
        $title = (string) ($tab['tabProperties']['title'] ?? '');
        $id = (string) ($tab['tabProperties']['tabId'] ?? '');
        if (str_starts_with($title, explode(' · ', $wantTitle)[0] . ' ·')) {
            return $id;
        }
    }
    return null;
}

function ensureTab(string $token, string $docId, string $title, array &$tabs): string
{
    $existing = findTabIdByTitle($tabs, $title);
    if ($existing) {
        return $existing;
    }
    $create = ghttp(
        'POST',
        'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . ':batchUpdate',
        $token,
        [
            'requests' => [
                [
                    'addDocumentTab' => [
                        'tabProperties' => ['title' => $title],
                    ],
                ],
            ],
        ]
    );
    if ($create['code'] !== 200) {
        fwrite(STDERR, "create tab «{$title}» failed HTTP {$create['code']}\n{$create['raw']}\n");
        exit(1);
    }
    $newId = null;
    foreach ($create['json']['replies'] ?? [] as $r) {
        if (!empty($r['addDocumentTab']['tabProperties']['tabId'])) {
            $newId = (string) $r['addDocumentTab']['tabProperties']['tabId'];
        }
    }
    if (!$newId) {
        fwrite(STDERR, "create tab «{$title}»: no tabId in reply\n");
        exit(1);
    }
    echo "  + tab [{$newId}] {$title}\n";
    $get = ghttp(
        'GET',
        'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . '?includeTabsContent=true',
        $token
    );
    $tabs = $get['json']['tabs'] ?? [];
    return $newId;
}

function tabEndIndex(array $tab): int
{
    $end = 1;
    foreach ($tab['documentTab']['body']['content'] ?? [] as $el) {
        if (isset($el['endIndex'])) {
            $end = max($end, (int) $el['endIndex']);
        }
    }
    return $end;
}

function pushPlainText(string $token, string $docId, string $tabId, array $tab, string $text): void
{
    if ($text === '' || !str_ends_with($text, "\n")) {
        $text .= "\n";
    }
    $endIndex = tabEndIndex($tab);
    $requests = [];
    if ($endIndex > 2) {
        $requests[] = [
            'deleteContentRange' => [
                'range' => [
                    'startIndex' => 1,
                    'endIndex' => $endIndex - 1,
                    'tabId' => $tabId,
                ],
            ],
        ];
    }
    $requests[] = [
        'insertText' => [
            'location' => ['index' => 1, 'tabId' => $tabId],
            'text' => $text,
        ],
    ];
    $upd = ghttp(
        'POST',
        'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . ':batchUpdate',
        $token,
        ['requests' => $requests]
    );
    if ($upd['code'] !== 200) {
        fwrite(STDERR, "push tab {$tabId} failed HTTP {$upd['code']}\n{$upd['raw']}\n");
        exit(1);
    }
}

function warnUnknownMacros(string $text, array $known): void
{
    if (!preg_match_all('/\{\{[^}]+\}\}/u', $text, $m)) {
        return;
    }
    $unknown = [];
    foreach (array_unique($m[0]) as $mac) {
        if (!in_array($mac, $known, true)) {
            $unknown[] = $mac;
        }
    }
    if ($unknown) {
        fwrite(STDERR, '  ⚠ неизвестные макросы: ' . implode(', ', $unknown) . "\n");
    }
}

function resolveDocId(array $man, ?string $docIdArg): string
{
    $id = trim((string) ($docIdArg ?: getenv('STO_TEMPLATES_GDOC_ID') ?: ($man['google_doc_id'] ?? '')));
    if ($id === '') {
        fwrite(STDERR, "Нет google_doc_id.\n");
        fwrite(STDERR, "Создайте Doc в папке «Шаблоны», расшарьте на SA, затем:\n");
        fwrite(STDERR, "  php tools/sto_templates_gdoc.php bind --doc=ID\n");
        fwrite(STDERR, "Папка: https://drive.google.com/drive/folders/1jjmTeuMnTxH5V9I-WPSR97m43nMFBsY1\n");
        exit(1);
    }
    return $id;
}

function authToken(string $autoload, string $credPath): string
{
    if (!is_file($autoload)) {
        fwrite(STDERR, "autoload not found: {$autoload}\n");
        exit(1);
    }
    if (!is_file($credPath)) {
        fwrite(STDERR, "SA json not found: {$credPath}\n");
        exit(1);
    }
    require $autoload;
    $client = new Google_Client();
    $client->setApplicationName('Uchet1 STO templates gdoc');
    $client->setAuthConfig($credPath);
    $client->setScopes([
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/drive',
    ]);
    $client->fetchAccessTokenWithAssertion();
    $token = $client->getAccessToken()['access_token'] ?? '';
    if ($token === '') {
        fwrite(STDERR, "No access token\n");
        exit(1);
    }
    return $token;
}

/* ── commands ─────────────────────────────────────────────────────────── */

$man = loadManifest($manifestPath);

if ($cmd === 'bind') {
    $docId = resolveDocId($man, $docIdArg);
    $man['google_doc_id'] = $docId;
    $man['google_doc_url'] = 'https://docs.google.com/document/d/' . $docId . '/edit';
    saveManifest($manifestPath, $man);
    echo "Bound: {$man['google_doc_url']}\n";
    echo "Manifest: {$manifestPath}\n";
    echo "Next: php tools/sto_templates_gdoc.php push\n";
    exit(0);
}

if ($cmd === 'status') {
    $docId = trim((string) ($docIdArg ?: getenv('STO_TEMPLATES_GDOC_ID') ?: ($man['google_doc_id'] ?? '')));
    echo "Manifest: {$manifestPath}\n";
    echo 'Doc ID: ' . ($docId !== '' ? $docId : '(не задан)') . "\n";
    if (!empty($man['google_doc_url'])) {
        echo 'URL: ' . $man['google_doc_url'] . "\n";
    }
    echo 'Folder: ' . ($man['folder_url'] ?? '') . "\n";
    echo 'TXT dir: ' . $txtDir . "\n";
    echo 'Templates: ' . count($TEMPLATES) . "\n";
    foreach ($TEMPLATES as $t) {
        $p = $txtDir . '/' . $t['txt'];
        $ok = is_file($p) ? (string) filesize($p) . ' B' : 'MISSING';
        $tab = $man['tabs'][$t['id']]['tab_id'] ?? '-';
        echo sprintf("  %-28s %-22s txt=%-6s tab=%s\n", $t['id'], tabTitleFor($t), $ok, $tab);
    }
    if ($docId === '') {
        echo "\nЧтобы начать:\n";
        echo "  1) Создайте Google Doc в папке Шаблоны\n";
        echo "  2) php tools/sto_templates_gdoc.php bind --doc=ID\n";
        echo "  3) php tools/sto_templates_gdoc.php push\n";
    }
    exit(0);
}

if ($cmd !== 'push' && $cmd !== 'pull') {
    fwrite(STDERR, "Unknown command: {$cmd}\n");
    fwrite(STDERR, "Use: status | bind | push | pull\n");
    exit(1);
}

$docId = resolveDocId($man, $docIdArg);
$token = authToken($autoload, $credPath);

$getUrl = 'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . '?includeTabsContent=true';
$get = ghttp('GET', $getUrl, $token);
if ($get['code'] !== 200) {
    fwrite(STDERR, "GET doc failed HTTP {$get['code']}\n{$get['raw']}\n");
    fwrite(STDERR, "Проверьте: Doc существует и расшарен на SA как редактор.\n");
    exit(1);
}

$tabs = $get['json']['tabs'] ?? [];
$docTitle = (string) ($get['json']['title'] ?? '');
echo "Doc: {$docTitle}\nID: {$docId}\nURL: https://docs.google.com/document/d/{$docId}/edit\n\n";

$man['google_doc_id'] = $docId;
$man['google_doc_url'] = 'https://docs.google.com/document/d/' . $docId . '/edit';
if (!isset($man['tabs']) || !is_array($man['tabs'])) {
    $man['tabs'] = [];
}

if ($cmd === 'push') {
    // вкладка макросов
    $macrosTitle = '00 · Макросы';
    $macrosTabId = ensureTab($token, $docId, $macrosTitle, $tabs);
    $macrosBody = is_file($macrosPath)
        ? (string) file_get_contents($macrosPath)
        : "Список макросов: см. docs/sto-templates/MACROS.txt\n";
    $useTab = null;
    foreach ($tabs as $tab) {
        if ((string) ($tab['tabProperties']['tabId'] ?? '') === $macrosTabId) {
            $useTab = $tab;
            break;
        }
    }
    if ($useTab) {
        echo "Push macros → {$macrosTitle}\n";
        pushPlainText($token, $docId, $macrosTabId, $useTab, $macrosBody);
        $man['tabs']['macros'] = ['tab_id' => $macrosTabId, 'title' => $macrosTitle];
    }

    // обновить tabs после правок
    $get = ghttp('GET', $getUrl, $token);
    $tabs = $get['json']['tabs'] ?? [];

    foreach ($TEMPLATES as $t) {
        if ($onlyId && $onlyId !== $t['id']) {
            continue;
        }
        $path = $txtDir . '/' . $t['txt'];
        if (!is_file($path)) {
            fwrite(STDERR, "skip missing {$path}\n");
            continue;
        }
        $title = tabTitleFor($t);
        $tabId = ensureTab($token, $docId, $title, $tabs);
        $useTab = null;
        foreach ($tabs as $tab) {
            if ((string) ($tab['tabProperties']['tabId'] ?? '') === $tabId) {
                $useTab = $tab;
                break;
            }
        }
        if (!$useTab) {
            fwrite(STDERR, "tab missing after ensure: {$title}\n");
            continue;
        }
        $body = (string) file_get_contents($path);
        warnUnknownMacros($body, $KNOWN_MACROS);
        echo "Push {$t['id']} → {$title}\n";
        pushPlainText($token, $docId, $tabId, $useTab, $body);
        $man['tabs'][$t['id']] = [
            'tab_id' => $tabId,
            'title' => $title,
            'txt' => $t['txt'],
        ];
        // refresh tabs after each write (endIndex changes)
        $get = ghttp('GET', $getUrl, $token);
        $tabs = $get['json']['tabs'] ?? [];
    }
    saveManifest($manifestPath, $man);
    echo "\nOK push. Правите в Doc, затем: php tools/sto_templates_gdoc.php pull\n";
    echo $man['google_doc_url'] . "\n";
    exit(0);
}

// pull
$pulled = 0;
foreach ($TEMPLATES as $t) {
    if ($onlyId && $onlyId !== $t['id']) {
        continue;
    }
    $title = tabTitleFor($t);
    $tabId = $man['tabs'][$t['id']]['tab_id'] ?? null;
    if (!$tabId) {
        $tabId = findTabIdByTitle($tabs, $title);
    }
    if (!$tabId) {
        fwrite(STDERR, "нет вкладки для {$t['id']} («{$title}») — сначала push\n");
        continue;
    }
    $useTab = null;
    foreach ($tabs as $tab) {
        if ((string) ($tab['tabProperties']['tabId'] ?? '') === $tabId) {
            $useTab = $tab;
            break;
        }
    }
    if (!$useTab) {
        fwrite(STDERR, "tab {$tabId} not in doc\n");
        continue;
    }
    $text = extractTabPlainText($useTab);
    // убрать возможный заголовок-дубль, если кто-то вставил название в первую строку = title
    warnUnknownMacros($text, $KNOWN_MACROS);
    $path = $txtDir . '/' . $t['txt'];
    if ($dryRun) {
        echo "[dry-run] {$t['id']} → {$path} (" . strlen($text) . " bytes)\n";
        echo "  preview: " . str_replace("\n", '↵', mb_substr($text, 0, 80)) . "\n";
        continue;
    }
    // бэкап
    if (is_file($path)) {
        $bakDir = $root . '/api/assets/sto-templates/_backup-gdoc-' . gmdate('Ymd');
        @mkdir($bakDir, 0775, true);
        @copy($path, $bakDir . '/' . $t['txt']);
    }
    file_put_contents($path, $text);
    $man['tabs'][$t['id']] = [
        'tab_id' => $tabId,
        'title' => (string) ($useTab['tabProperties']['title'] ?? $title),
        'txt' => $t['txt'],
        'pulled_at' => gmdate('c'),
    ];
    echo "Pull {$t['id']} ← {$title} (" . strlen($text) . " B)\n";
    $pulled++;
}

// macros tab → MACROS.txt (optional)
$macrosTabId = $man['tabs']['macros']['tab_id'] ?? findTabIdByTitle($tabs, '00 · Макросы');
if ($macrosTabId && !$onlyId) {
    foreach ($tabs as $tab) {
        if ((string) ($tab['tabProperties']['tabId'] ?? '') === $macrosTabId) {
            $text = extractTabPlainText($tab);
            if (!$dryRun && strlen(trim($text)) > 40) {
                file_put_contents($macrosPath, $text);
                echo "Pull macros → MACROS.txt\n";
            }
            break;
        }
    }
}

if (!$dryRun) {
    saveManifest($manifestPath, $man);
}
echo "\nOK pull: {$pulled} шаблон(ов). TXT → печать PDF после деплоя.\n";
exit(0);
