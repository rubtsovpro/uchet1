/**
 * Внутренний мессенджер сотрудников: DM / группы, файлы в S3 (private).
 */
import type { Hono } from 'hono';
import { all, get, run } from './db.js';
import { newGuid } from './ids.js';
import {
  actorFromContext,
  canAccessSection,
  type Actor,
} from './auth.js';
import { listOnlinePresence } from './presence.js';
import {
  detectMediaType,
  s3ConfigFromEnv,
  s3GetObject,
  s3PutObject,
} from './s3.js';
import { auditFromContext } from './audit.js';

const MAX_BODY = 16_000;
const MAX_FILE = 25 * 1024 * 1024;

const OFFICE_EXT: Record<string, { mime: string; kind: 'document' | 'file' }> = {
  pdf: { mime: 'application/pdf', kind: 'document' },
  doc: { mime: 'application/msword', kind: 'document' },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'document',
  },
  xls: { mime: 'application/vnd.ms-excel', kind: 'document' },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'document',
  },
  ppt: { mime: 'application/vnd.ms-powerpoint', kind: 'document' },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'document',
  },
  txt: { mime: 'text/plain', kind: 'document' },
  csv: { mime: 'text/csv', kind: 'document' },
  zip: { mime: 'application/zip', kind: 'file' },
  rar: { mime: 'application/vnd.rar', kind: 'file' },
  '7z': { mime: 'application/x-7z-compressed', kind: 'file' },
};

type ChatRow = {
  id: string;
  type: 'dm' | 'group';
  title: string;
  dm_key: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type AttachmentDto = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: string;
  url: string;
};

type MessageDto = {
  id: string;
  chat_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  reply_to_id: string;
  forwarded_from_id: string;
  created_at: string;
  deleted: boolean;
  attachments: AttachmentDto[];
  ref: EntityRef | null;
  /** Кто прочитал (только для своих сообщений). */
  reads?: Array<{ actor_id: string; name: string; read_at: string }>;
  /** Сколько участников (кроме отправителя) должно прочитать. */
  readers_total?: number;
  /** unread | partial | read */
  read_status?: 'unread' | 'partial' | 'read';
};

export type EntityRefType =
  | 'deal'
  | 'sales_doc'
  | 'stock_doc'
  | 'warehouse_task'
  | 'product'
  | 'thin_doc'
  | 'supply_order';

export type EntityRef = {
  type: EntityRefType;
  id: string;
  label: string;
  href: string;
};

const REF_TYPES = new Set<string>([
  'deal',
  'sales_doc',
  'stock_doc',
  'warehouse_task',
  'product',
  'thin_doc',
  'supply_order',
]);

const THIN_JOURNAL_HREF: Record<string, string> = {
  supplier_orders: '/purchases/supplier-orders',
  supplier_bills: '/purchases/supplier-bills',
  supplier_returns: '/purchases/supplier-returns',
};

const SALES_DOC_LABEL: Record<string, string> = {
  invoice: 'Счёт',
  upd: 'УПД',
  sf: 'СФ',
  workorder: 'ЗН',
};

const STOCK_DOC_LABEL: Record<string, string> = {
  in: 'Приход',
  out: 'Расход',
  transfer: 'Перемещение',
  writeoff: 'Списание',
};

function requireChatActor(c: Parameters<typeof actorFromContext>[0]): Actor | Response {
  const actor = actorFromContext(c);
  if (!actor) {
    return c.json({ error: 'Нужна авторизация' }, 401);
  }
  if (!canAccessSection(actor, 'chats') && !actor.isSystemAdmin && actor.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав: чаты' }, 403);
  }
  return actor;
}

function isActor(x: Actor | Response): x is Actor {
  return !!x && typeof x === 'object' && 'rights' in x && 'login' in x;
}

