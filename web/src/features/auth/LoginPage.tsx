import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/shared/api/client';

export function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      api('/login', {
        method: 'POST',
        body: { username: login, password },
      }),
    onSuccess: () => {
      const next = new URLSearchParams(location.search).get('next') || '/';
      location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    },
    onError: (e: Error) => setError(e.message || 'Ошибка входа'),
  });

  return (
    <div className="auth-body">
      <div className="auth-wrap">
        <div className="auth-card">
          <img src="/logo-uchet1.svg" width={48} height={48} alt="" />
          <h1>Учёт №1</h1>
          <p className="muted">Пневмоподвеска · вход сотрудников</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError('');
              mut.mutate();
            }}
          >
            <label>
              Логин
              <input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required />
            </label>
            <label>
              Пароль
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error ? <p className="muted" style={{ color: 'var(--danger)' }}>{error}</p> : null}
            <button className="primary" type="submit" disabled={mut.isPending}>
              {mut.isPending ? 'Вход…' : 'Войти'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
