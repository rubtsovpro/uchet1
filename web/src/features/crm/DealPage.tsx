import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { api } from '@/shared/api/client';
import type { SalesDocRow } from '@/shared/api/types';
import { Page } from '@/shared/ui/Page';

type DealDetail = {
  id: string;
  name?: string;
  price?: number;
  contact_name?: string;
  company_name?: string;
  inn?: string;
  is_legal_entity?: boolean;
  items?: Array<{ name?: string; qty?: number; price?: number }>;
  sales_docs?: SalesDocRow[];
};

export function DealPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');

  const q = useQuery({
    queryKey: ['deal', id],
    queryFn: () => api<DealDetail>(`/crm/deals/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });

  const create = useMutation({
    mutationFn: async (docType: string) => {
      const res = await api<{ doc?: { id: string; number?: string } }>('/sales-docs/from-deal', {
        method: 'POST',
        body: { deal_id: id, doc_type: docType },
      });
      return res.doc || { id: '', number: '' };
    },
    onSuccess: (doc) => {
      setMsg(`Создано: ${doc.number || doc.id}`);
      void qc.invalidateQueries({ queryKey: ['deal', id] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const pack = useMutation({
    mutationFn: () =>
      api<{ docs?: Array<{ number?: string }> }>('/sales-docs/pack-from-deal', {
        method: 'POST',
        body: { deal_id: id, types: ['invoice', 'workorder', 'upd'] },
      }),
    onSuccess: (r) => {
      const nums = (r.docs || []).map((x) => x.number).filter(Boolean).join(', ');
      setMsg(`Создано: ${nums || 'ok'}`);
      void qc.invalidateQueries({ queryKey: ['deal', id] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const d = q.data;
  const items = d?.items || [];
  const docs = d?.sales_docs || [];
  const busy = create.isPending || pack.isPending;

  return (
    <Page
      title={d?.name || 'Сделка'}
      toolbar={
        <>
          <Link to="/crm/deals">К списку</Link>
          <a href={`/legacy.html`}>Legacy</a>
        </>
      }
    >
      {q.isLoading ? <p className="muted">Загрузка…</p> : null}
      {d ? (
        <>
          <div className="form-grid">
            <label className="span-2">
              Название
              <input value={d.name || ''} readOnly />
            </label>
            <label>
              Сумма
              <input className="mono" value={d.price != null ? String(d.price) : ''} readOnly />
            </label>
            <label>
              ИНН
              <input className="mono" value={d.inn || ''} readOnly />
            </label>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
            <button className="primary" type="button" disabled={busy || !items.length} onClick={() => pack.mutate()}>
              Создать все документы
            </button>
            <button type="button" disabled={busy || !items.length} onClick={() => create.mutate('invoice')}>
              {d.is_legal_entity ? 'Счёт для юрлица' : 'Создать счёт'}
            </button>
            <button type="button" disabled={busy || !items.length} onClick={() => create.mutate('workorder')}>
              Заказ-наряд
            </button>
            <button type="button" disabled={busy || !items.length} onClick={() => create.mutate('upd')}>
              Создать УПД
            </button>
          </div>
          <p className="muted">{msg}</p>
          {!items.length ? (
            <p className="muted">Чтобы создать документы, в сделке нужны позиции из amo1c.</p>
          ) : null}

          <h3 className="form-section-title">Позиции ({items.length})</h3>
          <table className="grid">
            <thead>
              <tr>
                <th>Наименование</th>
                <th>Кол-во</th>
                <th>Цена</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>{it.name}</td>
                  <td className="mono">{it.qty}</td>
                  <td className="mono">{it.price}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="form-section-title">Документы ({docs.length})</h3>
          {docs.length ? (
            <table className="grid">
              <thead>
                <tr>
                  <th>Тип</th>
                  <th>Номер</th>
                  <th>Сумма</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {docs.map((sd) => (
                  <tr key={sd.id}>
                    <td>{sd.doc_type}</td>
                    <td className="mono">{sd.number}</td>
                    <td className="mono">{sd.total}</td>
                    <td>
                      <a href={`/api/sales-docs/${encodeURIComponent(sd.id)}/pdf`} target="_blank" rel="noopener noreferrer">
                        открыть
                      </a>
                      {' · '}
                      <a href={`/api/sales-docs/${encodeURIComponent(sd.id)}/pdf?download=1`} rel="noopener noreferrer">
                        скачать
                      </a>
                      {' · '}
                      <Link to={`/sales/doc/${sd.id}`}>карточка</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">Документов ещё нет</p>
          )}
        </>
      ) : null}
    </Page>
  );
}
