import { useEffect, useMemo, useState } from 'react';
import { initials } from '../lib/format.js';

export function Modal({ open, title, onClose, children, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
        {footer ? <div style={{ marginTop: 18 }}>{footer}</div> : null}
      </div>
    </div>
  );
}

export const Spinner = ({ label }) => (
  <div className="row" style={{ justifyContent: 'center', padding: 30, color: 'var(--muted)' }}>
    <span className="spinner" /> {label || 'Loading…'}
  </div>
);

export const Empty = ({ emoji = '🎮', title, hint }) => (
  <div className="empty">
    <span className="emoji">{emoji}</span>
    <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}>{title}</div>
    {hint ? <div className="small">{hint}</div> : null}
  </div>
);

export const Badge = ({ tone = 'closed', children }) => <span className={`badge ${tone}`}>{children}</span>;

export const Stat = ({ label, value, foot, tone = '' }) => (
  <div className={`stat ${tone}`}>
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
    {foot ? <div className="stat-foot">{foot}</div> : null}
  </div>
);

export const Tabs = ({ tabs, value, onChange }) => (
  <div className="tabs" role="tablist">
    {tabs.map((tab) => (
      <button
        key={tab.value}
        type="button"
        role="tab"
        aria-selected={value === tab.value}
        className={`tab ${value === tab.value ? 'active' : ''}`}
        onClick={() => onChange(tab.value)}
      >
        {tab.label}
        {tab.count !== undefined ? ` (${tab.count})` : ''}
      </button>
    ))}
  </div>
);

export const Avatar = ({ src, name, size = '' }) => (
  <div className={`avatar ${size}`}>{src ? <img src={src} alt="" /> : initials(name)}</div>
);

/** Live countdown string, recomputed every second. */
export function useCountdown(iso) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return useMemo(() => {
    if (!iso) return '—';
    const diff = new Date(iso).getTime() - now;
    if (diff <= 0) return 'Started';
    const d = Math.floor(diff / 86_400_000);
    const h = Math.floor((diff % 86_400_000) / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    const s = Math.floor((diff % 60_000) / 1000);
    if (d) return `${d}d ${h}h ${m}m`;
    if (h) return `${h}h ${m}m ${s}s`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  }, [iso, now]);
}

export const Field = ({ label, hint, children }) => (
  <label className="field">
    <span className="label">{label}</span>
    {children}
    {hint ? <span className="tiny muted">{hint}</span> : null}
  </label>
);
