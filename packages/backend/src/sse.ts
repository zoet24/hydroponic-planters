import type { FastifyReply } from 'fastify';
import { config } from './config';
import { allPlanters, toView, type PlanterView } from './registry';

/**
 * The real-time channel. SSE rather than WebSocket: traffic is one-way, the
 * browser reconnects on its own, and it survives a flaky hotspot.
 *
 * We push whole planter objects rather than diffs. With a handful of planters
 * that costs nothing and removes an entire category of bug.
 */

const clients = new Set<FastifyReply>();

/** MQTT arrives in bursts — especially retained state on connect. Coalesce. */
const dirty = new Set<string>();
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_MS = 50;

export function addClient(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.write(': connected\n\n');

  clients.add(reply);
  // simEnabled rides along on the snapshot so the UI needs no extra fetch to
  // know whether the dev drawer is available.
  send(reply, 'snapshot', {
    planters: allPlanters().map((p) => toView(p)),
    simEnabled: config.simEnabled,
  });

  reply.raw.on('close', () => clients.delete(reply));
}

export function markDirty(planterId: string): void {
  dirty.add(planterId);
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_MS);
}

function flush(): void {
  flushTimer = null;
  if (clients.size === 0) {
    dirty.clear();
    return;
  }
  for (const id of dirty) {
    const record = allPlanters().find((p) => p.id === id);
    if (record) broadcast('planter', toView(record));
  }
  dirty.clear();
}

export function broadcast(event: string, data: PlanterView | unknown): void {
  for (const reply of clients) send(reply, event, data);
}

function send(reply: FastifyReply, event: string, data: unknown): void {
  try {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(reply);
  }
}

/** Comment frames stop proxies and phones idling the connection out. */
setInterval(() => {
  for (const reply of clients) {
    try {
      reply.raw.write(': ping\n\n');
    } catch {
      clients.delete(reply);
    }
  }
}, 20_000).unref();
