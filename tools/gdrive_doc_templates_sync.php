<?php
/**
 * Папка Google Drive «Шаблоны» + загрузка DOCX → Google Doc.
 * SA: pnevmopodveska1-bank@pnevmopodveska1.iam.gserviceaccount.com
 *
 * Usage:
 *   php tools/gdrive_doc_templates_sync.php
 *   php tools/gdrive_doc_templates_sync.php /path/to/file.docx "Название"
 */
declare(strict_types=1);

$credPath = getenv('GOOGLE_SA_JSON')
    ?: '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = getenv('GOOGLE_PHP_AUTOLOAD')
    ?: '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
/** Родительская папка, уже расшарена на SA */
$parentFolderId = getenv('GDRIVE_TEMPLATES_PARENT')
    ?: '1PukJzT4zkQlWQWG6n3t_UmZOZ8VmTJ0j'; // Пневмоподвеска1
$folderName = getenv('GDRIVE_TEMPLATES_FOLDER_NAME') ?: 'Шаблоны';
$manifestPath = dirname(__DIR__) . '/docs/sto-templates/gdrive-templates.json';

require $autoload;

$client = new Google_Client();
$client->setApplicationName('Uchet1 doc templates');
$client->setAuthConfig($credPath);
$client->setScopes([
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
]);
$client->fetchAccessTokenWithAssertion();
$token = $client->getAccessToken()['access_token'] ?? '';
if ($token === '') {
    fwrite(STDERR, "No access token\n");
    exit(1);
}

