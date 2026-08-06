<?php
/**
 * Вкладка «Моё виденье» — Docs API (SA).
 * Только НОВАЯ вкладка — не трогать t.0 и прочие §/Смету/Экономию.
 */
declare(strict_types=1);

$docId = '1FhZzPLBWwxTpB-1PUogEjJsXpGZDoWzTy1CIFIU67v0';
$tabTitle = 'Моё виденье';
// Несуществующий id → create by title.
$preferredTabId = 't.jyuav6c8r0l5';
$tabTitleAliases = ['Мое виденье', 'Моё видение', 'Мое видение', 'VISION'];
$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$textPath = '/Users/a_/Downloads/php/uchetn1/docs/VISION-uchet1.md';
$appName = 'Uchet1 Vision rent-expert tab';

require __DIR__ . '/_push_markdown_tab_lib.php';
