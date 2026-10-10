import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BUILTIN_PRESETS,
  DesiredState,
  findBuiltinPreset,
  FAULT_KINDS,
  phAdvice,
  presetToDesired,
  TIME_SCALE,
} from '@planter/shared';
import { config } from './config';
import { db, readingsBetween, recentEvents, recordEvent } from './db';
import { publishDesired, publishFault, publishPumpStop, publishRunNow, publishTimeScale } from './mqtt';
import {
  allPlanters,
  applyPreset,
  getPlanter,
  persist,
  reloadFromDb,
  resolvePreset,
  toView,
} from './registry';
import { addClient, broadcast, markDirty } from './sse';

const IdParam = z.object({ id: z.string().min(1) });

export async function routes(app: FastifyInstance): Promise<void> {
  /**
   * Treat an empty JSON body as {}.
   *
   * Several endpoints take no body, and a client that sets
   * `Content-Type: application/json` and sends nothing otherwise trips
   * FST_ERR_CTP_EMPTY_JSON_BODY and 500s. That silently broke every bodyless
   * button in the app -- Run pump now, Stop pump, I added nutrients -- because
   * the fetch helper sent the header unconditionally.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      if (body === '') return done(null, {});
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.get('/api/health', async () => ({ ok: true, planters: allPlanters().length }));

  /**
   * Re-read planter config from the database and push it to every client.
   * Scripts that write to SQLite while this process is running call it, so the
   * in-memory copy does not quietly overwrite them.
   */
  app.post('/api/admin/reload', async () => {
    const count = reloadFromDb();
    broadcast('snapshot', {
      planters: allPlanters().map((p) => toView(p)),
      simEnabled: config.simEnabled,
    });
    console.log(`[registry] reloaded ${count} planter(s) from disk`);
    return { ok: true, planters: count };
  });

  app.get('/api/stream', (req, reply) => {
    addClient(reply);
  });

  app.get('/api/planters', async () => allPlanters().map((p) => toView(p)));

  app.get('/api/planters/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const record = getPlanter(id);
    if (!record) return reply.code(404).send({ error: 'unknown planter' });
    return toView(record);
  });

  app.patch('/api/planters/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const record = getPlanter(id);
    if (!record) return reply.code(404).send({ error: 'unknown planter' });

    const body = z
      .object({ name: z.string().min(1).max(60).optional(), plantType: z.string().max(40).nullable().optional() })
      .parse(req.body);

    if (body.name !== undefined) record.name = body.name;
    if (body.plantType !== undefined) record.plantType = body.plantType;
    persist(record);
    markDirty(id);
    return toView(record);
  });

  /** Partial desired state. Publishes only what changed. */
  app.post('/api/planters/:id/desired', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const record = getPlanter(id);
    if (!record) return reply.code(404).send({ error: 'unknown planter' });

    const patch = DesiredState.partial().parse(req.body);
    record.desired = { ...record.desired, ...patch };
    record.desiredSetAt = Date.now();
    persist(record);
    publishDesired(record, patch);
    markDirty(id);
    return toView(record);
  });

  app.post('/api/planters/:id/preset', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const record = getPlanter(id);
    if (!record) return reply.code(404).send({ error: 'unknown planter' });

    const { presetId } = z.object({ presetId: z.string().min(1) }).parse(req.body);
    const preset = resolvePreset(presetId);
    if (!preset) return reply.code(404).send({ error: 'unknown preset' });

    applyPreset(record, preset);
    record.desired = presetToDesired(preset, record.desired.pumpEnable);
    record.desiredSetAt = Date.now();
    persist(record);
    publishDesired(record, record.desired);
    markDirty(id);
    return toView(record);
  });

  app.post('/api/planters/:id/pump/run-now', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const record = getPlanter(id);
    if (!record) return reply.code(404).send({ error: 'unknown planter' });
    // An offline planter cannot act on this. Returning ok anyway published the
    // press into the void and told the UI it had worked, so a dead planter and
    // a working one looked identical.
    if (!record.online) return reply.code(409).send({ error: 'planter is offline' });
    publishRunNow(id);
    return { ok: true };
  });

  /** Stop a run in progress. Does not change the schedule. */
  app.post('/api/planters/:id/pump/stop', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const record = getPlanter(id);
    if (!record) return reply.code(404).send({ error: 'unknown planter' });
    if (!record.online) return reply.code(409).send({ error: 'planter is offline' });
    publishPumpStop(id);
    return { ok: true };
  });

  app.post('/api/planters/:id/ph', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const record = getPlanter(id);
    if (!record) return reply.code(404).send({ error: 'unknown planter' });

    const { ph } = z.object({ ph: z.number() }).parse(req.body);
    const preset = resolvePreset(record.presetId);
    if (!preset) return reply.code(409).send({ error: 'assign a preset before checking pH' });

    const now = Date.now();
    const result = phAdvice({
      ph,
      range: { min: preset.ph.targetMin, max: preset.ph.targetMax },
      // Zero, not the age of the previous check-in: this reading is being taken
      // now. Passing the old one's age made a fresh reading come back `stale`
      // whenever the last check was a while ago, which is the opposite of true.
      readingAgeHours: 0,
      checkIntervalDays: preset.ph.checkIntervalDays,
    });

    db.prepare(
      'INSERT INTO ph_checkins (planter_id, ts, ph, status, action, advice) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, now, ph, result.status, result.action, result.advice);
    recordEvent(id, 'ph_checkin', { ph, status: result.status, action: result.action }, now);
    markDirty(id);

    return result;
  });

  app.post('/api/planters/:id/nutrients', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const record = getPlanter(id);
    if (!record) return reply.code(404).send({ error: 'unknown planter' });
    const preset = resolvePreset(record.presetId);
    recordEvent(id, 'nutrients_added', {
      strengthMultiplier: preset?.nutrients.strengthMultiplier ?? null,
    });
    markDirty(id);
    return { ok: true };
  });

  app.get('/api/planters/:id/readings', async (req) => {
    const { id } = IdParam.parse(req.params);
    const q = z
      .object({
        metric: z.literal('water_temp_c').default('water_temp_c'),
        from: z.coerce.number().optional(),
        to: z.coerce.number().optional(),
      })
      .parse(req.query);

    const to = q.to ?? Date.now();
    const from = q.from ?? to - 86_400_000;
    return readingsBetween(id, q.metric, from, to);
  });

  app.get('/api/planters/:id/events', async (req) => {
    const { id } = IdParam.parse(req.params);
    const q = z
      .object({
        limit: z.coerce.number().min(1).max(500).default(50),
        from: z.coerce.number().optional(),
      })
      .parse(req.query);

    return recentEvents(id, q.limit, q.from).map((e) => ({
      ...e,
      payload: e.payload ? JSON.parse(e.payload) : null,
    }));
  });

  /**
   * Add a discovered planter to the dashboard.
   *
   * Replaces the QR claim flow. The backend still auto-discovers anything that
   * publishes, but a planter stays off the dashboard until it is added here, so
   * the fleet starts empty and onboarding is a deliberate step.
   *
   * Idempotent: adding an already-added planter updates its name and preset
   * rather than erroring, so a double tap is harmless.
   */
  app.post('/api/planters/:id/add', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const record = getPlanter(id);
    if (!record) return reply.code(404).send({ error: 'unknown planter' });

    const body = z
      .object({
        name: z.string().min(1).max(60).optional(),
        presetId: z.string().min(1).optional(),
      })
      .parse(req.body ?? {});

    // Resolve the preset before touching the record: returning 404 half way
    // through would leave the planter added in memory but not on disk.
    const preset = body.presetId ? resolvePreset(body.presetId) : null;
    if (body.presetId && !preset) return reply.code(404).send({ error: 'unknown preset' });

    const firstTime = record.addedAt === null;
    if (firstTime) record.addedAt = Date.now();
    if (body.name) record.name = body.name;

    if (preset) {
      applyPreset(record, preset);
      record.desired = presetToDesired(preset, record.desired.pumpEnable);
      record.desiredSetAt = Date.now();
      publishDesired(record, record.desired);
    }

    persist(record);
    if (firstTime) recordEvent(id, 'added');
    markDirty(id);
    return toView(record);
  });

  /** Take a planter back off the dashboard. Its history and config are kept. */
  app.post('/api/planters/:id/remove', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const record = getPlanter(id);
    if (!record) return reply.code(404).send({ error: 'unknown planter' });

    record.addedAt = null;
    persist(record);
    markDirty(id);
    return toView(record);
  });

  app.get('/api/presets', async () => BUILTIN_PRESETS);

  app.get('/api/presets/:presetId', async (req, reply) => {
    const { presetId } = z.object({ presetId: z.string() }).parse(req.params);
    const preset = findBuiltinPreset(presetId) ?? resolvePreset(presetId);
    return preset ?? reply.code(404).send({ error: 'unknown preset' });
  });

  // ── Simulator control. Present only when SIM_ENABLED, so it cannot ship by accident.
  if (config.simEnabled) {
    app.post('/api/sim/:id/fault', async (req, reply) => {
      const { id } = IdParam.parse(req.params);
      const body = z.object({ kind: z.enum(FAULT_KINDS), on: z.boolean() }).parse(req.body);
      if (!getPlanter(id)) return reply.code(404).send({ error: 'unknown planter' });
      publishFault(id, body.kind, body.on);
      return { ok: true, ...body };
    });

    app.post('/api/sim/time-scale', async (req) => {
      const { scale } = z
        .object({ scale: z.number().min(TIME_SCALE.min).max(TIME_SCALE.max) })
        .parse(req.body);
      publishTimeScale(scale);
      return { ok: true, scale };
    });
  }
}