function ghttp(string $method, string $url, string $token, ?array $json = null, ?string $rawBody = null, array $extraHeaders = []): array
{
    $ch = curl_init($url);
    $headers = array_merge([
        'Authorization: Bearer ' . $token,
        'Accept: application/json',
    ], $extraHeaders);
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
    } elseif ($rawBody !== null) {
        $opts[CURLOPT_POSTFIELDS] = $rawBody;
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

function findOrCreateFolder(string $token, string $parentId, string $name): string
{
    $q = sprintf(
        "'%s' in parents and name = '%s' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
        $parentId,
        str_replace("'", "\\'", $name)
    );
    $url = 'https://www.googleapis.com/drive/v3/files?pageSize=10&fields=files(id,name)&q=' . rawurlencode($q);
    $r = ghttp('GET', $url, $token);
    if ($r['code'] === 200 && !empty($r['json']['files'][0]['id'])) {
        return (string) $r['json']['files'][0]['id'];
    }
    $create = ghttp('POST', 'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', $token, [
        'name' => $name,
        'mimeType' => 'application/vnd.google-apps.folder',
        'parents' => [$parentId],
    ]);
    if ($create['code'] < 200 || $create['code'] >= 300 || empty($create['json']['id'])) {
        fwrite(STDERR, "Create folder failed HTTP {$create['code']}\n{$create['raw']}\n");
        exit(1);
    }
    return (string) $create['json']['id'];
}

function findDocByName(string $token, string $folderId, string $name): ?array
{
    $q = sprintf(
        "'%s' in parents and name = '%s' and mimeType = 'application/vnd.google-apps.document' and trashed = false",
        $folderId,
        str_replace("'", "\\'", $name)
    );
    $url = 'https://www.googleapis.com/drive/v3/files?pageSize=5&fields=files(id,name,webViewLink)&q=' . rawurlencode($q);
    $r = ghttp('GET', $url, $token);
    if ($r['code'] === 200 && !empty($r['json']['files'][0])) {
        return $r['json']['files'][0];
    }
    return null;
}

/** Upload DOCX → Google Doc (convert). Updates existing by name. */
function upsertDocxAsGoogleDoc(string $token, string $folderId, string $localPath, string $title): array
{
    if (!is_file($localPath)) {
        fwrite(STDERR, "File not found: $localPath\n");
        exit(1);
    }
    $bytes = file_get_contents($localPath);
    if ($bytes === false) {
        fwrite(STDERR, "Cannot read $localPath\n");
        exit(1);
    }
    $existing = findDocByName($token, $folderId, $title);
    $meta = [
        'name' => $title,
        'mimeType' => 'application/vnd.google-apps.document',
    ];
    if (!$existing) {
        $meta['parents'] = [$folderId];
    }
    $boundary = 'uchet1_' . bin2hex(random_bytes(8));
    $body = "--{$boundary}\r\n"
        . "Content-Type: application/json; charset=UTF-8\r\n\r\n"
        . json_encode($meta, JSON_UNESCAPED_UNICODE) . "\r\n"
        . "--{$boundary}\r\n"
        . "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n"
        . $bytes . "\r\n"
        . "--{$boundary}--";

    if ($existing) {
        $url = 'https://www.googleapis.com/upload/drive/v3/files/'
            . rawurlencode($existing['id'])
            . '?uploadType=multipart&fields=id,name,webViewLink';
        $method = 'PATCH';
    } else {
        $url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';
        $method = 'POST';
    }
    $r = ghttp($method, $url, $token, null, $body, [
        'Content-Type: multipart/related; boundary=' . $boundary,
    ]);
    if ($r['code'] < 200 || $r['code'] >= 300 || empty($r['json']['id'])) {
        fwrite(STDERR, "Upload failed HTTP {$r['code']}\n{$r['raw']}\n");
        exit(1);
    }
    return $r['json'];
}

$folderId = findOrCreateFolder($token, $parentFolderId, $folderName);
$folderLink = 'https://drive.google.com/drive/folders/' . $folderId;
echo "Folder: {$folderName}\nID: {$folderId}\nURL: {$folderLink}\n\n";

$uploads = [];
$extraFile = $argv[1] ?? null;
$extraTitle = $argv[2] ?? null;

$defaults = [
    [
        'path' => dirname(__DIR__) . '/api/assets/sto-templates/docx/03-workorder.docx',
        'title' => '03 Заказ-наряд',
        'template_id' => 'tpl-sto-workorder',
        'use_for' => ['workorder', 'sto'],
        'audience' => ['any'],
    ],
];

if ($extraFile) {
    $uploads[] = [
        'path' => $extraFile,
        'title' => $extraTitle ?: pathinfo($extraFile, PATHINFO_FILENAME),
        'template_id' => null,
        'use_for' => ['other'],
        'audience' => ['any'],
    ];
} else {
    $uploads = $defaults;
}

$manifest = [
    'folder_id' => $folderId,
    'folder_url' => $folderLink,
    'folder_name' => $folderName,
    'parent_id' => $parentFolderId,
    'updated_at' => gmdate('c'),
    'files' => [],
];

foreach ($uploads as $u) {
    echo "Upload: {$u['title']} ← {$u['path']}\n";
    $bytes = @file_get_contents($u['path']);
    if ($bytes === false) {
        fwrite(STDERR, "Cannot read {$u['path']}\n");
        continue;
    }
    // Проверка квоты SA заранее
    $about = ghttp('GET', 'https://www.googleapis.com/drive/v3/about?fields=storageQuota', $token);
    $limit = (string) ($about['json']['storageQuota']['limit'] ?? '');
    if ($limit === '0') {
        fwrite(STDERR, "\n⚠ SA Drive quota = 0 — создать Google Doc от имени сервисного аккаунта нельзя.\n");
        fwrite(STDERR, "Сделайте так:\n");
        fwrite(STDERR, "  1) Откройте папку: {$folderLink}\n");
        fwrite(STDERR, "  2) Залейте туда DOCX через браузер (файл станет вашим):\n");
        fwrite(STDERR, "     {$u['path']}\n");
        fwrite(STDERR, "  3) Вставьте ссылку Google Doc в Настройки → Шаблоны документов.\n");
        fwrite(STDERR, "Либо создайте Shared Drive и добавьте SA как Content manager — тогда upload заработает.\n\n");
        $manifest['files'][] = [
            'title' => $u['title'],
            'google_doc_id' => null,
            'google_doc_url' => null,
            'local_path' => $u['path'],
            'template_id' => $u['template_id'],
            'use_for' => $u['use_for'],
            'audience' => $u['audience'],
            'pending_upload' => true,
        ];
        continue;
    }
    $file = upsertDocxAsGoogleDoc($token, $folderId, $u['path'], $u['title']);
    $id = (string) $file['id'];
    $link = (string) ($file['webViewLink'] ?? ('https://docs.google.com/document/d/' . $id . '/edit'));
    echo "  OK {$id}\n  {$link}\n";
    $manifest['files'][] = [
        'title' => $u['title'],
        'google_doc_id' => $id,
        'google_doc_url' => $link,
        'local_path' => $u['path'],
        'template_id' => $u['template_id'],
        'use_for' => $u['use_for'],
        'audience' => $u['audience'],
    ];
}

@mkdir(dirname($manifestPath), 0775, true);
file_put_contents(
    $manifestPath,
    json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n"
);
echo "\nManifest: {$manifestPath}\n";
echo json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
