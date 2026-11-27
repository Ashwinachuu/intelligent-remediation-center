import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Bell, CheckSquare, ChevronRight, ClipboardList, FlaskConical, Gauge, LayoutList, Lightbulb, ListChecks, Menu, PlusCircle, RotateCcw, ScrollText, Settings2, ShieldCheck, X } from 'lucide-react';
import { useStore } from './store';
import { Modal, fmtShort } from '../components/ui';
import { DEMO_EMPLOYEE } from '../domain/catalog';
import type { Role } from '../domain/types';
import { DEMO_SCENARIOS, runScenario } from './scenarios';

const ADMIN_NAV = [
  { to: '/overview', label: 'Overview', Icon: Gauge },
  { to: '/workspace', label: 'My Workspace', Icon: LayoutList },
  { to: '/incidents', label: 'Incidents', Icon: ListChecks },
  { to: '/approvals', label: 'Approvals', Icon: CheckSquare },
  { to: '/opportunities', label: 'Opportunities', Icon: Lightbulb },
  { to: '/audit', label: 'Audit Logs', Icon: ScrollText },
  { to: '/settings', label: 'AI Settings', Icon: Settings2 },
];
const EMPLOYEE_NAV = [
  { to: '/raise', label: 'Raise a Ticket', Icon: PlusCircle },
  { to: '/my-tickets', label: 'My Tickets', Icon: ClipboardList },
];

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open, close]);
  return ref;
}

