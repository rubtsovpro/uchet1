/**
 * Шаблоны документов (Google Doc + макросы {{…}}).
 * UI: Настройки → Шаблоны документов (/settings/doc-templates).
 * Хранение: meta.doc_templates_config
 * Печать СТО читает TXT из кэша. После правок в Google Doc жмите «Подтянуть в Учёт».
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, run } from './db.js';
import { newGuid } from './ids.js';
import {
  exportDriveFilePlainText,
  GOOGLE_SA_EMAIL,
  listDriveFolderFiles,
  type DriveListFile,
} from './google-sa.js';
import { getStoDocTemplate, STO_TEMPLATES_ROOT } from './sto-doc-templates.js';
import {
  clearStoDriveMemCache,
  resolveStoDriveFileId,
  stoOwnerKeyFromInn,
} from './sto-drive-load.js';
import { loadStoTemplateDocxBuffer } from './sto-docx-pdf.js';
import { buildSaleDocPackMatrix } from './deal-sale-rules.js';
import { getOrgProfile, resolveOrganizationId } from './organizations.js';

const META_KEY = 'doc_templates_config';
const GDRIVE_TEMPLATES_FOLDER = '1jjmTeuMnTxH5V9I-WPSR97m43nMFBsY1';

export type DocTemplateAudience = 'person' | 'legal' | 'ip' | 'partner' | 'any';
export type DocTemplateUseFor =
  | 'contract'
  | 'workorder'
  | 'invoice'
  | 'sto'
  | 'sale'
  | 'pickup'
  | 'delivery'
  | 'other';

export type DocMacroDef = {
  key: string;
  label: string;
  example?: string;
  group: string;
};

export type DocTemplateRow = {
  id: string;
  title: string;
  google_doc_url: string;
  google_doc_id: string;
  /** Для кого: физ / юр / ИП / партнёр / любой */
  audience: DocTemplateAudience[];
  /** Где используется */
  use_for: DocTemplateUseFor[];
  note: string;
  /** Явно используемые макросы (подсказка; пусто = все из каталога) */
  macros: string[];
  /** Связь с бланком СТО (sto-contract-person …) — куда писать TXT при pull */
  sto_template_id: string;
  is_active: boolean;
  updated_at: string;
};

export type DocTemplatesConfig = {
  templates: DocTemplateRow[];
  updated_at: string | null;
};

