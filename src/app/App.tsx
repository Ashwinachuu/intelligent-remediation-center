import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './Shell';
import { OverviewPage } from '../pages/Overview';
import { IncidentsPage } from '../pages/Incidents';
import { IncidentDetailPage } from '../pages/IncidentDetail';
import { ApprovalsPage } from '../pages/Approvals';
import { LibraryPage, RunbookDetailPage } from '../pages/Library';
import { OpportunitiesPage } from '../pages/Opportunities';
import { PoliciesPage } from '../pages/Policies';
import { AuditPage } from '../pages/Audit';
import { NotFoundPage } from '../pages/NotFound';
import { GuidePage } from '../pages/Guide';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/incidents" element={<IncidentsPage />} />
        <Route path="/incidents/:id" element={<IncidentDetailPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/library/:id" element={<RunbookDetailPage />} />
        <Route path="/opportunities" element={<OpportunitiesPage />} />
        <Route path="/policies" element={<PoliciesPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
export function App() {
  return <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AppRoutes /></HashRouter>;
}
