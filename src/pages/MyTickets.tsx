import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bot, CheckCircle2, CircleDashed, Clock, LifeBuoy, Loader2, MessageSquare, PlusCircle, RotateCcw, ShieldCheck, Wrench, XCircle } from 'lucide-react';
import { useStore } from '../app/store';
import { DEMO_EMPLOYEE, ISSUE_LABEL } from '../domain/catalog';
import { currentDiagnosis, gatesFor } from '../domain/engine';
import { employeeStatus, productStatus, METHOD_LABEL } from '../domain/lifecycle';
import { flowFor } from '../domain/troubleshooting';
import type { AppState, Ticket } from '../domain/types';
import { Empty, Modal, fmtShort } from '../components/ui';
import { NotFoundPage } from './NotFound';

const STEPS = ['Troubleshooting in progress', 'Sent to IT support', 'IT reviewing your issue', 'Fix in progress', 'Resolved'];
function stepIndex(t: Ticket) {
  const s = employeeStatus(t);
  if (s.startsWith('Fix in progress')) return 3;
  return Math.max(0, STEPS.indexOf(s));
}
/** Latest employee-facing update for a ticket (notifications to the employee, else the last status change). */
export function latestUpdate(s: AppState, t: Ticket) {
  const n = s.notifications.filter((x) => x.ticketId === t.id && x.recipient === 'EMPLOYEE').slice(-1)[0];
  if (n) return { text: n.message.replace(`${t.displayId}: `, ''), at: n.at };
  if (t.status === 'SELF_SERVICE') return { text: 'Answer the AI assistant’s next question to continue', at: t.updatedAt };
  return { text: employeeStatus(t), at: t.updatedAt };
}

export function MyTicketsPage() {
  const state = useStore((s) => s.state);
  const nav = useNavigate();
  const mine = useMemo(() => Object.values(state.tickets).filter((t) => t.employeeId === DEMO_EMPLOYEE.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [state.tickets]);
  return (
    <div>
      <div className="page-head"><div><h1>My tickets</h1><p>Hi {DEMO_EMPLOYEE.name.split(' ')[0]} — here’s everything you’ve reported and where it stands.</p></div><Link className="btn btn-primary" to="/raise"><PlusCircle size={16} aria-hidden />Raise a ticket</Link></div>
      {mine.length === 0 ? <div className="card"><Empty title="You have no tickets yet"><Link className="btn btn-primary" to="/raise">Raise a ticket</Link></Empty></div> : (
        <div className="table-wrap"><table className="data" data-testid="my-tickets">
          <thead><tr><th>Ticket</th><th>Issue</th><th>Created</th><th>Status</th><th>Latest update</th><th>Resolution</th></tr></thead>
          <tbody>{mine.map((t) => { const u = latestUpdate(state, t); return (
            <tr key={t.id} className="clickable" onClick={() => nav(`/my-tickets/${t.id}`)}>
              <td><Link to={`/my-tickets/${t.id}`} onClick={(e) => e.stopPropagation()}><strong>{t.displayId}</strong></Link></td>
              <td>{t.title}<div className="small muted">{ISSUE_LABEL[t.issueType]}</div></td>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtShort(t.createdAt)}</td>
              <td><span className={`badge ${t.status === 'CLOSED' ? 'b-success' : t.status === 'SELF_SERVICE' || t.status === 'AWAITING_CONSENT' ? 'b-accent' : 'b-neutral'}`} data-emp-status={employeeStatus(t)}>{employeeStatus(t)}</span></td>
              <td className="small">{u.text}<div className="muted">{fmtShort(u.at)}</div></td>
              <td className="small">{t.status === 'CLOSED' && t.path ? METHOD_LABEL[t.path] : '—'}</td>
            </tr>); })}</tbody>
        </table></div>
      )}
    </div>
  );
}

