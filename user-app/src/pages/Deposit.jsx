import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { dateTime, money } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Empty, Spinner } from '../components/ui.jsx';

const QUICK = [50, 100, 200, 500, 1000];

export default function Deposit() {
  const { config, refresh } = useAuth();
  const toast = useToast();
  const [amount, setAmount] = useState(100);
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState('upi');
  const [deposits, setDeposits] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, w] = await Promise.all([api('/api/wallet/deposits'), api('/api/wallet')]);
      setDeposits(d.deposits);
      setWallet(w.wallet);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/api/wallet/deposit', {
        method: 'POST',
        body: { amount: Number(amount), reference, method },
      });
      toast.success('Deposit request submitted. It will be credited after admin verification.');
      setReference('');
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const copyUpi = async () => {
    try {
      await navigator.clipboard.writeText(config?.upiId || '');
      toast.success('UPI ID copied');
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Add money</h1>
          <p>Deposits are verified manually to keep the wallet secure.</p>
        </div>
        <div className="spacer" />
        <Link className="btn sm ghost" to="/wallet">
          Wallet
        </Link>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">
            <h3>Deposit request</h3>
            <span className="badge open">Balance {money(wallet?.balance || 0)}</span>
          </div>
          <form className="col" onSubmit={submit}>
            {error ? <div className="form-error">{error}</div> : null}
            <div className="amount-input">
              <span>₹</span>
              <input
                type="number"
                min={config?.minDeposit || 10}
                max={config?.maxDeposit || 10000}
                step="1"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="row wrap">
              {QUICK.map((v) => (
                <button type="button" key={v} className={`btn sm ${Number(amount) === v ? 'primary' : 'ghost'}`} onClick={() => setAmount(v)}>
                  ₹{v}
                </button>
              ))}
            </div>
            <div className="row wrap">
              <label className="field grow">
                <span className="label">Payment method</span>
                <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="upi">UPI</option>
                  <option value="paytm">Paytm</option>
                  <option value="bank">Bank transfer</option>
                </select>
              </label>
              <label className="field grow">
                <span className="label">UTR / transaction reference</span>
                <input
                  className="input"
                  required
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="12 digit UTR number"
                />
              </label>
            </div>
            <div className="notice">
              Send the exact amount to <b>{config?.upiId || 'firearena@upi'}</b> then submit the UTR above.
              Limits: ₹{config?.minDeposit || 10} – ₹{config?.maxDeposit || 10000} per request.
            </div>
            <button className="btn primary block" type="submit" disabled={busy || !reference}>
              {busy ? <span className="spinner" /> : '💸'} Submit deposit
            </button>
          </form>
        </div>

        <div className="col">
          <div className="card">
            <div className="card-title">
              <h3>Pay to this UPI ID</h3>
            </div>
            <div className="code-box">
              <div>
                <div className="tiny muted">Official UPI</div>
                <b className="mono">{config?.upiId || 'firearena@upi'}</b>
              </div>
              <button className="copy" onClick={copyUpi}>
                Copy
              </button>
            </div>
            <div className="small muted" style={{ marginTop: 12 }}>
              Only use this UPI ID. Never send money to anyone claiming to be an admin in DM. Deposits are credited after verification — usually within a few hours.
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <h3>Recent deposits</h3>
            </div>
            {loading ? (
              <Spinner />
            ) : deposits.length ? (
              deposits.slice(0, 6).map((d) => (
                <div key={d.id} className="between" style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{money(d.amount)}</div>
                    <div className="tiny muted">Ref {d.reference} · {dateTime(d.createdAt)}</div>
                  </div>
                  <span className={`badge ${d.status === 'approved' ? 'open' : d.status === 'pending' ? 'warn' : 'err'}`}>{d.status}</span>
                </div>
              ))
            ) : (
              <Empty emoji="💸" title="No deposits yet" hint="Your deposit requests will be listed here." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
