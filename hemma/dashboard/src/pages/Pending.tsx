import type { Application } from '../api/types';

export function Pending({ app, onReapply }: { app: Application; onReapply: () => void }) {
  const rejected = app.status === 'rejected' || app.status === 'suspended';
  return (
    <main className="narrow">
      <div className="card">
        <div className="status-big">
          <span className={`status-dot${rejected ? ' rejected' : ''}`} aria-hidden="true">{rejected ? '!' : '…'}</span>
          <div style={{ display: 'grid', gap: 4 }}>
            <h1 style={{ fontSize: 24 }}>{rejected ? 'We could not approve this account' : 'We are checking your details'}</h1>
            <p className="muted">
              {rejected
                ? app.reviewNote ?? 'Contact us if you think this is wrong.'
                : 'We confirm every agent against the FMI register by hand. You will get an email when your dashboard is open, usually within one working day.'}
            </p>
          </div>
        </div>
        <dl className="kv">
          <dt>Name</dt><dd>{app.fullName}</dd>
          <dt>Agency</dt><dd>{app.agencyName}</dd>
          <dt>Org. number</dt><dd>{app.orgNumber ?? '–'}</dd>
          <dt>FMI number</dt><dd>{app.fmiNumber ?? '–'}</dd>
          <dt>Sent</dt><dd>{new Date(app.appliedAt).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
        </dl>
        {rejected && <button className="btn primary" onClick={onReapply}>Correct and send again</button>}
      </div>
    </main>
  );
}
