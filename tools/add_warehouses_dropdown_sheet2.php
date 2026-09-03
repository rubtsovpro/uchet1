<?php
/**
 * Лист2 (gid 245905383): столбец I — выпадающий список складов Москвы из WMS
 * (как карточки UI: Основной / Б/У / Брак / Курьер / Ожидание оплаты / Отложено под СТО / СТО).
 *
 *   php tools/add_warehouses_dropdown_sheet2.php
 */
declare(strict_types=1);

$spreadsheetId = getenv('SHEET_ID') ?: '1eW2wcijS59Or5YMVrmzCCVOmIbc9HgDMeEEaCgf4hMw';
$gid = 245905383;
$listTab = '_warehouses_dropdown';

$bankCandidates = [
    dirname(__DIR__, 2) . '/bank_pnevmopodveska1_ru/public_html',
    dirname(__DIR__) . '/../bank_pnevmopodveska1_ru/public_html',
    '/root/bank_pnevmopodveska1_ru/public_html',
];
$cred = '';
$auto = '';
foreach ($bankCandidates as $base) {
    $c = $base . '/pnevmopodveska1-677b14845bb0.json';
    $a = $base . '/vendor/autoload.php';
    if (is_file($c) && is_file($a)) {
        $cred = $c;
        $auto = $a;
        break;
    }
}
if ($cred === '') {
    fwrite(STDERR, "Нет credentials Google Sheets\n");
    exit(1);
}
require $auto;

$sqliteCandidates = [
    dirname(__DIR__) . '/data/warehouse.sqlite',
    '/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite',
];
$dbPath = '';
foreach ($sqliteCandidates as $p) {
    if (is_file($p)) {
        $dbPath = $p;
        break;
    }
}
if ($dbPath === '') {
    fwrite(STDERR, "Нет warehouse.sqlite\n");
    exit(1);
}

/** Как whDisplayName в legacy.js — только Москва. */
function whSheetLabel(string $code, string $name): string
{
    $code = trim($code);
    $name = trim($name);
    if ($code === 'НФ-000032' || preg_match('/^филиал\s*москва$/iu', $name)) {
        return 'Основной';
    }
    if ($code === 'STO-RES-MSK') {
        return 'Отложено под СТО';
    }
    if ($code === 'STO' || preg_match('/^склад\s*сто$/iu', $name)) {
        return 'СТО';
    }
    if ($code === 'COURIER' || preg_match('/^склад\s*курьера$/iu', $name)) {
        return 'Курьер';
    }
    if ($code === 'WAIT-PAY' || preg_match('/^ожидание\s*оплаты$/iu', $name)) {
        return 'Ожидание оплаты';
    }
    if ($code === 'НФ-000037' || preg_match('/склад\s*брак|брак.*рекламац/iu', $name)) {
        return 'Брак/Рекламация';
    }
    if ($code === 'НФ-000034' || preg_match('/б\/?у\s*зпч|склад\s*б\/?у/iu', $name)) {
        return 'Б/У запчасти';
    }
    return '';
}

/** Жёсткий allowlist Москвы (как карточки UI; без 00-000001 / Стрела / Фадеева). */
const MSK_WH_CODES = [
    'НФ-000032', // Основной
    'НФ-000034', // Б/У запчасти
    'НФ-000037', // Брак/Рекламация
    'COURIER',
    'WAIT-PAY',
    'STO-RES-MSK',
    'STO',
];

/** Эталон подписей для столбца I — совпадает с карточками UI Москвы. */
const MSK_WH_LABELS = [
    'Б/У запчасти',
    'Брак/Рекламация',
    'Курьер',
    'Ожидание оплаты',
    'Основной',
    'Отложено под СТО',
    'СТО',
];

$pdo = new PDO('sqlite:' . $dbPath);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$placeholders = implode(',', array_fill(0, count(MSK_WH_CODES), '?'));
$stmt = $pdo->prepare(
    "SELECT IFNULL(w.code,'') AS code, IFNULL(w.name,'') AS name
     FROM warehouses w
     WHERE IFNULL(w.is_active,1)=1
       AND IFNULL(w.code,'') IN ({$placeholders})
     ORDER BY w.name COLLATE NOCASE"
);
$stmt->execute(MSK_WH_CODES);
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

$labels = [];
foreach ($rows as $r) {
    $label = whSheetLabel((string) $r['code'], (string) $r['name']);
    if ($label !== '') {
        $labels[$label] = true;
    }
}
// Локальная sqlite часто без боевых кодов — берём эталон UI.
if (count($labels) < 5) {
    foreach (MSK_WH_LABELS as $lab) {
        $labels[$lab] = true;
    }
} elseif (!isset($labels['Ожидание оплаты'])) {
    $labels['Ожидание оплаты'] = true;
}

$whNames = array_keys($labels);
sort($whNames, SORT_NATURAL | SORT_FLAG_CASE);
if ($whNames === []) {
    fwrite(STDERR, "Пустой список складов\n");
    exit(1);
}

