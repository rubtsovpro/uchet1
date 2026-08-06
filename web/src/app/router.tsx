import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '@/features/auth/LoginPage';
import { ShellLayout } from '@/features/shell/ShellLayout';
import { HomePage } from '@/features/home/HomePage';
import { OrgProfilePage } from '@/features/org/OrgProfilePage';
import { SalesDocsPage } from '@/features/sales/SalesDocsPage';
import { SalesDocPage } from '@/features/sales/SalesDocPage';
import { DealsPage } from '@/features/crm/DealsPage';
import { DealPage } from '@/features/crm/DealPage';
import { MoneyTochkaPage } from '@/features/money/MoneyTochkaPage';
import { ChatsPage } from '@/features/chats/ChatsPage';

function SectionHub() {
  return (
    <div className="app" style={{ padding: 16 }}>
      <p className="muted">Выберите пункт в панели раздела выше.</p>
    </div>
  );
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ShellLayout />}>
        <Route index element={<HomePage />} />
        <Route path="crm" element={<SectionHub />} />
        <Route path="crm/deals" element={<DealsPage />} />
        <Route path="crm/deals/:id" element={<DealPage />} />
        <Route path="sales" element={<SectionHub />} />
        <Route path="sales/invoices" element={<SalesDocsPage type="invoice" />} />
        <Route path="sales/upd" element={<SalesDocsPage type="upd" />} />
        <Route path="sales/sf" element={<SalesDocsPage type="sf" />} />
        <Route path="sales/workorders" element={<SalesDocsPage type="workorder" />} />
        <Route path="sales/doc/:id" element={<SalesDocPage />} />
        <Route path="company" element={<SectionHub />} />
        <Route path="company/org" element={<OrgProfilePage />} />
        <Route path="money/tochka" element={<MoneyTochkaPage />} />
        <Route path="chats" element={<ChatsPage />} />
        {/* /money — классическое меню Денег (legacy); Точка остаётся на /money/tochka */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
