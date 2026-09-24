import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LineChart, PumpStrip } from '../components/Chart';
import { Chip } from '../components/Chip';
import { EventIcon } from '../components/EventIcon';
import { configRows, dueLabel } from '../lib/detail';
import {
  collapsePumpRuns,
  describeEvent,
  eventIcon,
  eventTime,
  eventTone,
  type PlanterEvent,
} from '@planter/shared';
import { luxLabel, relativeTime } from '../lib/format';
import { trimZero, type Point } from '@planter/shared';
import { api, post, usePlanter } from '../PlantersContext';
import type { PlanterView } from '../types';

const RANGES = [
  { label: '1 h', ms: 3_600_000 },
  { label: '6 h', ms: 21_600_000 },
  { label: '24 h', ms: 86_400_000 },
] as const;

export function PlanterDetail() {
  const { id } = useParams();
  const planter = usePlanter(id);
  const [rangeMs, setRangeMs] = useState<number>(RANGES[2].ms);

  if (!planter) {
    return (
      <div className="page">
        <Link to="/" className="backlink">Your planters</Link>
        <p className="lede">No planter with that ID. It may not have been claimed yet.</p>
      </div>
    );
  }

  return (
    <div className="page page--detail">
      <DetailHeader planter={planter} />
      <Live planter={planter} />
      <Config planter={planter} />
      <History planter={planter} rangeMs={rangeMs} onRange={setRangeMs} />
      <Timeline planterId={planter.id} />
    </div>
  );
}

function DetailHeader({ planter: p }: { planter: PlanterView }) {
  return (
    <header className="detail-head">
      <Link to="/" className="backlink">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        Your planters
      </Link>

      <div className="detail-head__row">
        <h1>{p.name}</h1>
        <Chip tone={p.online ? 'green' : 'red'}>
          {p.online ? 'Online' : `Offline, last seen ${relativeTime(p.lastSeenAt)}`}
        </Chip>
        {p.preset && <span className="chip chip--grey chip--plain">{p.preset.name} preset</span>}
        {p.preset && (
          <Link to={`/planters/${p.id}/ph`} className="chip chip--amber chip--link">
            <span className="chip__dot" aria-hidden="true" />
            pH check due {dueLabel(p.phCheckDueAt)}
          </Link>
        )}
      </div>

      {p.alerts.length === 0 ? (
        <div className="banner banner--ok">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          No active alerts
        </div>
      ) : (
        p.alerts.map((a) => (
          <div key={a.kind} className={`banner banner--${a.severity}`} role="status">
            {a.message}
          </div>
        ))
      )}
    </header>
  );
}

function Live({ planter: p }: { planter: PlanterView }) {
  const tempInRange =
    p.preset && p.reported.waterTempC !== undefined
      ? p.reported.waterTempC >= p.preset.waterTempC.min && p.reported.waterTempC <= p.preset.waterTempC.max
      : null;
  const lightLow = p.alerts.some((a) => a.kind === 'light_low');
  const waterOk = p.reported.waterOk;

  return (
    <section className="section">
      <h2>Live</h2>
      <div className="stat-grid">
        <Stat
          label="Water temperature"
          value={p.reported.waterTempC !== undefined ? p.reported.waterTempC.toFixed(1) : '—'}
          unit="°C"
          chip={tempInRange === null ? null : { tone: tempInRange ? 'green' : 'amber', text: tempInRange ? 'In range' : 'Outside the preset range' }}
        />
        <Stat
          label="Light level"
          value={p.reported.lightLux !== undefined ? Math.round(p.reported.lightLux).toLocaleString('en-GB') : '—'}
          unit="lux"
          chip={!p.preset ? null : { tone: lightLow ? 'amber' : 'green', text: lightLow ? 'Not enough over the day' : 'Bright enough' }}
        />
        <Stat
          label="Water level"
          value={waterOk === undefined ? '—' : waterOk ? 'OK' : 'Low'}
          chip={waterOk === undefined ? null : { tone: waterOk ? 'green' : 'red', text: waterOk ? 'Above the float switch' : 'Below the float switch' }}
        />
        <Stat
          label="Pump"
          value={pumpState(p)}
          note={pumpNote(p)}
        />
      </div>
    </section>
  );
}

