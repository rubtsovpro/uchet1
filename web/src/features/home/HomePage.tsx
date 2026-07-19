import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/shared/api/client';
import type { Stats } from '@/shared/api/types';
import { Page } from '@/shared/ui/Page';

export function HomePage() {
  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => api<Stats>('/stats'),
  });

  const s = stats.data;

  return (
    <Page title="Начальная страница">
      {stats.isLoading ? <p className="muted">Загрузка…</p> : null}
      {stats.isError ? <p className="muted">Не удалось загрузить сводку</p> : null}
      {s ? (
        <div className="form-grid" style={{ maxWidth: 720 }}>
          <div>
            <div className="muted">Номенклатура</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{s.products ?? '—'}</div>
          </div>
          <div>
            <div className="muted">Склады</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{s.warehouses ?? '—'}</div>
          </div>
          <div>
            <div className="muted">Документы склада</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{s.docs ?? '—'}</div>
          </div>
          <div>
            <div className="muted">Фото S3 (SKU)</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{s.media?.images ?? '—'}</div>
          </div>
          <div className="span-2">
            <div className="muted">Диск свободно</div>
            <div style={{ fontWeight: 600 }}>
              {s.disk?.free_human ?? '—'}
              {s.disk?.free_pct != null ? ` (${s.disk.free_pct}%)` : ''}
            </div>
          </div>
        </div>
      ) : null}

      <h3 className="form-section-title" style={{ marginTop: 24 }}>
        Быстрые действия
      </h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Link className="primary" to="/crm/deals" style={{ padding: '6px 12px' }}>
          Сделки
        </Link>
        <Link to="/sales/invoices" style={{ padding: '6px 12px' }}>
          Счета
        </Link>
        <Link to="/sales/upd" style={{ padding: '6px 12px' }}>
          УПД
        </Link>
        <Link to="/company/org" style={{ padding: '6px 12px' }}>
          Реквизиты и нумерация
        </Link>
        <a href="/products" style={{ padding: '6px 12px' }}>
          Номенклатура
        </a>
        <a href="/purchases" style={{ padding: '6px 12px' }}>
          Закупки
        </a>
      </div>
    </Page>
  );
}
