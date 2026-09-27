import { Link } from 'react-router-dom';
import { Chip } from './Chip';
import {
  describePlanter,
  isSyncing,
  luxCompact,
  nutrientChip,
  phChip,
  pumpReadout,
  relativeTime,
  tempLabel,
} from '../lib/format';
import type { PlanterView } from '../types';

export function PlanterCard({
  planter: p,
  arriving = false,
}: {
  planter: PlanterView;
  arriving?: boolean;
}) {
  const pump = pumpReadout(p);
  const noData = !p.online;

  return (
    <Link to={`/planters/${p.id}`} className={`card card--link${arriving ? ' card--arriving' : ''}`}>
      <div>
        <div className="card__title">{p.name}</div>
        <div className="card__sub">{describePlanter(p)}</div>
      </div>

      <div className="chips">
        {p.online ? (
          <Chip tone="green">Online</Chip>
        ) : (
          <Chip tone="grey">Offline, last seen {relativeTime(p.lastSeenAt)}</Chip>
        )}

        {p.online && p.reported.waterOk === true && <Chip tone="green">Water OK</Chip>}
        {p.online && p.reported.waterOk === false && <Chip tone="red">Water low</Chip>}

        {/* Upkeep only matters while the planter is reachable — an offline
            planter has bigger problems than an overdue pH check. */}
        {p.online &&
          [phChip(p), nutrientChip(p)].map(
            (chip) =>
              chip && (
                <Chip key={chip.label} tone={chip.tone}>
                  {chip.label}
                </Chip>
              ),
          )}

        {/* Specified in UI-HANDOFF but not drawn on the artboard. The full
            desired/reported table stays on the detail screen. */}
        {isSyncing(p) && (
          <Chip tone={p.syncStale ? 'amber' : 'grey'}>
            {p.syncStale ? 'Not confirmed' : 'Syncing'}
          </Chip>
        )}
      </div>

      <div className="readouts">
        <Readout label="Water" value={noData ? 'No data' : tempLabel(p.reported.waterTempC)} muted={noData} />
        <Readout label="Light" value={noData ? 'No data' : luxCompact(p.reported.lightLux)} muted={noData} />
        <Readout label={pump.label} value={pump.value} muted={pump.muted} />
      </div>

      <span className="card__cta">
        Open dashboard
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </span>
    </Link>
  );
}

function Readout({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div className="readout__label">{label}</div>
      <div className={`readout__value${muted ? ' readout__value--muted' : ''}`}>{value}</div>
    </div>
  );
}
