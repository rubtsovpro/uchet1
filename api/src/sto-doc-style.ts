/**
 * Формальный минимальный стиль бланков СТО (печать HTML/PDF).
 * Без цвета и декора. Спека: docs/sto-templates/DOC-STYLE.md
 */

export const STO_DOC_STYLE = {
  ink: '#111111',
  muted: '#555555',
  font: '"Times New Roman", Times, serif',
  /** Минимум кегля на бланках СТО — не ниже 11pt. */
  sizeBody: '11pt',
  sizeSmall: '11pt',
  sizeTitle: '14pt',
  lineHeight: '1.25',
  margin: '15mm 15mm 15mm 20mm',
} as const;

/** CSS для печати бланка (договоры, приказы, регламенты, ЗН). Кегль ≥ 11pt. */
export function stoDocPrintCss(opts?: { compact?: boolean }): string {
  const s = STO_DOC_STYLE;
  const margin = opts?.compact ? '10mm 12mm' : s.margin;
  const bodySize = s.sizeBody;
  return `
    @page { size: A4; margin: ${margin}; }
    * { box-sizing: border-box; }
    body {
      font-family: ${s.font};
      font-size: ${bodySize};
      line-height: ${s.lineHeight};
      color: ${s.ink};
      margin: 0;
      max-width: 190mm;
    }
    .sto-letterhead { text-align: center; margin: 0 0 10px; }
    .sto-letterhead .org-name {
      font-size: 12pt; font-weight: 700; margin: 0 0 3px;
    }
    .sto-letterhead .org-ids,
    .sto-letterhead .org-addr {
      font-size: ${s.sizeSmall}; color: ${s.muted}; margin: 0 0 2px; line-height: 1.25;
    }
    .sto-meta {
      display: flex; justify-content: space-between; gap: 12px;
      font-size: ${s.sizeSmall}; margin: 0 0 10px;
    }
    .sto-doc-num {
      text-align: center; font-weight: 700; font-size: 12pt;
      margin: 0 0 4px; letter-spacing: 0.03em;
    }
    .sto-doc-title {
      text-align: center; font-size: ${s.sizeTitle}; font-weight: 700;
      margin: 0 0 4px; line-height: 1.25;
    }
    .sto-doc-subtitle {
      text-align: center; font-size: 11pt; font-weight: 700;
      margin: 0 0 12px; line-height: 1.25;
    }
    .para, p { margin: 0 0 8px; text-align: justify; }
    .para.is-indent { text-indent: 1.25cm; }
    h2.sto-h {
      font-size: 11pt; font-weight: 700; margin: 12px 0 6px; text-align: left;
    }
    table.sto-table {
      width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 11pt;
    }
    table.sto-table th,
    table.sto-table td {
      border: 0.6pt solid ${s.ink}; padding: 4px 6px; vertical-align: top; text-align: left;
      background: transparent;
    }
    table.sto-table th { font-weight: 700; text-align: center; }
    table.parties {
      width: 100%; border-collapse: collapse; margin-top: 12px;
      page-break-inside: avoid; break-inside: avoid;
    }
    table.parties td {
      width: 50%; vertical-align: top; padding: 6px 12px 6px 0;
      font-size: 11pt; line-height: 1.4;
    }
    table.parties .party-title { font-weight: 700; margin-bottom: 6px; }
    /* Подпись / реквизиты сторон — не отрывать на следующую страницу */
    .sto-sign,
    .parties-sign,
    .sto-sign-block {
      margin-top: 16px;
      page-break-inside: avoid;
      break-inside: avoid;
      page-break-before: avoid;
      break-before: avoid;
    }
    .sto-sign-line { margin: 0 0 2px; white-space: pre-wrap; }
    .sto-sign-hint { font-size: 11pt; color: ${s.muted}; margin: 0 0 8px; }
    .sto-app-label { font-size: ${s.sizeSmall}; color: ${s.muted}; margin: 16px 0 8px; }
    .toolbar {
      position: sticky; top: 0; background: #f5f5f5;
      padding: 8px 12px; margin: -8px -8px 16px;
      display: flex; gap: 8px; flex-wrap: wrap;
      font-family: system-ui, sans-serif;
    }
    .toolbar button, .toolbar a {
      font: 13px system-ui, sans-serif; padding: 6px 12px; cursor: pointer;
      text-decoration: none; color: #111; border: 1px solid #bbb;
      background: #fff; border-radius: 4px;
    }
    @media print {
      .toolbar { display: none; }
      .sto-sign, .parties-sign, .sto-sign-block, table.parties {
        page-break-inside: avoid; break-inside: avoid;
      }
    }
    .sto-copy-label {
      font-size: 11pt; color: #555; margin: 0 0 8px; font-style: italic;
    }
    .sto-print-copy + .sto-print-copy {
      page-break-before: always; break-before: page;
    }
  `;
}

export function stoDocCompactCss(): string {
  return stoDocPrintCss({ compact: true });
}

export const STO_PRINT_COPY_LABELS = [
  'Экземпляр 1 — заказчик',
  'Экземпляр 2 — исполнитель',
] as const;

export function stoPrintCopyLabel(copyIndex: number): string {
  return STO_PRINT_COPY_LABELS[copyIndex] || `Экземпляр ${copyIndex + 1}`;
}

function escCopy(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Дублирует тело бланка для печати в N экз. (разрыв страницы между). */
export function duplicateStoHtmlForPrint(innerHtml: string, copies: number): string {
  const n = Math.max(1, Math.min(10, Math.floor(Number(copies) || 1)));
  if (n <= 1) return innerHtml;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const br = i > 0 ? 'page-break-before:always;break-before:page;' : '';
    parts.push(
      `<div class="sto-print-copy" style="${br}">` +
        `<div class="sto-copy-label">${escCopy(stoPrintCopyLabel(i))}</div>` +
        innerHtml +
        `</div>`
    );
  }
  return parts.join('\n');
}
