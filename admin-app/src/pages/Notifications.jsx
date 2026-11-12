import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { dateTime, relative } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Badge, Card, Empty, Field, Spinner, Stat, Tabs } from '../components/ui.jsx';

const TYPES = ['announcement', 'match', 'wallet', 'prize', 'security', 'support', 'general'];

export default function Notifications() {
  const [log, setLog] = useState({ notifications: [], stats: {} });
  const [matches, setMatches] = useState([]);
  const [tab, setTab] = useState('compose');
  const [form, setForm] = useState({
    title: '',
    body: '',
    image: '',
    type: 'announcement',
    audience: 'all',
    userId: '',
    userIds: '',
    matchId: '',
    clickAction: '/notifications',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [n, m] = await Promise.all([api('/api/admin/notifications?limit=100'), api('/api/admin/matches')]);
      setLog(n);
      setMatches(m.matches);
      if (!form.matchId && m.matches.length) setForm((prev) => ({ ...prev, matchId: m.matches[0].id }));
    } catch (err) {
      toast.error(err.message);
    }
  }, [toast]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      title: form.title,
      body: form.body,
      image: form.image || null,
      type: form.type,
      audience: form.audience,
      clickAction: form.clickAction,
    };
    if (form.audience === 'user') payload.userId = form.userId.trim();
    if (form.audience === 'users') payload.userIds = form.userIds.split(',').map((s) => s.trim()).filter(Boolean);
    if (form.audience === 'match') payload.matchId = form.matchId;
    try {
      const res = await api('/api/admin/notifications', { method: 'POST', body: payload });
      toast.success(`Notification sent to ${res.count} user(s).`);
      setForm((prev) => ({ ...prev, title: '', body: '', image: '' }));
      await load();
      setTab('history');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Push notification centre</h2>
          <p>Targeted announcements, match room updates, wallet updates and security alerts.</p>
        </div>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={load}>↻ Refresh</button>
      </div>

      <div className="grid cols-4">
        <Stat label="All notifications" value={log.stats.total || 0} tone="cyan" />
        <Stat label="Push delivered" value={log.stats.delivered || 0} foot="FCM accepted" tone="green" />
        <Stat label="In-app only" value={log.stats.inAppOnly || 0} foot="Push disabled by player" tone="amber" />
        <Stat label="Not configured" value={log.stats.notConfigured || 0} foot="FCM credentials missing" />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'compose', label: 'Compose & send' },
          { value: 'history', label: 'Notification history', count: log.notifications.length },
        ]}
      />

      {tab === 'compose' ? (
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <Card title="New notification">
            <form className="col" onSubmit={send}>
              {error ? <div className="form-error">{error}</div> : null}
              <Field label="Title">
                <input className="input" required maxLength={120} value={form.title} onChange={set('title')} placeholder="Match room updated" />
              </Field>
              <Field label="Message">
                <textarea className="input" required maxLength={600} value={form.body} onChange={set('body')} placeholder="Your tournament room details have changed…" />
              </Field>
              <div className="form-grid">
                <Field label="Type">
                  <select className="input" value={form.type} onChange={set('type')}>
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Audience">
                  <select className="input" value={form.audience} onChange={set('audience')}>
                    <option value="all">All players</option>
                    <option value="user">Single player (user ID)</option>
                    <option value="users">Multiple players (IDs)</option>
                    <option value="match">Players in a match</option>
                    <option value="pending_deposits">Pending deposits</option>
                    <option value="pending_withdrawals">Pending withdrawals</option>
                    <option value="top_players">Top 20 players</option>
                  </select>
                </Field>
                {form.audience === 'user' ? (
                  <Field label="User ID" className="full">
                    <input className="input" required value={form.userId} onChange={set('userId')} placeholder="usr_xxxxxxxx" />
                  </Field>
                ) : null}
                {form.audience === 'users' ? (
                  <Field label="User IDs (comma separated)" className="full">
                    <input className="input" required value={form.userIds} onChange={set('userIds')} placeholder="usr_abc123, usr_def456" />
                  </Field>
                ) : null}
                {form.audience === 'match' ? (
                  <Field label="Match" className="full">
                    <select className="input" value={form.matchId} onChange={set('matchId')}>
                      {matches.map((m) => (
                        <option key={m.id} value={m.id}>{m.title} · {m.filledSlots} players</option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                <Field label="Click destination" className="full">
                  <select className="input" value={form.clickAction} onChange={set('clickAction')}>
                    <option value="/notifications">Notifications centre</option>
                    <option value="/matches">Matches</option>
                    <option value="/my-matches">My matches</option>
                    <option value="/wallet">Wallet</option>
                    <option value="/wins">Wins</option>
                    <option value="/support">Support</option>
                    <option value="/devices">Devices & security</option>
                  </select>
                </Field>
                <Field label="Image URL (optional)" className="full">
                  <input className="input" value={form.image} onChange={set('image')} placeholder="https://…/banner.jpg" />
                </Field>
              </div>
              <div className="notice">
                Notifications are always stored in-app, even when a player disabled push. Real device delivery requires Firebase Cloud Messaging credentials on the backend.
              </div>
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? <span className="spinner" /> : '📣'} Send notification
              </button>
            </form>
          </Card>

          <Card title="Audience guide">
            <div className="kv">
              <div className="kv-row"><span>All players</span><b>Everyone with an active account</b></div>
              <div className="kv-row"><span>Single player</span><b>Use the user ID from the users page</b></div>
              <div className="kv-row"><span>Multiple players</span><b>Comma separated IDs</b></div>
              <div className="kv-row"><span>Match participants</span><b>Only players who joined that match</b></div>
              <div className="kv-row"><span>Pending deposits</span><b>Players with a deposit awaiting review</b></div>
              <div className="kv-row"><span>Pending withdrawals</span><b>Players with a withdrawal awaiting payout</b></div>
              <div className="kv-row"><span>Top players</span><b>Top 20 by prize money</b></div>
            </div>
            <div className="divider" />
            <div className="tiny muted" style={{ lineHeight: 1.8 }}>
              Delivery status is tracked per notification: <b>sent</b> (FCM accepted), <b>not_configured</b> (no credentials), <b>in_app_only</b> (player disabled push) or{' '}
              <b>no_devices</b> (no registered push token).
            </div>
          </Card>
        </div>
      ) : (
        <Card pad={false}>
          {log.notifications.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Notification</th>
                    <th>Player</th>
                    <th>Type</th>
                    <th>Delivery</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {log.notifications.map((n) => (
                    <tr key={n.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{n.title}</div>
                        <div className="tiny muted" style={{ maxWidth: 420 }}>{n.body}</div>
                      </td>
                      <td className="tiny">{n.user}</td>
                      <td><Badge tone="slate">{n.type}</Badge></td>
                      <td>
                        <Badge tone={n.delivery?.status === 'sent' ? 'green' : n.delivery?.status === 'not_configured' ? 'amber' : 'slate'}>
                          {n.delivery?.status || 'unknown'}
                        </Badge>
                        {n.delivery?.provider && n.delivery.provider !== 'none' ? <div className="tiny muted">{n.delivery.provider}</div> : null}
                      </td>
                      <td className="tiny muted nowrap" title={dateTime(n.createdAt)}>{relative(n.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="🔔" title="No notifications sent yet" />
          )}
        </Card>
      )}
    </div>
  );
}