function dmKey(a: string, b: string): string {
  return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`;
}

function staffName(actorId: string): string {
  if (actorId === '__admin__') return 'Админ (системный)';
  const row = get<{ name: string }>('SELECT name FROM staff WHERE id = ?', [actorId]);
  return row?.name || actorId.slice(0, 8);
}

function isMember(chatId: string, actorId: string): boolean {
  return !!get(
    'SELECT 1 AS x FROM chat_members WHERE chat_id = ? AND actor_id = ?',
    [chatId, actorId]
  );
}

function isChatAdmin(chatId: string, actor: Actor): boolean {
  if (actor.isSystemAdmin || actor.role === 'admin') return true;
  const row = get<{ role: string }>(
    'SELECT role FROM chat_members WHERE chat_id = ? AND actor_id = ?',
    [chatId, actor.id]
  );
  return row?.role === 'admin';
}

function assertMember(chatId: string, actorId: string): void {
  if (!isMember(chatId, actorId)) throw new Error('Нет доступа к чату');
}

const AUDIO_EXT: Record<string, string> = {
  webm: 'audio/webm',
  weba: 'audio/webm',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
};

function detectAudioMagic(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length >= 4 && buf.slice(0, 4).toString('ascii') === 'OggS') {
    return { ext: 'ogg', mime: 'audio/ogg' };
  }
  if (
    buf.length >= 12
    && buf.slice(0, 4).toString('ascii') === 'RIFF'
    && buf.slice(8, 12).toString('ascii') === 'WAVE'
  ) {
    return { ext: 'wav', mime: 'audio/wav' };
  }
  if (buf.length >= 3 && buf.slice(0, 3).toString('ascii') === 'ID3') {
    return { ext: 'mp3', mime: 'audio/mpeg' };
  }
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) {
    return { ext: 'mp3', mime: 'audio/mpeg' };
  }
  // EBML / WebM (голосовые из MediaRecorder)
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { ext: 'webm', mime: 'audio/webm' };
  }
  if (buf.length >= 12 && buf.slice(4, 8).toString('ascii') === 'ftyp') {
    return { ext: 'm4a', mime: 'audio/mp4' };
  }
  return null;
}

function detectFile(
  buf: Buffer,
  fileName: string
): { ext: string; mime: string; kind: 'image' | 'document' | 'file' | 'audio' } {
  const ext = (fileName.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const audioMagic = detectAudioMagic(buf);
  if (audioMagic) {
    const useExt = AUDIO_EXT[ext] ? ext : audioMagic.ext;
    return { ext: useExt, mime: AUDIO_EXT[useExt] || audioMagic.mime, kind: 'audio' };
  }
  if (AUDIO_EXT[ext]) {
    return { ext, mime: AUDIO_EXT[ext]!, kind: 'audio' };
  }
  const magic = detectMediaType(buf);
  if (magic.kind !== 'file' || magic.ext !== 'bin') return magic;
  const office = OFFICE_EXT[ext];
  if (office) return { ext: ext || 'bin', mime: office.mime, kind: office.kind };
  if (ext) return { ext, mime: 'application/octet-stream', kind: 'file' };
  return magic;
}

function attachmentDtos(messageId: string): AttachmentDto[] {
  const rows = all<{
    id: string;
    name: string;
    mime: string;
    size: number;
    kind: string;
  }>('SELECT id, name, mime, size, kind FROM chat_attachments WHERE message_id = ?', [messageId]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    mime: r.mime,
    size: Number(r.size) || 0,
    kind: r.kind,
    url: `/api/chats/attachments/${r.id}`,
  }));
}

function resolveEntityRef(input: {
  type?: string;
  id?: string;
  label?: string;
  href?: string;
} | null | undefined): EntityRef | null {
  if (!input) return null;
  const type = String(input.type || '').trim().toLowerCase();
  const id = String(input.id || '').trim();
  if (!REF_TYPES.has(type) || !id) return null;

  if (type === 'deal') {
    const row = get<{ id: string; name: string; price: number }>(
      `SELECT id, IFNULL(name,'') AS name, IFNULL(price,0) AS price FROM crm_deals WHERE id = ?`,
      [id]
    );
    if (!row) throw new Error('Сделка не найдена');
    const name = String(row.name || '').trim() || `Сделка ${id.slice(0, 8)}`;
    const label =
      String(input.label || '').trim() ||
      (row.price ? `${name} · ${Math.round(Number(row.price)).toLocaleString('ru-RU')} ₽` : name);
    return { type: 'deal', id: row.id, label, href: String(input.href || '').trim() || `/crm/deals/${row.id}` };
  }

  if (type === 'sales_doc') {
    const row = get<{ id: string; doc_type: string; number: string; deal_id: string }>(
      `SELECT id, IFNULL(doc_type,'') AS doc_type, IFNULL(number,'') AS number, IFNULL(deal_id,'') AS deal_id
       FROM sales_docs WHERE id = ?`,
      [id]
    );
    if (!row) throw new Error('Документ продаж не найден');
    const kind = SALES_DOC_LABEL[row.doc_type] || row.doc_type || 'Документ';
    const label =
      String(input.label || '').trim() ||
      `${kind} ${row.number || row.id.slice(0, 8)}`;
    return {
      type: 'sales_doc',
      id: row.id,
      label,
      href: String(input.href || '').trim() || `/sales/doc/${row.id}`,
    };
  }

  if (type === 'stock_doc') {
    const row = get<{ id: string; doc_type: string; number: string }>(
      `SELECT id, IFNULL(doc_type,'') AS doc_type, IFNULL(number,'') AS number FROM stock_docs WHERE id = ?`,
      [id]
    );
    if (!row) throw new Error('Складской документ не найден');
    const kind = STOCK_DOC_LABEL[row.doc_type] || row.doc_type || 'Склад';
    const label =
      String(input.label || '').trim() ||
      `${kind} ${row.number || row.id.slice(0, 8)}`;
    return {
      type: 'stock_doc',
      id: row.id,
      label,
      href: String(input.href || '').trim() || `/docs/${row.id}`,
    };
  }

  if (type === 'product') {
    const row = get<{ id: string; name: string; sku: string; code: string }>(
      `SELECT id, IFNULL(name,'') AS name, IFNULL(sku,'') AS sku, IFNULL(code,'') AS code
       FROM products WHERE id = ?`,
      [id]
    );
    if (!row) throw new Error('Товар не найден');
    const sku = String(row.sku || row.code || '').trim();
    const name = String(row.name || '').trim() || sku || `Товар ${id.slice(0, 8)}`;
    const label = String(input.label || '').trim() || (sku ? `${sku} · ${name}` : name);
    return {
      type: 'product',
      id: row.id,
      label,
      href: String(input.href || '').trim() || `/products/${row.id}`,
    };
  }

  if (type === 'thin_doc') {
    const row = get<{
      id: string;
      journal_key: string;
      number: string;
      counterparty_name: string;
    }>(
      `SELECT id, journal_key, IFNULL(number,'') AS number,
              IFNULL(counterparty_name,'') AS counterparty_name
       FROM thin_journal_docs WHERE id = ?`,
      [id]
    );
    if (!row) throw new Error('Документ журнала не найден');
    const base =
      THIN_JOURNAL_HREF[row.journal_key] ||
      `/purchases/${encodeURIComponent(row.journal_key.replace(/_/g, '-'))}`;
    const kind =
      row.journal_key === 'supplier_orders'
        ? 'Заказ поставщику'
        : row.journal_key === 'supplier_bills'
          ? 'Счёт поставщика'
          : 'Документ';
    const label =
      String(input.label || '').trim() ||
      `${kind} ${row.number || row.id.slice(0, 8)}${
        row.counterparty_name ? ' · ' + row.counterparty_name : ''
      }`;
    return {
      type: 'thin_doc',
      id: row.id,
      label,
      href: String(input.href || '').trim() || `${base}?doc=${encodeURIComponent(row.id)}`,
    };
  }

  if (type === 'supply_order') {
    const row = get<{ id: string; number: string; status: string; counterparty_id: string }>(
      `SELECT id, IFNULL(number,'') AS number, IFNULL(status,'') AS status,
              IFNULL(counterparty_id,'') AS counterparty_id
       FROM supplier_orders WHERE id = ?`,
      [id]
    );
    if (!row) throw new Error('Заказ поставки не найден');
    const cp = row.counterparty_id
      ? get<{ name: string }>(`SELECT IFNULL(name,'') AS name FROM counterparties WHERE id = ?`, [
          row.counterparty_id,
        ])
      : null;
    const label =
      String(input.label || '').trim() ||
      `Поставка ${row.number || row.id.slice(0, 8)}${cp?.name ? ' · ' + cp.name : ''}`;
    return {
      type: 'supply_order',
      id: row.id,
      label,
      href: String(input.href || '').trim() || `/supply?order=${encodeURIComponent(row.id)}`,
    };
  }

  const task = get<{ id: string; number: string; buyer_name: string; status: string }>(
    `SELECT id, IFNULL(number,'') AS number, IFNULL(buyer_name,'') AS buyer_name, IFNULL(status,'') AS status
     FROM warehouse_tasks WHERE id = ?`,
    [id]
  );
  if (!task) throw new Error('Задание склада не найдено');
  const label =
    String(input.label || '').trim() ||
    `Задание ${task.number || task.id.slice(0, 8)}${task.buyer_name ? ' · ' + task.buyer_name : ''}`;
  return {
    type: 'warehouse_task',
    id: task.id,
    label,
    href: String(input.href || '').trim() || `/warehouse/tasks`,
  };
}

function searchEntities(q: string, limit = 24): { items: EntityRef[] } {
  const needle = String(q || '').trim();
  const lim = Math.min(40, Math.max(1, limit));
  if (needle.length < 1) return { items: [] };
  const like = `%${needle.replace(/%/g, '')}%`;
  const items: EntityRef[] = [];

  const deals = all<{ id: string; name: string; price: number }>(
    `SELECT id, IFNULL(name,'') AS name, IFNULL(price,0) AS price
     FROM crm_deals
     WHERE id LIKE ? OR IFNULL(name,'') LIKE ? OR IFNULL(buyer_name,'') LIKE ? OR IFNULL(company_name,'') LIKE ?
     ORDER BY datetime(IFNULL(updated_at, created_at)) DESC
     LIMIT ?`,
    [like, like, like, like, lim]
  );
  for (const d of deals) {
    items.push({
      type: 'deal',
      id: d.id,
      label: d.price
        ? `${d.name || d.id.slice(0, 8)} · ${Math.round(Number(d.price)).toLocaleString('ru-RU')} ₽`
        : d.name || `Сделка ${d.id.slice(0, 8)}`,
      href: `/crm/deals/${d.id}`,
    });
  }

  const sales = all<{ id: string; doc_type: string; number: string; counterparty_name: string }>(
    `SELECT id, IFNULL(doc_type,'') AS doc_type, IFNULL(number,'') AS number,
            IFNULL(counterparty_name,'') AS counterparty_name
     FROM sales_docs
     WHERE id LIKE ? OR IFNULL(number,'') LIKE ? OR IFNULL(deal_id,'') LIKE ?
       OR IFNULL(counterparty_name,'') LIKE ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?`,
    [like, like, like, like, lim]
  );
  for (const s of sales) {
    const kind = SALES_DOC_LABEL[s.doc_type] || s.doc_type || 'Документ';
    items.push({
      type: 'sales_doc',
      id: s.id,
      label: `${kind} ${s.number || s.id.slice(0, 8)}${s.counterparty_name ? ' · ' + s.counterparty_name : ''}`,
      href: `/sales/doc/${s.id}`,
    });
  }

  const stock = all<{ id: string; doc_type: string; number: string; comment: string }>(
    `SELECT id, IFNULL(doc_type,'') AS doc_type, IFNULL(number,'') AS number, IFNULL(comment,'') AS comment
     FROM stock_docs
     WHERE id LIKE ? OR IFNULL(number,'') LIKE ? OR IFNULL(deal_id,'') LIKE ? OR IFNULL(comment,'') LIKE ?
     ORDER BY datetime(IFNULL(doc_date, created_at)) DESC
     LIMIT ?`,
    [like, like, like, like, lim]
  );
  for (const d of stock) {
    const kind = STOCK_DOC_LABEL[d.doc_type] || d.doc_type || 'Склад';
    items.push({
      type: 'stock_doc',
      id: d.id,
      label: `${kind} ${d.number || d.id.slice(0, 8)}`,
      href: `/docs/${d.id}`,
    });
  }

  const tasks = all<{ id: string; number: string; buyer_name: string; barcode: string }>(
    `SELECT id, IFNULL(number,'') AS number, IFNULL(buyer_name,'') AS buyer_name, IFNULL(barcode,'') AS barcode
     FROM warehouse_tasks
     WHERE id LIKE ? OR IFNULL(number,'') LIKE ? OR IFNULL(barcode,'') LIKE ?
       OR IFNULL(buyer_name,'') LIKE ? OR IFNULL(deal_id,'') LIKE ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?`,
    [like, like, like, like, like, lim]
  );
  for (const t of tasks) {
    items.push({
      type: 'warehouse_task',
      id: t.id,
      label: `Задание ${t.number || t.id.slice(0, 8)}${t.buyer_name ? ' · ' + t.buyer_name : ''}`,
      href: `/warehouse/tasks`,
    });
  }

  const products = all<{ id: string; name: string; sku: string; code: string }>(
    `SELECT id, IFNULL(name,'') AS name, IFNULL(sku,'') AS sku, IFNULL(code,'') AS code
     FROM products
     WHERE id LIKE ? OR IFNULL(sku,'') LIKE ? OR IFNULL(code,'') LIKE ? OR IFNULL(name,'') LIKE ?
       OR IFNULL(barcode,'') LIKE ?
     ORDER BY IFNULL(is_active,1) DESC, name
     LIMIT ?`,
    [like, like, like, like, like, lim]
  );
  for (const p of products) {
    const sku = String(p.sku || p.code || '').trim();
    const name = String(p.name || '').trim() || sku || p.id.slice(0, 8);
    items.push({
      type: 'product',
      id: p.id,
      label: sku ? `${sku} · ${name}` : name,
      href: `/products/${p.id}`,
    });
  }

  const thinDocs = all<{
    id: string;
    journal_key: string;
    number: string;
    counterparty_name: string;
  }>(
    `SELECT id, journal_key, IFNULL(number,'') AS number,
            IFNULL(counterparty_name,'') AS counterparty_name
     FROM thin_journal_docs
     WHERE id LIKE ? OR IFNULL(number,'') LIKE ? OR IFNULL(counterparty_name,'') LIKE ?
     ORDER BY datetime(updated_at) DESC
     LIMIT ?`,
    [like, like, like, lim]
  );
  for (const t of thinDocs) {
    const base =
      THIN_JOURNAL_HREF[t.journal_key] ||
      `/purchases/${encodeURIComponent(t.journal_key.replace(/_/g, '-'))}`;
    const kind = t.journal_key === 'supplier_orders' ? 'Заказ поставщику' : 'Документ';
    items.push({
      type: 'thin_doc',
      id: t.id,
      label: `${kind} ${t.number || t.id.slice(0, 8)}${
        t.counterparty_name ? ' · ' + t.counterparty_name : ''
      }`,
      href: `${base}?doc=${encodeURIComponent(t.id)}`,
    });
  }

  const supplyOrders = all<{ id: string; number: string; counterparty_id: string }>(
    `SELECT id, IFNULL(number,'') AS number, IFNULL(counterparty_id,'') AS counterparty_id
     FROM supplier_orders
     WHERE id LIKE ? OR IFNULL(number,'') LIKE ?
     ORDER BY datetime(updated_at) DESC
     LIMIT ?`,
    [like, like, lim]
  );
  for (const o of supplyOrders) {
    const cp = o.counterparty_id
      ? get<{ name: string }>(`SELECT IFNULL(name,'') AS name FROM counterparties WHERE id = ?`, [
          o.counterparty_id,
        ])
      : null;
    items.push({
      type: 'supply_order',
      id: o.id,
      label: `Поставка ${o.number || o.id.slice(0, 8)}${cp?.name ? ' · ' + cp.name : ''}`,
      href: `/supply?order=${encodeURIComponent(o.id)}`,
    });
  }

  return { items: items.slice(0, lim) };
}

function messageDto(row: {
  id: string;
  chat_id: string;
  sender_id: string;
  body: string;
  reply_to_id: string;
  forwarded_from_id: string;
  created_at: string;
  deleted_at: string;
  ref_type?: string;
  ref_id?: string;
  ref_label?: string;
  ref_href?: string;
}, opts?: { viewerId?: string; readersTotal?: number; memberReads?: Array<{ actor_id: string; name: string; read_at: string }> }): MessageDto {
  const deleted = Boolean(row.deleted_at);
  const refType = String(row.ref_type || '').trim();
  const refId = String(row.ref_id || '').trim();
  const ref =
    !deleted && REF_TYPES.has(refType) && refId
      ? {
          type: refType as EntityRefType,
          id: refId,
          label: String(row.ref_label || '').trim() || refId.slice(0, 12),
          href: String(row.ref_href || '').trim() || '',
        }
      : null;
  const dto: MessageDto = {
    id: row.id,
    chat_id: row.chat_id,
    sender_id: row.sender_id,
    sender_name: staffName(row.sender_id),
    body: deleted ? '' : row.body,
    reply_to_id: row.reply_to_id || '',
    forwarded_from_id: row.forwarded_from_id || '',
    created_at: row.created_at,
    deleted,
    attachments: deleted ? [] : attachmentDtos(row.id),
    ref,
  };
  const viewerId = String(opts?.viewerId || '').trim();
  if (
    viewerId &&
    viewerId === String(row.sender_id || '') &&
    !deleted &&
    Array.isArray(opts?.memberReads)
  ) {
    const createdAt = String(row.created_at || '');
    const reads = opts!.memberReads!.filter(
      (m) =>
        m.actor_id !== viewerId &&
        m.read_at &&
        // сравнение строк datetime SQLite 'YYYY-MM-DD HH:MM:SS' лексикографически ок
        String(m.read_at).replace('T', ' ') >= createdAt.replace('T', ' ')
    );
    const total = Math.max(0, Number(opts?.readersTotal) || 0);
    dto.reads = reads.map((r) => ({
      actor_id: r.actor_id,
      name: r.name || staffName(r.actor_id),
      read_at: r.read_at,
    }));
    dto.readers_total = total;
    if (!total) dto.read_status = 'unread';
    else if (reads.length <= 0) dto.read_status = 'unread';
    else if (reads.length >= total) dto.read_status = 'read';
    else dto.read_status = 'partial';
  }
  return dto;
}

/** Участники чата (кроме себя) с last_read_at — для квитанций прочтения. */
function chatMemberReads(chatId: string, excludeActorId: string) {
  return all<{ actor_id: string; name: string; read_at: string }>(
    `SELECT m.actor_id AS actor_id,
            IFNULL(NULLIF(s.name,''), m.actor_id) AS name,
            IFNULL(m.last_read_at,'') AS read_at
     FROM chat_members m
     LEFT JOIN staff s ON s.id = m.actor_id
     WHERE m.chat_id = ?
       AND m.actor_id != ?`,
    [chatId, excludeActorId]
  );
}

function touchChat(chatId: string): void {
  run(`UPDATE chats SET updated_at = datetime('now') WHERE id = ?`, [chatId]);
}

function unreadCount(chatId: string, actorId: string, lastReadAt: string): number {
  if (!lastReadAt) {
    return (
      get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM chat_messages
         WHERE chat_id = ? AND deleted_at = '' AND sender_id != ?`,
        [chatId, actorId]
      )?.c ?? 0
    );
  }
  return (
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM chat_messages
       WHERE chat_id = ? AND deleted_at = '' AND sender_id != ?
         AND datetime(created_at) > datetime(?)`,
      [chatId, actorId, lastReadAt]
    )?.c ?? 0
  );
}

function lastMessagePreview(chatId: string): {
  id: string;
  body: string;
  sender_id: string;
  sender_name: string;
  created_at: string;
  has_attachment: boolean;
} | null {
  const row = get<{
    id: string;
    body: string;
    sender_id: string;
    created_at: string;
    deleted_at: string;
  }>(
    `SELECT id, body, sender_id, created_at, deleted_at FROM chat_messages
     WHERE chat_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1`,
    [chatId]
  );
  if (!row) return null;
  const attKind = get<{ kind: string }>(
    'SELECT kind FROM chat_attachments WHERE message_id = ? ORDER BY id LIMIT 1',
    [row.id]
  )?.kind;
  const hasAtt = !!attKind;
  let body = row.deleted_at ? 'Сообщение удалено' : String(row.body || '').slice(0, 120);
  if (!body && hasAtt) {
    body =
      attKind === 'audio'
        ? 'Голосовое'
        : attKind === 'image'
          ? 'Фото'
          : attKind === 'document'
            ? 'Документ'
            : 'Вложение';
  }
  if (!body && !row.deleted_at) {
    const refLabel = get<{ ref_label: string }>(
      `SELECT IFNULL(ref_label,'') AS ref_label FROM chat_messages WHERE id = ?`,
      [row.id]
    )?.ref_label;
    if (refLabel) body = refLabel.slice(0, 120);
  }
  return {
    id: row.id,
    body,
    sender_id: row.sender_id,
    sender_name: staffName(row.sender_id),
    created_at: row.created_at,
    has_attachment: hasAtt,
  };
}

function peerIds(chatId: string, selfId: string): string[] {
  return all<{ actor_id: string }>(
    'SELECT actor_id FROM chat_members WHERE chat_id = ? AND actor_id != ?',
    [chatId, selfId]
  ).map((r) => r.actor_id);
}

function chatTitleFor(chat: ChatRow, selfId: string): string {
  if (chat.type === 'group') return chat.title || 'Группа';
  const peers = peerIds(chat.id, selfId);
  if (peers.length === 1) return staffName(peers[0]!);
  return chat.title || 'Личный чат';
}

function listChatsFor(actor: Actor) {
  const online = new Set(listOnlinePresence().map((p) => p.actor_id));
  const memberships = all<{
    chat_id: string;
    last_read_at: string;
    role: string;
  }>(
    `SELECT chat_id, last_read_at, role FROM chat_members WHERE actor_id = ?`,
    [actor.id]
  );
  const items = [];
  for (const m of memberships) {
    const chat = get<ChatRow>('SELECT * FROM chats WHERE id = ?', [m.chat_id]);
    if (!chat) continue;
    const peers = peerIds(chat.id, actor.id);
    const peerOnline = peers.some((id) => online.has(id));
    items.push({
      id: chat.id,
      type: chat.type,
      title: chatTitleFor(chat, actor.id),
      created_by: chat.created_by,
      created_at: chat.created_at,
      updated_at: chat.updated_at,
      my_role: m.role,
      unread: unreadCount(chat.id, actor.id, m.last_read_at || ''),
      peer_ids: peers,
      peer_online: chat.type === 'dm' ? peerOnline : peers.some((id) => online.has(id)),
      last_message: lastMessagePreview(chat.id),
    });
  }
  items.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  const unread_total = items.reduce((s, it) => s + (it.unread || 0), 0);
  return { items, unread_total };
}

function getOrCreateDm(actor: Actor, peerId: string): ChatRow {
  const peer = peerId.trim();
  if (!peer || peer === actor.id) throw new Error('Укажите другого сотрудника');
  if (peer !== '__admin__') {
    const exists = get('SELECT id FROM staff WHERE id = ?', [peer]);
    if (!exists) throw new Error('Сотрудник не найден');
  }
  const key = dmKey(actor.id, peer);
  const existing = get<ChatRow>('SELECT * FROM chats WHERE dm_key = ?', [key]);
  if (existing) {
    if (!isMember(existing.id, actor.id)) {
      run(
        `INSERT OR IGNORE INTO chat_members (chat_id, actor_id, role) VALUES (?, ?, 'member')`,
        [existing.id, actor.id]
      );
    }
    return existing;
  }
  const id = newGuid();
  run(
    `INSERT INTO chats (id, type, title, dm_key, created_by) VALUES (?, 'dm', '', ?, ?)`,
    [id, key, actor.id]
  );
  run(`INSERT INTO chat_members (chat_id, actor_id, role) VALUES (?, ?, 'admin')`, [
    id,
    actor.id,
  ]);
  run(`INSERT INTO chat_members (chat_id, actor_id, role) VALUES (?, ?, 'member')`, [
    id,
    peer,
  ]);
  return get<ChatRow>('SELECT * FROM chats WHERE id = ?', [id])!;
}

function createGroup(actor: Actor, title: string, memberIds: string[]): ChatRow {
  const t = title.trim().slice(0, 120);
  if (!t) throw new Error('Нужно название группы');
  const ids = [...new Set(memberIds.map((x) => String(x || '').trim()).filter(Boolean))];
  const filtered = ids.filter((id) => id !== actor.id);
  for (const id of filtered) {
    if (!get('SELECT id FROM staff WHERE id = ?', [id])) {
      throw new Error(`Сотрудник не найден: ${id}`);
    }
  }
  const chatId = newGuid();
  run(
    `INSERT INTO chats (id, type, title, dm_key, created_by) VALUES (?, 'group', ?, '', ?)`,
    [chatId, t, actor.id]
  );
  run(`INSERT INTO chat_members (chat_id, actor_id, role) VALUES (?, ?, 'admin')`, [
    chatId,
    actor.id,
  ]);
  for (const mid of filtered) {
    run(`INSERT OR IGNORE INTO chat_members (chat_id, actor_id, role) VALUES (?, ?, 'member')`, [
      chatId,
      mid,
    ]);
  }
  return get<ChatRow>('SELECT * FROM chats WHERE id = ?', [chatId])!;
}

function insertMessage(input: {
  chatId: string;
  senderId: string;
  body: string;
  replyToId?: string;
  forwardedFromId?: string;
  ref?: EntityRef | null;
}): { id: string } {
  const body = String(input.body || '').trim().slice(0, MAX_BODY);
  const replyTo = String(input.replyToId || '').trim();
  const fwd = String(input.forwardedFromId || '').trim();
  if (replyTo) {
    const ok = get(
      'SELECT id FROM chat_messages WHERE id = ? AND chat_id = ?',
      [replyTo, input.chatId]
    );
    if (!ok) throw new Error('Ответ на неизвестное сообщение');
  }
  if (fwd) {
    const ok = get('SELECT id FROM chat_messages WHERE id = ?', [fwd]);
    if (!ok) throw new Error('Пересылаемое сообщение не найдено');
  }
  if (!body && !fwd) {
    // attachment-only messages allowed when caller adds files after
  }
  const ref = input.ref || null;
  const id = newGuid();
  run(
    `INSERT INTO chat_messages (
       id, chat_id, sender_id, body, reply_to_id, forwarded_from_id,
       ref_type, ref_id, ref_label, ref_href
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.chatId,
      input.senderId,
      body,
      replyTo,
      fwd,
      ref?.type || '',
      ref?.id || '',
      ref?.label || '',
      ref?.href || '',
    ]
  );
  touchChat(input.chatId);
  return { id };
}

