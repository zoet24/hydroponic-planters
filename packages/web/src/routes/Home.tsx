import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDevDrawer, useLongPress } from '../components/DevDrawer';
import { PlanterCard } from '../components/PlanterCard';
import { fleetSummary } from '../lib/format';
import { usePlanters } from '../PlantersContext';

export function Home() {
  const { planters, connection } = usePlanters();
  const dev = useDevDrawer();
  const longPress = useLongPress(() => dev.setOpen(true));
  const arriving = useArrivals(planters.map((p) => p.id));

  return (
    <div className="page">
      <header className="masthead">
        {/* No visible affordance: a long press here opens the simulator drawer. */}
        <span className="wordmark" {...longPress}>Smart Planter</span>
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

      {planters.length === 0 ? <EmptyState /> : (
        <div className="planter-grid">
          {planters.map((p) => (
            <PlanterCard key={p.id} planter={p} arriving={arriving.has(p.id)} />
          ))}
        </div>
      )}
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
        Every planter has a QR code on its side. Scan it with your phone camera to add it here.
      </p>
      <Link to="/add" className="button button--primary">
        Add your first planter
      </Link>
    </div>
  );
}
