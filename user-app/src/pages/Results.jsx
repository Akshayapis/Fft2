import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { dateOnly, money } from '../lib/format.js';
import { Empty, Spinner, Stat, Tabs } from '../components/ui.jsx';

export default function Results() {
  const [tab, setTab] = useState('results');
  const [results, setResults] = useState([]);
  const [wins, setWins] = useState({ wins: [], totalWon: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([api('/api/me/results'), api('/api/me/wins')])
      .then(([r, w]) => {
        if (!alive) return;
        setResults(r.results);
        setWins(w);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Results & wins</h1>
          <p>Every published result and prize credit linked to your account.</p>
        </div>
      </div>

      <div className="grid cols-3">
        <Stat label="Matches played" value={results.length} tone="accent" />
        <Stat label="Matches won" value={wins.wins.length} foot="Prize positions" tone="ok" />
        <Stat label="Total prize money" value={money(wins.totalWon)} foot="Credited to winnings" tone="gold" />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'results', label: 'Results', count: results.length },
          { value: 'wins', label: 'Wins', count: wins.wins.length },
        ]}
      />

      {loading ? (
        <Spinner />
      ) : tab === 'results' ? (
        results.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Date</th>
                  <th>Entry</th>
                  <th>Rank</th>
                  <th>Prize</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.matchId}>
                    <td>
                      <Link to={`/matches/${r.matchId}`} style={{ fontWeight: 600 }}>
                        {r.title}
                      </Link>
                      <div className="tiny muted">{r.mode}</div>
                    </td>
                    <td className="small">{dateOnly(r.startTime)}</td>
                    <td>{money(r.entryFee)}</td>
                    <td>{r.rank ? <span className={`rank-${r.rank}`}>#{r.rank}</span> : '—'}</td>
                    <td style={{ color: r.prize ? 'var(--gold)' : undefined }}>{money(r.prize)}</td>
                    <td>
                      <span className={`badge ${r.payoutStatus === 'paid' ? 'open' : 'closed'}`}>
                        {r.payoutStatus === 'paid' ? 'Paid' : r.prize ? 'Processing' : 'No prize'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty emoji="📊" title="No published results" hint="Complete a tournament to see your results here." />
        )
      ) : wins.wins.length ? (
        <div className="col">
          {wins.wins.map((w) => (
            <div key={w.matchId} className="card">
              <div className="between">
                <div>
                  <div className="tiny muted">{w.mode} · {dateOnly(w.startTime)}</div>
                  <h3 style={{ margin: '3px 0 0', fontSize: 16 }}>{w.title}</h3>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="prize" style={{ fontSize: 20 }}>
                    {money(w.prize)}
                  </div>
                  <div className="tiny muted">Rank #{w.rank || '—'} · {w.transactionId ? 'Credited' : 'Pending'}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty emoji="🏆" title="No wins yet" hint="Your prize-winning matches will be celebrated here." />
      )}
    </div>
  );
}