function copyAttachments(fromMessageId: string, toMessageId: string, chatId: string): void {
  const rows = all<{
    s3_key: string;
    mime: string;
    size: number;
    name: string;
    kind: string;
  }>('SELECT s3_key, mime, size, name, kind FROM chat_attachments WHERE message_id = ?', [
    fromMessageId,
  ]);
  for (const r of rows) {
    run(
      `INSERT INTO chat_attachments (id, message_id, s3_key, mime, size, name, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newGuid(), toMessageId, r.s3_key, r.mime, r.size, r.name, r.kind]
    );
  }
  void chatId;
}

async function storeAttachment(opts: {
  chatId: string;
  messageId: string;
  buf: Buffer;
  fileName: string;
}): Promise<AttachmentDto> {
  const cfg = s3ConfigFromEnv();
  if (!cfg) throw new Error('S3 не настроен (S3_ENDPOINT / BUCKET / ACCESS_KEY / SECRET_KEY)');
  if (!opts.buf.length) throw new Error('Пустой файл');
  if (opts.buf.length > MAX_FILE) throw new Error('Файл больше 25 МБ');
  const meta = detectFile(opts.buf, opts.fileName);
  const attId = newGuid();
  const safeName = (opts.fileName || `file.${meta.ext}`).replace(/[^\w.\-а-яА-ЯёЁ ()]/gi, '_').slice(0, 180);
  const key = `chat/${opts.chatId}/${opts.messageId}/${attId}.${meta.ext}`;
  await s3PutObject(cfg, key, opts.buf, meta.mime, false);
  run(
    `INSERT INTO chat_attachments (id, message_id, s3_key, mime, size, name, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [attId, opts.messageId, key, meta.mime, opts.buf.length, safeName, meta.kind]
  );
  return {
    id: attId,
    name: safeName,
    mime: meta.mime,
    size: opts.buf.length,
    kind: meta.kind,
    url: `/api/chats/attachments/${attId}`,
  };
}

function directory(q: string, selfId: string) {
  const needle = q.trim().toLowerCase();
  let rows = all<{
    id: string;
    name: string;
    role: string;
    department: string;
    email: string;
    can_login: number;
  }>(
    `SELECT id, name, role, COALESCE(department,'') AS department, COALESCE(email,'') AS email, can_login
     FROM staff
     WHERE trim(COALESCE(name,'')) != ''
       AND (role != 'none' OR can_login = 1)
     ORDER BY name COLLATE NOCASE
     LIMIT 500`
  );
  if (needle) {
    rows = rows.filter((r) => {
      const hay = [r.name, r.email, r.department, r.role, r.id]
        .map((x) => String(x || '').toLowerCase())
        .join(' ');
      return hay.includes(needle);
    });
  }
  const online = new Set(listOnlinePresence().map((p) => p.actor_id));
  return {
    items: rows
      .filter((r) => r.id !== selfId)
      .slice(0, 120)
      .map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        department: r.department,
        email: r.email,
        can_login: !!r.can_login,
        online: online.has(r.id),
      })),
  };
}

