import { Link } from 'react-router-dom';

/** The phone-width shell the Add planter and pH screens share. */
export function Screen({ children }: { children: React.ReactNode }) {
  return <div className="screen">{children}</div>;
}

export function ScreenHead({
  title,
  back,
  onBack,
  backLabel,
}: {
  title: string;
  /** Where back goes. Omitted when `onBack` steps within the same screen. */
  back?: string;
  /** For a multi-step screen: go back a step rather than navigate away. */
  onBack?: () => void;
  /** Names the destination, not the current page — "Back to your planters". */
  backLabel: string;
}) {
  const arrow = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );

  return (
    <div className="screen__head">
      {onBack ? (
        <button type="button" onClick={onBack} className="iconbutton" aria-label={backLabel}>
          {arrow}
        </button>
      ) : (
        <Link to={back ?? '/'} className="iconbutton" aria-label={backLabel}>
          {arrow}
        </Link>
      )}
      <h1 className="screen__title">{title}</h1>
    </div>
  );
}

export function Hero({
  tone,
  label,
  title,
  children,
}: {
  tone: 'success' | 'warning' | 'unknown';
  label: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="hero">
      <div className={`hero__badge hero__badge--${tone}`}>
        {tone === 'success' ? (
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        ) : tone === 'warning' ? (
          /* A clock: this code ran out of time. */
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        ) : (
          /* Not drawn on the canvas. A question mark, because "we do not know
             this code" is a different failure from "it expired". */
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label}>
            <circle cx="12" cy="12" r="9" />
            <path d="M9.2 9.3a2.9 2.9 0 1 1 3.4 3.4v1.1" />
            <path d="M12.5 17h.01" />
          </svg>
        )}
      </div>
      <h1 className="hero__title">{title}</h1>
      {children && <p className="hero__sub">{children}</p>}
    </div>
  );
}

export function Tick({ done }: { done: boolean }) {
  return done ? (
    <svg className="rowicon rowicon--done" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ) : (
    <svg className="rowicon rowicon--pending" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <circle cx="12" cy="12" r="8" strokeDasharray="4 3" />
    </svg>
  );
}
