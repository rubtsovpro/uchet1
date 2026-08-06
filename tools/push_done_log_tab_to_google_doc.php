<?php
/**
 * Вкладка «Сделано · журнал работ Учёт №1» — Docs API (SA).
 * Только НОВАЯ вкладка — не трогать t.0.
 */
declare(strict_types=1);

$docId = '1FhZzPLBWwxTpB-1PUogEjJsXpGZDoWzTy1CIFIU67v0';
$tabTitle = 'Сделано · журнал работ Учёт №1';
// Новый tab id подставится при create; несуществующий id → create by title.
$preferredTabId = 't.qyia2dttt2ut';
$tabTitleAliases = ['Сделано · журнал', 'журнал работ Учёт', 'DONE log'];
$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$textPath = '/Users/a_/Downloads/php/uchetn1/docs/DONE-log-uchet1.md';
$appName = 'Uchet1 DONE log tab';

require __DIR__ . '/_push_markdown_tab_lib.php';
