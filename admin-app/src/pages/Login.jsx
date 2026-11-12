import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="mark">🔥</div>
          <div>
            <b>Fire Arena</b>
            <span>Admin console</span>
          </div>
        </div>
        <h2>Administrator sign in</h2>
        <p className="sub">Restricted access. Every action is authenticated server-side and written to the audit trail.</p>

        <form className="col" onSubmit={submit} style={{ gap: 13 }}>
          {error ? <div className="form-error">{error}</div> : null}
          <label className="field">
            <span className="label">Admin email</span>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@firearena.gg" />
          </label>
          <label className="field">
            <span className="label">Password</span>
            <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </label>
          <button className="btn primary block" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : '🔐'} Sign in
          </button>
        </form>

        <div className="auth-note">
          <b>Demo admin</b>
          <br />
          admin@firearena.gg · Admin@12345
          <br />
          Change these credentials before going live.
        </div>
      </div>
    </div>
  );
}
