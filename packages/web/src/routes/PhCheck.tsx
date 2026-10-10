import { useState } from 'react';
import { Link } from 'react-router-dom';
import { phAdvice, stepPh, type PhResult } from '@planter/shared';
import { PhScale } from '../components/PhScale';
import { ScreenHead } from '../components/Screen';
import { NoteField, Sheet, SheetHead, useSheetRoute } from '../components/Sheet';
import { post, usePlanter } from '../PlantersContext';

/** Neutral, and where fresh tap water usually sits — the common starting point. */
const DEFAULT_READING = 7;

export function PhCheck() {
  const { id, close } = useSheetRoute();
  const planter = usePlanter(id);

  const [ph, setPh] = useState(DEFAULT_READING);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!planter) {
    return (
      <Sheet label="pH check" onClose={close}>
        <p className="lede">No planter with that ID.</p>
        <Link to="/" className="button button--primary button--block">Your planters</Link>
      </Sheet>
    );
  }

  const preset = planter.preset;
  if (!preset) {
    return (
      <Sheet label="pH check" onClose={close}>
        <ScreenHead title="pH check" back={`/planters/${planter.id}`} backLabel="Back to the dashboard" />
        <p className="lede">
          Choose a preset first. Without a target range there is nothing to compare a reading
          against.
        </p>
        <Link to={`/planters/${planter.id}/preset`} className="button button--primary button--block screen__foot">
          Choose a preset
        </Link>
      </Sheet>
    );
  }

  /**
   * The same pure function the backend runs, imported from `shared`. The preview
   * updates as you step the value, and saving cannot disagree with it.
   */
  const result: PhResult = phAdvice({
    ph,
    range: { min: preset.ph.targetMin, max: preset.ph.targetMax },
    readingAgeHours: 0,
    checkIntervalDays: preset.ph.checkIntervalDays,
  });

  async function save() {
    if (!planter) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/api/planters/${planter.id}/ph`, {
        ph,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      close();
    } catch {
      setError('Could not save that reading. Check the planter service is running.');
      setBusy(false);
    }
  }

  return (
    <Sheet label="pH check" onClose={close}>
      <SheetHead title="pH check" subtitle={planter.name} onClose={close} />

      <div className="card ph-reading">
        <span className="ph-reading__label">Your reading</span>
        <div className="ph-reading__row">
          <button type="button" className="ph-step" aria-label="Decrease reading" onClick={() => setPh((v) => stepPh(v, -0.1))}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M5 12h14" />
            </svg>
          </button>
          <output className="ph-reading__value" aria-live="polite">{ph.toFixed(1)}</output>
          <button type="button" className="ph-step" aria-label="Increase reading" onClick={() => setPh((v) => stepPh(v, 0.1))}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <p className="fineprint">Dip the pH pen in the reservoir and wait for the reading to settle.</p>
      </div>

      <div className="card ph-scale-card">
        <span className="ph-reading__label">
          {preset.name} target: {preset.ph.targetMin} to {preset.ph.targetMax}
        </span>
        <PhScale ph={ph} min={preset.ph.targetMin} max={preset.ph.targetMax} />
      </div>

      <div className={`ph-advice ph-advice--${toneFor(result)}`}>
        <span className="ph-advice__chip">
          <span className="chip__dot" aria-hidden="true" />
          {headlineFor(result, preset.plantType)}
        </span>
        <p className="ph-advice__text">{result.advice}</p>
      </div>

      <NoteField value={note} onChange={setNote} placeholder="Added 2 ml pH down" />

      {error && <p className="formerror" role="alert">{error}</p>}

      <div className="screen__foot ph-foot">
        <button type="button" className="button button--primary button--block" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save reading'}
        </button>
        <p className="fineprint ph-foot__note">The app reminds you when the next check is due.</p>
      </div>
    </Sheet>
  );
}

const toneFor = (r: PhResult): string =>
  r.status === 'in_range' ? 'ok' : r.status === 'invalid' ? 'bad' : 'warn';

function headlineFor(r: PhResult, plant: string): string {
  switch (r.status) {
    case 'in_range':
      return `In range for ${plant.toLowerCase()}`;
    case 'too_low':
      return `Too low for ${plant.toLowerCase()}`;
    case 'too_high':
      return `Too high for ${plant.toLowerCase()}`;
    default:
      return 'Check the reading';
  }
}
