import type { FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import {
  BUILTIN_PRESETS,
  DesiredState,
  DesiredStatePatch,
  findBuiltinPreset,
  phAdvice,
  presetToDesired,
} from '@planter/shared';
import { config } from './config';
import { db, readingsBetween, recentEvents, recordEvent } from './db';
import { publishDesired, publishPumpStop, publishRunNow } from './mqtt';
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
   * A bad request answers 400 with the validation detail, not 500.
   *
   * This lives with the routes rather than in the server bootstrap so the API's
   * error contract is part of the thing under test -- an empty note came back
   * as 500 in tests and 400 in production while the two were separated.
   */
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'invalid request', issues: err.issues });
    }
    console.error('[api]', err);
    return reply.code(500).send({ error: 'internal error' });
  });

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
    broadcast('snapshot', { planters: allPlanters().map((p) => toView(p)) });
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
      .object({
        name: z.string().min(1).max(60).optional(),
        plantType: z.string().max(40).nullable().optional(),
        /** Epoch ms the grower says it went in. Null clears it. */
        plantedAt: z.number().int().nullable().optional(),
      })
      .parse(req.body);

    if (body.name !== undefined) record.name = body.name;
    if (body.plantType !== undefined) record.plantType = body.plantType;
    if (body.plantedAt !== undefined) record.plantedAt = body.plantedAt;
    persist(record);
    markDirty(id);
    return toView(record);
  });

  /** Partial desired state. Publishes only what changed. */
  app.post('/api/planters/:id/desired', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const record = getPlanter(id);
    if (!record) return reply.code(404).send({ error: 'unknown planter' });

    const patch = DesiredStatePatch.parse(req.body);
    // Validate the result, not the patch: a runtime that is safe on its own
    // can still break the duty cycle once merged with the stored interval.
    record.desired = DesiredState.parse({ ...record.desired, ...patch });
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

    const { ph, note } = z
      .object({ ph: z.number(), note: z.string().max(500).optional() })
      .parse(req.body);
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
      'INSERT INTO ph_checkins (planter_id, ts, ph, status, action, advice, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, now, ph, result.status, result.action, result.advice, note?.trim() || null);
    recordEvent(
      id,
      'ph_checkin',
      { ph, status: result.status, action: result.action, note: note?.trim() || undefined },
      now,
    );
    markDirty(id);

    return result;
  });

  app.post('/api/planters/:id/nutrients', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const record = getPlanter(id);
    if (!record) return reply.code(404).send({ error: 'unknown planter' });
    const { note } = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});
    const preset = resolvePreset(record.presetId);
    recordEvent(id, 'nutrients_added', {
      strengthMultiplier: preset?.nutrients.strengthMultiplier ?? null,
      note: note?.trim() || undefined,
    });
    markDirty(id);
    return { ok: true };
  });

  /** A free-text observation. Goes straight to the timeline. */
  app.post('/api/planters/:id/notes', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    if (!getPlanter(id)) return reply.code(404).send({ error: 'unknown planter' });

    const { text } = z.object({ text: z.string().min(1).max(500) }).parse(req.body);
    recordEvent(id, 'note', { text: text.trim() });
    markDirty(id);
    return { ok: true };
  });

  /**
   * pH check-ins as a plottable series.
   *
   * Kept separate from /readings because these are not device telemetry: they
   * are typed in by hand, live in their own table and are never pruned, so the
   * timeline can show pH further back than the 30 days of temperature we keep.
   */
  app.get('/api/planters/:id/ph-history', async (req) => {
    const { id } = IdParam.parse(req.params);
    const q = z
      .object({ from: z.coerce.number().optional(), to: z.coerce.number().optional() })
      .parse(req.query);

    const to = q.to ?? Date.now();
    const from = q.from ?? to - 30 * 86_400_000;
    return db
      .prepare(
        'SELECT ts, ph, status, note FROM ph_checkins WHERE planter_id = ? AND ts BETWEEN ? AND ? ORDER BY ts',
      )
      .all(id, from, to) as { ts: number; ph: number; status: string; note: string | null }[];
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
        limit: z.coerce.number().min(1).max(2000).default(50),
        from: z.coerce.number().optional(),
        to: z.coerce.number().optional(),
      })
      .parse(req.query);

    const rows = recentEvents(id, q.limit, q.from);
    const bounded = q.to === undefined ? rows : rows.filter((e) => e.ts <= q.to!);
    return bounded.map((e) => ({
      ...e,
      payload: e.payload ? JSON.parse(e.payload) : null,
    }));
  });

  /**
   * Add a discovered planter to the dashboard.
   *
   * The backend auto-discovers anything that
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
}