$client = new Google\Client();
$client->setAuthConfig($cred);
$client->setScopes([Google\Service\Sheets::SPREADSHEETS]);
$sheets = new Google\Service\Sheets($client);

$ss = $sheets->spreadsheets->get($spreadsheetId, ['fields' => 'sheets.properties']);
$sheetId = null;
$title = null;
$rowCount = 1000;
$listSheetId = null;
foreach ($ss->getSheets() ?? [] as $sh) {
    $p = $sh->getProperties();
    $sid = (int) $p->getSheetId();
    $t = (string) $p->getTitle();
    if ($sid === $gid) {
        $sheetId = $sid;
        $title = $t;
        $rowCount = max(2, (int) $p->getGridProperties()->getRowCount());
    }
    if ($t === $listTab) {
        $listSheetId = $sid;
    }
}
if ($sheetId === null || $title === null) {
    fwrite(STDERR, "Лист gid={$gid} не найден\n");
    exit(1);
}

if ($listSheetId === null) {
    $add = $sheets->spreadsheets->batchUpdate(
        $spreadsheetId,
        new Google\Service\Sheets\BatchUpdateSpreadsheetRequest([
            'requests' => [[
                'addSheet' => [
                    'properties' => [
                        'title' => $listTab,
                        'hidden' => true,
                        'gridProperties' => [
                            'rowCount' => max(50, count($whNames) + 5),
                            'columnCount' => 2,
                        ],
                    ],
                ],
            ]],
        ])
    );
    foreach ($add->getReplies() ?? [] as $reply) {
        if ($reply->getAddSheet()) {
            $listSheetId = (int) $reply->getAddSheet()->getProperties()->getSheetId();
        }
    }
}
if ($listSheetId === null) {
    fwrite(STDERR, "Не создался служебный лист {$listTab}\n");
    exit(1);
}

$quotedList = "'" . str_replace("'", "''", $listTab) . "'";
$listValues = [['Склад']];
foreach ($whNames as $n) {
    $listValues[] = [$n];
}
// Затираем старый длинный список пустыми ячейками
$padTo = 40;
while (count($listValues) < $padTo) {
    $listValues[] = [''];
}
$sheets->spreadsheets_values->update(
    $spreadsheetId,
    "{$quotedList}!A1",
    new Google\Service\Sheets\ValueRange([
        'range' => "{$quotedList}!A1",
        'majorDimension' => 'ROWS',
        'values' => $listValues,
    ]),
    ['valueInputOption' => 'RAW']
);

$quotedMain = "'" . str_replace("'", "''", $title) . "'";
$sheets->spreadsheets_values->update(
    $spreadsheetId,
    "{$quotedMain}!I1",
    new Google\Service\Sheets\ValueRange([
        'range' => "{$quotedMain}!I1",
        'majorDimension' => 'ROWS',
        'values' => [['Склад']],
    ]),
    ['valueInputOption' => 'USER_ENTERED']
);

$listEnd = count($whNames) + 1;
$rangeA1 = "={$quotedList}!\$A\$2:\$A\${$listEnd}";

$sheets->spreadsheets->batchUpdate(
    $spreadsheetId,
    new Google\Service\Sheets\BatchUpdateSpreadsheetRequest([
        'requests' => [
            [
                'updateSheetProperties' => [
                    'properties' => ['sheetId' => $listSheetId, 'hidden' => true],
                    'fields' => 'hidden',
                ],
            ],
            [
                'setDataValidation' => [
                    'range' => [
                        'sheetId' => $sheetId,
                        'startRowIndex' => 1,
                        'endRowIndex' => $rowCount,
                        'startColumnIndex' => 8, // I
                        'endColumnIndex' => 9,
                    ],
                    'rule' => [
                        'condition' => [
                            'type' => 'ONE_OF_RANGE',
                            'values' => [['userEnteredValue' => $rangeA1]],
                        ],
                        'showCustomUi' => true,
                        'strict' => false,
                        'inputMessage' => 'Выберите склад Москвы',
                    ],
                ],
            ],
            [
                'repeatCell' => [
                    'range' => [
                        'sheetId' => $sheetId,
                        'startRowIndex' => 0,
                        'endRowIndex' => 1,
                        'startColumnIndex' => 8,
                        'endColumnIndex' => 9,
                    ],
                    'cell' => [
                        'userEnteredFormat' => [
                            'textFormat' => ['bold' => true],
                        ],
                    ],
                    'fields' => 'userEnteredFormat.textFormat.bold',
                ],
            ],
        ],
    ])
);

fwrite(STDOUT, 'Складов в списке (Москва): ' . count($whNames) . "\n");
foreach ($whNames as $n) {
    fwrite(STDOUT, " - {$n}\n");
}
fwrite(STDOUT, "https://docs.google.com/spreadsheets/d/{$spreadsheetId}/edit#gid={$gid}\n");
