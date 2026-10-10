import { useState } from 'react';
import { Link } from 'react-router-dom';
import { NoteField, Sheet, SheetHead, useSheetRoute } from '../components/Sheet';
import { post, usePlanter } from '../PlantersContext';

/** Mark a feed as done, optionally saying what you used. Writes to the timeline. */
export function RecordNutrients() {
  const { id, close } = useSheetRoute();
  const planter = usePlanter(id);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!planter) {
    return (
      <Sheet label="Record nutrients" onClose={close}>
        <p className="lede">No planter with that ID.</p>
        <Link to="/" className="button button--primary button--block">Your planters</Link>
      </Sheet>
    );
  }

  const nutrients = planter.preset?.nutrients;

  async function save() {
    if (!planter) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/api/planters/${planter.id}/nutrients`, note.trim() ? { note: note.trim() } : {});
      close();
    } catch {
      setError('Could not save that. Check the planter service is running.');
      setBusy(false);
    }
  }

  return (
    <Sheet label="Record nutrients" onClose={close}>
      <SheetHead title="Record nutrients" subtitle={planter.name} onClose={close} />

      {nutrients ? (
        <div className="note-card">
          <strong>{nutrients.strengthMultiplier}× label strength</strong>, every{' '}
          {nutrients.scheduleDays} days. {nutrients.guidance}
        </div>
      ) : (
        <p className="lede lede--tight">
          No preset is assigned, so there is no feeding guidance to show. The record is still saved.
        </p>
      )}

      <NoteField
        value={note}
        onChange={setNote}
        placeholder="Half strength — leaf tips looked scorched"
      />

      {error && <p className="formerror" role="alert">{error}</p>}

      <div className="screen__foot">
        <button type="button" className="button button--primary button--block" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'I added nutrients'}
        </button>
        <p className="fineprint">This resets the countdown to the next feed.</p>
      </div>
    </Sheet>
  );
}
