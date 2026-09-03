<?php
/**
 * Создать/заполнить вкладки «СТО › …» с макросами {{…}}
 * в уже расшаренном Google Doc (SA не может создать новый файл — квота 0),
 * положить ярлык в папку Drive «Шаблоны», обновить манифест.
 *
 * Usage: php tools/sto_templates_seed_gdoc.php
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
$folderId = '1jjmTeuMnTxH5V9I-WPSR97m43nMFBsY1';
/** Пишем во вкладки уже расшаренного Doc (у SA есть canEdit). */
$docId = getenv('STO_TEMPLATES_GDOC_ID') ?: '1FhZzPLBWwxTpB-1PUogEjJsXpGZDoWzTy1CIFIU67v0';

$TEMPLATES = [
    ['id' => 'macros', 'code' => '00', 'title' => 'Макросы', 'txt' => null],
    ['id' => 'sto-contract-person', 'code' => '01', 'title' => 'Договор физлицо', 'txt' => '01-contract-person.txt', 'tpl' => 'tpl-sto-contract-person'],
    ['id' => 'sto-contract-legal', 'code' => '02', 'title' => 'Договор юр/ИП', 'txt' => '02-contract-legal.txt', 'tpl' => 'tpl-sto-contract-legal'],
    ['id' => 'sto-workorder', 'code' => '03', 'title' => 'ЗН общий', 'txt' => '03-workorder.txt', 'tpl' => 'tpl-sto-workorder'],
    ['id' => 'sto-workorder-person', 'code' => '03ф', 'title' => 'ЗН физлицо', 'txt' => '03-workorder-person.txt', 'tpl' => 'tpl-sto-workorder-person'],
    ['id' => 'sto-workorder-legal', 'code' => '03ю', 'title' => 'ЗН юр/ИП', 'txt' => '03-workorder-legal.txt', 'tpl' => 'tpl-sto-workorder-legal'],
    ['id' => 'sto-acceptance-in', 'code' => '04', 'title' => 'Акт приёма', 'txt' => '04-acceptance-in.txt', 'tpl' => 'tpl-sto-acceptance-in'],
    ['id' => 'sto-inspection', 'code' => '05', 'title' => 'Акт осмотра', 'txt' => '05-inspection.txt', 'tpl' => ''],
    ['id' => 'sto-extra-works', 'code' => '06', 'title' => 'Доп. работы', 'txt' => '06-extra-works.txt', 'tpl' => ''],
    ['id' => 'sto-parts-from-client', 'code' => '07', 'title' => 'ЗЧ заказчика', 'txt' => '07-parts-from-client.txt', 'tpl' => ''],
    ['id' => 'sto-works-done', 'code' => '08', 'title' => 'Акт сдачи', 'txt' => '08-works-done.txt', 'tpl' => ''],
    ['id' => 'sto-warranty', 'code' => '09', 'title' => 'Гарантия', 'txt' => '09-warranty.txt', 'tpl' => ''],
    ['id' => 'sto-no-show', 'code' => '10', 'title' => 'Неявка', 'txt' => '10-no-show.txt', 'tpl' => ''],
    ['id' => 'sto-pdn-consent', 'code' => '11', 'title' => 'Согласие ПДн', 'txt' => '11-pdn-consent.txt', 'tpl' => 'tpl-sto-pdn-consent'],
    ['id' => 'sto-legal-note', 'code' => '12', 'title' => 'Правовая справка', 'txt' => '12-legal-note.txt', 'tpl' => ''],
    ['id' => 'sto-order', 'code' => '13', 'title' => 'Приказ', 'txt' => '13-order.txt', 'tpl' => ''],
    ['id' => 'sto-reception-reglament', 'code' => '14', 'title' => 'Регламент', 'txt' => '14-reception-reglament.txt', 'tpl' => ''],
    ['id' => 'sto-checklist', 'code' => '15', 'title' => 'Чек-лист', 'txt' => '15-checklist.txt', 'tpl' => ''],
];

require $autoload;

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

