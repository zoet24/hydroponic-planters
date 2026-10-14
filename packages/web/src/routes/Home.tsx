import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlanterCard } from '../components/PlanterCard';
import { EditPlanterSheet, RemovePlanterSheet } from '../components/PlanterSheets';
import { fleetSummary } from '../lib/format';
import { usePlanters } from '../PlantersContext';

export function Home() {
  const { planters: fleet, connection } = usePlanters();

  // The dashboard shows only what has been added. The backend discovers any
  // device that publishes, so without this gate a planter would appear the
  // instant it powered up and the fleet could never start empty.
  const planters = fleet.filter((p) => p.added);
  const waiting = fleet.length - planters.length;

  const arriving = useArrivals(planters.map((p) => p.id));

  // Held by id rather than by object, so the sheet follows the planter as SSE
  // pushes updates rather than freezing the copy it opened with.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const editing = planters.find((p) => p.id === editingId) ?? null;
  const removing = planters.find((p) => p.id === removingId) ?? null;

  return (
    <div className="page">
      <header className="masthead">
        <span className="wordmark">Smart Planter</span>
        <div className="masthead__right">
          {connection !== 'live' && (
            <span className="connection" role="status">
              {connection === 'lost' ? 'Reconnecting…' : 'Connecting…'}
            </span>
          )}
          <Link to="/add" className="button button--primary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add planter
          </Link>
        </div>
      </header>

      <div>
        <h1>Your planters</h1>
        <p className="lede">{fleetSummary(planters)}</p>
      </div>

      {waiting > 0 && planters.length > 0 && (
        <Link to="/add" className="note-card note-card--link">
          {waiting === 1 ? '1 planter is' : `${waiting} planters are`} ready to add
        </Link>
      )}

      {planters.length === 0 ? <EmptyState /> : (
        <div className="planter-grid">
          {planters.map((p) => (
            <PlanterCard
              key={p.id}
              planter={p}
              arriving={arriving.has(p.id)}
              onEdit={() => setEditingId(p.id)}
              onRemove={() => setRemovingId(p.id)}
            />
          ))}
        </div>
      )}

      {editing && <EditPlanterSheet planter={editing} onClose={() => setEditingId(null)} />}
      {removing && <RemovePlanterSheet planter={removing} onClose={() => setRemovingId(null)} />}
    </div>
  );
}

/**
 * Ids that turned up after the first snapshot, for two seconds each.
 *
 * The first snapshot is treated as already known — otherwise every planter
 * would ring on page load, which tells you nothing.
 */
function useArrivals(ids: string[]): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const [arriving, setArriving] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (ids.length === 0) return;

    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }

    const fresh = ids.filter((id) => !seen.current!.has(id));
    if (fresh.length === 0) return;

    for (const id of fresh) seen.current.add(id);
    setArriving((prev) => new Set([...prev, ...fresh]));

    const timer = setTimeout(() => {
      setArriving((prev) => {
        const next = new Set(prev);
        for (const id of fresh) next.delete(id);
        return next;
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [ids.join(',')]);

  return arriving;
}

/** Not drawn on the canvas. Built to the same tokens. */
function EmptyState() {
  return (
    <div className="card empty">
      <h2 className="card__title">No planters yet</h2>
      <p className="card__sub">
        Plug a planter in and put it on the same network as this app. It will show up under Add
        planter within a few seconds.
      </p>
      <Link to="/add" className="button button--primary">
        Add your first planter
      </Link>
    </div>
  );
}