/** Каталог макросов для вставки в Google Doc. */
export const DOC_MACROS: DocMacroDef[] = [
  { key: '{{Покупатель}}', label: 'ФИО / наименование покупателя', example: 'ООО «АвтоТрейд»', group: 'Покупатель' },
  { key: '{{ФИО}}', label: 'ФИО (физлицо)', example: 'Иванов Иван Иванович', group: 'Покупатель' },
  { key: '{{Телефон}}', label: 'Телефон', example: '+7 (900) 123-45-67', group: 'Покупатель' },
  { key: '{{Email}}', label: 'E-mail', example: 'mail@example.ru', group: 'Покупатель' },
  { key: '{{ИНН}}', label: 'ИНН покупателя', example: '231295963240', group: 'Покупатель' },
  { key: '{{КПП}}', label: 'КПП', example: '231201001', group: 'Покупатель' },
  { key: '{{ОГРН}}', label: 'ОГРН / ОГРНИП', example: '1234567890123', group: 'Покупатель' },
  { key: '{{Адрес}}', label: 'Адрес покупателя', example: 'г. Краснодар, ул. Красная, д. 1', group: 'Покупатель' },
  { key: '{{ВЛице}}', label: 'В лице (директор)', example: 'Генерального директора Петрова П.П.', group: 'Покупатель' },
  { key: '{{Банк}}', label: 'Банк покупателя', example: 'ПАО Сбербанк', group: 'Покупатель' },
  { key: '{{БИК}}', label: 'БИК', example: '040349602', group: 'Покупатель' },
  { key: '{{РС}}', label: 'Расчётный счёт', example: '40702810123456789012', group: 'Покупатель' },
  { key: '{{КС}}', label: 'Корр. счёт', example: '30101810400000000602', group: 'Покупатель' },

  { key: '{{Организация}}', label: 'Наименование продавца', example: 'ООО «Пневмоподвеска»', group: 'Продавец' },
  { key: '{{ИННОрганизации}}', label: 'ИНН продавца', example: '2311234567', group: 'Продавец' },
  { key: '{{КППОрганизации}}', label: 'КПП продавца', example: '231101001', group: 'Продавец' },
  { key: '{{ОГРНОрганизации}}', label: 'ОГРН / ОГРНИП продавца', example: '1022300000000', group: 'Продавец' },
  { key: '{{АдресОрганизации}}', label: 'Адрес продавца', example: 'г. Краснодар, …', group: 'Продавец' },
  { key: '{{Директор}}', label: 'ФИО / подпись продавца', example: 'Сидоров С.С.', group: 'Продавец' },
  { key: '{{РСОрганизации}}', label: 'Р/с продавца', example: '40702810987654321098', group: 'Продавец' },
  { key: '{{БанкОрганизации}}', label: 'Банк продавца', example: 'ТОЧКА ПАО Банка «ФК Открытие»', group: 'Продавец' },

  { key: '{{Номер}}', label: 'Номер документа', example: 'ДГ-1042', group: 'Документ' },
  { key: '{{Дата}}', label: 'Дата документа', example: '06.08.2026', group: 'Документ' },
  { key: '{{ДатаДлинная}}', label: 'Дата прописью', example: '«6» августа 2026 г.', group: 'Документ' },
  { key: '{{Город}}', label: 'Город договора', example: 'Краснодар', group: 'Документ' },
  { key: '{{Сумма}}', label: 'Сумма', example: '15 000,00', group: 'Документ' },
  { key: '{{СуммаПрописью}}', label: 'Сумма прописью', example: 'Пятнадцать тысяч рублей 00 копеек', group: 'Документ' },
  { key: '{{НомерЗаказа}}', label: 'Номер заказа / сделки Amo', example: 'Amo #15842', group: 'Документ' },

  { key: '{{Госномер}}', label: 'Гос. номер авто', example: 'А123ВС777', group: 'Авто' },
  { key: '{{VIN}}', label: 'VIN', example: 'XW8ZZZ61ZJG123456', group: 'Авто' },
  { key: '{{Марка}}', label: 'Марка', example: 'Volkswagen', group: 'Авто' },
  { key: '{{Модель}}', label: 'Модель', example: 'Tiguan', group: 'Авто' },
  { key: '{{Год}}', label: 'Год выпуска', example: '2018', group: 'Авто' },
  { key: '{{Цвет}}', label: 'Цвет', example: 'белый', group: 'Авто' },
  { key: '{{Пробег}}', label: 'Пробег', example: '84 200 км', group: 'Авто' },
  { key: '{{ДатаПриёмки}}', label: 'Дата приёмки авто (первое фото)', example: '«16» августа 2026 г.', group: 'Авто' },
  { key: '{{ВремяПриёмки}}', label: 'Время приёмки авто (первое фото)', example: '20 ч 11 мин', group: 'Авто' },
  { key: '{{ДатаВремяПриёмки}}', label: 'Дата и время приёмки (первое фото)', example: '«16» августа 2026 г., 20 ч 11 мин', group: 'Авто' },

  { key: '{{Филиал}}', label: 'Филиал Amo', example: 'Краснодар, СТО Фогель', group: 'Заказ' },
  { key: '{{СТО}}', label: 'Точка СТО', example: 'Фадеева', group: 'Заказ' },
  { key: '{{Канал}}', label: 'Канал реализации', example: 'Автосервис', group: 'Заказ' },
  { key: '{{СпособОтправки}}', label: 'Способ отправки', example: 'Самовывоз', group: 'Заказ' },

  { key: '{{НомерДоговора}}', label: 'Номер рамочного договора', example: '01-1042', group: 'Документ' },
  { key: '{{ДатаДоговора}}', label: 'Дата рамочного договора', example: '«1» июля 2026 г.', group: 'Документ' },
  { key: '{{Время}}', label: 'Время приёмки (= первое фото авто)', example: '10 ч 30 мин', group: 'Документ' },
  { key: '{{ТелефонОрганизации}}', label: 'Телефон продавца / СТО', example: '+7 (861) 000-00-00', group: 'Продавец' },
  { key: '{{EmailОрганизации}}', label: 'E-mail продавца / юрлица', example: 'info@example.ru', group: 'Продавец' },
  { key: '{{ДокументЗаказчика}}', label: 'Паспорт / реквизиты заказчика', example: 'паспорт 00 00 000000', group: 'Покупатель' },
  { key: '{{ДокументНаАвто}}', label: 'Документ на АМТС (СТС/ПТС)', example: 'СТС 99 00 000000', group: 'Авто' },
  { key: '{{Неисправности}}', label: 'Заявленные неисправности / цель', example: 'стук в подвеске, диагностика', group: 'Заказ' },
  { key: '{{НомерДвигателя}}', label: '№ двигателя / кузова / шасси', example: '—', group: 'Авто' },
  { key: '{{УровеньТоплива}}', label: 'Уровень топлива', example: '½', group: 'Авто' },
  { key: '{{Сотрудник}}', label: 'Кто оформил заказ-наряд', example: 'Мастер приёмщик Иванов И.И.', group: 'Заказ' },
  { key: '{{СрокНачала}}', label: 'Срок начала работ', example: '«6» августа 2026 г.', group: 'Заказ' },
  { key: '{{СрокОкончания}}', label: 'Срок окончания работ', example: '«7» августа 2026 г. (18 ч 00 мин)', group: 'Заказ' },
  { key: '{{ГарантияРаботы}}', label: 'Гарантия на работы', example: '6 мес. / 10 000 км', group: 'Заказ' },
  { key: '{{ГарантияЗЧ}}', label: 'Гарантия на ЗЧ исполнителя', example: '6 мес.', group: 'Заказ' },
];

