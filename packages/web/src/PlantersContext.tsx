import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { PlanterView } from './types';

/**
 * One SSE connection for the whole app, whole objects in, keyed by id.
 *
 * It lives in a context rather than a hook so that opening a second screen does
 * not open a second EventSource — browsers cap concurrent connections per origin,
 * and duplicates would each get their own snapshot.
 */

export type Connection = 'connecting' | 'live' | 'lost';

interface PlantersState {
  byId: Record<string, PlanterView>;
  planters: PlanterView[];
  connection: Connection;
  /** Whether the backend exposes the simulator control endpoints. */
  simEnabled: boolean;
}

const PlantersCtx = createContext<PlantersState | null>(null);

export function PlantersProvider({ children }: { children: React.ReactNode }) {
  const [byId, setById] = useState<Record<string, PlanterView>>({});
  const [connection, setConnection] = useState<Connection>('connecting');
  const [simEnabled, setSimEnabled] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/stream');

    es.addEventListener('snapshot', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        planters: PlanterView[];
        simEnabled?: boolean;
      };
      setById(Object.fromEntries(data.planters.map((p) => [p.id, p])));
      setSimEnabled(data.simEnabled === true);
      setConnection('live');
    });

    es.addEventListener('planter', (e) => {
      const planter = JSON.parse((e as MessageEvent).data) as PlanterView;
      setById((prev) => ({ ...prev, [planter.id]: planter }));
    });

    // EventSource reconnects on its own; we only reflect that in the UI.
    es.onopen = () => setConnection('live');
    es.onerror = () => setConnection('lost');

    return () => es.close();
  }, []);

  const value = useMemo<PlantersState>(
    () => ({
      byId,
      planters: Object.values(byId).sort((a, b) => a.id.localeCompare(b.id)),
      connection,
      simEnabled,
    }),
    [byId, connection, simEnabled],
  );

  return <PlantersCtx.Provider value={value}>{children}</PlantersCtx.Provider>;
}

export function usePlanters(): PlantersState {
  const ctx = useContext(PlantersCtx);
  if (!ctx) throw new Error('usePlanters must be used inside <PlantersProvider>');
  return ctx;
}

export const usePlanter = (id: string | undefined): PlanterView | undefined =>
  usePlanters().byId[id ?? ''];

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = (await res.json().catch(() => null)) as T;
  if (!res.ok && body === null) throw new Error(`${res.status} ${res.statusText}`);
  return body;
}

export const post = <T,>(path: string, body?: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