const pumpState = (p: PlanterView): string => {
  if (!p.online) return '—';
  if (p.reported.pumpOn) return 'Running';
  if (p.reported.pumpBlocked) return 'Blocked';
  if (p.reported.pumpEnable === false) return 'Paused';
  return 'Idle';
};

function pumpNote(p: PlanterView): string {
  if (p.reported.pumpBlocked) {
    return p.reported.waterOk === false
      ? 'The device interlock is holding the pump off until the water is topped up.'
      : 'The device interlock is holding the pump off.';
  }
  const flow = p.reported.pumpOn ? ` Flow ≈ ${p.flowEstimateLpm.toFixed(1)} L/min (estimated).` : '';
  const next = p.reported.nextScheduledRuns ? `Scheduled runs at ${p.reported.nextScheduledRuns}.` : '';
  return `${next}${flow}`.trim() || 'No schedule reported yet.';
}

function Stat({
  label,
  value,
  unit,
  chip,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  chip?: { tone: 'green' | 'amber' | 'red'; text: string } | null;
  note?: string;
}) {
  return (
    <div className="card stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">
        {value}
        {unit && <span className="stat__unit">{unit}</span>}
      </div>
      {chip && <Chip tone={chip.tone}>{chip.text}</Chip>}
      {note && <p className="stat__note">{note}</p>}
    </div>
  );
}

function Config({ planter: p }: { planter: PlanterView }) {
  const [busy, setBusy] = useState(false);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await post(`/api/planters/${p.id}/desired`, body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <div className="section__head">
        <h2>Config</h2>
        <div className="row">
          <Link to={`/planters/${p.id}/preset`} className="button">Change preset</Link>
          <Link to={`/planters/${p.id}/ai`} className="button button--primary">Create with AI</Link>
        </div>
      </div>

      <div className="card config">
        <p className="config__explainer">
          The app sets what it wants. The planter reports what it is actually doing. Each setting
          is confirmed when the two match.
        </p>

        <div className="config__table">
          <div className="config__row config__row--head">
            <span>Setting</span><span>Wanted</span><span>Reported by the planter</span><span>Status</span>
          </div>

          {configRows(p).map((row) => {
            const pending = p.pending.includes(row.field);
            const stale = pending && p.syncStale;
            return (
              <div key={row.field} className="config__row">
                <span className="config__setting">{row.label}</span>
                <span>{row.wanted}</span>
                <span>{row.reported}</span>
                <span className="config__status">
                  {!pending ? (
                    <Chip tone="green">Confirmed</Chip>
                  ) : stale ? (
                    <>
                      <Chip tone="amber">Not confirmed after 10 s</Chip>
                      <button
                        type="button"
                        className="button button--small"
                        disabled={busy}
                        onClick={() => send({ [row.field]: p.desired[row.field as keyof typeof p.desired] })}
                      >
                        Retry
                      </button>
                    </>
                  ) : (
                    <Chip tone="grey">Syncing</Chip>
                  )}
                </span>
              </div>
            );
          })}

          <div className="config__row config__row--foot">
            <span className="config__setting">Next scheduled runs</span>
            <span className="config__spanrest">
              {p.reported.nextScheduledRuns
                ? `${p.reported.nextScheduledRuns} (reported by the planter)`
                : 'Not reported yet'}
            </span>
          </div>
        </div>

        <div className="row">
          <button type="button" className="button button--primary" disabled={busy}
            onClick={() => post(`/api/planters/${p.id}/pump/run-now`)}>
            Run pump now
          </button>
          <button type="button" className="button" disabled={busy}
            onClick={() => send({ pumpEnable: !p.desired.pumpEnable })}>
            {p.desired.pumpEnable ? 'Pause pump' : 'Resume pump'}
          </button>
          <button type="button" className="button" disabled={busy}
            onClick={() => post(`/api/planters/${p.id}/nutrients`)}>
            I added nutrients
          </button>
        </div>
      </div>
    </section>
  );
}

