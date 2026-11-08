import { useCallback, useEffect, useState } from 'react';
import { api, demo } from './api';
import type { Session } from './api/types';
import { Admin } from './pages/Admin';
import { Apply } from './pages/Apply';
import { Listings } from './pages/Listings';
import { Pending } from './pages/Pending';
import { SignIn } from './pages/SignIn';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [view, setView] = useState<'listings' | 'admin'>('listings');
  const [reapply, setReapply] = useState(false);
  const refresh = useCallback(() => {
    setReapply(false);
    api.session().then(setSession).catch(() => setSession(null));
  }, []);
  useEffect(refresh, [refresh]);

  // Back from Stripe Checkout: #listings?paid=<id> or ?cancelled=<id>
  const hash = typeof location !== 'undefined' ? location.hash : '';
  const notice = hash.includes('paid=') ? 'Payment received. The boost is live as soon as Stripe confirms it, usually within a minute.' : hash.includes('cancelled=') ? 'Payment cancelled. Nothing was charged and the spot was released.' : null;

  if (session === undefined) return null;
  const agent = session?.agent;
  const approved = agent?.status === 'approved';
  const page = !session ? (
    <SignIn onDone={refresh} />
  ) : session.isAdmin && (view === 'admin' || !approved) ? (
    <Admin />
  ) : !agent || reapply ? (
    <Apply previous={agent ?? null} onDone={refresh} />
  ) : !approved ? (
    <Pending app={agent} onReapply={() => setReapply(true)} />
  ) : (
    <Listings agency={session.agencyName ?? agent.agencyName} notice={notice} />
  );

  return (
    <>
      <header className="top">
        <div className="wrap">
          <a className="brand" href="#"><span className="wordmark">hemma<i /></span><span>for agents</span></a>
          {session?.isAdmin && approved && (
            <nav className="nav">
              <button aria-current={view === 'listings' ? 'page' : undefined} onClick={() => setView('listings')}>My homes</button>
              <button aria-current={view === 'admin' ? 'page' : undefined} onClick={() => setView('admin')}>Admin</button>
            </nav>
          )}
          <div className="who">
            {demo && <span className="demo-tag">Demo</span>}
            {session && <span>{session.email}</span>}
            {session && <button className="btn quiet" onClick={() => api.signOut().then(refresh)}>Sign out</button>}
          </div>
        </div>
      </header>
      {page}
    </>
  );
}
