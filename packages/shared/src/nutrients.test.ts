import { describe, expect, it } from 'vitest';
import { dueState, nutrientStatus } from './nutrients';

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 23, 12, 0, 0);

describe('nutrientStatus', () => {
  it('reports due when nothing has ever been recorded', () => {
    const r = nutrientStatus({ lastAddedAt: null, scheduleDays: 7, now });
    expect(r.status).toBe('due');
    expect(r.dueAt).toBeNull();
  });

  it('is ok inside the schedule', () => {
    expect(nutrientStatus({ lastAddedAt: now - 2 * DAY, scheduleDays: 7, now }).status).toBe('ok');
  });

  it('counts down in days', () => {
    expect(nutrientStatus({ lastAddedAt: now - 2 * DAY, scheduleDays: 7, now }).dueInDays).toBe(5);
  });

  it('is due on the day it falls due', () => {
    expect(nutrientStatus({ lastAddedAt: now - 7 * DAY, scheduleDays: 7, now }).status).toBe('due');
  });

  it('becomes overdue past the grace period', () => {
    expect(nutrientStatus({ lastAddedAt: now - 9 * DAY, scheduleDays: 7, now }).status).toBe('overdue');
  });

  it('goes negative once overdue', () => {
    expect(nutrientStatus({ lastAddedAt: now - 9 * DAY, scheduleDays: 7, now }).dueInDays).toBe(-2);
  });

  it('never reads a pH value — the signature makes it impossible', () => {
    const a = nutrientStatus({ lastAddedAt: now - 3 * DAY, scheduleDays: 7, now });
    const b = nutrientStatus({ lastAddedAt: now - 3 * DAY, scheduleDays: 7, now });
    expect(a).toEqual(b);
  });
});

describe('dueState', () => {
  const DAY = 86_400_000;

  it('is quiet when nothing is scheduled', () => {
    expect(dueState(null, now)).toBe('ok');
  });

  it('is quiet well before the date', () => {
    expect(dueState(now + 5 * DAY, now)).toBe('ok');
  });

  it('warns the day before', () => {
    expect(dueState(now + 12 * 3_600_000, now)).toBe('soon');
  });

  it('is due on the date', () => {
    expect(dueState(now, now)).toBe('due');
  });

  it('is still only due inside the grace period', () => {
    expect(dueState(now - 12 * 3_600_000, now)).toBe('due');
  });

  it('is overdue past the grace period', () => {
    expect(dueState(now - 3 * DAY, now)).toBe('overdue');
  });

  it('takes a custom warning window', () => {
    expect(dueState(now + 2 * DAY, now, { soonDays: 3 })).toBe('soon');
    expect(dueState(now + 2 * DAY, now)).toBe('ok');
  });

  it('never reports overdue for something not yet due', () => {
    for (let d = 0; d <= 10; d++) {
      const state = dueState(now + d * DAY, now);
      expect(state === 'overdue', `${d} days out`).toBe(false);
    }
  });
});
