import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/shared/api/client';

const LAST_KEY = 'wms_last_user';

type LastUser = { login: string; name: string; has_pin?: boolean };

function readLast(): LastUser | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as LastUser;
    if (!j?.login) return null;
    return { login: String(j.login), name: String(j.name || j.login), has_pin: Boolean(j.has_pin) };
  } catch {
    return null;
  }
}

function saveLast(user: { login?: string; name?: string; has_pin?: boolean } | undefined) {
  if (!user?.login) return;
  try {
    localStorage.setItem(
      LAST_KEY,
      JSON.stringify({
        login: user.login,
        name: user.name || user.login,
        has_pin: Boolean(user.has_pin),
        at: Date.now(),
      })
    );
  } catch {
    /* ignore */
  }
}

function loginBody(username: string, secret: string) {
  const s = String(secret || '');
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 4 && digits.length <= 6 && digits === s.trim()) {
    return { username, pin: digits };
  }
  return { username, password: s };
}

export function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [last, setLast] = useState<LastUser | null>(null);
  const [quickMode, setQuickMode] = useState(false);

  const screenQ = useQuery({
    queryKey: ['auth-screen'],
    queryFn: () =>
      api<{ title?: string; subtitle?: string; home_path?: string }>('/auth/screen'),
    staleTime: 60_000,
  });

  useEffect(() => {
    const u = readLast();
    setLast(u);
    setQuickMode(Boolean(u));
    if (u) setLogin(u.login);
  }, []);

  const mut = useMutation({
    mutationFn: () =>
      api<{
        home_path?: string;
        user?: { login?: string; name?: string; has_pin?: boolean };
        need_2fa?: boolean;
      }>('/login', {
        method: 'POST',
        body: loginBody(login, password),
      }),
    onSuccess: (data) => {
      if (data?.need_2fa) {
        setError('Нужен код из Telegram — откройте классическую форму /login');
        return;
      }
      saveLast(data?.user);
      const next = new URLSearchParams(location.search).get('next') || data?.home_path || '/';
      location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    },
    onError: (e: Error) => setError(e.message || 'Ошибка входа'),
  });

  const title = screenQ.data?.title || 'Учёт №1';
  const subtitle = screenQ.data?.subtitle || 'Пневмоподвеска · вход сотрудников';

  return (
    <div className="auth-body">
      <div className="auth-wrap">
        <div className="auth-card">
          <img src="/logo-uchet1.svg" width={48} height={48} alt="" />
          <h1>{title}</h1>
          <p className="muted">{subtitle}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError('');
              mut.mutate();
            }}
          >
            {quickMode && last ? (
              <>
                <p className="muted" style={{ marginBottom: 8 }}>
                  На этом устройстве
                </p>
                <p style={{ fontWeight: 600, marginBottom: 12 }}>{last.name}</p>
                <label>
                  {last.has_pin ? 'PIN смены' : 'Пароль или PIN'}
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    inputMode={last.has_pin ? 'numeric' : 'text'}
                    required
                  />
                </label>
                <button className="primary" type="submit" disabled={mut.isPending}>
                  {mut.isPending ? 'Вход…' : `Продолжить как ${last.name}`}
                </button>
                <button
                  type="button"
                  style={{
                    marginTop: 12,
                    width: '100%',
                    background: 'transparent',
                    border: 0,
                    color: 'var(--muted, #888)',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    localStorage.removeItem(LAST_KEY);
                    setLast(null);
                    setQuickMode(false);
                    setLogin('');
                    setPassword('');
                  }}
                >
                  Другой пользователь
                </button>
              </>
            ) : (
              <>
                <label>
                  Логин
                  <input
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </label>
                <label>
                  Пароль или PIN
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </label>
                <button className="primary" type="submit" disabled={mut.isPending}>
                  {mut.isPending ? 'Вход…' : 'Войти'}
                </button>
              </>
            )}
            {error ? (
              <p className="muted" style={{ color: 'var(--danger)' }}>
                {error}
              </p>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  );
}
