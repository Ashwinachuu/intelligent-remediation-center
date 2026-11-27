import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, FilterX, ShieldQuestion } from 'lucide-react';
import { useStore } from '../app/store';
import { inRange } from '../domain/metrics';
import { INTERNAL_LABEL as STATUS_LABEL } from '../domain/lifecycle';
import type { AppState, AuditEvent } from '../domain/types';
import { Empty, Modal, ResultIcon, TZ, fmtTime } from '../components/ui';

/** Spreadsheet-injection protection: prefix cells starting with = + - @ with an apostrophe. */
export function csvCell(v: unknown): string {
  let s = v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function auditCsv(s: AppState, rows: AuditEvent[]): string {
  const head = ['seq', 'at_utc', 'ticket', 'actor', 'role', 'action', 'from', 'to', 'result', 'reason', 'metadata'];
  const lines = rows.map((e) => [e.seq, e.at, e.ticketId ? s.tickets[e.ticketId]?.displayId : '', e.actor, e.role, e.action, e.from ?? '', e.to ?? '', e.result, e.reason, e.metadata].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\n');
}

export function filterAudit(s: AppState, p: URLSearchParams) {
  const q = (p.get('q') ?? '').trim().toLowerCase();
  const actor = p.get('actor'), action = p.get('action'), result = p.get('result'), from = p.get('from'), to = p.get('to');
  return s.audit.filter((e) => {
    if (actor && e.actor !== actor) return false;
    if (action && e.action !== action) return false;
    if (result && e.result !== result) return false;
    if (from && !inRange(e.at, { from, to: to || from })) return false;
    if (q) { const t = e.ticketId ? s.tickets[e.ticketId] : undefined; if (!`${t?.displayId ?? ''} ${t?.title ?? ''} ${e.reason}`.toLowerCase().includes(q)) return false; }
    return true;
  }).sort((a, b) => b.seq - a.seq);
}

export function AuditPage() {
  const state = useStore((s) => s.state);
  const [p, setP] = useSearchParams();
  const rows = useMemo(() => filterAudit(state, p), [state, p]);
  const actors = useMemo(() => [...new Set(state.audit.map((e) => e.actor))].sort(), [state.audit]);
  const actions = useMemo(() => [...new Set(state.audit.map((e) => e.action))].sort(), [state.audit]);
  const page = Math.max(1, Number(p.get('page') ?? 1));
  const PAGE = 50;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice((Math.min(page, pages) - 1) * PAGE, Math.min(page, pages) * PAGE);
  const set = (k: string, v: string) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); if (k !== 'page' && k !== 'event') n.delete('page'); setP(n, { replace: true }); };
  const selected = p.get('event') ? state.audit.find((e) => e.id === p.get('event')) : undefined;
  const exportCsv = () => {
    const blob = new Blob([auditCsv(state, rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    useStore.getState().toast('success', `Exported ${rows.length} audit events`);
  };
  const execId = selected?.metadata.executionId as string | undefined;
  const exec = execId ? state.executions.find((e) => e.id === execId) : undefined;
  const diag = selected?.metadata.diagnosisId ? state.diagnoses.find((d) => d.id === selected.metadata.diagnosisId) : undefined;
  const ticket = selected?.ticketId ? state.tickets[selected.ticketId] : undefined;

  return (
    <div>
      <div className="page-head"><div><h1>Audit Logs</h1><p>Every ticket, troubleshooting answer, AI recommendation, approval, consent, execution, verification, rollback, resolution, knowledge and settings event — newest first. Read-only: no edit or delete. Stored in this browser, so inspectable but <strong>not tamper-proof</strong>.</p></div>
        <button className="btn" onClick={exportCsv} disabled={!rows.length}><Download size={14} aria-hidden />Export filtered CSV</button></div>
      <div className="filters" role="search">
        <label className="field wide">Search ticket / reason<input type="search" value={p.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} placeholder="INC-1001" /></label>
        <label className="field">Actor<select value={p.get('actor') ?? ''} onChange={(e) => set('actor', e.target.value)}><option value="">All</option>{actors.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="field">Action<select value={p.get('action') ?? ''} onChange={(e) => set('action', e.target.value)}><option value="">All</option>{actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ').toLowerCase()}</option>)}</select></label>
        <label className="field">Result<select value={p.get('result') ?? ''} onChange={(e) => set('result', e.target.value)}><option value="">All</option><option value="SUCCESS">Success</option><option value="FAILURE">Failure</option><option value="BLOCKED">Blocked</option><option value="INFO">Info</option></select></label>
        <label className="field">From<input type="date" value={p.get('from') ?? ''} onChange={(e) => set('from', e.target.value)} /></label>
        <label className="field">To<input type="date" value={p.get('to') ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
        <button className="btn" onClick={() => setP(new URLSearchParams(), { replace: true })}><FilterX size={14} aria-hidden />Clear filters</button>
      </div>
      <p className="small muted">{rows.length} events · times in {TZ}</p>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>#</th><th>Time</th><th>Ticket</th><th>Actor</th><th>Action</th><th>Transition</th><th>Result</th><th>Reason</th></tr></thead>
          <tbody>{view.map((e) => (
            <tr key={e.id} className="clickable" onClick={() => set('event', e.id)} tabIndex={0} onKeyDown={(k) => { if (k.key === 'Enter') set('event', e.id); }}>
              <td className="mono">{e.seq}</td><td style={{ whiteSpace: 'nowrap' }}>{fmtTime(e.at)}</td>
              <td>{e.ticketId ? <Link to={`/incidents/${e.ticketId}`} onClick={(x) => x.stopPropagation()}>{state.tickets[e.ticketId]?.displayId}</Link> : '—'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{e.actor} <span className="small muted">({e.role})</span></td>
              <td style={{ whiteSpace: 'nowrap' }}>{e.action.replace(/_/g, ' ').toLowerCase()}</td>
              <td className="small" style={{ whiteSpace: 'nowrap' }}>{e.from && e.to ? `${STATUS_LABEL[e.from]} → ${STATUS_LABEL[e.to]}` : e.to ? STATUS_LABEL[e.to] : '—'}</td>
              <td><span className="row" style={{ gap: 4 }}><ResultIcon result={e.result} />{e.result.toLowerCase()}</span></td>
              <td className="small" style={{ minWidth: 260 }}>{e.reason}</td>
            </tr>))}</tbody>
        </table>
        {!rows.length && <Empty title="No audit events match" icon={<ShieldQuestion size={28} aria-hidden />} />}
      </div>
      {rows.length > PAGE && <nav className="pager" aria-label="Pagination"><button className="btn btn-sm" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>Previous</button><span className="small">Page {Math.min(page, pages)} of {pages}</span><button className="btn btn-sm" disabled={page >= pages} onClick={() => set('page', String(page + 1))}>Next</button></nav>}
      {selected && (
        <Modal title={`Audit event #${selected.seq}`} wide onClose={() => set('event', '')}>
          <dl className="kv">
            <dt>Action</dt><dd>{selected.action}</dd><dt>When</dt><dd>{fmtTime(selected.at)} <span className="mono">({selected.at} UTC)</span></dd>
            <dt>Actor</dt><dd>{selected.actor} ({selected.role})</dd>
            <dt>Ticket</dt><dd>{ticket ? <Link to={`/incidents/${ticket.id}`}>{ticket.displayId} — {ticket.title}</Link> : '—'}</dd>
            <dt>Before → after</dt><dd>{selected.from ? STATUS_LABEL[selected.from] : '—'} → {selected.to ? STATUS_LABEL[selected.to] : '—'}</dd>
            <dt>Decision reason</dt><dd>{selected.reason}</dd>
            <dt>Result</dt><dd>{selected.result}</dd>
            <dt>AI settings (current)</dt><dd>v{state.settings.version} · confidence threshold {state.settings.confidenceThreshold}%</dd>
            {diag && <><dt>Diagnosis</dt><dd>rev {diag.revision} · score {diag.confidence} · {diag.risk} · plan <span className="mono">{diag.planHash}</span> · {diag.runbookId ? <Link to={`/library/${diag.runbookId}`}>{diag.runbookId} v{diag.runbookVersion}</Link> : 'no runbook'}<ul className="small">{diag.evidence.map((x, i) => <li key={i}>{x}</li>)}</ul></dd></>}
            {exec && <><dt>Execution</dt><dd>{exec.runbookId} v{exec.version} · {exec.phase.toLowerCase().replace('_', ' ')} · approved by {exec.approvedBy}<ul className="small">{[...exec.results, ...exec.verificationOutput, ...exec.rollbackResults].map((x, i) => <li key={i}>{x}</li>)}</ul></dd></>}
            {ticket?.consent && <><dt>Consent (current)</dt><dd>{ticket.consent.granted ? 'Granted' : 'Denied'} at {fmtTime(ticket.consent.at)}</dd></>}
          </dl>
          <h3>Metadata</h3>
          <pre className="json">{JSON.stringify(selected.metadata, null, 2)}</pre>
        </Modal>
      )}
    </div>
  );
}