/** Тестовые значения для превью (key → example). */
export function docMacroSampleMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of DOC_MACROS) {
    if (m.example) out[m.key] = m.example;
  }
  return out;
}

const AUDIENCE_LABEL: Record<DocTemplateAudience, string> = {
  person: 'Физлицо',
  legal: 'Юрлицо',
  ip: 'ИП',
  partner: 'Партнёр',
  any: 'Любой клиент',
};

const USE_FOR_LABEL: Record<DocTemplateUseFor, string> = {
  contract: 'Договор',
  workorder: 'Заказ-наряд',
  invoice: 'Счёт',
  sto: 'Автосервис',
  sale: 'Продажа',
  pickup: 'Самовывоз',
  delivery: 'Доставка',
  other: 'Прочее',
};

function extractGoogleDocId(urlOrId: string): string {
  const s = String(urlOrId || '').trim();
  if (!s) return '';
  const m =
    s.match(/\/document\/d\/([a-zA-Z0-9_-]+)/) ||
    s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return '';
}

function normalizeAudience(raw: unknown): DocTemplateAudience[] {
  const allowed: DocTemplateAudience[] = ['person', 'legal', 'ip', 'partner', 'any'];
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))] as DocTemplateAudience[];
  const filtered = out.filter((a) => allowed.includes(a));
  return filtered.length ? filtered : ['any'];
}

function normalizeUseFor(raw: unknown): DocTemplateUseFor[] {
  const allowed: DocTemplateUseFor[] = [
    'contract',
    'workorder',
    'invoice',
    'sto',
    'sale',
    'pickup',
    'delivery',
    'other',
  ];
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))] as DocTemplateUseFor[];
  const filtered = out.filter((a) => allowed.includes(a));
  return filtered.length ? filtered : ['other'];
}

