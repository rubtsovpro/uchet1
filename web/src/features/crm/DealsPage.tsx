import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { api } from '@/shared/api/client';
import { Page } from '@/shared/ui/Page';
import {
  dealEntityRef,
  openChatWithEntity,
  setEntityDragData,
} from '@/features/chats/chatContext';

type DealRow = {
  id: string;
  name?: string;
  price?: number;
  org_company_id?: string;
  org_company_name?: string;
  status_name?: string;
  updated_at?: string;
  queued_to_1c?: number;
  buyer_name?: string;
  company_name?: string;
};

export function DealsPage() {
  const [qText, setQText] = useState('');
  const [search, setSearch] = useState('');

  const q = useQuery({
    queryKey: ['deals', search],
    queryFn: () => {
      const qs = new URLSearchParams({ limit: '100', page: '1', queued_to_1c: '1' });
      if (search) qs.set('q', search);
      return api<{ items: DealRow[]; total?: number }>(`/crm/deals?${qs}`);
    },
  });

  const items = q.data?.items || [];
  const total = q.data?.total ?? items.length;

  return (
    <Page
      title="Заказы покупателей"
      crumbs={[
        { label: 'CRM', to: '/crm' },
        { label: 'Заказы покупателей' },
      ]}
      toolbar={
        <>
          <a href="/legacy.html#/deals">Полная таблица / доска</a>
        </>
      }
    >
      <p className="muted" style={{ marginBottom: 12 }}>
        Заказы покупателей в Учёте №1. Всего: <b>{total}</b>.
        Счета и задания складу — в{' '}
        <a href="/legacy.html#/deals">классическом интерфейсе</a>. Можно перетащить строку в чат
        или нажать «В чат».
      </p>
      <div className="toolbar" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="find" style={{ display: 'flex', gap: 6 }}>
          <input
            value={qText}
            onChange={(e) => setQText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSearch(qText.trim());
            }}
            placeholder="Поиск id / название"
          />
          <button type="button" onClick={() => setSearch(qText.trim())}>
            Найти
          </button>
        </div>
      </div>
      {q.isLoading ? <p className="muted">Загрузка…</p> : null}
      {q.isError ? <p className="error">{(q.error as Error).message}</p> : null}
      {!q.isLoading && !items.length ? (
        <p className="muted">Нет заказов в Учёте №1.</p>
      ) : null}
      {items.length ? (
        <table className="grid">
          <thead>
            <tr>
              <th>ID</th>
              <th>Название</th>
              <th>Филиал</th>
              <th>Этап</th>
              <th>Сумма</th>
              <th>Учёт</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((d) => {
              const ref = dealEntityRef(d);
              return (
                <tr
                  key={d.id}
                  draggable
                  onDragStart={(e) => setEntityDragData(e.dataTransfer, ref)}
                  title="Перетащите в чат"
                  style={{ cursor: 'grab' }}
                >
                  <td className="mono">#{d.id}</td>
                  <td>{d.name || d.id}</td>
                  <td>{d.org_company_name || '—'}</td>
                  <td>{d.status_name || '—'}</td>
                  <td className="mono">
                    {d.price != null ? Number(d.price).toLocaleString('ru-RU') : '—'}
                  </td>
                  <td>{Number(d.queued_to_1c) === 1 ? 'В Учёте' : 'Не в Учёте'}</td>
                  <td>
                    <Link to={`/crm/deals/${d.id}`}>открыть</Link>
                    {' · '}
                    <a href={`/legacy.html#/deals/${encodeURIComponent(d.id)}`}>legacy</a>
                    {' · '}
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => openChatWithEntity(ref)}
                    >
                      В чат
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </Page>
  );
}
