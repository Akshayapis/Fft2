import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { dateTime, money } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Badge, Card, Empty, Field, Modal, Spinner, Stat, Tabs } from '../components/ui.jsx';

export default function Withdrawals() {
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState(null);
  const [utr, setUtr] = useState('');
  const [reject, setReject] = useState(null);
  const [reason, setReason] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api('/api/admin/withdrawals');
      setRows(res.withdrawals);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/withdrawals/${pay.id}/approve`, { method: 'POST', body: { utr } });
      toast.success(`Withdrawal of ₹${pay.amount} marked as paid.`);
      setPay(null);
      setUtr('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const rejectWithdrawal = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/withdrawals/${reject.id}/reject`, { method: 'POST', body: { reason } });
      toast.success('Withdrawal rejected and refunded to the player wallet.');
      setReject(null);
      setReason('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const filtered = tab === 'all' ? rows : rows.filter((r) => r.status === tab);
  const pending = rows.filter((r) => r.status === 'pending');
  const paid = rows.filter((r) => r.status === 'paid');
  const sum = (list) => list.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Withdrawal management</h2>
          <p>Funds are held at request time. Approving confirms the UPI transfer; rejecting returns the money.</p>
        </div>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={load}>↻ Refresh</button>
      </div>

      <div className="grid cols-3">
        <Stat label="Pending withdrawals" value={pending.length} foot={money(sum(pending))} tone="amber" />
        <Stat label="Paid withdrawals" value={paid.length} foot={money(sum(paid))} tone="green" />
        <Stat label="Rejected" value={rows.filter((r) => r.status === 'rejected').length} foot="Amounts returned to wallets" />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'pending', label: 'Pending', count: pending.length },
          { value: 'paid', label: 'Paid', count: paid.length },
          { value: 'rejected', label: 'Rejected', count: rows.filter((r) => r.status === 'rejected').length },
          { value: 'all', label: 'All', count: rows.length },
        ]}
      />

      <Card pad={false}>
        {loading ? (
          <Spinner />
        ) : filtered.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Amount</th>
                  <th>UPI ID</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <div className="user-cell">
                        <div className="avatar">{(w.user?.username || 'P').slice(0, 2).toUpperCase()}</div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{w.user?.username || w.username}</div>
                          <div className="tiny muted">{w.user?.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num">{money(w.amount)}</td>
                    <td className="mono tiny">{w.upiId}</td>
                    <td className="tiny muted nowrap">{dateTime(w.createdAt)}</td>
                    <td>
                      <Badge tone={w.status === 'paid' ? 'green' : w.status === 'pending' ? 'amber' : 'red'}>{w.status}</Badge>
                      {w.utr ? <div className="tiny muted mono">UTR {w.utr}</div> : null}
                      {w.rejectReason ? <div className="tiny muted">{w.rejectReason}</div> : null}
                    </td>
                    <td className="nowrap">
                      {w.status === 'pending' ? (
                        <div className="row" style={{ gap: 5 }}>
                          <button className="btn sm green" onClick={() => setPay(w)} disabled={busy}>Mark paid</button>
                          <button className="btn sm red" onClick={() => setReject(w)} disabled={busy}>Reject</button>
                        </div>
                      ) : (
                        <span className="tiny muted">{w.reviewedAt ? dateTime(w.reviewedAt) : '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="🏦" title="No withdrawals in this view" />
        )}
      </Card>

      <Modal
        open={!!pay}
        title={`Confirm payout · ${money(pay?.amount || 0)}`}
        onClose={() => setPay(null)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setPay(null)}>Cancel</button>
            <button className="btn green" onClick={approve} disabled={busy}>Confirm paid</button>
          </>
        }
      >
        <p className="small muted">
          Send <b>{money(pay?.amount || 0)}</b> to <span className="mono">{pay?.upiId}</span>, then confirm. The player's total withdrawn amount is updated and a completed ledger
          entry is written.
        </p>
        <Field label="UPI transaction reference (optional)" className="field" >
          <input className="input" value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="UTR / reference number" />
        </Field>
      </Modal>

      <Modal
        open={!!reject}
        title="Reject withdrawal"
        onClose={() => setReject(null)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setReject(null)}>Cancel</button>
            <button className="btn red" onClick={rejectWithdrawal} disabled={busy || !reason.trim()}>Reject & refund</button>
          </>
        }
      >
        <p className="small muted">Held funds are returned to the player's wallet exactly once.</p>
        <Field label="Reason">
          <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Invalid UPI ID." />
        </Field>
      </Modal>
    </div>
  );
}
