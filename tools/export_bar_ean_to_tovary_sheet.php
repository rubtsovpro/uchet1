<?php
/**
 * Лист «бар» (MRAER + EAN) → столбец «ШК» на вкладке «Товары»
 * в таблице «Номенклатура для ОП», плюс запись EAN в products.gtin на проде.
 *
 * Matching:
 *  1) Артикул листа = Part number MRAER
 *  2) иначе barcode / array_sku товара из БД по id
 *  3) сверка названия (нормализованная) — отсекаем явный мисмatch
 *
 * Usage:
 *   php tools/export_bar_ean_to_tovary_sheet.php
 *   DRY=1 php tools/export_bar_ean_to_tovary_sheet.php   # только отчёт, без записи
 *   SKIP_DB=1 ...   # не трогать gtin на VPS
 */
declare(strict_types=1);

$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$spreadsheetId = getenv('SHEET_ID') ?: '1T2FEXnWBeFhfKI-Y7_8tVfWFxFDRwTdZtPHH_NeCfn4';
$sheetGid = (int) (getenv('SHEET_GID') ?: 1554739031);
$barSpreadsheetId = getenv('BAR_SHEET_ID') ?: '1GBizpqt8k82ncA6hXNTgZzQrKHzeO1TULJZbSTDZMIo';
$barTab = getenv('BAR_TAB') ?: 'бар';
$dry = getenv('DRY') === '1' || in_array('--dry', $argv, true);
$skipDb = getenv('SKIP_DB') === '1';

if (!is_file($credPath) || !is_file($autoload)) {
    fwrite(STDERR, "Нет Google credentials/autoload\n");
    exit(1);
}

require $autoload;

function normName(string $s): string
{
    $s = mb_strtolower(trim($s), 'UTF-8');
    $s = strtr($s, [
        'ё' => 'е',
        '/' => ' ',
        '\\' => ' ',
        ',' => ' ',
        '.' => ' ',
        '-' => ' ',
        '(' => ' ',
        ')' => ' ',
        '+' => ' ',
    ]);
    $s = preg_replace('/\s+/u', ' ', $s) ?? $s;
    return trim($s);
}

/** Грубое совпадение названий: общие значимые токены. */
function namesCompatible(string $a, string $b): bool
{
    $na = normName($a);
    $nb = normName($b);
    if ($na === '' || $nb === '') {
        return true; // нет имени — не блокируем
    }
    if ($na === $nb) {
        return true;
    }
    if (str_contains($na, $nb) || str_contains($nb, $na)) {
        return true;
    }
    $stop = ['для', 'и', 'под', 'пер', 'зад', 'лев', 'прав', 'актив', 'неактив', 'пневмо', 'класса'];
    $tok = static function (string $s) use ($stop): array {
        $parts = preg_split('/\s+/u', $s) ?: [];
        $out = [];
        foreach ($parts as $p) {
            $p = trim($p);
            if (mb_strlen($p, 'UTF-8') < 3) {
                continue;
            }
            if (in_array($p, $stop, true)) {
                continue;
            }
            $out[$p] = true;
        }
        return $out;
    };
    $ta = $tok($na);
    $tb = $tok($nb);
    if (!$ta || !$tb) {
        return true;
    }
    $inter = 0;
    foreach ($ta as $k => $_) {
        if (isset($tb[$k])) {
            $inter++;
        }
    }
    $need = min(2, min(count($ta), count($tb)));
    return $inter >= $need;
}

function parsePn(string $s): string
{
    return strtoupper(preg_replace('/\s+/', '', trim($s)) ?? '');
}

function parseEan(string $s): string
{
    return preg_replace('/\D+/', '', $s) ?? '';
}

$client = new Google\Client();
$client->setApplicationName('Uchet1 BAR EAN → Товары');
$client->setAuthConfig($credPath);
$client->setScopes([
    Google\Service\Sheets::SPREADSHEETS,
]);
$sheets = new Google\Service\Sheets($client);