function serializeChat(chat: ChatRow, actor: Actor) {
  const peers = peerIds(chat.id, actor.id);
  const online = new Set(listOnlinePresence().map((p) => p.actor_id));
  const mem = get<{ role: string; last_read_at: string }>(
    'SELECT role, last_read_at FROM chat_members WHERE chat_id = ? AND actor_id = ?',
    [chat.id, actor.id]
  );
  const members = all<{ actor_id: string; role: string }>(
    'SELECT actor_id, role FROM chat_members WHERE chat_id = ? ORDER BY joined_at',
    [chat.id]
  ).map((m) => ({
    actor_id: m.actor_id,
    name: staffName(m.actor_id),
    role: m.role,
    online: online.has(m.actor_id),
  }));
  return {
    id: chat.id,
    type: chat.type,
    title: chatTitleFor(chat, actor.id),
    created_by: chat.created_by,
    created_at: chat.created_at,
    updated_at: chat.updated_at,
    my_role: mem?.role || 'member',
    unread: unreadCount(chat.id, actor.id, mem?.last_read_at || ''),
    peer_ids: peers,
    peer_online: peers.some((id) => online.has(id)),
    members,
    last_message: lastMessagePreview(chat.id),
  };
}

export function mountChatRoutes(api: Hono): void {
  api.get('/chats', (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    return c.json(listChatsFor(actor));
  });

  /** Лёгкий опрос бейджа (FAB / меню). */
  api.get('/chats/unread', (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    const full = listChatsFor(actor);
    const withUnread = full.items
      .filter((it: { unread?: number }) => Number(it.unread) > 0)
      .map((it: Record<string, unknown>) => ({
        id: it.id,
        type: it.type,
        title: it.title,
        unread: it.unread,
        last_message: it.last_message,
        updated_at: it.updated_at,
      }));
    return c.json({
      unread_total: full.unread_total,
      items: withUnread,
      chats_count: full.items.length,
    });
  });

  api.get('/chats/directory', (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    return c.json(directory(c.req.query('q') || '', actor.id));
  });

  api.get('/chats/entity-search', (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    try {
      return c.json(
        searchEntities(c.req.query('q') || '', Number(c.req.query('limit') || 24))
      );
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'search failed' }, 400);
    }
  });

  api.post('/chats/entity-resolve', async (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    const body = await c.req
      .json<{ type?: string; id?: string; label?: string; href?: string }>()
      .catch(() => ({} as Record<string, string>));
    try {
      const ref = resolveEntityRef(body);
      if (!ref) return c.json({ error: 'Укажите type и id сущности' }, 400);
      return c.json({ ref });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'resolve failed' }, 400);
    }
  });

  api.get('/staff/directory', (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    return c.json(directory(c.req.query('q') || '', actor.id));
  });

  api.post('/chats/dm', async (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    const body = await c.req
      .json<{ peer_id?: string }>()
      .catch(() => ({}) as { peer_id?: string });
    try {
      const chat = getOrCreateDm(actor, String(body.peer_id || ''));
      auditFromContext(c, {
        action: 'chat.dm',
        entity: 'chat',
        entityId: chat.id,
        summary: `DM с ${staffName(String(body.peer_id || ''))}`,
      });
      return c.json(serializeChat(chat, actor));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/chats/group', async (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    const body = await c.req
      .json<{ title?: string; member_ids?: string[] }>()
      .catch(() => ({} as { title?: string; member_ids?: string[] }));
    try {
      const chat = createGroup(actor, String(body.title || ''), body.member_ids || []);
      auditFromContext(c, {
        action: 'chat.group',
        entity: 'chat',
        entityId: chat.id,
        summary: `Группа «${chat.title}»`,
      });
      return c.json(serializeChat(chat, actor), 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.get('/chats/attachments/:id', async (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    const attId = c.req.param('id');
    const att = get<{
      id: string;
      message_id: string;
      s3_key: string;
      mime: string;
      name: string;
      size: number;
    }>('SELECT * FROM chat_attachments WHERE id = ?', [attId]);
    if (!att) return c.json({ error: 'not found' }, 404);
    const msg = get<{ chat_id: string; deleted_at: string }>(
      'SELECT chat_id, deleted_at FROM chat_messages WHERE id = ?',
      [att.message_id]
    );
    if (!msg || msg.deleted_at) return c.json({ error: 'not found' }, 404);
    if (!isMember(msg.chat_id, actor.id)) return c.json({ error: 'Нет доступа' }, 403);
    const cfg = s3ConfigFromEnv();
    if (!cfg) return c.json({ error: 'S3 не настроен' }, 500);
    try {
      const { body, contentType } = await s3GetObject(cfg, att.s3_key);
      const mime = att.mime || contentType || 'application/octet-stream';
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(body.length),
          'Content-Disposition': `inline; filename="${encodeURIComponent(att.name || 'file')}"`,
          'Cache-Control': 'private, max-age=60',
        },
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'S3 get failed' }, 500);
    }
  });

  api.get('/chats/:id/messages', (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    const chatId = c.req.param('id');
    try {
      assertMember(chatId, actor.id);
    } catch {
      return c.json({ error: 'Нет доступа к чату' }, 403);
    }
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') || 50)));
    const after = (c.req.query('after') || '').trim();
    const before = (c.req.query('before') || '').trim();
    let rows: Array<{
      id: string;
      chat_id: string;
      sender_id: string;
      body: string;
      reply_to_id: string;
      forwarded_from_id: string;
      created_at: string;
      deleted_at: string;
    }>;
    if (after) {
      const pivot = get<{ created_at: string }>(
        'SELECT created_at FROM chat_messages WHERE id = ? AND chat_id = ?',
        [after, chatId]
      );
      rows = all(
        `SELECT * FROM chat_messages
         WHERE chat_id = ?
           AND (datetime(created_at) > datetime(?) OR (created_at = ? AND id > ?))
         ORDER BY datetime(created_at) ASC, id ASC
         LIMIT ?`,
        [chatId, pivot?.created_at || after, pivot?.created_at || after, after, limit]
      );
    } else if (before) {
      const pivot = get<{ created_at: string }>(
        'SELECT created_at FROM chat_messages WHERE id = ? AND chat_id = ?',
        [before, chatId]
      );
      rows = all(
        `SELECT * FROM chat_messages
         WHERE chat_id = ?
           AND (datetime(created_at) < datetime(?) OR (created_at = ? AND id < ?))
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT ?`,
        [chatId, pivot?.created_at || before, pivot?.created_at || before, before, limit]
      );
      rows.reverse();
    } else {
      rows = all(
        `SELECT * FROM chat_messages WHERE chat_id = ?
         ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`,
        [chatId, limit]
      );
      rows.reverse();
    }
    const memberReads = chatMemberReads(chatId, actor.id);
    const readersTotal = memberReads.length;
    return c.json({
      items: rows.map((row) =>
        messageDto(row, {
          viewerId: actor.id,
          readersTotal,
          memberReads,
        })
      ),
    });
  });

  api.post('/chats/:id/messages', async (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    const chatId = c.req.param('id');
    try {
      assertMember(chatId, actor.id);
    } catch {
      return c.json({ error: 'Нет доступа к чату' }, 403);
    }
    const body = await c.req
      .json<{
        body?: string;
        reply_to?: string;
        reply_to_id?: string;
        forward_from?: string;
        forwarded_from_id?: string;
        ref?: { type?: string; id?: string; label?: string; href?: string };
      }>()
      .catch(() => ({} as Record<string, unknown>));
    const text = String(body.body || '').trim();
    const replyTo = String(body.reply_to || body.reply_to_id || '').trim();
    const fwd = String(body.forward_from || body.forwarded_from_id || '').trim();
    try {
      let forwardBody = text;
      if (fwd && !text) {
        const src = get<{ body: string; deleted_at: string }>(
          'SELECT body, deleted_at FROM chat_messages WHERE id = ?',
          [fwd]
        );
        if (!src || src.deleted_at) return c.json({ error: 'Исходное сообщение недоступно' }, 400);
        forwardBody = src.body || '';
      }
      const ref = resolveEntityRef(
        body.ref && typeof body.ref === 'object'
          ? (body.ref as { type?: string; id?: string; label?: string; href?: string })
          : null
      );
      if (!text && !fwd && !ref) return c.json({ error: 'Пустое сообщение' }, 400);
      const { id } = insertMessage({
        chatId,
        senderId: actor.id,
        body: forwardBody,
        replyToId: replyTo,
        forwardedFromId: fwd,
        ref,
      });
      if (fwd) copyAttachments(fwd, id, chatId);
      const row = get<Parameters<typeof messageDto>[0]>(
        'SELECT * FROM chat_messages WHERE id = ?',
        [id]
      )!;
      return c.json(messageDto(row), 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
    }
  });

  api.post('/chats/:id/attachments', async (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    const chatId = c.req.param('id');
    try {
      assertMember(chatId, actor.id);
    } catch {
      return c.json({ error: 'Нет доступа к чату' }, 403);
    }
    let buf: Buffer | null = null;
    let fileName = 'file';
    let caption = '';
    let replyTo = '';
    let refRaw = '';
    try {
      const contentType = (c.req.header('content-type') || '').toLowerCase();
      if (contentType.includes('multipart/form-data')) {
        const form = await c.req.parseBody({ all: true });
        const file = form.file ?? form.attachment ?? form.document;
        if (file && typeof file === 'object' && 'arrayBuffer' in file) {
          const f = file as File;
          buf = Buffer.from(await f.arrayBuffer());
          fileName = f.name || fileName;
        }
        caption = String(form.body || form.caption || '').trim();
        replyTo = String(form.reply_to || form.reply_to_id || '').trim();
        refRaw = String(form.ref || form.entity_ref || '').trim();
      } else {
        return c.json({ error: 'Нужен multipart/form-data с полем file' }, 400);
      }
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'Не удалось прочитать файл' }, 400);
    }
    if (!buf?.length) return c.json({ error: 'Нужен файл (поле file)' }, 400);
    try {
      let ref: EntityRef | null = null;
      if (refRaw) {
        try {
          ref = resolveEntityRef(JSON.parse(refRaw) as {
            type?: string;
            id?: string;
            label?: string;
            href?: string;
          });
        } catch {
          throw new Error('Некорректный ref (JSON)');
        }
      }
      const { id } = insertMessage({
        chatId,
        senderId: actor.id,
        body: caption,
        replyToId: replyTo,
        ref,
      });
      const att = await storeAttachment({ chatId, messageId: id, buf, fileName });
      const row = get<Parameters<typeof messageDto>[0]>(
        'SELECT * FROM chat_messages WHERE id = ?',
        [id]
      )!;
      auditFromContext(c, {
        action: 'chat.attachment',
        entity: 'chat',
        entityId: chatId,
        summary: `Файл в чат: ${att.name} (${Math.round(att.size / 1024)} КБ)`,
      });
      return c.json({ ...messageDto(row), attachment: att }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'upload failed';
      const status = /S3 не|больше|Пустой|не найден|Ответ|ref|сущност/i.test(msg) ? 400 : 500;
      return c.json({ error: msg }, status);
    }
  });

  api.post('/chats/:id/read', (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    const chatId = c.req.param('id');
    if (!isMember(chatId, actor.id)) return c.json({ error: 'Нет доступа к чату' }, 403);
    run(
      `UPDATE chat_members SET last_read_at = datetime('now') WHERE chat_id = ? AND actor_id = ?`,
      [chatId, actor.id]
    );
    return c.json({ ok: true });
  });

  api.get('/chats/:id/members', (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    const chatId = c.req.param('id');
    if (!isMember(chatId, actor.id)) return c.json({ error: 'Нет доступа к чату' }, 403);
    const chat = get<ChatRow>('SELECT * FROM chats WHERE id = ?', [chatId]);
    if (!chat) return c.json({ error: 'not found' }, 404);
    return c.json({ items: serializeChat(chat, actor).members });
  });

  api.post('/chats/:id/members', async (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    const chatId = c.req.param('id');
    const chat = get<ChatRow>('SELECT * FROM chats WHERE id = ?', [chatId]);
    if (!chat) return c.json({ error: 'not found' }, 404);
    if (chat.type !== 'group') return c.json({ error: 'Участников DM менять нельзя' }, 400);
    if (!isChatAdmin(chatId, actor)) return c.json({ error: 'Только админ чата' }, 403);
    const body = await c.req
      .json<{ actor_id?: string; member_ids?: string[] }>()
      .catch(() => ({}) as { actor_id?: string; member_ids?: string[] });
    const ids = [
      ...new Set(
        [
          String(body.actor_id || '').trim(),
          ...(body.member_ids || []).map((x: string) => String(x || '').trim()),
        ].filter(Boolean)
      ),
    ];
    if (!ids.length) return c.json({ error: 'Нужен actor_id или member_ids' }, 400);
    for (const id of ids) {
      if (!get('SELECT id FROM staff WHERE id = ?', [id])) {
        return c.json({ error: `Сотрудник не найден: ${id}` }, 400);
      }
      run(
        `INSERT OR IGNORE INTO chat_members (chat_id, actor_id, role) VALUES (?, ?, 'member')`,
        [chatId, id]
      );
    }
    touchChat(chatId);
    return c.json(serializeChat(get<ChatRow>('SELECT * FROM chats WHERE id = ?', [chatId])!, actor));
  });

  api.delete('/chats/:id/members/:actorId', (c) => {
    const actor = requireChatActor(c);
    if (!isActor(actor)) return actor;
    const chatId = c.req.param('id');
    const targetId = c.req.param('actorId');
    const chat = get<ChatRow>('SELECT * FROM chats WHERE id = ?', [chatId]);
    if (!chat) return c.json({ error: 'not found' }, 404);
    if (chat.type !== 'group') return c.json({ error: 'Участников DM менять нельзя' }, 400);
    const selfLeave = targetId === actor.id;
    if (!selfLeave && !isChatAdmin(chatId, actor)) {
      return c.json({ error: 'Только админ чата' }, 403);
    }
    const admins = all<{ actor_id: string }>(
      `SELECT actor_id FROM chat_members WHERE chat_id = ? AND role = 'admin'`,
      [chatId]
    );
    if (
      admins.length === 1 &&
      admins[0]!.actor_id === targetId
    ) {
      return c.json({ error: 'Нельзя удалить последнего админа группы' }, 400);
    }
    run('DELETE FROM chat_members WHERE chat_id = ? AND actor_id = ?', [chatId, targetId]);
    touchChat(chatId);
    if (selfLeave) return c.json({ ok: true, left: true });
    return c.json(serializeChat(chat, actor));
  });
}
