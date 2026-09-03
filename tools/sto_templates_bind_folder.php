<?php
/**
 * Привязать ОТДЕЛЬНЫЕ Google Doc из папки «Шаблоны» к настройкам / манифесту.
 * После загрузки DOCX/Doc в папку «Шаблоны» (или ручного создания с теми же именами).
 *
 * Usage:
 *   php tools/sto_templates_bind_folder.php
 *   php tools/sto_templates_bind_folder.php --fill   # ещё и перезалить текст (нужен canEdit у SA)
 *   php tools/sto_templates_bind_folder.php --prod   # обновить meta на VPS
 */
declare(strict_types=1);

$root = dirname(__DIR__);
$credPath = getenv('GOOGLE_SA_JSON')
    ?: '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = getenv('GOOGLE_PHP_AUTOLOAD')
    ?: '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$packPath = $root . '/web/public/sto-templates-pack.json';
$manifestPath = $root . '/docs/sto-templates/gdrive-sto-edit.json';
$folderId = '1jjmTeuMnTxH5V9I-WPSR97m43nMFBsY1';
$doFill = in_array('--fill', $argv, true);
$doProd = in_array('--prod', $argv, true);

if (!is_file($packPath)) {
    fwrite(STDERR, "Нет pack — сначала: php tools/gen_sto_templates_pack.php\n");
    exit(1);
}
$pack = json_decode((string) file_get_contents($packPath), true);
if (!is_array($pack) || empty($pack['items'])) {
    fwrite(STDERR, "Битый pack\n");
    exit(1);
}

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

$client = new Google\Client();
$client->setAuthConfig($credPath);
$client->setScopes([
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
]);
$client->fetchAccessTokenWithAssertion();
$token = $client->getAccessToken()['access_token'];

$q = sprintf("'%s' in parents and trashed = false and mimeType = 'application/vnd.google-apps.document'", $folderId);
$listed = ghttp(
    'GET',
    'https://www.googleapis.com/drive/v3/files?' . http_build_query([
        'q' => $q,
        'pageSize' => 100,
        'fields' => 'files(id,name,webViewLink)',
        'supportsAllDrives' => 'true',
        'includeItemsFromAllDrives' => 'true',
    ]),
    $token
);
$byName = [];
foreach (($listed['json']['files'] ?? []) as $f) {
    $byName[(string) $f['name']] = $f;
}
echo 'В папке Google Doc: ' . count($byName) . "\n";

