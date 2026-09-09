/**
 * Реестр отправок склада → Google Sheet «отправки Склад».
 * При «курьер доставил» (handoff): строка сделки; если нет заголовка сегодняшней даты — жёлтая «09.09».
 * Столбец I не пишем (формула в таблице). Новые строки без оранжевой заливки.
 */
import { get } from './db.js';
import { googleAccessToken, GOOGLE_SA_EMAIL } from './google-sa.js';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export const COURIER_SHIPMENTS_SPREADSHEET_ID =
  process.env.COURIER_SHIPMENTS_SHEET_ID ||
  '1qjymXFeDP54bVCnB7fNdpDjIKQQv72FVO3xV06JSCfQ';

/** gid листа «отправки Склад» */
export const COURIER_SHIPMENTS_SHEET_GID = 1059240928;

const DATE_MARKER_RE = /^\d{1,2}(?:-\d{1,2})?\.\d{1,2}$/;

type SheetMeta = { sheetId: number; title: string };

function sheetsDisabled(): boolean {
  const v = String(process.env.COURIER_SHIPMENTS_SHEET_DISABLED || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Дата для заголовка листа: «09.09» (МСК). */
export function moscowShipmentsDateLabel(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  return `${day}.${month}`;
}

function isDateMarker(s: string): boolean {
  return DATE_MARKER_RE.test(String(s || '').trim());
}

/** Тип отправки как в ручном реестре. */
export function sheetShipmentTypeForDeal(dealId: string): string {
  const id = String(dealId || '').trim();
  if (!id) return 'СДЭК';
  const d = get<{ ship_channel: string; amo_shipment: string }>(
    `SELECT IFNULL(ship_channel,'') AS ship_channel,
            IFNULL(amo_shipment,'') AS amo_shipment
     FROM crm_deals WHERE id = ?`,
    [id]
  );
  const ch = String(d?.ship_channel || '').toLowerCase();
  const amo = String(d?.amo_shipment || '').toLowerCase();
  const blob = `${ch} ${amo}`;
  if (/avito|авито/.test(blob)) return 'Авито';
  if (/ozon|озон/.test(blob)) return 'ОЗОН';
  if (/rostov|ростов/.test(blob)) return 'Ростов';
  if (/dellin|деловые|дл\b/.test(blob)) return 'КРД ДЛ';
  if (/pek|пэк/.test(blob)) return 'ПЭК';
  if (/own_courier|taxi|такси|яндекс|наша достав/.test(blob)) return 'наша доставка';
  if (/bus|стрела|краснодар|krd|крд/.test(blob)) return 'КРД';
  if (/cdek|сдэк|сдек/.test(blob)) return 'СДЭК';
  if (ch) return 'СДЭК';
  return 'СДЭК';
}

async function sheetsToken(): Promise<string> {
  return googleAccessToken(SHEETS_SCOPE);
}

async function resolveSheetMeta(spreadsheetId: string): Promise<SheetMeta> {
  const token = await sheetsToken();
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `?fields=sheets(properties(sheetId,title))`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const data = (await res.json()) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      data.error?.message ||
        `Sheets meta ${res.status}. Расшарьте таблицу на ${GOOGLE_SA_EMAIL} (редактор).`
    );
  }
  const wantGid = Number(process.env.COURIER_SHIPMENTS_SHEET_GID || COURIER_SHIPMENTS_SHEET_GID);
  for (const sh of data.sheets || []) {
    const p = sh.properties || {};
    if (Number(p.sheetId) === wantGid) {
      return { sheetId: Number(p.sheetId), title: String(p.title || '') };
    }
  }
  throw new Error(`Лист gid=${wantGid} не найден в таблице отправок`);
}

async function readColumnA(spreadsheetId: string, title: string): Promise<string[]> {
  const token = await sheetsToken();
  const quoted = `'${title.replace(/'/g, "''")}'`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(`${quoted}!A:A`)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const data = (await res.json()) as { values?: string[][]; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(data.error?.message || `Sheets values ${res.status}`);
  }
  return (data.values || []).map((r) => String(r?.[0] ?? '').trim());
}

