<?php
/**
 * DEPRECATED: столбец G «Применимость программная» больше не используется.
 *
 * Источник истины — столбец Y «ПРИМЕНИМОСТЬ (все машины)» в листе
 * https://docs.google.com/spreadsheets/d/1KRNwQIi-jYBDtKYl5rQ9is6zngbPds0ZZvBXWCApn7I
 *
 * WMS читает только Y (sync_msk_nomen_meta_hourly / import_msk_nomen_master_sheet).
 * Этот скрипт больше ничего не пишет в лист.
 */
declare(strict_types=1);

fwrite(STDERR, "DEPRECATED: не пишем в G. Применимость — только столбец Y «ПРИМЕНИМОСТЬ (все машины)».\n");
exit(1);
