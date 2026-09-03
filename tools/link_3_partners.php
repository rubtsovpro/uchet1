<?php
declare(strict_types=1);
$pdo = new PDO('sqlite:/root/1c_pnevmopodveska1_ru/warehouse/data/warehouse.sqlite');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$map = [
  ['d63db629-687a-11f0-b04b-0050569b6f2b', '26341289', '%Владимир%Ватутин%'],
  ['847d82fc-8d74-11f0-b04b-0050569b6f2b', '26341343', '%Демид%Валери%'],
  ['cf954c56-c463-11f0-b04b-0050569b6f2b', '26341361', '%Санек%Арк%'],
];

$stById = $pdo->prepare('SELECT id, name, amo_company_id, is_partner FROM counterparties WHERE id = ?');
$stByName = $pdo->prepare('SELECT id, name, amo_company_id, is_partner FROM counterparties WHERE name LIKE ? LIMIT 5');
$stUpd = $pdo->prepare('UPDATE counterparties SET is_partner = 1, amo_company_id = ? WHERE id = ?');

foreach ($map as [$wmsId, $amoId, $like]) {
    echo "--- amo={$amoId} ---\n";
    $stById->execute([$wmsId]);
    $rows = $stById->fetchAll(PDO::FETCH_ASSOC);
    if (!$rows) {
        $stByName->execute([$like]);
        $rows = $stByName->fetchAll(PDO::FETCH_ASSOC);
    }
    if (!$rows) {
        echo "  NOT FOUND in WMS\n";
        continue;
    }
    foreach ($rows as $r) {
        echo "  before: partner={$r['is_partner']} amo={$r['amo_company_id']} name={$r['name']}\n";
        $stUpd->execute([$amoId, $r['id']]);
        echo "  linked amo_company_id={$amoId}, is_partner=1\n";
    }
}

echo "\nVerify:\n";
$q = $pdo->prepare('SELECT name, is_partner, amo_company_id FROM counterparties WHERE amo_company_id = ?');
foreach (['26341289', '26341343', '26341361'] as $a) {
    $q->execute([$a]);
    $r = $q->fetch(PDO::FETCH_ASSOC);
    echo $r
      ? "OK amo={$a} partner={$r['is_partner']} {$r['name']}\n"
      : "MISSING amo={$a}\n";
}