export function EmployeeTicketPage() {
  const { id } = useParams();
  const state = useStore((s) => s.state);
  const now = useStore((s) => s.now);
  const dispatch = useStore((s) => s.dispatch);
  const [reopen, setReopen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const t = id ? state.tickets[id] : undefined;
  if (!t || t.employeeId !== DEMO_EMPLOYEE.id) return <NotFoundPage />;
  const idx = stepIndex(t);
  const ts = t.troubleshooting;
  const k = ts.knowledgeId ? state.knowledge.find((x) => x.id === ts.knowledgeId) : undefined;
  const fl = flowFor(t.category, k);
  const node = ts.state === 'ACTIVE' && ts.current ? fl.nodes[ts.current] : undefined;
  const g = gatesFor(state, t.id, now);
  const rb = g.runbook;
  const d = currentDiagnosis(state, t);
  const exec = state.executions.filter((e) => e.ticketId === t.id).slice(-1)[0];
  const ps = productStatus(t);
  const act = (a: Parameters<typeof dispatch>[0]) => { if (busy) return; setBusy(true); dispatch(a); setTimeout(() => setBusy(false), 200); };
  const stepNo = ts.entries.length + 1;

  return (
    <div className="narrow">
      <div className="page-head"><div><div className="row"><h1>{t.displayId}</h1><span className="badge b-accent" data-testid="employee-status">{employeeStatus(t)}</span></div><p>{t.title} · reported {fmtShort(t.createdAt)}</p></div></div>
      <ol className="tracker" aria-label="Ticket progress">
        {STEPS.map((s, i) => <li key={s} className={i < idx ? 'done' : i === idx ? 'current' : ''}>{i < idx ? <CheckCircle2 size={16} aria-hidden /> : i === idx ? <CircleDashed size={16} aria-hidden /> : <Clock size={16} aria-hidden />}<span>{s}</span></li>)}
      </ol>

      {node && (
        <section className="card guide-card" aria-label="Guided troubleshooting" aria-live="polite">
          <div className="row-between"><span className="small muted"><Bot size={14} aria-hidden /> AI assistant · {node.kind === 'QUESTION' ? `Question ${stepNo}` : node.kind === 'STEP' ? `Try this (step ${stepNo})` : 'Check'}</span>{node.source && <span className="badge b-outline">Fix that worked for a similar issue</span>}</div>
          <h2 className="guide-q" data-testid="ts-prompt">{node.text}</h2>
          {node.help && <p className="small muted">{node.help}</p>}
          <div className="row answers">
            {node.options.map((o) => <button key={o.answer} className={`btn ${o.answer === 'RESOLVED' ? 'btn-primary' : ''}`} disabled={busy} data-answer={o.answer} onClick={() => act({ type: 'TS_ANSWER', ticketId: t.id, answer: o.answer })}>{o.label}</button>)}
          </div>
          <div className="row-between" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <span className="small muted">Only safe steps you can do yourself. Nothing is changed on your laptop automatically.</span>
            <button className="btn btn-sm" data-testid="get-help" disabled={busy} onClick={() => act({ type: 'TS_ESCALATE', ticketId: t.id })}><LifeBuoy size={14} aria-hidden />Get help from IT</button>
          </div>
        </section>
      )}

      {t.status === 'AWAITING_CONSENT' && rb && (
        <section className="card consent-card" aria-label="Your OK is needed">
          <h2><ShieldCheck size={18} aria-hidden />IT would like to fix your laptop</h2>
          <dl className="kv">
            <dt>What we’ll do</dt><dd>{rb.title}</dd>
            <dt>Why</dt><dd>{d?.rootCause}</dd>
            <dt>How long</dt><dd>About {rb.expectedMin} minutes</dd>
            <dt>What you’ll notice</dt><dd>{rb.employeeImpact}</dd>
            <dt>Restart needed</dt><dd>{rb.restartRequired ? 'Yes — please save your work first' : 'No'}</dd>
          </dl>
          <div className="row"><button className="btn btn-primary" data-testid="consent-yes" disabled={busy} onClick={() => act({ type: 'CONSENT', ticketId: t.id, grant: true })}>Go ahead now</button><button className="btn" data-testid="consent-no" disabled={busy} onClick={() => act({ type: 'CONSENT', ticketId: t.id, grant: false })}>Not now</button></div>
          <p className="small muted" style={{ margin: 0 }}>An IT administrator already approved this fix. It only starts with your OK.</p>
        </section>
      )}

      {ps === 'REMEDIATION' && t.status !== 'AWAITING_CONSENT' && (
        <section className="card" aria-label="Fix in progress"><h2><Loader2 size={18} className="spin-slow" aria-hidden />Fix in progress</h2>
          <p>{rb?.title ?? 'IT is applying a fix'} — approved by IT. We’ll check that it worked before closing your ticket.</p>
          {exec && <ul className="clean small">{exec.results.map((r, i) => <li key={i}><CheckCircle2 size={14} color="var(--success)" aria-hidden />{r.replace(/^S\d · /, '').replace(/ — done.*$/, '')}</li>)}</ul>}
        </section>
      )}

      {(ps === 'REVIEW_NEEDED' || ps === 'UNSUPPORTED' || ps === 'MANUAL' || ps === 'REOPENED' || ps === 'OPEN') && (
        <section className="card" aria-label="With IT support"><h2><Wrench size={18} aria-hidden />{employeeStatus(t)}</h2>
          <p>IT can see your answers and everything you already tried{ts.entries.filter((e) => e.kind === 'STEP').length ? ` (${ts.entries.filter((e) => e.kind === 'STEP').length} steps)` : ''} — you won’t need to repeat them.</p>
          {ts.escalationReason && <p className="small muted">Why it was sent to IT: {ts.escalationReason}</p>}
        </section>
      )}

      {t.status === 'CLOSED' && (
        <section className="card resolved-card" aria-label="Resolved"><h2><CheckCircle2 size={18} aria-hidden />Resolved</h2>
          <dl className="kv"><dt>How it was fixed</dt><dd>{t.path ? METHOD_LABEL[t.path] : '—'}</dd>{t.resolution && <><dt>What fixed it</dt><dd>{t.resolution.steps}</dd></>}<dt>Closed</dt><dd>{fmtShort(t.closedAt)}</dd></dl>
          <div className="row"><button className="btn" data-testid="reopen" onClick={() => { setReason(''); setReopen(true); }}><RotateCcw size={14} aria-hidden />It’s still not working — reopen</button></div>
        </section>
      )}

      {ts.entries.length > 0 && (
        <section className="card" aria-label="Your troubleshooting history">
          <h3><MessageSquare size={16} aria-hidden /> What you’ve done so far</h3>
          <ol className="history">{ts.entries.map((e, i) => <li key={i}><span className="small muted">{e.kind === 'QUESTION' ? 'Q' : e.kind === 'STEP' ? 'Step' : 'Check'}</span><span>{e.text}</span><span className={`badge ${e.answer === 'RESOLVED' || e.answer === 'COMPLETED' ? 'b-success' : e.answer === 'PERSISTS' || e.answer === 'UNABLE' ? 'b-danger' : 'b-neutral'}`}>{e.answerLabel}</span></li>)}</ol>
        </section>
      )}
      <section className="card" aria-label="Updates"><h3>Updates</h3>
        <ul className="clean small">{state.notifications.filter((n) => n.ticketId === t.id && n.recipient === 'EMPLOYEE').slice().reverse().map((n) => <li key={n.id}><Clock size={14} aria-hidden /><span>{n.message.replace(`${t.displayId}: `, '')} <span className="muted">· {fmtShort(n.at)}</span></span></li>)}
          <li><Clock size={14} aria-hidden /><span>Ticket created <span className="muted">· {fmtShort(t.createdAt)}</span></span></li></ul>
        {exec?.phase === 'FAILED' && <p className="small" style={{ marginTop: 8 }}><XCircle size={14} color="var(--danger)" aria-hidden /> The automated fix didn’t work — IT is following up.</p>}
      </section>
      <p><Link to="/my-tickets">← Back to my tickets</Link></p>

      {reopen && (
        <Modal title="Reopen this ticket" onClose={() => setReopen(false)} footer={<><button className="btn" onClick={() => setReopen(false)}>Cancel</button><button className="btn btn-primary" data-testid="confirm-reopen" disabled={reason.trim().length < 3} onClick={() => { const r = dispatch({ type: 'REOPEN', ticketId: t.id, reason }); if (r.ok) setReopen(false); }}>Reopen ticket</button></>}>
          <label className="field">What’s still wrong? *<textarea data-autofocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. It came back after lunch" /></label>
          <p className="small muted">The same ticket goes back to IT with its full history.</p>
        </Modal>
      )}
    </div>
  );
}

