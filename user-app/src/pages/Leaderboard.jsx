import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { Empty, Spinner } from '../components/ui.jsx';

export default function Leaderboard() {
  const [data, setData] = useState({ leaderboard: [], me: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api('/api/leaderboard')
      .then((res) => alive && setData(res))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const top = data.leaderboard.slice(0, 3);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Leaderboard</h1>
          <p>Ranked by total prize money won across all tournaments.</p>
        </div>
        <div className="spacer" />
        {data.me ? <span className="pill active">Your rank #{data.me.position}</span> : null}
      </div>

      {loading ? (
        <Spinner />
      ) : data.leaderboard.length ? (
        <>
          <div className="grid cols-3">
            {[top[1], top[0], top[2]].filter(Boolean).map((p, idx) => {
              const place = p.position;
              const order = idx === 0 ? 2 : idx === 1 ? 1 : 3;
              return (
                <div
                  key={p.id}
                  className="card"
                  style={{
                    textAlign: 'center',
                    borderColor: order === 1 ? 'rgba(255,200,87,0.5)' : undefined,
                    background: order === 1 ? 'linear-gradient(180deg, rgba(255,200,87,0.14), rgba(19,19,30,0.8))' : undefined,
                    transform: order === 1 ? 'translateY(-6px)' : undefined,
                  }}
                >
                  <div style={{ fontSize: 26 }}>{order === 1 ? '👑' : order === 2 ? '🥈' : '🥉'}</div>
                  <div className="avatar lg" style={{ margin: '10px auto', border: order === 1 ? '2px solid var(--gold)' : undefined }}>
                    {p.avatar ? <img src={p.avatar} alt="" /> : p.username.slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ fontWeight: 700 }}>{p.username}</div>
                  <div className="tiny muted">{p.wins} wins · {p.matchesPlayed} matches</div>
                  <div className="prize" style={{ marginTop: 8 }}>
                    {money(p.totalWon)}
                  </div>
                  <div className="tiny muted">Rank #{place}</div>
                </div>
              );
            })}
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Wins</th>
                  <th>Matches</th>
                  <th>Total won</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((p) => (
                  <tr key={p.id} style={p.id === data.me?.id ? { background: 'rgba(255,90,31,0.08)' } : undefined}>
                    <td>{p.position <= 3 ? <span className={`rank-${p.position}`}>#{p.position}</span> : `#${p.position}`}</td>
                    <td style={{ fontWeight: 600 }}>{p.username}</td>
                    <td>{p.wins}</td>
                    <td>{p.matchesPlayed}</td>
                    <td style={{ color: 'var(--gold)', fontWeight: 600 }}>{money(p.totalWon)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Empty emoji="📊" title="Leaderboard is warming up" hint="Play tournaments to appear on the board." />
      )}
    </div>
  );
}
