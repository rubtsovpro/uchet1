<?php
declare(strict_types=1);
require '/root/bank_pnevmopodveska1_ru/public_html/vendor/autoload.php';
$client = new Google_Client();
$client->setAuthConfig('/root/bank_pnevmopodveska1_ru/public_html/pnevmopodveska1-677b14845bb0.json');
$client->setScopes([Google_Service_Sheets::SPREADSHEETS]);
$sheets = new Google_Service_Sheets($client);
$id = '1QvYC0DS9JSO-NFrjmMG1NAqa1jxwbpIVUBs1ygJqyfw';
$r = $sheets->spreadsheets_values->get($id, "'Расхождения 26.08.2026'!A1:N500");
$values = $r->getValues() ?: [];
$need = ['00-00006772@PODVESKA', '37106869038@PODVESKA', '95B616002A', 'A1663206813@PODVESKA', 'A2043233000@PODVESKA'];
foreach ($values as $i => $row) {
  $sku = trim((string) ($row[1] ?? ''));
  if (in_array($sku, $need, true)) {
    echo ($i + 1) . ': ' . $sku . ' | ' . trim((string) ($row[2] ?? '')) . "\n";
  }
}
$miss = 0;
foreach ($values as $i => $row) {
  if ($i < 8) {
    continue;
  }
  $status = trim((string) ($row[0] ?? ''));
  if ($status === '') {
    continue;
  }
  $sku = trim((string) ($row[1] ?? ''));
  $name = trim((string) ($row[2] ?? ''));
  if ($sku !== '' && $name === '') {
    $miss++;
    if ($miss <= 10) {
      echo 'MISS ' . ($i + 1) . ': ' . $sku . "\n";
    }
  }
}
echo "empty names left: {$miss}\n";
