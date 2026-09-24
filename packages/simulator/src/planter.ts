import type { MqttClient } from 'mqtt';
import {
  AVAILABILITY,
  deviceTopics,
  lightLux,
  numeric,
  onOff,
  waterTempC,
  type FaultKind,
} from '@planter/shared';

/**
 * One virtual planter. Publishes and accepts exactly the topics in DESIGN.md §2,
 * so the backend cannot tell it apart from the real board.
 *
 * It also mirrors the firmware's behaviour, not just its topics: the pump runs
 * on the hour when `hour % intervalHours === 0`, and the low-water interlock
 * refuses to start and cuts a run already in progress.
 */

export interface PlanterOptions {
  id: string;
  seed: number;
  peakLux?: number;
  baseTempC?: number;
}

/** Matches the stagger in DESIGN.md §4, so sync chips clear one at a time. */
const CONFIRM_STAGGER_MS = 150;

export class VirtualPlanter {
  readonly id: string;
  private readonly t: ReturnType<typeof deviceTopics>;
  private readonly seed: number;
  private readonly peakLux: number;
  private readonly baseTempC: number;

  // settable config, mirroring the firmware's defaults
  private pumpEnable = true;
  private speedPercent = 70;
  private intervalHours = 6;
  private runtimeMinutes = 2;

  // runtime
  private pumpOn = false;
  private pumpStopsAt: number | null = null;
  private lastRunHour: number | null = null;

  private faults: Record<FaultKind, boolean> = {
    lowWater: false,
    sensorDropout: false,
    offline: false,
  };

  private confirmQueue = 0;

  constructor(
    private readonly client: MqttClient,
    opts: PlanterOptions,
  ) {
    this.id = opts.id;
    this.t = deviceTopics(opts.id);
    this.seed = opts.seed;
    this.peakLux = opts.peakLux ?? 6000;
    this.baseTempC = opts.baseTempC ?? 21;
  }

  get commandTopics(): string[] {
    return [
      this.t.pumpCommand,
      this.t.pumpSpeedCommand,
      this.t.pumpEnableCommand,
      this.t.intervalHoursCommand,
      this.t.runtimeMinutesCommand,
      this.t.runPumpNowCommand,
    ];
  }

  /** The retained will the broker publishes if we vanish. */
  static will(id: string) {
    return {
      topic: deviceTopics(id).status,
      payload: AVAILABILITY.offline,
      retain: true,
      qos: 0 as const,
    };
  }

  announce(now: number): void {
    this.pub(this.t.status, AVAILABILITY.online);
    this.publishConfig();
    this.publishPumpState();
    this.publishTelemetry(now);
  }

  setFault(kind: FaultKind, on: boolean): void {
    this.faults[kind] = on;

    if (kind === 'offline') {
      // A real board going offline leaves its retained status behind.
      this.pub(this.t.status, on ? AVAILABILITY.offline : AVAILABILITY.online, true);
      if (!on) this.announce(Date.now());
      return;
    }

    if (kind === 'lowWater') {
      // Mirrors the firmware interlock: cut a run already in progress.
      if (on && this.pumpOn) this.stopPump('low water');
      this.publishWater();
    }
  }

  /** Called on every simulated tick with the virtual clock. */
  tick(now: number): void {
    if (this.faults.offline) return;

    this.runSchedule(now);
    this.publishTelemetry(now);
  }

  handleCommand(topic: string, raw: string): void {
    if (this.faults.offline) return;

    switch (topic) {
      case this.t.runPumpNowCommand:
        this.startPump(Date.now(), 'run now');
        return;

      case this.t.pumpCommand: {
        const on = onOff.decode(raw);
        if (on === null) return;
        if (on) this.startPump(Date.now(), 'direct command');
        else this.stopPump('direct command');
        return;
      }

      case this.t.pumpEnableCommand: {
        const on = onOff.decode(raw);
        if (on === null) return;
        this.pumpEnable = on;
        if (!on && this.pumpOn) this.stopPump('pump disabled');
        this.confirm(() => {
          this.pub(this.t.pumpEnableState, onOff.encode(this.pumpEnable));
          this.publishBlocked();
        });
        return;
      }

      case this.t.pumpSpeedCommand: {
        const n = numeric.decode(raw);
        if (n === null) return;
        this.speedPercent = Math.round(Math.min(100, Math.max(0, n)));
        this.confirm(() => this.pub(this.t.pumpSpeedState, numeric.encode(this.speedPercent)));
        return;
      }

      case this.t.intervalHoursCommand: {
        const n = numeric.decode(raw);
        if (n === null) return;
        // The firmware snaps to a divisor of 24. We reproduce the snap, but
        // publish the snapped value back rather than the requested one — the
        // fix DESIGN.md §2 asks for, so reported state does not lie.
        this.intervalHours = snapToDivisorOf24(Math.round(n));
        this.confirm(() => this.pub(this.t.intervalHoursState, numeric.encode(this.intervalHours)));
        return;
      }

      case this.t.runtimeMinutesCommand: {
        const n = numeric.decode(raw);
        if (n === null) return;
        this.runtimeMinutes = Math.min(30, Math.max(1, n));
        this.confirm(() => this.pub(this.t.runtimeMinutesState, numeric.encode(this.runtimeMinutes)));
        return;
      }
    }
  }

