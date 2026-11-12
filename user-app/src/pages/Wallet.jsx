import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { dateTime, money, txLabel } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Empty, Modal, Spinner, Stat, Tabs } from '../components/ui.jsx';

export default function Wallet() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [showTransfer, setShowTransfer] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [w, d, wd] = await Promise.all([
        api('/api/wallet'),
        api('/api/wallet/deposits'),
        api('/api/wallet/withdrawals'),
      ]);
      setWallet(w.wallet);
      setTransactions(w.transactions);
      setDeposits(d.deposits);
      setWithdrawals(wd.withdrawals);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const transfer = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/wallet/transfer-winnings', { method: 'POST', body: { amount: Number(amount) } });
      toast.success('Winnings moved to your wallet balance.');
      setShowTransfer(false);
      setAmount('');
      await Promise.all([load(), refresh()]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const w = wallet || user?.wallet || { balance: 0, winning: 0, totalDeposited: 0, totalWithdrawn: 0, totalWon: 0 };
  const filtered = tab === 'all' ? transactions : transactions.filter((t) => t.type === tab);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Wallet</h1>
          <p>Deposits, entry fees, refunds and prize money — full ledger history.</p>
        </div>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={load}>
          ↻ Refresh
        </button>
      </div>

      <div className="grid cols-3">
        <Stat label="Wallet balance" value={money(w.balance)} foot="Usable for entry fees" tone="accent" />
        <Stat label="Winning balance" value={money(w.winning)} foot="Withdrawable prize money" tone="gold" />
        <Stat label="Total won" value={money(w.totalWon)} foot={`${user?.stats?.wins || 0} wins`} tone="ok" />
      </div>

      <div className="card">
        <div className="between wrap" style={{ gap: 14 }}>
          <div className="row wrap">
            <Link className="btn primary" to="/deposit">
              ＋ Add money
            </Link>
            <Link className="btn ghost" to="/withdraw">
              ↗ Withdraw
            </Link>
            <button className="btn ghost" onClick={() => setShowTransfer(true)} disabled={!w.winning}>
              ⇄ Move winnings to wallet
            </button>
          </div>
          <div className="tiny muted">
            Deposited {money(w.totalDeposited)} · Withdrawn {money(w.totalWithdrawn)}
          </div>
        </div>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">
            <h3>Pending requests</h3>
          </div>
          {[...deposits.filter((d) => d.status === 'pending'), ...withdrawals.filter((x) => x.status === 'pending')].length ? (
            <div className="col">
              {deposits
                .filter((d) => d.status === 'pending')
                .map((d) => (
                  <div key={d.id} className="between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>Deposit {money(d.amount)}</div>
                      <div className="tiny muted">Ref {d.reference} · {dateTime(d.createdAt)}</div>
                    </div>
                    <span className="badge warn">Pending</span>
                  </div>
                ))}
              {withdrawals
                .filter((x) => x.status === 'pending')
                .map((x) => (
                  <div key={x.id} className="between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>Withdrawal {money(x.amount)}</div>
                      <div className="tiny muted">To {x.upiId} · {dateTime(x.createdAt)}</div>
                    </div>
                    <span className="badge warn">Pending</span>
                  </div>
                ))}
            </div>
          ) : (
            <div className="muted small">No pending requests. Deposits and withdrawals are usually reviewed within a few hours.</div>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <h3>History summary</h3>
          </div>
          <div className="col small">
            <SummaryRow label="Deposits" items={deposits} status="approved" tone="var(--ok)" />
            <SummaryRow label="Withdrawals" items={withdrawals} status="paid" tone="var(--accent)" />
            <SummaryRow label="Rejected requests" items={[...deposits, ...withdrawals]} status="rejected" tone="var(--err)" />
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 10px' }}>
          <div className="card-title" style={{ marginBottom: 10 }}>
            <h3>Transactions</h3>
            <span className="tiny muted">{transactions.length} entries</span>
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'all', label: 'All' },
              { value: 'entry_fee', label: 'Entry' },
              { value: 'prize', label: 'Prizes' },
              { value: 'refund', label: 'Refunds' },
              { value: 'deposit', label: 'Deposits' },
              { value: 'withdrawal', label: 'Withdrawals' },
            ]}
          />
        </div>

        {loading ? (
          <Spinner />
        ) : filtered.length ? (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Details</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span className="pill">{txLabel(t.type)}</span>
                    </td>
                    <td className="small">
                      {t.description}
                      {t.matchId ? <div className="tiny muted">Match {t.matchId.slice(-8)}</div> : null}
                    </td>
                    <td className="tiny muted">{dateTime(t.createdAt)}</td>
                    <td style={{ color: t.direction === 'credit' ? 'var(--ok)' : 'var(--err)', fontWeight: 600 }}>
                      {t.direction === 'credit' ? '+' : '−'}
                      {money(t.amount)}
                    </td>
                    <td>
                      <span className={`badge ${t.status === 'completed' || t.status === 'approved' ? 'open' : t.status === 'pending' ? 'warn' : 'err'}`}>
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty emoji="🧾" title="No transactions yet" hint="Your wallet activity will appear here." />
        )}
      </div>

      <Modal open={showTransfer} title="Move winnings to wallet" onClose={() => setShowTransfer(false)}>
        <form className="col" onSubmit={transfer}>
          <div className="notice">
            Winnings {money(w.winning)} can be moved to your wallet balance (used for entry fees) or withdrawn directly.
          </div>
          <div className="amount-input">
            <span>₹</span>
            <input
              type="number"
              min="1"
              max={w.winning}
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="row">
            <button type="button" className="btn sm ghost" onClick={() => setAmount(String(w.winning))}>
              Max
            </button>
            <div className="grow" />
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? <span className="spinner" /> : 'Transfer'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

const SummaryRow = ({ label, items, status, tone }) => {
  const total = items.filter((i) => i.status === status).reduce((sum, i) => sum + i.amount, 0);
  return (
    <div className="between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="muted">{label}</span>
      <span style={{ color: tone, fontWeight: 600 }}>{money(total)}</span>
    </div>
  );
};