// --- 1) BAR map: MRAER → EAN + name ---
echo "→ читаю лист «{$barTab}»…\n";
$barResp = $sheets->spreadsheets_values->get($barSpreadsheetId, "{$barTab}!A1:G");
$barVals = $barResp->getValues() ?: [];
$barMap = []; // PN => [ean, name]
foreach ($barVals as $i => $r) {
    if ($i < 3) {
        continue;
    }
    $pn = parsePn((string) ($r[1] ?? ''));
    $ean = parseEan((string) ($r[6] ?? ''));
    $name = trim((string) ($r[3] ?? ''));
    if ($pn === '' || $ean === '') {
        continue;
    }
    if ($name === 'Резерв' || str_starts_with($pn, 'RESERV')) {
        continue;
    }
    if (strlen($ean) < 8) {
        continue;
    }
    $barMap[$pn] = ['ean' => $ean, 'name' => $name];
}
echo "  BAR с EAN: " . count($barMap) . "\n";

// --- 2) Товары sheet ---
echo "→ читаю «Товары»…\n";
$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$tabTitle = null;
foreach ($ss->getSheets() as $sh) {
    $p = $sh->getProperties();
    if ((int) $p->getSheetId() === $sheetGid) {
        $tabTitle = $p->getTitle();
        break;
    }
}
if ($tabTitle === null) {
    fwrite(STDERR, "Лист gid={$sheetGid} не найден\n");
    exit(1);
}
$quoted = "'" . str_replace("'", "''", $tabTitle) . "'";
$tovResp = $sheets->spreadsheets_values->get($spreadsheetId, "{$quoted}!A1:Z");
$tovRows = $tovResp->getValues() ?: [];
if (count($tovRows) < 2) {
    fwrite(STDERR, "Пустой лист Товары\n");
    exit(1);
}
$header = $tovRows[0];
$col = static function (array $hdr, string $name): int {
    foreach ($hdr as $i => $h) {
        if (mb_strtolower(trim((string) $h), 'UTF-8') === mb_strtolower($name, 'UTF-8')) {
            return (int) $i;
        }
    }
    return -1;
};
$iArt = $col($header, 'Артикул');
$iCode = $col($header, 'Код');
$iName = $col($header, 'Название');
$iCat = $col($header, 'Категория');
$iId = $col($header, 'id');
$iShk = $col($header, 'ШК');
if ($iArt < 0 || $iId < 0) {
    fwrite(STDERR, "Не найдены колонки Артикул/id\n");
    exit(1);
}
echo "  строк данных: " . (count($tovRows) - 1) . ", ШК col=" . ($iShk >= 0 ? $iShk : 'нет') . "\n";

// --- 3) Prod products index by id ---
echo "→ индекс товаров с VPS…\n";
$fetchJs = <<<'JS'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/warehouse.sqlite', { readOnly: true });
const rows = db.prepare(`
  SELECT p.id, p.sku,
         IFNULL(p.barcode,'') AS barcode,
         IFNULL(p.array_sku,'') AS array_sku,
         IFNULL(p.gtin,'') AS gtin,
         IFNULL(p.name,'') AS name,
         IFNULL(c.name,'') AS cat
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
`).all();
process.stdout.write(JSON.stringify(rows));
JS;
$b64Fetch = base64_encode($fetchJs);
$prodJson = shell_exec(
    'ssh -o BatchMode=yes bank-vps ' .
    escapeshellarg(
        "cd /root/1c_pnevmopodveska1_ru/warehouse && echo '{$b64Fetch}' | base64 -d > /tmp/bar-prods.mjs && node /tmp/bar-prods.mjs && rm -f /tmp/bar-prods.mjs"
    )
);
if (!$prodJson) {
    fwrite(STDERR, "Не удалось прочитать products с VPS\n");
    exit(1);
}
$products = json_decode($prodJson, true);
if (!is_array($products)) {
    fwrite(STDERR, "Битый JSON products\n");
    exit(1);
}
$byId = [];
foreach ($products as $p) {
    if (!is_array($p) || empty($p['id'])) {
        continue;
    }
    $byId[(string) $p['id']] = $p;
}
echo "  products: " . count($byId) . "\n";

