import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { dateTime, money, STATUS_LABEL, statusClass } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Modal, Spinner, useCountdown } from '../components/ui.jsx';

export default function MatchDetail() {
  const { id } = useParams();
  const { user, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [match, setMatch] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showJoin, setShowJoin] = useState(false);
  const [form, setForm] = useState({ ingameName: user?.username || '', gameUid: user?.gameUid || '', teamName: '', useWinnings: false });
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState('');
  const starts = useCountdown(match?.startTime);
  const closes = useCountdown(match?.registrationCloseTime);

  const load = useCallback(async () => {
    try {
      const res = await api(`/api/matches/${id}`);
      setMatch(res.match);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const join = async (e) => {
    e.preventDefault();
    setBusy(true);
    setJoinError('');
    try {
      await api(`/api/matches/${id}/join`, {
        method: 'POST',
        body: {
          ingameName: form.ingameName,
          gameUid: form.gameUid,
          teamName: form.teamName,
          useWinnings: form.useWinnings,
        },
      });
      toast.success('Slot secured! Room details will appear here before the match.');
      setShowJoin(false);
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setJoinError(err.message);
      if (err.code === 'INSUFFICIENT_BALANCE') {
        setJoinError(`${err.message} Add money from the wallet page.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Copy failed — select and copy manually.');
    }
  };

  if (loading) return <div className="page"><Spinner label="Loading match…" /></div>;
  if (error) {
    return (
      <div className="page">
        <div className="card">
          <div className="form-error">{error}</div>
          <Link className="btn ghost" to="/matches" style={{ marginTop: 14 }}>
            Back to tournaments
          </Link>
        </div>
      </div>
    );
  }

  const canJoin =
    !match.joined &&
    ['registration_open', 'paused'].includes(match.status) &&
    !match.registrationPaused &&
    match.filledSlots < match.totalSlots;
  const rawStatus = match.status;

  return (
    <div className="page">
      <div className="row wrap">
        <button className="btn sm ghost" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <span className={`badge ${statusClass(rawStatus)}`}>{STATUS_LABEL[rawStatus] || rawStatus}</span>
        {match.joined ? <span className="badge open">You are registered</span> : null}
      </div>

      <section className="hero">
        <span className="kicker">{match.mode} · {match.map}</span>
        <h1>{match.title}</h1>
        <div className="row wrap small" style={{ marginTop: 10, color: '#cfcfe0' }}>
          <span>🕒 Starts {dateTime(match.startTime)}</span>
          <span>⏳ {starts}</span>
          <span>🔒 Registration closes in {closes}</span>
        </div>
        <div className="row wrap" style={{ marginTop: 18 }}>
          <div className="prize">
            {money(match.prizePool)}
            <small>Prize pool</small>
          </div>
          <div className="prize">
            {money(match.entryFee)}
            <small>Entry fee</small>
          </div>
          <div className="prize">
            {money(match.perKill)}
            <small>Per kill</small>
          </div>
          <div className="prize">
            {match.filledSlots}/{match.totalSlots}
            <small>Slots filled</small>
          </div>
        </div>
        <div className="row wrap" style={{ marginTop: 18 }}>
          {canJoin ? (
            <button className="btn primary" onClick={() => setShowJoin(true)}>
              Join for {money(match.entryFee)}
            </button>
          ) : null}
          {match.joined ? (
            <Link className="btn ghost" to="/my-matches">
              Open My Matches
            </Link>
          ) : null}
          {!match.joined && !canJoin ? (
            <span className="notice">
              {match.status === 'live'
                ? 'This match has already started. Join the next one to compete.'
                : 'Registrations are closed for this match.'}
            </span>
          ) : null}
        </div>
      </section>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="col">
          <div className="card">
            <div className="card-title">
              <h3>Room credentials</h3>
              {match.joined ? <span className="badge open">Unlocked</span> : <span className="badge closed">Players only</span>}
            </div>
            {match.roomId ? (
              <div className="col">
                <div className="code-box">
                  <div>
                    <div className="tiny muted">Room ID</div>
                    <b className="mono">{match.roomId}</b>
                  </div>
                  <button className="copy" onClick={() => copy(match.roomId, 'Room ID')}>
                    Copy
                  </button>
                </div>
                <div className="code-box">
                  <div>
                    <div className="tiny muted">Password</div>
                    <b className="mono">{match.roomPassword}</b>
                  </div>
                  <button className="copy" onClick={() => copy(match.roomPassword, 'Password')}>
                    Copy
                  </button>
                </div>
                <div className="tiny muted">Never share room details outside your team — leaking credentials can lead to disqualification.</div>
              </div>
            ) : (
              <div className="notice">
                {match.credentialsNote ||
                  (match.joined
                    ? 'Room credentials will appear here once the admin publishes them.'
                    : 'Join this tournament to unlock the private room ID and password.')}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">
              <h3>Match rules</h3>
            </div>
            <p className="small muted" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, margin: 0 }}>
              {match.rules || 'Standard tournament rules apply. No emulators, no teaming, no hacks.'}
            </p>
          </div>
        </div>

        <div className="col">
          <div className="card">
            <div className="card-title">
              <h3>Timeline</h3>
            </div>
            <div className="timeline">
              <Timeline label="Registration closes" value={dateTime(match.registrationCloseTime)} />
              <Timeline label="Match starts" value={dateTime(match.startTime)} />
              <Timeline label="Match expires / auto refund" value={dateTime(match.expiryTime)} />
              <Timeline label="Refund deadline" value={dateTime(match.refundDeadline || match.expiryTime)} />
            </div>
          </div>

          {match.participants?.length ? (
            <div className="card">
              <div className="card-title">
                <h3>Registered players</h3>
                <span className="tiny muted">{match.participants.length}</span>
              </div>
              {match.participants.map((p, i) => (
                <div key={`${p.username}-${i}`} className="player-row">
                  <div className="avatar" style={{ width: 30, height: 30, fontSize: 12 }}>
                    {i + 1}
                  </div>
                  <div className="grow">{p.username}</div>
                  {p.rank ? <span className={`rank-${p.rank}`}>#{p.rank}</span> : <span className="tiny muted">Joined</span>}
                </div>
              ))}
            </div>
          ) : null}

          <div className="card">
            <div className="card-title">
              <h3>Your registration</h3>
            </div>
            {match.joined ? (
              <div className="col small">
                <Row label="Registration ID" value={match.joinedDetails?.registrationId} />
                <Row label="In-game name" value={match.joinedDetails?.ingameName} />
                <Row label="Game UID" value={match.joinedDetails?.gameUid} />
                <Row label="Team" value={match.joinedDetails?.teamName || '—'} />
                <Row label="Entry paid" value={money(match.joinedDetails?.entryFeePaid)} />
                <Row label="Refund" value={match.joinedDetails?.refunded ? 'Refunded' : 'Not refunded'} />
              </div>
            ) : (
              <div className="muted small">You have not registered for this match yet.</div>
            )}
          </div>
        </div>
      </div>

      <Modal open={showJoin} title={`Join ${match.title}`} onClose={() => setShowJoin(false)}>
        <form className="col" onSubmit={join}>
          {joinError ? <div className="form-error">{joinError}</div> : null}
          <div className="notice">
            Entry fee {money(match.entryFee)} will be deducted from your wallet. Wallet balance: {money(user?.wallet?.balance)} · Winnings: {money(user?.wallet?.winning)}.
          </div>
          <label className="field">
            <span className="label">In-game name</span>
            <input className="input" required value={form.ingameName} onChange={(e) => setForm({ ...form, ingameName: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Free Fire UID</span>
            <input className="input" value={form.gameUid} onChange={(e) => setForm({ ...form, gameUid: e.target.value })} placeholder="1234567890" />
          </label>
          <label className="field">
            <span className="label">Team name (optional)</span>
            <input className="input" value={form.teamName} onChange={(e) => setForm({ ...form, teamName: e.target.value })} placeholder="Team Inferno" />
          </label>
          {user && user.wallet.balance < match.entryFee && user.wallet.winning > 0 ? (
            <label className="check">
              <input type="checkbox" checked={form.useWinnings} onChange={(e) => setForm({ ...form, useWinnings: e.target.checked })} />
              Use my winning balance for the remaining entry fee
            </label>
          ) : null}
          <button className="btn primary block" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : '🎟️'} Confirm registration
          </button>
        </form>
      </Modal>
    </div>
  );
}

const Timeline = ({ label, value }) => (
  <div className="timeline-item">
    <span className="timeline-dot" />
    <div>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
      <div className="tiny muted">{value}</div>
    </div>
  </div>
);

const Row = ({ label, value }) => (
  <div className="between" style={{ padding: '5px 0' }}>
    <span className="muted">{label}</span>
    <span className="mono" style={{ fontSize: 12 }}>{value || '—'}</span>
  </div>
);
