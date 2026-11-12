import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { dateTime, money } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Empty, Spinner } from '../components/ui.jsx';

export default function Withdraw() {
  const { config, refresh } = useAuth();
  const toast = useToast();
  const [wallet, setWallet] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [amount, setAmount] = useState('');
  const [upiId, setUpiId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [w, list] = await Promise.all([api('/api/wallet'), api('/api/wallet/withdrawals')]);
      setWallet(w.wallet);
      setWithdrawals(list.withdrawals);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const available = (wallet?.winning || 0) + (wallet?.balance || 0);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/api/wallet/withdraw', { method: 'POST', body: { amount: Number(amount), upiId } });
      toast.success('Withdrawal requested. Funds are on hold until the admin approves.');
      setAmount('');
      await Promise.all([load(), refresh()]);
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
          <h1>Withdraw</h1>
          <p>Withdraw prize money or wallet balance directly to UPI.</p>
        </div>
        <div className="spacer" />
        <Link className="btn sm ghost" to="/wallet">
          Wallet
        </Link>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">
            <h3>Request withdrawal</h3>
            <span className="badge gold">Available {money(available)}</span>
          </div>
          <form className="col" onSubmit={submit}>
            {error ? <div className="form-error">{error}</div> : null}
            <div className="amount-input">
              <span>₹</span>
              <input
                type="number"
                min={config?.minWithdrawal || 50}
                max={config?.maxWithdrawal || 5000}
                step="1"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="row wrap">
              <button type="button" className="btn sm ghost" onClick={() => setAmount(String(Math.min(wallet?.winning || 0, config?.maxWithdrawal || 5000)))}>
                Prize money
              </button>
              <button type="button" className="btn sm ghost" onClick={() => setAmount(String(Math.min(available, config?.maxWithdrawal || 5000)))}>
                Max
              </button>
            </div>
            <label className="field">
              <span className="label">UPI ID</span>
              <input className="input" required value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="yourname@upi" />
            </label>
            <div className="notice">
              Minimum ₹{config?.minWithdrawal || 50}, maximum ₹{config?.maxWithdrawal || 5000} per request.
              Winning balance is used first, then wallet balance. Requests are usually paid within a few hours.
            </div>
            <button className="btn primary block" type="submit" disabled={busy || !available}>
              {busy ? <span className="spinner" /> : '🏦'} Request withdrawal
            </button>
          </form>
        </div>

        <div className="card">
          <div className="card-title">
            <h3>Withdrawal history</h3>
          </div>
          {loading ? (
            <Spinner />
          ) : withdrawals.length ? (
            <div className="col">
              {withdrawals.map((w) => (
                <div key={w.id} className="between" style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{money(w.amount)} → {w.upiId}</div>
                    <div className="tiny muted">{dateTime(w.createdAt)}{w.rejectReason ? ` · ${w.rejectReason}` : ''}</div>
                  </div>
                  <span className={`badge ${w.status === 'paid' ? 'open' : w.status === 'pending' ? 'warn' : 'err'}`}>{w.status}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty emoji="🏦" title="No withdrawals yet" hint="Prize money can be withdrawn to UPI." />
          )}

          <div className="divider" style={{ margin: '14px 0' }} />
          <div className="small muted">
            Prize breakdown: winning {money(wallet?.winning || 0)} + wallet {money(wallet?.balance || 0)}.
          </div>
        </div>
      </div>
    </div>
  );
}
