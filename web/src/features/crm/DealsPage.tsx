import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/shared/api/client';
import { Page } from '@/shared/ui/Page';

type DealRow = {
  id: string;
  name?: string;
  price?: number;
  pipeline_name?: string;
  status_name?: string;
  updated_at?: string;
};

export function DealsPage() {
  const q = useQuery({
    queryKey: ['deals'],
    queryFn: () => api<{ items: DealRow[]; total?: number }>('/crm/deals?limit=100'),
  });

  const items = q.data?.items || [];

  return (
    <Page title="Сделки Amo" toolbar={<a href="/legacy.html">Классический UI</a>}>
      {q.isLoading ? <p className="muted">Загрузка…</p> : null}
      {!q.isLoading && !items.length ? <p className="muted">Сделок нет — синхронизируйте из Amo</p> : null}
      {items.length ? (
        <table className="grid">
          <thead>
            <tr>
              <th>Название</th>
              <th>Воронка</th>
              <th>Статус</th>
              <th>Сумма</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>{d.name || d.id}</td>
                <td>{d.pipeline_name || '—'}</td>
                <td>{d.status_name || '—'}</td>
                <td className="mono">{d.price != null ? Number(d.price).toFixed(0) : '—'}</td>
                <td>
                  <Link to={`/crm/deals/${d.id}`}>открыть</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Page>
  );
}
