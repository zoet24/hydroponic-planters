import { useEffect, useState } from 'react';
import { Sheet, SheetHead } from './Sheet';
import { api, patch, post } from '../PlantersContext';
import type { PlanterView, Preset } from '../types';

/** Rename a planter and change what is growing in it. */
export function EditPlanterSheet({
  planter: p,
  onClose,
}: {
  planter: PlanterView;
  onClose: () => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [name, setName] = useState(p.name);
  const [presetId, setPresetId] = useState(p.presetId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Preset[]>('/api/presets')
      .then(setPresets)
      .catch(() => setPresets([]));
  }, []);

  const trimmed = name.trim();
  const nameChanged = trimmed !== '' && trimmed !== p.name;
  const presetChanged = presetId !== '' && presetId !== p.presetId;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Two endpoints, because changing the preset also pushes pump settings to
      // the device while a rename does not. Only what actually changed is sent.
      if (nameChanged) await patch(`/api/planters/${p.id}`, { name: trimmed });
      if (presetChanged) await post(`/api/planters/${p.id}/preset`, { presetId });
      onClose();
    } catch {
      setError('Could not save that. Check the planter service is running.');
      setBusy(false);
    }
  }

  const chosen = presets.find((x) => x.id === presetId);

  return (
    <Sheet label={`Edit ${p.name}`} onClose={onClose}>
      <SheetHead title="Edit planter" subtitle={p.id} onClose={onClose} />

      <form className="stack" onSubmit={save}>
        <div className="field">
          <label htmlFor="edit-name">Name</label>
          <input
            id="edit-name"
            type="text"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="edit-preset">What is growing in it?</label>
          <select id="edit-preset" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {presetId === '' && <option value="">No preset</option>}
            {presets.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
          {chosen?.description && <p className="field__hint">{chosen.description}</p>}
        </div>

        {presetChanged && (
          <p className="note-card">
            Changing the preset sends a new pump schedule to the planter. It applies without
            reflashing, and the planter confirms each setting as it takes effect.
          </p>
        )}

        {error && <p className="formerror" role="alert">{error}</p>}

        <div className="screen__foot">
          <button
            type="submit"
            className="button button--primary button--block"
            disabled={busy || (!nameChanged && !presetChanged)}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/**
 * Take a planter off the dashboard.
 *
 * Deliberately not destructive. The planter is a physical device that keeps
 * publishing, so it reappears under Add planter within seconds either way --
 * wiping its history would lose the readings without stopping it coming back.
 */
export function RemovePlanterSheet({
  planter: p,
  onClose,
}: {
  planter: PlanterView;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/planters/${p.id}/remove`);
      onClose();
    } catch {
      setError('Could not remove it. Check the planter service is running.');
      setBusy(false);
    }
  }

  return (
    <Sheet label={`Remove ${p.name}`} onClose={onClose}>
      <SheetHead title={`Remove ${p.name}?`} subtitle={p.id} onClose={onClose} />

      <p className="lede lede--tight">
        It comes off your dashboard and moves back to <strong>Add planter</strong>, where you can
        set it up again at any time.
      </p>

      <div className="rows-card">
        <div className="row-item">Its readings, pH checks and notes are kept</div>
        <div className="row-item">The planter keeps running on its current schedule</div>
        <div className="row-item">Nothing is sent to the device</div>
      </div>

      {error && <p className="formerror" role="alert">{error}</p>}

      <div className="screen__foot">
        <button type="button" className="button button--danger button--block" disabled={busy} onClick={remove}>
          {busy ? 'Removing…' : `Remove ${p.name}`}
        </button>
        <button type="button" className="button button--block" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
