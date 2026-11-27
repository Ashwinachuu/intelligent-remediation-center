import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Laptop, Send, User } from 'lucide-react';
import { useStore } from '../app/store';
import { DEMO_EMPLOYEE, ISSUE_TYPES } from '../domain/catalog';
import type { IssueType } from '../domain/types';

/** Employee ticket creation (V1.2 §5): plain-language categories; employee and device are filled in automatically. */
export function RaiseTicketPage() {
  const dispatch = useStore((s) => s.dispatch);
  const nav = useNavigate();
  const [issueType, setIssueType] = useState<IssueType | ''>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const e = DEMO_EMPLOYEE;
  const errs = { type: !issueType ? 'Choose what the problem is about' : '', title: title.trim().length < 3 ? 'Add a short title (at least 3 characters)' : '', desc: description.trim().length < 3 ? 'Describe what is happening (at least 3 characters)' : '' };
  const valid = !errs.type && !errs.title && !errs.desc;
  const submit = () => {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    const r = dispatch({ type: 'CREATE_TICKET', input: { title, description, issueType: issueType as IssueType } });
    setBusy(false);
    if (r.ok && r.ticketId) nav(`/my-tickets/${r.ticketId}`);
  };
  return (
    <div className="narrow">
      <div className="page-head"><div><h1>Raise a ticket</h1><p>Tell us what’s wrong. Our AI assistant will try to help you fix it right away — and pass it to IT if it can’t.</p></div></div>
      <div className="card stack-16">
        <fieldset className="issue-grid" aria-describedby={touched && errs.type ? 'type-err' : undefined}>
          <legend className="field-label">What is the problem about? *</legend>
          {ISSUE_TYPES.map((it) => (
            <label key={it.key} className={`issue-option${issueType === it.key ? ' selected' : ''}`}>
              <input type="radio" name="issueType" value={it.key} checked={issueType === it.key} onChange={() => { setIssueType(it.key); if (!title.trim()) setTitle(it.label); }} />
              <span className="io-title">{it.label}</span><span className="io-hint">{it.hint}</span>
            </label>
          ))}
        </fieldset>
        {touched && errs.type && <span id="type-err" className="error-text small">{errs.type}</span>}
        <label className="field">Title *<input type="text" value={title} maxLength={120} onChange={(x) => setTitle(x.target.value)} placeholder="e.g. Wi-Fi keeps dropping" aria-invalid={touched && !!errs.title} />{touched && errs.title && <span className="error-text">{errs.title}</span>}</label>
        <label className="field">Describe what is happening *<textarea value={description} maxLength={1000} onChange={(x) => setDescription(x.target.value)} placeholder="When did it start? What were you doing?" aria-invalid={touched && !!errs.desc} />{touched && errs.desc && <span className="error-text">{errs.desc}</span>}</label>
        <div className="grid grid-2">
          <div className="info-box"><User size={16} aria-hidden /><div><div className="small muted">Your details (filled in automatically)</div><strong>{e.name}</strong><div className="small">{e.department} · {e.email}</div></div></div>
          <div className="info-box"><Laptop size={16} aria-hidden /><div><div className="small muted">Your laptop (detected automatically)</div><strong>{e.deviceName}</strong><div className="small">{e.os}</div></div></div>
        </div>
        <div className="row"><button className="btn btn-primary" onClick={submit} disabled={busy} data-testid="submit-ticket"><Send size={16} aria-hidden />Submit and get help</button><span className="small muted">You’ll get one ticket — the same one IT sees if they need to step in.</span></div>
      </div>
    </div>
  );
}
