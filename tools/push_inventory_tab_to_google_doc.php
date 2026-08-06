<?php
/**
 * Вкладка «Перенос в Учёт №1» — Docs API (SA), паттерн _push_markdown_tab_lib.
 * Создаёт НОВУЮ вкладку, если title ещё нет (preferredTabId заведомо несуществующий).
 */
declare(strict_types=1);

$docId = '1FhZzPLBWwxTpB-1PUogEjJsXpGZDoWzTy1CIFIU67v0';
$tabTitle = 'Перенос в Учёт №1';
$preferredTabId = 't.f2s6zi5lg8l0';
$tabTitleAliases = ['Перенос в Учёт №1', 'Инвентаризация контура'];
$credPath = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json';
$autoload = '/Users/a_/Downloads/php/new_serv/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$textPath = '/Users/a_/Downloads/php/uchetn1/docs/INVENTORY-migrate-uchet1.md';
$appName = 'Uchet1 Inventory migrate tab';

require __DIR__ . '/_push_markdown_tab_lib.php';
