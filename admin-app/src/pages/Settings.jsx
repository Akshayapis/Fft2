import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { dateTime, money } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Badge, Card, Empty, Field, Spinner } from '../components/ui.jsx';

export default function Settings() {
  const [config, setConfig] = useState(null);
  const [runs, setRuns] = useState([]);
  const [push, setPush] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [c, j, o] = await Promise.all([
        api('/api/admin/config'),
        api('/api/admin/jobs/runs'),
        api('/api/admin/overview'),
      ]);
      setConfig(c.config);
      setRuns(j.runs);
      setPush(o.push);
    } catch (err) {
      toast.error(err.message);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key) => (e) => setConfig((prev) => ({ ...prev, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const res = await api('/api/admin/config', { method: 'PUT', body: config });
      setConfig(res.config);
      setSaved(true);
      toast.success('Configuration saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const runJob = async () => {
    setBusy(true);
    try {
      const res = await api('/api/admin/jobs/expire-matches', { method: 'POST' });
      toast.success(`Job finished: ${res.run.expired.length} expired, ${res.run.refunds} refund(s).`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!config) return <div className="page"><Spinner label="Loading configuration…" /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>App configuration</h2>
          <p>Wallet limits, support contacts and scheduled job controls.</p>
        </div>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card title="Platform settings">
          <form className="col" onSubmit={save}>
            {error ? <div className="form-error">{error}</div> : null}
            {saved ? <div className="form-ok">Configuration saved successfully.</div> : null}
            <div className="form-grid">
              <Field label="App name">
                <input className="input" value={config.appName} onChange={set('appName')} />
              </Field>
              <Field label="Tagline">
                <input className="input" value={config.tagline} onChange={set('tagline')} />
              </Field>
              <Field label="Minimum deposit (₹)">
                <input className="input" type="number" value={config.minDeposit} onChange={set('minDeposit')} />
              </Field>
              <Field label="Maximum deposit (₹)">
                <input className="input" type="number" value={config.maxDeposit} onChange={set('maxDeposit')} />
              </Field>
              <Field label="Minimum withdrawal (₹)">
                <input className="input" type="number" value={config.minWithdrawal} onChange={set('minWithdrawal')} />
              </Field>
              <Field label="Maximum withdrawal (₹)">
                <input className="input" type="number" value={config.maxWithdrawal} onChange={set('maxWithdrawal')} />
              </Field>
              <Field label="Registration bonus (₹)">
                <input className="input" type="number" value={config.registrationBonus} onChange={set('registrationBonus')} />
              </Field>
              <Field label="Deposit UPI ID">
                <input className="input" value={config.upiId} onChange={set('upiId')} />
              </Field>
              <Field label="Support email">
                <input className="input" value={config.supportEmail} onChange={set('supportEmail')} />
              </Field>
              <Field label="Support WhatsApp">
                <input className="input" value={config.supportWhatsapp} onChange={set('supportWhatsapp')} />
              </Field>
            </div>
            <label className="check">
              <input type="checkbox" checked={!!config.maintenanceMode} onChange={(e) => setConfig({ ...config, maintenanceMode: e.target.checked })} />
              Maintenance mode (players see the notice, admin stays usable)
            </label>
            <label className="check">
              <input type="checkbox" checked={config.allowRegistration !== false} onChange={(e) => setConfig({ ...config, allowRegistration: e.target.checked })} />
              Allow new player registrations
            </label>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? <span className="spinner" /> : null} Save configuration
            </button>
          </form>
        </Card>

        <div className="col">
          <Card title="Push notifications">
            <div className="between">
              <div className="small muted" style={{ maxWidth: 330 }}>
                {push?.configured
                  ? 'Firebase Cloud Messaging is connected. Background push is live for registered devices.'
                  : push?.reason || 'FCM is not configured.'}
              </div>
              <Badge tone={push?.configured ? 'green' : 'amber'}>{push?.configured ? 'FCM connected' : 'in-app only'}</Badge>
            </div>
            <div className="divider" />
            <div className="tiny muted" style={{ lineHeight: 1.8 }}>
              To enable real device push, add <span className="mono">FIREBASE_SERVICE_ACCOUNT</span> (service account JSON) to the backend environment and{' '}
              <span className="mono">VITE_FIREBASE_*</span> values for the web app. The admin console only needs the backend connection.
            </div>
          </Card>

          <Card
            title="Scheduled expiration job"
            actions={<button className="btn sm primary" onClick={runJob} disabled={busy}>Run now</button>}
          >
            <div className="small muted" style={{ marginBottom: 10 }}>
              The backend runs this job automatically every 30 seconds. It expires overdue matches, refunds each player exactly once, hides credentials and notifies players.
            </div>
            {runs.length ? (
              <div className="col">
                {runs.slice(0, 6).map((run) => (
                  <div key={run.id} className="kv-row">
                    <span>
                      {dateTime(run.at)} · {run.reason}
                      <div className="tiny muted">{run.expired.length} expired · {run.refunds} refunds · {run.errors.length} errors</div>
                    </span>
                    <Badge tone={run.status === 'ok' ? 'green' : run.status === 'partial' ? 'amber' : 'red'}>{run.status}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <Empty icon="⏱️" title="No job runs yet" />
            )}
          </Card>

          <Card title="Current limits">
            <div className="kv">
              <div className="kv-row"><span>Deposits</span><b>{money(config.minDeposit)} – {money(config.maxDeposit)}</b></div>
              <div className="kv-row"><span>Withdrawals</span><b>{money(config.minWithdrawal)} – {money(config.maxWithdrawal)}</b></div>
              <div className="kv-row"><span>Registration bonus</span><b>{money(config.registrationBonus)}</b></div>
              <div className="kv-row"><span>Registration open</span><b>{config.allowRegistration !== false ? 'Yes' : 'No'}</b></div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
