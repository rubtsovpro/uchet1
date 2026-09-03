import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/shared/api/client';
import type { StaffMe } from '@/shared/api/types';

type MeProfile = StaffMe & {
  phone?: string;
  avatar_url?: string;
  has_password?: boolean;
  has_pin?: boolean;
  can_change_password?: boolean;
  can_set_pin?: boolean;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function ProfileModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phone, setPhone] = useState('');
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newPass2, setNewPass2] = useState('');
  const [pinAuth, setPinAuth] = useState('');
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeProfile>('/me'),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setMsg('');
    setErr('');
    setOldPass('');
    setNewPass('');
    setNewPass2('');
    setPinAuth('');
    setPin('');
  }, [open]);

  useEffect(() => {
    if (me.data) setPhone(String(me.data.phone || ''));
  }, [me.data]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['me'] });

  const savePhone = useMutation({
    mutationFn: () => api('/me', { method: 'PATCH', body: { phone } }),
    onSuccess: () => {
      setErr('');
      setMsg('Телефон сохранён');
      refresh();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Ошибка'),
  });

  const savePass = useMutation({
    mutationFn: () =>
      api('/me/password', {
        method: 'POST',
        body: { old_password: oldPass, new_password: newPass },
      }),
    onSuccess: () => {
      setOldPass('');
      setNewPass('');
      setNewPass2('');
      setErr('');
      setMsg('Пароль изменён');
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Ошибка'),
  });

  const savePin = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/me/pin', { method: 'POST', body }),
    onSuccess: () => {
      setPin('');
      setPinAuth('');
      setErr('');
      setMsg('PIN обновлён');
      refresh();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Ошибка'),
  });

  if (!open) return null;
  const data = me.data;
  const name = data?.name || data?.login || 'Пользователь';

  const authPayload = () => {
    const v = pinAuth.trim();
    const digits = v.replace(/\D/g, '');
    if (digits && digits === v) return { current_pin: digits };
    return { current_password: v };
  };

  return (
    <div
      className="staff-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="staff-modal-card profile-modal-card">
        <h3>Профиль</h3>
        <p className="profile-hint">
          {name} · {data?.login || data?.email || ''}
        </p>
        <div className="profile-avatar-row">
          <div className="profile-avatar-preview">
            {data?.avatar_url ? <img src={data.avatar_url} alt="" /> : initials(name)}
          </div>
          <div className="profile-avatar-actions">
            <button type="button" className="primary" onClick={() => fileRef.current?.click()}>
              Сменить фото
            </button>
            {data?.avatar_url ? (
              <button
                type="button"
                onClick={() => {
                  void api('/me/avatar', { method: 'DELETE' })
                    .then(() => {
                      setMsg('Аватар убран');
                      refresh();
                    })
                    .catch((e) => setErr(e instanceof ApiError ? e.message : 'Ошибка'));
                }}
              >
                Убрать
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const fd = new FormData();
                fd.append('file', file);
                void api('/me/avatar', { method: 'POST', body: fd })
                  .then(() => {
                    setMsg('Аватар обновлён');
                    refresh();
                  })
                  .catch((er) => setErr(er instanceof ApiError ? er.message : 'Ошибка'))
                  .finally(() => {
                    e.target.value = '';
                  });
              }}
            />
          </div>
        </div>

        <div className="profile-grid">
          <label>
            Телефон
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 …"
            />
          </label>
        </div>

        {data?.can_change_password !== false && data?.id !== '__admin__' ? (
          <div className="profile-section">
            <h4>Пароль</h4>
            <div className="profile-grid">
              <label>
                Текущий пароль
                <input
                  type="password"
                  value={oldPass}
                  onChange={(e) => setOldPass(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <label>
                Новый пароль
                <input
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Ещё раз
                <input
                  type="password"
                  value={newPass2}
                  onChange={(e) => setNewPass2(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
            </div>
            <div className="toolbar" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  if (!newPass || newPass !== newPass2) {
                    setErr('Новый пароль и подтверждение не совпадают');
                    return;
                  }
                  savePass.mutate();
                }}
              >
                Сменить пароль
              </button>
            </div>
          </div>
        ) : (
          <div className="profile-section">
            <h4>Пароль</h4>
            <p className="profile-hint">Пароль системного admin задаётся на сервере (WMS_PASS).</p>
          </div>
        )}

        {data?.can_set_pin ? (
          <div className="profile-section">
            <h4>PIN смены</h4>
            <p className="profile-hint">
              {data.has_pin
                ? 'PIN задан — укажите текущий PIN или пароль.'
                : 'PIN ещё не задан (1–6 цифр). Нужен текущий пароль.'}
            </p>
            <div className="profile-grid">
              <label>
                Текущий пароль (или PIN)
                <input
                  type="password"
                  value={pinAuth}
                  onChange={(e) => setPinAuth(e.target.value)}
                />
              </label>
              <label>
                Новый PIN
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </label>
            </div>
            <div className="toolbar" style={{ marginTop: 10, justifyContent: 'flex-end', gap: 8 }}>
              {data.has_pin ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm('Сбросить PIN?')) return;
                    savePin.mutate({ pin: null, ...authPayload() });
                  }}
                >
                  Сбросить PIN
                </button>
              ) : null}
              <button
                type="button"
                className="primary"
                onClick={() => {
                  if (pin.length < 1 || pin.length > 6) {
                    setErr('PIN — от 1 до 6 цифр');
                    return;
                  }
                  savePin.mutate({ pin, ...authPayload() });
                }}
              >
                Сохранить PIN
              </button>
            </div>
          </div>
        ) : null}

        <div className="toolbar" style={{ marginTop: 16, justifyContent: 'space-between', gap: 8 }}>
          <button type="button" onClick={onClose}>
            Закрыть
          </button>
          <button type="button" className="primary" onClick={() => savePhone.mutate()}>
            Сохранить телефон
          </button>
        </div>
        {err ? <p className="error" style={{ marginTop: 10 }}>{err}</p> : null}
        {msg ? (
          <p className="muted" style={{ marginTop: 10, color: '#047857' }}>
            {msg}
          </p>
        ) : null}
      </div>
    </div>
  );
}