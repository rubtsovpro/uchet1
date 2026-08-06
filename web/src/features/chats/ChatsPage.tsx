import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import type { StaffMe } from '@/shared/api/types';
import {
  entityTypeLabel,
  parseEntityDragData,
  takePendingChatEntity,
  type ChatEntityRef,
  type OpenChatWithEntityDetail,
} from './chatContext';

type ChatAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: string;
  url: string;
};

type ChatReadReceipt = {
  actor_id: string;
  name: string;
  read_at: string;
};

type ChatMessage = {
  id: string;
  chat_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  reply_to_id: string;
  forwarded_from_id: string;
  created_at: string;
  deleted: boolean;
  attachments: ChatAttachment[];
  ref?: ChatEntityRef | null;
  reads?: ChatReadReceipt[];
  readers_total?: number;
  read_status?: 'unread' | 'partial' | 'read';
};

type ChatListItem = {
  id: string;
  type: 'dm' | 'group';
  title: string;
  unread: number;
  peer_online?: boolean;
  updated_at: string;
  last_message: {
    id: string;
    body: string;
    sender_name: string;
    created_at: string;
    has_attachment: boolean;
  } | null;
};

type DirectoryPerson = {
  id: string;
  name: string;
  role: string;
  department: string;
  online: boolean;
};

