import { useEffect, useId, useRef, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Clock, Hand, Loader2, MessageCircleQuestion, PauseCircle, RotateCcw, Search, ShieldAlert, ShieldCheck, UserCheck, Wrench, X, XCircle, Zap } from 'lucide-react';
import type { ApprovalStatus, Path, ProductStatus, Risk, Ticket } from '../domain/types';
import { APPROVAL_LABEL, METHOD_LABEL, PRODUCT_STATUS_LABEL, productStatus } from '../domain/lifecycle';
import { SLA_LABEL, slaState } from '../domain/insights';

const PS_STYLE: Record<ProductStatus, { cls: string; Icon: typeof Circle }> = {
  OPEN: { cls: 'b-neutral', Icon: Circle }, SELF_SERVICE: { cls: 'b-accent', Icon: MessageCircleQuestion }, REVIEW_NEEDED: { cls: 'b-warning', Icon: Hand },
  REMEDIATION: { cls: 'b-accent', Icon: Loader2 }, UNSUPPORTED: { cls: 'b-danger', Icon: Search }, MANUAL: { cls: 'b-warning', Icon: Wrench },
  CLOSED: { cls: 'b-success', Icon: CheckCircle2 }, REOPENED: { cls: 'b-warning', Icon: RotateCcw },
};
/** Product status badge (V1.2 §12) — derived from the ticket, never stored separately. */
export function StatusBadge({ t }: { t: Ticket }) {
  const ps = productStatus(t);
  const { cls, Icon } = PS_STYLE[ps];
  return <span className={`badge ${cls}`} data-status={ps}><Icon size={12} aria-hidden className={ps === 'REMEDIATION' ? 'spin-slow' : undefined} />{PRODUCT_STATUS_LABEL[ps]}</span>;
}
export function ApprovalBadge({ status }: { status: ApprovalStatus }) {
  const cls = status === 'PENDING' ? 'b-warning' : status === 'APPROVED' ? 'b-success' : status === 'REJECTED' ? 'b-danger' : status === 'EXPIRED' ? 'b-outline' : 'b-neutral';
  const Icon = status === 'PENDING' ? Hand : status === 'APPROVED' ? UserCheck : status === 'REJECTED' ? XCircle : status === 'EXPIRED' ? Clock : Circle;
  return <span className={`badge ${cls}`} data-approval={status}><Icon size={12} aria-hidden />{APPROVAL_LABEL[status]}</span>;
}
export function MethodBadge({ path }: { path?: Path }) {
  if (!path) return <span className="muted small">—</span>;
  const Icon = path === 'SELF_SERVICE' ? Zap : path === 'HUMAN_APPROVED' ? UserCheck : Wrench;
  return <span className="badge b-outline" data-method={path}><Icon size={12} aria-hidden />{METHOD_LABEL[path]}</span>;
}
export function SlaBadge({ t, now }: { t: Ticket; now: number }) {
  const st = slaState(t, now);
  if (st === 'OK' || st === 'MET') return <span className="small muted">{SLA_LABEL[st]}</span>;
  return <span className={`badge ${st === 'BREACHED' || st === 'MISSED' ? 'b-danger' : 'b-warning'}`}><Clock size={12} aria-hidden />{SLA_LABEL[st]}</span>;
}
export function RiskBadge({ risk }: { risk?: Risk }) {
  if (!risk) return <span className="muted">—</span>;
  const cls = risk === 'HIGH' ? 'b-danger' : risk === 'MEDIUM' ? 'b-warning' : 'b-success';
  const Icon = risk === 'HIGH' ? ShieldAlert : risk === 'MEDIUM' ? AlertTriangle : ShieldCheck;
  return <span className={`badge ${cls}`}><Icon size={12} aria-hidden />{risk === 'HIGH' ? 'High' : risk === 'MEDIUM' ? 'Medium' : 'Low'} risk</span>;
}
export function ConfidenceBadge({ value, threshold }: { value?: number; threshold: number }) {
  if (value === undefined) return <span className="muted">—</span>;
  return <span className={`badge ${value >= threshold ? 'b-accent' : 'b-danger'}`} title="Simulated confidence — not a calibrated probability">{value}%</span>;
}
export function ResultIcon({ result }: { result: string }) {
  if (result === 'FAILURE') return <XCircle size={14} color="var(--danger)" aria-label="Failure" />;
  if (result === 'BLOCKED') return <PauseCircle size={14} color="var(--warning)" aria-label="Blocked" />;
  if (result === 'INFO') return <Clock size={14} color="var(--muted)" aria-label="Info" />;
  return <CheckCircle2 size={14} color="var(--success)" aria-label="Success" />;
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((x) => !x.hasAttribute('disabled'));
    (el?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[1] ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <div className="modal-head"><h2 id={id}>{title}</h2><button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close dialog"><X size={16} /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function DisabledReason({ reason }: { reason?: string | null }) {
  if (!reason) return null;
  return <p className="disabled-reason" role="note"><AlertTriangle size={14} aria-hidden />{reason}</p>;
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return <div className="empty">{icon ?? <Search size={28} aria-hidden />}<p style={{ fontWeight: 600, color: 'var(--text)', marginTop: 8 }}>{title}</p>{children}</div>;
}

export function fmtTime(isoStr?: string) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function fmtShort(isoStr?: string) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
