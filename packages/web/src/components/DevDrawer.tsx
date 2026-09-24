import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { post, usePlanters } from '../PlantersContext';
import type { PlanterView } from '../types';

/**
 * The stage remote. Fault injection and time acceleration from the phone, so a
 * demo never means alt-tabbing to a terminal.
 *
 * Deliberately has no visible trigger: it opens on a long press of the wordmark
 * (see useLongPress) or with ?dev=1, and stays open across navigation. Rendered
 * only when the backend reports the simulator endpoints are available.
 */

const FAULTS = [
  { kind: 'lowWater', label: 'Low water' },
  { kind: 'sensorDropout', label: 'Sensor dropout' },
  { kind: 'offline', label: 'Offline' },
] as const;

const SPEEDS = [1, 60, 900] as const;
const STORAGE_KEY = 'planter.dev';

interface DevState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/**
 * Context, not a bare hook: the trigger lives on the Home wordmark while the
 * drawer is rendered by the app shell. With local state in a hook each caller
 * got its own copy, so the long press toggled a value nobody was rendering.
 */
const DevCtx = createContext<DevState | null>(null);

export function DevDrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false; // private mode, blocked storage — just start closed
    }
  });
  const [params] = useSearchParams();

  useEffect(() => {
    if (params.get('dev') === '1') setOpen(true);
  }, [params]);

  // Survives navigation, so it is opened once and stays open through a demo.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    } catch {
      /* nothing to do */
    }
  }, [open]);

  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <DevCtx.Provider value={value}>{children}</DevCtx.Provider>;
}

export function useDevDrawer(): DevState {
  const ctx = useContext(DevCtx);
  if (!ctx) throw new Error('useDevDrawer must be used inside <DevDrawerProvider>');
  return ctx;
}

/** Long press without a visible affordance — 600ms, cancelled by movement. */
export function useLongPress(onLongPress: () => void, ms = 600) {
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer) clearTimeout(timer);
    setTimer(null);
  };

  return {
    onPointerDown: () => setTimer(setTimeout(onLongPress, ms)),
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
  };
}

export function DevDrawer() {
  const { open, setOpen } = useDevDrawer();
  const { planters, simEnabled } = usePlanters();
  const [speed, setSpeed] = useState(1);
  // The simulator owns fault state and does not report it back. Low water and
  // offline are readable from telemetry; dropout is not, so it is tracked here.
  const [dropouts, setDropouts] = useState<Set<string>>(new Set());

  if (!open || !simEnabled) return null;

  const isOn = (p: PlanterView, kind: string): boolean => {
    if (kind === 'lowWater') return p.reported.waterOk === false;
    if (kind === 'offline') return !p.online;
    return dropouts.has(p.id);
  };

  const toggle = (p: PlanterView, kind: string) => {
    const on = !isOn(p, kind);
    if (kind === 'sensorDropout') {
      setDropouts((prev) => {
        const next = new Set(prev);
        if (on) next.add(p.id);
        else next.delete(p.id);
        return next;
      });
    }
    void post(`/api/sim/${p.id}/fault`, { kind, on });
  };

  return (
    <aside className="devdrawer" aria-label="Simulator controls">
      <div className="devdrawer__head">
        <span className="devdrawer__title">Simulator</span>
        <button type="button" className="button button--small" onClick={() => setOpen(false)}>Close</button>
      </div>

      <div className="devdrawer__scroll">
        {planters.map((p) => (
          <div key={p.id} className="devdrawer__planter">
            <span className="devdrawer__name">{p.name}</span>
            <div className="devdrawer__faults">
              {FAULTS.map((f) => (
                <button
                  key={f.kind}
                  type="button"
                  className={`devchip${isOn(p, f.kind) ? ' devchip--on' : ''}`}
                  aria-pressed={isOn(p, f.kind)}
                  onClick={() => toggle(p, f.kind)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="devdrawer__planter">
          <span className="devdrawer__name">Time</span>
          <div className="devdrawer__faults">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={`devchip${speed === s ? ' devchip--on' : ''}`}
                aria-pressed={speed === s}
                onClick={() => {
                  setSpeed(s);
                  void post('/api/sim/time-scale', { scale: s });
                }}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="devdrawer__note">
        Time acceleration changes how fast values move, not how much history exists. Use
        <code> pnpm seed </code> for that.
      </p>
    </aside>
  );
}
