import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import Background from '../components/Background.jsx';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';

export default function Register() {
  const { register, user, config } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    confirm: '',
    gameUid: '',
    phone: '',
  });
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!accept) {
      setError('Please accept the tournament rules and fair-play policy.');
      return;
    }
    setBusy(true);
    try {
      const res = await register({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        gameUid: form.gameUid.trim(),
        phone: form.phone.trim(),
      });
      const bonus = config?.registrationBonus || 0;
      toast.success(
        res.welcomeNotification?.body ||
          `Account created${bonus ? ` · ₹${bonus} bonus credited` : ''}. Welcome to the arena!`,
      );
      navigate('/', { replace: true });
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
        <h2 className="auth-title">Create your account</h2>
        <p className="auth-sub">
          Join tournaments, track your wins and withdraw your prize money.
          {config?.registrationBonus ? ` Get a ₹${config.registrationBonus} welcome bonus.` : ''}
        </p>

        <form onSubmit={submit} className="col" style={{ gap: 14 }}>
          {error ? <div className="form-error">{error}</div> : null}
          <label className="field">
            <span className="label">Username</span>
            <input className="input" required value={form.username} onChange={set('username')} placeholder="ArenaSlayer" />
          </label>
          <label className="field">
            <span className="label">Email address</span>
            <input className="input" type="email" required value={form.email} onChange={set('email')} placeholder="you@example.com" />
          </label>
          <div className="form-grid">
            <label className="field">
              <span className="label">Password</span>
              <input className="input" type="password" required minLength={8} value={form.password} onChange={set('password')} placeholder="Min 8 characters" />
            </label>
            <label className="field">
              <span className="label">Confirm password</span>
              <input className="input" type="password" required value={form.confirm} onChange={set('confirm')} placeholder="Repeat password" />
            </label>
          </div>
          <div className="form-grid">
            <label className="field">
              <span className="label">Free Fire UID</span>
              <input className="input" value={form.gameUid} onChange={set('gameUid')} placeholder="1234567890" />
            </label>
            <label className="field">
              <span className="label">Phone (optional)</span>
              <input className="input" value={form.phone} onChange={set('phone')} placeholder="+91 90000 00000" />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
            I accept the tournament rules, fair-play policy and privacy policy.
          </label>
          <button className="btn primary block" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : '🚀'} Create account
          </button>
        </form>

        <p className="auth-switch">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
