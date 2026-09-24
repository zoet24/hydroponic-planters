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
import { consumeToken, inspectToken } from './claim';
import { config } from './config';
import { db, readingsBetween, recentEvents, recordEvent } from './db';
import { publishDesired, publishFault, publishRunNow, publishTimeScale } from './mqtt';
import { allPlanters, applyPreset, getPlanter, persist, resolvePreset, toView } from './registry';
import { addClient, markDirty } from './sse';

const IdParam = z.object({ id: z.string().min(1) });

export async function routes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({ ok: true, planters: allPlanters().length }));

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
    if (!getPlanter(id)) return reply.code(404).send({ error: 'unknown planter' });
    publishRunNow(id);
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
        metric: z.enum(['water_temp_c', 'light_lux']).default('water_temp_c'),
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

  // ── Claim flow ────────────────────────────────────────────────────────────
  //
  // Preview is read-only: the confirm screen needs to know whether a code is
  // good before anyone taps the button, and looking must not consume it.

  app.get('/api/claim', async (req) => {
    const q = z.object({ d: z.string().min(1), t: z.string().min(1) }).parse(req.query);
    const outcome = inspectToken(q.d, q.t);
    const record = getPlanter(q.d);
    return {
      outcome,
      planter: outcome === 'unknown' || !record ? null : toView(record),
    };
  });

  app.post('/api/claim', async (req, reply) => {
    const body = z
      .object({
        planterId: z.string().min(1),
        token: z.string().min(1),
        name: z.string().min(1).max(60).optional(),
        presetId: z.string().min(1).optional(),
      })
      .parse(req.body);

    const record = getPlanter(body.planterId);
    if (!record) return reply.code(404).send({ outcome: 'unknown', planter: null });

    // An already-claimed code opens the planter rather than erroring: realistically
    // that is you, re-scanning your own sticker.
    const existing = inspectToken(body.planterId, body.token);
    if (existing === 'already_claimed') {
      return reply.code(200).send({ outcome: 'already_claimed', planter: toView(record) });
    }

    const outcome = consumeToken(body.planterId, body.token);
    if (outcome !== 'ready') {
      const code = outcome === 'expired' ? 410 : 404;
      return reply.code(code).send({ outcome, planter: null });
    }

    record.claimedAt = Date.now();
    if (body.name) record.name = body.name;

    if (body.presetId) {
      const preset = resolvePreset(body.presetId);
      if (preset) {
        applyPreset(record, preset);
        record.desired = presetToDesired(preset, record.desired.pumpEnable);
        record.desiredSetAt = Date.now();
        publishDesired(record, record.desired);
      }
    }

    persist(record);
    markDirty(body.planterId);
    return { outcome: 'ready', planter: toView(record) };
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
