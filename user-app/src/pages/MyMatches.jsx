import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { dateTime, money, STATUS_LABEL, statusClass } from '../lib/format.js';
import { Empty, Spinner, Tabs } from '../components/ui.jsx';

export default function MyMatches() {
  const [matches, setMatches] = useState([]);
  const [tab, setTab] = useState('active');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api('/api/me/matches')
      .then((res) => alive && setMatches(res.matches))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo(
    () => ({
      active: matches.filter((m) => ['live', 'registration_open', 'paused', 'registration_closed'].includes(m.status)),
      completed: matches.filter((m) => ['completed', 'cancelled', 'expired'].includes(m.status)),
      all: matches,
    }),
    [matches],
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My matches</h1>
          <p>Your registrations, room credentials and results in one place.</p>
        </div>
        <div className="spacer" />
        <Link className="btn sm primary" to="/matches">
          Find a match
        </Link>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'active', label: 'Active', count: groups.active.length },
          { value: 'completed', label: 'Finished', count: groups.completed.length },
          { value: 'all', label: 'All', count: groups.all.length },
        ]}
      />

      {loading ? (
        <Spinner />
      ) : groups[tab].length ? (
        <div className="grid cols-2">
          {groups[tab].map((m) => (
            <div key={m.id} className="card">
              <div className="between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="tiny muted">{m.mode.toUpperCase()} · {m.map}</div>
                  <h3 style={{ margin: '4px 0 6px', fontSize: 17 }}>{m.title}</h3>
                  <div className="tiny muted">🕒 {dateTime(m.startTime)}</div>
                </div>
                <span className={`badge ${statusClass(m.status)}`}>{STATUS_LABEL[m.status] || m.status}</span>
              </div>

              <div className="row wrap small" style={{ margin: '14px 0' }}>
                <span className="pill">Entry {money(m.entryFee)}</span>
                <span className="pill">Prize {money(m.prizePool)}</span>
                <span className="pill">Reg {m.joinedDetails?.registrationId?.slice(-8)}</span>
              </div>

              {m.roomId ? (
                <div className="col" style={{ gap: 8, marginBottom: 12 }}>
                  <div className="code-box">
                    <div>
                      <div className="tiny muted">Room ID</div>
                      <b className="mono">{m.roomId}</b>
                    </div>
                    <div>
                      <div className="tiny muted">Password</div>
                      <b className="mono">{m.roomPassword}</b>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="notice" style={{ marginBottom: 12 }}>
                  {m.credentialsNote || 'Room details will appear here before the match starts.'}
                </div>
              )}

              <div className="between">
                <span className="tiny muted">
                  {m.joinedDetails?.rank ? `Rank #${m.joinedDetails.rank}` : 'Awaiting results'} ·{' '}
                  {m.joinedDetails?.refunded ? 'Refunded' : 'No refund'}
                </span>
                <Link className="btn sm ghost" to={`/matches/${m.id}`}>
                  Match details
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty emoji="🎟️" title="Nothing here yet" hint="Join a tournament and it will show up in this list." />
      )}
    </div>
  );
}
