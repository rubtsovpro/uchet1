import { get, run } from './db.js';

/** Следующий уникальный штрихкод/марка с префиксом (DM…, OZN…). */
export function nextBarcode(prefixRaw: string): string {
  let prefix = String(prefixRaw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!prefix) prefix = 'DM';
  if (prefix.length > 8) prefix = prefix.slice(0, 8);
  const row = get<{ last_n: number }>(`SELECT last_n FROM barcode_sequences WHERE prefix = ?`, [
    prefix,
  ]);
  let n = row ? Number(row.last_n) + 1 : 5157429692;
  if (!Number.isFinite(n) || n < 1) n = 5157429692;
  if (row) {
    run(`UPDATE barcode_sequences SET last_n = ? WHERE prefix = ?`, [n, prefix]);
  } else {
    run(`INSERT INTO barcode_sequences (prefix, last_n) VALUES (?, ?)`, [prefix, n]);
  }
  return `${prefix}${n}`;
}
