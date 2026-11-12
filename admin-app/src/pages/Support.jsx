import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { dateTime } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Badge, Card, Empty, Modal, Spinner, Stat, Tabs } from '../components/ui.jsx';

export default function Support() {
  const [tickets, setTickets] = useState([]);
  const [tab, setTab] = useState('open');
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api('/api/admin/support');
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

  const reply = async () => {
    if (!message.trim()) return;
    setBusy(true);
    try {
      await api(`/api/admin/support/${active.id}/reply`, { method: 'POST', body: { message } });
      toast.success('Reply sent — the player was notified.');
      setMessage('');
      setActive(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const close = async (ticket) => {
    setBusy(true);
    try {
      await api(`/api/admin/support/${ticket.id}/close`, { method: 'POST' });
      toast.success('Ticket closed.');
      setActive(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const filtered = tab === 'all' ? tickets : tickets.filter((t) => (tab === 'open' ? t.status !== 'closed' : t.status === tab));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Support desk</h2>
          <p>Player tickets about matches, deposits, withdrawals and prizes.</p>
        </div>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={load}>↻ Refresh</button>
      </div>

      <div className="grid cols-3">
        <Stat label="Open tickets" value={tickets.filter((t) => t.status === 'open').length} tone="amber" />
        <Stat label="Answered" value={tickets.filter((t) => t.status === 'answered').length} tone="cyan" />
        <Stat label="Closed" value={tickets.filter((t) => t.status === 'closed').length} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'open', label: 'Active', count: tickets.filter((t) => t.status !== 'closed').length },
          { value: 'answered', label: 'Answered', count: tickets.filter((t) => t.status === 'answered').length },
          { value: 'closed', label: 'Closed', count: tickets.filter((t) => t.status === 'closed').length },
          { value: 'all', label: 'All', count: tickets.length },
        ]}
      />

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        {loading ? (
          <Card><Spinner /></Card>
        ) : filtered.length ? (
          filtered.map((t) => (
            <Card key={t.id}>
              <div className="between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{t.subject}</div>
                  <div className="tiny muted">{t.username} · {t.category} · {dateTime(t.createdAt)}</div>
                </div>
                <Badge tone={t.status === 'closed' ? 'slate' : t.status === 'answered' ? 'cyan' : 'amber'}>{t.status}</Badge>
              </div>
              <div className="divider" />
              <div className="small" style={{ lineHeight: 1.7 }}>
                {t.replies[0]?.message}
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn sm primary" onClick={() => { setActive(t); setMessage(''); }}>
                  Open & reply
                </button>
                {t.status !== 'closed' ? (
                  <button className="btn sm ghost" onClick={() => close(t)} disabled={busy}>Close ticket</button>
                ) : null}
                <span className="tiny muted grow" style={{ textAlign: 'right' }}>{t.replies.length} message(s)</span>
              </div>
            </Card>
          ))
        ) : (
          <Card><Empty icon="🎧" title="No tickets in this view" /></Card>
        )}
      </div>

      <Modal open={!!active} title={active?.subject || 'Ticket'} onClose={() => setActive(null)} wide>
        {active ? (
          <>
            <div className="tiny muted" style={{ marginBottom: 10 }}>{active.username} · {active.category} · {dateTime(active.createdAt)}</div>
            <div className="col" style={{ maxHeight: 320, overflowY: 'auto' }}>
              {active.replies.map((r, i) => (
                <div
                  key={`${active.id}-${i}`}
                  style={{
                    background: r.by === 'admin' ? 'rgba(34,211,238,0.07)' : 'rgba(255,255,255,0.03)',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    padding: '10px 12px',
                  }}
                >
                  <div className="tiny muted" style={{ marginBottom: 4 }}>{r.by === 'admin' ? 'Support' : 'Player'} · {dateTime(r.at)}</div>
                  <div className="small">{r.message}</div>
                </div>
              ))}
            </div>
            {active.status !== 'closed' ? (
              <div style={{ marginTop: 14 }}>
                <label className="field">
                  <span className="label">Reply</span>
                  <textarea className="input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Reply to the player…" />
                </label>
                <div className="modal-foot">
                  <button className="btn ghost" onClick={() => close(active)} disabled={busy}>Close ticket</button>
                  <button className="btn primary" onClick={reply} disabled={busy || !message.trim()}>Send reply</button>
                </div>
              </div>
            ) : (
              <div className="notice" style={{ marginTop: 12 }}>This ticket is closed.</div>
            )}
          </>
        ) : null}
      </Modal>
    </div>
  );
}
