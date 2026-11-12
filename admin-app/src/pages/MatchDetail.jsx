import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, download } from '../lib/api.js';
import { dateTime, money, statusTone, STATUS_LABEL } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Badge, Card, Empty, Field, Modal, Spinner, Stat, Tabs } from '../components/ui.jsx';

export default function MatchDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('prizes');
  const [entries, setEntries] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirmDistribute, setConfirmDistribute] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [settings, setSettings] = useState(null);
  const [settingsError, setSettingsError] = useState('');
  const [retryTarget, setRetryTarget] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api(`/api/admin/matches/${id}`);
      setMatch(res.match);
      setEntries((prev) => {
        const next = { ...prev };
        for (const p of res.match.participants) {
          if (!next[p.userId]) {
            next[p.userId] = { selected: false, amount: '', rank: p.rank ?? '' };
          } else {
            next[p.userId] = {
              ...next[p.userId],
              rank: next[p.userId].rank === '' ? (p.rank ?? '') : next[p.userId].rank,
            };
          }
        }
        return next;
      });
      setSettings((prev) => prev || {
        roomId: res.match.roomId || '',
        roomPassword: res.match.roomPassword || '',
        title: res.match.title,
        startTime: res.match.startTime,
        map: res.match.map,
      });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const paidSoFar = useMemo(
    () =>
      (match?.distributions || []).reduce(
        (sum, d) => sum + d.winners.filter((w) => ['paid', 'already_paid'].includes(w.status)).reduce((s, w) => s + w.amount, 0),
        0,
      ),
    [match],
  );

  const selected = useMemo(() => Object.entries(entries).filter(([, e]) => e.selected), [entries]);
  const selectedTotal = selected.reduce((sum, [, e]) => sum + (Number(e.amount) || 0), 0);
  const budget = match?.prizePool || 0;
  const remaining = Math.max(0, Math.round((budget - paidSoFar) * 100) / 100);
  const overBudget = selectedTotal > remaining;

  const setEntry = (userId, patch) =>
    setEntries((prev) => ({ ...prev, [userId]: { ...prev[userId], ...patch } }));

  const toggleAll = (checked) => {
    const next = {};
    for (const p of match.participants) {
      next[p.userId] = { ...entries[p.userId], selected: checked };
    }
    setEntries(next);
  };

  const quickSplit = (kind) => {
    const chosen = selected.length ? selected.map(([userId]) => userId) : match.participants.slice(0, 3).map((p) => p.userId);
    const shares =
      kind === 'winner'
        ? [1]
        : kind === 'top3'
          ? [0.5, 0.3, 0.2]
          : Array(chosen.length).fill(1 / Math.max(1, chosen.length));
    const next = { ...entries };
    chosen.forEach((userId, i) => {
      const pct = shares[Math.min(i, shares.length - 1)] ?? 0;
      next[userId] = { ...next[userId], selected: true, amount: String(Math.floor(((remaining || budget) * pct) / (kind === 'equal' ? 1 : 1))) };
    });
    setEntries(next);
    toast.info(kind === 'winner' ? 'Full remaining budget set on first selected player.' : 'Split applied — adjust amounts if needed.');
  };

  const distribute = async () => {
    setBusy(true);
    try {
      const winners = selected
        .filter(([, e]) => Number(e.amount) > 0)
        .map(([userId, e]) => ({ userId, amount: Number(e.amount), rank: e.rank === '' ? null : Number(e.rank) }));
      if (!winners.length) throw new Error('Enter a prize amount for at least one selected player.');
      const res = await api(`/api/admin/matches/${id}/distribute-prizes`, { method: 'POST', body: { winners } });
      const d = res.distribution;
      if (d.status === 'completed') toast.success(`₹${d.paidAmount} distributed to ${d.paidCount} winner(s).`);
      else if (d.status === 'partial') toast.info(`Partial distribution: ${d.paidCount} paid, ${d.failedCount} failed. Retry failed payouts from the history tab.`);
      else toast.error('All payouts failed. Check the history tab and retry.');
      setConfirmDistribute(false);
      await load();
      setTab('history');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const publishResults = async () => {
    setBusy(true);
    try {
      const results = Object.entries(entries)
        .filter(([, e]) => e.rank !== '' && e.rank !== null && e.rank !== undefined)
        .map(([userId, e]) => ({ userId, rank: Number(e.rank) }));
      if (!results.length) throw new Error('Set at least one rank before publishing results.');
      await api(`/api/admin/matches/${id}/results`, { method: 'POST', body: { results } });
      toast.success('Results published to players.');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const action = async (kind) => {
    setBusy(true);
    try {
      await api(`/api/admin/matches/${id}/${kind}`, { method: 'POST' });
      toast.success(kind === 'pause' ? 'Registrations paused.' : kind === 'resume' ? 'Registrations resumed.' : kind === 'close-registration' ? 'Registration closed.' : 'Done.');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelMatch = async () => {
    setBusy(true);
    try {
      const res = await api(`/api/admin/matches/${id}/cancel`, { method: 'POST', body: { reason: 'Cancelled by admin' } });
      const refunded = res.refunds?.filter((r) => r.status === 'refunded').length || 0;
      toast.success(`Match cancelled. ${refunded} refund(s) issued.`);
      setConfirmCancel(false);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/matches/${id}/distributions/${retryTarget.distributionId}/retry`, {
        method: 'POST',
        body: { userId: retryTarget.userId },
      });
      toast.success('Payout completed.');
      setRetryTarget(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    setBusy(true);
    setSettingsError('');
    try {
      await api(`/api/admin/matches/${id}`, {
        method: 'PATCH',
        body: {
          roomId: settings.roomId,
          roomPassword: settings.roomPassword,
          title: settings.title,
          map: settings.map,
          startTime: settings.startTime,
        },
      });
      toast.success('Match details updated — registered players were notified.');
      await load();
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="page"><Spinner label="Loading match control…" /></div>;
  if (!match) return <div className="page"><Empty title="Match not found" /></div>;

  const closed = ['cancelled', 'expired', 'completed'].includes(match.status);

  return (
    <div className="page">
      <div className="row wrap">
        <button className="btn sm ghost" onClick={() => navigate('/matches')}>← All matches</button>
        <Badge tone={statusTone(match.status)}>{STATUS_LABEL[match.status] || match.status}</Badge>
        {match.prizesDistributed ? <Badge tone="green">Prizes distributed</Badge> : null}
        <div className="spacer" />
        {!closed ? (
          <>
            {match.registrationPaused ? (
              <button className="btn sm amber" onClick={() => action('resume')} disabled={busy}>Resume registration</button>
            ) : (
              <button className="btn sm ghost" onClick={() => action('pause')} disabled={busy}>Pause registration</button>
            )}
            <button className="btn sm ghost" onClick={() => action('close-registration')} disabled={busy}>Close registration</button>
            <button className="btn sm red" onClick={() => setConfirmCancel(true)} disabled={busy}>Cancel & refund</button>
          </>
        ) : null}
        <button className="btn sm ghost" onClick={() => download(`/api/admin/matches/${id}/participants.csv`, `${match.title.replace(/\W+/g, '-')}-participants.csv`)}>
          ⤓ Export CSV
        </button>
      </div>

      <Card>
        <div className="between wrap" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: 20 }}>{match.title}</h2>
            <div className="small muted" style={{ marginTop: 4 }}>
              {match.mode} · {match.map} · starts {dateTime(match.startTime)} · registration closes {dateTime(match.registrationCloseTime)} · expires {dateTime(match.expiryTime)}
            </div>
            <div className="row wrap tiny muted" style={{ marginTop: 10 }}>
              <span className="pill">Room {match.roomId || 'not set'}</span>
              <span className="pill">Password {match.roomPassword || 'not set'}</span>
              <span className="pill">Created {dateTime(match.createdAt)}</span>
              {match.refundSummary ? (
                <span className="pill">Refunds {match.refundSummary.refunded} · ₹{match.refundSummary.transactionIds?.length ? '' : ''}{match.refundSummary.refunded * match.entryFee}</span>
              ) : null}
            </div>
          </div>
          <div className="row wrap">
            <Link className="btn ghost sm" to="/matches">Match list</Link>
          </div>
        </div>
      </Card>

      <div className="grid cols-4">
        <Stat label="Prize budget" value={money(budget)} foot={`${money(paidSoFar)} distributed`} tone="violet" />
        <Stat label="Remaining budget" value={money(remaining)} foot={match.prizesDistributed ? 'Distribution complete' : 'Available to assign'} tone="cyan" />
        <Stat label="Entry fee" value={money(match.entryFee)} foot={`${match.filledSlots}/${match.totalSlots} players`} />
        <Stat label="Collected" value={money(match.entryFee * match.filledSlots)} foot="Gross entry fees" tone="green" />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'prizes', label: 'Participants & prizes', count: match.participants.length },
          { value: 'history', label: 'Distribution history', count: match.distributions?.length || 0 },
          { value: 'activity', label: 'Activity log' },
          { value: 'settings', label: 'Room & schedule' },
        ]}
      />

      {tab === 'prizes' ? (
        <>
          <Card
            title="Distribute winning prizes"
            actions={
              <>
                <span className={`badge ${overBudget ? 'red' : 'green'}`}>
                  {overBudget ? `Over budget by ${money(selectedTotal - remaining)}` : `Selected ${money(selectedTotal)}`}
                </span>
                <button className="btn sm ghost" onClick={() => quickSplit('top3')}>Top 3 split</button>
                <button className="btn sm ghost" onClick={() => quickSplit('equal')}>Equal split</button>
                <button className="btn sm green" onClick={() => setConfirmDistribute(true)} disabled={!selected.length || overBudget || busy}>
                  🏆 Distribute prizes
                </button>
              </>
            }
            pad={false}
          >
            <div className="table-tools">
              <label className="check">
                <input type="checkbox" checked={selected.length === match.participants.length && match.participants.length > 0} onChange={(e) => toggleAll(e.target.checked)} />
                Select all
              </label>
              <span className="tiny muted">{selected.length} selected</span>
              <div className="spacer grow" />
              <button className="btn sm ghost" onClick={publishResults} disabled={busy || match.participants.length === 0}>
                Publish results (ranks)
              </button>
            </div>
            {match.participants.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th />
                      <th>Player</th>
                      <th>Game UID</th>
                      <th>Team</th>
                      <th className="num">Entry</th>
                      <th>Rank</th>
                      <th className="num">Prize amount</th>
                      <th>Payout status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {match.participants.map((p) => {
                      const entry = entries[p.userId] || { selected: false, amount: '', rank: '' };
                      const paid = p.payoutStatus === 'paid';
                      return (
                        <tr key={p.userId} className={entry.selected ? 'selected-row' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              checked={entry.selected}
                              onChange={(e) => setEntry(p.userId, { selected: e.target.checked })}
                              aria-label={`Select ${p.username}`}
                            />
                          </td>
                          <td>
                            <div className="user-cell">
                              <div className="avatar">{p.avatar ? <img src={p.avatar} alt="" /> : (p.username || 'P').slice(0, 2).toUpperCase()}</div>
                              <div>
                                <div style={{ fontWeight: 600 }}>{p.username}</div>
                                <div className="tiny muted">{p.ingameName} · {p.registrationId?.slice(-6)}</div>
                              </div>
                            </div>
                          </td>
                          <td className="mono tiny">{p.gameUid || '—'}</td>
                          <td className="tiny muted">{p.teamName || '—'}</td>
                          <td className="num">{money(p.entryFeePaid)}</td>
                          <td>
                            <input
                              className="input"
                              style={{ width: 66, padding: '5px 7px' }}
                              type="number"
                              min="1"
                              placeholder="#"
                              value={entry.rank}
                              onChange={(e) => setEntry(p.userId, { rank: e.target.value })}
                            />
                          </td>
                          <td className="num">
                            <input
                              className="input prize-input"
                              type="number"
                              min="0"
                              step="1"
                              placeholder="0"
                              value={entry.amount}
                              disabled={paid}
                              onChange={(e) => setEntry(p.userId, { amount: e.target.value, selected: Number(e.target.value) > 0 || entry.selected })}
                            />
                          </td>
                          <td>
                            {paid ? <Badge tone="green">Paid {money(p.prize)}</Badge> : p.payoutStatus === 'failed' ? <Badge tone="red">Failed</Badge> : <Badge tone="slate">Not paid</Badge>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon="👥" title="No players joined" hint="Share the tournament with players to fill the slots." />
            )}
          </Card>

          <div className="notice">
            Prizes are credited to each winner's <b>winning balance</b> atomically, with a separate transaction record per player. Re-running a distribution never pays the
            same player twice, and payouts can never exceed the prize budget.
          </div>
        </>
      ) : null}

      {tab === 'history' ? (
        <div className="col">
          {(match.distributions || []).length ? (
            [...match.distributions].reverse().map((d) => (
              <Card key={d.id} title={`Distribution ${d.id.slice(-6)} · ${dateTime(d.createdAt)}`} actions={<Badge tone={d.status === 'completed' ? 'green' : d.status === 'partial' ? 'amber' : 'red'}>{d.status}</Badge>}>
                <div className="row wrap small muted" style={{ marginBottom: 10 }}>
                  <span>Total ₹{money(d.paidAmount ?? d.total)} paid</span>
                  <span>Budget {money(d.budget)}</span>
                  <span>Admin {d.adminId?.slice(-6)}</span>
                  <span>{d.winners.filter((w) => w.status === 'paid').length} paid</span>
                  <span>{d.winners.filter((w) => w.status === 'failed').length} failed</span>
                  <span>{d.winners.filter((w) => w.status === 'already_paid').length} already paid</span>
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Winner</th>
                        <th className="num">Amount</th>
                        <th>Rank</th>
                        <th>Status</th>
                        <th>Transaction</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.winners.map((w) => (
                        <tr key={`${d.id}-${w.userId}`}>
                          <td>{w.username || w.userId.slice(-6)}</td>
                          <td className="num">{money(w.amount)}</td>
                          <td>{w.rank ?? '—'}</td>
                          <td>
                            <Badge tone={w.status === 'paid' ? 'green' : w.status === 'failed' ? 'red' : w.status === 'already_paid' ? 'cyan' : 'slate'}>{w.status}</Badge>
                            {w.error ? <div className="tiny muted">{w.error}</div> : null}
                          </td>
                          <td className="tiny mono">{w.transactionId ? w.transactionId.slice(-10) : '—'}</td>
                          <td>
                            {w.status === 'failed' ? (
                              <button className="btn sm amber" onClick={() => setRetryTarget({ distributionId: d.id, userId: w.userId, username: w.username, amount: w.amount })}>
                                Retry payout
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))
          ) : (
            <Empty icon="🏆" title="No prizes distributed yet" hint="Select winners in the participants tab." />
          )}
        </div>
      ) : null}

      {tab === 'activity' ? (
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <Card title="Match activity">
            <div className="timeline">
              {[...(match.activity || [])].reverse().map((a, i) => (
                <div key={`${a.at}-${i}`} className="timeline-item">
                  <span className="timeline-dot" />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12.5 }}>{a.action.replace(/_/g, ' ')}</div>
                    <div className="tiny muted">{dateTime(a.at)} · {a.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Update history (room & schedule)">
            {(match.updateHistory || []).length ? (
              [...match.updateHistory].reverse().map((u, i) => (
                <div key={`${u.at}-${i}`} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                  <div className="tiny muted">{dateTime(u.at)} · admin {u.actorId?.slice(-6)}</div>
                  <div className="small">{Object.keys(u.changes).join(', ')}</div>
                </div>
              ))
            ) : (
              <div className="muted small">No room or schedule updates yet.</div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'settings' && settings ? (
        <Card title="Room credentials & schedule">
          <form className="col" onSubmit={saveSettings}>
            {settingsError ? <div className="form-error">{settingsError}</div> : null}
            <div className="form-grid">
              <Field label="Title">
                <input className="input" value={settings.title} onChange={(e) => setSettings({ ...settings, title: e.target.value })} />
              </Field>
              <Field label="Map">
                <input className="input" value={settings.map} onChange={(e) => setSettings({ ...settings, map: e.target.value })} />
              </Field>
              <Field label="Room ID">
                <input className="input" value={settings.roomId} onChange={(e) => setSettings({ ...settings, roomId: e.target.value })} />
              </Field>
              <Field label="Room password">
                <input className="input" value={settings.roomPassword} onChange={(e) => setSettings({ ...settings, roomPassword: e.target.value })} />
              </Field>
              <Field label="Start time" className="full">
                <input
                  className="input"
                  type="datetime-local"
                  value={settings.startTime ? new Date(settings.startTime).toISOString().slice(0, 16) : ''}
                  onChange={(e) => setSettings({ ...settings, startTime: new Date(e.target.value).toISOString() })}
                />
              </Field>
            </div>
            <div className="notice amber">Saving room or schedule changes sends a push + in-app notification to every registered player.</div>
            <div className="row">
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? <span className="spinner" /> : null} Save & notify players
              </button>
              <button type="button" className="btn ghost" onClick={() => setSettings({ roomId: match.roomId, roomPassword: match.roomPassword, title: match.title, startTime: match.startTime, map: match.map })}>
                Reset
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <Modal
        open={confirmDistribute}
        title="Confirm prize distribution"
        onClose={() => setConfirmDistribute(false)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setConfirmDistribute(false)}>Cancel</button>
            <button className="btn green" onClick={distribute} disabled={busy}>
              {busy ? <span className="spinner" /> : '✓'} Confirm & distribute {money(selectedTotal)}
            </button>
          </>
        }
      >
        <div className="kv">
          <div className="kv-row"><span>Winners selected</span><b>{selected.length}</b></div>
          <div className="kv-row"><span>Total distribution</span><b>{money(selectedTotal)}</b></div>
          <div className="kv-row"><span>Remaining budget after payout</span><b>{money(Math.max(0, remaining - selectedTotal))}</b></div>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr><th>Player</th><th>Rank</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {selected.map(([userId, e]) => (
                <tr key={userId}>
                  <td>{match.participants.find((p) => p.userId === userId)?.username || userId.slice(-6)}</td>
                  <td>{e.rank || '—'}</td>
                  <td className="num">{money(Number(e.amount) || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="notice" style={{ marginTop: 12 }}>
          Balances are credited atomically. Successful payouts are never repeated; failed ones can be retried individually.
        </div>
      </Modal>

      <Modal
        open={confirmCancel}
        title="Cancel match & refund players?"
        onClose={() => setConfirmCancel(false)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setConfirmCancel(false)}>Keep match</button>
            <button className="btn red" onClick={cancelMatch} disabled={busy}>
              {busy ? <span className="spinner" /> : null} Cancel & refund
            </button>
          </>
        }
      >
        <p className="small muted">
          Each of the {match.participants.length} registered player(s) receives their entry fee back exactly once, credentials are hidden and notifications are sent.
        </p>
      </Modal>

      <Modal
        open={!!retryTarget}
        title="Retry failed payout"
        onClose={() => setRetryTarget(null)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setRetryTarget(null)}>Cancel</button>
            <button className="btn green" onClick={retry} disabled={busy}>
              {busy ? <span className="spinner" /> : null} Pay {money(retryTarget?.amount || 0)}
            </button>
          </>
        }
      >
        <p className="small muted">
          Retry the {money(retryTarget?.amount || 0)} payout for <b>{retryTarget?.username}</b>? This is safe to retry: if the player was already paid, the request is refused and no
          duplicate credit is made.
        </p>
      </Modal>
    </div>
  );
}
