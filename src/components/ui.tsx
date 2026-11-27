import { useEffect, useId, useRef, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Clock, Loader2, OctagonAlert, PauseCircle, RotateCcw, ShieldAlert, ShieldCheck, Undo2, UserCheck, X, XCircle, Zap, Hand, CalendarClock, Search, WifiOff } from 'lucide-react';
import type { Path, Risk, Status } from '../domain/types';
import { STATUS_LABEL } from '../domain/transitions';

const STATUS_STYLE: Record<Status, { cls: string; Icon: typeof Circle }> = {
  OPEN: { cls: 'b-neutral', Icon: Circle }, DIAGNOSING: { cls: 'b-accent', Icon: Loader2 }, REVIEW_REQUIRED: { cls: 'b-warning', Icon: Search },
  AWAITING_APPROVAL: { cls: 'b-warning', Icon: Hand }, AWAITING_CONSENT: { cls: 'b-warning', Icon: UserCheck }, WAITING_DEVICE: { cls: 'b-neutral', Icon: WifiOff },
  SCHEDULED: { cls: 'b-neutral', Icon: CalendarClock }, READY: { cls: 'b-accent', Icon: Zap }, EXECUTING: { cls: 'b-accent', Icon: Loader2 }, VERIFYING: { cls: 'b-accent', Icon: Loader2 },
  ROLLBACK_AVAILABLE: { cls: 'b-danger', Icon: Undo2 }, ROLLING_BACK: { cls: 'b-danger', Icon: RotateCcw }, ESCALATED: { cls: 'b-danger', Icon: OctagonAlert },
  RESOLVED: { cls: 'b-success', Icon: CheckCircle2 }, CLOSED: { cls: 'b-success', Icon: CheckCircle2 }, REOPENED: { cls: 'b-warning', Icon: RotateCcw },
};
export function StatusBadge({ status }: { status: Status }) {
  const { cls, Icon } = STATUS_STYLE[status];
  return <span className={`badge ${cls}`} data-status={status}><Icon size={12} aria-hidden className={['EXECUTING', 'VERIFYING', 'DIAGNOSING'].includes(status) ? 'spin' : undefined} />{STATUS_LABEL[status]}</span>;
}
export function RiskBadge({ risk }: { risk?: Risk }) {
  if (!risk) return <span className="muted">—</span>;
  const cls = risk === 'HIGH' ? 'b-danger' : risk === 'MEDIUM' ? 'b-warning' : 'b-success';
  const Icon = risk === 'HIGH' ? ShieldAlert : risk === 'MEDIUM' ? AlertTriangle : ShieldCheck;
  return <span className={`badge ${cls}`}><Icon size={12} aria-hidden />{risk === 'HIGH' ? 'High' : risk === 'MEDIUM' ? 'Medium' : 'Low'} risk</span>;
}
export const PATH_LABEL: Record<Path, string> = { AUTO_POLICY: 'Auto (policy)', HUMAN_APPROVED: 'Human-approved', MANUAL: 'Manual' };
export function PathBadge({ path }: { path?: Path }) {
  if (!path) return <span className="muted small">Pending</span>;
  const Icon = path === 'AUTO_POLICY' ? Zap : path === 'HUMAN_APPROVED' ? UserCheck : Hand;
  return <span className="badge b-outline"><Icon size={12} aria-hidden />{PATH_LABEL[path]}</span>;
}
export function ScoreBadge({ score }: { score?: number }) {
  if (score === undefined) return <span className="muted">—</span>;
  const cls = score >= 95 ? 'b-success' : score >= 80 ? 'b-accent' : score >= 60 ? 'b-warning' : 'b-danger';
  return <span className={`badge ${cls}`} title="Simulated score — not a calibrated probability">{score}</span>;
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
