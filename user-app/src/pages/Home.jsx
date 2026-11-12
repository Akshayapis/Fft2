import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { dateTime, money, relativeTime } from '../lib/format.js';
import MatchCard from '../components/MatchCard.jsx';
import { Empty, Stat } from '../components/ui.jsx';

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState({ matches: [], notifications: [], leaderboard: [] });
  const [loading, setLoading] = useState(true);
  const [pushReady, setPushReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const [matches, notifications, leaderboard] = await Promise.all([
        api('/api/matches'),
        api('/api/notifications?limit=6'),
        api('/api/leaderboard'),
      ]);
      setData({
        matches: matches.matches,
        notifications: notifications.notifications,
        leaderboard: leaderboard.leaderboard.slice(0, 5),
      });
    } catch {
      /* handled by empty state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const live = data.matches.filter((m) => m.status === 'live');
  const upcoming = data.matches
    .filter((m) => ['registration_open', 'paused', 'registration_closed'].includes(m.status))
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    .slice(0, 3);
  const joined = data.matches.filter((m) => m.joined);
  const wallet = user?.wallet || { balance: 0, winning: 0, totalWon: 0 };
  const unread = data.notifications.filter((n) => !n.read).length;

  return (
    <div className="page">
      <section className="hero">
        <span className="kicker">🔥 Live tournament arena</span>
        <h1>
          Ready to dominate,
          <br />
          {user?.username || 'player'}?
        </h1>
        <p>Join premium Free Fire tournaments, win real cash and climb the leaderboard. Room credentials unlock for registered players only.</p>
        <div className="row wrap" style={{ marginTop: 18 }}>
          <Link className="btn primary" to="/matches">
            Browse tournaments
          </Link>
          <Link className="btn ghost" to="/wallet">
            Wallet {money(wallet.balance)}
          </Link>
          {live.length ? (
            <Link className="btn pink" to="/matches">
              <span className="live-dot" /> {live.length} live now
            </Link>
          ) : null}
        </div>
      </section>

      <section className="grid cols-4">
        <Stat label="Wallet balance" value={money(wallet.balance)} foot="Deposits & refunds" tone="accent" />
        <Stat label="Winning balance" value={money(wallet.winning)} foot="Prize money" tone="gold" />
        <Stat label="Total won" value={money(wallet.totalWon)} foot={`${user?.stats?.wins || 0} wins`} tone="ok" />
        <Stat label="Matches played" value={user?.stats?.matchesPlayed || 0} foot={`${user?.stats?.kills || 0} kills`} />
      </section>

      {!pushReady && typeof Notification !== 'undefined' && Notification.permission !== 'granted' ? (
        <div className="card" style={{ padding: 14 }}>
          <div className="between wrap">
            <div className="small">
              🔔 <b>Enable push notifications</b> to get match reminders, room updates and prize alerts instantly.
            </div>
            <button className="btn sm ghost" onClick={() => navigate('/settings')}>
              Enable
            </button>
          </div>
        </div>
      ) : null}

      {live.length ? (
        <section className="col">
          <div className="page-head">
            <div>
              <h1 style={{ fontSize: 19 }}>Live right now</h1>
              <p>Room credentials are visible to registered players only.</p>
            </div>
            <div className="spacer" />
            <Link className="btn sm ghost" to="/matches">
              All matches
            </Link>
          </div>
          <div className="grid cols-2">
            {live.slice(0, 2).map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">
            <h3>Upcoming tournaments</h3>
            <Link className="link" to="/matches">
              See all
            </Link>
          </div>
          {loading ? (
            <div className="col">
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ) : upcoming.length ? (
            <div className="col">
              {upcoming.map((m) => (
                <div key={m.id} className="between" style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{m.title}</div>
                    <div className="tiny muted">
                      {m.mode.toUpperCase()} · {dateTime(m.startTime)} · {m.filledSlots}/{m.totalSlots} joined
                    </div>
                  </div>
                  <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                    <div className="prize" style={{ fontSize: 15 }}>
                      {money(m.prizePool)}
                    </div>
                    <Link className="btn sm primary" to={`/matches/${m.id}`}>
                      {m.joined ? 'View' : `Join ₹${m.entryFee}`}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty emoji="📅" title="No upcoming matches" hint="New tournaments are announced every day — check back soon." />
          )}
        </div>

        <div className="col">
          <div className="card">
            <div className="card-title">
              <h3>My matches</h3>
              <Link className="link" to="/my-matches">
                {joined.length} joined
              </Link>
            </div>
            {joined.length ? (
              joined.slice(0, 4).map((m) => (
                <Link key={m.id} to={`/matches/${m.id}`} className="player-row">
                  <div className="avatar" style={{ borderRadius: 10 }}>
                    🎯
                  </div>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{m.title}</div>
                    <div className="tiny muted">{dateTime(m.startTime)} · {m.status.replace('_', ' ')}</div>
                  </div>
                  <span className={`badge ${m.status === 'live' ? 'live' : 'closed'}`}>{m.status === 'live' ? 'Live' : 'Details'}</span>
                </Link>
              ))
            ) : (
              <Empty emoji="🎟️" title="You have not joined a match yet" hint="Pick a tournament and secure your slot." />
            )}
          </div>

          <div className="card">
            <div className="card-title">
              <h3>Top players</h3>
              <Link className="link" to="/leaderboard">
                Leaderboard
              </Link>
            </div>
            {data.leaderboard.map((p, i) => (
              <div key={p.id} className="player-row">
                <div className={`avatar ${i === 0 ? 'lg' : ''}`} style={i === 0 ? { width: 34, height: 34, fontSize: 13 } : { width: 34, height: 34, fontSize: 13 }}>
                  {p.position}
                </div>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{p.username}</div>
                  <div className="tiny muted">{p.wins} wins · {p.matchesPlayed} matches</div>
                </div>
                <div className="mono" style={{ color: 'var(--gold)', fontWeight: 700 }}>
                  {money(p.totalWon)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <h3>Recent notifications {unread ? <span className="badge err">{unread} new</span> : null}</h3>
          <Link className="link" to="/notifications">
            View all
          </Link>
        </div>
        {data.notifications.length ? (
          data.notifications.slice(0, 4).map((n) => (
            <div key={n.id} className="notif-item" onClick={() => navigate('/notifications')} role="presentation">
              <div className="notif-icon">{n.type === 'prize' ? '🏆' : n.type === 'security' ? '🛡️' : n.type === 'wallet' ? '💰' : '🔔'}</div>
              <div className="grow">
                <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
                <div className="tiny muted" style={{ marginTop: 2 }}>
                  {n.body}
                </div>
              </div>
              <span className="tiny muted">{relativeTime(n.createdAt)}</span>
            </div>
          ))
        ) : (
          <Empty emoji="🔔" title="No notifications yet" hint="Match reminders and prize alerts will appear here." />
        )}
      </section>
    </div>
  );
}