/** Подставить макросы вместо типичных прочерков в бланках. */
function macroizeStoText(string $text): string
{
    $text = str_replace(["\r\n", "\r"], "\n", $text);

    $subs = [
        // организация / ИП
        '/индивидуальн(?:ый|ому)\s+предпринимател[^\n_]{0,40}_{6,}/iu' => 'индивидуальный предприниматель {{Организация}}',
        '/Исполнитель:\s*ИП\s*_{6,}/u' => 'Исполнитель: ИП {{Организация}}',
        '/Исполнитель:\s*индивидуальный предприниматель\s*_{6,}/iu' => 'Исполнитель: индивидуальный предприниматель {{Организация}}',
        '/ОГРНИП\s*_{6,}/u' => 'ОГРНИП {{ОГРНОрганизации}}',
        '/ИНН\s*_{6,}(?!\s*Заказ)/u' => 'ИНН {{ИННОрганизации}}',
        '/тел\.\s*_{6,}/u' => 'тел. {{ТелефонОрганизации}}',
        '/телефон\s*_{6,}/iu' => 'телефон {{ТелефонОрганизации}}',
        '/адрес электронной почты\s*_{6,}/iu' => 'адрес электронной почты {{Email}}',
        '/e-mail:\s*_{6,}/iu' => 'e-mail: {{Email}}',
        // заказчик
        '/Заказчик:\s*_{6,}/u' => 'Заказчик: {{Покупатель}}',
        '/Я,\s*_{6,}/u' => 'Я, {{ФИО}}',
        '/гражданин\s*_{6,}/iu' => 'гражданин {{ФИО}}',
        '/паспорт серия\s*_{3,}\s*№\s*_{6,}/iu' => 'паспорт {{ДокументЗаказчика}}',
        '/зарегистрирован\(а\) по адресу:\s*_{6,}/iu' => 'зарегистрирован(а) по адресу: {{Адрес}}',
        '/адрес:\s*_{6,}/iu' => 'адрес: {{Адрес}}',
        '/Адрес регистрации по месту жительства:\s*_{6,}/u' => 'Адрес регистрации по месту жительства: {{АдресОрганизации}}.',
        '/Адрес места оказания услуг[^\n:]{0,40}:\s*_{6,}/u' => 'Адрес места оказания услуг (станция технического обслуживания): {{АдресОрганизации}}.',
        // документ
        '/г\.\s*_{6,}/u' => 'г. {{Город}}',
        '/Договору №\s*_{3,}/u' => 'Договору № {{НомерДоговора}}',
        '/Договор №\s*_{3,}/u' => 'Договор № {{Номер}}',
        '/заказ-наряду\) №\s*_{3,}/u' => 'заказ-наряду) № {{Номер}}',
        '/АКТ №\s*_{3,}/u' => 'АКТ № {{Номер}}',
        '/Приложение № 2 к Договору №\s*_{3,}/u' => 'Приложение № 2 к Договору № {{НомерДоговора}}',
        // авто — пустые строки после заголовков
        '/Марка, модель\n\n/u' => "Марка, модель\n{{Марка}} {{Модель}}\n\n",
        '/Год выпуска\n\n/u' => "Год выпуска\n{{Год}}\n\n",
        '/VIN \(идентификационный номер\)\n\n/u' => "VIN (идентификационный номер)\n{{VIN}}\n\n",
        '/Идентификационный номер \(VIN\)\n\n/u' => "Идентификационный номер (VIN)\n{{VIN}}\n\n",
        '/Гос\. рег\. знак\n\n/u' => "Гос. рег. знак\n{{Госномер}}\n\n",
        '/Цвет\n\n/u' => "Цвет\n{{Цвет}}\n\n",
        '/Пробег по одометру, км\n\n/u' => "Пробег по одометру, км\n{{Пробег}}\n\n",
        '/Пробег по одометру на дату приёма, км\n\n/u' => "Пробег по одометру на дату приёма, км\n{{Пробег}}\n\n",
        '/Уровень топлива\n\n/u' => "Уровень топлива\n{{УровеньТоплива}}\n\n",
        '/№ двигателя \/ кузова \/ шасси\n\n/u' => "№ двигателя / кузова / шасси\n{{НомерДвигателя}}\n\n",
    ];
    foreach ($subs as $re => $rep) {
        $text = preg_replace($re, $rep, $text) ?? $text;
    }

    // даты длинные / короткие — аккуратно
    $text = preg_replace(
        '/«____»\s*_{0,12}\s*20____\s*г\./u',
        '{{ДатаДлинная}}',
        $text
    ) ?? $text;

    $header = "<!-- Учёт №1 · макросы {{…}} · правьте и жмите «Подтянуть» в Настройки → Шаблоны документов -->\n\n";
    if (!str_contains($text, '{{')) {
        $header .= "Подсказка: вставьте макросы из вкладки «СТО › 00 · Макросы», например {{Покупатель}}, {{Госномер}}, {{VIN}}.\n\n";
    }
    return $header . $text;
}