  private runSchedule(now: number): void {
    if (this.pumpOn && this.pumpStopsAt !== null && now >= this.pumpStopsAt) {
      this.stopPump('runtime elapsed');
      return;
    }

    // Local hours, not UTC: real ESPHome uses its configured timezone, and the UI
    // computes "next pump" locally too. Using UTC here made them disagree by the
    // UTC offset — an hour wrong all summer in the UK.
    const hour = new Date(now).getHours();
    if (hour % this.intervalHours === 0 && hour !== this.lastRunHour) {
      this.lastRunHour = hour;
      this.pub(this.t.lastRunHour, `${String(hour).padStart(2, '0')}:00`);
      this.pub(this.t.nextScheduledRuns, nextRuns(this.intervalHours));
      this.startPump(now, 'scheduled');
    }
  }

  private startPump(now: number, reason: string): void {
    if (!this.waterOk || !this.pumpEnable) {
      console.log(`[${this.id}] INTERLOCK: ${reason} refused (${!this.waterOk ? 'low water' : 'pump disabled'})`);
      this.publishBlocked();
      return;
    }
    this.pumpOn = true;
    this.pumpStopsAt = now + this.runtimeMinutes * 60_000;
    console.log(`[${this.id}] pump on (${reason}, ${this.runtimeMinutes} min)`);
    this.publishPumpState();
  }

  private stopPump(reason: string): void {
    if (!this.pumpOn) return;
    this.pumpOn = false;
    this.pumpStopsAt = null;
    console.log(`[${this.id}] pump off (${reason})`);
    this.publishPumpState();
  }

  private get waterOk(): boolean {
    return !this.faults.lowWater;
  }

  private publishTelemetry(now: number): void {
    if (this.faults.sensorDropout) return;
    this.pub(this.t.waterTemperature, numeric.encode(waterTempC(now, this.seed, this.baseTempC)));
    this.pub(this.t.lightLevel, numeric.encode(lightLux(now, this.seed, this.peakLux)));
  }

  private publishWater(): void {
    this.pub(this.t.waterOk, onOff.encode(this.waterOk));
    this.publishBlocked();
  }

  private publishBlocked(): void {
    this.pub(this.t.pumpBlocked, onOff.encode(!this.waterOk || !this.pumpEnable));
  }

  private publishPumpState(): void {
    this.pub(this.t.pumpState, onOff.encode(this.pumpOn));
  }

  private publishConfig(): void {
    this.pub(this.t.pumpEnableState, onOff.encode(this.pumpEnable));
    this.pub(this.t.pumpSpeedState, numeric.encode(this.speedPercent));
    this.pub(this.t.intervalHoursState, numeric.encode(this.intervalHours));
    this.pub(this.t.runtimeMinutesState, numeric.encode(this.runtimeMinutes));
    this.pub(this.t.nextScheduledRuns, nextRuns(this.intervalHours));
    this.publishWater();
  }

  /**
   * Space confirmations out so the UI's pending chips clear one at a time. A
   * real ESPHome board with optimistic numbers answers instantly; this is a
   * deliberate demo affordance, not a simulation of latency.
   */
  private confirm(publish: () => void): void {
    const delay = this.confirmQueue * CONFIRM_STAGGER_MS;
    this.confirmQueue += 1;
    setTimeout(() => {
      publish();
      this.confirmQueue = Math.max(0, this.confirmQueue - 1);
    }, delay);
  }

  private pub(topic: string, payload: string, force = false): void {
    if (this.faults.offline && !force) return;
    this.client.publish(topic, payload, { retain: true, qos: 0 });
  }
}

function snapToDivisorOf24(hours: number): number {
  const allowed = [1, 2, 3, 4, 6, 8, 12, 24];
  const clamped = Math.min(24, Math.max(1, hours));
  return allowed.reduce((best, c) => (Math.abs(c - clamped) < Math.abs(best - clamped) ? c : best), 1);
}

function nextRuns(intervalHours: number): string {
  const runs: string[] = [];
  for (let h = 0; h < 24; h += intervalHours) runs.push(`${String(h).padStart(2, '0')}:00`);
  return runs.join(', ');
}
