import { Link } from 'react-router-dom';
import { Page } from '@/shared/ui/Page';

/** Балансы Точки временно скрыты из меню; API и СБП на сделках работают как раньше. */
export function MoneyTochkaPage() {
  return (
    <Page title="Точка банк">
      <p className="muted" style={{ marginBottom: 12 }}>
        Экран балансов и счетов Точки пока скрыт. Оплаты по ссылке / СБП на сделках не затронуты.
        Настройки моста — в «Настройки → Точка Банк».
      </p>
      <p style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link to="/money">К разделу «Деньги»</Link>
        <a href="/legacy.html#/settings-tochka">Настройки Точка Банк</a>
        <a href="/legacy.html#/kassa">Касса</a>
      </p>
    </Page>
  );
}
