import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { dateTime, money } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Badge, Card, Empty, Modal, Spinner, Stat, Tabs } from '../components/ui.jsx';

export default function Deposits() {
  const [deposits, setDeposits] = useState([]);
  const [tab, setTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reject, setReject] = useState(null);
  const [reason, setReason] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api('/api/admin/deposits');
      setDeposits(res.deposits);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (d) => {
    setBusy(true);
    try {
      await api(`/api/admin/deposits/${d.id}/approve`, { method: 'POST' });
      toast.success(`₹${d.amount} credited to ${d.user?.username || 'player'}.`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const rejectDeposit = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/deposits/${reject.id}/reject`, { method: 'POST', body: { reason } });
      toast.success('Deposit rejected and the player was notified.');
      setReject(null);
      setReason('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const filtered = tab === 'all' ? deposits : deposits.filter((d) => d.status === tab);
  const pending = deposits.filter((d) => d.status === 'pending');
  const approved = deposits.filter((d) => d.status === 'approved');
  const sum = (rows) => rows.reduce((s, d) => s + d.amount, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Deposit management</h2>
          <p>Verify UPI payments and credit player wallets. Approval is idempotent — no double credits.</p>
        </div>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={load}>↻ Refresh</button>
      </div>

      <div className="grid cols-3">
        <Stat label="Pending deposits" value={pending.length} foot={money(sum(pending))} tone="amber" />
        <Stat label="Approved deposits" value={approved.length} foot={money(sum(approved))} tone="green" />
        <Stat label="Rejected" value={deposits.filter((d) => d.status === 'rejected').length} foot="Payment could not be verified" />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'pending', label: 'Pending', count: pending.length },
          { value: 'approved', label: 'Approved', count: approved.length },
          { value: 'rejected', label: 'Rejected', count: deposits.filter((d) => d.status === 'rejected').length },
          { value: 'all', label: 'All', count: deposits.length },
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
                  <th>Method</th>
                  <th>UTR / reference</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <div className="user-cell">
                        <div className="avatar">{(d.user?.username || 'P').slice(0, 2).toUpperCase()}</div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{d.user?.username || d.username}</div>
                          <div className="tiny muted">{d.user?.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num">{money(d.amount)}</td>
                    <td><span className="pill">{d.method}</span></td>
                    <td className="mono tiny">{d.reference}</td>
                    <td className="tiny muted nowrap">{dateTime(d.createdAt)}</td>
                    <td>
                      <Badge tone={d.status === 'approved' ? 'green' : d.status === 'pending' ? 'amber' : 'red'}>{d.status}</Badge>
                      {d.rejectReason ? <div className="tiny muted">{d.rejectReason}</div> : null}
                    </td>
                    <td className="nowrap">
                      {d.status === 'pending' ? (
                        <div className="row" style={{ gap: 5 }}>
                          <button className="btn sm green" onClick={() => approve(d)} disabled={busy}>Approve</button>
                          <button className="btn sm red" onClick={() => setReject(d)} disabled={busy}>Reject</button>
                        </div>
                      ) : (
                        <span className="tiny muted">{d.reviewedAt ? dateTime(d.reviewedAt) : '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon="💸" title="No deposits in this view" />
        )}
      </Card>

      <Modal
        open={!!reject}
        title="Reject deposit"
        onClose={() => setReject(null)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setReject(null)}>Cancel</button>
            <button className="btn red" onClick={rejectDeposit} disabled={busy || !reason.trim()}>Reject deposit</button>
          </>
        }
      >
        <p className="small muted">
          Rejecting never credits the wallet. The player receives a notification with your reason.
        </p>
        <label className="field" style={{ marginTop: 12 }}>
          <span className="label">Reason</span>
          <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="UTR not found in our bank statement." />
        </label>
      </Modal>
    </div>
  );
}
