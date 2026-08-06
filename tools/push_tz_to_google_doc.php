<?php
/**
 * Вставка вкладки/секции плана в Google Doc через сервисный аккаунт.
 * SA: pnevmopodveska1-bank@pnevmopodveska1.iam.gserviceaccount.com
 *
 * Документ должен быть расшарен на этот SA (редактор).
 */
declare(strict_types=1);

$docId = '1FhZzPLBWwxTpB-1PUogEjJsXpGZDoWzTy1CIFIU67v0';
$tabTitle = 'API·Web · Аналитика · 18.07.2026';
$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$textPath = '/Users/a_/Downloads/php/uchetn1/docs/GOOGLE-DOC-vkladka-api-web-analitika-2026-07-18.md';

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
$bodyText = trim($m[1]) . "\n\n";

$client = new Google_Client();
$client->setApplicationName('Uchet1 TZ push');
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

function ghttp(string $method, string $url, string $token, ?array $json = null): array
{
    $ch = curl_init($url);
    $headers = [
        'Authorization: Bearer ' . $token,
        'Accept: application/json',
    ];
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 60,
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
        return ['code' => 0, 'error' => $err, 'json' => null];
    }
    return ['code' => $code, 'error' => '', 'json' => json_decode($resp, true), 'raw' => $resp];
}

// 1) Прочитать документ с вкладками
$getUrl = 'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId)
    . '?includeTabsContent=true';
$get = ghttp('GET', $getUrl, $token);
if ($get['code'] !== 200) {
    fwrite(STDERR, "GET doc failed HTTP {$get['code']}\n");
    fwrite(STDERR, ($get['raw'] ?? $get['error']) . "\n");
    fwrite(STDERR, "Проверьте: документ расшарен на pnevmopodveska1-bank@pnevmopodveska1.iam.gserviceaccount.com как Редактор.\n");
    exit(1);
}

$doc = $get['json'];
$tabs = $doc['tabs'] ?? [];
echo "Document: " . ($doc['title'] ?? '?') . "\n";
echo "Tabs count: " . count($tabs) . "\n";

$targetTabId = null;
foreach ($tabs as $tab) {
    $props = $tab['tabProperties'] ?? [];
    $title = (string) ($props['title'] ?? '');
    $id = (string) ($props['tabId'] ?? '');
    echo " - tab [$id] $title\n";
    if ($title === $tabTitle || str_contains($title, 'API·Web') || str_contains($title, 'Аналитика · 18.07')) {
        $targetTabId = $id;
    }
}

// 2) Попытка создать вкладку (если API поддерживает)
if ($targetTabId === null) {
    $createTabBody = [
        'requests' => [
            [
                'addDocumentTab' => [
                    'tabProperties' => [
                        'title' => $tabTitle,
                    ],
                ],
            ],
        ],
    ];
    $create = ghttp(
        'POST',
        'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . ':batchUpdate',
        $token,
        $createTabBody
    );
    if ($create['code'] === 200) {
        echo "Created tab via addDocumentTab\n";
        $replies = $create['json']['replies'] ?? [];
        foreach ($replies as $r) {
            if (!empty($r['addDocumentTab']['tabProperties']['tabId'])) {
                $targetTabId = (string) $r['addDocumentTab']['tabProperties']['tabId'];
            }
        }
        // refresh
        $get = ghttp('GET', $getUrl, $token);
        $doc = $get['json'];
        $tabs = $doc['tabs'] ?? [];
    } else {
        echo "addDocumentTab not available/failed HTTP {$create['code']} — вставим в конец документа/вкладки\n";
        if (!empty($create['raw'])) {
            echo substr($create['raw'], 0, 400) . "\n";
        }
    }
}

// Определить segment / endIndex для вставки
$endIndex = 1;
$tabIdForInsert = $targetTabId;

if ($tabs) {
    $useTab = null;
    foreach ($tabs as $tab) {
        $id = (string) (($tab['tabProperties']['tabId'] ?? ''));
        if ($targetTabId && $id === $targetTabId) {
            $useTab = $tab;
            break;
        }
    }
    if ($useTab === null) {
        // последняя вкладка или первая
        $useTab = $tabs[count($tabs) - 1];
        $tabIdForInsert = (string) ($useTab['tabProperties']['tabId'] ?? '');
        echo "Using existing tab: " . ($useTab['tabProperties']['title'] ?? '') . " [$tabIdForInsert]\n";
    }
    $content = $useTab['documentTab']['body']['content'] ?? [];
    foreach ($content as $el) {
        if (isset($el['endIndex'])) {
            $endIndex = max($endIndex, (int) $el['endIndex']);
        }
    }
} else {
    $content = $doc['body']['content'] ?? [];
    foreach ($content as $el) {
        if (isset($el['endIndex'])) {
            $endIndex = max($endIndex, (int) $el['endIndex']);
        }
    }
}

// Вставка перед финальным newline документа (endIndex - 1)
$insertAt = max(1, $endIndex - 1);

$marker = "\n\n==========\n{$tabTitle}\nДата: 18.07.2026\n==========\n\n";
$insertText = $marker . $bodyText . "\n";

$insertReq = [
    'insertText' => [
        'location' => [
            'index' => $insertAt,
        ],
        'text' => $insertText,
    ],
];
if ($tabIdForInsert) {
    $insertReq['insertText']['location']['tabId'] = $tabIdForInsert;
}

// Если вкладку создать не удалось — prepend заголовок что это новая секция для переноса во вкладку
$batch = [
    'requests' => [$insertReq],
];

$upd = ghttp(
    'POST',
    'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . ':batchUpdate',
    $token,
    $batch
);

if ($upd['code'] !== 200) {
    fwrite(STDERR, "batchUpdate insert failed HTTP {$upd['code']}\n");
    fwrite(STDERR, ($upd['raw'] ?? '') . "\n");
    exit(1);
}

echo "OK inserted text at index $insertAt\n";
if ($targetTabId) {
    echo "Tab id: $targetTabId\n";
}
echo "Open: https://docs.google.com/document/d/{$docId}/edit\n";
if ($tabIdForInsert) {
    echo "Tab link hint: https://docs.google.com/document/d/{$docId}/edit?tab=t.{$tabIdForInsert}\n";
}
