import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/shared/api/client';
import type { SalesDocRow, SalesDocType } from '@/shared/api/types';
import { Page } from '@/shared/ui/Page';

const LABELS: Record<SalesDocType, string> = {
  invoice: 'Счета на оплату',
  upd: 'УПД',
  sf: 'Счета-фактуры',
  workorder: 'Заказ-наряды',
};

type Props = { type: SalesDocType };

export function SalesDocsPage({ type }: Props) {
  const q = useQuery({
    queryKey: ['sales-docs', type],
    queryFn: () => api<{ items: SalesDocRow[] }>(`/sales-docs?type=${type}`),
  });

  const items = q.data?.items || [];

  return (
    <Page
      title={LABELS[type]}
      toolbar={
        <>
          <Link to="/company/org">Реквизиты и нумерация</Link>
          <Link to="/crm/deals">Создать из сделки</Link>
        </>
      }
    >
      {q.isLoading ? <p className="muted">Загрузка…</p> : null}
      {!q.isLoading && !items.length ? <p className="muted">Документов пока нет</p> : null}
      {items.length ? (
        <table className="grid">
          <thead>
            <tr>
              <th>Номер</th>
              <th>Дата</th>
              <th>Контрагент</th>
              <th>Сумма</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td className="mono">{d.number}</td>
                <td>{String(d.doc_date || '').slice(0, 10)}</td>
                <td>{d.counterparty_name || '—'}</td>
                <td className="mono">{d.total != null ? Number(d.total).toFixed(2) : '—'}</td>
                <td>
                  <a href={`/api/sales-docs/${encodeURIComponent(d.id)}/pdf`} target="_blank" rel="noopener noreferrer">
                    открыть
                  </a>
                  {' · '}
                  <a href={`/api/sales-docs/${encodeURIComponent(d.id)}/pdf?download=1`} rel="noopener noreferrer">
                    скачать
                  </a>
                  {' · '}
                  <Link to={`/sales/doc/${d.id}`}>карточка</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Page>
  );
}
