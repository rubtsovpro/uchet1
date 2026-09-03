/**
 * PDF бланков СТО из DOCX (вёрстка Drive), без пересборки в HTML/PDFKit.
 * Подстановка {{макросов}} в word/document.xml → LibreOffice → PDF.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fillStoTemplateText,
  getStoDocTemplate,
  sumStoLines,
  stoTemplateDocxPath,
  type StoFillContext,
  type StoFillLine,
} from './sto-doc-templates.js';
import {
  resolveStoDriveFileId,
  stoOwnerKeyFromInn,
  type StoDriveOwnerKey,
} from './sto-drive-load.js';
import { getDriveFileMeta, googleAccessToken } from './google-sa.js';
import { warrantyLinesForSeller } from './warranty-settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STO_ROOT = path.resolve(__dirname, '../assets/sto-templates');

const MACRO_RE = /\{\{[^}]+\}\}/g;

/** Макросы таблиц — в DOCX одна ячейка; строки пишем по колонкам в Python. */
const DOCX_TABLE_MACROS = new Set([
  '{{ТаблицаРабот}}',
  '{{ТаблицаЗЧИсполнителя}}',
  '{{ТаблицаЗЧ}}',
  '{{ТаблицаЗЧЗаказчика}}',
  '{{ТаблицаФакт}}',
  '{{ТаблицаВыполненных}}',
  '{{ТаблицаГарантии}}',
]);

