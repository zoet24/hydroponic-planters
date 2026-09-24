import { Link } from 'react-router-dom';
import { useDevDrawer, useLongPress } from '../components/DevDrawer';
import { PlanterCard } from '../components/PlanterCard';
import { fleetSummary } from '../lib/format';
import { usePlanters } from '../PlantersContext';

export function Home() {
  const { planters, connection } = usePlanters();
  const dev = useDevDrawer();
  const longPress = useLongPress(() => dev.setOpen(true));

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
            <PlanterCard key={p.id} planter={p} />
          ))}
        </div>
      )}
    </div>
  );
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
