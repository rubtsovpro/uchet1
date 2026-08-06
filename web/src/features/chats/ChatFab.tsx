import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { StaffMe } from '@/shared/api/types';
import {
  entityTypeLabel,
  parseEntityDragData,
  takePendingChatEntity,
  type ChatEntityRef,
  type OpenChatWithEntityDetail,
} from './chatContext';

type ChatListItem = {
  id: string;
  type: 'dm' | 'group';
  title: string;
  unread: number;
  updated_at: string;
  last_message: {
    body: string;
    sender_name: string;
    created_at: string;
    has_attachment: boolean;
  } | null;
};

type ChatAttachment = {
  id: string;
  name?: string;
  mime?: string;
  size?: number;
  kind?: string;
  url?: string;
};

type ChatReadReceipt = {
  actor_id: string;
  name: string;
  read_at: string;
};

type ChatMessage = {
  id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
  deleted?: boolean;
  attachments?: ChatAttachment[];
  ref?: ChatEntityRef | null;
  reads?: ChatReadReceipt[];
  readers_total?: number;
  read_status?: 'unread' | 'partial' | 'read';
};

function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function voiceExt(mime: string): string {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  return 'webm';
}

function AttachmentMini({ a }: { a: ChatAttachment }) {
  const url = a.url || `/api/chats/attachments/${a.id}`;
  if (a.kind === 'audio' || (a.mime || '').startsWith('audio/')) {
    return (
      <div className="chat-pop-att chat-pop-att-voice">
        <audio controls preload="metadata" src={url} />
      </div>
    );
  }
  if (a.kind === 'image' || (a.mime || '').startsWith('image/')) {
    return (
      <a className="chat-pop-att chat-pop-att-img" href={url} target="_blank" rel="noreferrer" title={a.name}>
        <img src={url} alt={a.name || ''} loading="lazy" />
      </a>
    );
  }
  return (
    <a className="chat-pop-att chat-pop-att-file" href={url} target="_blank" rel="noreferrer">
      <span className="chat-pop-att-ico">{a.kind === 'document' ? 'PDF' : '▤'}</span>
      <span>
        <strong>{a.name || 'Файл'}</strong>
      </span>
    </a>
  );
}

function canChat(me: StaffMe | undefined): boolean {
  if (!me) return false;
  if (me.isSystemAdmin || me.role === 'admin') return true;
  const secs = me.rights?.sections;
  if (!Array.isArray(secs)) return true;
  return secs.includes('chats');
}

