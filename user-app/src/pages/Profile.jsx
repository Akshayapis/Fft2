import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { dateOnly, initials, money } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';
import { Avatar, Stat } from '../components/ui.jsx';

export default function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const fileRef = useRef(null);
  const [form, setForm] = useState({
    username: user?.username || '',
    gameUid: user?.gameUid || '',
    phone: user?.phone || '',
    bio: user?.bio || '',
    avatar: user?.avatar || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const pickImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Choose an image file.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error('Image must be under 4 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 220;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const min = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size);
        setForm((prev) => ({ ...prev, avatar: canvas.toDataURL('image/jpeg', 0.82) }));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/api/profile', { method: 'PUT', body: form });
      setUser(res.user);
      toast.success('Profile updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My profile</h1>
          <p>Personal information, security and account controls.</p>
        </div>
        <div className="spacer" />
        <Link className="btn sm ghost" to="/devices">
          Devices & security
        </Link>
      </div>

      <div className="card">
        <div className="row wrap" style={{ gap: 18 }}>
          <Avatar src={form.avatar} name={user?.username} size="lg" />
          <div className="grow">
            <div style={{ fontSize: 20, fontWeight: 700 }}>{user?.username}</div>
            <div className="small muted">{user?.email}</div>
            <div className="tiny muted">Member since {dateOnly(user?.createdAt)} · UID {user?.gameUid || 'not set'}</div>
          </div>
          <div className="row">
            <button className="btn sm ghost" onClick={() => fileRef.current?.click()}>
              Change photo
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
            <Link className="btn sm primary" to="/wallet">
              {money(user?.wallet?.balance)}
            </Link>
          </div>
        </div>
      </div>

      <div className="grid cols-3">
        <Stat label="Matches played" value={user?.stats?.matchesPlayed || 0} tone="accent" />
        <Stat label="Wins" value={user?.stats?.wins || 0} tone="ok" />
        <Stat label="Total won" value={money(user?.wallet?.totalWon)} tone="gold" />
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">
            <h3>Personal information</h3>
          </div>
          <form className="col" onSubmit={save}>
            {error ? <div className="form-error">{error}</div> : null}
            <label className="field">
              <span className="label">Username</span>
              <input className="input" value={form.username} onChange={set('username')} required />
            </label>
            <div className="form-grid">
              <label className="field">
                <span className="label">Free Fire UID</span>
                <input className="input" value={form.gameUid} onChange={set('gameUid')} />
              </label>
              <label className="field">
                <span className="label">Phone</span>
                <input className="input" value={form.phone} onChange={set('phone')} />
              </label>
            </div>
            <label className="field">
              <span className="label">Bio</span>
              <textarea className="input" maxLength={200} value={form.bio} onChange={set('bio')} placeholder="Solo main · Bermuda specialist" />
            </label>
            <div className="row">
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? <span className="spinner" /> : 'Save changes'}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setForm({ username: user.username, gameUid: user.gameUid, phone: user.phone, bio: user.bio || '', avatar: user.avatar || '' })}
              >
                Reset
              </button>
            </div>
          </form>
        </div>

        <div className="col">
          <div className="card">
            <div className="card-title">
              <h3>Account & security</h3>
            </div>
            <div className="col small">
              <Link className="player-row" to="/devices" style={{ color: 'inherit' }}>
                <div className="device-ic">📱</div>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>Device management</div>
                  <div className="tiny muted">Review and revoke active sessions</div>
                </div>
                <span>›</span>
              </Link>
              <Link className="player-row" to="/settings" style={{ color: 'inherit' }}>
                <div className="device-ic">🔔</div>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>Notification preferences</div>
                  <div className="tiny muted">Push, email and privacy</div>
                </div>
                <span>›</span>
              </Link>
              <Link className="player-row" to="/wallet" style={{ color: 'inherit' }}>
                <div className="device-ic">🧾</div>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>Wallet history</div>
                  <div className="tiny muted">Complete immutable ledger</div>
                </div>
                <span>›</span>
              </Link>
              <Link className="player-row" to="/results" style={{ color: 'inherit' }}>
                <div className="device-ic">🏆</div>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>Winning history</div>
                  <div className="tiny muted">Results and prize credits</div>
                </div>
                <span>›</span>
              </Link>
              <Link className="player-row" to="/support" style={{ color: 'inherit' }}>
                <div className="device-ic">🎧</div>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>Support history</div>
                  <div className="tiny muted">Tickets and admin replies</div>
                </div>
                <span>›</span>
              </Link>
            </div>
          </div>

          <div className="card">
            <div className="card-title">
              <h3>Avatar preview</h3>
            </div>
            <div className="row">
              <Avatar src={form.avatar} name={user?.username} size="lg" />
              <div className="small muted">
                Recommended 400×400 px. Images are resized locally before upload, keeping your profile light and fast.
              </div>
            </div>
            <div className="tiny muted" style={{ marginTop: 10 }}>
              Signed in as {user?.email} · {initials(user?.username)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
