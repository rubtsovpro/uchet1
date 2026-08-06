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
        <div className="shell-kpi-grid">
          <div className="shell-kpi">
            <div className="shell-kpi-label">Номенклатура</div>
            <div className="shell-kpi-value">{s.products ?? '—'}</div>
          </div>
          <div className="shell-kpi">
            <div className="shell-kpi-label">Склады</div>
            <div className="shell-kpi-value">{s.warehouses ?? '—'}</div>
          </div>
          <div className="shell-kpi">
            <div className="shell-kpi-label">Документы склада</div>
            <div className="shell-kpi-value">{s.docs ?? '—'}</div>
          </div>
          <div className="shell-kpi">
            <div className="shell-kpi-label">Фото S3 (SKU)</div>
            <div className="shell-kpi-value">{s.media?.images ?? '—'}</div>
          </div>
          <div className="shell-kpi" style={{ gridColumn: 'span 2' }}>
            <div className="shell-kpi-label">Диск свободно</div>
            <div className="shell-kpi-value" style={{ fontSize: 18 }}>
              {s.disk?.free_human ?? '—'}
              {s.disk?.free_pct != null ? (
                <span className="muted" style={{ fontSize: 14, fontWeight: 600, marginLeft: 8 }}>
                  ({s.disk.free_pct}%)
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <h3 className="form-section-title">Быстрые действия</h3>
      <div className="shell-quick">
        <Link className="primary" to="/crm/deals">
          Заказы
        </Link>
        <Link to="/sales/invoices">Счета</Link>
        <Link to="/sales/upd">УПД</Link>
        <Link to="/chats">Чаты</Link>
        <Link to="/organizations">Организации / юрлица</Link>
        <a href="/products">Номенклатура</a>
        <a href="/purchases">Закупки</a>
        <a href="/help">Рабочие экраны</a>
      </div>
    </Page>
  );
}
