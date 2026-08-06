import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/shared/api/client';
import type { DocNumbering } from '@/shared/api/types';
import { Page } from '@/shared/ui/Page';

/** Нумерация документов. Реквизиты/печать — у каждого юрлица в «Организации». */
export function OrgProfilePage() {
  const qc = useQueryClient();
  const numQ = useQuery({ queryKey: ['doc-numbering'], queryFn: () => api<DocNumbering>('/doc-numbering') });

  const [lastOut, setLastOut] = useState('');
  const [lastIn, setLastIn] = useState('');
  const [lastInv, setLastInv] = useState('');
  const [numMsg, setNumMsg] = useState('');

  useEffect(() => {
    if (!numQ.data) return;
    setLastOut(numQ.data.last_out_1c || '');
    setLastIn(numQ.data.last_in_1c || '');
    setLastInv(String(numQ.data.seq_invoice || ''));
    if (numQ.data.synced_at) setNumMsg(`Синк 1С: ${numQ.data.synced_at}`);
  }, [numQ.data]);

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

  return (
    <Page
      title="Нумерация документов"
      toolbar={
        <>
          <button type="button" disabled={syncNum.isPending} onClick={() => syncNum.mutate()}>
            Подтянуть номера из 1С
          </button>
          <button type="button" className="primary" disabled={saveNum.isPending} onClick={() => saveNum.mutate()}>
            Сохранить нумерацию
          </button>
        </>
      }
    >
      <p style={{ margin: '0 0 12px', lineHeight: 1.45 }}>
        Реквизиты, печать и подпись задаются у каждого юрлица:{' '}
        <Link to="/organizations">Компания → Организации</Link> → контур → вкладка «Юрлица».
      </p>

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
