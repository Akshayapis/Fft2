import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { dateTime } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Empty, Spinner } from '../components/ui.jsx';

export default function Support() {
  const { config } = useAuth();
  const toast = useToast();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('general');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [reply, setReply] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api('/api/support');
      setTickets(res.tickets);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/support', { method: 'POST', body: { subject, message, category } });
      toast.success('Support ticket created. Our team will reply soon.');
      setSubject('');
      setMessage('');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async (ticket) => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await api(`/api/support/${ticket.id}/reply`, { method: 'POST', body: { message: reply } });
      setReply('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Support</h1>
          <p>Need help with a match, deposit or withdrawal? Open a ticket.</p>
        </div>
      </div>

      <div className="grid cols-3 small">
        <div className="card">
          <div className="card-title"><h3>✉️ Email</h3></div>
          <div className="muted">{config?.supportEmail || 'support@firearena.gg'}</div>
        </div>
        <div className="card">
          <div className="card-title"><h3>💬 WhatsApp</h3></div>
          <div className="muted">{config?.supportWhatsapp || '+91 90000 00000'}</div>
        </div>
        <div className="card">
          <div className="card-title"><h3>⏱️ Response time</h3></div>
          <div className="muted">Usually within 2–4 hours</div>
        </div>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">
            <h3>New ticket</h3>
          </div>
          <form className="col" onSubmit={create}>
            <label className="field">
              <span className="label">Subject</span>
              <input className="input" required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Prize not credited" />
            </label>
            <label className="field">
              <span className="label">Category</span>
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="general">General</option>
                <option value="match">Match issue</option>
                <option value="wallet">Deposit / withdrawal</option>
                <option value="payout">Prize payout</option>
                <option value="security">Account security</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Message</span>
              <textarea className="input" required value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe the issue with match ID or transaction reference…" />
            </label>
            <button className="btn primary block" disabled={busy} type="submit">
              {busy ? <span className="spinner" /> : '🎧'} Open ticket
            </button>
          </form>
        </div>

        <div className="card">
          <div className="card-title">
            <h3>Your tickets</h3>
            <span className="tiny muted">{tickets.length}</span>
          </div>
          {loading ? (
            <Spinner />
          ) : tickets.length ? (
            tickets.map((t) => (
              <div key={t.id} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 10 }}>
                <div className="between" style={{ cursor: 'pointer' }} onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t.subject}</div>
                    <div className="tiny muted">
                      {t.category} · {dateTime(t.createdAt)} · {t.replies.length} message(s)
                    </div>
                  </div>
                  <span className={`badge ${t.status === 'closed' ? 'closed' : t.status === 'answered' ? 'open' : 'warn'}`}>{t.status}</span>
                </div>

                {openId === t.id ? (
                  <div className="col" style={{ marginTop: 10 }}>
                    {t.replies.map((r, i) => (
                      <div
                        key={`${t.id}-${i}`}
                        style={{
                          background: r.by === 'admin' ? 'rgba(255,90,31,0.09)' : 'rgba(255,255,255,0.04)',
                          border: '1px solid var(--line)',
                          borderRadius: 12,
                          padding: '9px 12px',
                          fontSize: 13,
                        }}
                      >
                        <div className="tiny muted" style={{ marginBottom: 3 }}>
                          {r.by === 'admin' ? 'Support team' : 'You'} · {dateTime(r.at)}
                        </div>
                        {r.message}
                      </div>
                    ))}
                    {t.status !== 'closed' ? (
                      <div className="row">
                        <input className="input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Add a reply…" />
                        <button className="btn sm primary" onClick={() => sendReply(t)} disabled={busy}>
                          Send
                        </button>
                      </div>
                    ) : (
                      <div className="tiny muted">This ticket is closed.</div>
                    )}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <Empty emoji="🎧" title="No tickets yet" hint="Open a ticket and our team will help you out." />
          )}
        </div>
      </div>
    </div>
  );
}
