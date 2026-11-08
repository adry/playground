import { useState, type FormEvent } from 'react';
import { api, demo } from '../api';
import type { DemoRole } from '../api/demo';

export function SignIn({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'in') {
        await api.signIn(email, password);
        onDone();
      } else if ((await api.signUp(email, password)) === 'confirm-email') setSent(true);
      else onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const asRole = (role: DemoRole) => {
    demo?.signInAs(role);
    onDone();
  };

  return (
    <main className="narrow">
      <div style={{ display: 'grid', gap: 8 }}>
        <span className="label">Hemma for agents</span>
        <h1>Put your viewings in front of buyers who are out looking today</h1>
        <p className="muted">Your listings arrive from your agency's system. Sign up, and once we have checked your registration you can see how buyers find your homes and boost a viewing to the top of their feed.</p>
      </div>
      {demo ? (
        <div className="card">
          <p className="note">Demo mode: no backend is connected, so pick who to be. Everything stays in this browser.</p>
          <div className="roles">
            <button className="role" type="button" onClick={() => asRole('agent')}><strong>Approved agent</strong><span>Maja Ek at Kvarter &amp; Co: stats per home and boosts</span></button>
            <button className="role" type="button" onClick={() => asRole('pending')}><strong>New agent, not yet approved</strong><span>What an agent sees while we check them</span></button>
            <button className="role" type="button" onClick={() => asRole('admin')}><strong>Hemma admin</strong><span>Approve agents, watch the feeds</span></button>
          </div>
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
          <div className="seg" role="group" aria-label="Sign in or create an account">
            <button type="button" aria-pressed={mode === 'in'} onClick={() => setMode('in')}>Sign in</button>
            <button type="button" aria-pressed={mode === 'up'} onClick={() => setMode('up')}>Create account</button>
          </div>
          {sent ? (
            <p className="note">Check {email} for a link to confirm your address, then sign in here.</p>
          ) : (
            <>
              <label className="field"><span>Work email</span><input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
              <label className="field"><span>Password</span><input id="password" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
              {error && <p className="error">{error}</p>}
              <button className="btn primary big" disabled={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</button>
            </>
          )}
        </form>
      )}
    </main>
  );
}