function History({
  planter: p,
  rangeMs,
  onRange,
}: {
  planter: PlanterView;
  rangeMs: number;
  onRange: (ms: number) => void;
}) {
  const [temp, setTemp] = useState<Point[]>([]);
  const [light, setLight] = useState<Point[]>([]);
  const [runs, setRuns] = useState<number[]>([]);
  const [to, setTo] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);

  // Refetch on range change, and again whenever live state moves on.
  useEffect(() => {
    const now = Date.now();
    const from = now - rangeMs;
    setTo(now);
    setLoading(true);

    const readings = (metric: string) =>
      api<Point[]>(`/api/planters/${p.id}/readings?metric=${metric}&from=${from}&to=${now}`);

    void Promise.all([
      readings('water_temp_c').then(setTemp).catch(() => setTemp([])),
      readings('light_lux').then(setLight).catch(() => setLight([])),
    ]).finally(() => setLoading(false));
    void api<PlanterEvent[]>(`/api/planters/${p.id}/events?limit=500&from=${from}`)
      .then((events) =>
        setRuns(events.filter((e) => e.type === 'pump_run' && e.payload?.on === true).map((e) => e.ts)),
      )
      .catch(() => setRuns([]));
  }, [p.id, rangeMs, p.reported.pumpOn]);

  const from = to - rangeMs;

  return (
    <section className="section">
      <div className="section__head">
        <h2>History</h2>
        <div className="segmented" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              aria-pressed={rangeMs === r.ms}
              onClick={() => onRange(r.ms)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card history">
        <div className="legend">
          <span><span className="legend__line" style={{ background: 'var(--green)' }} />Water temperature</span>
          <span><span className="legend__line" style={{ background: 'var(--chip-amber-dot)' }} />Light level</span>
          <span><span className="legend__bar" />Pump run</span>
        </div>

        <LineChart
          points={temp}
          from={from}
          to={to}
          colour="var(--green)"
          format={(v) => `${trimZero(v)} °C`}
          loading={loading}
          title={`Water temperature over the last ${rangeMs / 3_600_000} hours`}
        />
        <LineChart
          points={light}
          from={from}
          to={to}
          colour="var(--chip-amber-dot)"
          format={luxLabel}
          zeroFloor
          loading={loading}
          title={`Light level over the last ${rangeMs / 3_600_000} hours`}
        />
        <PumpStrip runs={runs} from={from} to={to} />
      </div>
    </section>
  );
}

function Timeline({ planterId }: { planterId: string }) {
  const [events, setEvents] = useState<PlanterEvent[]>([]);

  useEffect(() => {
    const load = () =>
      // Ask for more than we show: start/stop pairs collapse into single rows.
      api<PlanterEvent[]>(`/api/planters/${planterId}/events?limit=80`)
        .then((list) => setEvents(collapsePumpRuns(list).slice(0, 40)))
        .catch(() => setEvents([]));
    void load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [planterId]);

  return (
    <section className="section">
      <h2>Timeline</h2>
      <div className="card timeline">
        {events.length === 0 ? (
          <p className="stat__note">Nothing has happened yet.</p>
        ) : (
          events.map((e) => (
            <div key={e.id} className="timeline__row">
              <span className={`timeline__dot timeline__dot--${eventTone(e.type)}`}>
                <EventIcon name={eventIcon(e.type)} />
              </span>
              <span className="timeline__time">{eventTime(e.ts)}</span>
              <span>{describeEvent(e)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
