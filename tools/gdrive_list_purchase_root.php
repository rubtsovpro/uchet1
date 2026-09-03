<?php
/**
 * Список папок/файлов корня закупок Жени (Google Drive).
 * Usage: php tools/gdrive_list_purchase_root.php [folderId]
 */
declare(strict_types=1);

$credPath = getenv('GOOGLE_SA_JSON')
    ?: '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = getenv('GOOGLE_PHP_AUTOLOAD')
    ?: '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$rootId = $argv[1] ?? (getenv('GDRIVE_PURCHASE_ROOT') ?: '14719E16hSlz2EXuiMdEjbsnFJfhI5sKs');

require $autoload;

$client = new Google_Client();
$client->setApplicationName('Uchet1 purchase drive list');
$client->setAuthConfig($credPath);
$client->setScopes(['https://www.googleapis.com/auth/drive.readonly']);
$client->fetchAccessTokenWithAssertion();
$token = $client->getAccessToken()['access_token'] ?? '';
if ($token === '') {
    fwrite(STDERR, "No access token\n");
    exit(1);
}

function gget(string $url, string $token): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $token,
            'Accept: application/json',
        ],
        CURLOPT_TIMEOUT => 60,
    ]);
    $resp = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($resp === false) {
        return ['code' => 0, 'error' => $err, 'json' => null, 'raw' => ''];
    }
    return ['code' => $code, 'error' => '', 'json' => json_decode($resp, true), 'raw' => $resp];
}

$meta = gget(
    'https://www.googleapis.com/drive/v3/files/' . rawurlencode($rootId)
        . '?fields=id,name,mimeType,webViewLink,owners(emailAddress,displayName),shared,permissions(emailAddress,role,type)',
    $token
);
echo "=== ROOT {$rootId} HTTP {$meta['code']} ===\n";
if ($meta['code'] !== 200) {
    fwrite(STDERR, $meta['raw'] . "\n");
    fwrite(STDERR, "SA needs Viewer on this folder: pnevmopodveska1-bank@pnevmopodveska1.iam.gserviceaccount.com\n");
    exit(2);
}
echo json_encode($meta['json'], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n\n";

$q = sprintf("'%s' in parents and trashed = false", $rootId);
$url = 'https://www.googleapis.com/drive/v3/files?pageSize=200'
    . '&orderBy=folder,name'
    . '&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size,md5Checksum,webViewLink)'
    . '&q=' . rawurlencode($q);
$children = gget($url, $token);
echo "=== CHILDREN HTTP {$children['code']} ===\n";
if ($children['code'] !== 200) {
    fwrite(STDERR, $children['raw'] . "\n");
    exit(3);
}
$files = $children['json']['files'] ?? [];
$folders = [];
$others = [];
foreach ($files as $f) {
    if (($f['mimeType'] ?? '') === 'application/vnd.google-apps.folder') {
        $folders[] = $f;
    } else {
        $others[] = $f;
    }
}
echo 'folders: ' . count($folders) . ', files: ' . count($others) . "\n";
foreach ($folders as $f) {
    echo sprintf("[DIR] %s\t%s\n", $f['name'], $f['id']);
}
foreach ($others as $f) {
    echo sprintf(
        "[FILE] %s\t%s\t%s\t%s\n",
        $f['name'],
        $f['id'],
        $f['mimeType'] ?? '',
        $f['modifiedTime'] ?? ''
    );
}

// one level deeper for each supplier folder
foreach ($folders as $folder) {
    $fq = sprintf("'%s' in parents and trashed = false", $folder['id']);
    $furl = 'https://www.googleapis.com/drive/v3/files?pageSize=50'
        . '&orderBy=modifiedTime desc'
        . '&fields=files(id,name,mimeType,modifiedTime,size)'
        . '&q=' . rawurlencode($fq);
    $inner = gget($furl, $token);
    $innerFiles = $inner['json']['files'] ?? [];
    echo "\n--- {$folder['name']} (" . count($innerFiles) . ") ---\n";
    foreach (array_slice($innerFiles, 0, 15) as $f) {
        $kind = (($f['mimeType'] ?? '') === 'application/vnd.google-apps.folder') ? 'DIR' : 'FILE';
        echo sprintf(
            "  [%s] %s\t%s\t%s\n",
            $kind,
            $f['name'],
            $f['modifiedTime'] ?? '',
            $f['id']
        );
    }
    if (count($innerFiles) > 15) {
        echo '  … +' . (count($innerFiles) - 15) . " more\n";
    }
}
