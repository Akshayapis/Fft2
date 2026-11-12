import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { dateTime, money, STATUS_LABEL, statusClass } from '../lib/format.js';
import MatchCard from '../components/MatchCard.jsx';
import { Empty, Tabs } from '../components/ui.jsx';

export default function Matches() {
  const [matches, setMatches] = useState([]);
  const [tab, setTab] = useState('upcoming');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('/api/matches');
      setMatches(res.matches);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const groups = useMemo(
    () => ({
      upcoming: matches.filter((m) => ['registration_open', 'paused', 'registration_closed'].includes(m.status)),
      live: matches.filter((m) => m.status === 'live'),
      completed: matches.filter((m) => ['completed', 'cancelled', 'expired'].includes(m.status)),
      mine: matches.filter((m) => m.joined),
    }),
    [matches],
  );

  const list = (groups[tab] || []).filter((m) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return m.title.toLowerCase().includes(q) || m.map.toLowerCase().includes(q) || m.mode.includes(q);
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tournaments</h1>
          <p>Every match has a fixed start time, expiry and automatic refund policy.</p>
        </div>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={load}>
          ↻ Refresh
        </button>
      </div>

      <div className="row wrap">
        <input
          className="input"
          style={{ maxWidth: 320 }}
          placeholder="Search by title, map or mode…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'upcoming', label: 'Upcoming', count: groups.upcoming.length },
          { value: 'live', label: 'Live', count: groups.live.length },
          { value: 'completed', label: 'Completed', count: groups.completed.length },
          { value: 'mine', label: 'My matches', count: groups.mine.length },
        ]}
      />

      {error ? <div className="form-error">{error}</div> : null}

      {loading ? (
        <div className="grid cols-2">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : list.length ? (
        <div className="grid cols-2">
          {list.map((m) => (
            <MatchCard key={m.id} match={m} />
          ))}
        </div>
      ) : (
        <Empty
          emoji={tab === 'live' ? '📡' : '🎯'}
          title={tab === 'live' ? 'No matches are live right now' : 'No matches in this section'}
          hint={tab === 'live' ? 'Upcoming matches will appear here the moment they start.' : 'New tournaments are added daily by the admin team.'}
        />
      )}

      <div className="card">
        <div className="card-title">
          <h3>Match guide</h3>
        </div>
        <div className="grid cols-3 small muted">
          <div>🔐 <b style={{ color: 'var(--text)' }}>Private rooms</b><br />Room ID and password are only shown to registered players while the match is active.</div>
          <div>💸 <b style={{ color: 'var(--text)' }}>Automatic refunds</b><br />If a match expires or is cancelled, entry fees are refunded to your wallet automatically.</div>
          <div>🏆 <b style={{ color: 'var(--text)' }}>Instant prizes</b><br />Winnings are credited to your winning balance as soon as the admin distributes prizes.</div>
        </div>
      </div>

      {matches.length ? (
        <div className="tiny muted">
          Last sync {dateTime(new Date().toISOString())} · {matches.length} tournaments loaded
        </div>
      ) : null}
    </div>
  );
}
