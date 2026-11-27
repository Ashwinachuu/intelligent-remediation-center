import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BookOpen, CheckSquare, ChevronRight, FlaskConical, Gauge, Lightbulb, ListChecks, Menu, Plus, ScrollText, ShieldCheck, SlidersHorizontal, X, AlertTriangle, Info, RotateCcw } from 'lucide-react';
import { useStore } from './store';
import { useUi } from './ui-store';
import { TicketCreator } from '../components/TicketCreator';
import { Modal, fmtShort } from '../components/ui';
import { SCENARIOS, ACTORS } from '../domain/catalog';
import type { Role } from '../domain/types';
import { loadScenario } from './scenarios';

const NAV = [
  { to: '/overview', label: 'Overview', Icon: Gauge },
  { to: '/incidents', label: 'Incidents', Icon: ListChecks },
  { to: '/approvals', label: 'Approvals', Icon: CheckSquare },
  { to: '/library', label: 'Runbook library', Icon: BookOpen },
  { to: '/opportunities', label: 'Opportunities', Icon: Lightbulb },
  { to: '/policies', label: 'Policies', Icon: SlidersHorizontal },
  { to: '/audit', label: 'Audit log', Icon: ScrollText },
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
  const { creatorOpen, openCreator } = useUi();
  const [drawer, setDrawer] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const role = state.settings.role;

  // Persistent job runner: process due work on mount and on a periodic tick (resumes from persisted timestamps).
  useEffect(() => { tick(); const h = setInterval(tick, 250); return () => clearInterval(h); }, [tick]);
  useEffect(() => { setDrawer(false); setNotifOpen(false); setDemoOpen(false); window.scrollTo?.(0, 0); }, [loc.pathname]);
  const notifRef = useOutsideClose(notifOpen, () => setNotifOpen(false));
  const demoRef = useOutsideClose(demoOpen, () => setDemoOpen(false));

  const pendingApprovals = useMemo(() => Object.values(state.tickets).filter((t) => t.status === 'AWAITING_APPROVAL').length, [state.tickets]);
  const notifications = useMemo(() => [...state.notifications].reverse().slice(0, 30), [state.notifications]);
  const unread = state.notifications.filter((n) => !n.read).length;

  const crumbs = useMemo(() => {
    const parts = loc.pathname.split('/').filter(Boolean);
    const out: { label: string; to?: string }[] = [];
    const top = NAV.find((n) => n.to === `/${parts[0]}`);
    if (top) out.push({ label: top.label, to: parts.length > 1 ? top.to : undefined });
    if (parts[0] === 'incidents' && parts[1]) out.push({ label: state.tickets[parts[1]]?.displayId ?? 'Unknown incident' });
    if (parts[0] === 'library' && parts[1]) out.push({ label: parts[1] });
    if (!top) out.push({ label: 'Not found' });
    return out;
  }, [loc.pathname, state.tickets]);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="demo-banner" role="note"><strong>Demo mode · simulated AI and endpoint actions</strong><span>Fictional data · state stored only in this browser — a shared URL does not share your changes</span></div>
      <div className="shell">
        <div className={`drawer-backdrop${drawer ? ' open' : ''}`} onClick={() => setDrawer(false)} aria-hidden />
        <aside className={`sidebar${drawer ? ' open' : ''}`}>
          <div className="brand">
            <div className="brand-mark"><ShieldCheck size={18} aria-hidden /></div>
            <div><div className="brand-name">Intelligent Remediation Center</div><div className="brand-tag">Resolve faster. Stay in control.</div></div>
            <button className="btn btn-ghost btn-sm menu-btn" onClick={() => setDrawer(false)} aria-label="Close navigation"><X size={16} /></button>
          </div>
          <nav className="nav" aria-label="Primary">
            {NAV.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to}><Icon size={16} aria-hidden />{label}{to === '/approvals' && pendingApprovals > 0 && <span className="badge count-badge" aria-label={`${pendingApprovals} pending`}>{pendingApprovals}</span>}</NavLink>
            ))}
          </nav>
          <div className="sidebar-foot">Independent concept inspired by ITSM workflows. Not an official Freshworks product. Simulated roles are not a security boundary.</div>
        </aside>
        <div className="main">
          <header className="topbar">
            <button className="btn btn-ghost btn-sm menu-btn" onClick={() => setDrawer(true)} aria-label="Open navigation"><Menu size={18} /></button>
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <Link to="/overview">Home</Link>
              {crumbs.map((c, i) => <span key={i} className="row" style={{ gap: 6 }}><ChevronRight size={14} aria-hidden />{c.to ? <Link to={c.to}>{c.label}</Link> : <span className="current" aria-current="page">{c.label}</span>}</span>)}
            </nav>
            <div className="topbar-actions">
              <button className="btn btn-primary" onClick={() => openCreator()} disabled={role === 'MANAGER'} title={role === 'MANAGER' ? 'Manager role is read-only' : undefined} data-testid="create-ticket" aria-label="Create ticket"><Plus size={16} aria-hidden /><span className="hide-sm">Create ticket</span></button>
              <label className="sr-only" htmlFor="role-select">Simulated role</label>
              <select id="role-select" value={role} onChange={(e) => dispatch({ type: 'SET_ROLE', role: e.target.value as Role })} style={{ width: 'auto' }} title="Simulated role (not a security boundary)">
                <option value="AGENT">Agent · {ACTORS.AGENT}</option>
                <option value="ADMIN">Admin · {ACTORS.ADMIN}</option>
                <option value="MANAGER">Manager · {ACTORS.MANAGER}</option>
              </select>
              <div className="rel" ref={notifRef}>
                <button className="btn icon-btn" aria-label={`Notifications, ${unread} unread`} aria-expanded={notifOpen} onClick={() => setNotifOpen((o) => !o)}><Bell size={16} />{unread > 0 && <span className="dot">{unread > 99 ? '99+' : unread}</span>}</button>
                {notifOpen && (
                  <div className="popover" role="dialog" aria-label="Notifications">
                    <div className="popover-head"><strong>Simulated notifications</strong><button className="btn btn-sm" onClick={() => dispatch({ type: 'MARK_NOTIFICATIONS_READ' })} disabled={!unread}>Mark all read</button></div>
                    {notifications.length === 0 ? <p className="muted" style={{ padding: 12 }}>No notifications.</p> : (
                      <ul>{notifications.map((n) => (
                        <li key={n.id} className={n.read ? '' : 'unread'}>
                          {n.ticketId ? <Link to={`/incidents/${n.ticketId}`}><div className="small muted">To {n.recipient.toLowerCase()} · {fmtShort(n.at)}</div>{n.message}</Link> : <div style={{ padding: 12 }}>{n.message}</div>}
                        </li>))}</ul>
                    )}
                  </div>
                )}
              </div>
              <div className="rel" ref={demoRef}>
                <button className="btn" aria-expanded={demoOpen} onClick={() => setDemoOpen((o) => !o)}><FlaskConical size={16} aria-hidden /><span className="hide-sm">Demo</span></button>
                {demoOpen && (
                  <div className="popover" role="dialog" aria-label="Demo controls">
                    <div className="popover-head"><strong>Demo controls</strong></div>
                    <div style={{ padding: '8px 12px' }} className="small muted">Load a scenario to create a fresh ticket with its own fictional device. Busy/offline toggles and schedule advance live on each ticket. No control forces resolution.</div>
                    <ul>
                      {SCENARIOS.map((s) => (
                        <li key={s.key}><button className="item" disabled={role === 'MANAGER'} onClick={() => { const id = loadScenario(s.key); setDemoOpen(false); if (id) nav(`/incidents/${id}`); }}><div style={{ fontWeight: 600 }}>{s.label}</div><div className="small muted">{s.expected}</div></button></li>
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
            {storageError && <div className="banner danger" role="alert"><AlertTriangle size={18} aria-hidden /><div className="grow">Could not persist state to browser storage ({storageError}). Reset the demo to free space.</div></div>}
            {role === 'MANAGER' && <div className="banner" role="status"><Info size={18} aria-hidden /><div className="grow">Manager view is read-only: ticket, approval, policy and library actions are disabled.</div></div>}
            <Outlet />
          </main>
        </div>
      </div>
      {creatorOpen && <TicketCreator />}
      {confirmReset && (
        <Modal title="Reset demo data?" onClose={() => setConfirmReset(false)} footer={<><button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button><button className="btn btn-danger-solid" onClick={() => { useStore.getState().reset(); setConfirmReset(false); nav('/overview'); }}>Reset demo</button></>}>
          <p>This is an explicit destructive action: all tickets, executions, policy versions and audit events in this browser are replaced with freshly generated synthetic data relative to now.</p>
          <p className="muted">This is not routine audit deletion — the audit log has no delete or edit actions.</p>
        </Modal>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}><span>{t.text}</span><button onClick={() => useStore.getState().dismissToast(t.id)} aria-label="Dismiss"><X size={14} /></button></div>)}
      </div>
    </>
  );
}
