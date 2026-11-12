import { useEffect } from 'react';

export const Badge = ({ tone = 'slate', children }) => <span className={`badge ${tone}`}>{children}</span>;

export const Spinner = ({ label = 'Loading…' }) => (
  <div className="spinner-row">
    <span className="spinner" /> {label}
  </div>
);

export const Empty = ({ title = 'Nothing here yet', hint, icon = '📭' }) => (
  <div className="empty">
    <span className="emoji">{icon}</span>
    <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
    {hint ? <div className="tiny muted" style={{ marginTop: 4 }}>{hint}</div> : null}
  </div>
);

export const Card = ({ title, actions, children, className = '', pad = true }) => (
  <section className={`card ${className}`}>
    {(title || actions) && (
      <div className="card-head">
        <h3>{title}</h3>
        <div className="row">{actions}</div>
      </div>
    )}
    <div className={pad ? '' : 'no-pad'}>{children}</div>
  </section>
);

export const Stat = ({ label, value, foot, tone = '' }) => (
  <div className={`stat ${tone}`}>
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
    {foot ? <div className="stat-foot">{foot}</div> : null}
  </div>
);

export function Modal({ open, title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export const Field = ({ label, hint, children, className = '' }) => (
  <label className={`field ${className}`}>
    <span className="label">{label}</span>
    {children}
    {hint ? <span className="tiny muted">{hint}</span> : null}
  </label>
);

export const Tabs = ({ value, onChange, tabs }) => (
  <div className="tabs">
    {tabs.map((t) => (
      <button key={t.value} type="button" className={`tab ${value === t.value ? 'active' : ''}`} onClick={() => onChange(t.value)}>
        {t.label}
        {t.count !== undefined ? ` (${t.count})` : ''}
      </button>
    ))}
  </div>
);

export const Progress = ({ value, max = 100, tone = '' }) => (
  <div className="progress">
    <span className={tone} style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} />
  </div>
);
