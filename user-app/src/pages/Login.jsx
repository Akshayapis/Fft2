import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Background from '../components/Background.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';

export default function Login() {
  const { login, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
      toast.success('Welcome back to the arena!');
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <Background intensity={1.6} />
      <div className="auth-card">
        <div className="auth-logo">
          <div className="mark">🔥</div>
          <div>
            <h1>Fire Arena</h1>
            <p>Premium Free Fire Tournaments</p>
          </div>
        </div>
        <h2 className="auth-title">Enter the arena</h2>
        <p className="auth-sub">Sign in to join live tournaments and win real cash prizes.</p>

        <form onSubmit={submit} className="col" style={{ gap: 14 }}>
          {error ? <div className="form-error">{error}</div> : null}
          <label className="field">
            <span className="label">Email address</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="field">
            <span className="label">Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>
          <button className="btn primary block" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : '🔥'} Sign in
          </button>
        </form>

        <p className="auth-switch">
          New to Fire Arena? <Link to="/register">Create an account</Link>
        </p>

        <div className="demo-hint">
          <b>Demo player account</b>
          <br />
          player@firearena.gg · Player@12345
          <br />
          <span className="tiny">The admin console is a separate application.</span>
        </div>
      </div>
    </div>
  );
}
