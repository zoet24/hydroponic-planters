import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chip } from '../components/Chip';
import { Hero, Screen, ScreenHead, Tick } from '../components/Screen';
import { FIELD_LABELS, relativeTime } from '../lib/format';
import { api, post, usePlanter, usePlanters } from '../PlantersContext';
import type { PlanterView } from '../types';

interface Preset {
  id: string;
  name: string;
  description?: string;
}

/**
 * Add a planter to the dashboard.
 *
 * The backend already discovers anything publishing to MQTT, so this lists
 * what it has found that has not been added yet.
 */
export function AddPlanter() {
  const { planters } = usePlanters();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [added, setAdded] = useState<PlanterView | null>(null);

  const available = planters.filter((p) => !p.added);
  const selected = available.find((p) => p.id === selectedId) ?? null;

  if (added) return <AddDone added={added} />;
  if (selected) {
    return (
      <SetUpPlanter
        planter={selected}
        onBack={() => setSelectedId(null)}
        onAdded={setAdded}
      />
    );
  }
  return <PickPlanter available={available} onPick={setSelectedId} />;
}

function PickPlanter({
  available,
  onPick,
}: {
  available: PlanterView[];
  onPick: (id: string) => void;
}) {
  return (
    <Screen>
      <ScreenHead title="Add a planter" back="/" backLabel="Back to your planters" />

      {available.length === 0 ? (
        <div className="card empty">
          <h2 className="card__title">Nothing new found</h2>
          <p className="card__sub">
            Every planter already found is on your dashboard. A new one appears here within a few
            seconds of powering up, once it joins the same network as this app.
          </p>
          <Link to="/" className="button button--primary">Back to your planters</Link>
        </div>
      ) : (
        <div className="stack">
          <p className="lede lede--tight">
            {available.length === 1
              ? 'One planter is ready to add.'
              : `${available.length} planters are ready to add.`}{' '}
            Choose the one you want to set up.
          </p>

          <div className="rows-card">
            {available.map((p) => (
              <button
                key={p.id}
                type="button"
                className="row-item row-item--button"
                onClick={() => onPick(p.id)}
              >
                <span className="row-item__main">
                  <span className="row-item__title">{p.id}</span>
                  <span className="row-item__sub">
                    {p.online
                      ? 'Reporting now'
                      : p.lastSeenAt
                        ? `Last seen ${relativeTime(p.lastSeenAt)}`
                        : 'Not reporting yet'}
                  </span>
                </span>
                <Chip tone={p.online ? 'green' : 'grey'}>{p.online ? 'Online' : 'Offline'}</Chip>
              </button>
            ))}
          </div>

          <p className="fineprint">
            Planters appear here on their own. If one is missing, check it has power and is on the
            same network as this app.
          </p>
        </div>
      )}
    </Screen>
  );
}

function SetUpPlanter({
  planter,
  onBack,
  onAdded,
}: {
  planter: PlanterView;
  onBack: () => void;
  onAdded: (planter: PlanterView) => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [name, setName] = useState(planter.name === planter.id ? '' : planter.name);
  const [presetId, setPresetId] = useState(planter.presetId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Preset[]>('/api/presets')
      .then((list) => {
        setPresets(list);
        setPresetId((current) => current || list[0]?.id || '');
      })
      .catch(() => setPresets([]));
  }, []);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await post<PlanterView>(`/api/planters/${planter.id}/add`, {
        name: name.trim() || planter.id,
        presetId: presetId || undefined,
      });
      onAdded(updated);
    } catch {
      setError('Could not reach the planter service. Check you are on the same network.');
    } finally {
      setBusy(false);
    }
  }

  const chosen = presets.find((p) => p.id === presetId);

  return (
    <Screen>
      <ScreenHead title="Set up this planter" onBack={onBack} backLabel="Back to the list" />

      <form className="stack" onSubmit={add}>
        <div className="card idcard">
          <span className="idcard__label">Planter ID</span>
          <span className="idcard__value">{planter.id}</span>
          <Chip tone={planter.online ? 'green' : 'grey'}>
            {planter.online ? 'Reporting now' : 'Not reporting yet'}
          </Chip>
        </div>

        <div className="field">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            type="text"
            value={name}
            maxLength={60}
            placeholder="Kitchen basil"
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="preset">What is growing in it?</label>
          <select id="preset" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {chosen?.description && <p className="field__hint">{chosen.description}</p>}
        </div>

        <p className="fineprint">
          The preset sets the pump schedule, the pH target and how often to feed. You can change it
          at any time, and the planter picks the change up without being reflashed.
        </p>

        {error && <p className="formerror" role="alert">{error}</p>}

        <button
          type="submit"
          className="button button--primary button--block screen__foot"
          disabled={busy}
        >
          {busy ? 'Adding…' : 'Add planter'}
        </button>
      </form>
    </Screen>
  );
}

/**
 * Live, not a static confirmation: the sync rows settle as the device answers.
 *
 * Seeded with the view the POST returned, so the heading reads the planter's new
 * name immediately. Reading only from the SSE context flashed the raw device id
 * for the moment before the push landed.
 */
function AddDone({ added }: { added: PlanterView }) {
  const planter = usePlanter(added.id) ?? added;

  const sensorsReporting =
    planter.reported.waterTempC !== undefined || planter.reported.waterOk !== undefined;
  const presetName = planter.preset?.name ?? 'Preset';

  return (
    <Screen>
      <Hero tone="success" label="Added" title={`${planter.name} is on your dashboard`}>
        {planter.presetId
          ? `The ${presetName} preset has been sent. The planter will confirm when it has applied it.`
          : 'The planter is connected. Choose a preset when you are ready.'}
      </Hero>

      <div className="rows-card">
        <div className="row-item">
          <Tick done={planter.online} />
          <span>{planter.online ? 'Connected' : 'Waiting for the planter to connect'}</span>
        </div>
        <div className="row-item">
          <Tick done={sensorsReporting} />
          <span>{sensorsReporting ? 'Sensors reporting' : 'Waiting for sensors'}</span>
        </div>
        <div className="row-item row-item--stacked">
          <div className="row-item__line">
            <Tick done={!planter.syncing} />
            <span>
              {planter.syncing ? `${presetName} settings syncing` : `${presetName} settings applied`}
            </span>
          </div>
          <div className="chips chips--indent">
            {syncChipFields(planter).map((field) => {
              const pending = planter.pending.includes(field);
              return (
                <Chip key={field} tone={pending ? 'amber' : 'green'}>
                  {FIELD_LABELS[field]} {pending ? 'pending' : 'confirmed'}
                </Chip>
              );
            })}
          </div>
        </div>
      </div>

      <div className="stack stack--buttons">
        <Link to={`/planters/${planter.id}`} className="button button--primary button--block">
          Open {planter.name}
        </Link>
        <Link to="/" className="button button--block">See all planters</Link>
      </div>
    </Screen>
  );
}

/**
 * The three pump settings a preset actually sets, as drawn. The master enable is
 * only worth a chip when it is holding things up — otherwise it confirms
 * instantly and just makes the row wrap.
 */
function syncChipFields(planter: PlanterView): string[] {
  const fields = ['speedPercent', 'intervalHours', 'runtimeMinutes'];
  return planter.pending.includes('pumpEnable') ? ['pumpEnable', ...fields] : fields;
}