$tokensOf = static function (array $p): array {
    $out = [];
    foreach ([parsePn((string) ($p['barcode'] ?? '')), parsePn((string) ($p['sku'] ?? ''))] as $t) {
        if ($t !== '') {
            $out[$t] = true;
        }
    }
    foreach (preg_split('/\s*,\s*/', (string) ($p['array_sku'] ?? '')) ?: [] as $t) {
        $t = parsePn($t);
        if ($t !== '') {
            $out[$t] = true;
        }
    }
    return array_keys($out);
};

// --- 4) Resolve EAN per row ---
$eanCol = []; // rowIndex0-based among data → ean
$stats = [
    'matched_art' => 0,
    'matched_db' => 0,
    'name_reject' => 0,
    'empty' => 0,
    'already' => 0,
];
$dbUpdates = []; // id => ean

for ($r = 1; $r < count($tovRows); $r++) {
    $row = $tovRows[$r];
    $art = parsePn((string) ($row[$iArt] ?? ''));
    $name = trim((string) ($row[$iName] ?? ''));
    $cat = trim((string) ($row[$iCat] ?? ''));
    $id = trim((string) ($row[$iId] ?? ''));
    $existing = $iShk >= 0 ? parseEan((string) ($row[$iShk] ?? '')) : '';

    $hit = null;
    $how = '';

    if ($art !== '' && isset($barMap[$art])) {
        $cand = $barMap[$art];
        if (namesCompatible($name, $cand['name'])) {
            $hit = $cand['ean'];
            $how = 'art';
        } else {
            $stats['name_reject']++;
        }
    }

    if ($hit === null && $id !== '' && isset($byId[$id])) {
        $p = $byId[$id];
        $best = null;
        foreach ($tokensOf($p) as $tok) {
            if (!isset($barMap[$tok])) {
                continue;
            }
            $cand = $barMap[$tok];
            // название с листа или из БД
            $okSheet = namesCompatible($name, $cand['name']);
            $okDb = namesCompatible((string) ($p['name'] ?? ''), $cand['name']);
            if (!$okSheet && !$okDb) {
                continue;
            }
            // категория: если у листа и у БД разные — всё равно берём при совпадении имени
            $best = $cand['ean'];
            break;
        }
        if ($best !== null) {
            $hit = $best;
            $how = 'db';
        }
    }

    if ($hit === null) {
        $stats['empty']++;
        $eanCol[$r] = $existing !== '' ? $existing : '';
        continue;
    }

    if ($how === 'art') {
        $stats['matched_art']++;
    } else {
        $stats['matched_db']++;
    }
    if ($existing !== '' && $existing === $hit) {
        $stats['already']++;
    }
    $eanCol[$r] = $hit;
    if ($id !== '') {
        $dbUpdates[$id] = $hit;
    }
}

echo "  match art={$stats['matched_art']} db={$stats['matched_db']} name_reject={$stats['name_reject']} empty={$stats['empty']} already={$stats['already']}\n";
echo "  unique products for gtin: " . count($dbUpdates) . "\n";

if ($dry) {
    echo "DRY — запись пропущена\n";
    $sample = 0;
    foreach ($eanCol as $ri => $ean) {
        if ($ean === '') {
            continue;
        }
        $row = $tovRows[$ri];
        echo "  ex: " . ($row[$iArt] ?? '') . " → {$ean} · " . mb_substr((string) ($row[$iName] ?? ''), 0, 50) . "\n";
        if (++$sample >= 8) {
            break;
        }
    }
    exit(0);
}