$docs = [];
$missing = [];
foreach ($pack['items'] as $it) {
    $name = (string) $it['name'];
    if (!isset($byName[$name])) {
        $missing[] = $name;
        continue;
    }
    $f = $byName[$name];
    $docId = (string) $f['id'];
    $url = (string) ($f['webViewLink'] ?: ('https://docs.google.com/document/d/' . $docId . '/edit'));
    $docs[$it['id']] = [
        'id' => $docId,
        'name' => $name,
        'url' => $url,
        'tpl' => (string) ($it['tpl'] ?? ''),
        'sto_template_id' => (string) ($it['sto_template_id'] ?? ''),
        'text' => (string) ($it['text'] ?? ''),
    ];
    echo "OK  {$name} → {$docId}\n";

    if ($doFill && $it['text'] !== null && $it['text'] !== '') {
        // Docs API: заменить тело
        $get = ghttp('GET', 'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId), $token);
        if ($get['code'] !== 200) {
            echo "  FILL skip (read {$get['code']}): " . substr($get['raw'], 0, 120) . "\n";
            continue;
        }
        $endIndex = (int) ($get['json']['body']['content'][count($get['json']['body']['content']) - 1]['endIndex'] ?? 1);
        $requests = [];
        if ($endIndex > 2) {
            $requests[] = [
                'deleteContentRange' => [
                    'range' => ['startIndex' => 1, 'endIndex' => $endIndex - 1],
                ],
            ];
        }
        $text = str_replace("\r\n", "\n", (string) $it['text']);
        // Docs insertText не любит одиночные \n в конце без символа — ок
        $requests[] = [
            'insertText' => [
                'location' => ['index' => 1],
                'text' => $text === '' ? ' ' : $text,
            ],
        ];
        $up = ghttp(
            'POST',
            'https://docs.googleapis.com/v1/documents/' . rawurlencode($docId) . ':batchUpdate',
            $token,
            ['requests' => $requests]
        );
        echo $up['code'] === 200 ? "  FILL ok\n" : ("  FILL fail {$up['code']}: " . substr($up['raw'], 0, 160) . "\n");
    }
}

if ($missing) {
    echo "\nНет в папке (" . count($missing) . "):\n  - " . implode("\n  - ", $missing) . "\n";
    echo "Залейте DOCX/Doc в папку: https://drive.google.com/drive/folders/{$folderId}\n";
}

$manifest = [
    'mode' => 'separate_docs',
    'folder_id' => $folderId,
    'folder_url' => "https://drive.google.com/drive/folders/{$folderId}",
    'folder_name' => 'Шаблоны',
    'note' => 'Отдельный Google Doc на каждый бланк СТО (без вкладок). Создаёт Apps Script от пользователя; SA подтягивает текст.',
    'updated_at' => gmdate('c'),
    'docs' => [],
];
foreach ($docs as $id => $d) {
    $manifest['docs'][$id] = [
        'google_doc_id' => $d['id'],
        'google_doc_url' => $d['url'],
        'title' => $d['name'],
        'tpl' => $d['tpl'],
        'sto_template_id' => $d['sto_template_id'],
    ];
}
file_put_contents($manifestPath, json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
echo "Манифест: {$manifestPath}\n";

if ($doProd && $docs) {
    $mapJson = json_encode($manifest['docs'], JSON_UNESCAPED_UNICODE);
    $tmp = tempnam(sys_get_temp_dir(), 'sto-bind-');
    file_put_contents($tmp, $mapJson);
    $remote = '/tmp/sto-bind-docs.json';
    passthru('scp -q ' . escapeshellarg($tmp) . ' bank-vps:' . escapeshellarg($remote), $scpCode);
    unlink($tmp);
    if ($scpCode !== 0) {
        fwrite(STDERR, "scp fail\n");
        exit(1);
    }
    $php = <<<'PHP'
<?php
$db = new SQLite3('/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite');
$map = json_decode(file_get_contents('/tmp/sto-bind-docs.json'), true);
$row = $db->querySingle("SELECT value FROM meta WHERE key='doc_templates_config'", true);
$cfg = $row ? json_decode($row['value'], true) : [];
if (!is_array($cfg)) $cfg = [];
$templates = isset($cfg['templates']) && is_array($cfg['templates']) ? $cfg['templates'] : [];
$bySto = [];
foreach ($templates as $i => $t) {
  $sid = (string)($t['sto_template_id'] ?? '');
  if ($sid !== '') $bySto[$sid] = $i;
}
$now = gmdate('c');
foreach ($map as $id => $d) {
  $sto = (string)($d['sto_template_id'] ?? '');
  $url = (string)($d['google_doc_url'] ?? '');
  $title = (string)($d['title'] ?? $id);
  if ($sto === '') continue; // macros
  if (isset($bySto[$sto])) {
    $i = $bySto[$sto];
    $templates[$i]['google_doc_url'] = $url;
    $templates[$i]['sto_template_id'] = $sto;
    if (empty($templates[$i]['title'])) $templates[$i]['title'] = $title;
  } else {
    $tplId = (string)($d['tpl'] ?? '');
    if ($tplId === '') $tplId = 'tpl-' . $sto;
    $templates[] = [
      'id' => $tplId,
      'title' => preg_replace('/^СТО\s+/u', '', $title),
      'google_doc_url' => $url,
      'sto_template_id' => $sto,
      'audience' => ['any'],
      'use_for' => ['sto'],
      'note' => 'отдельный Google Doc',
      'updated_at' => $now,
    ];
  }
}
$cfg['templates'] = array_values($templates);
$cfg['updated_at'] = $now;
$val = $db->escapeString(json_encode($cfg, JSON_UNESCAPED_UNICODE));
$db->exec("INSERT INTO meta(key,value) VALUES('doc_templates_config','$val') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
echo "prod templates: ".count($templates)."\n";
PHP;
    $remotePhp = '/tmp/sto-bind-apply.php';
    $localPhp = tempnam(sys_get_temp_dir(), 'sto-php-');
    file_put_contents($localPhp, $php);
    passthru('scp -q ' . escapeshellarg($localPhp) . ' bank-vps:' . escapeshellarg($remotePhp), $c2);
    unlink($localPhp);
    passthru('ssh bank-vps php ' . escapeshellarg($remotePhp), $c3);
    echo $c3 === 0 ? "Prod meta обновлён\n" : "Prod meta fail\n";
}

if (!$docs) {
    exit(2);
}
echo "Готово: " . count($docs) . " отдельных Doc\n";
