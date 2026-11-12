import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const NAV = [
  { group: 'Operations', items: [
    { to: '/', label: 'Dashboard', icon: '◉', end: true },
    { to: '/matches', label: 'Matches & prizes', icon: '🎯' },
    { to: '/notifications', label: 'Notification centre', icon: '🔔' },
    { to: '/support', label: 'Support desk', icon: '🎧', badge: 'openTickets' },
  ] },
  { group: 'Finance', items: [
    { to: '/deposits', label: 'Deposits', icon: '⬇️', badge: 'pendingDeposits' },
    { to: '/withdrawals', label: 'Withdrawals', icon: '⬆️', badge: 'pendingWithdrawals' },
    { to: '/reports', label: 'Reports', icon: '📈' },
  ] },
  { group: 'People & security', items: [
    { to: '/users', label: 'Users', icon: '👥' },
    { to: '/devices', label: 'Devices & sessions', icon: '📱' },
    { to: '/settings', label: 'App configuration', icon: '⚙️' },
  ] },
];

const TITLES = {
  '/': 'Dashboard',
  '/matches': 'Matches & prize distribution',
  '/deposits': 'Deposit management',
  '/withdrawals': 'Withdrawal management',
  '/users': 'User management',
  '/notifications': 'Push notification centre',
  '/devices': 'Device & session management',
  '/support': 'Support desk',
  '/reports': 'Financial reports',
  '/settings': 'App configuration',
};

export default function Layout() {
  const { user, logout, config } = useAuth();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({});
  const [clock, setClock] = useState(new Date());
  const location = useLocation();
  const navigate = useNavigate();

  const loadCounts = useCallback(async () => {
    try {
      const res = await api('/api/admin/overview');
      setCounts({
        pendingDeposits: res.finance.pendingDeposits,
        pendingWithdrawals: res.finance.pendingWithdrawals,
        openTickets: res.totals.openTickets,
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadCounts();
    const id = setInterval(loadCounts, 45_000);
    return () => clearInterval(id);
  }, [loadCounts, location.pathname]);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="mark">🔥</div>
          <div>
            <b>{config?.appName || 'Fire Arena'}</b>
            <span>Admin console</span>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((section) => (
            <div key={section.group}>
              <div className="nav-group">{section.group}</div>
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <span className="ic">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.badge && counts[item.badge] ? <span className="pill-count">{counts[item.badge]}</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="avatar">{(user?.username || 'A').slice(0, 2).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.username}</div>
            <div className="tiny muted">Administrator</div>
          </div>
          <button className="icon-btn" onClick={logout} title="Sign out" aria-label="Sign out">
            ⏻
          </button>
        </div>
      </aside>

      {open ? <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 35 }} onClick={() => setOpen(false)} /> : null}

      <div className="content">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            ☰
          </button>
          <h1>{TITLES[location.pathname] || (location.pathname.startsWith('/matches/') ? 'Match control' : 'Admin')}</h1>
          <span className="crumb">· {location.pathname.startsWith('/matches/') ? 'Operations' : 'Fire Arena'}</span>
          <div className="spacer" />
          <span className="tiny muted mono">{clock.toLocaleTimeString('en-IN')}</span>
          <button className="icon-btn" title="Refresh data" onClick={loadCounts} aria-label="Refresh">
            ↻
          </button>
          <button className="icon-btn" title="Open player app" onClick={() => window.open('http://localhost:5173', '_blank')} aria-label="Player app">
            ↗
          </button>
          <div className="avatar">{(user?.username || 'A').slice(0, 2).toUpperCase()}</div>
        </header>

        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
