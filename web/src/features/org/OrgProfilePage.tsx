import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/shared/api/client';
import type { DocNumbering, OrgProfile } from '@/shared/api/types';
import { Page } from '@/shared/ui/Page';

export function OrgProfilePage() {
  const qc = useQueryClient();
  const orgQ = useQuery({ queryKey: ['org-profile'], queryFn: () => api<OrgProfile>('/org-profile') });
  const numQ = useQuery({ queryKey: ['doc-numbering'], queryFn: () => api<DocNumbering>('/doc-numbering') });

  const [org, setOrg] = useState<Partial<OrgProfile>>({});
  const [lastOut, setLastOut] = useState('');
  const [lastIn, setLastIn] = useState('');
  const [lastInv, setLastInv] = useState('');
  const [msg, setMsg] = useState('');
  const [numMsg, setNumMsg] = useState('');

  useEffect(() => {
    if (orgQ.data) setOrg(orgQ.data);
  }, [orgQ.data]);

  useEffect(() => {
    if (!numQ.data) return;
    setLastOut(numQ.data.last_out_1c || '');
    setLastIn(numQ.data.last_in_1c || '');
    setLastInv(String(numQ.data.seq_invoice || ''));
    if (numQ.data.synced_at) setNumMsg(`Синк 1С: ${numQ.data.synced_at}`);
  }, [numQ.data]);

  const saveOrg = useMutation({
    mutationFn: () => api('/org-profile', { method: 'PUT', body: org }),
    onSuccess: () => {
      setMsg('Сохранено');
      void qc.invalidateQueries({ queryKey: ['org-profile'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const syncNum = useMutation({
    mutationFn: () => api<DocNumbering>('/doc-numbering/sync-from-1c', { method: 'POST', body: {} }),
    onSuccess: (r) => {
      setNumMsg(`Из 1С: расход ${r.last_out_1c || '—'}, приход ${r.last_in_1c || '—'}. След. УПД: ${r.next_out}`);
      void qc.invalidateQueries({ queryKey: ['doc-numbering'] });
    },
    onError: (e: Error) => setNumMsg(e.message),
  });

  const saveNum = useMutation({
    mutationFn: () =>
      api<DocNumbering>('/doc-numbering', {
        method: 'PUT',
        body: { last_out: lastOut, last_in: lastIn, last_invoice: lastInv },
      }),
    onSuccess: (r) => {
      setNumMsg(`Нумерация сохранена. След.: УПД ${r.next_out}, счёт ${r.next_invoice}`);
      void qc.invalidateQueries({ queryKey: ['doc-numbering'] });
    },
    onError: (e: Error) => setNumMsg(e.message),
  });

  const field = (key: keyof OrgProfile, label: string, extra?: string) => (
    <label className={extra}>
      {label}
      <input
        className={key === 'inn' || key === 'bik' || key === 'rs' || key === 'ks' || key === 'ogrnip' ? 'mono' : undefined}
        value={String(org[key] ?? '')}
        onChange={(e) => setOrg((o) => ({ ...o, [key]: e.target.value }))}
      />
    </label>
  );

  return (
    <Page
      title="Реквизиты организации"
      toolbar={
        <>
          <button className="primary" type="button" disabled={saveOrg.isPending} onClick={() => saveOrg.mutate()}>
            Записать реквизиты
          </button>
          <button type="button" disabled={syncNum.isPending} onClick={() => syncNum.mutate()}>
            Подтянуть номера из 1С
          </button>
          <button type="button" disabled={saveNum.isPending} onClick={() => saveNum.mutate()}>
            Сохранить нумерацию
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: '0 0 10px' }}>
        Используются в бланках счёта, УПД и счёт-фактуры.
      </p>

      <h3 className="form-section-title">О продавце</h3>
      <div className="form-grid">
        {field('name', 'Наименование', 'span-2')}
        {field('short_name', 'Кратко (подпись)')}
        {field('ogrnip', 'ОГРНИП')}
        {field('inn', 'ИНН')}
        {field('kpp', 'КПП')}
        {field('address', 'Адрес', 'span-2')}
        {field('phone', 'Телефон')}
        <label>
          НДС %
          <input
            className="mono"
            value={String(org.vat_rate ?? 5)}
            onChange={(e) => setOrg((o) => ({ ...o, vat_rate: Number(e.target.value) || 5 }))}
          />
        </label>
        {field('director', 'Руководитель')}
        {field('master_title', 'Мастер (заказ-наряд)')}
      </div>

      <h3 className="form-section-title">Банковские реквизиты</h3>
      <div className="form-grid">
        {field('bank', 'Банк', 'span-2')}
        {field('bik', 'БИК')}
        {field('ks', 'К/с')}
        {field('rs', 'Р/с', 'span-2')}
      </div>
      <p className="muted">{msg}</p>

      <h3 className="form-section-title">Нумерация документов</h3>
      <p className="muted" style={{ margin: '0 0 10px' }}>
        {numQ.data?.note}
      </p>
      <div className="form-grid">
        <label>
          Последний № расход / УПД / СФ / ЗН
          <input className="mono" value={lastOut} onChange={(e) => setLastOut(e.target.value)} placeholder="00НФ-003845" />
        </label>
        <label>
          Следующий будет
          <input className="mono" value={numQ.data?.next_out || ''} readOnly />
        </label>
        <label>
          Последний № прихода
          <input className="mono" value={lastIn} onChange={(e) => setLastIn(e.target.value)} placeholder="00НФ-000314" />
        </label>
        <label>
          Следующий приход
          <input className="mono" value={numQ.data?.next_in || ''} readOnly />
        </label>
        <label>
          Последний № счёта (число)
          <input className="mono" value={lastInv} onChange={(e) => setLastInv(e.target.value)} placeholder="22640" />
        </label>
        <label>
          Следующий счёт
          <input className="mono" value={numQ.data?.next_invoice || ''} readOnly />
        </label>
      </div>
      <p className="muted">{numMsg}</p>
    </Page>
  );
}
