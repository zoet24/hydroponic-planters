import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AI_PRESETS_ENABLED } from '../features';
import { api, post, usePlanter } from '../PlantersContext';
import type { Preset } from '../types';

/**
 * What each preset card shows.
 *
 * Runtime and speed are deliberately absent: they are the same for every
 * preset because they describe the tower, and listing them on a plant card
 * would imply a choice that is not being made.
 */
const specs = (p: Preset) => [
  ['Water', runsLabel(p.pump.runsPerDay)],
  ['Ideal temperature', `${p.waterTempC.min} to ${p.waterTempC.max} °C`],
  ['Target pH', `${p.ph.targetMin} to ${p.ph.targetMax}`],
  ['pH check', `Every ${p.ph.checkIntervalDays} days`],
  ['Feed', `${p.nutrients.type}, every ${p.nutrients.scheduleDays} days`],
];

const runsLabel = (runsPerDay: number): string =>
  runsPerDay === 1 ? 'Once a day' : `${runsPerDay} times a day`;

export function Presets() {
  const { id } = useParams();
  const planter = usePlanter(id);
  const navigate = useNavigate();

  const [presets, setPresets] = useState<Preset[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Preset[]>('/api/presets').then(setPresets).catch(() => setPresets([]));
  }, []);

  // Start on whatever the planter already has, once it arrives over SSE.
  useEffect(() => {
    if (planter?.presetId) setChosen((c) => c ?? planter.presetId);
  }, [planter?.presetId]);

  if (!planter) {
    return (
      <div className="page">
        <Link to="/" className="backlink">Your planters</Link>
        <p className="lede">No planter with that ID.</p>
      </div>
    );
  }

  const selected = presets.find((p) => p.id === chosen) ?? null;

  async function apply() {
    if (!selected || !planter) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/api/planters/${planter.id}/preset`, { presetId: selected.id });
      navigate(`/planters/${planter.id}`);
    } catch {
      setError('Could not send that preset. Check the planter service is running.');
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <Link to={`/planters/${planter.id}`} className="backlink">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        {planter.name}
      </Link>

      <div className="presets__intro">
        <h1>Choose a preset</h1>
        <p className="lede">
          A preset describes what the plant wants: how often to water it, its ideal temperature
          and pH, and what to feed it. How long the pump runs and how hard are properties of the
          tower, so they stay the same whichever you choose.
        </p>
      </div>

      <div className="preset-grid">
        {presets.map((preset) => {
          const isChosen = preset.id === chosen;
          return (
            <button
              key={preset.id}
              type="button"
              className={`card preset-card${isChosen ? ' preset-card--chosen' : ''}`}
              aria-pressed={isChosen}
              onClick={() => setChosen(preset.id)}
            >
              <span className="preset-card__head">
                <span className="preset-card__name">{preset.name}</span>
                {isChosen && (
                  <span className="preset-card__badge">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                    Selected
                  </span>
                )}
              </span>

              <span className="preset-card__blurb">{preset.description}</span>

              <span className="preset-card__specs">
                {specs(preset).map(([label, value]) => (
                  <span key={label} className="preset-card__spec">
                    <span className="preset-card__spec-label">{label}</span>
                    <span className="preset-card__spec-value">{value}</span>
                  </span>
                ))}
              </span>
            </button>
          );
        })}

        {AI_PRESETS_ENABLED && (
          <div className="card preset-card preset-card--ai">
            <span className="preset-card__name">Create with AI</span>
            <p className="preset-card__ai-blurb">
              Name any plant and get a draft preset. Safety limits are checked before it can reach
              your planter.
            </p>
            <Link to={`/planters/${planter.id}/ai`} className="button button--primary">
              Try it
            </Link>
          </div>
        )}
      </div>

      {error && <p className="formerror" role="alert">{error}</p>}

      <div className="presets__foot">
        <button type="button" className="button button--primary" disabled={!selected || busy} onClick={apply}>
          {selected ? `Apply ${selected.name} to ${planter.name}` : 'Choose a preset'}
        </button>
        <Link to={`/planters/${planter.id}`} className="button">Cancel</Link>
        <span className="fineprint">
          You will see Syncing on the dashboard until the planter confirms.
        </span>
      </div>
    </div>
  );
}
