import { useEffect, useRef, useState } from 'react';

/**
 * The entire state management story: one SSE connection, whole objects in,
 * keyed by id. No diffing, no reducers, no cache invalidation.
 */
export interface PlanterView {
  id: string;
  name: string;
  plantType: string | null;
  presetId: string | null;
  claimed: boolean;
  simulated: boolean;
  online: boolean;
  lastSeenAt: number | null;
  desired: Record<string, number | boolean>;
  reported: Record<string, number | boolean | string | undefined>;
  pending: string[];
  syncing: boolean;
  syncStale: boolean;
  flowEstimateLpm: number;
  alerts: { kind: string; severity: string; message: string }[];
}

type Connection = 'connecting' | 'live' | 'lost';

export function usePlanters() {
  const [planters, setPlanters] = useState<Record<string, PlanterView>>({});
  const [connection, setConnection] = useState<Connection>('connecting');
  const source = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    source.current = es;

    es.addEventListener('snapshot', (e) => {
      const { planters: list } = JSON.parse((e as MessageEvent).data) as { planters: PlanterView[] };
      setPlanters(Object.fromEntries(list.map((p) => [p.id, p])));
      setConnection('live');
    });

    es.addEventListener('planter', (e) => {
      const planter = JSON.parse((e as MessageEvent).data) as PlanterView;
      setPlanters((prev) => ({ ...prev, [planter.id]: planter }));
    });

    // EventSource reconnects on its own; we only reflect it in the UI.
    es.onopen = () => setConnection('live');
    es.onerror = () => setConnection('lost');

    return () => es.close();
  }, []);

  return { planters: Object.values(planters).sort((a, b) => a.id.localeCompare(b.id)), connection };
}

export async function post(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}
