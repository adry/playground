// Hemma admin: approve agents by hand, and keep an eye on the feeds.
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Application, FeedSource } from '../api/types';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : '–');
const orgNo = (n: string | null) => (n && n.length === 10 ? `${n.slice(0, 6)}-${n.slice(6)}` : n ?? '–');

export function Admin() {
  const [apps, setApps] = useState<Application[] | null>(null);
  const [feeds, setFeeds] = useState<FeedSource[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [form, setForm] = useState({ name: '', mode: 'pull' as 'pull' | 'push', format: 'hemma-json', url: '', authSecretName: '' });

  useEffect(() => {
    Promise.all([api.applications(), api.feeds()])
      .then(([a, f]) => {
        setApps(a);
        setFeeds(f);
      })
      .catch((e: Error) => setError(e.message));
  }, [reloads]);

  const review = async (a: Application, decision: 'approved' | 'rejected') => {
    try {
      await api.review(a.userId, decision, notes[a.userId] ?? '');
      setReloads((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const addFeed = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.addFeed(form);
      setForm({ name: '', mode: 'pull', format: 'hemma-json', url: '', authSecretName: '' });
      setReloads((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!apps) return <main className="wrap page"><p className="muted">Loading…</p></main>;
  const pending = apps.filter((a) => a.status === 'pending');
  const others = apps.filter((a) => a.status !== 'pending');

  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <span className="label">Admin</span>
          <h1>{pending.length ? `${pending.length} ${pending.length === 1 ? 'agent waits' : 'agents wait'} for approval` : 'No one is waiting'}</h1>
          <p className="muted">Check each name and number in Fastighetsmäklarinspektionen's register before approving. Approval links the agent to their agency by organisation number.</p>
        </div>
        <a className="btn" href="https://www.fmi.se" target="_blank" rel="noopener">Open FMI's site</a>
      </div>
      {error && <p className="error">{error}</p>}

      <section className="apps" aria-label="Waiting for approval">
        {pending.map((a) => (
          <article className="app" key={a.userId}>
            <div style={{ display: 'grid', gap: 8 }}>
              <h3>{a.fullName} <span className="st pending">Waiting</span></h3>
              <dl className="kv">
                <dt>Agency</dt><dd>{a.agencyName}</dd>
                <dt>Org. number</dt><dd>{orgNo(a.orgNumber)}</dd>
                <dt>FMI number</dt><dd>{a.fmiNumber ?? '–'}</dd>
                <dt>Email</dt><dd>{a.email}</dd>
                <dt>Mobile</dt><dd>{a.phone ?? '–'}</dd>
                <dt>Applied</dt><dd>{when(a.appliedAt)}</dd>
              </dl>
            </div>
            <div className="actions">
              <label className="field" style={{ width: '100%' }}>
                <span>Note to the agent</span>
                <textarea id={`note-${a.userId}`} rows={2} value={notes[a.userId] ?? ''} onChange={(e) => setNotes({ ...notes, [a.userId]: e.target.value })} placeholder="Shown if you reject" />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => review(a, 'rejected')}>Reject</button>
                <button className="btn primary" onClick={() => review(a, 'approved')}>Approve</button>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="panel" aria-labelledby="reviewed-h">
        <div className="panel-head"><h2 id="reviewed-h">Reviewed</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Agent</th><th>Agency</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {others.map((a) => (
                <tr key={a.userId} style={{ cursor: 'default' }}>
                  <td><strong>{a.fullName}</strong><div className="muted small">{a.email}</div></td>
                  <td>{a.agencyName}</td>
                  <td><span className={`st ${a.status}`}>{a.status === 'approved' ? 'Approved' : a.status === 'rejected' ? 'Rejected' : 'Suspended'}</span></td>
                  <td className="muted small">{a.reviewNote ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-labelledby="feeds-h">
        <div className="panel-head">
          <h2 id="feeds-h">Feeds</h2>
          <span className="muted small">Pull feeds are fetched every 15 minutes; push feeds arrive when the agency's system sends them.</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Source</th><th>How</th><th>Last update</th><th>Status</th><th>Problem</th></tr></thead>
            <tbody>
              {feeds.map((f) => (
                <tr key={f.id} style={{ cursor: 'default' }}>
                  <td><strong>{f.name}</strong><div className="muted small">{f.url ?? `feed-push?source=${f.id}`}</div></td>
                  <td>{f.mode === 'push' ? 'Pushed to us' : 'We fetch'} · {f.format}</td>
                  <td className="num">{when(f.lastRunAt)}</td>
                  <td>{f.lastStatus ? <span className={`st ${f.lastStatus}`}>{f.lastStatus === 'ok' ? 'OK' : f.lastStatus === 'partial' ? 'Some rejected' : 'Failed'}</span> : <span className="muted">Not run yet</span>}</td>
                  <td><span className="err-text">{f.lastError ?? ''}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="feed-form" onSubmit={addFeed}>
          <label className="field"><span>Name</span><input id="feed-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Agency (system)" /></label>
          <label className="field"><span>How</span>
            <select id="feed-mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as 'pull' | 'push' })}>
              <option value="pull">We fetch a URL</option>
              <option value="push">They push to us</option>
            </select>
          </label>
          <label className="field"><span>Format</span>
            <select id="feed-format" value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
              <option value="hemma-json">Hemma JSON</option>
              <option value="hemma-xml">Hemma XML</option>
            </select>
          </label>
          {form.mode === 'pull' && <label className="field"><span>Feed URL</span><input id="feed-url" type="url" required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" /></label>}
          <label className="field"><span>Secret name</span><input id="feed-secret" required={form.mode === 'push'} value={form.authSecretName} onChange={(e) => setForm({ ...form, authSecretName: e.target.value.toUpperCase() })} placeholder="FEED_AGENCY_KEY" /></label>
          <button className="btn primary">Add feed</button>
        </form>
        <p className="muted small">The secret itself goes in the Edge Function secrets under that name (supabase secrets set NAME=value), never in this form.</p>
      </section>
    </main>
  );
}
