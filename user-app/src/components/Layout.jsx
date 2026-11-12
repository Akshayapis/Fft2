import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { money } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import Background from './Background.jsx';
import { Avatar } from './ui.jsx';

const NAV = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/matches', label: 'Matches', icon: '🎯' },
  { to: '/my-matches', label: 'My Matches', icon: '📋' },
  { to: '/results', label: 'Results & Wins', icon: '🏆' },
  { to: '/wallet', label: 'Wallet', icon: '💳' },
  { to: '/leaderboard', label: 'Leaderboard', icon: '📊' },
  { to: '/notifications', label: 'Notifications', icon: '🔔', badge: true },
  { to: '/devices', label: 'Devices', icon: '📱' },
  { to: '/profile', label: 'Profile', icon: '👤' },
  { to: '/support', label: 'Support', icon: '🎧' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

const BOTTOM = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/matches', label: 'Matches', icon: '🎯' },
  { to: '/wallet', label: 'Wallet', icon: '💳' },
  { to: '/leaderboard', label: 'Ranks', icon: '📊' },
  { to: '/profile', label: 'Profile', icon: '👤' },
];

const TITLES = {
  '/': 'Dashboard',
  '/matches': 'Tournaments',
  '/my-matches': 'My Matches',
  '/results': 'Results & Wins',
  '/wallet': 'Wallet',
  '/deposit': 'Add Money',
  '/withdraw': 'Withdraw',
  '/leaderboard': 'Leaderboard',
  '/notifications': 'Notifications',
  '/devices': 'Device Management',
  '/profile': 'My Profile',
  '/support': 'Support',
  '/settings': 'Settings',
};

export default function Layout() {
  const { user, logout, config } = useAuth();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const drawerRef = useRef(null);

  const loadUnread = useCallback(async () => {
    try {
      const res = await api('/api/notifications?limit=1');
      setUnread(res.unreadCount || 0);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadUnread();
    const id = setInterval(loadUnread, 25000);
    return () => clearInterval(id);
  }, [loadUnread, location.pathname]);

  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    const onPush = (event) => {
      toast.info(`${event.detail.title}${event.detail.body ? ` — ${event.detail.body}` : ''}`);
      loadUnread();
    };
    window.addEventListener('ff:push', onPush);
    return () => window.removeEventListener('ff:push', onPush);
  }, [toast, loadUnread]);

  return (
    <div className="shell">
      <Background intensity={0.8} />
      <aside className={`sidebar ${open ? 'open' : ''}`} ref={drawerRef}>
        <div className="brand">
          <div className="mark">🔥</div>
          <div>
            <strong>{config?.appName || 'Fire Arena'}</strong>
            <span>Tournament Arena</span>
          </div>
        </div>

        <nav className="nav" aria-label="Main navigation">
          <div className="nav-label">Play</div>
          {NAV.slice(0, 4).map((item) => (
            <NavItem key={item.to} item={item} unread={unread} />
          ))}
          <div className="nav-label">Account</div>
          {NAV.slice(4).map((item) => (
            <NavItem key={item.to} item={item} unread={unread} />
          ))}
        </nav>

        <div className="sidebar-foot">
          <Avatar src={user?.avatar} name={user?.username} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.username}</div>
            <div className="tiny muted">{money(user?.wallet?.balance)} wallet</div>
          </div>
          <button className="icon-btn" title="Log out" onClick={logout} aria-label="Log out">
            ⏻
          </button>
        </div>
      </aside>

      {open ? (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 35 }}
          onClick={() => setOpen(false)}
          role="presentation"
        />
      ) : null}

      <div className="content">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            ☰
          </button>
          <h2>{TITLES[location.pathname] || (location.pathname.startsWith('/matches/') ? 'Match details' : 'Fire Arena')}</h2>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => navigate('/wallet')} title="Wallet" aria-label="Wallet">
            ₹
          </button>
          <button className="icon-btn" onClick={() => navigate('/notifications')} aria-label="Notifications">
            🔔{unread ? <span className="dot" /> : null}
          </button>
          <button className="icon-btn" onClick={() => navigate('/profile')} aria-label="Profile">
            {user?.avatar ? <img src={user.avatar} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} /> : '👤'}
          </button>
        </header>

        <main>
          <Outlet />
        </main>

        <nav className="bottom-nav" aria-label="Quick navigation">
          {BOTTOM.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="ic">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function NavItem({ item, unread }) {
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      <span className="ic">{item.icon}</span>
      <span>{item.label}</span>
      {item.badge && unread ? <span className="count">{unread > 99 ? '99+' : unread}</span> : null}
    </NavLink>
  );
}