/** id реестра → id бланка СТО — клиентские бланки */
const DEFAULT_STO_LINK: Record<string, string> = {
  'tpl-sto-contract-person': 'sto-contract-person',
  'tpl-sto-contract-legal': 'sto-contract-legal',
  'tpl-sto-workorder-person': 'sto-workorder-person',
  'tpl-sto-workorder-legal': 'sto-workorder-legal',
  'tpl-sto-pdn-consent': 'sto-pdn-consent',
};

/** Разрешённые id реестра — только загруженные DOCX клиента */
export const DOC_TEMPLATE_ALLOWED_IDS = Object.keys(DEFAULT_STO_LINK);

function normalizeTemplate(raw: Partial<DocTemplateRow> & { id?: string }): DocTemplateRow {
  const url = String(raw.google_doc_url || '').trim();
  const idFromUrl = extractGoogleDocId(url) || extractGoogleDocId(String(raw.google_doc_id || ''));
  const id = String(raw.id || '').trim() || newGuid();
  const stoId =
    String(raw.sto_template_id || '').trim() || DEFAULT_STO_LINK[id] || '';
  return {
    id,
    title: String(raw.title || '').trim() || 'Без названия',
    google_doc_url: url,
    google_doc_id: idFromUrl,
    audience: normalizeAudience(raw.audience),
    use_for: normalizeUseFor(raw.use_for),
    note: String(raw.note || '').trim(),
    macros: Array.isArray(raw.macros)
      ? raw.macros.map((m) => String(m).trim()).filter(Boolean)
      : [],
    sto_template_id: stoId,
    is_active: raw.is_active !== false && Number(raw.is_active as unknown) !== 0,
    updated_at: String(raw.updated_at || new Date().toISOString()),
  };
}

function defaultTemplates(): DocTemplateRow[] {
  const now = new Date().toISOString();
  return [
    normalizeTemplate({
      id: 'tpl-sto-contract-person',
      title: 'Договор-оферта для физиков',
      audience: ['person'],
      use_for: ['contract', 'sto', 'pickup', 'delivery'],
      note: 'Физлицо · DOCX',
      sto_template_id: 'sto-contract-person',
      is_active: true,
      updated_at: now,
    }),
    normalizeTemplate({
      id: 'tpl-sto-contract-legal',
      title: 'Договор с юр.лицом (СТО)',
      audience: ['legal', 'ip'],
      use_for: ['contract', 'sto', 'pickup', 'delivery'],
      note: 'Юрлицо / ИП · СТО (Михаил) · DOCX',
      sto_template_id: 'sto-contract-legal',
      is_active: true,
      updated_at: now,
    }),
    normalizeTemplate({
      id: 'tpl-sto-workorder-person',
      title: 'Заказ-наряд для физика',
      audience: ['person'],
      use_for: ['workorder', 'sto'],
      note: 'Физлицо · DOCX',
      sto_template_id: 'sto-workorder-person',
      is_active: true,
      updated_at: now,
    }),
    normalizeTemplate({
      id: 'tpl-sto-workorder-legal',
      title: 'Наряд-заказ юр. лицо',
      audience: ['legal', 'ip'],
      use_for: ['workorder', 'sto'],
      note: 'Юрлицо / ИП · DOCX',
      sto_template_id: 'sto-workorder-legal',
      is_active: true,
      updated_at: now,
    }),
    normalizeTemplate({
      id: 'tpl-sto-pdn-consent',
      title: 'Согласие на перс данные',
      audience: ['person'],
      use_for: ['sto'],
      note: 'Только физлицо на СТО · 152-ФЗ · DOCX · у юр/ИП не берём',
      sto_template_id: 'sto-pdn-consent',
      is_active: true,
      updated_at: now,
    }),
  ];
}