function moneyRuDocx(n: number): string {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

function qtyRuDocx(n: number): string {
  const v = Number(n) || 0;
  if (Number.isInteger(v)) return String(v);
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

function lineTitle(l: StoFillLine): string {
  const name = String(l.name || '').trim();
  const sku = String(l.sku || '').trim();
  return sku ? `${name}, арт. ${sku}` : name;
}

function warrantyRowsForDocx(opts: {
  sellerInn?: string | null;
  workLines?: StoFillLine[];
  partLines?: StoFillLine[];
  clientPartLines?: StoFillLine[];
}): Array<{ object: string; term: string; start: string }> {
  const start = 'с даты выдачи АМТС';
  const lines = warrantyLinesForSeller(opts.sellerInn);
  const byId = new Map(lines.map((l) => [l.id, l]));
  const rows: Array<{ object: string; term: string; start: string }> = [];
  const seen = new Set<string>();

  const pushId = (id: string) => {
    if (seen.has(id)) return;
    const l = byId.get(id);
    if (!l || l.group === 'exclusion') return;
    seen.add(id);
    rows.push({
      object: String(l.label || '').trim(),
      term: String(l.term || '').trim() || '____',
      start: l.group === 'services' ? start : start,
    });
  };

  if ((opts.workLines || []).some((l) => String(l.name || '').trim())) {
    pushId('services');
  }

  const MATCHERS: Array<{ id: string; re: RegExp }> = [
    { id: 'strut', re: /стойк/i },
    { id: 'air_spring', re: /пневмобаллон|воздушн\w*\s*баллон|\bбаллон/i },
    { id: 'shock', re: /амортизатор/i },
    { id: 'compressor', re: /компрессор/i },
    { id: 'valve_block', re: /клапан/i },
    { id: 'height_sensor', re: /датчик\s*уровн/i },
    { id: 'steering_rack', re: /рейк/i },
  ];

  for (const part of opts.partLines || []) {
    const title = `${part.name || ''} ${part.sku || ''}`;
    if (!String(part.name || '').trim()) continue;
    let matched = false;
    for (const m of MATCHERS) {
      if (m.re.test(title)) {
        pushId(m.id);
        matched = true;
        // стойка уже покрывает амортизатор+баллон — не дублируем
        if (m.id === 'strut') break;
      }
    }
    if (!matched) {
      // неизвестная ЗЧ из заказа — отдельная строка с типовым сроком 1 год
      const name = String(part.name || '').trim();
      const key = `part:${name.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ object: name, term: '1 год', start });
      }
    }
  }

  const hasClient = (opts.clientPartLines || []).some((l) => String(l.name || '').trim());
  if (hasClient) {
    const excl = lines.find((l) => l.id === 'client_parts');
    if (excl) {
      const term = String(excl.term || '').trim() || 'гарантия производителя запчасти';
      const note = String(excl.note || '').trim();
      rows.push({
        object: String(excl.label || '').trim(),
        term: note ? `${term}. ${note}` : term,
        start: '—',
      });
    }
  }

  if (!rows.length) {
    pushId('services');
  }
  return rows;
}

function escapeXml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function findSoffice(): string {
  for (const p of ['/usr/bin/soffice', '/usr/bin/libreoffice', 'soffice', 'libreoffice']) {
    try {
      if (p.includes('/') && !fs.existsSync(p)) continue;
      execFileSync(p, ['--version'], { stdio: 'ignore', timeout: 15_000 });
      return p;
    } catch {
      /* try next */
    }
  }
  throw new Error('LibreOffice (soffice) не найден — PDF из DOCX недоступен');
}

/** Значения макросов, уже с прочерками для пустых (как в fillStoTemplateText). */
export function stoMacroFillsForDocx(ctx: StoFillContext, xml: string): Record<string, string> {
  const keys = [...new Set(xml.match(MACRO_RE) || [])];
  const out: Record<string, string> = {};
  for (const key of keys) {
    out[key] = fillStoTemplateText(key, ctx);
  }
  return out;
}

/**
 * Подстановка макросов в DOCX через Python zipfile
 * (на VPS часто нет unzip в PATH).
 * Для ЗН физлица: §6 при пустых ЗЧ заказчика — без таблицы, фраза «не предоставлялись».
 */
export function fillDocxBufferMacros(buf: Buffer, ctx: StoFillContext): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-sto-docx-'));
  const inFile = path.join(dir, 'in.docx');
  const outFile = path.join(dir, 'out.docx');
  const mapFile = path.join(dir, 'fills.json');
  const clientPartsFile = path.join(dir, 'client-parts.json');
  const intakeFile = path.join(dir, 'intake.json');
  const worksFile = path.join(dir, 'works.json');
  const partsFile = path.join(dir, 'parts.json');
  const factFile = path.join(dir, 'fact.json');
  const warrantyFile = path.join(dir, 'warranty.json');
  try {
    fs.writeFileSync(inFile, buf);
    const xml = execFileSync(
      'python3',
      [
        '-c',
        [
          'import zipfile,sys',
          `z=zipfile.ZipFile(${JSON.stringify(inFile)})`,
          'sys.stdout.buffer.write(z.read("word/document.xml"))',
        ].join(';'),
      ],
      { maxBuffer: 32 * 1024 * 1024 }
    ).toString('utf8');
    const fills = stoMacroFillsForDocx(ctx, xml);
    const workLines = (ctx.workLines || []).filter((l) => String(l.name || '').trim());
    const partLines = (ctx.partLines || []).filter((l) => String(l.name || '').trim());
    const escaped: Record<string, string> = {};
    for (const [k, v] of Object.entries(fills)) {
      // макросы таблиц оставляем — Python генерирует w:tbl на их месте
      escaped[k] = DOCX_TABLE_MACROS.has(k) ? k : escapeXml(v ?? '');
    }
    // нулевые итоги при наличии строк — «0,00», не прочерки из пустого макроса
    if (partLines.length) {
      escaped['{{ИтогоЗЧ}}'] = escapeXml(moneyRuDocx(sumStoLines(partLines)));
    }
    if (workLines.length) {
      escaped['{{ИтогоРаботы}}'] = escapeXml(moneyRuDocx(sumStoLines(workLines)));
    }
    fs.writeFileSync(mapFile, JSON.stringify(escaped), 'utf8');
    const clientParts = (ctx.clientPartLines || [])
      .filter((l) => String(l.name || '').trim())
      .map((l) => ({
        name: String(l.name || '').trim(),
        sku: String(l.sku || '').trim(),
        qty: Number(l.qty) || 1,
        price: Number(l.price) || 0,
        amount: Number(l.amount) || 0,
      }));
    fs.writeFileSync(clientPartsFile, JSON.stringify(clientParts), 'utf8');
    fs.writeFileSync(
      intakeFile,
      JSON.stringify({
        fuel_level: String(ctx.carFuelLevel || '').trim(),
        completeness_line: String(ctx.completenessLine || '').trim(),
        keys_line: String(ctx.keysDocsLine || '').trim(),
        damage_notes: String(ctx.damageNotes || '').trim(),
      }),
      'utf8'
    );

    const worksPayload = workLines.map((l) => ({
      name: String(l.name || '').trim(),
      qty: qtyRuDocx(l.qty),
      price: moneyRuDocx(l.price),
      amount: moneyRuDocx(l.amount),
    }));
    const partsPayload = partLines.map((l) => ({
      name: lineTitle(l),
      qty: qtyRuDocx(l.qty),
      price: moneyRuDocx(l.price),
      amount: moneyRuDocx(l.amount),
    }));
    const factPayload = [...workLines, ...partLines].map((l) => ({
      name: lineTitle(l),
      qty: qtyRuDocx(l.qty),
      amount: moneyRuDocx(l.amount),
    }));
    const totalSum = sumStoLines(workLines) + sumStoLines(partLines);
    fs.writeFileSync(worksFile, JSON.stringify(worksPayload), 'utf8');
    fs.writeFileSync(partsFile, JSON.stringify(partsPayload), 'utf8');
    fs.writeFileSync(
      factFile,
      JSON.stringify({
        rows: factPayload,
        total: totalSum > 0 ? moneyRuDocx(totalSum) : '',
      }),
      'utf8'
    );
    fs.writeFileSync(
      warrantyFile,
      JSON.stringify(
        warrantyRowsForDocx({
          sellerInn: ctx.org?.inn,
          workLines,
          partLines,
          clientPartLines: ctx.clientPartLines,
        })
      ),
      'utf8'
    );

    const fillScript = path.join(__dirname, '../scripts/fill_sto_docx.py');
    execFileSync('python3', [fillScript, inFile, outFile], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return fs.readFileSync(outFile);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export function convertDocxBufferToPdf(buf: Buffer): Buffer {
  const soffice = findSoffice();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-sto-pdf-'));
  const inFile = path.join(dir, 'doc.docx');
  try {
    fs.writeFileSync(inFile, buf);
    execFileSync(
      soffice,
      ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, inFile],
      { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }
    );
    const pdfPath = path.join(dir, 'doc.pdf');
    if (!fs.existsSync(pdfPath)) throw new Error('LibreOffice не создал PDF');
    return fs.readFileSync(pdfPath);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function ownerDocxCachePath(owner: StoDriveOwnerKey, docxFile: string): string {
  return path.join(STO_ROOT, 'cache', owner, path.basename(docxFile));
}

async function downloadDriveDocx(fileId: string): Promise<Buffer> {
  const meta = await getDriveFileMeta(fileId);
  const mime = String(meta.mimeType || '');
  const token = await googleAccessToken(
    'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/documents.readonly'
  );
  if (mime === 'application/vnd.google-apps.document') {
    const url =
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
      `/export?mimeType=${encodeURIComponent(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive export DOCX ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive download DOCX ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Байт DOCX бланка: кэш владельца → общий docx/.
 * Drive — только при forceDrive (явное обновление).
 */
export async function loadStoTemplateDocxBuffer(
  templateId: string,
  sellerInn?: string | null,
  opts?: { forceDrive?: boolean }
): Promise<{ buffer: Buffer; source: 'cache' | 'local' | 'drive'; owner: StoDriveOwnerKey } | null> {
  const meta = getStoDocTemplate(templateId);
  if (!meta) return null;
  const owner = stoOwnerKeyFromInn(sellerInn);
  const cached = ownerDocxCachePath(owner, meta.docxFile);
  const drive = resolveStoDriveFileId(templateId, sellerInn);

  if (opts?.forceDrive && drive?.fileId) {
    try {
      const buffer = await downloadDriveDocx(drive.fileId);
      try {
        fs.mkdirSync(path.dirname(cached), { recursive: true });
        fs.writeFileSync(cached, buffer);
      } catch {
        /* ignore cache write */
      }
      return { buffer, source: 'drive', owner };
    } catch (e) {
      console.warn(
        `[sto-docx] Drive force ${templateId}: ${e instanceof Error ? e.message : e} — fallback cache/local`
      );
    }
  }

  if (fs.existsSync(cached)) {
    return { buffer: fs.readFileSync(cached), source: 'cache', owner };
  }
  const local = stoTemplateDocxPath(templateId);
  if (local && fs.existsSync(local)) {
    return { buffer: fs.readFileSync(local), source: 'local', owner };
  }
  return null;
}

/** Заполненный DOCX → PDF (LibreOffice). */
export async function buildStoDocxPdf(
  templateId: string,
  ctx: StoFillContext,
  sellerInn?: string | null,
  opts?: { forceDrive?: boolean }
): Promise<{ buffer: Buffer; source: string } | null> {
  const loaded = await loadStoTemplateDocxBuffer(templateId, sellerInn, opts);
  if (!loaded) return null;
  const filled = fillDocxBufferMacros(loaded.buffer, ctx);
  const pdf = convertDocxBufferToPdf(filled);
  return { buffer: pdf, source: `docx:${loaded.source}` };
}
