import { useCallback, useEffect, useState } from 'react';
import { api, download } from '../lib/api.js';
import { dateTime, money, txLabel } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Card, Empty, Spinner, Stat } from '../components/ui.jsx';

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export default function Reports() {
  const today = new Date();
  const [from, setFrom] = useState(isoDate(new Date(today.getTime() - 29 * 86400_000)));
  const [to, setTo] = useState(isoDate(today));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/api/admin/reports/financial?from=${from}&to=${to}`);
      setReport(res);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [from, to, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Financial reports</h2>
          <p>Immutable ledger summary for deposits, withdrawals, entry fees, refunds and prizes.</p>
        </div>
        <div className="spacer" />
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 160 }} />
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 160 }} />
        <button className="btn sm ghost" onClick={load}>Apply</button>
        <button className="btn sm primary" onClick={() => download('/api/admin/reports/transactions.csv', 'fire-arena-transactions.csv')}>
          ⤓ Export CSV
        </button>
      </div>

      {loading || !report ? (
        <Card><Spinner label="Building report…" /></Card>
      ) : (
        <>
          <div className="grid cols-4">
            <Stat label="Deposits" value={money(report.summary.deposits)} foot="Approved in range" tone="green" />
            <Stat label="Withdrawals" value={money(report.summary.withdrawals)} foot="Paid in range" tone="amber" />
            <Stat label="Entry fees" value={money(report.summary.entryFees)} foot={`Prizes ${money(report.summary.prizes)}`} tone="cyan" />
            <Stat label="Net revenue" value={money(report.summary.grossRevenue)} foot="Entry − refunds − prizes" tone="violet" />
          </div>

          <div className="grid cols-3" style={{ alignItems: 'start' }}>
            <Card title="Range summary">
              <div className="kv">
                <Row label="Deposits" value={money(report.summary.deposits)} />
                <Row label="Withdrawals paid" value={money(report.summary.withdrawals)} />
                <Row label="Entry fees collected" value={money(report.summary.entryFees)} />
                <Row label="Refunds issued" value={money(report.summary.refunds)} />
                <Row label="Prizes distributed" value={money(report.summary.prizes)} />
                <Row label="Registration bonuses" value={money(report.summary.bonuses)} />
                <Row label="Manual adjustments" value={money(report.summary.adjustments)} />
                <div className="divider" />
                <Row label="Gross revenue" value={money(report.summary.grossRevenue)} strong />
                <Row label="Net cash flow" value={money(report.summary.netCashFlow)} strong />
              </div>
            </Card>

            <Card title={`Pending deposits (${report.pending.deposits.length})`}>
              {report.pending.deposits.length ? (
                report.pending.deposits.slice(0, 8).map((d) => (
                  <div key={d.id} className="kv-row">
                    <span>{d.username} · {money(d.amount)}</span>
                    <b className="tiny muted">{d.reference}</b>
                  </div>
                ))
              ) : (
                <div className="muted small">No pending deposits.</div>
              )}
            </Card>

            <Card title={`Pending withdrawals (${report.pending.withdrawals.length})`}>
              {report.pending.withdrawals.length ? (
                report.pending.withdrawals.slice(0, 8).map((w) => (
                  <div key={w.id} className="kv-row">
                    <span>{w.username} · {money(w.amount)}</span>
                    <b className="tiny muted mono">{w.upiId}</b>
                  </div>
                ))
              ) : (
                <div className="muted small">No pending withdrawals.</div>
              )}
            </Card>
          </div>

          <Card title={`Transactions in range (${report.transactions.length})`} pad={false}>
            {report.transactions.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Reference</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.transactions.slice(0, 200).map((t) => (
                      <tr key={t.id}>
                        <td><span className="pill">{txLabel(t.type)}</span></td>
                        <td className="small">{t.description}</td>
                        <td className={t.direction === 'credit' ? 'money-up' : 'money-down'}>
                          {t.direction === 'credit' ? '+' : '−'}{money(t.amount)}
                        </td>
                        <td className="tiny">{t.status}</td>
                        <td className="tiny mono">{t.reference ? t.reference.slice(-10) : '—'}</td>
                        <td className="tiny muted nowrap">{dateTime(t.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon="📈" title="No transactions in this range" />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

const Row = ({ label, value, strong = false }) => (
  <div className="kv-row">
    <span>{label}</span>
    <b style={strong ? { color: 'var(--cyan)' } : undefined}>{value}</b>
  </div>
);