/** Подтянуть текст Google Doc → TXT бланка СТО (если sto_template_id задан). */
export async function pullDocTemplateFromGoogle(
  templateId: string,
  opts?: { organizationId?: string; sellerInn?: string }
): Promise<{
  template: DocTemplateRow;
  sto_template_id: string;
  txt_file: string;
  bytes: number;
  macros_found: string[];
  unknown_macros: string[];
  source_file_id?: string;
  owner?: string;
}> {
  const cfg = getDocTemplatesConfig();
  const row = cfg.templates.find((t) => t.id === String(templateId || '').trim());
  if (!row) throw new Error('Шаблон не найден');
  const stoId = String(row.sto_template_id || '').trim();
  if (!stoId) {
    throw new Error(
      'У шаблона не указан бланк СТО (sto_template_id). Выберите один из sto-* или укажите в заметке / правке.'
    );
  }
  const sto = getStoDocTemplate(stoId);
  if (!sto) throw new Error(`Неизвестный бланк СТО: ${stoId}`);

  let sellerInn = String(opts?.sellerInn || '').replace(/\D/g, '');
  if (!sellerInn && opts?.organizationId) {
    try {
      const org = getOrgProfile(resolveOrganizationId(opts.organizationId));
      sellerInn = String(org.inn || '').replace(/\D/g, '');
    } catch {
      /* ignore */
    }
  }

  const drive = resolveStoDriveFileId(stoId, sellerInn || null);
  const fileId = String(drive?.fileId || row.google_doc_id || '').trim();
  if (!fileId) {
    throw new Error('Нет ссылки на Google Doc — вставьте URL и сохраните шаблон');
  }

  let text = await exportDriveFilePlainText(fileId);
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.endsWith('\n')) text += '\n';

  const found = [...text.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]);
  const uniq = [...new Set(found)];
  const known = new Set(DOC_MACROS.map((m) => m.key));
  const unknown = uniq.filter((k) => !known.has(k));

  const txtPath = path.join(STO_TEMPLATES_ROOT, 'txt', sto.txtFile);
  const bakDir = path.join(STO_TEMPLATES_ROOT, `_backup-gdoc-${new Date().toISOString().slice(0, 10)}`);
  try {
    if (fs.existsSync(txtPath)) {
      fs.mkdirSync(bakDir, { recursive: true });
      fs.copyFileSync(txtPath, path.join(bakDir, sto.txtFile));
    }
  } catch {
    /* backup best-effort */
  }
  fs.writeFileSync(txtPath, text, 'utf8');

  // Кэш по владельцу (Рома / Миша) — тот же, что у loadStoTemplateText
  const owner = drive?.owner || stoOwnerKeyFromInn(sellerInn || null);
  try {
    const cacheDir = path.join(STO_TEMPLATES_ROOT, 'cache', owner);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, path.basename(sto.txtFile)), text, 'utf8');
  } catch {
    /* ignore */
  }
  clearStoDriveMemCache(stoId, sellerInn || null);
  clearStoDriveMemCache(stoId);

  // DOCX-кэш для PDF (тот же файл Drive) — тоже только по «Подтянуть»
  try {
    await loadStoTemplateDocxBuffer(stoId, sellerInn || null, { forceDrive: true });
  } catch (e) {
    console.warn(
      `[doc-templates] DOCX pull ${stoId}: ${e instanceof Error ? e.message : e}`
    );
  }

  upsertDocTemplate({
    ...row,
    google_doc_id: fileId || row.google_doc_id,
    updated_at: new Date().toISOString(),
  });

  return {
    template: row,
    sto_template_id: stoId,
    txt_file: sto.txtFile,
    bytes: Buffer.byteLength(text, 'utf8'),
    macros_found: uniq,
    unknown_macros: unknown,
    source_file_id: fileId,
    owner,
  };
}

