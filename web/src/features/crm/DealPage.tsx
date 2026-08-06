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
  type StockDocRef,
  type TransferRef,
} from '@/features/crm/orderLinkTabs';

type DealDetail = {
  id: string;
  name?: string;
  price?: number;
  contact_name?: string;
  company_name?: string;
  buyer_kind?: string;
  buyer_inn?: string;
  inn?: string;
  is_legal_entity?: boolean;
  items?: Array<{ name?: string; qty?: number; price?: number }>;
  sales_docs?: SalesDocRow[];
};

export function DealPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [creating, setCreating] = useState(false);

  const q = useQuery({
    queryKey: ['deal', id],
    queryFn: () => api<DealDetail>(`/crm/deals/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });

  const outsQ = useQuery({
    queryKey: ['deal-outs', id],
    queryFn: async () => {
      const r = await api<{ items?: StockDocRef[] } | StockDocRef[]>(
        `/docs?type=out&deal_id=${encodeURIComponent(id)}&limit=50`
      );
      return Array.isArray(r) ? r : r.items || [];
    },
    enabled: Boolean(id),
  });

  const xferQ = useQuery({
    queryKey: ['deal-xfer', id],
    queryFn: async () => {
      const r = await api<{ items?: TransferRef[] } | TransferRef[]>(
        `/crm/deals/${encodeURIComponent(id)}/transfer-orders`
      );
      return Array.isArray(r) ? r : r.items || [];
    },
    enabled: Boolean(id),
  });

  const create = useMutation({
    mutationFn: async (docType: string) => {
      const res = await api<{ doc?: { id: string; number?: string; doc_type?: string } }>(
        '/sales-docs/from-deal',
        {
          method: 'POST',
          body: { deal_id: id, doc_type: docType },
        }
      );
      return res.doc || { id: '', number: '', doc_type: docType };
    },
    onSuccess: (doc) => {
      setMsg(`Создано: ${doc.number || doc.id}`);
      void qc.invalidateQueries({ queryKey: ['deal', id] });
      if (doc.id && doc.doc_type !== 'contract') {
        navigate(`/sales/doc/${encodeURIComponent(doc.id)}`);
      } else if (doc.id) {
        window.location.href = `/sales-docs/${encodeURIComponent(doc.id)}`;
      }
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const d = q.data;
  const items = d?.items || [];
  const docs = d?.sales_docs || [];
  const title = d?.name || (id ? `Заказ ${id}` : 'Заказ покупателя');

  const pageTabs = id
    ? buildDealOrderTabs({
        dealId: id,
        salesDocs: docs,
        stockOuts: outsQ.data || [],
        transferOrders: xferQ.data || [],
        needContract: dealNeedsContract(d),
        allowCreate: true,
        active: { kind: 'deal' },
      })
    : [];

  const onCreate = async (action: string) => {
    if (creating || create.isPending) return;
    if (action === 'transfer' || action === 'upd-ship') {
      window.location.href = `/deals/${encodeURIComponent(id)}`;
      return;
    }
    const label = SALES_TYPE_TAB[action] || action;
    if (!items.length) {
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
        { label: 'CRM', to: '/crm' },
        { label: 'Заказы покупателей', to: '/crm/deals' },
        { label: title },
      ]}
      pageTabs={pageTabs}
      onPageTabCreate={onCreate}
      toolbar={
        <>
          <Link to="/crm/deals">К списку</Link>
          <a href={`/deals/${encodeURIComponent(id)}`}>Полная карточка</a>
        </>
      }
    >
      {q.isLoading ? <p className="muted">Загрузка…</p> : null}
      {d ? (
        <>
          <div className="form-grid">
            <label className="span-2">
              Название
              <input value={d.name || ''} readOnly />
            </label>
            <label>
              Сумма
              <input className="mono" value={d.price != null ? String(d.price) : ''} readOnly />
            </label>
            <label>
              ИНН
              <input className="mono" value={d.inn || d.buyer_inn || ''} readOnly />
            </label>
          </div>

          <p className="muted" style={{ margin: '10px 0 0' }}>
            Цепочка документов — вкладками сверху. Курсивом — ещё не созданы.
          </p>
          {msg ? <p className="muted">{msg}</p> : null}
          {!items.length ? (
            <p className="muted">Чтобы создать документы, в заказе нужны позиции.</p>
          ) : null}

          <h3 className="form-section-title">Позиции ({items.length})</h3>
          <table className="grid">
            <thead>
              <tr>
                <th>Наименование</th>
                <th>Кол-во</th>
                <th>Цена</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>{it.name}</td>
                  <td className="mono">{it.qty}</td>
                  <td className="mono">{it.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </Page>
  );
}
