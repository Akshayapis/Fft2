import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { enablePush, disablePush } from '../lib/push.js';
import { useToast } from '../lib/toast.jsx';

export default function Settings() {
  const { user, setUser, logout, config } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [pushInfo, setPushInfo] = useState('');
  const [prefs, setPrefs] = useState(user?.prefs || { pushEnabled: true, emailNotifications: true, privateProfile: false });

  const savePrefs = async (next) => {
    setPrefs(next);
    try {
      const res = await api('/api/profile', { method: 'PUT', body: { prefs: next } });
      setUser(res.user);
      toast.success('Preferences saved.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const turnOnPush = async () => {
    setBusy(true);
    setPushInfo('Requesting permission…');
    try {
      const result = await enablePush();
      if (result.status === 'granted') {
        toast.success('Push notifications enabled on this device.');
        setPushInfo('Push enabled for this device.');
        const res = await api('/api/profile', { method: 'PUT', body: { prefs: { ...prefs, pushEnabled: true } } });
        setUser(res.user);
      } else {
        setPushInfo(result.reason || 'Push could not be enabled.');
        toast.info(result.reason || 'Push could not be enabled.');
      }
    } catch (err) {
      setPushInfo(err.message);
    } finally {
      setBusy(false);
    }
  };

  const turnOffPush = async () => {
    setBusy(true);
    try {
      await disablePush();
      const res = await api('/api/profile', { method: 'PUT', body: { prefs: { ...prefs, pushEnabled: false } } });
      setUser(res.user);
      setPrefs(res.user.prefs);
      setPushInfo('Push disabled for this device. In-app notifications are still recorded.');
      toast.success('Push notifications disabled.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Notifications, privacy and account controls.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h3>🔔 Push notifications</h3>
          <span className={`badge ${config?.push?.configured ? 'open' : 'warn'}`}>
            {config?.push?.configured ? 'FCM connected' : 'In-app only'}
          </span>
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          {config?.push?.configured
            ? 'Real Firebase Cloud Messaging push is configured on the server. Enable it on this device to receive background alerts.'
            : 'Firebase service-account credentials are not configured on this server, so real device push is unavailable. Every alert is still stored in your in-app notification centre.'}
        </p>
        <div className="row wrap">
          <button className="btn primary" onClick={turnOnPush} disabled={busy}>
            {busy ? <span className="spinner" /> : '🔔'} Enable on this device
          </button>
          <button className="btn ghost" onClick={turnOffPush} disabled={busy}>
            Turn off
          </button>
          <Link className="btn ghost" to="/notifications">
            Notification centre
          </Link>
        </div>
        {pushInfo ? <div className="notice" style={{ marginTop: 12 }}>{pushInfo}</div> : null}
        {config?.push?.reason ? <div className="tiny muted" style={{ marginTop: 8 }}>{config.push.reason}</div> : null}
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">
            <h3>Preferences</h3>
          </div>
          <div className="col">
            <Toggle
              label="Match & prize notifications"
              hint="Room updates, reminders and prize credits"
              checked={prefs.pushEnabled}
              onChange={(v) => savePrefs({ ...prefs, pushEnabled: v })}
            />
            <Toggle
              label="Email notifications"
              hint="Important account and payout emails"
              checked={prefs.emailNotifications}
              onChange={(v) => savePrefs({ ...prefs, emailNotifications: v })}
            />
            <Toggle
              label="Private profile"
              hint="Hide your profile details from other players"
              checked={prefs.privateProfile}
              onChange={(v) => savePrefs({ ...prefs, privateProfile: v })}
            />
          </div>
        </div>

        <div className="col">
          <div className="card">
            <div className="card-title">
              <h3>Account</h3>
            </div>
            <div className="col small">
              <div className="between">
                <span className="muted">Email</span>
                <span>{user?.email}</span>
              </div>
              <div className="between">
                <span className="muted">Role</span>
                <span className="badge closed">{user?.role}</span>
              </div>
              <div className="between">
                <span className="muted">Two-factor</span>
                <span className="tiny muted">Available with Firebase Auth in production</span>
              </div>
              <Link className="btn ghost" to="/devices">
                🔑 Change password & manage devices
              </Link>
              <button className="btn danger" onClick={logout}>
                Log out
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <h3>About</h3>
            </div>
            <div className="tiny muted" style={{ lineHeight: 1.8 }}>
              {config?.appName || 'Fire Arena'} · v1.0.0
              <br />
              Server time: {config?.serverTime ? new Date(config.serverTime).toLocaleString() : '—'}
              <br />
              Push provider: {config?.push?.provider || 'none'}
              <br />
              User app and admin console are separate applications sharing one secure backend.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const Toggle = ({ label, hint, checked, onChange }) => (
  <label className="between" style={{ cursor: 'pointer', padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
    <div>
      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{label}</div>
      <div className="tiny muted">{hint}</div>
    </div>
    <span
      style={{
        width: 44,
        height: 25,
        borderRadius: 99,
        background: checked ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'rgba(255,255,255,0.12)',
        position: 'relative',
        transition: '0.2s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 22 : 3,
          width: 19,
          height: 19,
          borderRadius: '50%',
          background: 'white',
          transition: '0.2s',
        }}
      />
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }} />
    </span>
  </label>
);