function tabTitle(array $t): string
{
    return 'СТО › ' . $t['code'] . ' · ' . $t['title'];
}

function findTabId(array $tabs, string $title): ?string
{
    foreach ($tabs as $tab) {
        $t = (string) ($tab['tabProperties']['title'] ?? '');
        $id = (string) ($tab['tabProperties']['tabId'] ?? '');
        if ($t === $title) {
            return $id;
        }
    }
    // мягкий матч по коду «СТО › 01 ·»
    $code = explode(' · ', $title)[0] ?? '';
    foreach ($tabs as $tab) {
        $t = (string) ($tab['tabProperties']['title'] ?? '');
        $id = (string) ($tab['tabProperties']['tabId'] ?? '');
        if ($code !== '' && str_starts_with($t, $code . ' ·')) {
            return $id;
        }
    }
    return null;
}

function ensureTab(string $token, string $docId, string $title, array &$tabs): string
{
    $id = findTabId($tabs, $title);
    if ($id) {
        return $id;
    }
    $r = ghttp('POST', 'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . ':batchUpdate', $token, [
        'requests' => [['addDocumentTab' => ['tabProperties' => ['title' => $title]]]],
    ]);
    if ($r['code'] !== 200) {
        fwrite(STDERR, "add tab «{$title}» HTTP {$r['code']}\n{$r['raw']}\n");
        exit(1);
    }
    $newId = null;
    foreach ($r['json']['replies'] ?? [] as $rep) {
        if (!empty($rep['addDocumentTab']['tabProperties']['tabId'])) {
            $newId = (string) $rep['addDocumentTab']['tabProperties']['tabId'];
        }
    }
    if (!$newId) {
        fwrite(STDERR, "no tabId for {$title}\n");
        exit(1);
    }
    echo "  + {$title} [$newId]\n";
    $get = ghttp('GET', 'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . '?includeTabsContent=true', $token);
    $tabs = $get['json']['tabs'] ?? [];
    return $newId;
}

function pushText(string $token, string $docId, string $tabId, array $tab, string $text): void
{
    if ($text === '' || !str_ends_with($text, "\n")) {
        $text .= "\n";
    }
    $end = 1;
    foreach ($tab['documentTab']['body']['content'] ?? [] as $el) {
        if (isset($el['endIndex'])) {
            $end = max($end, (int) $el['endIndex']);
        }
    }
    $requests = [];
    if ($end > 2) {
        $requests[] = [
            'deleteContentRange' => [
                'range' => ['startIndex' => 1, 'endIndex' => $end - 1, 'tabId' => $tabId],
            ],
        ];
    }
    $requests[] = [
        'insertText' => [
            'location' => ['index' => 1, 'tabId' => $tabId],
            'text' => $text,
        ],
    ];
    $r = ghttp('POST', 'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . ':batchUpdate', $token, [
        'requests' => $requests,
    ]);
    if ($r['code'] !== 200) {
        fwrite(STDERR, "push {$tabId} HTTP {$r['code']}\n{$r['raw']}\n");
        exit(1);
    }
}

$client = new Google_Client();
$client->setApplicationName('Uchet1 STO seed gdoc');
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

