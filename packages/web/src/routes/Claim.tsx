import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Chip } from '../components/Chip';
import { Hero, Screen, ScreenHead, Tick } from '../components/Screen';
import { FIELD_LABELS } from '../lib/format';
import { api, post, usePlanter } from '../PlantersContext';
import type { PlanterView } from '../types';

type Outcome = 'ready' | 'already_claimed' | 'expired' | 'unknown';
interface ClaimResponse {
  outcome: Outcome;
  planter: PlanterView | null;
}
interface Preset {
  id: string;
  name: string;
}

export function Claim() {
  const [params] = useSearchParams();
  const planterId = params.get('d') ?? '';
  const token = params.get('t') ?? '';

  const [preview, setPreview] = useState<ClaimResponse | null>(null);
  const [claimedId, setClaimedId] = useState<string | null>(null);

  useEffect(() => {
    if (!planterId || !token) {
      setPreview({ outcome: 'unknown', planter: null });
      return;
    }
    api<ClaimResponse>(`/api/claim?d=${encodeURIComponent(planterId)}&t=${encodeURIComponent(token)}`)
      .then(setPreview)
      .catch(() => setPreview({ outcome: 'unknown', planter: null }));
  }, [planterId, token]);

  if (claimedId) return <ClaimDone planterId={claimedId} />;
  if (!preview) return <Screen><p className="lede">Checking this code…</p></Screen>;

  // A code that has already been used opens the planter instead of erroring.
  if (preview.outcome === 'already_claimed' && preview.planter) {
    return <Navigate to={`/planters/${preview.planter.id}`} replace />;
  }
  if (preview.outcome === 'expired') return <ClaimExpired planterId={planterId} />;
  if (preview.outcome === 'unknown' || !preview.planter) return <ClaimUnknown />;

  return (
    <ClaimConfirm
      planter={preview.planter}
      token={token}
      onClaimed={setClaimedId}
      onExpired={() => setPreview({ outcome: 'expired', planter: null })}
    />
  );
}

function ClaimConfirm({
  planter,
  token,
  onClaimed,
  onExpired,
}: {
  planter: PlanterView;
  token: string;
  onClaimed: (id: string) => void;
  onExpired: () => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [name, setName] = useState(planter.name);
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

  async function claim(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post<ClaimResponse>('/api/claim', {
        planterId: planter.id,
        token,
        name: name.trim() || planter.id,
        presetId: presetId || undefined,
      });
      if (res.outcome === 'ready' || res.outcome === 'already_claimed') onClaimed(planter.id);
      else if (res.outcome === 'expired') onExpired();
      else setError('That code is not valid for this planter.');
    } catch {
      setError('Could not reach the planter service. Check you are on the same network.');
    } finally {
      setBusy(false);
    }
  }

  // Keep the leading zeros: the design reads "Claim planter 002?", not "2".
  const shortId = planter.id.replace(/^planter-/, '');

  return (
    <Screen>
      <ScreenHead title={`Claim planter ${shortId}?`} back="/add" backLabel="Back to scanning" />

      <form className="stack" onSubmit={claim}>
        <div className="card idcard">
          <span className="idcard__label">Planter ID</span>
          <span className="idcard__value">{planter.id}</span>
          <Chip tone="green">Ready to claim</Chip>
        </div>

        <div className="field">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            type="text"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="preset">Preset</label>
          <select id="preset" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <p className="fineprint">
          This pairing code works once and expires 7 days after it was created. After you claim
          the planter, it appears on your home screen.
        </p>

        {error && <p className="formerror" role="alert">{error}</p>}

        <button type="submit" className="button button--primary button--block screen__foot" disabled={busy}>
          {busy ? 'Claiming…' : 'Claim planter'}
        </button>
      </form>
    </Screen>
  );
}

/** Live, not a static confirmation: the sync rows settle as the device answers. */
function ClaimDone({ planterId }: { planterId: string }) {
  const planter = usePlanter(planterId);
  if (!planter) return <Screen><p className="lede">Waiting for the planter…</p></Screen>;

  const sensorsReporting =
    planter.reported.waterTempC !== undefined || planter.reported.waterOk !== undefined;
  const presetName = planter.preset?.name ?? 'Preset';

  return (
    <Screen>
      <Hero tone="success" label="Success" title={`${planter.name} is online`}>
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

      <Link to="/" className="button button--primary button--block">
        See all planters
      </Link>
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

function ClaimExpired({ planterId }: { planterId: string }) {
  return (
    <Screen>
      <Hero tone="warning" label="Expired" title="This code has expired">
        Claim codes work for 7 days after they are created. Create a fresh code for{' '}
        {planterId || 'this planter'} and scan it again.
      </Hero>
      <p className="note-card">
        A code that has already been used opens the planter instead of showing an error.
      </p>
      <Link to="/" className="button button--primary button--block">
        Back to your planters
      </Link>
    </Screen>
  );
}

/** Not drawn on the canvas. Same shape as expired, different cause. */
function ClaimUnknown() {
  return (
    <Screen>
      <Hero tone="unknown" label="Not recognised" title="We do not recognise this code">
        The link may be incomplete, or the planter may have been removed. Create a fresh code and
        scan it again.
      </Hero>
      <p className="note-card">
        Check the whole QR code was in frame. Claim links carry both a planter ID and a pairing
        code, and both must match.
      </p>
      <Link to="/" className="button button--primary button--block">
        Back to your planters
      </Link>
    </Screen>
  );
}
