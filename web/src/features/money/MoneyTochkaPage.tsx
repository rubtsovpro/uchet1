import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { TochkaAccountRow, TochkaOverview } from '@/shared/api/types';
import { Page } from '@/shared/ui/Page';

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type ForSignItem = {
  id?: string;
  payment_number?: string;
  amount?: number | null;
  currency?: string;
  purpose?: string;
  status?: string;
  recipient?: string;
  account?: string;
  payment_date?: string;
  customer_code?: string;
  owner_label?: string;
  owner_inn?: string;
};

function groupKey(label: string, code: string) {
  return label || code || 'Без привязки';
}

/** Склеить «ИП …» и «Индивидуальный предприниматель …» и разный регистр. */
function normalizeRecipientCanon(name: string | undefined): string {
  let s = (name || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!s) return '';
  s = s.replace(/[«»"'`]/g, '');
  s = s.replace(/[.,;:]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^индивидуальный\s+предприниматель\s+/, 'ип ');
  s = s.replace(/^и\s*\.\s*п\s*\.?\s+/, 'ип ');
  s = s.replace(/^ип[\s.]+/, 'ип ');
  return s;
}

function formatRecipientLabel(name: string | undefined): string {
  let s = (name || '').trim().replace(/\s+/g, ' ');
  if (!s) return '— без контрагента —';
  s = s.replace(/^Индивидуальный\s+предприниматель\s+/i, 'ИП ');
  s = s.replace(/^И\s*\.\s*П\s*\.?\s+/i, 'ИП ');
  s = s.replace(/^ип\s+/i, 'ИП ');
  // «ИП РУБЦОВ СЕРГЕЙ» → «ИП Рубцов Сергей»
  if (/^ИП\s+[А-ЯЁA-Z0-9\s-]+$/u.test(s) && s === s.toUpperCase()) {
    const parts = s.split(/\s+/);
    s = parts
      .map((w, i) => (i === 0 ? 'ИП' : w.charAt(0) + w.slice(1).toLowerCase()))
      .join(' ');
  }
  return s;
}

function recipientKey(name: string | undefined) {
  const canon = normalizeRecipientCanon(name);
  return canon || '— без контрагента —';
}

export function MoneyTochkaPage() {
  const [counterparty, setCounterparty] = useState('');
  const [counterpartyQuery, setCounterpartyQuery] = useState('');

  const q = useQuery({
    queryKey: ['money-tochka'],
    queryFn: () => api<TochkaOverview>('/money/tochka'),
    refetchInterval: 120_000,
  });

  const data = q.data;
  const totals = data?.totals;
  const accounts = data?.accounts || [];
  const operations = data?.operations || [];
  const forSign = data?.for_sign;
  const forSignItems = (forSign?.items || []) as ForSignItem[];

  const totalForSignSum = useMemo(
    () => forSignItems.reduce((s, it) => s + (it.amount != null ? Number(it.amount) : 0), 0),
    [forSignItems]
  );

  const counterparties = useMemo(() => {
    const map = new Map<string, { key: string; name: string; count: number; sum: number; variants: Set<string> }>();
    for (const it of forSignItems) {
      const key = recipientKey(it.recipient);
      const label = formatRecipientLabel(it.recipient);
      let g = map.get(key);
      if (!g) {
        g = { key, name: label, count: 0, sum: 0, variants: new Set() };
        map.set(key, g);
      }
      g.count += 1;
      if (it.amount != null) g.sum += Number(it.amount);
      if (it.recipient) g.variants.add(it.recipient.trim());
      // Более короткое «ИП …» предпочтительнее длинного полного
      if (label.startsWith('ИП ') && (g.name.length > label.length || !g.name.startsWith('ИП '))) {
        g.name = label;
      }
    }
    return [...map.values()].sort((a, b) => b.sum - a.sum || a.name.localeCompare(b.name, 'ru'));
  }, [forSignItems]);

  const counterpartiesFiltered = useMemo(() => {
    const q = counterpartyQuery.trim().toLowerCase();
    if (!q) return counterparties;
    return counterparties.filter(
      (c) =>
        c.name.toLowerCase().includes(q)
        || [...c.variants].some((v) => v.toLowerCase().includes(q))
        || c.key.includes(q)
    );
  }, [counterparties, counterpartyQuery]);

  const filteredForSignItems = useMemo(() => {
    if (!counterparty) return forSignItems;
    return forSignItems.filter((it) => recipientKey(it.recipient) === counterparty);
  }, [forSignItems, counterparty]);

  const selectedCounterparty = useMemo(
    () => counterparties.find((c) => c.key === counterparty) || null,
    [counterparties, counterparty]
  );

  const accountsByIp = useMemo(() => {
    const map = new Map<string, { label: string; inn: string; code: string; rows: TochkaAccountRow[]; own: number; available: number }>();
    for (const a of accounts) {
      const label = a.owner_label || (a.customer_code ? `Код ${a.customer_code}` : 'Без привязки');
      const key = groupKey(label, a.customer_code);
      let g = map.get(key);
      if (!g) {
        g = { label, inn: a.owner_inn || '', code: a.customer_code || '', rows: [], own: 0, available: 0 };
        map.set(key, g);
      }
      g.rows.push(a);
      if (a.own != null) g.own += a.own;
      if (a.available != null) g.available += a.available;
    }
    return [...map.values()].sort((a, b) => b.own - a.own);
  }, [accounts]);

  const forSignByIp = useMemo(() => {
    const map = new Map<string, { label: string; inn: string; items: ForSignItem[]; sum: number }>();
    for (const it of filteredForSignItems) {
      const label = it.owner_label || (it.customer_code ? `Код ${it.customer_code}` : 'Без привязки');
      const key = groupKey(label, it.customer_code || '');
      let g = map.get(key);
      if (!g) {
        g = { label, inn: it.owner_inn || '', items: [], sum: 0 };
        map.set(key, g);
      }
      g.items.push(it);
      if (it.amount != null) g.sum += Number(it.amount);
    }
    return [...map.values()].sort((a, b) => b.sum - a.sum);
  }, [filteredForSignItems]);

  const filteredSum = useMemo(
    () => filteredForSignItems.reduce((s, it) => s + (it.amount != null ? Number(it.amount) : 0), 0),
    [filteredForSignItems]
  );

  return (
    <Page
      title="Точка банк"
      toolbar={
        <>
          <button type="button" disabled={q.isFetching} onClick={() => void q.refetch()}>
            {q.isFetching ? 'Обновление…' : 'Обновить'}
          </button>
          <a href={data?.sign_url || 'https://i.tochka.com/'} target="_blank" rel="noopener noreferrer">
            Подписать в Точке
          </a>
          <a href="https://bank.pnevmopodveska1.ru/income.php" target="_blank" rel="noopener noreferrer">
            Кабинет bank
          </a>
        </>
      }
    >
      {q.isError ? (
        <p className="muted" style={{ color: 'var(--danger)' }}>
          {(q.error as Error)?.message || 'Ошибка загрузки'}
        </p>
      ) : null}

      {q.isLoading ? <p className="muted">Загрузка балансов Точки…</p> : null}

      {totals ? (
        <div className="form-grid" style={{ maxWidth: 820, marginBottom: 8 }}>
          <div>
            <div className="muted">Свои средства</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{money(totals.own)} ₽</div>
          </div>
          <div>
            <div className="muted">Доступно</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{money(totals.available)} ₽</div>
          </div>
          <div>
            <div className="muted">Резерв (карты)</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{money(totals.reserve)} ₽</div>
          </div>
          <div>
            <div className="muted">Счетов / ИП</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {totals.accounts} / {accountsByIp.length}
            </div>
          </div>
        </div>
      ) : null}

      {data?.at ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Снимок: {new Date(data.at).toLocaleString('ru-RU')}
        </p>
      ) : null}

      <h3 className="form-section-title">Счета по ИП (расчётные и фонды)</h3>
      {accountsByIp.length ? (
        accountsByIp.map((g) => (
          <div key={g.code || g.label} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', marginBottom: 6 }}>
              <strong>{g.label}</strong>
              {g.inn ? <span className="muted mono">ИНН {g.inn}</span> : null}
              <span className="muted">
                свои {money(g.own)} ₽ · доступно {money(g.available)} ₽ · счетов {g.rows.length}
                {g.rows.some((r) => r.is_funds) ? ` · фондов ${g.rows.filter((r) => r.is_funds).length}` : ''}
              </span>
            </div>
            <table className="grid">
              <thead>
                <tr>
                  <th>Счёт</th>
                  <th>Название</th>
                  <th>Тип</th>
                  <th>Свои</th>
                  <th>Доступно</th>
                  <th>Резерв</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((a) => (
                  <tr key={a.rs}>
                    <td className="mono" title={a.rs}>
                      {a.rs_masked}
                    </td>
                    <td>
                      <div>{a.name}</div>
                      {a.brand ? <div className="muted" style={{ fontSize: 12 }}>{a.brand}</div> : null}
                      {a.card_name ? <div className="muted" style={{ fontSize: 12 }}>{a.card_name}</div> : null}
                    </td>
                    <td>{a.is_funds ? 'Фонд' : 'Расчётный'}</td>
                    <td className="mono">{money(a.own)}</td>
                    <td className="mono">{money(a.available)}</td>
                    <td className="mono">{money(a.reserve)}</td>
                    <td>{a.status === 'Enabled' ? 'Открыт' : a.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      ) : !q.isLoading ? (
        <p className="muted">Счетов нет или токен без ReadAccounts</p>
      ) : null}

      <h3 className="form-section-title">На подпись (подвешенные) — по ИП</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        {data?.sign_hint
          || 'Статус «На подпись» значит платёж создан и ждёт подтверждения в Точке. Подписать из Учёта нельзя — только в приложении / интернет-банке.'}
      </p>

      {forSignItems.length ? (
        <>
          <div
            className="form-grid"
            style={{ maxWidth: 920, marginBottom: 10, gridTemplateColumns: '1.2fr 1.4fr auto auto' }}
          >
            <label>
              Поиск контрагента
              <input
                type="search"
                value={counterpartyQuery}
                placeholder="Рубцов / ФНС…"
                onChange={(e) => setCounterpartyQuery(e.target.value)}
              />
            </label>
            <label>
              Контрагент (получатель)
              <select
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
              >
                <option value="">
                  Все ({forSignItems.length} шт., {money(totalForSignSum)} ₽)
                </option>
                {counterpartiesFiltered.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name} — {c.count} шт. — {money(c.sum)} ₽
                  </option>
                ))}
              </select>
            </label>
            <div>
              <div className="muted">Сумма по фильтру</div>
              <div style={{ fontSize: 20, fontWeight: 700 }} className="mono">
                {money(filteredSum)} ₽
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {filteredForSignItems.length} из {forSignItems.length} шт.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              {counterparty ? (
                <button type="button" onClick={() => { setCounterparty(''); setCounterpartyQuery(''); }}>
                  Сбросить
                </button>
              ) : null}
            </div>
          </div>

          {selectedCounterparty ? (
            <p style={{ marginTop: 0 }}>
              Получатель: <strong>{selectedCounterparty.name}</strong>
              {' · '}
              <span className="mono" style={{ fontWeight: 700 }}>{money(selectedCounterparty.sum)} ₽</span>
              {' · '}
              {selectedCounterparty.count} плат.
            </p>
          ) : null}

          <h4 className="form-section-title" style={{ marginTop: 8 }}>Сводка по получателям</h4>
          <table className="grid" style={{ maxWidth: 920, marginBottom: 16 }}>
            <thead>
              <tr>
                <th>Контрагент (получатель)</th>
                <th>Платежей</th>
                <th>Сумма</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {counterpartiesFiltered.map((c) => (
                <tr
                  key={c.key}
                  style={counterparty === c.key ? { background: 'rgba(37, 99, 235, 0.08)' } : undefined}
                >
                  <td>
                    <button
                      type="button"
                      style={{ padding: 0, border: 0, background: 'none', color: 'var(--taxi-blue)', cursor: 'pointer', textAlign: 'left' }}
                      onClick={() => { setCounterparty(c.key); setCounterpartyQuery(''); }}
                    >
                      {c.name}
                    </button>
                    {c.variants.size > 1 ? (
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        склеено написаний: {c.variants.size}
                      </div>
                    ) : null}
                  </td>
                  <td className="mono">{c.count}</td>
                  <td className="mono" style={{ fontWeight: 700 }}>{money(c.sum)} ₽</td>
                  <td>
                    {counterparty === c.key ? (
                      <button type="button" onClick={() => setCounterparty('')}>Снять</button>
                    ) : (
                      <button type="button" onClick={() => { setCounterparty(c.key); setCounterpartyQuery(''); }}>
                        Фильтр
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>{counterparty ? 'По фильтру' : 'Итого'}</strong></td>
                <td className="mono"><strong>{filteredForSignItems.length}</strong></td>
                <td className="mono"><strong>{money(filteredSum)} ₽</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </>
      ) : null}

      {forSign?.hint ? <p className="muted">{forSign.hint}</p> : null}
      {forSign?.error && !forSign.hint ? <p className="muted">{forSign.error}</p> : null}
      {forSign?.ok && forSignByIp.length ? (
        forSignByIp.map((g) => (
          <div key={g.label} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', marginBottom: 6 }}>
              <strong>{g.label}</strong>
              {g.inn ? <span className="muted mono">ИНН {g.inn}</span> : null}
              <span className="muted">
                {g.items.length} шт. · {money(g.sum)} ₽
              </span>
            </div>
            <table className="grid">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Дата</th>
                  <th>Сумма</th>
                  <th>Получатель</th>
                  <th>Назначение</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((it, i) => (
                  <tr key={`${it.customer_code}-${it.id}-${i}`}>
                    <td className="mono">{String(it.payment_number || it.id || '—')}</td>
                    <td className="mono">{String(it.payment_date || '—')}</td>
                    <td className="mono">
                      {it.amount != null ? money(Number(it.amount)) : '—'} {String(it.currency || '')}
                    </td>
                    <td>
                      <button
                        type="button"
                        style={{ padding: 0, border: 0, background: 'none', color: 'var(--taxi-blue)', cursor: 'pointer', textAlign: 'left' }}
                        title="Фильтр по этому контрагенту"
                        onClick={() => {
                          setCounterparty(recipientKey(it.recipient));
                          setCounterpartyQuery('');
                        }}
                      >
                        {formatRecipientLabel(it.recipient)}
                      </button>
                    </td>
                    <td>{String(it.purpose || '—')}</td>
                    <td>{String(it.status || 'На подпись')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      ) : forSign?.ok ? (
        <p className="muted">
          {counterparty ? 'Нет платежей по выбранному контрагенту' : 'Нет платежей в «На подпись»'}
        </p>
      ) : null}

      <h3 className="form-section-title">Последние операции (webhook)</h3>
      {operations.length ? (
        <table className="grid">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Сумма</th>
              <th>Плательщик</th>
              <th>Р/с</th>
              <th>Назначение</th>
            </tr>
          </thead>
          <tbody>
            {operations.map((op) => (
              <tr key={op.id}>
                <td className="mono">{String(op.date || '').replace('T', ' ').slice(0, 19)}</td>
                <td className="mono">{money(op.amount)}</td>
                <td>{op.payer || '—'}</td>
                <td className="mono" title={op.account}>
                  {op.account ? `…${op.account.slice(-4)}` : '—'}
                </td>
                <td>{op.purpose || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : !q.isLoading ? (
        <p className="muted">Операций в логе пока нет</p>
      ) : null}
    </Page>
  );
}
