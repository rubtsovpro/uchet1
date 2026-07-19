import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { StaffMe } from '@/shared/api/types';
import { NAV_SECTIONS, SECTION_LINKS } from './nav';
import { NavIcon } from './NavIcon';
import { useSideCollapsed } from './useSideCollapsed';

export function ShellLayout() {
  const { collapsed, toggle } = useSideCollapsed();
  const location = useLocation();
  const navigate = useNavigate();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<StaffMe>('/me'),
  });

  const activeSection =
    NAV_SECTIONS.find((s) => location.pathname === '/' && s.id === 'home')
    || NAV_SECTIONS.find((s) => s.id !== 'home' && location.pathname.startsWith(`/${s.id}`))
    || NAV_SECTIONS[0];

  const links = SECTION_LINKS[activeSection.id];
  const onSectionRoot =
    activeSection.id === 'home'
      ? location.pathname === '/'
      : location.pathname === `/${activeSection.id}`;
  // На корне раздела — полный список функций; на подстранице — компактная полоса
  const showSectionPanel = Boolean(links?.length);

  const logout = async () => {
    await api('/logout', { method: 'POST', body: {} }).catch(() => undefined);
    window.location.href = '/login';
  };

  return (
    <div className="taxi">
      <header className="taxi-top">
        <img className="taxi-logo" src="/logo-uchet1.svg" width={26} height={26} alt="Учёт №1" />
        <button
          type="button"
          className="taxi-burger"
          title={collapsed ? 'Показать меню' : 'Скрыть меню'}
          aria-expanded={!collapsed}
          aria-controls="taxi-side"
          onClick={toggle}
        >
          <span /><span /><span />
        </button>
        <div className="taxi-title">ПП 1 / Учёт №1, редакция 1.0 / Пневмоподвеска</div>
        <div className="taxi-search">
          <input type="search" placeholder="Поиск Ctrl+Shift+F" autoComplete="off" />
        </div>
        <div className="taxi-top-actions">
          <span className="taxi-user" title={me.data?.role || ''}>
            {me.data?.name || me.data?.login || '…'}
          </span>
          <button type="button" className="taxi-ico taxi-logout" onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      </header>

      <div className="taxi-body-row">
        <aside className="taxi-side" id="taxi-side">
          <div className="taxi-side-head">
            <span className="taxi-side-label">Разделы</span>
            <button
              type="button"
              className="taxi-side-collapse"
              title="Скрыть меню"
              aria-label="Скрыть меню"
              onClick={toggle}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <nav className="taxi-sections">
            {NAV_SECTIONS.map((sec) => {
              const to = sec.href || (sec.id === 'home' ? '/' : `/${sec.id}`);
              const reactOwned =
                sec.id === 'home'
                || sec.id === 'crm'
                || sec.id === 'sales'
                || sec.id === 'company'
                || sec.id === 'money';
              if (!reactOwned) {
                return (
                  <a
                    key={sec.id}
                    className={activeSection.id === sec.id ? 'sec active' : 'sec'}
                    href={to}
                  >
                    <NavIcon name={sec.icon} />
                    {sec.label}
                  </a>
                );
              }
              return (
                <NavLink
                  key={sec.id}
                  to={sec.id === 'money' ? '/money/tochka' : to}
                  end={sec.id === 'home'}
                  className={({ isActive }) => (isActive || activeSection.id === sec.id ? 'sec active' : 'sec')}
                >
                  <NavIcon name={sec.icon} />
                  {sec.label}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        <main className="taxi-main app">
          {showSectionPanel ? (
            <div className={`section-panel${onSectionRoot ? ' section-panel--hub' : ' section-panel--bar'}`}>
              <div className="section-cols">
                {links!.map((col, i) => (
                  <div key={i} className="section-col">
                    {col.map((item) =>
                      item.disabled ? (
                        <span key={item.label} className="section-link muted">
                          {item.label}
                        </span>
                      ) : item.to ? (
                        <button
                          key={item.label}
                          type="button"
                          className={
                            location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
                              ? 'section-link active'
                              : 'section-link'
                          }
                          onClick={() => {
                            if (
                              item.to!.startsWith('/money')
                              || item.to!.startsWith('/crm/deals')
                              || item.to!.startsWith('/sales/')
                              || item.to!.startsWith('/company/org')
                            ) {
                              navigate(item.to!);
                            } else {
                              window.location.href = item.to!;
                            }
                          }}
                        >
                          {item.label}
                        </button>
                      ) : (
                        <span key={item.label} className="section-link muted">
                          {item.label}
                        </span>
                      )
                    )}
                  </div>
                ))}
              </div>
              {onSectionRoot ? (
                <p className="muted" style={{ margin: '16px 0 0', fontSize: 13 }}>
                  Выберите пункт выше — откроется журнал или карточка.
                </p>
              ) : null}
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>

      <footer className="taxi-footer">
        <span className="taxi-footer-note">Разработка · Rubtsov.pro</span>
      </footer>
    </div>
  );
}
