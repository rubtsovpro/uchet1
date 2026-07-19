import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/shared/api/client';
import { Page } from '@/shared/ui/Page';

type DocFull = {
  id: string;
  doc_type: string;
  number: string;
  doc_date: string;
  deal_id?: string;
  counterparty_name?: string;
  total?: number;
  lines?: Array<{ name: string; qty: number; price: number; amount: number }>;
};

export function SalesDocPage() {
  const { id = '' } = useParams();
  const q = useQuery({
    queryKey: ['sales-doc', id],
    queryFn: () => api<DocFull>(`/sales-docs/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });

  const d = q.data;

  return (
    <Page
      title={d ? `${d.doc_type} ${d.number}` : 'Документ'}
      toolbar={
        d ? (
          <>
            <a className="primary" href={`/api/sales-docs/${encodeURIComponent(d.id)}/pdf`} target="_blank" rel="noopener noreferrer">
              открыть
            </a>
            <a href={`/api/sales-docs/${encodeURIComponent(d.id)}/pdf?download=1`} rel="noopener noreferrer">
              скачать
            </a>
            {d.deal_id ? <Link to={`/crm/deals/${d.deal_id}`}>Сделка</Link> : null}
          </>
        ) : null
      }
    >
      {q.isLoading ? <p className="muted">Загрузка…</p> : null}
      {d ? (
        <>
          <div className="form-grid">
            <label>
              Номер
              <input className="mono" value={d.number} readOnly />
            </label>
            <label>
              Дата
              <input value={String(d.doc_date).slice(0, 10)} readOnly />
            </label>
            <label className="span-2">
              Контрагент
              <input value={d.counterparty_name || ''} readOnly />
            </label>
          </div>
          <table className="grid" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Наименование</th>
                <th>Кол-во</th>
                <th>Цена</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {(d.lines || []).map((l, i) => (
                <tr key={i}>
                  <td>{l.name}</td>
                  <td className="mono">{l.qty}</td>
                  <td className="mono">{Number(l.price).toFixed(2)}</td>
                  <td className="mono">{Number(l.amount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </Page>
  );
}
