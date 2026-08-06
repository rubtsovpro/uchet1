<?php
/**
 * CLI wrapper for _push_markdown_tab_lib.php
 * Args: docId tabTitle preferredTabId textPath credPath autoload appName [aliasesPipeSeparated]
 */
declare(strict_types=1);

if ($argc < 8) {
    fwrite(STDERR, "Usage: php _push_one_tab_cli.php docId title prefId textPath cred autoload appName [aliases]\n");
    exit(1);
}

$docId = $argv[1];
$tabTitle = $argv[2];
$preferredTabId = $argv[3];
$textPath = $argv[4];
$credPath = $argv[5];
$autoload = $argv[6];
$appName = $argv[7];
$tabTitleAliases = [];
if (isset($argv[8]) && $argv[8] !== '') {
    $tabTitleAliases = array_values(array_filter(explode('|', $argv[8])));
}

require __DIR__ . '/_push_markdown_tab_lib.php';