export function Shell() {
  const state = useStore((s) => s.state);
  const { warning, multiTab, storageError, toasts } = useStore();
  const tick = useStore((s) => s.tick);
  const dispatch = useStore((s) => s.dispatch);
  const [drawer, setDrawer] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const role = state.ui.role;
  const isAdmin = role === 'ADMIN';
  const NAV = isAdmin ? ADMIN_NAV : EMPLOYEE_NAV;

  // Persistent runner: processes due work on mount and on a periodic tick (resumes from persisted timestamps).
  useEffect(() => { tick(); const h = setInterval(tick, 250); return () => clearInterval(h); }, [tick]);
  useEffect(() => { setDrawer(false); setNotifOpen(false); setDemoOpen(false); window.scrollTo?.(0, 0); }, [loc.pathname]);
  const notifRef = useOutsideClose(notifOpen, () => setNotifOpen(false));
  const demoRef = useOutsideClose(demoOpen, () => setDemoOpen(false));

  const pending = useMemo(() => Object.values(state.tickets).filter((t) => t.status === 'AWAITING_APPROVAL').length, [state.tickets]);
  const myNotifs = useMemo(() => state.notifications.filter((n) => n.recipient === role && (isAdmin || !n.ticketId || state.tickets[n.ticketId]?.employeeId === DEMO_EMPLOYEE.id)), [state.notifications, state.tickets, role, isAdmin]);
  const notifications = [...myNotifs].reverse().slice(0, 30);
  const unread = myNotifs.filter((n) => !n.read).length;
  const switchRole = (r: Role) => { dispatch({ type: 'SET_ROLE', role: r }); nav(r === 'ADMIN' ? '/overview' : '/my-tickets'); };

  const crumbs = useMemo(() => {
    const parts = loc.pathname.split('/').filter(Boolean);
    const top = NAV.find((n) => n.to === `/${parts[0]}`);
    const out: { label: string; to?: string }[] = [];
    if (top) out.push({ label: top.label, to: parts.length > 1 ? top.to : undefined });
    if ((parts[0] === 'incidents' || parts[0] === 'my-tickets') && parts[1]) out.push({ label: state.tickets[parts[1]]?.displayId ?? 'Unknown ticket' });
    return out;
  }, [loc.pathname, state.tickets, NAV]);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="demo-banner" role="note"><strong>Demo mode · AI recommendations and laptop actions are simulated</strong><span>No real commands run on any device · fictional data stored only in this browser</span></div>
      <div className="shell">
        <div className={`drawer-backdrop${drawer ? ' open' : ''}`} onClick={() => setDrawer(false)} aria-hidden />
        <aside className={`sidebar${drawer ? ' open' : ''}`}>
          <div className="brand">
            <div className="brand-mark"><ShieldCheck size={18} aria-hidden /></div>
            <div><div className="brand-name">Intelligent Remediation Center</div><div className="brand-tag">{isAdmin ? 'IT Administrator portal' : 'Employee IT support'}</div></div>
            <button className="btn btn-ghost btn-sm menu-btn" onClick={() => setDrawer(false)} aria-label="Close navigation"><X size={16} /></button>
          </div>
          <nav className="nav" aria-label="Primary">
            {NAV.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} end={to === '/my-tickets' ? false : undefined}><Icon size={16} aria-hidden />{label}{to === '/approvals' && pending > 0 && <span className="badge count-badge" aria-label={`${pending} pending`}>{pending}</span>}</NavLink>
            ))}
          </nav>
        </aside>
        <div className="main">
          <header className="topbar">
            <button className="btn btn-ghost btn-sm menu-btn" onClick={() => setDrawer(true)} aria-label="Open navigation"><Menu size={18} /></button>
            {crumbs.length > 1 ? (
              <nav className="breadcrumb" aria-label="Breadcrumb">
                {crumbs.map((c, i) => <span key={i} className="row" style={{ gap: 6 }}>{i > 0 && <ChevronRight size={14} aria-hidden />}{c.to ? <Link to={c.to}>{c.label}</Link> : <span className="current" aria-current="page">{c.label}</span>}</span>)}
              </nav>
            ) : <span className="breadcrumb" aria-hidden />}
            <div className="topbar-actions">
              <div className="seg role-switch" role="group" aria-label="View as">
                <button aria-pressed={!isAdmin} data-testid="role-employee" onClick={() => switchRole('EMPLOYEE')}>Employee<span className="hide-sm"> · {DEMO_EMPLOYEE.name}</span></button>
                <button aria-pressed={isAdmin} data-testid="role-admin" onClick={() => switchRole('ADMIN')}>IT Admin</button>
              </div>
              <div className="rel" ref={notifRef}>
                <button className="btn icon-btn" aria-label={`Notifications, ${unread} unread`} aria-expanded={notifOpen} onClick={() => setNotifOpen((o) => !o)}><Bell size={16} />{unread > 0 && <span className="dot">{unread > 99 ? '99+' : unread}</span>}</button>
                {notifOpen && (
                  <div className="popover" role="dialog" aria-label="Notifications">
                    <div className="popover-head"><strong>Notifications</strong><button className="btn btn-sm" onClick={() => dispatch({ type: 'MARK_NOTIFICATIONS_READ' })} disabled={!unread}>Mark all read</button></div>
                    {notifications.length === 0 ? <p className="muted" style={{ padding: 12 }}>No notifications.</p> : (
                      <ul>{notifications.map((n) => (
                        <li key={n.id} className={n.read ? '' : 'unread'}>
                          {n.ticketId ? <Link to={isAdmin ? `/incidents/${n.ticketId}` : `/my-tickets/${n.ticketId}`}><div className="small muted">{fmtShort(n.at)}</div>{n.message}</Link> : <div style={{ padding: 12 }}>{n.message}</div>}
                        </li>))}</ul>
                    )}
                  </div>
                )}
              </div>
              <div className="rel" ref={demoRef}>
                <button className="btn" aria-expanded={demoOpen} onClick={() => setDemoOpen((o) => !o)} data-testid="demo-menu"><FlaskConical size={16} aria-hidden /><span className="hide-sm">Demo scenarios</span></button>
                {demoOpen && (
                  <div className="popover" role="dialog" aria-label="Demo scenarios">
                    <div className="popover-head"><strong>Demo scenarios</strong></div>
                    <div style={{ padding: '8px 12px' }} className="small muted">Each scenario creates a fresh ticket for {DEMO_EMPLOYEE.name} and opens it in the right portal. Outcomes are part of the scenario — there are no device toggles.</div>
                    <ul>
                      {DEMO_SCENARIOS.map((s) => (
                        <li key={s.key}><button className="item" data-testid={`scenario-${s.key}`} onClick={() => { setDemoOpen(false); const to = runScenario(s.key); if (to) nav(to); }}><div style={{ fontWeight: 600 }}>{s.key}. {s.title}</div><div className="small muted">{s.description}</div></button></li>
                      ))}
                      <li><button className="item" onClick={() => { setDemoOpen(false); setConfirmReset(true); }} style={{ color: 'var(--danger)', fontWeight: 600 }}><RotateCcw size={14} aria-hidden /> Reset demo data…</button></li>
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </header>
          <main id="main" className="content" tabIndex={-1}>
            {warning && <div className="banner warn" role="alert"><AlertTriangle size={18} aria-hidden /><div className="grow">{warning}</div><button className="btn btn-sm" onClick={() => useStore.getState().dismissWarning()}>Dismiss</button></div>}
            {multiTab && <div className="banner warn" role="status"><AlertTriangle size={18} aria-hidden /><div className="grow">This demo is open in another tab. One tab is recommended — changes from other tabs are not merged.</div><button className="btn btn-sm" onClick={() => useStore.getState().reloadFromStorage()}>Reload saved state</button></div>}
            {storageError && <div className="banner danger" role="alert"><AlertTriangle size={18} aria-hidden /><div className="grow">Could not save to browser storage ({storageError}). Reset the demo to free space.</div></div>}
            <Outlet />
          </main>
        </div>
      </div>
      {confirmReset && (
        <Modal title="Reset demo data?" onClose={() => setConfirmReset(false)} footer={<><button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button><button className="btn btn-danger-solid" onClick={() => { useStore.getState().reset(); setConfirmReset(false); nav(isAdmin ? '/overview' : '/my-tickets'); }}>Reset demo</button></>}>
          <p>All tickets, approvals, reusable resolutions, settings and audit events in this browser are replaced with freshly generated demo data.</p>
          <p className="muted">This is an explicit demo action — the audit log itself has no edit or delete actions.</p>
        </Modal>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}><span>{t.text}</span><button onClick={() => useStore.getState().dismissToast(t.id)} aria-label="Dismiss"><X size={14} /></button></div>)}
      </div>
    </>
  );
}