function formatTime(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return iso.slice(11, 16) || '';
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatReadReceipt(m: ChatMessage): { text: string; tip: string; cls: string } | null {
  if (m.deleted) return null;
  const status = String(m.read_status || '');
  const reads = Array.isArray(m.reads) ? m.reads : [];
  const total = Number(m.readers_total) || 0;
  if (!status && !reads.length && !total) return null;
  if (status === 'unread' || (!reads.length && total > 0)) {
    return { text: 'не прочитано', tip: 'Ещё не прочитано', cls: 'is-unread' };
  }
  if (total <= 1 || reads.length === 1) {
    const r = reads[0];
    const who = r?.name || '—';
    const when = r ? formatTime(r.read_at) : '';
    return {
      text: `прочитано${who ? ` · ${who}` : ''}${when ? ` · ${when}` : ''}`,
      tip: r ? `${who} · ${when}` : 'Прочитано',
      cls: 'is-read',
    };
  }
  const tip = reads.map((r) => `${r.name || '—'} · ${formatTime(r.read_at)}`).join('\n');
  const short = reads
    .slice(0, 3)
    .map((r) => `${r.name || '—'} ${formatTime(r.read_at)}`)
    .join(', ');
  const more = reads.length > 3 ? ` +${reads.length - 3}` : '';
  return {
    text: `прочитано ${reads.length}/${total}: ${short}${more}`,
    tip,
    cls: 'is-read',
  };
}

export function ChatFab({ me }: { me: StaffMe | undefined }) {
  const qc = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [entityRef, setEntityRef] = useState<ChatEntityRef | null>(null);
  const [dropHint, setDropHint] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [uploading, setUploading] = useState(false);
  const lastUnread = useRef(0);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recMimeRef = useRef('');
  const cancelRecRef = useRef(false);
  const recTimerRef = useRef<number | null>(null);
  const enabled = canChat(me);

  const chatsQ = useQuery({
    queryKey: ['chats'],
    queryFn: () => api<{ items: ChatListItem[]; unread_total: number }>('/chats'),
    refetchInterval: 8_000,
    enabled,
  });

  const msgsQ = useQuery({
    queryKey: ['chats', activeId, 'messages'],
    queryFn: () => api<{ items: ChatMessage[] }>(`/chats/${activeId}/messages?limit=40`),
    enabled: enabled && open && !!activeId,
    refetchInterval: open && activeId ? 5_000 : false,
  });

  const unreadTotal = chatsQ.data?.unread_total || 0;
  const items = chatsQ.data?.items || [];
  const active = items.find((c) => c.id === activeId) || null;
  const messages = msgsQ.data?.items || [];

  useEffect(() => {
    if (unreadTotal > lastUnread.current && lastUnread.current >= 0 && document.hidden) {
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Учёт №1 · Чаты', {
            body: `Новых сообщений: ${unreadTotal}`,
            tag: 'wms-chats-unread',
          });
        }
      } catch {
        /* ignore */
      }
    }
    lastUnread.current = unreadTotal;
  }, [unreadTotal]);

  useEffect(() => {
    if (!open) return;
    // pointerdown — до смены DOM (список → тред). Иначе click ловит уже отсоединённый target
    // и contains() = false → попап сворачивается при выборе чата.
    const onDoc = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (path.includes(root)) return;
      const t = e.target;
      if (t instanceof Node && root.contains(t)) return;
      setOpen(false);
      setActiveId('');
    };
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, [open]);

  useEffect(() => {
    if (!activeId || !open) return;
    void api(`/chats/${activeId}/read`, { method: 'POST', body: {} }).then(() => {
      void qc.invalidateQueries({ queryKey: ['chats'] });
    });
  }, [activeId, open, qc, messages.length]);

  useEffect(() => {
    if (!enabled) return;
    const pending = takePendingChatEntity();
    if (pending) {
      setEntityRef(pending);
      setOpen(true);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<OpenChatWithEntityDetail>).detail;
      if (detail?.ref?.type && detail.ref.id) {
        setEntityRef({
          type: detail.ref.type,
          id: detail.ref.id,
          label: detail.ref.label || '',
          href: detail.ref.href || '',
        });
      }
      if (detail?.open !== false) setOpen(true);
      if (detail?.peerId) {
        void api<ChatListItem>('/chats/dm', {
          method: 'POST',
          body: { peer_id: detail.peerId },
        }).then((chat) => {
          setActiveId(chat.id);
          void qc.invalidateQueries({ queryKey: ['chats'] });
        });
      }
    };
    window.addEventListener('uchet1-chat-open', onOpen);
    return () => window.removeEventListener('uchet1-chat-open', onOpen);
  }, [enabled, qc]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if ((!text && !entityRef) || !activeId || sending) return;
    setSending(true);
    try {
      await api(`/chats/${activeId}/messages`, {
        method: 'POST',
        body: {
          body: text,
          ref: entityRef || undefined,
        },
      });
      setDraft('');
      setEntityRef(null);
      void qc.invalidateQueries({ queryKey: ['chats', activeId, 'messages'] });
      void qc.invalidateQueries({ queryKey: ['chats'] });
    } finally {
      setSending(false);
    }
  }, [activeId, draft, entityRef, qc, sending]);

  const stopVoiceTracks = useCallback(() => {
    if (recTimerRef.current) {
      window.clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStreamRef.current = null;
    mediaRecRef.current = null;
    setRecording(false);
    setRecSecs(0);
  }, []);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!activeId || !files.length) return;
      setUploading(true);
      try {
        for (let i = 0; i < files.length; i++) {
          const fd = new FormData();
          fd.append('file', files[i]!);
          if (i === 0 && draft.trim()) fd.append('body', draft.trim());
          if (i === 0 && entityRef) fd.append('ref', JSON.stringify(entityRef));
          await api(`/chats/${activeId}/attachments`, { method: 'POST', body: fd });
        }
        setDraft('');
        setEntityRef(null);
        void qc.invalidateQueries({ queryKey: ['chats', activeId, 'messages'] });
        void qc.invalidateQueries({ queryKey: ['chats'] });
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Загрузка не удалась');
      } finally {
        setUploading(false);
      }
    },
    [activeId, draft, entityRef, qc]
  );

  const startVoice = useCallback(async () => {
    if (!activeId || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert('Запись голоса не поддерживается в этом браузере');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickRecorderMime();
      recMimeRef.current = mime;
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recChunksRef.current = [];
      cancelRecRef.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size) recChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const chunks = recChunksRef.current;
        const cancelled = cancelRecRef.current;
        stopVoiceTracks();
        if (cancelled || !chunks.length) return;
        const type = recMimeRef.current || chunks[0]?.type || 'audio/webm';
        const blob = new Blob(chunks, { type });
        const file = new File([blob], `voice-${Date.now()}.${voiceExt(type)}`, { type });
        void uploadFiles([file]);
      };
      mediaRecRef.current = rec;
      recStreamRef.current = stream;
      rec.start(250);
      setRecording(true);
      setRecSecs(0);
      recTimerRef.current = window.setInterval(() => {
        setRecSecs((s) => {
          if (s >= 119) {
            mediaRecRef.current?.stop();
            return s;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      alert('Нет доступа к микрофону — разрешите в браузере');
      stopVoiceTracks();
    }
  }, [activeId, recording, stopVoiceTracks, uploadFiles]);

  const finishVoice = (sendIt: boolean) => {
    cancelRecRef.current = !sendIt;
    if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
      mediaRecRef.current.stop();
    } else {
      stopVoiceTracks();
    }
  };

  useEffect(
    () => () => {
      if (recTimerRef.current) window.clearInterval(recTimerRef.current);
      mediaRecRef.current?.stop();
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  const onDragOver = (e: DragEvent) => {
    if (
      ![...e.dataTransfer.types].includes('application/x-uchet1-entity')
      && ![...e.dataTransfer.types].includes('Files')
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setDropHint(true);
  };

  const onDragLeave = (e: DragEvent) => {
    if (!rootRef.current?.contains(e.relatedTarget as Node)) setDropHint(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropHint(false);
    const ref = parseEntityDragData(e.dataTransfer);
    if (ref) {
      setEntityRef(ref);
      setOpen(true);
    }
  };

  if (!enabled) return null;

  const badge = unreadTotal > 99 ? '99+' : String(unreadTotal);

  return (
    <div
      className="chat-fab-root"
      ref={rootRef}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {open ? (
        <div
          className={`chat-pop${dropHint ? ' is-drop-target' : ''}`}
          role="dialog"
          aria-label="Чаты"
        >
          <div className="chat-pop-head">
            <strong>Чаты</strong>
            {unreadTotal > 0 ? <span className="chat-pop-unread muted">{unreadTotal} новых</span> : null}
            <div className="grow" />
            <Link className="chat-pop-link" to="/chats">
              Открыть
            </Link>
            <button type="button" className="chat-pop-x" onClick={() => setOpen(false)} aria-label="Закрыть">
              ✕
            </button>
          </div>
          <div className="chat-pop-body">
            {!activeId ? (
              <div className="chat-pop-list">
                {items.length ? (
                  items.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`chat-pop-item${c.unread ? ' has-unread' : ''}`}
                      onClick={() => setActiveId(c.id)}
                    >
                      <div className="chat-pop-item-top">
                        <span className="chat-pop-item-title">{c.title || (c.type === 'group' ? 'Группа' : 'Чат')}</span>
                        <span className="chat-pop-item-time mono">
                          {formatTime(c.last_message?.created_at || c.updated_at)}
                        </span>
                      </div>
                      <div className="chat-pop-item-bottom">
                        <span className="chat-pop-item-preview">
                          {c.last_message
                            ? `${c.last_message.sender_name ? `${c.last_message.sender_name}: ` : ''}${
                                c.last_message.body || (c.last_message.has_attachment ? 'Вложение' : '')
                              }`
                            : 'Нет сообщений'}
                        </span>
                        {c.unread > 0 ? (
                          <span className="chat-pop-item-badge">{c.unread > 99 ? '99+' : c.unread}</span>
                        ) : null}
                      </div>
                    </button>
                  ))
                ) : (
                  <p className="muted" style={{ margin: 16 }}>
                    Пока нет чатов. Откройте полный экран, чтобы написать коллеге.
                  </p>
                )}
              </div>
            ) : (
              <div className="chat-pop-thread">
                <div className="chat-pop-thread-head">
                  <button type="button" className="chat-pop-back" onClick={() => setActiveId('')}>
                    ←
                  </button>
                  <strong>{active?.title || 'Чат'}</strong>
                  <Link className="chat-pop-link" to="/chats">
                    Полный
                  </Link>
                </div>
                <div className="chat-pop-msgs">
                  {messages.map((m) => {
                    const mine = me?.id === m.sender_id;
                    return (
                      <div key={m.id} className={`chat-pop-msg${mine ? ' mine' : ''}`}>
                        {!mine ? <div className="chat-pop-msg-who">{m.sender_name}</div> : null}
                        {m.ref?.id ? (
                          m.ref.href ? (
                            <a className="chat-pop-msg-entity" href={m.ref.href}>
                              {entityTypeLabel(m.ref.type)} · {m.ref.label || m.ref.id}
                            </a>
                          ) : (
                            <span className="chat-pop-msg-entity">
                              {entityTypeLabel(m.ref.type)} · {m.ref.label || m.ref.id}
                            </span>
                          )
                        ) : null}
                        {(m.attachments || []).map((a) => (
                          <AttachmentMini key={a.id} a={a} />
                        ))}
                        {m.body ? <div className="chat-pop-msg-body">{m.body}</div> : null}
                        <div className="chat-pop-msg-time mono">
                          {formatTime(m.created_at)}
                          {mine
                            ? (() => {
                                const rr = formatReadReceipt(m);
                                return rr ? (
                                  <>
                                    {' · '}
                                    <span className={`chat-pop-msg-read ${rr.cls}`} title={rr.tip}>
                                      {rr.text}
                                    </span>
                                  </>
                                ) : null;
                              })()
                            : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <form
                  className="chat-pop-compose"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const ref = parseEntityDragData(e.dataTransfer);
                    if (ref) {
                      setEntityRef(ref);
                      return;
                    }
                    const files = Array.from(e.dataTransfer.files || []).filter((f) => f.size > 0);
                    if (files.length) void uploadFiles(files);
                  }}
                >
                  {entityRef ? (
                    <div className="chat-pop-entity">
                      <div>
                        <span className="chat-pop-entity-kind">{entityTypeLabel(entityRef.type)}</span>
                        <span>{entityRef.label || entityRef.id}</span>
                      </div>
                      <button
                        type="button"
                        className="chat-pop-entity-x"
                        onClick={() => setEntityRef(null)}
                        aria-label="Снять"
                      >
                        ×
                      </button>
                    </div>
                  ) : null}
                  {recording ? (
                    <div className="chat-pop-rec">
                      <span className="chat-pop-rec-dot" aria-hidden />
                      <span className="mono">
                        {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, '0')}
                      </span>
                      <button type="button" onClick={() => finishVoice(false)}>
                        Отмена
                      </button>
                      <button type="button" className="primary" onClick={() => finishVoice(true)}>
                        Отправить
                      </button>
                    </div>
                  ) : (
                    <div className="chat-pop-compose-row">
                      <input
                        ref={photoRef}
                        type="file"
                        accept="image/*,image/jpeg,image/png,image/webp,image/gif"
                        multiple
                        hidden
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          e.target.value = '';
                          if (files.length) void uploadFiles(files);
                        }}
                      />
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z,application/pdf,image/*"
                        multiple
                        hidden
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          e.target.value = '';
                          if (files.length) void uploadFiles(files);
                        }}
                      />
                      <button
                        type="button"
                        className="chat-pop-ico"
                        title="Фото"
                        disabled={uploading}
                        onClick={() => photoRef.current?.click()}
                      >
                        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
                          <rect x="2.5" y="4.5" width="15" height="11" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                          <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                          <circle cx="14.2" cy="7.2" r="0.9" fill="currentColor" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="chat-pop-ico"
                        title="Документ / файл"
                        disabled={uploading}
                        onClick={() => fileRef.current?.click()}
                      >
                        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
                          <path
                            d="M7 10.5V7.2A3.2 3.2 0 0110.2 4 3.2 3.2 0 0113.4 7.2v6.1a2.4 2.4 0 01-4.8 0V8"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="chat-pop-ico"
                        title="Голосовое"
                        disabled={uploading || !activeId}
                        onClick={() => void startVoice()}
                      >
                        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
                          <path
                            d="M10 2.8a2.4 2.4 0 00-2.4 2.4v4.2a2.4 2.4 0 004.8 0V5.2A2.4 2.4 0 0010 2.8z"
                            fill="currentColor"
                          />
                          <path
                            d="M5.5 9.2a4.5 4.5 0 009 0M10 13.7v3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={
                          uploading
                            ? 'Загрузка…'
                            : entityRef
                              ? 'Допишите обсуждение…'
                              : 'Сообщение, фото, документ или голос…'
                        }
                        autoComplete="off"
                        disabled={sending || uploading}
                        onPaste={(e) => {
                          const items = e.clipboardData?.items;
                          if (!items) return;
                          const files: File[] = [];
                          for (const item of Array.from(items)) {
                            if (item.kind === 'file') {
                              const f = item.getAsFile();
                              if (f) files.push(f);
                            }
                          }
                          if (files.length) {
                            e.preventDefault();
                            void uploadFiles(files);
                          }
                        }}
                      />
                      <button
                        type="submit"
                        className="primary"
                        disabled={sending || uploading || (!draft.trim() && !entityRef)}
                      >
                        ➤
                      </button>
                    </div>
                  )}
                </form>
              </div>
            )}
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className={`chat-fab${open ? ' is-open' : ''}${unreadTotal > 0 ? ' has-unread' : ''}${
          dropHint && !open ? ' is-drop-target' : ''
        }`}
        title="Чаты"
        aria-label="Чаты"
        onClick={(e) => {
          e.stopPropagation();
          const next = !open;
          setOpen(next);
          if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
            void Notification.requestPermission();
          }
          if (!next) setActiveId('');
        }}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
          <path
            d="M4 5.5h16v11H9.5L6 20v-3.5H4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M8 10h8M8 13h5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        {unreadTotal > 0 ? <span className="chat-fab-badge">{badge}</span> : null}
      </button>
    </div>
  );
}
