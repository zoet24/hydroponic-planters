import { useState } from 'react';
import { Link } from 'react-router-dom';
import { NoteField, Sheet, SheetHead, useSheetRoute } from '../components/Sheet';
import { post, usePlanter } from '../PlantersContext';

/**
 * A free-text observation — how the seedlings look, what you changed.
 *
 * Separate from the pH and nutrient records because it asserts nothing about
 * the plant's schedule: it clears no reminder and moves no due date.
 */
export function AddNote() {
  const { id, close } = useSheetRoute();
  const planter = usePlanter(id);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!planter) {
    return (
      <Sheet label="Add a note" onClose={close}>
        <p className="lede">No planter with that ID.</p>
        <Link to="/" className="button button--primary button--block">Your planters</Link>
      </Sheet>
    );
  }

  async function save() {
    if (!planter || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/api/planters/${planter.id}/notes`, { text: text.trim() });
      close();
    } catch {
      setError('Could not save that note. Check the planter service is running.');
      setBusy(false);
    }
  }

  return (
    <Sheet label="Add a note" onClose={close}>
      <SheetHead title="Add a note" subtitle={planter.name} onClose={close} />

      <p className="lede lede--tight">
        Anything worth remembering — how the seedlings look, what you changed, what you are watching.
      </p>

      <NoteField
        value={text}
        onChange={setText}
        label="Note"
        placeholder="Second set of true leaves on three of the four pods"
      />

      {error && <p className="formerror" role="alert">{error}</p>}

      <div className="screen__foot">
        <button
          type="button"
          className="button button--primary button--block"
          disabled={busy || text.trim() === ''}
          onClick={save}
        >
          {busy ? 'Saving…' : 'Save note'}
        </button>
      </div>
    </Sheet>
  );
}
