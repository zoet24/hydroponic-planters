import { Link } from 'react-router-dom';
import { Chip } from './Chip';
import {
  describePlanter,
  isSyncing,
  waterLabel,
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
  onEdit,
  onRemove,
}: {
  planter: PlanterView;
  arriving?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const pump = pumpReadout(p);
  const noData = !p.online;

  return (
    /* The whole card is a link, so the actions cannot live inside it: an
       anchor may not contain buttons, and every click would also navigate.
       They sit alongside it instead, positioned over the corner. */
    <div className="card-wrap">
      {(onEdit || onRemove) && (
        <div className="card-actions">
          {onEdit && (
            <button type="button" className="card-action" onClick={onEdit} aria-label={`Edit ${p.name}`} title="Edit">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 20h4L19 9a2.8 2.8 0 10-4-4L4 16z" />
              </svg>
            </button>
          )}
          {onRemove && (
            <button type="button" className="card-action card-action--danger" onClick={onRemove} aria-label={`Remove ${p.name}`} title="Remove">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
              </svg>
            </button>
          )}
        </div>
      )}

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

        {/* Just the chip here. The full desired/reported table stays on the
            detail screen. */}
        {isSyncing(p) && (
          <Chip tone={p.syncStale ? 'amber' : 'grey'}>
            {p.syncStale ? 'Not confirmed' : 'Syncing'}
          </Chip>
        )}
      </div>

      <div className="readouts">
        <Readout label="Water" value={noData ? 'No data' : tempLabel(p.reported.waterTempC)} muted={noData} />
        <Readout label="Water level" value={noData ? 'No data' : waterLabel(p.reported.waterOk)} muted={noData} />
        <Readout label={pump.label} value={pump.value} muted={pump.muted} />
      </div>

      <span className="card__cta">
        Open dashboard
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </span>
    </Link>
    </div>
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