async function batchUpdate(spreadsheetId: string, requests: unknown[]): Promise<void> {
  if (!requests.length) return;
  const token = await sheetsToken();
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ requests }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(data.error?.message || `Sheets batchUpdate ${res.status}`);
  }
}

async function updateValues(
  spreadsheetId: string,
  title: string,
  startRow0: number,
  values: string[][]
): Promise<void> {
  if (!values.length) return;
  const token = await sheetsToken();
  const quoted = `'${title.replace(/'/g, "''")}'`;
  const endRow = startRow0 + values.length;
  // A:E только — столбец I не трогаем
  const range = `${quoted}!A${startRow0 + 1}:E${endRow}`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(data.error?.message || `Sheets update ${res.status}`);
  }
}

/** Жёлтый фон только для строки даты. */
const YELLOW = { red: 1, green: 0.95, blue: 0.6 };

/**
 * Добавить сделку в реестр отправок после «доставил».
 * Без оранжевой заливки; I не заполняем.
 */
export async function appendCourierShipmentToSheet(input: {
  dealId: string;
  /** если уже знаем тип — иначе из сделки */
  shipType?: string;
  deliveredAt?: Date;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  dateHeaderAdded?: boolean;
  dateLabel?: string;
  sheetRow?: number;
}> {
  if (sheetsDisabled()) {
    return { ok: true, skipped: true, reason: 'disabled' };
  }
  const dealId = String(input.dealId || '').trim();
  if (!dealId) return { ok: false, reason: 'no deal' };

  const spreadsheetId = COURIER_SHIPMENTS_SPREADSHEET_ID;
  const meta = await resolveSheetMeta(spreadsheetId);
  const colA = await readColumnA(spreadsheetId, meta.title);

  if (colA.includes(dealId)) {
    return { ok: true, skipped: true, reason: 'already_in_sheet' };
  }

  const dateLabel = moscowShipmentsDateLabel(input.deliveredAt || new Date());
  let lastMarker = '';
  for (let i = colA.length - 1; i >= 0; i--) {
    if (isDateMarker(colA[i])) {
      lastMarker = colA[i];
      break;
    }
  }

  const needDateHeader = lastMarker !== dateLabel;
  const shipType = String(input.shipType || '').trim() || sheetShipmentTypeForDeal(dealId);

  const insertAt = colA.length; // 0-based index = append at end
  const rowsToInsert = needDateHeader ? 2 : 1;
  const requests: unknown[] = [
    {
      insertDimension: {
        range: {
          sheetId: meta.sheetId,
          dimension: 'ROWS',
          startIndex: insertAt,
          endIndex: insertAt + rowsToInsert,
        },
        inheritFromBefore: true,
      },
    },
  ];

  if (needDateHeader) {
    requests.push({
      repeatCell: {
        range: {
          sheetId: meta.sheetId,
          startRowIndex: insertAt,
          endRowIndex: insertAt + 1,
          startColumnIndex: 0,
          endColumnIndex: 9,
        },
        cell: {
          userEnteredFormat: { backgroundColor: YELLOW },
        },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  await batchUpdate(spreadsheetId, requests);

  const values: string[][] = [];
  if (needDateHeader) {
    values.push([dateLabel, '', '', '', '']);
  }
  // A сделка, E тип; B–D пусто; I не пишем
  values.push([dealId, '', '', '', shipType]);

  await updateValues(spreadsheetId, meta.title, insertAt, values);

  const dealRow = needDateHeader ? insertAt + 2 : insertAt + 1; // 1-based
  return {
    ok: true,
    dateHeaderAdded: needDateHeader,
    dateLabel,
    sheetRow: dealRow,
  };
}

/** Best-effort: не ронять выдачу курьера при сбое Google. */
export function enqueueCourierShipmentSheetAppend(dealId: string): void {
  const id = String(dealId || '').trim();
  if (!id || sheetsDisabled()) return;
  void appendCourierShipmentToSheet({ dealId: id }).catch((e) => {
    console.warn(
      '[courier-shipments-sheet]',
      id,
      e instanceof Error ? e.message : e
    );
  });
}
