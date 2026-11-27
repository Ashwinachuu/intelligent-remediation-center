import type { ReactNode } from 'react';
import { HashRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './Shell';
import { useStore } from './store';
import { OverviewPage } from '../pages/Overview';
import { WorkspacePage } from '../pages/Workspace';
import { IncidentsPage } from '../pages/Incidents';
import { IncidentDetailPage } from '../pages/IncidentDetail';
import { ApprovalsPage } from '../pages/Approvals';
import { OpportunitiesPage } from '../pages/Opportunities';
import { AuditPage } from '../pages/Audit';
import { AiSettingsPage } from '../pages/AiSettings';
import { RaiseTicketPage } from '../pages/RaiseTicket';
import { MyTicketsPage, EmployeeTicketPage } from '../pages/MyTickets';
import { NotFoundPage } from '../pages/NotFound';
import type { Role } from '../domain/types';

/** Friendly guard: each portal is only shown to its role (the role switcher is a demo control, not security). */
function Only({ role, children }: { role: Role; children: ReactNode }) {
  const current = useStore((s) => s.state.ui.role);
  const dispatch = useStore((s) => s.dispatch);
  if (current === role) return <>{children}</>;
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <h1>{role === 'ADMIN' ? 'IT administrator page' : 'Employee page'}</h1>
      <p className="muted" style={{ marginTop: 8 }}>You are viewing as {current === 'ADMIN' ? 'IT Administrator' : 'Employee'}. Switch role to open this page.</p>
      <div className="row"><button className="btn btn-primary" onClick={() => dispatch({ type: 'SET_ROLE', role })}>Switch to {role === 'ADMIN' ? 'IT Administrator' : 'Employee'}</button><Link className="btn" to={current === 'ADMIN' ? '/overview' : '/my-tickets'}>Go to my home page</Link></div>
    </div>
  );
}
function Home() {
  const role = useStore((s) => s.state.ui.role);
  return <Navigate to={role === 'ADMIN' ? '/overview' : '/my-tickets'} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="/overview" element={<Only role="ADMIN"><OverviewPage /></Only>} />
        <Route path="/workspace" element={<Only role="ADMIN"><WorkspacePage /></Only>} />
        <Route path="/incidents" element={<Only role="ADMIN"><IncidentsPage /></Only>} />
        <Route path="/incidents/:id" element={<Only role="ADMIN"><IncidentDetailPage /></Only>} />
        <Route path="/approvals" element={<Only role="ADMIN"><ApprovalsPage /></Only>} />
        <Route path="/opportunities" element={<Only role="ADMIN"><OpportunitiesPage /></Only>} />
        <Route path="/audit" element={<Only role="ADMIN"><AuditPage /></Only>} />
        <Route path="/settings" element={<Only role="ADMIN"><AiSettingsPage /></Only>} />
        <Route path="/raise" element={<Only role="EMPLOYEE"><RaiseTicketPage /></Only>} />
        <Route path="/my-tickets" element={<Only role="EMPLOYEE"><MyTicketsPage /></Only>} />
        <Route path="/my-tickets/:id" element={<Only role="EMPLOYEE"><EmployeeTicketPage /></Only>} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
export function App() {
  return <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AppRoutes /></HashRouter>;
}
