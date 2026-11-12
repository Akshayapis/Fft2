import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { relativeTime } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Empty, Spinner, Tabs } from '../components/ui.jsx';

const ICONS = {
  welcome: '🎉',
  security: '🛡️',
  prize: '🏆',
  wallet: '💰',
  refund: '↩️',
  match: '🎯',
  support: '🎧',
  announcement: '📣',
};

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [tab, setTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [pushNote, setPushNote] = useState('');
  const toast = useToast();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const res = await api('/api/notifications?limit=100');
      setItems(res.notifications);
      setUnread(res.unreadCount);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const markAll = async () => {
    await api('/api/notifications/read-all', { method: 'POST' });
    toast.success('All notifications marked as read.');
    load();
  };

  const open = async (item) => {
    if (!item.read) {
      try {
        await api(`/api/notifications/${item.id}/read`, { method: 'POST' });
      } catch {
        /* ignore */
      }
    }
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    setUnread((n) => Math.max(0, n - (item.read ? 0 : 1)));
    const action = item.clickAction || '/notifications';
    if (action.startsWith('/')) navigate(action);
  };

  const filtered = tab === 'all' ? items : tab === 'unread' ? items.filter((n) => !n.read) : items.filter((n) => n.type === tab);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Match reminders, room updates, prizes and security alerts.</p>
        </div>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={markAll} disabled={!unread}>
          Mark all read
        </button>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div className="between wrap">
          <div className="small muted">
            {typeof Notification === 'undefined'
              ? 'This browser does not support push notifications.'
              : Notification.permission === 'granted'
                ? '🔔 Push permission granted — device alerts will arrive even when the app is in the background (when FCM is configured).'
                : '🔕 Push permission not granted. In-app notifications are always recorded.'}
          </div>
          <button className="btn sm ghost" onClick={() => navigate('/settings')}>
            Notification settings
          </button>
        </div>
        {pushNote ? <div className="tiny muted" style={{ marginTop: 6 }}>{pushNote}</div> : null}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: 'All', count: items.length },
          { value: 'unread', label: 'Unread', count: unread },
          { value: 'match', label: 'Matches' },
          { value: 'wallet', label: 'Wallet' },
          { value: 'security', label: 'Security' },
        ]}
      />

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <Spinner />
        ) : filtered.length ? (
          filtered.map((n) => (
            <div
              key={n.id}
              className={`notif-item ${n.read ? '' : 'unread'}`}
              onClick={() => open(n)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && open(n)}
            >
              <div className="notif-icon">{ICONS[n.type] || '🔔'}</div>
              <div className="grow">
                <div className="between">
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{n.title}</div>
                  <span className="tiny muted">{relativeTime(n.createdAt)}</span>
                </div>
                <div className="small muted" style={{ marginTop: 3 }}>
                  {n.body}
                </div>
                {n.image ? <img src={n.image} alt="" style={{ marginTop: 8, maxWidth: '100%', borderRadius: 10 }} /> : null}
                <div className="row" style={{ marginTop: 6, gap: 6 }}>
                  <span className="pill">{n.type}</span>
                  {n.delivery?.status ? <span className="pill">{n.delivery.status === 'sent' ? '📲 push sent' : n.delivery.status.replace(/_/g, ' ')}</span> : null}
                  {!n.read ? <span className="pill active">new</span> : null}
                </div>
              </div>
            </div>
          ))
        ) : (
          <Empty emoji="🔔" title="No notifications" hint="You are all caught up." />
        )}
      </div>
    </div>
  );
}
