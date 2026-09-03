<?php
/** Generate web/public/sto-templates-pack.json for Apps Script / bind. */
declare(strict_types=1);
$root = dirname(__DIR__);
$txtDir = $root . '/api/assets/sto-templates/txt';
$macrosPath = $root . '/docs/sto-templates/MACROS.txt';

function macroizeStoText(string $text): string
{
    $text = str_replace(["\r\n", "\r"], "\n", $text);
    $subs = [
        '/индивидуальн(?:ый|ому)\s+предпринимател[^\n_]{0,40}_{6,}/iu' => 'индивидуальный предприниматель {{Организация}}',
        '/Исполнитель:\s*ИП\s*_{6,}/u' => 'Исполнитель: ИП {{Организация}}',
        '/Исполнитель:\s*индивидуальный предприниматель\s*_{6,}/iu' => 'Исполнитель: индивидуальный предприниматель {{Организация}}',
        '/ОГРНИП\s*_{6,}/u' => 'ОГРНИП {{ОГРНОрганизации}}',
        '/ИНН\s*_{6,}(?!\s*Заказ)/u' => 'ИНН {{ИННОрганизации}}',
        '/тел\.\s*_{6,}/u' => 'тел. {{ТелефонОрганизации}}',
        '/телефон\s*_{6,}/iu' => 'телефон {{ТелефонОрганизации}}',
        '/адрес электронной почты\s*_{6,}/iu' => 'адрес электронной почты {{Email}}',
        '/e-mail:\s*_{6,}/iu' => 'e-mail: {{Email}}',
        '/Заказчик:\s*_{6,}/u' => 'Заказчик: {{Покупатель}}',
        '/Я,\s*_{6,}/u' => 'Я, {{ФИО}}',
        '/гражданин\s*_{6,}/iu' => 'гражданин {{ФИО}}',
        '/паспорт серия\s*_{3,}\s*№\s*_{6,}/iu' => 'паспорт {{ДокументЗаказчика}}',
        '/зарегистрирован\(а\) по адресу:\s*_{6,}/iu' => 'зарегистрирован(а) по адресу: {{Адрес}}',
        '/адрес:\s*_{6,}/iu' => 'адрес: {{Адрес}}',
        '/Адрес регистрации по месту жительства:\s*_{6,}/u' => 'Адрес регистрации по месту жительства: {{АдресОрганизации}}.',
        '/Адрес места оказания услуг[^\n:]{0,40}:\s*_{6,}/u' => 'Адрес места оказания услуг (станция технического обслуживания): {{АдресОрганизации}}.',
        '/г\.\s*_{6,}/u' => 'г. {{Город}}',
        '/Договору №\s*_{3,}/u' => 'Договору № {{НомерДоговора}}',
        '/Договор №\s*_{3,}/u' => 'Договор № {{Номер}}',
        '/заказ-наряду\) №\s*_{3,}/u' => 'заказ-наряду) № {{Номер}}',
        '/АКТ №\s*_{3,}/u' => 'АКТ № {{Номер}}',
        '/Приложение № 2 к Договору №\s*_{3,}/u' => 'Приложение № 2 к Договору № {{НомерДоговора}}',
        '/Марка, модель\n\n/u' => "Марка, модель\n{{Марка}} {{Модель}}\n\n",
        '/Год выпуска\n\n/u' => "Год выпуска\n{{Год}}\n\n",
        '/VIN \(идентификационный номер\)\n\n/u' => "VIN (идентификационный номер)\n{{VIN}}\n\n",
        '/Идентификационный номер \(VIN\)\n\n/u' => "Идентификационный номер (VIN)\n{{VIN}}\n\n",
        '/Гос\. рег\. знак\n\n/u' => "Гос. рег. знак\n{{Госномер}}\n\n",
        '/Цвет\n\n/u' => "Цвет\n{{Цвет}}\n\n",
        '/Пробег по одометру, км\n\n/u' => "Пробег по одометру, км\n{{Пробег}}\n\n",
        '/Пробег по одометру на дату приёма, км\n\n/u' => "Пробег по одометру на дату приёма, км\n{{Пробег}}\n\n",
        '/Уровень топлива\n\n/u' => "Уровень топлива\n{{УровеньТоплива}}\n\n",
        '/№ двигателя \/ кузова \/ шасси\n\n/u' => "№ двигателя / кузова / шасси\n{{НомерДвигателя}}\n\n",
    ];
    foreach ($subs as $re => $rep) {
        $text = preg_replace($re, $rep, $text) ?? $text;
    }
    return preg_replace('/«____»\s*_{0,12}\s*20____\s*г\./u', '{{ДатаДлинная}}', $text) ?? $text;
}

/** Только клиентские бланки из пакета заказчика (6 шт.). */
$items = [
    ['id' => 'sto-contract-person', 'title' => '01 · Договор физлицо', 'txt' => '01-contract-person.txt', 'tpl' => 'tpl-sto-contract-person', 'sto_template_id' => 'sto-contract-person', 'source' => 'Договор-оферта для физиков.docx'],
    ['id' => 'sto-contract-legal', 'title' => '02 · Договор юр ИП', 'txt' => '02-contract-legal.txt', 'tpl' => 'tpl-sto-contract-legal', 'sto_template_id' => 'sto-contract-legal', 'source' => 'Договор с юр.лицом.docx'],
    ['id' => 'sto-workorder-person', 'title' => '03ф · ЗН физлицо', 'txt' => '03-workorder-person.txt', 'tpl' => 'tpl-sto-workorder-person', 'sto_template_id' => 'sto-workorder-person', 'source' => 'Заказ-наряд для физика.docx'],
    ['id' => 'sto-workorder-legal', 'title' => '03ю · ЗН юр ИП', 'txt' => '03-workorder-legal.txt', 'tpl' => 'tpl-sto-workorder-legal', 'sto_template_id' => 'sto-workorder-legal', 'source' => 'Наряд-заказ юр. лицо.docx'],
    ['id' => 'sto-pdn-consent', 'title' => '11 · Согласие ПДн', 'txt' => '11-pdn-consent.txt', 'tpl' => 'tpl-sto-pdn-consent', 'sto_template_id' => 'sto-pdn-consent', 'source' => 'Согласие на перс данные.docx'],
];

$out = [
    'folder_id' => '1jjmTeuMnTxH5V9I-WPSR97m43nMFBsY1',
    'folder_url' => 'https://drive.google.com/drive/folders/1jjmTeuMnTxH5V9I-WPSR97m43nMFBsY1',
    'generated_at' => gmdate('c'),
    'items' => [],
];
foreach ($items as $it) {
    $text = $it['txt'] === null
        ? (string) file_get_contents($macrosPath)
        : macroizeStoText((string) file_get_contents($txtDir . '/' . $it['txt']));
    $out['items'][] = [
        'id' => $it['id'],
        'name' => 'СТО ' . $it['title'],
        'tpl' => $it['tpl'],
        'sto_template_id' => $it['sto_template_id'],
        'text' => $text,
    ];
}
$path = $root . '/web/public/sto-templates-pack.json';
file_put_contents($path, json_encode($out, JSON_UNESCAPED_UNICODE));
echo "OK {$path} " . filesize($path) . " B, " . count($out['items']) . " items\n";