// --- 5) Ensure ШК column ---
if ($iShk < 0) {
    echo "→ вставляю столбец «ШК» после «Артикул»…\n";
    $insertAt = $iArt + 1;
    $batch = new Google\Service\Sheets\BatchUpdateSpreadsheetRequest([
        'requests' => [
            [
                'insertDimension' => [
                    'range' => [
                        'sheetId' => $sheetGid,
                        'dimension' => 'COLUMNS',
                        'startIndex' => $insertAt,
                        'endIndex' => $insertAt + 1,
                    ],
                    'inheritFromBefore' => true,
                ],
            ],
        ],
    ]);
    $sheets->spreadsheets->batchUpdate($spreadsheetId, $batch);
    $iShk = $insertAt;
    // shift logical indices after insert for our local header tracking
    $colLetter = chr(ord('A') + $iShk);
    $sheets->spreadsheets_values->update(
        $spreadsheetId,
        "{$quoted}!{$colLetter}1",
        new Google\Service\Sheets\ValueRange(['values' => [['ШК']]]),
        ['valueInputOption' => 'RAW']
    );
} else {
    echo "→ столбец «ШК» уже есть (index {$iShk})\n";
}

// --- 6) Write ШК values ---
echo "→ пишу ШК в лист…\n";
$colLetter = '';
$n = $iShk;
while ($n >= 0) {
    $colLetter = chr(ord('A') + ($n % 26)) . $colLetter;
    $n = intdiv($n, 26) - 1;
}
$values = [];
for ($r = 1; $r < count($tovRows); $r++) {
    $values[] = [$eanCol[$r] ?? ''];
}
$range = "{$quoted}!{$colLetter}2:{$colLetter}" . (count($values) + 1);
$sheets->spreadsheets_values->update(
    $spreadsheetId,
    $range,
    new Google\Service\Sheets\ValueRange(['values' => $values]),
    ['valueInputOption' => 'RAW']
);
echo "  записано " . count($values) . " ячеек ({$colLetter})\n";

// --- 7) Update gtin on prod ---
if (!$skipDb && $dbUpdates) {
    echo "→ обновляю gtin на VPS…\n";
    $tmpLocal = sys_get_temp_dir() . '/bar-gtin-updates.json';
    file_put_contents($tmpLocal, json_encode($dbUpdates, JSON_UNESCAPED_UNICODE));
    $remote = '/tmp/bar-gtin-updates.json';
    passthru('scp -o BatchMode=yes ' . escapeshellarg($tmpLocal) . ' bank-vps:' . escapeshellarg($remote), $scpCode);
    if ($scpCode !== 0) {
        fwrite(STDERR, "scp failed\n");
        exit(1);
    }
    $node = <<<'JS'
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const map = JSON.parse(fs.readFileSync('/tmp/bar-gtin-updates.json', 'utf8'));
const db = new DatabaseSync('data/warehouse.sqlite');
const upd = db.prepare(`UPDATE products SET gtin = ? WHERE id = ? AND (IFNULL(gtin,'') = '' OR gtin = ?)`);
const force = db.prepare(`UPDATE products SET gtin = ? WHERE id = ?`);
let n = 0, skipped = 0;
const tx = db.prepare('BEGIN'); const cm = db.prepare('COMMIT');
tx.run();
for (const [id, ean] of Object.entries(map)) {
  const cur = db.prepare(`SELECT IFNULL(gtin,'') AS gtin FROM products WHERE id = ?`).get(id);
  if (!cur) { skipped++; continue; }
  if (cur.gtin && cur.gtin !== ean) {
    // не затираем чужой gtin без нужды — пишем если пусто или тот же
    skipped++;
    continue;
  }
  force.run(ean, id);
  n++;
}
cm.run();
console.log(JSON.stringify({ updated: n, skipped }));
JS;
    $b64 = base64_encode($node);
    passthru(
        'ssh -o BatchMode=yes bank-vps ' .
        escapeshellarg("cd /root/1c_pnevmopodveska1_ru/warehouse && echo '$b64' | base64 -d > /tmp/bar-gtin.mjs && node /tmp/bar-gtin.mjs && rm -f /tmp/bar-gtin.mjs /tmp/bar-gtin-updates.json"),
        $nodeCode
    );
    @unlink($tmpLocal);
    if ($nodeCode !== 0) {
        fwrite(STDERR, "gtin update failed\n");
        exit(1);
    }
}

$url = "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$sheetGid}";
echo "OK {$url}\n";
