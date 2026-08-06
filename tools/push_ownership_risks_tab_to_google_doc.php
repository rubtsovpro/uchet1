<?php
/**
 * Вкладка «Оценка п.7 / коммерческие границы» — Docs API (SA).
 */
declare(strict_types=1);

$docId = '1FhZzPLBWwxTpB-1PUogEjJsXpGZDoWzTy1CIFIU67v0';
// Только НОВАЯ вкладка Исполнителя — не трогать t.yk6mbwgvhpmz и прочие вкладки Заказчика.
$tabTitle = 'Оценка п.7 — позиция Исполнителя';
$preferredTabId = 't.ii6vwm63m8b1';
// Узкие aliases: совпадение только с нашей вкладкой, не с «Не учтено» / стек / аналитика.
$tabTitleAliases = ['позиция Исполнителя'];
$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$textPath = '/Users/a_/Downloads/php/uchetn1/docs/TZ-ocenka-vladenie-riski.md';
$appName = 'Uchet1 Clause7 executor position tab';

require __DIR__ . '/_push_markdown_tab_lib.php';
