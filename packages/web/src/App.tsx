import { useEffect, useState } from 'react';
import { post, usePlanters, type PlanterView } from './usePlanters';

interface Preset {
  id: string;
  name: string;
  plantType: string;
}

/**
 * The spine, not the design. This screen exists to prove telemetry, commands and
 * desired-versus-reported all work end to end. The real screens come next, built
 * to design/screens.
 */
export function App() {
  const { planters, connection } = usePlanters();
  const [presets, setPresets] = useState<Preset[]>([]);

  useEffect(() => {
    fetch('/api/presets')
      .then((r) => r.json())
      .then(setPresets)
      .catch(() => setPresets([]));
  }, []);

  return (
    <main className="page">
      <div className="topbar">
        <h1>Planters</h1>
        <span className={`chip ${connection === 'live' ? 'green' : connection === 'lost' ? 'red' : 'grey'}`}>
          {connection === 'live' ? 'Live' : connection === 'lost' ? 'Reconnecting' : 'Connecting'}
        </span>
      </div>

      {planters.length === 0 ? (
        <p className="sub">
          Nothing yet. Start the broker and simulator: <code>pnpm dev</code>
        </p>
      ) : (
        <div className="grid">
          {planters.map((p) => (
            <PlanterCard key={p.id} planter={p} presets={presets} />
          ))}
        </div>
      )}
    </main>
  );
}

function PlanterCard({ planter: p, presets }: { planter: PlanterView; presets: Preset[] }) {
  const num = (v: unknown, digits = 1) => (typeof v === 'number' ? v.toFixed(digits) : '—');

  return (
    <section className="card">
      <h2>{p.name}</h2>
      <p className="sub">
        {p.plantType ?? 'No plant assigned'}
        {p.simulated && ' · simulated'}
      </p>

      <div className="chips">
        <span className={`chip ${p.online ? 'green' : 'red'}`}>{p.online ? 'Online' : 'Offline'}</span>
        {p.reported.waterOk === false && <span className="chip red">Low water</span>}
        {p.reported.waterOk === true && <span className="chip green">Water OK</span>}
        {p.syncing && (
          <span className={`chip ${p.syncStale ? 'amber' : 'grey'}`}>
            {p.syncStale ? 'Not confirmed' : 'Syncing'} · {p.pending.length}
          </span>
        )}
      </div>

      <div className="readouts">
        <div className="readout">
          {num(p.reported.waterTempC)}°<small>Water</small>
        </div>
        <div className="readout">
          {num(p.reported.lightLux, 0)}<small>Lux</small>
        </div>
        <div className="readout">
          {p.reported.pumpOn ? num(p.flowEstimateLpm) : 'Off'}
          <small>{p.reported.pumpOn ? 'L/min (estimated)' : 'Pump'}</small>
        </div>
      </div>

      {p.alerts.length === 0 ? (
        <div className="alert ok">No active alerts</div>
      ) : (
        p.alerts.map((a) => (
          <div key={a.kind} className={`alert ${a.severity}`}>
            {a.message}
          </div>
        ))
      )}

      <hr className="rule" />

      <div className="row">
        <select
          value={p.presetId ?? ''}
          onChange={(e) => post(`/api/planters/${p.id}/preset`, { presetId: e.target.value })}
        >
          <option value="" disabled>
            Choose a plant…
          </option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
        <button className="primary" onClick={() => post(`/api/planters/${p.id}/pump/run-now`)}>
          Run pump now
        </button>
      </div>

      {p.pending.length > 0 && (
        <p className="sync">
          Waiting on: {p.pending.join(', ')}
        </p>
      )}

      <hr className="rule" />

      <div className="row">
        <span className="sync">Faults:</span>
        {(['lowWater', 'sensorDropout', 'offline'] as const).map((kind) => (
          <button
            key={kind}
            className="small"
            onClick={() => post(`/api/sim/${p.id}/fault`, { kind, on: !faultLooksOn(p, kind) })}
          >
            {kind}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Best-effort, for a toggle button label. The simulator owns the real state. */
function faultLooksOn(p: PlanterView, kind: string): boolean {
  if (kind === 'lowWater') return p.reported.waterOk === false;
  if (kind === 'offline') return !p.online;
  return false;
}
