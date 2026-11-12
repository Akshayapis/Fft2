import { Link } from 'react-router-dom';
import { dateTime, money, STATUS_LABEL, statusClass } from '../lib/format.js';
import { useCountdown } from './ui.jsx';

const MODE_ICON = { solo: '🎯', duo: '👥', squad: '🛡️', clash: '⚔️' };

export default function MatchCard({ match, compact = false }) {
  const fill = Math.min(100, Math.round((match.filledSlots / Math.max(1, match.totalSlots)) * 100));
  const starts = useCountdown(match.startTime);
  const closed = ['cancelled', 'expired', 'completed'].includes(match.status);

  return (
    <article className="match-card">
      <div className="match-banner">
        <div className="row">
          <span style={{ fontSize: 18 }}>{MODE_ICON[match.mode] || '🎮'}</span>
          <div>
            <div className="mode-pill">{match.mode} · {match.map}</div>
            <h3 className="match-title">{match.title}</h3>
          </div>
        </div>
        <span className={`badge ${statusClass(match.status)}`}>
          {match.status === 'live' ? <span className="live-dot" /> : null}
          {STATUS_LABEL[match.status] || match.status}
        </span>
      </div>

      <div className="match-body">
        <div className="prize-row">
          <div className="prize">
            {money(match.prizePool)}
            <small>Prize pool</small>
          </div>
          <div className="prize">
            {money(match.entryFee)}
            <small>Entry fee</small>
          </div>
          {match.perKill > 0 ? (
            <div className="prize">
              {money(match.perKill)}
              <small>Per kill</small>
            </div>
          ) : null}
        </div>

        <div>
          <div className="between small muted" style={{ marginBottom: 6 }}>
            <span>{match.filledSlots}/{match.totalSlots} players</span>
            <span>{fill}% full</span>
          </div>
          <div className="progress">
            <span style={{ width: `${fill}%` }} />
          </div>
        </div>

        <div className="match-meta">
          <span>🕒 {dateTime(match.startTime)}</span>
          {!closed ? <span className="countdown">⏳ {starts}</span> : null}
          {match.joined ? <span className="badge open">Joined</span> : null}
        </div>

        {!compact && match.roomId ? (
          <div className="code-box">
            <div>
              <div className="tiny muted">Room ID</div>
              <b className="mono">{match.roomId}</b>
            </div>
            <div>
              <div className="tiny muted">Password</div>
              <b className="mono">{match.roomPassword}</b>
            </div>
          </div>
        ) : null}
      </div>

      <div className="match-foot">
        <span className="tiny muted">{match.resultsPublished ? 'Results published' : 'Tap for full details'}</span>
        <Link className="btn sm primary" to={`/matches/${match.id}`}>
          {match.joined ? 'View match' : match.status === 'live' ? 'Watch live' : 'View & join'}
        </Link>
      </div>
    </article>
  );
}
