import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { dateTime, fromLocalInput, money, statusTone, STATUS_LABEL, toLocalInput } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Badge, Card, Empty, Field, Modal, Spinner, Tabs } from '../components/ui.jsx';

const blank = () => {
  const start = new Date(Date.now() + 3 * 3600_000);
  return {
    title: '',
    mode: 'solo',
    map: 'Bermuda',
    entryFee: 20,
    prizePool: 500,
    perKill: 5,
    totalSlots: 48,
    startTime: toLocalInput(start.toISOString()),
    registrationCloseTime: toLocalInput(new Date(start.getTime() - 30 * 60_000).toISOString()),
    expiryTime: toLocalInput(new Date(start.getTime() + 3 * 3600_000).toISOString()),
    refundDeadline: '',
    roomId: '',
    roomPassword: '',
    rules: 'No emulators. No teaming. Record your gameplay. Sharing room credentials is not allowed.',
    autoRefund: true,
  };
};

export default function Matches() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('active');
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api('/api/admin/matches');
      setMatches(res.matches);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const id = setInterval(load, 45_000);
    return () => clearInterval(id);
  }, [load]);

  const groups = useMemo(
    () => ({
      active: matches.filter((m) => ['registration_open', 'paused', 'registration_closed', 'live'].includes(m.status)),
      completed: matches.filter((m) => ['completed'].includes(m.status)),
      closed: matches.filter((m) => ['cancelled', 'expired'].includes(m.status)),
      all: matches,
    }),
    [matches],
  );

  const list = (groups[tab] || []).filter((m) => !query || m.title.toLowerCase().includes(query.toLowerCase()));

  const openCreate = () => {
    setEditing(null);
    setForm(blank());
    setError('');
    setShowForm(true);
  };

  const openEdit = (m) => {
    setEditing(m);
    setForm({
      title: m.title,
      mode: m.mode,
      map: m.map,
      entryFee: m.entryFee,
      prizePool: m.prizePool,
      perKill: m.perKill,
      totalSlots: m.totalSlots,
      startTime: toLocalInput(m.startTime),
      registrationCloseTime: toLocalInput(m.registrationCloseTime),
      expiryTime: toLocalInput(m.expiryTime),
      refundDeadline: m.refundDeadline ? toLocalInput(m.refundDeadline) : '',
      roomId: m.roomId || '',
      roomPassword: m.roomPassword || '',
      rules: m.rules || '',
      autoRefund: m.autoRefund !== false,
    });
    setError('');
    setShowForm(true);
  };

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      ...form,
      entryFee: Number(form.entryFee),
      prizePool: Number(form.prizePool),
      perKill: Number(form.perKill),
      totalSlots: Number(form.totalSlots),
      startTime: fromLocalInput(form.startTime),
      registrationCloseTime: fromLocalInput(form.registrationCloseTime),
      expiryTime: fromLocalInput(form.expiryTime),
      refundDeadline: form.refundDeadline ? fromLocalInput(form.refundDeadline) : null,
    };
    try {
      if (editing) {
        await api(`/api/admin/matches/${editing.id}`, { method: 'PATCH', body: payload });
        toast.success('Match updated. Registered players were notified if room details changed.');
      } else {
        await api('/api/admin/matches', { method: 'POST', body: payload });
        toast.success('Match created and published to players.');
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const action = async (m, kind) => {
    try {
      if (kind === 'duplicate') {
        const res = await api(`/api/admin/matches/${m.id}/duplicate`, { method: 'POST' });
        toast.success(`Duplicated as "${res.match.title}"`);
      } else if (kind === 'pause') {
        await api(`/api/admin/matches/${m.id}/pause`, { method: 'POST' });
        toast.success('Registrations paused.');
      } else if (kind === 'resume') {
        await api(`/api/admin/matches/${m.id}/resume`, { method: 'POST' });
        toast.success('Registrations resumed.');
      } else if (kind === 'delete') {
        const res = await api(`/api/admin/matches/${m.id}`, { method: 'DELETE' });
        toast.success(res.softDeleted ? 'Match archived — financial records preserved.' : 'Match deleted.');
      } else if (kind === 'cancel') {
        await api(`/api/admin/matches/${m.id}/cancel`, { method: 'POST', body: { reason: 'Cancelled by admin' } });
        toast.success('Match cancelled and refunds processed.');
      }
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Matches & prize distribution</h2>
          <p>Create tournaments, control registration, publish results and distribute prizes.</p>
        </div>
        <div className="spacer" />
        <input className="input" style={{ maxWidth: 240 }} placeholder="Search matches…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn primary sm" onClick={openCreate}>
          ＋ Create match
        </button>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'active', label: 'Active', count: groups.active.length },
          { value: 'completed', label: 'Completed', count: groups.completed.length },
          { value: 'closed', label: 'Cancelled / expired', count: groups.closed.length },
          { value: 'all', label: 'All', count: groups.all.length },
        ]}
      />

      <Card pad={false}>
        {loading ? (
          <Spinner />
        ) : list.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Tournament</th>
                  <th>Status</th>
                  <th>Start</th>
                  <th className="num">Slots</th>
                  <th className="num">Entry</th>
                  <th className="num">Prize</th>
                  <th>Distribution</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="match-title-cell">
                        <Link to={`/matches/${m.id}`}><b>{m.title}</b></Link>
                        <span>{m.mode} · {m.map} · room {m.roomId || 'not set'}</span>
                      </div>
                    </td>
                    <td>
                      <Badge tone={statusTone(m.status)}>
                        {m.status === 'live' ? <span className="live-dot" /> : null}
                        {STATUS_LABEL[m.status] || m.status}
                      </Badge>
                      {m.registrationPaused ? <div className="tiny muted">registrations paused</div> : null}
                    </td>
                    <td className="tiny muted nowrap">{dateTime(m.startTime)}</td>
                    <td className="num">{m.filledSlots}/{m.totalSlots}</td>
                    <td className="num">{money(m.entryFee)}</td>
                    <td className="num">{money(m.prizePool)}</td>
                    <td>
                      {m.prizesDistributed ? (
                        <Badge tone="green">Distributed</Badge>
                      ) : m.resultsPublished ? (
                        <Badge tone="amber">Results published</Badge>
                      ) : (
                        <Badge tone="slate">Pending</Badge>
                      )}
                    </td>
                    <td className="nowrap">
                      <div className="row" style={{ gap: 5 }}>
                        <Link className="btn sm primary" to={`/matches/${m.id}`}>
                          Control
                        </Link>
                        <button className="btn sm ghost" onClick={() => openEdit(m)} title="Edit">
                          ✎
                        </button>
                        <button className="btn sm ghost" onClick={() => action(m, 'duplicate')} title="Duplicate">
                          ⧉
                        </button>
                        {['cancelled', 'expired', 'completed'].includes(m.status) ? (
                          <button className="btn sm ghost" onClick={() => setConfirm({ m, kind: 'delete' })} title="Archive">
                            🗑
                          </button>
                        ) : (
                          <button className="btn sm ghost" onClick={() => setConfirm({ m, kind: 'cancel' })} title="Cancel & refund">
                            ⛔
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="🎯" title="No matches in this view" hint="Create a tournament to get started." />
        )}
      </Card>

      <Modal open={showForm} title={editing ? `Edit ${editing.title}` : 'Create tournament'} onClose={() => setShowForm(false)} wide>
        <form className="col" onSubmit={submit}>
          {error ? <div className="form-error">{error}</div> : null}
          <div className="form-grid">
            <Field label="Title" className="full">
              <input className="input" required value={form.title} onChange={set('title')} placeholder="Friday Solo Showdown" />
            </Field>
            <Field label="Mode">
              <select className="input" value={form.mode} onChange={set('mode')}>
                <option value="solo">Solo</option>
                <option value="duo">Duo</option>
                <option value="squad">Squad</option>
                <option value="clash">Clash squad</option>
              </select>
            </Field>
            <Field label="Map">
              <input className="input" value={form.map} onChange={set('map')} />
            </Field>
            <Field label="Entry fee (₹)">
              <input className="input" type="number" min="0" step="1" value={form.entryFee} onChange={set('entryFee')} disabled={!!editing && editing.filledSlots > 0} />
            </Field>
            <Field label="Prize pool (₹)" hint="Prize distribution can never exceed this budget">
              <input className="input" type="number" min="0" step="1" value={form.prizePool} onChange={set('prizePool')} />
            </Field>
            <Field label="Per kill (₹)">
              <input className="input" type="number" min="0" step="1" value={form.perKill} onChange={set('perKill')} />
            </Field>
            <Field label="Total slots">
              <input className="input" type="number" min="1" value={form.totalSlots} onChange={set('totalSlots')} />
            </Field>
            <Field label="Match start">
              <input className="input" type="datetime-local" required value={form.startTime} onChange={set('startTime')} />
            </Field>
            <Field label="Registration closes">
              <input className="input" type="datetime-local" required value={form.registrationCloseTime} onChange={set('registrationCloseTime')} />
            </Field>
            <Field label="Expiry / auto-refund time">
              <input className="input" type="datetime-local" required value={form.expiryTime} onChange={set('expiryTime')} />
            </Field>
            <Field label="Refund deadline (optional)">
              <input className="input" type="datetime-local" value={form.refundDeadline} onChange={set('refundDeadline')} />
            </Field>
            <Field label="Room ID">
              <input className="input" value={form.roomId} onChange={set('roomId')} placeholder="84512397" />
            </Field>
            <Field label="Room password">
              <input className="input" value={form.roomPassword} onChange={set('roomPassword')} placeholder="arena786" />
            </Field>
            <Field label="Rules" className="full">
              <textarea className="input" value={form.rules} onChange={set('rules')} />
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.autoRefund} onChange={(e) => setForm({ ...form, autoRefund: e.target.checked })} />
            Automatically refund entry fees if this match expires without completion
          </label>
          <div className="notice">Room ID and password changes notify every registered player immediately. Expired matches hide credentials and refund automatically.</div>
          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? <span className="spinner" /> : null} {editing ? 'Save changes' : 'Create match'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!confirm}
        title={confirm?.kind === 'delete' ? 'Archive match?' : 'Cancel match and refund players?'}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setConfirm(null)}>Close</button>
            <button className={`btn ${confirm?.kind === 'delete' ? 'red' : 'amber'}`} onClick={() => action(confirm.m, confirm.kind)}>
              {confirm?.kind === 'delete' ? 'Archive match' : 'Cancel & refund'}
            </button>
          </>
        }
      >
        <p className="small muted">
          {confirm?.kind === 'delete'
            ? 'This match has financial history, so it is soft-deleted: players, transactions and prize records stay intact for auditing.'
            : 'Every registered player is refunded exactly once, credentials are hidden, and notifications are sent. This cannot be undone.'}
        </p>
      </Modal>
    </div>
  );
}
