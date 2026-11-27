import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, CircleAlert, Hand, ListChecks, Lock, PlayCircle, Search, ShieldCheck, Undo2, Wrench, Zap } from 'lucide-react';
import { useStore } from '../app/store';
import { loadScenario } from '../app/scenarios';
import { EXAMPLES, EXAMPLE_GROUPS } from '../domain/examples';
import { StatusBadge } from '../components/ui';

const FLOW = [
  { Icon: Search, t: 'Detect', d: 'Employee report or proactive detection' },
  { Icon: ListChecks, t: 'Diagnose', d: 'Match telemetry to a known pattern; score how sure we are' },
  { Icon: ShieldCheck, t: 'Decide', d: 'One policy rule picks the route: fix, review or escalate' },
  { Icon: Hand, t: 'Authorize', d: 'Agent / admin approves (or policy, if trusted); employee consents if disruptive' },
  { Icon: Zap, t: 'Run', d: 'Preflight checks, then small steps; risky steps pause for approval' },
  { Icon: CheckCircle2, t: 'Verify', d: 'Re-measure. Only a passed check resolves the ticket' },
  { Icon: Undo2, t: 'Close or recover', d: 'Close · roll back · escalate to a human' },
];

/** Plain-language explanation of the model and every path through it, linked to real example tickets. */
export function GuidePage() {
  const state = useStore((s) => s.state);
  const nav = useNavigate();
  const byExample = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of Object.values(state.tickets)) if (t.example && !m.has(t.example)) m.set(t.example, t.id);
    return m;
  }, [state.tickets]);
  const ro = state.settings.role === 'MANAGER';
  const p = state.policy;
  const past = Object.values(state.tickets).filter((t) => t.example);
  const live = Object.values(state.tickets).filter((t) => t.demo);
  const count = (f: (t: (typeof past)[number]) => boolean) => past.filter(f).length;

  return (
    <div className="guide">
      <div className="page-head"><div><h1>How it works</h1><p>The whole product in one page: a single flow, three safety rules, and every path — good and bad — with a real example you can open.</p></div></div>

      <section className="card stack">
        <h2>The problem, simply</h2>
        <ul className="clean">
          <li><Wrench size={16} aria-hidden />Many laptop incidents (disk full, DNS, Wi-Fi, stuck service) have a known, repeatable fix — but an agent still diagnoses, approves and runs each one by hand.</li>
          <li><Lock size={16} aria-hidden />Teams won’t delegate fixes to automation unless they can see the evidence, control who approves, and undo mistakes.</li>
          <li><CircleAlert size={16} aria-hidden />So the goal is not “maximum automation” — it is <strong>safe automation where it is boring, and fast human help where it is not</strong>.</li>
        </ul>
      </section>

      <section className="card stack" aria-labelledby="h-flow">
        <h2 id="h-flow">One flow for every incident</h2>
        <ol className="flow">
          {FLOW.map((f, i) => <li key={f.t}><span className="flow-n">{i + 1}</span><f.Icon size={18} aria-hidden /><strong>{f.t}</strong><span className="small muted">{f.d}</span>{i < FLOW.length - 1 && <ArrowRight className="flow-arrow" size={16} aria-hidden />}</li>)}
        </ol>
      </section>

      <section className="grid grid-3" aria-label="Safety rules">
        <div className="card stack"><h3><ShieldCheck size={16} aria-hidden /> Rule 1 · Confidence ≠ permission</h3><p className="small">The score decides whether we <em>recommend</em> a fix. <strong>Risk</strong> decides who must approve it. A 99% score on a risky action still needs a human.</p></div>
        <div className="card stack"><h3><ListChecks size={16} aria-hidden /> Rule 2 · Check before every change</h3><p className="small">Device online, compatible, battery, consent, approval, window, rollback available, policy on. Any fail or pending item blocks the run — checked again right before each change.</p></div>
        <div className="card stack"><h3><CheckCircle2 size={16} aria-hidden /> Rule 3 · Nothing closes unverified</h3><p className="small">Running the fix is not success. Only a passed verification resolves a ticket; a failure offers rollback and goes to a human.</p></div>
      </section>

      <section className="card stack" aria-labelledby="h-who">
        <h2 id="h-who">Who decides (current policy v{p.version})</h2>
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Situation</th><th>Route</th><th>Who acts</th></tr></thead>
          <tbody>
            <tr><td>Score below {p.reviewThreshold} (we don’t know what it is)</td><td>Escalate</td><td>Agent investigates</td></tr>
            <tr><td>Score {p.reviewThreshold}–{p.approvalThreshold - 1}, or no approved runbook</td><td>Human review</td><td>Agent adds evidence or fixes manually</td></tr>
            <tr><td>Score ≥ {p.approvalThreshold}, LOW risk</td><td>Approve &amp; run</td><td>Agent one click — or <strong>nobody</strong> if preapproval is on ({p.autoEnabled ? 'on' : 'off'}) and the runbook is trusted (L3/L4)</td></tr>
            <tr><td>Score ≥ {p.approvalThreshold}, MEDIUM risk</td><td>Approve &amp; run</td><td>Agent + employee consent if disruptive</td></tr>
            <tr><td>Score ≥ {p.approvalThreshold}, HIGH risk</td><td>Approve, schedule, step approval</td><td>Admin only + window + consent; risky step approved separately</td></tr>
            <tr><td>Unmanaged / unsupported OS / blocked device group</td><td>Escalate</td><td>Agent — no approval can override</td></tr>
          </tbody>
        </table></div>
      </section>

      <section className="stack-16" aria-labelledby="h-paths">
        <div><h2 id="h-paths" style={{ marginBottom: 4 }}>Every path, with an example</h2>
          <p className="small muted">The demo data is intentionally small: <strong>{past.length}</strong> past incidents, one per path ({count((t) => t.status === 'CLOSED' && t.path === 'AUTO_POLICY')} fixed by policy, {count((t) => t.status === 'CLOSED' && t.path === 'HUMAN_APPROVED')} with one approval, {count((t) => t.status === 'CLOSED' && t.path === 'MANUAL')} fixed by a person, {count((t) => t.status !== 'CLOSED')} still open), plus <strong>{live.length}</strong> live demo tickets for today. Every number on the dashboard can be traced back to one of these.</p></div>
        {EXAMPLE_GROUPS.map((g) => (
          <div key={g} className="card" style={{ padding: 0 }}>
            <h3 style={{ padding: '12px 16px', margin: 0, borderBottom: '1px solid var(--border)' }}>{g}</h3>
            <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}><table className="data guide-table">
              <thead><tr><th>Path</th><th>What happens</th><th>What the system does</th><th>Result</th><th>See it</th></tr></thead>
              <tbody>{EXAMPLES.filter((e) => e.group === g).map((e) => { const id = byExample.get(e.key); const t = id ? state.tickets[id] : undefined; return (
                <tr key={e.key} data-example={e.key}>
                  <td><strong>{e.title}</strong></td>
                  <td className="small">{e.situation}</td>
                  <td className="small">{e.system}</td>
                  <td className="small">{e.outcome}</td>
                  <td className="small" style={{ minWidth: 170 }}>
                    {t && <div><Link to={`/incidents/${t.id}`}>{t.displayId}</Link> <StatusBadge status={t.status} /></div>}
                    {e.tryIt && <div style={{ marginTop: 4 }}>{e.tryIt.scenario
                      ? <button className="btn btn-sm" disabled={ro} title={e.tryIt.how} onClick={() => {
                        // Scenario I is pre-seeded already paused at its risky step: open it rather than creating a new one.
                        const seeded = e.key === 'step-approval' ? Object.values(state.tickets).find((x) => x.scenario === 'I' && x.status === 'STEP_APPROVAL')?.id : undefined;
                        const go = seeded ?? loadScenario(e.tryIt!.scenario!);
                        if (go) nav(`/incidents/${go}`);
                      }}><PlayCircle size={14} aria-hidden />Try it ({e.tryIt.scenario})</button>
                      : <span className="muted">Try: {e.tryIt.how}</span>}
                      {e.tryIt.scenario && <div className="muted" style={{ marginTop: 2 }}>{e.tryIt.how}</div>}</div>}
                  </td>
                </tr>); })}</tbody>
            </table></div>
          </div>
        ))}
      </section>

      <section className="grid grid-2">
        <div className="card stack"><h2>What we kept simple on purpose</h2>
          <ul className="small">
            <li>One approved runbook per incident type, each with 3–4 small steps — no free-form commands.</li>
            <li>Rule-based, deterministic scores (labelled simulated) instead of a model — easy to explain and test.</li>
            <li>One policy function decides every route; the screens just show its answer.</li>
            <li>Trust grows per runbook (L0 manual → L4 proactive), one step at a time, only by an admin.</li>
            <li>Tiny dataset: one example per path, so every number can be explained in the room.</li>
            <li>Everything runs in the browser with fictional data — no integrations to set up.</li>
          </ul></div>
        <div className="card stack"><h2>How it would work for real</h2>
          <ul className="small">
            <li>Plug into the existing ticketing and device-management tools instead of replacing them.</li>
            <li>Keep the AI to diagnosis; keep policy, approvals and signed runbooks deterministic and server-enforced.</li>
            <li>Roll out in stages: suggest only → human-approved pilot → admin-trusted low-risk fixes → expand on evidence.</li>
            <li>Stop automatically on any unauthorized run, rising reopen rate or repeated rollback failures.</li>
            <li>Measure one thing first: verified fixes among eligible incidents, alongside coverage and safety guardrails.</li>
          </ul></div>
      </section>
    </div>
  );
}
