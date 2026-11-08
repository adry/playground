import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Application } from '../api/types';

export function Apply({ previous, onDone }: { previous: Application | null; onDone: () => void }) {
  const [form, setForm] = useState({
    fullName: previous?.fullName ?? '', phone: previous?.phone ?? '', agencyName: previous?.agencyName ?? '',
    orgNumber: previous?.orgNumber ?? '', fmiNumber: previous?.fmiNumber ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.apply(form);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="narrow">
      <div style={{ display: 'grid', gap: 8 }}>
        <span className="label">Step 2 of 2</span>
        <h1>Tell us who you are</h1>
        <p className="muted">We check every agent by hand against Fastighetsmäklarinspektionen's register before opening the dashboard, usually within one working day.</p>
      </div>
      <form className="card" onSubmit={submit}>
        <label className="field"><span>Full name</span><input id="fullName" required minLength={2} value={form.fullName} onChange={set('fullName')} autoComplete="name" /></label>
        <label className="field"><span>Mobile</span><input id="phone" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" placeholder="070-123 45 67" /></label>
        <label className="field"><span>Agency</span><input id="agencyName" required minLength={2} value={form.agencyName} onChange={set('agencyName')} autoComplete="organization" /></label>
        <label className="field">
          <span>Agency's organisation number</span>
          <input id="orgNumber" inputMode="numeric" pattern="\d{6}-?\d{4}" value={form.orgNumber} onChange={set('orgNumber')} placeholder="556677-8899" />
          <small>Links you to your agency's listings from its feed.</small>
        </label>
        <label className="field">
          <span>FMI registration number</span>
          <input id="fmiNumber" value={form.fmiNumber} onChange={set('fmiNumber')} />
          <small>Your number as a registered estate agent (fastighetsmäklare).</small>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary big" disabled={busy}>Send for review</button>
      </form>
    </main>
  );
}
