import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { dateOnly, dateTime, money, relative, txLabel } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Badge, Card, Empty, Field, Modal, Spinner } from '../components/ui.jsx';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [detailTab, setDetailTab] = useState('wallet');
  const [adjustTarget, setAdjustTarget] = useState(null);
  const [adjust, setAdjust] = useState({ amount: '', direction: 'credit', bucket: 'balance', reason: '' });
  const [busy, setBusy] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(null);
  const [note, setNote] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api('/api/admin/users');
      setUsers(res.users);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (user) => {
    try {
      const res = await api(`/api/admin/users/${user.id}`);
      setDetail(res);
      setDetailTab('wallet');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleBlock = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/users/${confirmBlock.id}`, {
        method: 'PATCH',
        body: { banned: !confirmBlock.banned, note },
      });
      toast.success(confirmBlock.banned ? 'Account unblocked.' : 'Account blocked and sessions revoked.');
      setConfirmBlock(null);
      setNote('');
      await load();
      if (detail) openDetail(detail.user);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitAdjust = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/admin/users/${adjustTarget.id}/adjust`, {
        method: 'POST',
        body: { amount: Number(adjust.amount), direction: adjust.direction, bucket: adjust.bucket, reason: adjust.reason },
      });
      toast.success('Wallet adjusted and the player was notified.');
      setAdjustTarget(null);
      setAdjust({ amount: '', direction: 'credit', bucket: 'balance', reason: '' });
      await load();
      if (detail) openDetail(detail.user);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const filtered = users.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return u.username.toLowerCase().includes(q) || u.email.includes(q) || (u.gameUid || '').includes(q);
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>User management</h2>
          <p>Search players, review history, adjust wallets and block abusive accounts.</p>
        </div>
        <div className="spacer" />
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search name, email or UID…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <Card pad={false}>
        {loading ? (
          <Spinner />
        ) : filtered.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Game UID</th>
                  <th className="num">Wallet</th>
                  <th className="num">Winnings</th>
                  <th className="num">Won</th>
                  <th>Devices</th>
                  <th>Joined</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="user-cell">
                        <div className="avatar">{u.avatar ? <img src={u.avatar} alt="" /> : u.username.slice(0, 2).toUpperCase()}</div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{u.username} {u.role === 'admin' ? <Badge tone="cyan">admin</Badge> : null}</div>
                          <div className="tiny muted">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono tiny">{u.gameUid || '—'}</td>
                    <td className="num">{money(u.wallet.balance)}</td>
                    <td className="num">{money(u.wallet.winning)}</td>
                    <td className="num">{money(u.wallet.totalWon)}</td>
                    <td className="num">{u.devices}</td>
                    <td className="tiny muted nowrap">{dateOnly(u.createdAt)}</td>
                    <td><Badge tone={u.banned ? 'red' : 'green'}>{u.banned ? 'Blocked' : 'Active'}</Badge></td>
                    <td className="nowrap">
                      <div className="row" style={{ gap: 5 }}>
                        <button className="btn sm ghost" onClick={() => openDetail(u)}>View</button>
                        <button className="btn sm ghost" onClick={() => setAdjustTarget(u)}>₹</button>
                        <button className={`btn sm ${u.banned ? 'green' : 'red'}`} onClick={() => setConfirmBlock(u)}>
                          {u.banned ? 'Unblock' : 'Block'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="👥" title="No players match this search" />
        )}
      </Card>

      {detail ? (
        <div className="drawer">
          <div className="between" style={{ marginBottom: 14 }}>
            <div className="row">
              <div className="avatar lg">{detail.user.avatar ? <img src={detail.user.avatar} alt="" /> : detail.user.username.slice(0, 2).toUpperCase()}</div>
              <div>
                <h3 style={{ fontSize: 16 }}>{detail.user.username}</h3>
                <div className="tiny muted">{detail.user.email} · joined {dateOnly(detail.user.createdAt)}</div>
                <div className="row" style={{ marginTop: 4 }}>
                  <Badge tone={detail.user.banned ? 'red' : 'green'}>{detail.user.banned ? 'Blocked' : 'Active'}</Badge>
                  <Badge tone="cyan">{detail.user.role}</Badge>
                </div>
              </div>
            </div>
            <button className="icon-btn" onClick={() => setDetail(null)}>✕</button>
          </div>

          <div className="grid cols-3" style={{ marginBottom: 14 }}>
            <div className="stat"><div className="stat-label">Wallet</div><div className="stat-value" style={{ fontSize: 17 }}>{money(detail.user.wallet.balance)}</div></div>
            <div className="stat"><div className="stat-label">Winnings</div><div className="stat-value" style={{ fontSize: 17 }}>{money(detail.user.wallet.winning)}</div></div>
            <div className="stat"><div className="stat-label">Total won</div><div className="stat-value" style={{ fontSize: 17 }}>{money(detail.user.wallet.totalWon)}</div></div>
          </div>

          <div className="row wrap" style={{ marginBottom: 12 }}>
            <button className="btn sm primary" onClick={() => setAdjustTarget(detail.user)}>Adjust wallet</button>
            <button className="btn sm ghost" onClick={() => setConfirmBlock(detail.user)}>{detail.user.banned ? 'Unblock' : 'Block account'}</button>
          </div>

          <div className="tabs" style={{ marginBottom: 12 }}>
            {[
              ['wallet', `Transactions (${detail.transactions.length})`],
              ['devices', `Devices (${detail.devices.length})`],
              ['matches', `Matches (${detail.matches.length})`],
              ['requests', 'Deposits & withdrawals'],
              ['security', `Security (${detail.securityEvents.length})`],
            ].map(([key, label]) => (
              <button key={key} className={`tab ${detailTab === key ? 'active' : ''}`} onClick={() => setDetailTab(key)}>{label}</button>
            ))}
          </div>

          {detailTab === 'wallet' ? (
            <table className="table">
              <thead><tr><th>Type</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>
                {detail.transactions.slice(0, 40).map((t) => (
                  <tr key={t.id}>
                    <td>{txLabel(t.type)}<div className="tiny muted">{t.description}</div></td>
                    <td className={t.direction === 'credit' ? 'money-up' : 'money-down'}>{t.direction === 'credit' ? '+' : '−'}{money(t.amount)}</td>
                    <td><Badge tone={t.status === 'completed' || t.status === 'approved' ? 'green' : t.status === 'pending' ? 'amber' : 'red'}>{t.status}</Badge></td>
                    <td className="tiny muted">{dateTime(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {detailTab === 'devices' ? (
            detail.devices.length ? detail.devices.map((d) => (
              <div key={d.id} className="between" style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12.5 }}>{d.name} <Badge tone={d.revoked ? 'red' : 'green'}>{d.revoked ? 'revoked' : 'active'}</Badge></div>
                  <div className="tiny muted">{d.os} · {d.browser} · {d.ip || 'IP unknown'} · last active {relative(d.lastActiveAt)}</div>
                </div>
                <span className="tiny muted">{d.firstLoginAt ? dateOnly(d.firstLoginAt) : ''}</span>
              </div>
            )) : <Empty icon="📱" title="No devices" />
          ) : null}

          {detailTab === 'matches' ? (
            detail.matches.length ? (
              <table className="table">
                <thead><tr><th>Match</th><th>Status</th><th>Rank</th><th>Prize</th><th>Refund</th></tr></thead>
                <tbody>
                  {detail.matches.map((m) => (
                    <tr key={m.matchId}>
                      <td>{m.title}</td>
                      <td><Badge tone="slate">{m.status}</Badge></td>
                      <td>{m.rank || '—'}</td>
                      <td>{money(m.prize)}</td>
                      <td>{m.refunded ? <Badge tone="amber">refunded</Badge> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty icon="🎯" title="No matches joined" />
          ) : null}

          {detailTab === 'requests' ? (
            <div className="col">
              <div className="section-title">Deposits</div>
              {detail.deposits.length ? detail.deposits.map((d) => (
                <div key={d.id} className="between small" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                  <span>{money(d.amount)} · <span className="mono tiny">{d.reference}</span></span>
                  <Badge tone={d.status === 'approved' ? 'green' : d.status === 'pending' ? 'amber' : 'red'}>{d.status}</Badge>
                </div>
              )) : <div className="tiny muted">No deposits</div>}
              <div className="section-title" style={{ marginTop: 10 }}>Withdrawals</div>
              {detail.withdrawals.length ? detail.withdrawals.map((w) => (
                <div key={w.id} className="between small" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                  <span>{money(w.amount)} → <span className="mono tiny">{w.upiId}</span></span>
                  <Badge tone={w.status === 'paid' ? 'green' : w.status === 'pending' ? 'amber' : 'red'}>{w.status}</Badge>
                </div>
              )) : <div className="tiny muted">No withdrawals</div>}
            </div>
          ) : null}

          {detailTab === 'security' ? (
            <div className="timeline">
              {detail.securityEvents.slice().reverse().map((e) => (
                <div key={e.id} className="timeline-item">
                  <span className="timeline-dot" />
                  <div>
                    <div className="small" style={{ fontWeight: 600 }}>{e.message}</div>
                    <div className="tiny muted">{dateTime(e.createdAt)} · {e.type}{e.ip ? ` · ${e.ip}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <Modal open={!!adjustTarget} title={`Adjust wallet · ${adjustTarget?.username || ''}`} onClose={() => setAdjustTarget(null)}>
        <form className="col" onSubmit={submitAdjust}>
          <div className="form-grid">
            <Field label="Direction">
              <select className="input" value={adjust.direction} onChange={(e) => setAdjust({ ...adjust, direction: e.target.value })}>
                <option value="credit">Credit (add)</option>
                <option value="debit">Debit (subtract)</option>
              </select>
            </Field>
            <Field label="Bucket">
              <select className="input" value={adjust.bucket} onChange={(e) => setAdjust({ ...adjust, bucket: e.target.value })}>
                <option value="balance">Wallet balance</option>
                <option value="winning">Winning balance</option>
              </select>
            </Field>
            <Field label="Amount (₹)" className="full">
              <input className="input" type="number" min="1" step="1" required value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} />
            </Field>
            <Field label="Reason" className="full">
              <input className="input" required value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} placeholder="Goodwill credit for delayed payout" />
            </Field>
          </div>
          <div className="notice">Adjustments are recorded in the immutable ledger and the player is notified.</div>
          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={() => setAdjustTarget(null)}>Cancel</button>
            <button className="btn primary" type="submit" disabled={busy}>Apply adjustment</button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!confirmBlock}
        title={confirmBlock?.banned ? 'Unblock account?' : 'Block account?'}
        onClose={() => setConfirmBlock(null)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setConfirmBlock(null)}>Cancel</button>
            <button className={`btn ${confirmBlock?.banned ? 'green' : 'red'}`} onClick={toggleBlock} disabled={busy}>
              {confirmBlock?.banned ? 'Unblock' : 'Block & revoke sessions'}
            </button>
          </>
        }
      >
        <p className="small muted">
          {confirmBlock?.banned
            ? 'The player can sign in again immediately.'
            : 'All active sessions are revoked instantly and the player cannot sign in until unblocked.'}
        </p>
        <Field label="Internal note">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for the action" />
        </Field>
      </Modal>
    </div>
  );
}