export async function listDocTemplatesDriveFolder(): Promise<{
  folder_id: string;
  folder_url: string;
  folder_name: string;
  sa_email: string;
  files: DriveListFile[];
}> {
  const folder_id = GDRIVE_TEMPLATES_FOLDER;
  const files = await listDriveFolderFiles(folder_id);
  return {
    folder_id,
    folder_url: `https://drive.google.com/drive/folders/${folder_id}`,
    folder_name: 'Шаблоны',
    sa_email: GOOGLE_SA_EMAIL,
    files,
  };
}

function readRaw(): Partial<DocTemplatesConfig> {
  const row = get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [META_KEY]);
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value) as Partial<DocTemplatesConfig>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeConfig(cfg: DocTemplatesConfig): void {
  run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [META_KEY, JSON.stringify(cfg)]);
}

export function getDocTemplatesConfig(): DocTemplatesConfig {
  const stored = readRaw();
  const defaults = defaultTemplates();
  const byId = new Map(
    (Array.isArray(stored.templates) ? stored.templates : [])
      .map((t) => normalizeTemplate(t))
      .map((t) => [t.id, t] as const)
  );
  // Строго только 5 бланков клиента — лишнее выкидываем
  const list = defaults.map((d) => {
    const prev = byId.get(d.id);
    if (!prev) return d;
    return normalizeTemplate({
      ...d,
      google_doc_url: prev.google_doc_url || d.google_doc_url,
      google_doc_id: prev.google_doc_id || d.google_doc_id,
      note: d.note,
      title: d.title,
      audience: d.audience,
      use_for: d.use_for,
      sto_template_id: d.sto_template_id,
      is_active: true,
      updated_at: prev.updated_at || d.updated_at,
    });
  });
  const prevIds = Array.isArray(stored.templates)
    ? stored.templates.map((t) => String((t as { id?: string }).id || '')).sort().join(',')
    : '';
  const nextIds = list
    .map((t) => t.id)
    .slice()
    .sort()
    .join(',');
  const prevTitles = Array.isArray(stored.templates)
    ? stored.templates.map((t) => String((t as { title?: string }).title || '')).join('|')
    : '';
  const nextTitles = list.map((t) => t.title).join('|');
  const prevUse = Array.isArray(stored.templates)
    ? stored.templates
        .map((t) =>
          JSON.stringify(
            Array.isArray((t as { use_for?: string[] }).use_for)
              ? [...(t as { use_for: string[] }).use_for].sort()
              : []
          )
        )
        .join('|')
    : '';
  const nextUse = list.map((t) => JSON.stringify([...t.use_for].sort())).join('|');
  const prevAud = Array.isArray(stored.templates)
    ? stored.templates
        .map((t) =>
          JSON.stringify(
            Array.isArray((t as { audience?: string[] }).audience)
              ? [...(t as { audience: string[] }).audience].sort()
              : []
          )
        )
        .join('|')
    : '';
  const nextAud = list.map((t) => JSON.stringify([...t.audience].sort())).join('|');
  if (
    prevIds !== nextIds ||
    prevTitles !== nextTitles ||
    prevUse !== nextUse ||
    prevAud !== nextAud ||
    !Array.isArray(stored.templates) ||
    !stored.templates.length
  ) {
    writeConfig({ templates: list, updated_at: new Date().toISOString() });
  }
  return {
    templates: list,
    updated_at: stored.updated_at || null,
  };
}

export function saveDocTemplatesConfig(patch: {
  templates?: Array<Partial<DocTemplateRow>>;
}): DocTemplatesConfig {
  const defaults = defaultTemplates();
  const allow = new Set(DOC_TEMPLATE_ALLOWED_IDS);
  const incoming = Array.isArray(patch.templates)
    ? patch.templates.map((t) => normalizeTemplate(t)).filter((t) => allow.has(t.id))
    : [];
  const byId = new Map(incoming.map((t) => [t.id, t] as const));
  const list = defaults.map((d) => {
    const prev = byId.get(d.id);
    if (!prev) return d;
    return normalizeTemplate({
      ...d,
      google_doc_url: prev.google_doc_url || d.google_doc_url,
      google_doc_id: prev.google_doc_id || d.google_doc_id,
      note: d.note,
      title: d.title,
      audience: d.audience,
      use_for: d.use_for,
      sto_template_id: d.sto_template_id,
      is_active: true,
    });
  });
  writeConfig({ templates: list, updated_at: new Date().toISOString() });
  return getDocTemplatesConfig();
}