function formatTime(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return iso.slice(11, 16) || iso;
    const now = new Date();
    const sameDay =
      d.getDate() === now.getDate()
      && d.getMonth() === now.getMonth()
      && d.getFullYear() === now.getFullYear();
    if (sameDay) {
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
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

function fileSize(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

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

function EntityCard({ refItem }: { refItem: ChatEntityRef }) {
  const inner = (
    <>
      <span className="chats-entity-kind">{entityTypeLabel(refItem.type)}</span>
      <span className="chats-entity-label">{refItem.label || refItem.id}</span>
    </>
  );
  if (refItem.href) {
    return (
      <a
        className="chats-entity-card"
        href={refItem.href}
        onClick={(e) => e.stopPropagation()}
      >
        {inner}
      </a>
    );
  }
  return <div className="chats-entity-card chats-entity-card--static">{inner}</div>;
}

function AttachmentView({ a }: { a: ChatAttachment }) {
  if (a.kind === 'audio' || (a.mime || '').startsWith('audio/')) {
    return (
      <div className="chats-voice">
        <audio controls preload="metadata" src={a.url}>
          <a href={a.url} target="_blank" rel="noreferrer">
            Скачать голосовое
          </a>
        </audio>
      </div>
    );
  }
  if (a.kind === 'image' || (a.mime || '').startsWith('image/')) {
    return (
      <a className="chats-att-img" href={a.url} target="_blank" rel="noreferrer" title={a.name}>
        <img src={a.url} alt={a.name} loading="lazy" />
      </a>
    );
  }
  const label =
    a.kind === 'document' ? 'Документ' : 'Файл';
  return (
    <a className="chats-att" href={a.url} target="_blank" rel="noreferrer">
      <span className="chats-att-ico" aria-hidden>
        {a.kind === 'document' ? 'PDF' : '▤'}
      </span>
      <span>
        <strong>{a.name}</strong>
        <small>
          {label} · {fileSize(a.size)}
        </small>
      </span>
    </a>
  );
}

function Avatar({
  name,
  online,
  size = 'md',
  group,
}: {
  name: string;
  online?: boolean;
  size?: 'sm' | 'md' | 'lg';
  group?: boolean;
}) {
  return (
    <span className={`chats-avatar chats-avatar--${size}${group ? ' chats-avatar--group' : ''}`}>
      <span className="chats-avatar-letters">{initials(name)}</span>
      {online != null ? (
        <span className={`chats-avatar-status${online ? ' on' : ''}`} aria-hidden />
      ) : null}
    </span>
  );
}

export function ChatsPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<StaffMe>('/me') });
  const myId = me.data?.id || '';

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [listFilter, setListFilter] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [entityRef, setEntityRef] = useState<ChatEntityRef | null>(null);
  const [entityPick, setEntityPick] = useState(false);
  const [entityQ, setEntityQ] = useState('');
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);
  const [forwardPick, setForwardPick] = useState(false);
  const [composerError, setComposerError] = useState('');
  const [newMode, setNewMode] = useState<'dm' | 'group' | null>(null);
  const [dirQ, setDirQ] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [groupPick, setGroupPick] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const entitySearchRef = useRef<HTMLInputElement>(null);
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recMimeRef = useRef('');
  const cancelRecRef = useRef(false);
  const uploadVoiceRef = useRef<(file: File) => void>(() => undefined);

  const chatsQ = useQuery({
    queryKey: ['chats'],
    queryFn: () => api<{ items: ChatListItem[]; unread_total: number }>('/chats'),
    refetchInterval: 3000,
  });

  const messagesQ = useQuery({
    queryKey: ['chat-messages', activeId],
    enabled: Boolean(activeId),
    queryFn: () =>
      api<{ items: ChatMessage[] }>(`/chats/${activeId}/messages?limit=80`),
    refetchInterval: activeId ? 2500 : false,
  });

  const dirQry = useQuery({
    queryKey: ['chat-directory', dirQ],
    enabled: newMode !== null,
    queryFn: () =>
      api<{ items: DirectoryPerson[] }>(
        `/chats/directory?q=${encodeURIComponent(dirQ)}`
      ),
  });

  const entitySearchQry = useQuery({
    queryKey: ['chat-entity-search', entityQ],
    enabled: entityPick && entityQ.trim().length >= 1,
    queryFn: () =>
      api<{ items: ChatEntityRef[] }>(
        `/chats/entity-search?q=${encodeURIComponent(entityQ.trim())}&limit=20`
      ),
  });

  useEffect(() => {
    if (!entityPick) return;
    entitySearchRef.current?.focus();
  }, [entityPick]);

  useEffect(() => {
    const pending = takePendingChatEntity();
    if (pending) setEntityRef(pending);
  }, []);

  const filteredChats = useMemo(() => {
    const items = chatsQ.data?.items || [];
    const q = listFilter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => {
      const hay = [c.title, c.last_message?.body, c.last_message?.sender_name]
        .map((x) => String(x || '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
  }, [chatsQ.data, listFilter]);

  const activeChat = useMemo(
    () => chatsQ.data?.items.find((c) => c.id === activeId) || null,
    [chatsQ.data, activeId]
  );

  const messages = messagesQ.data?.items || [];
  const unreadTotal = chatsQ.data?.unread_total || 0;

  useEffect(() => {
    if (!activeId) return;
    void api(`/chats/${activeId}/read`, { method: 'POST', body: {} }).then(() => {
      void qc.invalidateQueries({ queryKey: ['chats'] });
    });
  }, [activeId, messages.length, qc]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, activeId]);

  useEffect(() => {
    return () => {
      if (recTimerRef.current) window.clearInterval(recTimerRef.current);
      mediaRecRef.current?.stop();
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopVoiceTracks = () => {
    if (recTimerRef.current) {
      window.clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStreamRef.current = null;
    mediaRecRef.current = null;
    setRecording(false);
    setRecSecs(0);
  };

  const startVoice = async () => {
    if (!activeId || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setComposerError('Запись голоса не поддерживается в этом браузере');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickRecorderMime();
      recMimeRef.current = mime;
      const rec = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
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
        uploadVoiceRef.current(file);
      };
      mediaRecRef.current = rec;
      recStreamRef.current = stream;
      rec.start(250);
      setRecording(true);
      setRecSecs(0);
      setComposerError('');
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
      setComposerError('Нет доступа к микрофону — разрешите в браузере');
      stopVoiceTracks();
    }
  };

  const finishVoice = (send: boolean) => {
    cancelRecRef.current = !send;
    if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
      mediaRecRef.current.stop();
    } else {
      stopVoiceTracks();
    }
  };

  const sendText = useMutation({
    mutationFn: async () => {
      if (!activeId) throw new Error('Нет чата');
      const text = draft.trim();
      if (!text && !entityRef) throw new Error('Пустое сообщение');
      return api<ChatMessage>(`/chats/${activeId}/messages`, {
        method: 'POST',
        body: {
          body: text,
          reply_to: replyTo?.id,
          ref: entityRef || undefined,
        },
      });
    },
    onSuccess: () => {
      setDraft('');
      setReplyTo(null);
      setEntityRef(null);
      setComposerError('');
      void qc.invalidateQueries({ queryKey: ['chat-messages', activeId] });
      void qc.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: (e) => {
      setComposerError(e instanceof ApiError ? e.message : 'Не отправлено');
    },
  });

  const uploadFile = useMutation({
    mutationFn: async (files: File | File[]) => {
      if (!activeId) throw new Error('Нет чата');
      const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
      if (!list.length) throw new Error('Нет файла');
      let last: ChatMessage | null = null;
      for (let i = 0; i < list.length; i++) {
        const file = list[i]!;
        const fd = new FormData();
        fd.append('file', file);
        if (i === 0 && draft.trim()) fd.append('body', draft.trim());
        if (i === 0 && replyTo?.id) fd.append('reply_to', replyTo.id);
        if (i === 0 && entityRef) fd.append('ref', JSON.stringify(entityRef));
        last = await api<ChatMessage>(`/chats/${activeId}/attachments`, {
          method: 'POST',
          body: fd,
        });
      }
      return last!;
    },
    onSuccess: () => {
      setDraft('');
      setReplyTo(null);
      setEntityRef(null);
      setComposerError('');
      void qc.invalidateQueries({ queryKey: ['chat-messages', activeId] });
      void qc.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: (e) => {
      setComposerError(e instanceof ApiError ? e.message : 'Загрузка не удалась');
    },
  });
  uploadVoiceRef.current = (file) => uploadFile.mutate(file);

  const takeFiles = (list: FileList | File[] | null | undefined) => {
    if (!list) return;
    const files = Array.from(list).filter((f) => f && f.size > 0);
    if (files.length) uploadFile.mutate(files);
  };

  const applyEntityDrop = (dt: DataTransfer) => {
    const ref = parseEntityDragData(dt);
    if (ref) {
      setEntityRef(ref);
      return true;
    }
    return false;
  };

  const openDm = useCallback(
    async (peerId: string) => {
      const chat = await api<ChatListItem & { id: string }>('/chats/dm', {
        method: 'POST',
        body: { peer_id: peerId },
      });
      setNewMode(null);
      setDirQ('');
      setActiveId(chat.id);
      setMobileShowThread(true);
      void qc.invalidateQueries({ queryKey: ['chats'] });
    },
    [qc]
  );

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<OpenChatWithEntityDetail>).detail;
      if (detail?.ref?.type && detail.ref.id) {
        setEntityRef({
          type: detail.ref.type,
          id: detail.ref.id,
          label: detail.ref.label || '',
          href: detail.ref.href || '',
        });
        setMobileShowThread(true);
      }
      if (detail?.peerId) void openDm(detail.peerId);
    };
    window.addEventListener('uchet1-chat-open', onOpen);
    return () => window.removeEventListener('uchet1-chat-open', onOpen);
  }, [openDm]);

  const createGroup = useCallback(async () => {
    if (!groupTitle.trim() || !groupPick.length) {
      setComposerError('Название и хотя бы один участник');
      return;
    }
    const chat = await api<{ id: string }>('/chats/group', {
      method: 'POST',
      body: { title: groupTitle.trim(), member_ids: groupPick },
    });
    setNewMode(null);
    setGroupTitle('');
    setGroupPick([]);
    setDirQ('');
    setActiveId(chat.id);
    setMobileShowThread(true);
    void qc.invalidateQueries({ queryKey: ['chats'] });
  }, [groupPick, groupTitle, qc]);

  const doForward = useCallback(
    async (targetChatId: string) => {
      if (!forwardMsg) return;
      try {
        await api<ChatMessage>(`/chats/${targetChatId}/messages`, {
          method: 'POST',
          body: { forward_from: forwardMsg.id },
        });
        setForwardMsg(null);
        setForwardPick(false);
        setActiveId(targetChatId);
        setMobileShowThread(true);
        void qc.invalidateQueries({ queryKey: ['chats'] });
        void qc.invalidateQueries({ queryKey: ['chat-messages', targetChatId] });
      } catch (e) {
        setComposerError(e instanceof ApiError ? e.message : 'Пересылка не удалась');
      }
    },
    [forwardMsg, qc]
  );

  const selectChat = (id: string) => {
    setActiveId(id);
    setReplyTo(null);
    setForwardMsg(null);
    setMobileShowThread(true);
  };

  const pickEntity = (item: ChatEntityRef) => {
    setEntityRef(item);
    setEntityPick(false);
    setEntityQ('');
  };

  return (
    <div className="chats-shell">
      <div className="chats-app">
        <aside className={`chats-list${mobileShowThread ? ' chats-list--hidden-mobile' : ''}`}>
          <div className="chats-list-head">
            <div className="chats-list-title-row">
              <h2>Чаты</h2>
              {unreadTotal > 0 ? (
                <span className="chats-unread chats-unread--head">{unreadTotal}</span>
              ) : null}
            </div>
            <div className="chats-list-actions">
              <button
                type="button"
                className={`chats-chip${newMode === 'dm' ? ' active' : ''}`}
                onClick={() => setNewMode(newMode === 'dm' ? null : 'dm')}
              >
                Личный
              </button>
              <button
                type="button"
                className={`chats-chip${newMode === 'group' ? ' active' : ''}`}
                onClick={() => setNewMode(newMode === 'group' ? null : 'group')}
              >
                Группа
              </button>
            </div>
            <label className="chats-search">
              <span className="chats-search-ico" aria-hidden>
                <svg viewBox="0 0 20 20" width="16" height="16">
                  <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M12.5 12.5L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <input
                type="search"
                placeholder="Поиск по чатам"
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                autoComplete="off"
              />
            </label>
          </div>

          {newMode ? (
            <div className="chats-new">
              <div className="chats-new-head">
                <strong>{newMode === 'dm' ? 'Новый личный чат' : 'Новая группа'}</strong>
                <button type="button" className="chats-icon-btn" onClick={() => setNewMode(null)} aria-label="Закрыть">
                  ×
                </button>
              </div>
              {newMode === 'group' ? (
                <input
                  className="chats-field"
                  placeholder="Название группы"
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                />
              ) : null}
              <input
                className="chats-field"
                placeholder="Найти сотрудника"
                value={dirQ}
                onChange={(e) => setDirQ(e.target.value)}
              />
              <ul className="chats-dir">
                {dirQry.isLoading ? (
                  <li className="chats-list-empty">Загрузка сотрудников…</li>
                ) : null}
                {!dirQry.isLoading && !(dirQry.data?.items || []).length ? (
                  <li className="chats-list-empty">
                    Нет сотрудников в справочнике. Добавьте персонал в разделе «Персонал».
                  </li>
                ) : null}
                {(dirQry.data?.items || []).map((p) => {
                  const picked = groupPick.includes(p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={`chats-dir-item${picked ? ' picked' : ''}`}
                        onClick={() => {
                          if (newMode === 'dm') void openDm(p.id);
                          else {
                            setGroupPick((prev) =>
                              picked ? prev.filter((x) => x !== p.id) : [...prev, p.id]
                            );
                          }
                        }}
                      >
                        <Avatar name={p.name} online={p.online} size="sm" />
                        <span className="chats-dir-meta">
                          <span className="chats-dir-name">{p.name}</span>
                          <span className="chats-dir-sub">{p.department || p.role}</span>
                        </span>
                        {picked ? <span className="chats-check">✓</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {newMode === 'group' ? (
                <button type="button" className="chats-btn-primary" onClick={() => void createGroup()}>
                  Создать группу · {groupPick.length}
                </button>
              ) : null}
            </div>
          ) : null}

          <ul className="chats-items">
            {filteredChats.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`chats-item${c.id === activeId ? ' active' : ''}`}
                  onClick={() => selectChat(c.id)}
                >
                  <Avatar
                    name={c.title}
                    online={c.type === 'dm' ? c.peer_online : undefined}
                    group={c.type === 'group'}
                  />
                  <span className="chats-item-body">
                    <span className="chats-item-top">
                      <span className="chats-item-title">
                        {c.title}
                        {c.type === 'group' ? <span className="chats-badge-type">группа</span> : null}
                      </span>
                      <span className="chats-item-time">
                        {c.last_message ? formatTime(c.last_message.created_at) : ''}
                      </span>
                    </span>
                    <span className="chats-item-bottom">
                      <span className="chats-item-preview">
                        {c.last_message?.body
                          || (c.last_message?.has_attachment ? 'Вложение' : 'Нет сообщений')}
                      </span>
                      {c.unread > 0 ? <span className="chats-unread">{c.unread}</span> : null}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!filteredChats.length && !chatsQ.isLoading ? (
              <li className="chats-list-empty">
                {listFilter
                  ? 'Ничего не найдено'
                  : 'Пока нет чатов — начните личный или создайте группу'}
              </li>
            ) : null}
          </ul>
        </aside>

        <section className={`chats-thread${mobileShowThread ? ' chats-thread--show-mobile' : ''}`}>
          {activeChat ? (
            <>
              <header className="chats-thread-head">
                <button
                  type="button"
                  className="chats-back chats-icon-btn"
                  onClick={() => setMobileShowThread(false)}
                  aria-label="К списку"
                >
                  ←
                </button>
                <Avatar
                  name={activeChat.title}
                  online={activeChat.type === 'dm' ? activeChat.peer_online : undefined}
                  group={activeChat.type === 'group'}
                  size="lg"
                />
                <div className="chats-thread-who">
                  <div className="chats-thread-title">{activeChat.title}</div>
                  <div className="chats-thread-sub">
                    {activeChat.type === 'group' ? 'Группа' : 'Личный чат'}
                    {activeChat.peer_online ? (
                      <>
                        {' · '}
                        <span className="chats-online-label">онлайн</span>
                      </>
                    ) : null}
                  </div>
                </div>
              </header>

              <div className="chats-messages">
                {messages.map((m) => {
                  const mine = m.sender_id === myId;
                  return (
                    <div
                      key={m.id}
                      className={`chats-msg${mine ? ' mine' : ''}${m.deleted ? ' deleted' : ''}`}
                    >
                      {!mine ? <Avatar name={m.sender_name} size="sm" /> : null}
                      <div className="chats-bubble">
                        {!mine ? <div className="chats-bubble-name">{m.sender_name}</div> : null}
                        {m.forwarded_from_id ? (
                          <div className="chats-fwd">Переслано</div>
                        ) : null}
                        {m.reply_to_id ? (
                          <div className="chats-reply-ref">Ответ на сообщение</div>
                        ) : null}
                        {m.deleted ? (
                          <div className="chats-bubble-text muted">Сообщение удалено</div>
                        ) : (
                          <>
                            {m.ref?.id ? <EntityCard refItem={m.ref} /> : null}
                            {m.body ? <div className="chats-bubble-text">{m.body}</div> : null}
                            {m.attachments?.map((a) => (
                              <AttachmentView key={a.id} a={a} />
                            ))}
                          </>
                        )}
                        <div className="chats-bubble-meta">
                          <span>
                            {formatTime(m.created_at)}
                            {mine
                              ? (() => {
                                  const rr = formatReadReceipt(m);
                                  return rr ? (
                                    <>
                                      {' · '}
                                      <span className={`chats-msg-read ${rr.cls}`} title={rr.tip}>
                                        {rr.text}
                                      </span>
                                    </>
                                  ) : null;
                                })()
                              : null}
                          </span>
                          {!m.deleted ? (
                            <span className="chats-bubble-actions">
                              <button type="button" onClick={() => setReplyTo(m)}>
                                Ответить
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setForwardMsg(m);
                                  setForwardPick(true);
                                }}
                              >
                                Переслать
                              </button>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={threadEndRef} />
              </div>

              <footer className="chats-composer">
                {replyTo ? (
                  <div className="chats-composer-banner">
                    <div>
                      <span className="chats-composer-banner-label">Ответ</span>
                      <span>{replyTo.body?.slice(0, 80) || 'вложение'}</span>
                    </div>
                    <button type="button" className="chats-icon-btn" onClick={() => setReplyTo(null)}>
                      ×
                    </button>
                  </div>
                ) : null}
                {entityRef ? (
                  <div className="chats-composer-banner chats-composer-banner--entity">
                    <div>
                      <span className="chats-composer-banner-label">
                        {entityTypeLabel(entityRef.type)}
                      </span>
                      {entityRef.href ? (
                        <a href={entityRef.href}>{entityRef.label || entityRef.id}</a>
                      ) : (
                        <span>{entityRef.label || entityRef.id}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="chats-icon-btn"
                      onClick={() => setEntityRef(null)}
                      aria-label="Снять привязку"
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                {composerError ? <div className="chats-error">{composerError}</div> : null}
                {recording ? (
                  <div className="chats-rec-bar">
                    <span className="chats-rec-dot" aria-hidden />
                    <span className="chats-rec-label">Запись {Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, '0')}</span>
                    <button
                      type="button"
                      className="chats-chip"
                      onClick={() => finishVoice(false)}
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      className="chats-btn-primary"
                      onClick={() => finishVoice(true)}
                    >
                      Отправить
                    </button>
                  </div>
                ) : (
                <div
                  className={`chats-composer-row${uploadFile.isPending ? ' is-uploading' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (applyEntityDrop(e.dataTransfer)) return;
                    takeFiles(e.dataTransfer.files);
                  }}
                >
                  <input
                    ref={photoRef}
                    type="file"
                    accept="image/*,image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    hidden
                    onChange={(e) => {
                      takeFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    multiple
                    hidden
                    onChange={(e) => {
                      takeFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="chats-icon-btn chats-photo"
                    title="Фото"
                    disabled={uploadFile.isPending}
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
                    className="chats-icon-btn chats-attach"
                    title="Документ"
                    disabled={uploadFile.isPending}
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
                    className={`chats-icon-btn chats-entity-btn${entityRef ? ' active' : ''}`}
                    title="Документ учёта / сделка"
                    disabled={uploadFile.isPending}
                    onClick={() => {
                      setEntityPick((v) => !v);
                      setEntityQ('');
                    }}
                  >
                    #
                  </button>
                  <button
                    type="button"
                    className="chats-icon-btn chats-mic"
                    title="Голосовое"
                    disabled={uploadFile.isPending || !activeId}
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
                  <textarea
                    className="chats-textarea"
                    rows={1}
                    placeholder={uploadFile.isPending ? 'Загрузка…' : 'Сообщение, фото, документ или голос…'}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
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
                        takeFiles(files);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (!sendText.isPending) sendText.mutate();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="chats-send"
                    disabled={
                      sendText.isPending
                      || (!draft.trim() && !entityRef)
                      || uploadFile.isPending
                    }
                    onClick={() => sendText.mutate()}
                    aria-label="Отправить"
                  >
                    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
                      <path d="M3.5 10.2L16 4.5l-3.2 11.2-3.1-4.2-6.2-1.3z" fill="currentColor" />
                    </svg>
                  </button>
                </div>
                )}
                {entityPick ? (
                  <div className="chats-entity-pop">
                    <div className="chats-new-head">
                      <strong>Документ учёта</strong>
                      <button
                        type="button"
                        className="chats-icon-btn"
                        onClick={() => {
                          setEntityPick(false);
                          setEntityQ('');
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <input
                      ref={entitySearchRef}
                      className="chats-field"
                      placeholder="Сделка, счёт, УПД, задание…"
                      value={entityQ}
                      onChange={(e) => setEntityQ(e.target.value)}
                      autoComplete="off"
                    />
                    <ul className="chats-dir">
                      {entityQ.trim().length < 1 ? (
                        <li className="chats-list-empty">Введите номер или название</li>
                      ) : null}
                      {entitySearchQry.isFetching ? (
                        <li className="chats-list-empty">Поиск…</li>
                      ) : null}
                      {!entitySearchQry.isFetching
                        && entityQ.trim().length >= 1
                        && !(entitySearchQry.data?.items || []).length ? (
                        <li className="chats-list-empty">Ничего не найдено</li>
                      ) : null}
                      {(entitySearchQry.data?.items || []).map((item) => (
                        <li key={`${item.type}:${item.id}`}>
                          <button
                            type="button"
                            className="chats-dir-item"
                            onClick={() => pickEntity(item)}
                          >
                            <span className="chats-dir-meta">
                              <span className="chats-dir-name">{item.label}</span>
                              <span className="chats-dir-sub">{entityTypeLabel(item.type)}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </footer>
            </>
          ) : (
            <div className="chats-empty">
              <div className="chats-empty-card">
                <div className="chats-empty-ico" aria-hidden>
                  <svg viewBox="0 0 48 48" width="40" height="40">
                    <rect x="6" y="10" width="36" height="26" rx="8" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="M14 28h12M14 21h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <h3>Переписка сотрудников</h3>
                <p>Текст, голосовые, фото и документы. Файлы хранятся в S3.</p>
                <div className="chats-empty-actions">
                  <button type="button" className="chats-btn-primary" onClick={() => setNewMode('dm')}>
                    Новый личный
                  </button>
                  <button type="button" className="chats-chip" onClick={() => setNewMode('group')}>
                    Новая группа
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {forwardPick && forwardMsg ? (
        <div
          className="chats-modal-backdrop"
          role="presentation"
          onClick={() => {
            setForwardPick(false);
            setForwardMsg(null);
          }}
        >
          <div
            className="chats-modal"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="chats-new-head">
              <strong>Переслать в чат</strong>
              <button
                type="button"
                className="chats-icon-btn"
                onClick={() => {
                  setForwardPick(false);
                  setForwardMsg(null);
                }}
              >
                ×
              </button>
            </div>
            <p className="chats-modal-preview">
              {(forwardMsg.body || 'вложение').slice(0, 120)}
            </p>
            <ul className="chats-dir">
              {(chatsQ.data?.items || []).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="chats-dir-item"
                    onClick={() => void doForward(c.id)}
                  >
                    <Avatar name={c.title} group={c.type === 'group'} size="sm" />
                    <span className="chats-dir-meta">
                      <span className="chats-dir-name">{c.title}</span>
                      <span className="chats-dir-sub">
                        {c.type === 'group' ? 'группа' : 'личный'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
