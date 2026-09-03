import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { StaffMe } from '@/shared/api/types';
import { NAV_SECTIONS_NOW, SECTION_LINKS } from './nav';
import { NavIcon } from './NavIcon';
import { useSideCollapsed } from './useSideCollapsed';
import { ProfileModal } from './ProfileModal';
import { NotifBell } from './NotifBell';

function canAccessSection(me: StaffMe | undefined, sectionId: string): boolean {
  if (!me) return true;
  if (me.isSystemAdmin || me.role === 'admin') return true;
  const secs = me.rights?.sections;
  if (!Array.isArray(secs)) return true;
  return secs.includes(sectionId);
}

export function ShellLayout() {
  const { collapsed, toggle, flyoutOpen, closeFlyout } = useSideCollapsed();
  const location = useLocation();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const [phoneUi, setPhoneUi] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('ui-phone'),
  );
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () =>
      api<
        StaffMe & {
          phone?: string;
          avatar_url?: string;
        }
      >('/me'),
  });

  const chatsBadge = useQuery({
    queryKey: ['chats'],
    queryFn: () => api<{ unread_total: number }>('/chats'),
    refetchInterval: 8_000,
    enabled: canAccessSection(me.data, 'chats') || me.data?.role === 'admin' || me.data?.isSystemAdmin,
  });

  const visibleSections = NAV_SECTIONS_NOW.filter((s) => canAccessSection(me.data, s.id));

  const activeSection =
    visibleSections.find((s) => location.pathname === '/' && s.id === 'home')
    || visibleSections.find((s) => s.id !== 'home' && location.pathname.startsWith(`/${s.id}`))
    || visibleSections[0]
    || NAV_SECTIONS_NOW[0];

  const links = SECTION_LINKS[activeSection.id];
  const onSectionRoot =
    activeSection.id === 'home'
      ? location.pathname === '/'
      : location.pathname === `/${activeSection.id}`;
  // На корне раздела — полный список функций; на подстранице — компактная полоса
  const showSectionPanel = Boolean(links?.length);

  const logout = () => {
    const go = () => {
      window.location.replace('/login');
    };
    void api('/logout', { method: 'POST', body: {} })
      .catch(() => undefined)
      .finally(go);
    window.setTimeout(go, 800);
  };

  const displayName = me.data?.name || me.data?.login || '…';

  return (
    <div className="taxi">
      <header className="taxi-top">
        <img className="taxi-logo" src="/logo-uchet1.svg" width={26} height={26} alt="Учёт №1" />
        <button
          type="button"
          className="taxi-burger"
          title={flyoutOpen ? 'Свернуть меню' : collapsed ? 'Показать меню' : 'Скрыть меню'}
          aria-expanded={flyoutOpen || !collapsed}
          aria-controls="taxi-side"
          onClick={toggle}
        >
          <span /><span /><span />
        </button>
        <button
          type="button"
          className="taxi-phone-toggle"
          title={phoneUi ? 'Обычный (десктоп) вид' : 'Мобильный вид'}
          aria-label="Мобильный вид"
          aria-pressed={phoneUi}
          onClick={() => {
            const next = !phoneUi;
            document.documentElement.classList.toggle('ui-phone', next);
            try {
              localStorage.setItem('uchet1_ui_phone', next ? '1' : '0');
            } catch {
              /* ignore */
            }
            if (!next) closeFlyout();
            setPhoneUi(next);
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <rect x="7" y="2.5" width="10" height="19" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <circle cx="12" cy="18.2" r="0.9" fill="currentColor" />
          </svg>
        </button>
        <div className="taxi-title">
          <span className="taxi-product">Учёт №1</span>
          <span className="taxi-org">Пневмоподвеска</span>
        </div>
        <div className="taxi-top-actions">
          <NotifBell />
          <div className="taxi-user-wrap">
            <button
              type="button"
              className="taxi-user"
              title={me.data?.role ? `Профиль · ${me.data.role}` : 'Профиль'}
              onClick={() => setProfileOpen(true)}
            >
              <span className="taxi-user-name">{displayName}</span>
            </button>
          </div>
          <button
            type="button"
            className="taxi-ico taxi-logout"
            title="Выйти"
            aria-label="Выйти"
            onClick={() => void logout()}
          >
            <svg className="taxi-logout-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <path
                d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h7A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 10 18.5V17"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <path
                d="M13 12H4m0 0 2.5-2.5M4 12l2.5 2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="taxi-logout-label">Выйти</span>
          </button>
        </div>
      </header>

      <div className="taxi-body-row">
        <button
          type="button"
          className="taxi-side-scrim"
          id="taxi-side-scrim"
          aria-label="Закрыть меню"
          tabIndex={-1}
          onClick={closeFlyout}
        />
        <aside
          className="taxi-side"
          id="taxi-side"
          onClick={(e) => {
            if (
              typeof window === 'undefined' ||
              !(
                document.documentElement.classList.contains('ui-phone') ||
                window.matchMedia('(max-width: 1024px)').matches
              )
            ) {
              return;
            }
            const t = e.target as HTMLElement | null;
            if (t?.closest?.('a.sec')) closeFlyout();
          }}
        >
          <nav className="taxi-sections">
            {visibleSections.map((sec) => {
              const to = sec.href || (sec.id === 'home' ? '/' : `/${sec.id}`);
              // Только экраны, которые реально живут в React SPA.
              // «Главное» (/) и корни разделов — legacy.html; клиентский NavLink
              // оставляет index.html и главная «не открывается».
              const reactOwned = sec.id === 'chats';
              const chatBadge =
                sec.id === 'chats' && (chatsBadge.data?.unread_total || 0) > 0 ? (
                  <span className="sec-badge">
                    {(chatsBadge.data?.unread_total || 0) > 99
                      ? '99+'
                      : chatsBadge.data?.unread_total}
                  </span>
                ) : null;
              if (!reactOwned) {
                return (
                  <a
                    key={sec.id}
                    className={activeSection.id === sec.id ? 'sec active' : 'sec'}
                    href={to}
                    title={sec.label}
                    onClick={(e) => {
                      // Полный переход на legacy.html (не SPA). Иначе «Главное» из /chats не открывается.
                      e.preventDefault();
                      window.location.assign(to);
                    }}
                  >
                    <NavIcon name={sec.icon} />
                    <span className="sec-label">{sec.label}</span>
                    {chatBadge}
                  </a>
                );
              }
              return (
                <NavLink
                  key={sec.id}
                  to={to}
                  title={sec.label}
                  className={({ isActive }) => (isActive || activeSection.id === sec.id ? 'sec active' : 'sec')}
                >
                  <NavIcon name={sec.icon} />
                  <span className="sec-label">{sec.label}</span>
                  {chatBadge}
                </NavLink>
              );
            })}
          </nav>
          <div className="taxi-side-foot">
            <button
              type="button"
              className="taxi-side-collapse"
              title={collapsed ? 'Показать меню' : 'Скрыть меню'}
              aria-label={collapsed ? 'Показать меню' : 'Скрыть меню'}
              onClick={toggle}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
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
                              item.to === '/money/tochka'
                              || item.to!.startsWith('/crm/deals')
                              || item.to!.startsWith('/sales/')
                              || item.to!.startsWith('/company/org')
                              || item.to!.startsWith('/chats')
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

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