export function upsertDocTemplate(input: Partial<DocTemplateRow> & { id?: string }): DocTemplateRow {
  const allow = new Set(DOC_TEMPLATE_ALLOWED_IDS);
  const row = normalizeTemplate({
    ...input,
    updated_at: new Date().toISOString(),
  });
  if (!allow.has(row.id)) {
    throw new Error('Можно править только 6 бланков СТО');
  }
  const cfg = getDocTemplatesConfig();
  const idx = cfg.templates.findIndex((t) => t.id === row.id);
  if (idx >= 0) cfg.templates[idx] = { ...cfg.templates[idx], ...row, title: cfg.templates[idx].title, sto_template_id: cfg.templates[idx].sto_template_id };
  writeConfig({ templates: cfg.templates, updated_at: new Date().toISOString() });
  return cfg.templates[idx >= 0 ? idx : 0];
}

export function deleteDocTemplate(_id: string): boolean {
  // Фиксированный набор из 6 — удаление запрещено
  return false;
}

export function docTemplatesPublic() {
  const cfg = getDocTemplatesConfig();
  const gdrive = {
    folder_id: GDRIVE_TEMPLATES_FOLDER,
    folder_url: `https://drive.google.com/drive/folders/${GDRIVE_TEMPLATES_FOLDER}`,
    folder_name: 'Шаблоны',
  };
  let editor: { google_doc_id?: string; google_doc_url?: string } = {};
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const man = path.join(root, 'docs/sto-templates/gdrive-templates.json');
    if (fs.existsSync(man)) {
      const parsed = JSON.parse(fs.readFileSync(man, 'utf8')) as {
        folder_id?: string;
        folder_url?: string;
        folder_name?: string;
      };
      if (parsed?.folder_url) {
        gdrive.folder_url = parsed.folder_url;
        gdrive.folder_id = parsed.folder_id || gdrive.folder_id;
        gdrive.folder_name = parsed.folder_name || gdrive.folder_name;
      }
    }
    const editMan = path.join(root, 'docs/sto-templates/gdrive-sto-edit.json');
    if (fs.existsSync(editMan)) {
      const parsed = JSON.parse(fs.readFileSync(editMan, 'utf8')) as {
        google_doc_id?: string;
        google_doc_url?: string;
        tabs?: Record<string, { url?: string }>;
      };
      if (parsed?.google_doc_id || parsed?.google_doc_url) {
        editor = {
          google_doc_id: parsed.google_doc_id || '',
          google_doc_url:
            parsed.tabs?.macros?.url ||
            parsed.google_doc_url ||
            (parsed.google_doc_id
              ? `https://docs.google.com/document/d/${parsed.google_doc_id}/edit`
              : ''),
        };
      }
    }
  } catch {
    /* optional */
  }
  return {
    ok: true,
    macros: DOC_MACROS,
    samples: docMacroSampleMap(),
    audience_labels: AUDIENCE_LABEL,
    use_for_labels: USE_FOR_LABEL,
    templates: cfg.templates,
    pack_matrix: buildSaleDocPackMatrix(),
    updated_at: cfg.updated_at,
    gdrive,
    editor,
    sto_editor: editor,
    sa_email: GOOGLE_SA_EMAIL,
    hint: 'Только 6 бланков СТО (ваши DOCX). Печать — из пакета заказа (PDF ×2). Матрица пакета по роли/каналу — ниже.',
  };
}
