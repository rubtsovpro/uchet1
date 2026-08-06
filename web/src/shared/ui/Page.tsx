import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { OrderLinkTab } from '@/features/crm/orderLinkTabs';

export type PageCrumb = {
  label: string;
  /** Если есть — кликабельный сегмент. Последний без `to` = текущая страница. */
  to?: string;
};

type PageProps = {
  title: string;
  /** Путь над заголовком. Если не передан — крошка только из title. */
  crumbs?: PageCrumb[];
  /** Вкладки цепочки сущностей (Заказ / Счета / УПД…). */
  pageTabs?: OrderLinkTab[];
  onPageTabCreate?: (action: string) => void | Promise<void>;
  toolbar?: ReactNode;
  children: ReactNode;
};

export function Page({
  title,
  crumbs,
  pageTabs,
  onPageTabCreate,
  toolbar,
  children,
}: PageProps) {
  const trail: PageCrumb[] =
    Array.isArray(crumbs) && crumbs.length
      ? crumbs.some((c) => !c.to)
        ? crumbs
        : [...crumbs, { label: title }]
      : [{ label: title }];

  return (
    <div className="app">
      <div className="form-chrome">
        <div className="form-chrome-bar">
          <div className="form-title-stack">
            <nav className="form-crumbs form-crumbs--bar" aria-label="Путь">
              {trail.map((c, i) => {
                const isLast = i === trail.length - 1;
                const current = isLast || !c.to;
                return (
                  <span key={`${c.label}-${i}`} className="crumb-wrap">
                    {i > 0 ? (
                      <span className="crumb-sep" aria-hidden="true">
                        /
                      </span>
                    ) : null}
                    {current || !c.to ? (
                      <span
                        className={isLast ? 'crumb-current crumb-title' : 'crumb-current'}
                        title={c.label}
                      >
                        {c.label}
                      </span>
                    ) : (
                      <Link className="crumb-link" to={c.to} title={c.label}>
                        {c.label}
                      </Link>
                    )}
                  </span>
                );
              })}
            </nav>
            <h2 className="form-chrome-title form-title-sr">{title}</h2>
          </div>
          <div className="form-chrome-actions">{toolbar}</div>
        </div>
        {pageTabs && pageTabs.length ? (
          <div className="form-pagetabs" role="tablist" aria-label="Документы заказа">
            {pageTabs.map((t) => {
              const tip = t.tip || t.label + (t.count != null ? ` · ${t.count}` : '');
              const cls = [
                'form-pagetab',
                t.active ? 'active' : '',
                t.create ? 'is-create' : '',
              ]
                .filter(Boolean)
                .join(' ');
              const countHtml =
                t.count != null && t.count > 0 ? (
                  <sup className="pagetab-count">{t.count}</sup>
                ) : null;
              if (t.create) {
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={cls}
                    title={tip}
                    data-create="1"
                    onClick={() => {
                      const action = t.id.startsWith('create:') ? t.id.slice('create:'.length) : '';
                      if (action && onPageTabCreate) void onPageTabCreate(action);
                    }}
                  >
                    <span className="pagetab-label">{t.label}</span>
                  </button>
                );
              }
              if (t.to) {
                return (
                  <Link
                    key={t.id}
                    to={t.to}
                    className={cls}
                    title={tip}
                    role="tab"
                    aria-selected={!!t.active}
                  >
                    <span className="pagetab-label">{t.label}</span>
                    {countHtml}
                  </Link>
                );
              }
              if (t.href) {
                return (
                  <a
                    key={t.id}
                    href={t.href}
                    className={cls}
                    title={tip}
                    role="tab"
                    aria-selected={!!t.active}
                  >
                    <span className="pagetab-label">{t.label}</span>
                    {countHtml}
                  </a>
                );
              }
              return (
                <button key={t.id} type="button" className={cls} title={tip} disabled>
                  <span className="pagetab-label">{t.label}</span>
                  {countHtml}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="form-chrome-body">{children}</div>
      </div>
    </div>
  );
}
