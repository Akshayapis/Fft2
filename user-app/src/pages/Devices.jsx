import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { dateTime, relativeTime } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Empty, Modal, Spinner } from '../components/ui.jsx';

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pwd, setPwd] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([api('/api/devices'), api('/api/security/activity')]);
      setDevices(d.devices);
      setEvents(s.events);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async (device) => {
    setBusy(true);
    try {
      await api(`/api/devices/${device.id}/revoke`, { method: 'POST' });
      toast.success(`${device.name} signed out.`);
      setConfirm(null);
      if (device.current) {
        window.location.href = '/login';
        return;
      }
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const logoutOthers = async () => {
    setBusy(true);
    try {
      const res = await api('/api/devices/logout-others', { method: 'POST' });
      toast.success(`Signed out ${res.revokedSessions} other session(s).`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pwd.newPassword !== pwd.confirm) {
      toast.error('New passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api('/api/auth/password', {
        method: 'POST',
        body: { currentPassword: pwd.currentPassword, newPassword: pwd.newPassword },
      });
      toast.success('Password updated. Other devices were signed out.');
      setShowPassword(false);
      setPwd({ currentPassword: '', newPassword: '', confirm: '' });
      await load();
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
          <h1>Device management</h1>
          <p>Every device and session authorised for your account.</p>
        </div>
        <div className="spacer" />
        <button className="btn sm danger" onClick={logoutOthers} disabled={busy}>
          Log out other devices
        </button>
      </div>

      <div className="card">
        <div className="between">
          <div>
            <h3 style={{ margin: 0, fontSize: 15 }}>Authorised devices</h3>
            <div className="tiny muted">A new device login always triggers a security alert in notifications.</div>
          </div>
          <button className="btn sm ghost" onClick={() => setShowPassword(true)}>
            🔑 Change password
          </button>
        </div>

        {loading ? (
          <Spinner />
        ) : devices.length ? (
          devices.map((d) => (
            <div key={d.id} className="device-row">
              <div className="device-ic">{/Android|iOS|Mobile/i.test(d.os) ? '📱' : /Windows|macOS|Linux/i.test(d.os) ? '💻' : '🖥️'}</div>
              <div className="grow">
                <div className="row wrap" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{d.name}</span>
                  {d.current ? <span className="badge open">Current device</span> : null}
                  <span className={`pill ${d.revoked || !d.active ? 'revoked' : 'active'}`}>{d.revoked || !d.active ? 'Signed out' : 'Active'}</span>
                </div>
                <div className="tiny muted" style={{ marginTop: 3 }}>
                  {d.os} · {d.browser} · {d.model || d.platform}
                  {d.ip ? ` · IP ${d.ip}` : ''}
                </div>
                <div className="tiny muted">
                  First login {dateTime(d.firstLoginAt)} · Last active {relativeTime(d.lastActiveAt)} · {d.sessionCount} active session(s)
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => setConfirm(d)} disabled={busy && !d.current}>
                {d.revoked || !d.active ? 'Remove' : 'Sign out'}
              </button>
            </div>
          ))
        ) : (
          <Empty emoji="📱" title="No devices" hint="Log in again to register this device." />
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <h3>Security activity</h3>
          <span className="tiny muted">{events.length} events</span>
        </div>
        {events.length ? (
          <div className="timeline">
            {events.map((e) => (
              <div key={e.id} className="timeline-item">
                <span className="timeline-dot" style={{ background: e.type.includes('block') || e.type.includes('revoked') ? 'var(--err)' : 'var(--ok)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{e.message}</div>
                  <div className="tiny muted">
                    {dateTime(e.createdAt)} · {e.type}
                    {e.ip ? ` · IP ${e.ip}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted small">No security events recorded yet.</div>
        )}
      </div>

      <Modal
        open={!!confirm}
        title={confirm?.current ? 'Sign out this device?' : `Remove ${confirm?.name || 'device'}?`}
        onClose={() => setConfirm(null)}
        footer={
          <div className="row">
            <button className="btn ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="btn danger" onClick={() => revoke(confirm)} disabled={busy}>
              {busy ? <span className="spinner" /> : 'Confirm'}
            </button>
          </div>
        }
      >
        <p className="small muted">
          {confirm?.current
            ? 'You are signing out the device you are using right now. You will need to log in again.'
            : 'All sessions on this device will be revoked immediately. The device must sign in again.'}
        </p>
      </Modal>

      <Modal open={showPassword} title="Change password" onClose={() => setShowPassword(false)}>
        <form className="col" onSubmit={changePassword}>
          <label className="field">
            <span className="label">Current password</span>
            <input className="input" type="password" required value={pwd.currentPassword} onChange={(e) => setPwd({ ...pwd, currentPassword: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">New password</span>
            <input className="input" type="password" minLength={8} required value={pwd.newPassword} onChange={(e) => setPwd({ ...pwd, newPassword: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Confirm new password</span>
            <input className="input" type="password" required value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} />
          </label>
          <button className="btn primary block" disabled={busy} type="submit">
            {busy ? <span className="spinner" /> : 'Update password'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
