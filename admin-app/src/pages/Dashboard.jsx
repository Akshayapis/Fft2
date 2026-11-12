import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { dateOnly, dateTime, money, relative, statusTone, STATUS_LABEL } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Badge, Card, Empty, Spinner, Stat } from '../components/ui.jsx';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api('/api/admin/overview');
      setData(res);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const act = async (path, message) => {
    try {
      await api(path, { method: 'POST' });
      toast.success(message);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading || !data) return <div className="page"><Spinner label="Loading dashboard…" /></div>;

  const { totals, finance, charts, recent, push } = data;
  const maxDeposit = Math.max(...charts.map((c) => c.deposits), 1);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Operations overview</h2>
          <p>Live view of players, tournaments, wallets and pending approvals.</p>
        </div>
        <div className="spacer" />
        <Link className="btn ghost sm" to="/reports">
          Financial reports
        </Link>
        <Link className="btn primary sm" to="/matches">
          Manage matches
        </Link>
      </div>

      {!push?.configured ? (
        <div className="notice amber">
          🔕 <b>Push notifications are not configured.</b> {push?.reason} In-app notifications, device registration and security alerts are fully working; add FCM
          service-account credentials to send real background pushes.
        </div>
      ) : (
        <div className="form-ok">📲 Firebase Cloud Messaging is connected — background push notifications are live.</div>
      )}

      <div className="grid cols-4">
        <Stat label="Total players" value={totals.users} foot={`${totals.activeUsers7d} active in 7 days`} tone="cyan" />
        <Stat label="Tournaments" value={totals.matches} foot={`${totals.liveMatches} live · ${totals.completedMatches} completed`} tone="violet" />
        <Stat label="Gross revenue" value={money(finance.revenue)} foot="Entry fees − refunds − prizes" tone="green" />
        <Stat label="Pending approvals" value={finance.pendingDeposits + finance.pendingWithdrawals} foot={`${money(finance.pendingDepositAmount + finance.pendingWithdrawalAmount)} in queue`} tone="amber" />
      </div>

      <div className="grid cols-3" style={{ alignItems: 'start' }}>
        <Card title="Last 7 days" className="cols-span-2" actions={<span className="tiny muted">Approved deposits</span>}>
          <div className="chart">
            {charts.map((c) => (
              <div key={c.date} className="chart-col" title={`${c.date}: ${money(c.deposits)}`}>
                <div className="chart-bar" style={{ height: `${Math.max(4, (c.deposits / maxDeposit) * 100)}%` }} />
                <div className="chart-label">{c.date.slice(5)}</div>
                <div className="tiny muted" style={{ fontSize: 9 }}>{c.signups} new</div>
              </div>
            ))}
          </div>
          <div className="divider" />
          <div className="row wrap small muted">
            <span>💰 Deposits {money(finance.approvedDeposits)}</span>
            <span>🎟️ Entry fees {money(finance.entryFees)}</span>
            <span>🏆 Prizes {money(finance.prizes)}</span>
            <span>↩️ Refunds {money(finance.refunds)}</span>
          </div>
        </Card>

        <Card title="Wallet & payouts">
          <div className="kv">
            <Row label="Deposits approved" value={money(finance.approvedDeposits)} tone="money-up" />
            <Row label="Withdrawals paid" value={money(finance.paidWithdrawals)} tone="money-down" />
            <Row label="Entry fees collected" value={money(finance.entryFees)} />
            <Row label="Prizes distributed" value={money(finance.prizes)} />
            <Row label="Refunds issued" value={money(finance.refunds)} />
            <Row label="Welcome bonuses" value={money(finance.bonuses)} />
            <Row label="Net revenue" value={money(finance.revenue)} tone="money-up" />
            <Row label="Active devices" value={totals.activeDevices} />
            <Row label="Active sessions" value={totals.activeSessions} />
          </div>
        </Card>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card
          title="Pending deposits"
          actions={<Link className="btn sm ghost" to="/deposits">View all</Link>}
          pad={false}
        >
          {recent.deposits.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th className="num">Amount</th>
                    <th>Reference</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recent.deposits.map((d) => (
                    <tr key={d.id}>
                      <td>{d.username || d.userId.slice(-6)}</td>
                      <td className="num">{money(d.amount)}</td>
                      <td className="tiny muted">{d.reference}</td>
                      <td className="nowrap">
                        <button className="btn sm green" onClick={() => act(`/api/admin/deposits/${d.id}/approve`, 'Deposit approved')}>
                          Approve
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="✅" title="No pending deposits" />
          )}
        </Card>

        <Card title="Pending withdrawals" actions={<Link className="btn sm ghost" to="/withdrawals">View all</Link>} pad={false}>
          {recent.withdrawals.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th className="num">Amount</th>
                    <th>UPI</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recent.withdrawals.map((w) => (
                    <tr key={w.id}>
                      <td>{w.username || w.userId.slice(-6)}</td>
                      <td className="num">{money(w.amount)}</td>
                      <td className="tiny muted mono">{w.upiId}</td>
                      <td className="nowrap">
                        <button className="btn sm green" onClick={() => act(`/api/admin/withdrawals/${w.id}/approve`, 'Withdrawal marked as paid')}>
                          Mark paid
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="✅" title="No pending withdrawals" />
          )}
        </Card>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card title="Recent tournaments" actions={<Link className="btn sm ghost" to="/matches">All matches</Link>} pad={false}>
          {recent.matches.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th>Starts</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.matches.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <Link to={`/matches/${m.id}`} style={{ fontWeight: 600 }}>{m.title}</Link>
                      </td>
                      <td><Badge tone={statusTone(m.status)}>{STATUS_LABEL[m.status] || m.status}</Badge></td>
                      <td className="num">{m.filled}/{m.slots}</td>
                      <td className="tiny muted nowrap">{dateTime(m.startTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="🎯" title="No matches yet" hint="Create your first tournament." />
          )}
        </Card>

        <Card title="Newest players" actions={<Link className="btn sm ghost" to="/users">All users</Link>} pad={false}>
          {recent.users.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Email</th>
                    <th>Joined</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.users.map((u) => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600 }}>{u.username}</td>
                      <td className="tiny muted">{u.email}</td>
                      <td className="tiny muted nowrap">{dateOnly(u.createdAt)}</td>
                      <td><Badge tone={u.banned ? 'red' : 'green'}>{u.banned ? 'Blocked' : 'Active'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="👥" title="No players yet" />
          )}
        </Card>
      </div>

      <div className="tiny muted">
        Last refreshed {relative(new Date().toISOString())} · {totals.bannedUsers} blocked account(s) · {totals.openTickets} open support ticket(s)
      </div>
    </div>
  );
}

const Row = ({ label, value, tone = '' }) => (
  <div className="kv-row">
    <span>{label}</span>
    <b className={tone}>{value}</b>
  </div>
);
