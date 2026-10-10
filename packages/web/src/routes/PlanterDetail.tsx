import { useEffect, useState } from 'react';
import { Link, Outlet, useParams } from 'react-router-dom';
import { EventStrip, LineChart, type Mark } from '../components/Chart';
import { Chip } from '../components/Chip';
import { EventIcon } from '../components/EventIcon';
import { AI_PRESETS_ENABLED } from '../features';
import { configRows } from '../lib/detail';
import {
  collapsePumpRuns,
  describeEvent,
  eventIcon,
  eventNote,
  eventTime,
  eventTone,
  type PlanterEvent,
} from '@planter/shared';
import { growingFor, nutrientSummary, relativeTime, waterLabel } from '../lib/format';
import { sortAlerts, trimZero, type Point } from '@planter/shared';
import { api, patch, post, usePlanter } from '../PlantersContext';
import type { PlanterView } from '../types';

export function PlanterDetail() {
  const { id } = useParams();
  const planter = usePlanter(id);

  if (!planter) {
    return (
      <div className="page">
        <Link to="/" className="backlink">Your planters</Link>
        <p className="lede">No planter with that ID. It may not have been added yet.</p>
      </div>
    );
  }

  return (
    <div className="page page--detail">
      <DetailHeader planter={planter} />
      <Actions planter={planter} />
      <Live planter={planter} />
      <Config planter={planter} />
      <TimelineSection planter={planter} />
      <Outlet />
    </div>
  );
}

function DetailHeader({ planter: p }: { planter: PlanterView }) {
  const grown = growingFor(p.plantedAt);

  return (
    <header className="detail-head">
      <Link to="/" className="backlink">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" />
        </svg>
        Your planters
      </Link>

      <div className="detail-head__row">
        <h1>
          {p.name}
          {p.preset && <span className="detail-head__preset"> · {p.preset.name}</span>}
        </h1>
        <Chip tone={p.online ? 'green' : 'red'}>
          {p.online ? 'Online' : `Offline, last seen ${relativeTime(p.lastSeenAt)}`}
        </Chip>
        <Chip tone="grey">{p.simulated ? 'Simulated' : 'Real planter'}</Chip>
        <PlantedFor planter={p} grown={grown} />
      </div>
    </header>
  );
}

/**
 * The growing clock, and the only place to set it.
 *
 * Inline rather than a modal: it is one date, and a planter added before the
 * field existed would otherwise have no way to acquire one.
 */
