<?php
/**
 * Push roadmap overview + §1–§18 implementation tabs to Google Doc.
 * Sequential (rate limits). Reuses _push_markdown_tab_lib.php via subprocess.
 *
 * Usage:
 *   php push_roadmap_tabs_batch.php           # all
 *   php push_roadmap_tabs_batch.php overview  # only roadmap
 *   php push_roadmap_tabs_batch.php 4         # only §4
 *   php push_roadmap_tabs_batch.php 1-3       # range
 */
declare(strict_types=1);

$docId = '1FhZzPLBWwxTpB-1PUogEjJsXpGZDoWzTy1CIFIU67v0';
$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$docsDir = '/Users/a_/Downloads/php/uchetn1/docs';
$sectionsDir = $docsDir . '/sections';
$selfDir = __DIR__;
$sleepSec = 2;

$jobs = [
    [
        'key' => 'overview',
        'tabTitle' => 'Роадмап · рыночная оценка',
        'preferredTabId' => 't.3wjlpgeoh5bf',
        'tabTitleAliases' => ['Роадмап · рыночная оценка', 'Роадмап · можем сейчас', 'Роадмап и оценка'],
        'textPath' => $docsDir . '/ROADMAP-uchet1.md',
        'appName' => 'Uchet1 Roadmap overview',
    ],
];

$sectionMeta = [
    1 => ['TZ-impl-01-glavnoe.md', '§1 Главное — реализация', 't.2o8t79nkzprx'],
    2 => ['TZ-impl-02-nomenklatura.md', '§2 Номенклатура — реализация', 't.e1uolayvc91o'],
    3 => ['TZ-impl-03-crm.md', '§3 CRM — реализация', 't.3dsc0nhrrcoj'],
    4 => ['TZ-impl-04-zakupki.md', '§4 Закупки — реализация', 't.j3hqwbk73s5b'],
    5 => ['TZ-impl-05-prodazhi.md', '§5 Продажи — реализация', 't.o74b9pawe59c'],
    6 => ['TZ-impl-06-sklad.md', '§6 Склад — реализация', 't.jsx8h5lmo96k'],
    7 => ['TZ-impl-07-sdek.md', '§7 СДЭК — реализация', 't.t34ilg40bv75'],
    8 => ['TZ-impl-08-dengi.md', '§8 Деньги — реализация', 't.dpzmvhm6mlue'],
    9 => ['TZ-impl-09-sto.md', '§9 СТО — реализация', 't.cjl2fq1r5hat'],
    10 => ['TZ-impl-10-proizvodstvo.md', '§10 Производство — реализация', 't.4vtpqhe50s9j'],
    11 => ['TZ-impl-11-mp.md', '§11 Маркетплейсы — реализация', 't.vdp0s5l81p6w'],
    12 => ['TZ-impl-12-markirovka.md', '§12 Маркировка — реализация', 't.rp9ki6ulcbl4'],
    13 => ['TZ-impl-13-personal.md', '§13 Персонал — реализация', 't.k54qbay0p02u'],
    14 => ['TZ-impl-14-kompaniya.md', '§14 Компания — реализация', 't.smyhed7cvb79'],
    15 => ['TZ-impl-15-nastroiki.md', '§15 Настройки — реализация', 't.http1hlbddrm'],
    16 => ['TZ-impl-16-analitika.md', '§16 Аналитика — реализация', 't.yn5dxkhj7zk9'],
    17 => ['TZ-impl-17-integracii.md', '§17 Интеграции — реализация', 't.l61frvafopqy'],
    18 => ['TZ-impl-18-pomosh.md', '§18 Помощь — реализация', 't.dpvq2q7dcq17'],
];

foreach ($sectionMeta as $num => [$file, $title, $pref]) {
    $jobs[] = [
        'key' => (string) $num,
        'tabTitle' => $title,
        'preferredTabId' => $pref,
        'tabTitleAliases' => [$title],
        'textPath' => $sectionsDir . '/' . $file,
        'appName' => "Uchet1 impl §{$num}",
    ];
}

$arg = $argv[1] ?? 'all';
$selected = [];
if ($arg === 'all') {
    $selected = $jobs;
} elseif ($arg === 'overview') {
    $selected = [$jobs[0]];
} elseif (preg_match('/^(\d+)-(\d+)$/', $arg, $m)) {
    $from = (int) $m[1];
    $to = (int) $m[2];
    foreach ($jobs as $j) {
        if ($j['key'] === 'overview') {
            continue;
        }
        $n = (int) $j['key'];
        if ($n >= $from && $n <= $to) {
            $selected[] = $j;
        }
    }
} elseif (ctype_digit($arg)) {
    foreach ($jobs as $j) {
        if ($j['key'] === $arg) {
            $selected[] = $j;
        }
    }
} else {
    fwrite(STDERR, "Usage: php push_roadmap_tabs_batch.php [all|overview|N|N-M]\n");
    exit(1);
}

if ($selected === []) {
    fwrite(STDERR, "No jobs matched\n");
    exit(1);
}

$wrapper = $selfDir . '/_push_one_tab_cli.php';
if (!is_file($wrapper)) {
    fwrite(STDERR, "Missing $wrapper\n");
    exit(1);
}

$results = [];
$total = count($selected);
foreach ($selected as $i => $job) {
    $n = $i + 1;
    echo "\n======== [$n/$total] {$job['tabTitle']} ========\n";
    if (!is_file($job['textPath'])) {
        fwrite(STDERR, "Missing file {$job['textPath']}\n");
        exit(1);
    }
    $cmd = [
        PHP_BINARY,
        $wrapper,
        $docId,
        $job['tabTitle'],
        $job['preferredTabId'],
        $job['textPath'],
        $credPath,
        $autoload,
        $job['appName'],
        implode('|', $job['tabTitleAliases']),
    ];
    $cmdLine = '';
    foreach ($cmd as $c) {
        $cmdLine .= ' ' . escapeshellarg($c);
    }
    passthru(ltrim($cmdLine), $code);
    if ($code !== 0) {
        fwrite(STDERR, "FAILED code=$code for {$job['tabTitle']}\n");
        exit($code);
    }
    $results[] = $job['tabTitle'];
    if ($n < $total) {
        sleep($sleepSec);
    }
}

echo "\n======== DONE {$total} tabs ========\n";
foreach ($results as $t) {
    echo "  - $t\n";
}