echo "Doc: https://docs.google.com/document/d/{$docId}/edit\n";
$get = ghttp('GET', 'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . '?includeTabsContent=true', $token);
if ($get['code'] !== 200) {
    fwrite(STDERR, "GET doc failed {$get['code']}\n{$get['raw']}\n");
    exit(1);
}
$tabs = $get['json']['tabs'] ?? [];
$man = [
    'google_doc_id' => $docId,
    'google_doc_url' => 'https://docs.google.com/document/d/' . $docId . '/edit',
    'folder_id' => $folderId,
    'folder_url' => 'https://drive.google.com/drive/folders/' . $folderId,
    'folder_name' => 'Шаблоны',
    'note' => 'Вкладки СТО › … в общем Doc (SA не создаёт отдельные файлы из‑за квоты Drive). Ярлык в папке «Шаблоны».',
    'updated_at' => gmdate('c'),
    'tabs' => [],
    'settings_links' => [],
];

foreach ($TEMPLATES as $t) {
    $title = tabTitle($t);
    $tabId = ensureTab($token, $docId, $title, $tabs);
    $useTab = null;
    foreach ($tabs as $tab) {
        if ((string) ($tab['tabProperties']['tabId'] ?? '') === $tabId) {
            $useTab = $tab;
            break;
        }
    }
    if (!$useTab) {
        $get = ghttp('GET', 'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . '?includeTabsContent=true', $token);
        $tabs = $get['json']['tabs'] ?? [];
        foreach ($tabs as $tab) {
            if ((string) ($tab['tabProperties']['tabId'] ?? '') === $tabId) {
                $useTab = $tab;
                break;
            }
        }
    }
    if (!$useTab) {
        fwrite(STDERR, "tab body missing {$title}\n");
        continue;
    }

    if ($t['id'] === 'macros') {
        $body = is_file($macrosPath) ? (string) file_get_contents($macrosPath) : "Макросы {{Покупатель}} {{Госномер}} {{VIN}}\n";
    } else {
        $path = $txtDir . '/' . $t['txt'];
        if (!is_file($path)) {
            fwrite(STDERR, "missing {$path}\n");
            continue;
        }
        $body = macroizeStoText((string) file_get_contents($path));
        // локальный TXT не трогаем здесь — только Google Doc (канон печати можно pull'ом)
    }

    echo "Push {$title}\n";
    pushText($token, $docId, $tabId, $useTab, $body);
    $tabUrl = 'https://docs.google.com/document/d/' . $docId . '/edit?tab=' . $tabId;
    $man['tabs'][$t['id']] = [
        'tab_id' => $tabId,
        'title' => $title,
        'url' => $tabUrl,
        'txt' => $t['txt'],
        'tpl' => $t['tpl'] ?? '',
    ];
    if (!empty($t['tpl'])) {
        $man['settings_links'][$t['tpl']] = $tabUrl;
    }
    // refresh after write
    $get = ghttp('GET', 'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . '?includeTabsContent=true', $token);
    $tabs = $get['json']['tabs'] ?? [];
}

// ярлык в папке «Шаблоны»
$q = rawurlencode(
    "'{$folderId}' in parents and name = 'Шаблоны СТО · макросы' and mimeType = 'application/vnd.google-apps.shortcut' and trashed = false"
);
$listed = ghttp('GET', 'https://www.googleapis.com/drive/v3/files?pageSize=5&fields=files(id)&q=' . $q, $token);
$shortcutId = $listed['json']['files'][0]['id'] ?? null;
if (!$shortcutId) {
    $cr = ghttp('POST', 'https://www.googleapis.com/drive/v3/files?fields=id,webViewLink', $token, [
        'name' => 'Шаблоны СТО · макросы',
        'mimeType' => 'application/vnd.google-apps.shortcut',
        'parents' => [$folderId],
        'shortcutDetails' => ['targetId' => $docId],
    ]);
    if ($cr['code'] >= 200 && $cr['code'] < 300) {
        $shortcutId = $cr['json']['id'] ?? null;
        echo "Shortcut OK {$shortcutId}\n";
    } else {
        fwrite(STDERR, "shortcut failed {$cr['code']}\n{$cr['raw']}\n");
    }
} else {
    echo "Shortcut exists {$shortcutId}\n";
}
$man['shortcut_id'] = $shortcutId;
$man['shortcut_url'] = $shortcutId
    ? 'https://drive.google.com/file/d/' . $shortcutId . '/view'
    : null;

@mkdir(dirname($manifestPath), 0775, true);
file_put_contents($manifestPath, json_encode($man, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n");
echo "\nManifest: {$manifestPath}\n";
echo "Open: {$man['google_doc_url']}\n";
echo "Folder: {$man['folder_url']}\n";
echo "Tabs: " . count($man['tabs']) . "\n";