function PlantedFor({ planter: p, grown }: { planter: PlanterView; grown: string | null }) {
  const [editing, setEditing] = useState(false);

  const save = async (value: string) => {
    setEditing(false);
    if (!value) return;
    // Midday, not midnight: a date-only value parsed as UTC can land on the
    // previous day once it is rendered in a western timezone.
    const at = new Date(`${value}T12:00:00`).getTime();
    try {
      await patch(`/api/planters/${p.id}`, { plantedAt: at });
    } catch {
      /* the chip simply keeps its old value */
    }
  };

  if (editing) {
    return (
      <input
        type="date"
        className="chip chip--grey chip--planted chip--date"
        autoFocus
        defaultValue={p.plantedAt ? new Date(p.plantedAt).toISOString().slice(0, 10) : ''}
        max={new Date().toISOString().slice(0, 10)}
        onBlur={(e) => void save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save((e.target as HTMLInputElement).value);
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }

  return (
    <button type="button" className="chip chip--grey chip--planted" onClick={() => setEditing(true)}>
      {grown ?? 'Set planter start date'}
    </button>
  );
}

/**
 * Everything wanting attention, most urgent first.
 *
 * Two kinds, told apart visually: conditions the system reports and the user
 * cannot clear by pressing anything (offline, low water, cold water), and
 * records the user can make, which both clear the alert and write to the
 * timeline. Only the second kind is clickable.
 */
function Actions({ planter: p }: { planter: PlanterView }) {
  const alerts = sortAlerts(p.alerts);

  return (
    <section className="section">
      <h2>Actions</h2>
      {alerts.length === 0 ? (
        <div className="banner banner--ok">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          Nothing needs doing
        </div>
      ) : (
        <div className="stack stack--alerts">
          {alerts.map((a) =>
            a.action ? (
              <Link
                key={a.kind}
                to={`/planters/${p.id}/${a.action === 'ph_check' ? 'ph' : 'nutrients'}`}
                className={`banner banner--${a.severity} banner--action`}
              >
                <span className="banner__tag">You</span>
                <span className="banner__text">{a.message}</span>
                <svg className="banner__chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ) : (
              <div key={a.kind} className={`banner banner--${a.severity}`} role="status">
                <span className="banner__tag banner__tag--system">Planter</span>
                <span className="banner__text">{a.message}</span>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function Live({ planter: p }: { planter: PlanterView }) {
  const tempInRange =
    p.preset && p.reported.waterTempC !== undefined
      ? p.reported.waterTempC >= p.preset.waterTempC.min && p.reported.waterTempC <= p.preset.waterTempC.max
      : null;
  const waterOk = p.reported.waterOk;

  return (
    <section className="section">
      <h2>Live</h2>
      <div className="stat-grid stat-grid--three">
        <Stat
          label="Water temperature"
          value={p.reported.waterTempC !== undefined ? p.reported.waterTempC.toFixed(1) : '—'}
          unit="°C"
          chip={
            tempInRange === null
              ? null
              : { tone: tempInRange ? 'green' : 'amber', text: tempInRange ? 'In range' : 'Outside the preset range' }
          }
          note={tempInRange === false ? 'The tower cannot change its own water temperature.' : undefined}
        />
        <Stat
          label="Water level"
          value={waterLabel(waterOk)}
          chip={
            waterOk === undefined
              ? null
              : { tone: waterOk ? 'green' : 'red', text: waterOk ? 'Above the float switch' : 'Below the float switch' }
          }
        />
        <Stat label="Pump" value={pumpState(p)} note={pumpNote(p)} />
      </div>

      {/* Recording something is a different act from changing the planter's
          configuration, so these sit with the readings rather than in Config. */}
      <div className="row row--records">
        <Link to={`/planters/${p.id}/nutrients`} className="button button--primary">Record nutrients</Link>
        <Link to={`/planters/${p.id}/ph`} className="button button--primary">Record pH</Link>
        <Link to={`/planters/${p.id}/note`} className="button button--primary">Add note</Link>
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
  const [error, setError] = useState<string | null>(null);

  /** Every control here goes through this, so a refusal is always visible. */
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const send = (body: Record<string, unknown>) =>
    run(() => post(`/api/planters/${p.id}/desired`, body));

  return (
    <section className="section">
      <div className="section__head">
        <h2>Config{p.preset ? `: ${p.preset.name} preset` : ''}</h2>
        <div className="row">
          <Link
            to={`/planters/${p.id}/preset`}
            className={`button${AI_PRESETS_ENABLED ? '' : ' button--primary'}`}
          >
            Change preset
          </Link>
          {AI_PRESETS_ENABLED && (
            <Link to={`/planters/${p.id}/ai`} className="button button--primary">Create with AI</Link>
          )}
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

          <div className="config__row config__row--foot">
            <span className="config__setting">Nutrients</span>
            <span className="config__spanrest">{nutrientSummary(p)}</span>
          </div>
        </div>

        <div className="row row--spread">
          {/* Stop replaces Run while the pump is actually running, so the
              primary control is always the one that does something. */}
          {p.reported.pumpOn ? (
            <button type="button" className="button button--primary" disabled={busy || !p.online}
              onClick={() => run(() => post(`/api/planters/${p.id}/pump/stop`))}>
              Stop pump
            </button>
          ) : (
            <button type="button" className="button button--primary" disabled={busy || !p.online}
              onClick={() => run(() => post(`/api/planters/${p.id}/pump/run-now`))}>
              Run pump now
            </button>
          )}
          {/* Distinct from Stop: this is about every future run, not this one. */}
          <button type="button" className="button" disabled={busy}
            onClick={() => send({ pumpEnable: !p.desired.pumpEnable })}>
            {p.desired.pumpEnable ? 'Pause schedule' : 'Resume schedule'}
          </button>
        </div>

        {error && <p className="formerror" role="alert">{error}</p>}
      </div>
    </section>
  );
}

/** Preset windows, plus a custom range for anything else. */
const RANGE_PRESETS = [
  { key: '24h', label: '24 h', ms: 86_400_000 },
  { key: '7d', label: '7 days', ms: 7 * 86_400_000 },
  { key: '30d', label: '30 days', ms: 30 * 86_400_000 },
  { key: 'all', label: 'All', ms: 365 * 86_400_000 },
] as const;

/**
 * Which log entries each filter tag covers.
 *
 * Grouped by what the grower did or what happened, not by the event type name:
 * "System" covering three connection events is more useful than three tags
 * nobody wants to toggle separately.
 */
const LOG_FILTERS = [
  { key: 'pump', label: 'Pump', types: ['pump_run'] },
  { key: 'ph', label: 'pH', types: ['ph_checkin'] },
  { key: 'nutrients', label: 'Nutrients', types: ['nutrients_added'] },
  { key: 'notes', label: 'Notes', types: ['note'] },
  { key: 'alerts', label: 'Alerts', types: ['low_water'] },
  { key: 'system', label: 'System', types: ['online', 'offline', 'added', 'preset_applied'] },
] as const;

interface PhPoint {
  ts: number;
  ph: number;
  status: string;
  note: string | null;
}

/**
 * History and the log, together.
 *
 * They were two sections showing the same events twice over. Combined, every
 * measure gets its own lane on one shared time axis, and selecting a log entry
 * rules a line down all of them — which is the whole reason to want pH and
 * feeding on the same screen as the temperature.
 */
function TimelineSection({ planter: p }: { planter: PlanterView }) {
  const [rangeKey, setRangeKey] = useState<string>('24h');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [temp, setTemp] = useState<Point[]>([]);
  const [ph, setPh] = useState<PhPoint[]>([]);
  const [events, setEvents] = useState<PlanterEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PlanterEvent | null>(null);
  const [active, setActive] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [window, setWindow] = useState(() => {
    const now = Date.now();
    return { from: now - 86_400_000, to: now };
  });

  // Recompute the window whenever the range choice changes, and refresh it as
  // live state moves on so a 24h view keeps tracking "now".
  useEffect(() => {
    if (custom) {
      const from = new Date(`${custom.from}T00:00:00`).getTime();
      const to = new Date(`${custom.to}T23:59:59`).getTime();
      if (!Number.isNaN(from) && !Number.isNaN(to) && from < to) setWindow({ from, to });
      return;
    }
    const preset = RANGE_PRESETS.find((r) => r.key === rangeKey) ?? RANGE_PRESETS[0];
    const now = Date.now();
    setWindow({ from: now - preset.ms, to: now });
  }, [rangeKey, custom, p.reported.pumpOn]);

  useEffect(() => {
    const { from, to } = window;
    setLoading(true);

    void Promise.allSettled([
      api<Point[]>(`/api/planters/${p.id}/readings?metric=water_temp_c&from=${from}&to=${to}`),
      api<PhPoint[]>(`/api/planters/${p.id}/ph-history?from=${from}&to=${to}`),
      api<PlanterEvent[]>(`/api/planters/${p.id}/events?limit=2000&from=${from}&to=${to}`),
    ]).then(([t, h, e]) => {
      setTemp(t.status === 'fulfilled' ? t.value : []);
      setPh(h.status === 'fulfilled' ? h.value : []);
      setEvents(e.status === 'fulfilled' ? e.value : []);
      setLoading(false);
    });
  }, [p.id, window.from, window.to]);

  const { from, to } = window;
  const marksOf = (type: string, text: (e: PlanterEvent) => string | null): Mark[] =>
    events.filter((e) => e.type === type).map((e) => ({ ts: e.ts, note: text(e) }));

  const runs: Mark[] = events
    .filter((e) => e.type === 'pump_run' && e.payload?.on === true)
    .map((e) => ({ ts: e.ts, note: `at ${String(e.payload?.speedPercent ?? '?')}% speed` }));
  const feeds = marksOf('nutrients_added', eventNote);
  const notes = marksOf('note', (e) => (typeof e.payload?.text === 'string' ? e.payload.text : null));

  const allowed = active.length === 0 ? null : new Set(LOG_FILTERS.filter((f) => active.includes(f.key)).flatMap((f) => f.types as readonly string[]));
  const needle = query.trim().toLowerCase();
  const log = collapsePumpRuns(events)
    .filter((e) => (allowed === null ? true : allowed.has(e.type)))
    .filter((e) => (needle === '' ? true : describeEvent(e).toLowerCase().includes(needle)))
    .slice(0, 200);

  const toggle = (key: string) =>
    setActive((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  return (
    <section className="section">
      <div className="section__head">
        <h2>Timeline</h2>
        <RangePicker
          rangeKey={rangeKey}
          custom={custom}
          onPreset={(k) => {
            setCustom(null);
            setRangeKey(k);
          }}
          onCustom={setCustom}
        />
      </div>

      <div className="card history">
        <div className="legend">
          <span><span className="legend__line" style={{ background: 'var(--green)' }} />Water temperature</span>
          <span><span className="legend__line" style={{ background: 'var(--violet, #6b4fbb)' }} />pH</span>
          <span><span className="legend__bar" />Pump run</span>
        </div>

        <LineChart
          points={temp}
          from={from}
          to={to}
          colour="var(--green)"
          format={(v) => `${trimZero(v)} °C`}
          loading={loading}
          selectedTs={selected?.ts ?? null}
          band={p.preset ? { min: p.preset.waterTempC.min, max: p.preset.waterTempC.max } : null}
          title="Water temperature"
        />

        <LineChart
          points={ph.map((r) => ({ ts: r.ts, value: r.ph, note: r.note }))}
          from={from}
          to={to}
          colour="var(--violet, #6b4fbb)"
          format={(v) => `pH ${v.toFixed(1)}`}
          loading={loading}
          dots
          selectedTs={selected?.ts ?? null}
          band={p.preset ? { min: p.preset.ph.targetMin, max: p.preset.ph.targetMax } : null}
          title="pH check-ins"
        />

        <EventStrip label="Pump" items={runs} from={from} to={to} selectedTs={selected?.ts ?? null} />
        <EventStrip label="Nutrients" items={feeds} from={from} to={to} colour="var(--chip-amber-text, #8a5a00)" selectedTs={selected?.ts ?? null} />
        <EventStrip label="Notes" items={notes} from={from} to={to} colour="var(--muted)" axis selectedTs={selected?.ts ?? null} />
      </div>

      <div className="log-controls">
        <div className="chips chips--filters" role="group" aria-label="Filter the log">
          {LOG_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={active.includes(f.key)}
              className={`chip chip--filter${active.includes(f.key) ? ' chip--filter-on' : ''}`}
              onClick={() => toggle(f.key)}
            >
              {f.label}
            </button>
          ))}
          {active.length > 0 && (
            <button type="button" className="chip chip--filter chip--clear" onClick={() => setActive([])}>
              Clear
            </button>
          )}
        </div>
        <input
          type="search"
          className="log-search"
          placeholder="Search the log"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the log"
        />
      </div>

      <div className="card timeline">
        {log.length === 0 ? (
          <p className="stat__note">
            {events.length === 0 ? 'Nothing has happened yet.' : 'Nothing matches those filters.'}
          </p>
        ) : (
          log.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`timeline__row timeline__row--button${selected?.id === e.id ? ' timeline__row--selected' : ''}`}
              aria-pressed={selected?.id === e.id}
              onClick={() => setSelected((cur) => (cur?.id === e.id ? null : e))}
            >
              <span className={`timeline__dot timeline__dot--${eventTone(e.type)}`}>
                <EventIcon name={eventIcon(e.type)} />
              </span>
              <span className="timeline__time">{eventTime(e.ts)}</span>
              <span className="timeline__main">
                <span className="timeline__text">{describeEvent(e)}</span>
                {eventNote(e) && <span className="timeline__note">{eventNote(e)}</span>}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function RangePicker({
  rangeKey,
  custom,
  onPreset,
  onCustom,
}: {
  rangeKey: string;
  custom: { from: string; to: string } | null;
  onPreset: (key: string) => void;
  onCustom: (range: { from: string; to: string } | null) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const draft = custom ?? { from: today, to: today };

  return (
    <div className="rangepicker">
      <div className="segmented" role="group" aria-label="Time range">
        {RANGE_PRESETS.map((r) => (
          <button
            key={r.key}
            type="button"
            aria-pressed={custom === null && rangeKey === r.key}
            onClick={() => onPreset(r.key)}
          >
            {r.label}
          </button>
        ))}
        <button type="button" aria-pressed={custom !== null} onClick={() => onCustom(custom ? null : draft)}>
          Custom
        </button>
      </div>

      {custom && (
        <div className="rangepicker__dates">
          <label>
            From
            <input
              type="date"
              value={custom.from}
              max={custom.to}
              onChange={(e) => onCustom({ ...custom, from: e.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={custom.to}
              min={custom.from}
              max={today}
              onChange={(e) => onCustom({ ...custom, to: e.target.value })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
