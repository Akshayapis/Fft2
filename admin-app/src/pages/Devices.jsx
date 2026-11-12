import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { dateTime, relative } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Badge, Card, Empty, Spinner, Tabs } from '../components/ui.jsx';

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [events, setEvents] = useState([]);
  const [tab, setTab] = useState('devices');
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [d, s, e] = await Promise.all([api('/api/admin/devices'), api('/api/admin/sessions'), api('/api/admin/security?limit=100')]);
      setDevices(d.devices);
      setSessions(s.sessions);
      setEvents(e.events);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const revokeDevice = async (device) => {
    try {
      const res = await api(`/api/admin/devices/${device.id}/revoke`, { method: 'POST' });
      toast.success(`Revoked ${res.sessions} session(s) on ${device.name}.`);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const revokeSession = async (session) => {
    try {
      await api(`/api/admin/sessions/${session.id}/revoke`, { method: 'POST' });
      toast.success('Session revoked.');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="page"><Spinner /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Devices & sessions</h2>
          <p>Every authorised device. New-device logins raise automatic security alerts to the account owner.</p>
        </div>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={load}>↻ Refresh</button>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'devices', label: 'Devices', count: devices.length },
          { value: 'sessions', label: 'Sessions', count: sessions.length },
          { value: 'security', label: 'Security log', count: events.length },
        ]}
      />

      {tab === 'devices' ? (
        <Card pad={false}>
          {devices.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Player</th>
                    <th>OS / browser</th>
                    <th>IP</th>
                    <th>First login</th>
                    <th>Last active</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr key={d.id}>
                      <td style={{ fontWeight: 600 }}>{d.name}</td>
                      <td>{d.username}<div className="tiny muted">{d.email}</div></td>
                      <td className="tiny">{d.os} · {d.browser}</td>
                      <td className="mono tiny">{d.ip || '—'}</td>
                      <td className="tiny muted nowrap">{dateTime(d.firstLoginAt)}</td>
                      <td className="tiny muted nowrap">{relative(d.lastActiveAt)}</td>
                      <td><Badge tone={d.revoked ? 'red' : d.active ? 'green' : 'slate'}>{d.revoked ? 'revoked' : d.active ? 'active' : 'idle'}</Badge></td>
                      <td>
                        <button className="btn sm red" onClick={() => revokeDevice(d)} disabled={d.revoked}>Revoke</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="📱" title="No devices registered" />
          )}
        </Card>
      ) : null}

      {tab === 'sessions' ? (
        <Card pad={false}>
          {sessions.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Device</th>
                    <th>IP</th>
                    <th>Created</th>
                    <th>Last active</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td>{s.username}</td>
                      <td className="small">{s.device}</td>
                      <td className="mono tiny">{s.ip || '—'}</td>
                      <td className="tiny muted nowrap">{dateTime(s.createdAt)}</td>
                      <td className="tiny muted nowrap">{relative(s.lastActiveAt)}</td>
                      <td>
                        <Badge tone={s.revoked ? 'red' : 'green'}>{s.revoked ? 'revoked' : 'active'}</Badge>
                        {s.revokedReason ? <div className="tiny muted">{s.revokedReason}</div> : null}
                      </td>
                      <td>
                        <button className="btn sm red" onClick={() => revokeSession(s)} disabled={s.revoked}>Revoke</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="🔐" title="No sessions" />
          )}
        </Card>
      ) : null}

      {tab === 'security' ? (
        <Card pad={false}>
          {events.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Player</th>
                    <th>IP</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{e.message}</div>
                        <div className="tiny muted">{e.type}</div>
                      </td>
                      <td className="small">{e.username}</td>
                      <td className="mono tiny">{e.ip || '—'}</td>
                      <td className="tiny muted nowrap">{dateTime(e.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="🛡️" title="No security events" />
          )}
        </Card>
      ) : null}
    </div>
  );
}
