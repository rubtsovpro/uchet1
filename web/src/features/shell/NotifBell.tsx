import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';

type StaffNotif = {
  id: string;
  title?: string;
  body?: string;
  href?: string;
  deal_id?: string;
  read_at?: string;
  created_at?: string;
};

type NotifList = {
  items: StaffNotif[];
  unread: number;
};

/** Колокольчик в шапке: только системные уведомления (не чаты). */
export function NotifBell() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const lastUnread = useRef(-1);

  const q = useQuery({
    queryKey: ['staff-notifications'],
    queryFn: () => api<NotifList>('/notifications?limit=20'),
    refetchInterval: 45_000,
  });

  const unread = Number(q.data?.unread) || 0;
  const items = q.data?.items || [];
  const badge = unread > 99 ? '99+' : String(unread);

  useEffect(() => {
    if (unread > lastUnread.current && lastUnread.current >= 0 && document.hidden) {
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Учёт №1', {
            body: 'Новое уведомление по сделке',
            tag: 'wms-staff-notif',
          });
        }
      } catch {
        /* ignore */
      }
    }
    lastUnread.current = unread;
  }, [unread]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const root = wrapRef.current;
      if (!root) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (path.includes(root)) return;
      const t = e.target;
      if (t instanceof Node && root.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, [open]);

  const markRead = async (ids?: string[]) => {
    const body = ids?.length ? { ids } : {};
    const next = await api<NotifList>('/notifications/read', {
      method: 'POST',
      body,
    });
    qc.setQueryData(['staff-notifications'], next);
    return next;
  };

  const openItem = async (n: StaffNotif) => {
    try {
      await markRead([n.id]);
    } catch {
      /* ignore */
    }
    setOpen(false);
    const deal = String(n.deal_id || '').trim();
    const href = String(n.href || '').trim();
    if (deal) {
      window.location.assign(`/legacy.html#sto-pack:${encodeURIComponent(deal)}`);
      return;
    }
    if (href) {
      if (href.startsWith('/')) navigate(href);
      else window.location.assign(href);
    }
  };

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`taxi-ico taxi-notif${unread > 0 ? ' has-unread' : ''}`}
        title="Уведомления"
        aria-label="Уведомления"
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void q.refetch();
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path
            d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22Zm7-5.2V11a7 7 0 1 0-14 0v5.8L3 18.5V20h18v-1.5l-2-1.7Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 ? <span className="notif-badge">{badge}</span> : null}
      </button>
      {open ? (
        <div className="notif-panel" role="dialog" aria-label="Уведомления">
          <div className="notif-panel-head">
            <span>Уведомления{unread ? ` · ${unread}` : ''}</span>
            <button
              type="button"
              className="linkish"
              style={{ fontSize: 12 }}
              onClick={() => void markRead()}
            >
              Прочитать все
            </button>
          </div>
          {!items.length ? (
            <div className="notif-empty">Пока пусто</div>
          ) : (
            items.map((n) => {
              const isUnread = !String(n.read_at || '').trim();
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`notif-item${isUnread ? ' is-unread' : ''}`}
                  onClick={() => void openItem(n)}
                >
                  <div className="notif-item-title">{n.title || ''}</div>
                  {n.body ? <p className="notif-item-body">{n.body}</p> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
