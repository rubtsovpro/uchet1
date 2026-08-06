import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import { api } from '@/shared/api/client';
import type { SalesDocRow } from '@/shared/api/types';
import { Page } from '@/shared/ui/Page';
import {
  buildDealOrderTabs,
  dealNeedsContract,
  SALES_TYPE_TAB,
} from '@/features/crm/orderLinkTabs';

type DocFull = {
  id: string;
  doc_type: string;
  number: string;
  doc_date: string;
  deal_id?: string;
  counterparty_name?: string;
  total?: number;
  lines?: Array<{ name: string; qty: number; price: number; amount: number }>;
};

type DealBrief = {
  id: string;
  name?: string;
  is_legal_entity?: boolean;
  buyer_kind?: string;
  company_name?: string;
  buyer_inn?: string;
  inn?: string;
  items?: Array<{ name?: string; qty?: number }>;
  sales_docs?: SalesDocRow[];
};

export function SalesDocPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [creating, setCreating] = useState(false);

  const q = useQuery({
    queryKey: ['sales-doc', id],
    queryFn: () => api<DocFull>(`/sales-docs/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });

  const d = q.data;
  const dealId = String(d?.deal_id || '').trim();

  const dealQ = useQuery({
    queryKey: ['deal', dealId],
    queryFn: () => api<DealBrief>(`/crm/deals/${encodeURIComponent(dealId)}`),
    enabled: Boolean(dealId),
  });

  const create = useMutation({
    mutationFn: async (docType: string) => {
      const res = await api<{ doc?: { id: string; number?: string; doc_type?: string } }>(
        '/sales-docs/from-deal',
        {
          method: 'POST',
          body: { deal_id: dealId, doc_type: docType },
        }
      );
      return res.doc || { id: '', number: '', doc_type: docType };
    },
    onSuccess: (doc) => {
      setMsg(`Создано: ${doc.number || doc.id}`);
      void qc.invalidateQueries({ queryKey: ['deal', dealId] });
      if (doc.id && doc.doc_type !== 'contract') {
        navigate(`/sales/doc/${encodeURIComponent(doc.id)}`);
      } else if (doc.id) {
        window.location.href = `/sales-docs/${encodeURIComponent(doc.id)}`;
      }
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const typePath: Record<string, { label: string; to: string }> = {
    invoice: { label: 'Счета', to: '/sales/invoices' },
    upd: { label: 'УПД', to: '/sales/upd' },
    sf: { label: 'Счета-фактуры', to: '/sales/sf' },
    workorder: { label: 'Заказ-наряды', to: '/sales/workorders' },
  };
  const typeCrumb = d ? typePath[d.doc_type] : undefined;
  const title = d ? `${d.number || d.doc_type}` : 'Документ';
  const deal = dealQ.data;

  const pageTabs =
    dealId && d
      ? buildDealOrderTabs({
          dealId,
          salesDocs: deal?.sales_docs || [
            {
              id: d.id,
              doc_type: d.doc_type as SalesDocRow['doc_type'],
              number: d.number,
              doc_date: d.doc_date,
            },
          ],
          needContract: dealNeedsContract(deal),
          allowCreate: true,
          active: { kind: 'sales', docType: d.doc_type, id: d.id },
        })
      : undefined;

  const onCreate = async (action: string) => {
    if (!dealId || creating || create.isPending) return;
    if (action === 'transfer' || action === 'upd-ship') {
      window.location.href = `/deals/${encodeURIComponent(dealId)}`;
      return;
    }
    const label = SALES_TYPE_TAB[action] || action;
    if (!(deal?.items || []).length) {
      setMsg('В заказе нет позиций — документ не создать');
      return;
    }
    if (!window.confirm(`Создать документ «${label}»?`)) return;
    setCreating(true);
    try {
      await create.mutateAsync(action);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Page
      title={title}
      crumbs={[
        { label: 'Продажи', to: '/sales' },
        ...(typeCrumb ? [typeCrumb] : []),
        ...(dealId
          ? [{ label: deal?.name || `Заказ ${dealId}`, to: `/crm/deals/${encodeURIComponent(dealId)}` }]
          : []),
        { label: title },
      ]}
      pageTabs={pageTabs}
      onPageTabCreate={onCreate}
      toolbar={
        d ? (
          <>
            <a
              className="primary"
              href={`/api/sales-docs/${encodeURIComponent(d.id)}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
            >
              открыть
            </a>
            <a
              href={`/api/sales-docs/${encodeURIComponent(d.id)}/pdf?download=1`}
              rel="noopener noreferrer"
            >
              скачать
            </a>
            {dealId ? <Link to={`/crm/deals/${dealId}`}>Заказ</Link> : null}
            <a href={`/sales-docs/${encodeURIComponent(d.id)}`}>Полная карточка</a>
          </>
        ) : null
      }
    >
      {q.isLoading ? <p className="muted">Загрузка…</p> : null}
      {msg ? <p className="muted">{msg}</p> : null}
      {d ? (
        <>
          <div className="form-grid">
            <label>
              Номер
              <input className="mono" value={d.number} readOnly />
            </label>
            <label>
              Дата
              <input value={d.doc_date || ''} readOnly />
            </label>
            <label className="span-2">
              Контрагент
              <input value={d.counterparty_name || ''} readOnly />
            </label>
            <label>
              Сумма
              <input className="mono" value={d.total != null ? String(d.total) : ''} readOnly />
            </label>
          </div>

          <h3 className="form-section-title">Строки ({(d.lines || []).length})</h3>
          <table className="grid">
            <thead>
              <tr>
                <th>Наименование</th>
                <th>Кол-во</th>
                <th>Цена</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {(d.lines || []).map((ln, i) => (
                <tr key={i}>
                  <td>{ln.name}</td>
                  <td className="mono">{ln.qty}</td>
                  <td className="mono">{ln.price}</td>
                  <td className="mono">{ln.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </Page>
  );
}
